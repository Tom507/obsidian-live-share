// WP24 / AC2 blind2 — reconstruction across THREE replicas, each with its own
// sidecar, reloaded and then re-synced.
//
// Different angle: the visible test reconstructs one replica; blind1 does it
// with nested types. Here three peers each keep their own sidecar (three
// guids... no — one guid, three separate stores over three separate disks, the
// way three clients on three machines actually work). Each one is unloaded and
// reloaded from its OWN sidecar, and only then do they exchange state. If a
// store loses a replica's own contribution — the classic "the checkpoint was
// taken from the wrong doc" or "only remote updates were captured" bug — the
// three no longer converge on the union, and the missing records name the
// culprit.
//
// The BUILD_SPEC's flaky-pattern list forbids reasoning from two peers only;
// three is the smallest number with distinct interleaving classes.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-three-replicas";

function makeStore() {
  const disk = new Map<string, Uint8Array>();
  const io = {
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
  return { disk, store: createSidecarStore(io) };
}

interface Replica {
  doc: Y.Doc;
  pending: Uint8Array[];
  store: ReturnType<typeof createSidecarStore>;
}

function newReplica(): Replica {
  const doc = new Y.Doc();
  const pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => pending.push(Uint8Array.from(u)));
  return { doc, pending, store: makeStore().store };
}

async function persist(replica: Replica): Promise<void> {
  for (const update of replica.pending.splice(0)) await replica.store.append(GUID, update);
}

function exchange(replicas: Replica[]): void {
  for (const from of replicas) {
    for (const to of replicas) {
      if (from === to) continue;
      Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)));
    }
  }
}

describe("WP24 AC2 blind2 — three replicas, three sidecars, one truth", () => {
  it("each replica reloads its own contribution and the union survives", async () => {
    const replicas = [newReplica(), newReplica(), newReplica()];

    // Round 1: everyone works alone, then everyone syncs.
    replicas[0].doc.getMap("nodes").set("a1", { owner: 0 });
    replicas[1].doc.getMap("nodes").set("b1", { owner: 1 });
    replicas[2].doc.getMap("nodes").set("c1", { owner: 2 });
    for (const replica of replicas) await persist(replica);
    exchange(replicas);
    for (const replica of replicas) await persist(replica);

    // Round 2: one more local edit each, persisted but NOT yet exchanged.
    replicas[0].doc.getMap("nodes").set("a2", { owner: 0 });
    replicas[1].doc.getMap("nodes").delete("c1");
    replicas[2].doc.getMap("nodes").set("c2", { owner: 2 });
    for (const replica of replicas) await persist(replica);

    // Everyone unloads and comes back from disk only.
    const revived: Y.Doc[] = [];
    for (const [index, replica] of replicas.entries()) {
      const doc = new Y.Doc();
      const result = await replica.store.load(GUID, doc);
      expect(result.degradation, `replica ${index}`).toBe(SIDECAR_DEGRADATION.NONE);
      expect(doc.getMap("nodes").toJSON(), `replica ${index} lost its own state`).toEqual(
        replica.doc.getMap("nodes").toJSON(),
      );
      expect(Y.encodeStateVector(doc), `replica ${index} lost clock entries`).toEqual(
        Y.encodeStateVector(replica.doc),
      );
      revived.push(doc);
    }

    // …and only now do they meet again.
    const rejoined = revived.map((doc, index) => ({
      doc,
      pending: [],
      store: replicas[index].store,
    }));
    exchange(rejoined);

    const keys = rejoined.map((r) => Object.keys(r.doc.getMap("nodes").toJSON()).sort());
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[1]).toEqual(keys[2]);
    expect(keys[0]).toEqual(["a1", "a2", "b1", "c2"]);
  });

  it("a replica that only ever RECEIVED updates still reconstructs them", async () => {
    // The "only local updates are captured" bug: a store wired to a local-write
    // hook rather than to the doc's update event persists nothing here.
    const receiver = newReplica();
    const author = new Y.Doc();
    author.getMap("nodes").set("remote-only", { from: "peer" });
    Y.applyUpdate(receiver.doc, Y.encodeStateAsUpdate(author));
    await persist(receiver);

    const revived = new Y.Doc();
    const result = await receiver.store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBeGreaterThan(0);
    expect(revived.getMap("nodes").toJSON()).toEqual({ "remote-only": { from: "peer" } });
  });

  it("a compaction on one replica does not change what the other two see", async () => {
    const replicas = [newReplica(), newReplica(), newReplica()];
    for (const [index, replica] of replicas.entries()) {
      replica.doc.getMap("nodes").set(`k${index}`, { index });
      await persist(replica);
    }
    exchange(replicas);
    for (const replica of replicas) await persist(replica);

    await replicas[1].store.checkpoint(GUID, replicas[1].doc);

    const loaded: string[] = [];
    for (const replica of replicas) {
      const doc = new Y.Doc();
      await replica.store.load(GUID, doc);
      loaded.push(JSON.stringify(Object.keys(doc.getMap("nodes").toJSON()).sort()));
    }

    expect(new Set(loaded).size).toBe(1);
    expect(JSON.parse(loaded[0])).toEqual(["k0", "k1", "k2"]);
  });
});
