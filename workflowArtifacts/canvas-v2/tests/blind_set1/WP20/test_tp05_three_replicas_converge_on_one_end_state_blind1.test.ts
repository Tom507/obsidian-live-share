// WP20 AC3 blind1 — three replicas with ASYMMETRIC knowledge.
//
// The visible convergence test gives all three replicas the same broken doc and
// lets them audit at the same moment. That is the symmetric case, and it is the
// easy one: every replica computes the same verdict from the same input, so
// even a badly-written merge tends to land on the same answer by accident.
//
// Here each replica sees a DIFFERENT fault first and quarantines it before
// hearing about the other two. Each therefore arrives at the exchange holding
// one quarantine of its own authorship and two records it has never judged. The
// merge has to combine three tombstone maps whose entries were written at the
// SAME Lamport stamp by three different authors, over three different ids —
// which is where an implementation that keys tombstones by anything other than
// the record id, or that resets its stamp per pass, comes apart.
//
// The end state is the UNION of the three faults, quarantined, on all three,
// and the assertion is agreement plus the exact quarantine set — never "the
// value replica 2 wrote is the one that survived". Which client's `by` is
// stored for a given id is a Yjs concurrent-write tie-break on a random
// clientID; every candidate carries the same verdict, so the verdict is
// assertable and the author is not.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "asymmetric.canvas";
const WATCHED = ["anchor", "beacon", "cairn", "ghost-a", "ghost-b", "ghost-c", "span"] as const;

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

function healthyNode(id: string, x: number): Y.Map<unknown> {
  return record({
    id,
    type: "text",
    pos: encodePos(x, 0),
    size: encodeSize(220, 110),
    text: `${id} is fine`,
  });
}

describe("WP20 AC3 blind1 — three replicas that learned different faults converge on their union", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("every replica ends with the same three quarantines and the same file, none of it decided by which client wrote first", async () => {
    // The healthy base every replica already holds.
    const base = new Y.Doc();
    base.transact(() => {
      const nodes = base.getMap<Y.Map<unknown>>("nodes");
      nodes.set("anchor", healthyNode("anchor", 0));
      nodes.set("beacon", healthyNode("beacon", 400));
      nodes.set("cairn", healthyNode("cairn", 800));
      base
        .getMap<Y.Map<unknown>>("edges")
        .set(
          "span",
          record({
            id: "span",
            from: encodeEndpoint("anchor", "right"),
            to: encodeEndpoint("cairn", "left"),
          }),
        );
    });
    const baseUpdate = Y.encodeStateAsUpdate(base);

    // Three faults, each authored by a different absent peer.
    const faults = [
      (doc: Y.Doc) => {
        doc
          .getMap<Y.Map<unknown>>("nodes")
          .set("ghost-a", record({ id: "ghost-a", type: "file", pos: encodePos(0, 500), size: encodeSize(200, 200) }));
      },
      (doc: Y.Doc) => {
        doc
          .getMap<Y.Map<unknown>>("nodes")
          .set("ghost-b", record({ id: "ghost-b", pos: encodePos(400, 500), size: encodeSize(200, 200), text: "no type" }));
      },
      (doc: Y.Doc) => {
        doc
          .getMap<Y.Map<unknown>>("edges")
          .set("ghost-c", record({ id: "ghost-c", to: encodeEndpoint("beacon", "top") }));
      },
    ];
    const faultUpdates = faults.map((mutate) => {
      const carrier = new Y.Doc();
      Y.applyUpdate(carrier, baseUpdate, "peer");
      carrier.transact(() => mutate(carrier));
      return Y.encodeStateAsUpdate(carrier);
    });

    const replicas = [
      await auditingClient(PATH),
      await auditingClient(PATH),
      await auditingClient(PATH),
    ];
    // Replica i learns fault i, and only fault i.
    for (const [index, replica] of replicas.entries()) {
      Y.applyUpdate(replica.doc, faultUpdates[index], "remote");
    }

    audit();

    // Each replica judged exactly the one fault it could see.
    for (const [index, replica] of replicas.entries()) {
      const own = ["ghost-a", "ghost-b", "ghost-c"][index];
      expect(
        isTombstoneQuarantined(readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), own)),
        `replica ${index + 1} did not quarantine the only fault it could see`,
      ).toBe(true);
    }

    // FULL MESH, twice, so a verdict formed on the second round also travels.
    for (let round = 0; round < 2; round += 1) {
      const deltas = replicas.map((replica) => Y.encodeStateAsUpdate(replica.doc));
      for (const replica of replicas) {
        for (const delta of deltas) Y.applyUpdate(replica.doc, delta, "remote");
      }
      audit();
      audit();
    }

    const quarantineSets = replicas.map((replica) =>
      WATCHED.filter((id) =>
        isTombstoneQuarantined(readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), id)),
      ).sort(),
    );
    expect(
      quarantineSets[0],
      "the converged quarantine set is not the union of the three faults",
    ).toEqual(["ghost-a", "ghost-b", "ghost-c"]);
    expect(quarantineSets[1], "replica 2 disagrees with replica 1 about what is quarantined").toEqual(
      quarantineSets[0],
    );
    expect(quarantineSets[2], "replica 3 disagrees with replica 1 about what is quarantined").toEqual(
      quarantineSets[0],
    );

    const entries = replicas.map((replica) =>
      WATCHED.map((id) => readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), id)),
    );
    expect(entries[1], "replica 2's tombstone map differs from replica 1's").toEqual(entries[0]);
    expect(entries[2], "replica 3's tombstone map differs from replica 1's").toEqual(entries[0]);

    const files = replicas.map((replica) => project(replica.doc));
    expect(files[1], "replica 2 projects a different file from replica 1").toBe(files[0]);
    expect(files[2], "replica 3 projects a different file from replica 1").toBe(files[0]);
    const parsed = JSON.parse(files[0]) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(parsed.nodes.map((node) => String(node.id)).sort()).toEqual([
      "anchor",
      "beacon",
      "cairn",
    ]);
    expect(parsed.edges.map((edge) => String(edge.id))).toEqual(["span"]);

    for (const replica of replicas) replica.cs.destroy();
  });
});
