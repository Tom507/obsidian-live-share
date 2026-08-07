// WP24 / AC1 blind1 — the ordering claim, attacked with a CRASH rather than
// with a stopwatch.
//
// Different angle from the visible test (which holds `write` open and inspects
// the call log): here the IO seam is rigged so that the process "dies" at the
// truncate step — the truncate simply never resolves and a snapshot of the disk
// is taken at that instant. The rule "checkpoint first, truncate second" has
// exactly one observable consequence, and this is it: at every instant during
// `checkpoint()`, the union of what is on disk is sufficient to rebuild the
// doc. There is no window in which both the checkpoint and the history are
// unusable.
//
// A reversed implementation passes every end-state assertion and fails this one
// on the first probe, because between its truncate and its write the disk holds
// nothing at all.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-order";

interface Snapshot {
  history: number[] | undefined;
  checkpoint: number[] | undefined;
}

function makeIO(pauseOn?: string) {
  const disk = new Map<string, number[]>();
  const snapshots: Snapshot[] = [];
  const order: string[] = [];
  let hold: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    hold = resolve;
  });

  const snap = (): void => {
    snapshots.push({
      history: disk.get(sidecarHistoryPath(GUID))?.slice(),
      checkpoint: disk.get(sidecarCheckpointPath(GUID))?.slice(),
    });
  };

  const step = async <T>(op: string, path: string, fn: () => T): Promise<T> => {
    order.push(`${op}:enter`);
    snap();
    if (op === pauseOn) await paused;
    await Promise.resolve();
    const out = fn();
    order.push(`${op}:exit`);
    snap();
    return out;
  };

  return {
    disk,
    order,
    snapshots,
    resume: (): void => hold?.(),
    bytes: (p: string) => Uint8Array.from(disk.get(p) ?? []),
    ensureDir: (d: string) => step("ensureDir", d, () => undefined),
    exists: (p: string) => step("exists", p, () => disk.has(p)),
    read: (p: string) =>
      step("read", p, () => {
        const found = disk.get(p);
        if (found === undefined) throw new Error(`ENOENT ${p}`);
        return Uint8Array.from(found);
      }),
    write: (p: string, d: Uint8Array) =>
      step("write", p, () => {
        disk.set(p, [...d]);
      }),
    append: (p: string, d: Uint8Array) =>
      step("append", p, () => {
        disk.set(p, [...(disk.get(p) ?? []), ...d]);
      }),
    truncate: (p: string) =>
      step("truncate", p, () => {
        disk.set(p, []);
      }),
    remove: (p: string) =>
      step("remove", p, () => {
        disk.delete(p);
      }),
  };
}

function seededDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("alpha", { x: 0 });
  doc.getMap("nodes").set("beta", { x: 1 });
  doc.getMap("nodes").set("gamma", { x: 2 });
  return { doc, updates };
}

describe("WP24 AC1 blind1 — no instant exists at which the doc is unrecoverable", () => {
  it("at every recorded instant of checkpoint(), checkpoint OR history is non-empty", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = seededDoc();
    for (const update of updates) await store.append(GUID, update);

    io.snapshots.length = 0;
    await store.checkpoint(GUID, doc);

    expect(io.snapshots.length).toBeGreaterThan(1);
    for (const [index, s] of io.snapshots.entries()) {
      const historyBytes = s.history?.length ?? 0;
      const checkpointBytes = s.checkpoint?.length ?? 0;
      expect(historyBytes + checkpointBytes, `snapshot ${index} left the disk empty`).toBeGreaterThan(
        0,
      );
    }
  });

  it("a process that dies at the truncate step can still be rebuilt from disk", async () => {
    const io = makeIO("truncate");
    const store = createSidecarStore(io);
    const { doc, updates } = seededDoc();
    for (const update of updates) await store.append(GUID, update);

    void store.checkpoint(GUID, doc);
    for (let i = 0; i < 30; i++) await Promise.resolve();

    // The "crash": we never resume. Whatever is on disk now is all a restarted
    // client would ever see.
    const checkpoint = io.bytes(sidecarCheckpointPath(GUID));
    expect(checkpoint.length).toBeGreaterThan(0);

    const revived = new Y.Doc();
    Y.applyUpdate(revived, checkpoint);
    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);

    io.resume();
  });

  it("truncate is never entered before the checkpoint write has exited", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = seededDoc();
    for (const update of updates) await store.append(GUID, update);

    io.order.length = 0;
    await store.checkpoint(GUID, doc);

    const writeExit = io.order.indexOf("write:exit");
    const truncateEnter = io.order.indexOf("truncate:enter");
    expect(writeExit).toBeGreaterThanOrEqual(0);
    expect(truncateEnter).toBeGreaterThan(writeExit);
  });
});
