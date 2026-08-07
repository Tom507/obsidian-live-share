// WP19 AC2 blind1 — the view-removal seam, attacked through the EDGE id space.
//
// Edges are the half that is easy to leave half-wired, because an edge usually
// disappears for a second reason (its endpoint went away) and that other reason
// masks a missing rule. So here BOTH endpoint nodes stay perfectly visible and
// the tombstone is on the ARROW itself: the only thing that can remove it from
// the live view is the edge's own suppression.
//
// The classifier assertion is set up so the verdict is driven by the EDGE
// difference alone — `liveNodeIds` is matched to what `desired` still holds, so
// a node-driven "structural" cannot be mistaken for the edge rule working.
// `reconcile-plan.ts` treats any edge difference as structural by design (an
// arrow cannot be re-routed by a per-node geometry call), which is exactly the
// branch a removed arrow needs.
//
// A second arrow between the same two cards is the control: an implementation
// that suppressed by endpoint pair rather than by id takes it down too.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { planReconcile } from "../../../canvas/reconcile-plan";
import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "diagrams/pipeline.canvas";

const LEFT = { id: "left", type: "text", x: 0, y: 0, width: 200, height: 100, text: "left" };
const RIGHT = { id: "right", type: "text", x: 700, y: 0, width: 200, height: 100, text: "right" };
const TOP_ARROW = {
  id: "top-arrow",
  fromNode: "left",
  fromSide: "top",
  toNode: "right",
  toSide: "top",
  label: "removed remotely",
};
const LOW_ARROW = {
  id: "low-arrow",
  fromNode: "left",
  fromSide: "bottom",
  toNode: "right",
  toSide: "bottom",
};

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
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

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function ids(records: Record<string, unknown>[]): string[] {
  return records.map((record) => String(record.id));
}

describe("WP19 AC2 blind1 — a remotely tombstoned ARROW leaves the live view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the live-view payload drops only that arrow, keeps both cards, and the classifier asks for a reload", async () => {
    const vault = createVault({ [PATH]: canvasJson([LEFT, RIGHT], [TOP_ARROW, LOW_ARROW]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    const handed: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] = [];
    cs.setOnRemoteCanvasUpdate((_path, data) => {
      handed.push(data);
    });

    await cs.subscribe(PATH, "host");
    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    const lastApplied = cs.getCanvasSnapshot(PATH);
    if (!lastApplied) throw new Error("no pre-delete snapshot — the seed did not run");
    expect(ids(lastApplied.edges).sort()).toEqual(["low-arrow", "top-arrow"]);

    const doc2 = new Y.Doc();
    push(doc1, doc2);
    doc2.transact(() => {
      applyTombstoneOp(doc2.getMap<unknown>("deleted"), "top-arrow", {
        t: 4,
        by: "peer-2",
        on: true,
      });
    });
    push(doc2, doc1);

    expect(
      handed.length,
      "a tombstone-only delta produced no live-view reconcile at all",
    ).toBeGreaterThan(0);
    const desired = handed[handed.length - 1];

    expect(ids(desired.edges), "the tombstoned arrow was still handed to the view").toEqual([
      "low-arrow",
    ]);
    expect(
      ids(desired.nodes).sort(),
      "the arrow's tombstone took its endpoint cards with it",
    ).toEqual(["left", "right"]);

    expect(
      planReconcile({
        desired,
        lastApplied,
        // Nodes matched to `desired` on purpose: only the EDGE difference may
        // drive the verdict here.
        liveNodeIds: new Set(ids(desired.nodes)),
        liveEdgeIds: new Set(["low-arrow", "top-arrow"]),
      }),
      "the classifier did not ask for the reload that removes the arrow from the view",
    ).toBe("structural");

    expect(
      ids(cs.getCanvasSnapshot(PATH)?.edges ?? []),
      "`getCanvasSnapshot` still reports the tombstoned arrow as shared truth",
    ).toEqual(["low-arrow"]);

    cs.destroy();
  });
});
