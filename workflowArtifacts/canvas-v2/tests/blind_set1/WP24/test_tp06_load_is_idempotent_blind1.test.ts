// WP24 / AC2 blind1 — idempotence, attacked by loading FIVE times and by
// checking the disk rather than the doc.
//
// Different angle: the visible test loads twice and compares snapshots. Here
// the load is repeated five times with an unrelated `append` interleaved
// between rounds, and the invariant is stated over the DISK — total sidecar
// byte count may only change when the test itself appends, never as a
// side effect of a load. A store that re-persists what it reconstructed is
// invisible to any doc-shaped oracle and grows the file by a full state on
// every open; five rounds make that unmissable.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-idempotent";

function makeIO() {
  const disk = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    disk,
    writes,
    totalBytes: (): number => [...disk.values()].reduce((sum, b) => sum + b.length, 0),
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      writes.push(`write ${p}`);
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      writes.push(`append ${p}`);
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      writes.push(`truncate ${p}`);
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      writes.push(`remove ${p}`);
      disk.delete(p);
    },
  };
}

async function seed(store: ReturnType<typeof createSidecarStore>, doc: Y.Doc, updates: Uint8Array[]) {
  for (const update of updates.splice(0)) await store.append(GUID, update);
}

describe("WP24 AC2 blind1 — five loads change nothing on disk", () => {
  it("total sidecar bytes are constant across five consecutive loads", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
    doc.getMap("nodes").set("x", { v: 1 });
    doc.getMap("nodes").set("y", { v: 2 });
    await seed(store, doc, updates);
    await store.checkpoint(GUID, doc);
    doc.getMap("nodes").set("z", { v: 3 });
    await seed(store, doc, updates);

    const baseline = io.totalBytes();
    io.writes.length = 0;

    const target = new Y.Doc();
    for (let round = 0; round < 5; round++) {
      const result = await store.load(GUID, target);
      expect(result.historyEntriesApplied).toBe(1);
      expect(io.totalBytes()).toBe(baseline);
    }

    expect(io.writes).toEqual([]);
    expect(io.disk.has(sidecarHistoryPath(GUID))).toBe(true);
    expect(io.disk.has(sidecarCheckpointPath(GUID))).toBe(true);
  });

  it("a load between two appends neither swallows nor duplicates the appends", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));

    doc.getMap("nodes").set("a", { v: 1 });
    await seed(store, doc, updates);
    const afterOne = await store.load(GUID, new Y.Doc());

    doc.getMap("nodes").set("b", { v: 2 });
    await seed(store, doc, updates);
    const afterTwo = await store.load(GUID, new Y.Doc());

    doc.getMap("nodes").set("c", { v: 3 });
    await seed(store, doc, updates);
    const afterThree = await store.load(GUID, new Y.Doc());

    expect([
      afterOne.historyEntriesApplied,
      afterTwo.historyEntriesApplied,
      afterThree.historyEntriesApplied,
    ]).toEqual([1, 2, 3]);
  });

  it("loading the same sidecar into ten fresh docs yields ten identical replicas", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
    for (let i = 0; i < 6; i++) doc.getMap("nodes").set(`n${i}`, { i });
    doc.getMap("nodes").delete("n3");
    await seed(store, doc, updates);

    const signatures = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const replica = new Y.Doc();
      await store.load(GUID, replica);
      const nodes = replica.getMap("nodes").toJSON() as Record<string, unknown>;
      signatures.add(
        JSON.stringify([
          [...Y.encodeStateVector(replica)],
          Object.keys(nodes)
            .sort()
            .map((key) => [key, nodes[key]]),
        ]),
      );
    }

    expect(signatures.size).toBe(1);
  });
});
