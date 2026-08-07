// WP24 / AC3 (missing) blind1 — attacked through a HOSTILE io, where every
// method that the store has no business calling explodes.
//
// Different angle: the visible test uses a permissive fake and inspects the
// call log afterwards. Here `read`, `write`, `append`, `truncate` and `remove`
// all throw immediately, so the ONLY way `load` can return at all is by
// deciding from `exists` alone that there is nothing to read. That converts
// "the store must not read a file it has not confirmed" from an assertion about
// a log into a structural property of the run.
//
// A second leg covers the half-missing cases, which are not degradations at
// all: history-without-checkpoint and checkpoint-without-history are both
// normal lifecycle states and must report NONE.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  isSidecarDegraded,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-missing";

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function hostileIO(present: Map<string, Uint8Array>) {
  const forbidden = (name: string) => async (): Promise<never> => {
    throw new Error(`the store touched ${name} on a sidecar it never confirmed`);
  };
  return {
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => present.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = present.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: forbidden("write"),
    append: forbidden("append"),
    truncate: forbidden("truncate"),
    remove: forbidden("remove"),
  };
}

describe("WP24 AC3 blind1 — an absent sidecar is decided from `exists`, not from a thrown read", () => {
  it("returns MISSING against an io whose every mutating method throws", async () => {
    const store = createSidecarStore(hostileIO(new Map()));

    const result = await store.load(GUID, new Y.Doc());

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.MISSING);
    expect(isSidecarDegraded(result)).toBe(true);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
  });

  it("repeats identically — MISSING is not a one-shot latch", async () => {
    const store = createSidecarStore(hostileIO(new Map()));
    const doc = new Y.Doc();

    const first = await store.load(GUID, doc);
    const second = await store.load(GUID, doc);
    const third = await store.load("some-other-guid", doc);

    for (const result of [first, second, third]) {
      expect(result.degradation).toBe(SIDECAR_DEGRADATION.MISSING);
    }
  });

  it("history without a checkpoint is NOT a degradation", async () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
    doc.getMap("nodes").set("only", { v: 1 });

    const present = new Map<string, Uint8Array>([[sidecarHistoryPath(GUID), frame(updates[0])]]);
    const store = createSidecarStore(hostileIO(present));

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(1);
    expect(revived.getMap("nodes").toJSON()).toEqual({ only: { v: 1 } });
  });

  it("checkpoint without a history is NOT a degradation", async () => {
    const doc = new Y.Doc();
    doc.getMap("nodes").set("compacted", { v: 2 });

    const present = new Map<string, Uint8Array>([
      [sidecarCheckpointPath(GUID), Y.encodeStateAsUpdate(doc)],
    ]);
    const store = createSidecarStore(hostileIO(present));

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(true);
    expect(result.historyEntriesApplied).toBe(0);
    expect(revived.getMap("nodes").toJSON()).toEqual({ compacted: { v: 2 } });
  });

  it("a doc used for a MISSING load is still writable and still empty", async () => {
    const store = createSidecarStore(hostileIO(new Map()));
    const doc = new Y.Doc();
    const seen: unknown[] = [];
    doc.on("update", (u: Uint8Array) => seen.push(u));

    await store.load(GUID, doc);
    expect(seen).toHaveLength(0);

    doc.getArray("later").push([1, 2, 3]);
    expect(doc.getArray("later").toArray()).toEqual([1, 2, 3]);
    expect(seen).toHaveLength(1);
  });
});
