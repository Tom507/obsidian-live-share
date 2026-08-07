// WP25 / AC3 blind2 (period half) — the period as a DOCUMENTED, IMPORTABLE
// value, and the timer as something that survives a long session.
//
// The visible test advances vitest's fake clock; blind1 inspects an injected
// scheduler's arguments. This one asks the two questions neither of those does:
//
//   ├── is the tunable DOCUMENTED? AC3 says "a documented, tunable period". The
//   │   name is the documentation this project has chosen — the unit must be
//   │   readable off the identifier, because the second tunable in the same
//   │   module is NOT in milliseconds (`TombstoneEntry.t` is a Lamport counter)
//   │   and the two are one keystroke apart at the call site. So the module's
//   │   own source is read and the two constants are required to differ in unit
//   │   suffix.
//   └── does it keep firing? Compaction is the thing that stops an editing
//       session's history growing without bound, so "it fired once" is not the
//       property; "it fires every period, for as long as the session lasts" is.
//       Twenty periods are advanced and twenty compactions are required.
//
// Every "not yet" below has a positive control in the same `it`.

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarCheckpointPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS,
  SIDECAR_COMPACTION_PERIOD_MS,
  createSidecarLifecycle,
} from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";

const GUID = "0d7be4a1935f42c68ea20cb7f5194d63";

const MODULE_SOURCE = readFileSync(
  new URL("../../../../../plugin/src/files/canvas-sidecar-lifecycle.ts", import.meta.url),
  "utf8",
);

function memoryIO(): SidecarIO & { writes: string[] } {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
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

const compactions = (io: ReturnType<typeof memoryIO>): number =>
  io.writes.filter((p) => p === sidecarCheckpointPath(GUID)).length;

function card(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    record.set("id", id);
    record.set("type", "text");
  });
}

describe("WP25 AC3 blind2 — the period is documented and it keeps firing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the two tunables are exported and their names disambiguate the unit", () => {
    // They mean different things and they sit next to each other. A horizon read
    // as milliseconds, or a period read as ticks, type-checks perfectly and
    // garbage collects a different set of tombstones on every peer.
    expect(typeof SIDECAR_COMPACTION_PERIOD_MS).toBe("number");
    expect(typeof SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS).toBe("number");
    expect(SIDECAR_COMPACTION_PERIOD_MS).toBeGreaterThan(0);
    expect(SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS).toBeGreaterThan(0);

    // The names carry the unit, which is how AC3's "documented" is satisfied in
    // a codebase whose own constants already read `DEBOUNCE_MS`, `MAX_WAIT_MS`.
    expect(MODULE_SOURCE).toMatch(/export\s+const\s+SIDECAR_COMPACTION_PERIOD_MS\b/);
    expect(MODULE_SOURCE).toMatch(
      /export\s+const\s+SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS\b/,
    );
    // and the horizon is NOT spelt in milliseconds anywhere.
    expect(MODULE_SOURCE).not.toMatch(/SIDECAR_COMPACTION_HORIZON_MS\b/);
  });

  it("twenty periods produce twenty compactions", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 50 });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-anchor");
    await vi.advanceTimersByTimeAsync(0);

    expect(compactions(io), "a compaction ran before the first period").toBe(0);

    for (let period = 1; period <= 20; period++) {
      card(doc, `n-${period}`);
      await vi.advanceTimersByTimeAsync(50);
      expect(compactions(io), `the timer stopped after ${period - 1} periods`).toBe(period);
    }

    await lifecycle.destroy();
  });

  it("an idle board is still compacted — the timer is not edit-driven", async () => {
    // The period is a period, not a debounce. A compaction that only ran when
    // something changed would never truncate the history of a board that was
    // busy and then went quiet, which is the exact shape a long session ends in.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 50 });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1");
    await vi.advanceTimersByTimeAsync(50);
    const afterFirst = compactions(io);
    expect(afterFirst).toBe(1);

    // No edits at all from here.
    await vi.advanceTimersByTimeAsync(50 * 3);
    expect(
      compactions(io),
      "the compaction timer stopped once the board went quiet",
    ).toBe(afterFirst + 3);

    await lifecycle.destroy();
  });

  it("attaching after the timer is armed still gets the doc compacted", async () => {
    // A board opened mid-session must join the existing schedule rather than
    // wait for a timer that was never armed for it.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 50 });
    await vi.advanceTimersByTimeAsync(50 * 2);

    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-late");
    const before = compactions(io);

    await vi.advanceTimersByTimeAsync(50);
    expect(
      compactions(io),
      "a doc attached after the timer was armed is never compacted",
    ).toBe(before + 1);

    await lifecycle.destroy();
  });

  it("destroy is idempotent and leaves no timer behind", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 50 });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1");

    await vi.advanceTimersByTimeAsync(50);
    expect(compactions(io)).toBe(1);

    await lifecycle.destroy();
    await lifecycle.destroy();
    const frozen = compactions(io);

    await vi.advanceTimersByTimeAsync(50 * 5);
    expect(compactions(io), "a timer survived destroy()").toBe(frozen);
  });
});
