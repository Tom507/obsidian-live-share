// WP25 / AC3 blind1 (period half) — the period, measured through an INJECTED
// scheduler rather than through vitest's fake timers.
//
// Different mechanism, deliberately. The visible test advances a faked global
// clock; this one hands the lifecycle its own scheduler and inspects the exact
// arguments it was given. That sees two things the clock cannot:
//
//   ├── the PERIOD VALUE actually passed to `setInterval`. A clock-advancing
//   │   test proves "it fired somewhere in this window"; this proves the number.
//   └── RE-ENTRANCY. If a compaction is still in flight when the next tick
//       arrives, a second one must not stack on top of it — two concurrent
//       compactions of the same guid interleave a checkpoint with a truncate and
//       can destroy history that the checkpoint did not capture.
//
// Every "did not fire" assertion is still paired with a POSITIVE CONTROL in the
// same `it`, because an injected scheduler makes "never armed" even easier to
// pass by accident than a fake clock does.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarCheckpointPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  SIDECAR_COMPACTION_PERIOD_MS,
  createSidecarLifecycle,
} from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";

const GUID = "e3a7c05d9b184f26ac7150ebd3298f47";

interface Armed {
  ms: number;
  fire(): void;
  cleared: boolean;
}

function manualScheduler(): {
  armed: Armed[];
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
} {
  const armed: Armed[] = [];
  return {
    armed,
    setInterval(cb: () => void, ms: number) {
      const entry: Armed = { ms, fire: cb, cleared: false };
      armed.push(entry);
      return entry;
    },
    clearInterval(handle: unknown) {
      const entry = handle as Armed;
      if (entry) entry.cleared = true;
    },
  };
}

function memoryIO(): SidecarIO & { files: Map<string, Uint8Array>; writes: string[] } {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    files,
    writes,
    async ensureDir() {},
    async exists(p: string) {
      return files.has(p);
    },
    async read(p: string) {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(f);
    },
    async write(p: string, d: Uint8Array) {
      writes.push(p);
      files.set(p, Uint8Array.from(d));
    },
    async append(p: string, d: Uint8Array) {
      const prev = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      files.set(p, out);
    },
    async truncate(p: string) {
      files.set(p, new Uint8Array(0));
    },
    async remove(p: string) {
      files.delete(p);
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function card(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    record.set("type", "text");
    record.set("text", id);
  });
}

const checkpoints = (io: ReturnType<typeof memoryIO>): number =>
  io.writes.filter((p) => p === sidecarCheckpointPath(GUID)).length;

describe("WP25 AC3 blind1 — the compaction period is a value, not a vibe", () => {
  it("the interval is armed exactly once, with the documented period in ms", async () => {
    const scheduler = manualScheduler();
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { scheduler });

    expect(scheduler.armed.length, "no periodic timer was armed at all").toBe(1);
    expect(
      scheduler.armed[0].ms,
      "the interval was not armed with SIDECAR_COMPACTION_PERIOD_MS",
    ).toBe(SIDECAR_COMPACTION_PERIOD_MS);

    // Arming a second timer per attached doc would compact one board N times per
    // period once N boards are open.
    lifecycle.attach(GUID, new Y.Doc());
    lifecycle.attach("11223344556677889900aabbccddeeff", new Y.Doc());
    expect(scheduler.armed.length).toBe(1);

    await lifecycle.destroy();
  });

  it("an injected period overrides the constant, and the constant is not used", async () => {
    const scheduler = manualScheduler();
    const periodMs = 1234;
    expect(periodMs).not.toBe(SIDECAR_COMPACTION_PERIOD_MS);
    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      scheduler,
      periodMs,
    });

    expect(scheduler.armed.map((a) => a.ms)).toEqual([periodMs]);

    await lifecycle.destroy();
  });

  it("nothing is compacted until the interval fires — and then it is", async () => {
    const scheduler = manualScheduler();
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { scheduler });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1");
    await settle();

    // NEGATIVE
    expect(checkpoints(io), "a compaction ran before the interval fired").toBe(0);

    // POSITIVE CONTROL — without this, the line above is satisfied by an
    // implementation that never compacts at all.
    scheduler.armed[0].fire();
    await settle();
    expect(checkpoints(io), "firing the interval compacted nothing").toBe(1);

    await lifecycle.destroy();
  });

  it("a tick that arrives while a compaction is in flight does not stack", async () => {
    // Two concurrent compactions of one guid can interleave a checkpoint with a
    // truncate. WP24 serialises per guid inside the store, so the damage is
    // bounded — but the second compaction is still pure waste and its removals
    // race the first one's checkpoint.
    const scheduler = manualScheduler();
    const io = memoryIO();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SidecarIO = {
      ...io,
      async write(p: string, d: Uint8Array) {
        await gate;
        return io.write(p, d);
      },
    };
    const lifecycle = createSidecarLifecycle(createSidecarStore(slow), { scheduler });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1");
    await settle();

    scheduler.armed[0].fire();
    await settle();
    scheduler.armed[0].fire();
    scheduler.armed[0].fire();
    await settle();

    release();
    await settle();

    expect(
      checkpoints(io),
      "overlapping ticks stacked into multiple concurrent compactions",
    ).toBe(1);

    await lifecycle.destroy();
  });

  it("destroy clears the interval it armed", async () => {
    const scheduler = manualScheduler();
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { scheduler });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1");
    await settle();

    // POSITIVE CONTROL first.
    scheduler.armed[0].fire();
    await settle();
    expect(checkpoints(io)).toBe(1);

    await lifecycle.destroy();
    expect(scheduler.armed[0].cleared, "the interval handle was never cleared").toBe(true);

    // and even if something fires it anyway, a destroyed lifecycle compacts
    // nothing — clearing the handle is necessary, not sufficient.
    scheduler.armed[0].fire();
    await settle();
    expect(checkpoints(io)).toBe(1);
  });
});
