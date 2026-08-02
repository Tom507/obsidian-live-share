// WP20 AC3 blind2 — the same deltas, delivered in three DIFFERENT ORDERS.
//
// Convergence is not "the replicas agree"; it is "the replicas agree WHATEVER
// order the ops arrived in". A repair pass built on top of a merge that is
// commutative and associative has that property for free, and one that quietly
// depends on arrival order — "the first replica to quarantine an id owns it",
// "skip a record I have already judged this session" — does not, while still
// agreeing perfectly in the one delivery order a test happened to write down.
//
// So the three replicas here receive the identical four deltas, in the three
// rotations of the same sequence, and each audits between every delivery. The
// audit therefore runs against four different intermediate states per replica,
// which is exactly where an order-dependent rule diverges.
//
// The deltas are chosen so the intermediate states genuinely differ: one of
// them REPAIRS a record another one broke, so a replica that receives the
// repair before the damage never quarantines that record at all, while a
// replica that receives them the other way round quarantines it and must then
// release it. Both must finish in the same place.
//
// Nothing here asserts which `by` or which `t` survived: those are decided by a
// Yjs tie-break on a random clientID whenever two replicas wrote the same key
// concurrently. Agreement and the exact quarantine set are the oracles.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "rotations.canvas";
const WATCHED = ["pillar", "lintel", "shard", "rubble", "arch"] as const;

function createVault() {
  const files = new Map<string, string>();
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

function project(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
}

/** `[a, b, c, d]` rotated left by `by`. */
function rotate<T>(items: readonly T[], by: number): T[] {
  return items.map((_, index) => items[(index + by) % items.length]);
}

describe("WP20 AC3 blind2 — the end state does not depend on the order the deltas arrived in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("three replicas fed the same four deltas in three rotations agree on the quarantine set and the file", async () => {
    // ONE authoring peer produces four snapshots of its own growing state. Each
    // is a WHOLE, self-contained update, so any delivery order is legitimate and
    // every order ends at the same document — while the INTERMEDIATE states a
    // replica audits against differ completely between the rotations.
    const author = new Y.Doc();
    const deltas: Uint8Array[] = [];
    const snapshot = () => deltas.push(Y.encodeStateAsUpdate(author));

    author.transact(() => {
      const nodes = author.getMap<Y.Map<unknown>>("nodes");
      nodes.set(
        "pillar",
        record({
          id: "pillar",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 400),
          text: "pillar",
        }),
      );
      nodes.set(
        "lintel",
        record({
          id: "lintel",
          type: "text",
          pos: encodePos(400, 0),
          size: encodeSize(200, 400),
          text: "lintel",
        }),
      );
    });
    snapshot(); // delta 1 — a healthy pair

    author.transact(() => {
      // `shard` is broken on arrival and is REPAIRED by delta 3.
      author
        .getMap<Y.Map<unknown>>("nodes")
        .set("shard", record({ id: "shard", type: "text", pos: encodePos(800, 0) }));
      // `rubble` is broken and stays broken.
      author
        .getMap<Y.Map<unknown>>("nodes")
        .set("rubble", record({ id: "rubble", type: "link", pos: encodePos(1200, 0), size: encodeSize(200, 100) }));
    });
    snapshot(); // delta 2 — two faults

    author.transact(() => {
      const shard = author.getMap<Y.Map<unknown>>("nodes").get("shard");
      shard?.set("size", encodeSize(200, 400));
      shard?.set("text", "shard, mended");
    });
    snapshot(); // delta 3 — the repair

    author.transact(() => {
      author.getMap<Y.Map<unknown>>("edges").set(
        "arch",
        record({
          id: "arch",
          from: encodeEndpoint("pillar", "top"),
          to: encodeEndpoint("lintel", "top"),
        }),
      );
    });
    snapshot(); // delta 4 — a healthy arrow

    const replicas = [
      await auditingClient(PATH),
      await auditingClient(PATH),
      await auditingClient(PATH),
    ];

    // Rotation r for replica r, auditing between every delivery.
    for (const [index, replica] of replicas.entries()) {
      for (const delta of rotate(deltas, index)) {
        Y.applyUpdate(replica.doc, delta, "remote");
        audit();
        audit();
      }
    }
    audit();
    audit();

    const quarantineSets = replicas.map((replica) =>
      WATCHED.filter((id) =>
        isTombstoneQuarantined(readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), id)),
      ).sort(),
    );
    expect(
      quarantineSets[0],
      "only the record that is still broken may end up quarantined",
    ).toEqual(["rubble"]);
    expect(
      quarantineSets[1],
      "replica 2 reached a different quarantine set from the SAME deltas in a different order",
    ).toEqual(quarantineSets[0]);
    expect(
      quarantineSets[2],
      "replica 3 reached a different quarantine set from the SAME deltas in a different order",
    ).toEqual(quarantineSets[0]);

    const files = replicas.map((replica) => project(replica.doc));
    expect(files[1], "replica 2 projects a different file — the audit is order-dependent").toBe(
      files[0],
    );
    expect(files[2], "replica 3 projects a different file — the audit is order-dependent").toBe(
      files[0],
    );
    const parsed = JSON.parse(files[0]) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(
      parsed.nodes.map((node) => String(node.id)).sort(),
      "the repaired record did not survive every arrival order",
    ).toEqual(["lintel", "pillar", "shard"]);
    expect(parsed.edges.map((edge) => String(edge.id))).toEqual(["arch"]);

    for (const replica of replicas) replica.cs.destroy();
  });
});
