// WP25 / AC3 blind2 (the discriminating half) — "a compaction never changes the
// doc's observable state", asked of THREE REPLICAS instead of one.
//
// The visible test compares one doc before and after; blind1 runs a control
// replica alongside a compacted one. This one compacts a DIFFERENT replica of
// the same board in each arm and then merges all three, because "never reason
// from two peers only": with three replicas there are interleavings — A
// compacted, B compacted, neither compacted — that a two-replica setup cannot
// produce.
//
// The claim is then stated in the only form that is true of a CRDT: every
// replica, whichever of them compacted, ends at the SAME PROJECTION. Not the
// same encoding (compaction changes that, by definition) and not a specific
// winner for any contested key (Yjs breaks same-key ties on `clientID`, which is
// `random.uint32()`).
//
// And the anti-vacuity half is carried in every arm: the compaction is required
// to have removed something, and the pre-compaction projection is required to be
// non-trivial — a board with nothing to collect proves nothing about a
// collector.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  DELETED_MAP_NAME,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const HORIZON = 7;

function memoryIO(): SidecarIO {
  const files = new Map<string, Uint8Array>();
  return {
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

function projection(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
}

function visibleIds(doc: Y.Doc): { nodes: string[]; edges: string[] } {
  const parsed = JSON.parse(projection(doc)) as {
    nodes: { id: string }[];
    edges: { id: string }[];
  };
  return {
    nodes: parsed.nodes.map((n) => n.id).sort(),
    edges: parsed.edges.map((e) => e.id).sort(),
  };
}

/** One board, authored on `origin`, with real garbage and real survivors. */
function authorBoard(origin: Y.Doc): void {
  origin.transact(() => {
    const nodes = origin.getMap<Y.Map<unknown>>("nodes");
    const edges = origin.getMap<Y.Map<unknown>>("edges");
    for (const id of ["n-a", "n-b", "n-gone-1", "n-gone-2", "n-hidden"]) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      for (const [k, v] of Object.entries({
        id,
        type: "text",
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        text: `card ${id}`,
      })) {
        record.set(k, v);
      }
    }
    for (const [id, from, to] of [
      ["e-ab", "n-a", "n-b"],
      ["e-a-gone", "n-a", "n-gone-1"],
    ] as const) {
      const record = new Y.Map<unknown>();
      edges.set(id, record);
      record.set("id", id);
      record.set("fromNode", from);
      record.set("toNode", to);
    }
    const deleted = origin.getMap<unknown>(DELETED_MAP_NAME);
    deleted.set("n-gone-1", { t: 1, by: "peer-a", on: true });
    deleted.set("n-gone-2", { t: 2, by: "peer-a", on: true });
    deleted.set("n-hidden", { t: 120, by: "peer-b", on: true });
    deleted.set("n-a", { t: 121, by: "peer-b", on: false });
  });
}

/** Three replicas of the same board, fully merged. */
function threeReplicas(): Y.Doc[] {
  const origin = new Y.Doc();
  authorBoard(origin);
  const state = Y.encodeStateAsUpdate(origin);
  origin.destroy();
  return [0, 1, 2].map(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc;
  });
}

function exchange(docs: Y.Doc[]): void {
  for (let round = 0; round < 2; round++) {
    for (const from of docs) {
      for (const to of docs) {
        if (from === to) continue;
        Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
      }
    }
  }
}

describe("WP25 AC3 blind2 — whichever replica compacted, all three agree", () => {
  it("the board is non-trivial before anything is compacted (premise)", () => {
    const [doc] = threeReplicas();
    expect(visibleIds(doc)).toEqual({ nodes: ["n-a", "n-b"], edges: ["e-ab"] });
    expect([...doc.getMap<unknown>(DELETED_MAP_NAME).keys()].length).toBe(4);
    doc.destroy();
  });

  for (const compactor of [0, 1, 2]) {
    it(`replica ${compactor} compacts and all three converge to one projection`, async () => {
      const docs = threeReplicas();
      const before = visibleIds(docs[0]);
      const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
        horizonTicks: HORIZON,
      });
      const guid = `aa00bb11cc22dd33ee44ff5566778${compactor}9`;
      lifecycle.attach(guid, docs[compactor]);
      await settle();

      const result = await lifecycle.compact(guid, docs[compactor]);
      await settle();

      // Anti-vacuity: something really was collected.
      expect(
        [...result.removedTombstoneIds].sort(),
        "the compaction collected nothing, so convergence proves nothing",
      ).toEqual(["n-gone-1", "n-gone-2"]);

      // Nothing the compactor can see moved.
      expect(visibleIds(docs[compactor])).toEqual(before);

      exchange(docs);

      const projections = docs.map(projection);
      expect(projections[1], "replica 1 diverged after the merge").toBe(projections[0]);
      expect(projections[2], "replica 2 diverged after the merge").toBe(projections[0]);
      expect(visibleIds(docs[0])).toEqual(before);

      await lifecycle.destroy();
      for (const doc of docs) doc.destroy();
    });
  }

  it("two replicas compacting independently still converge", async () => {
    // The interleaving a two-replica setup cannot produce: two clients collect
    // the same ids at the same time and each other's removals then arrive as
    // deletes of things already deleted.
    const docs = threeReplicas();
    const before = visibleIds(docs[0]);
    const lifecycles = [0, 1].map(() =>
      createSidecarLifecycle(createSidecarStore(memoryIO()), { horizonTicks: HORIZON }),
    );
    lifecycles[0].attach("aa11", docs[0]);
    lifecycles[1].attach("bb22", docs[1]);
    await settle();

    const first = await lifecycles[0].compact("aa11", docs[0]);
    const second = await lifecycles[1].compact("bb22", docs[1]);
    await settle();

    expect([...first.removedTombstoneIds].sort()).toEqual(["n-gone-1", "n-gone-2"]);
    expect([...second.removedTombstoneIds].sort()).toEqual(["n-gone-1", "n-gone-2"]);

    exchange(docs);

    expect(projection(docs[1])).toBe(projection(docs[0]));
    expect(projection(docs[2])).toBe(projection(docs[0]));
    expect(visibleIds(docs[0])).toEqual(before);

    for (const lifecycle of lifecycles) await lifecycle.destroy();
    for (const doc of docs) doc.destroy();
  });
});
