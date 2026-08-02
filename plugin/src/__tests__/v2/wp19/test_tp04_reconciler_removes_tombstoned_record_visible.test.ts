// WP19 / AC2, second half — "... and the reconciler removes it from the view."
//
// A tombstone that only the serializer honours is a half-wired tombstone: the
// file would lose the card while the OPEN Obsidian canvas kept showing it, and
// the next save of that view is then a stale surface aimed straight at the
// record the peer just deleted. So the delete has to reach the live view, and
// that happens through exactly two seams:
//
//   ├── `setOnRemoteCanvasUpdate` — the payload handed to the live-view
//   │      reconcile hook on every integrated REMOTE delta, and
//   └── `getCanvasSnapshot` — the authoritative snapshot a freshly mounted view
//          is reconciled against.
//
// Both are `buildCanvasData` call sites, and both must now see the doc's
// `deleted` container. The hook seam has a second requirement hidden in it: a
// remote delete writes ONLY to `deleted`, touching neither `nodes` nor `edges`,
// so a subscription that observes only those two maps never fires at all and the
// deletion never reaches the view. That is what the first assertion pins.
//
// `planReconcile` closes the loop: given a desired snapshot that no longer holds
// the id while the live view still does, the classifier must ask for the
// structural reload — the only branch that can actually remove a card.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { planReconcile } from "../../../canvas/reconcile-plan";
import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "atlas.canvas";

const STAY = { id: "stay", type: "text", x: 0, y: 0, width: 200, height: 100, text: "stay" };
const DROP = { id: "drop", type: "text", x: 300, y: 0, width: 200, height: 100, text: "drop" };
const LINK = { id: "link", fromNode: "stay", fromSide: "right", toNode: "drop", toSide: "left" };

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

function ids(records: Record<string, unknown>[]): unknown[] {
  return records.map((record) => record.id);
}

function idSet(records: Record<string, unknown>[]): Set<string> {
  return new Set(records.map((record) => String(record.id)));
}

describe("WP19 AC2 — a remote tombstone reaches the live view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the live-view hook is called with a snapshot that no longer holds the deleted card, and the snapshot API agrees", async () => {
    const vault = createVault({ [PATH]: canvasJson([STAY, DROP], [LINK]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    const payloads: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] = [];
    cs.setOnRemoteCanvasUpdate((_path, data) => {
      payloads.push(data);
    });

    await cs.subscribe(PATH, "host");
    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    const before = cs.getCanvasSnapshot(PATH);
    if (!before) throw new Error("no pre-delete snapshot — the seed did not run");
    expect(ids(before.nodes).sort()).toEqual(["drop", "stay"]);

    // A peer deletes the card. The delta touches ONLY the `deleted` container.
    const doc2 = new Y.Doc();
    push(doc1, doc2);
    doc2.transact(() => {
      applyTombstoneOp(doc2.getMap<unknown>("deleted"), "drop", {
        t: 1,
        by: "peer-2",
        on: true,
      });
    });
    push(doc2, doc1);

    expect(
      payloads.length,
      "no live-view reconcile ran: a tombstone-only remote delta is invisible to the subscription",
    ).toBeGreaterThan(0);
    const desired = payloads[payloads.length - 1];
    expect(ids(desired.nodes), "the deleted card was still handed to the live view").toEqual([
      "stay",
    ]);

    expect(
      ids(cs.getCanvasSnapshot(PATH)?.nodes ?? []),
      "`getCanvasSnapshot` still reports the tombstoned card as shared truth",
    ).toEqual(["stay"]);

    // The classifier must ask for the reload that actually removes the card.
    expect(
      planReconcile({
        desired,
        lastApplied: before,
        // The live view still holds the card. Edges are matched to `desired` on
        // purpose, so the verdict is driven by the NODE difference alone.
        liveNodeIds: new Set(["stay", "drop"]),
        liveEdgeIds: idSet(desired.edges),
      }),
      "the reconciler did not ask for the structural reload that removes the card from the view",
    ).toBe("structural");

    cs.destroy();
  });
});
