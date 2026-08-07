// WP18 / AC3 — "Partial observation produces upserts only — no local write path
// deletes a doc key that is merely absent from the incoming record (I7)."
//
// This is the surface the charter's amendment note leaves for WP18: the HOST
// SEED (`CanvasSync.subscribe(path, "host")` → `applyCanvasToYMaps` →
// `applyToYMap`), where a doc key the incoming file record does not mention is
// still deleted unless `PROTECTED_KEYS` happens to shield it.
//
// The probe therefore uses keys the guard does NOT shield — `color`,
// `background`, an edge's `color` — because those are the keys whose deletion
// is live today and which AC3 abolishes. A guard-membership question is
// deliberately not what decides this test: after WP18 the answer must be "no
// key is deleted", not "the right list of keys is protected".
//
// Two things are asserted together, so a boundary that simply stopped writing
// cannot pass: the omitted keys SURVIVE and the file's own values LAND.
//
// What is NOT asserted: that a whole RECORD absent from the host's file
// survives. Record-level re-seed destruction is C29/WP29's to retire; AC3 is
// about KEYS.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "board.canvas";

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

function seedRecord(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  container.set(id, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

/** The file's picture of the board: valid, but WITHOUT the doc's extra keys. */
const FILE_N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "new" };
const FILE_N2 = { id: "n2", type: "text", x: 400, y: 0, width: 200, height: 100, text: "peer" };
const FILE_E1 = {
  id: "e1",
  fromNode: "n1",
  fromSide: "right",
  toNode: "n2",
  toSide: "left",
  label: "new",
};

describe("WP18 AC3 — the seed upserts and never deletes a key the file omitted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys the host's file does not mention survive the seed, while the keys it does mention land", async () => {
    const vault = createVault({ [PATH]: canvasJson([FILE_N1, FILE_N2], [FILE_E1]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    // The doc already holds richer records than the file does — a peer set the
    // colour and the background, and neither is in this client's file.
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      seedRecord(nodes, "n1", {
        id: "n1",
        type: "text",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        text: "old",
        color: "3",
        background: "assets/card.png",
      });
      seedRecord(nodes, "n2", {
        id: "n2",
        type: "text",
        x: 400,
        y: 0,
        width: 200,
        height: 100,
        text: "peer",
      });
      seedRecord(edges, "e1", {
        id: "e1",
        fromNode: "n1",
        fromSide: "right",
        toNode: "n2",
        toSide: "left",
        label: "old",
        color: "5",
      });
    });

    await cs.subscribe(PATH, "host");

    const n1 = doc.getMap<Y.Map<unknown>>("nodes").get("n1");
    const e1 = doc.getMap<Y.Map<unknown>>("edges").get("e1");
    expect(n1, "the seed removed the node record entirely").toBeDefined();
    expect(e1, "the seed removed the edge record entirely").toBeDefined();

    // WP64 — post-WP19 a removal instruction IS a tombstone, so "the seed did
    // not remove the record" can no longer be spelled as key presence: a seed
    // that tombstoned both records would satisfy every assertion below.
    const deleted = doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "n1")),
      "the seed TOMBSTONED the node because the file omitted it (I7)",
    ).toBe(false);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "e1")),
      "the seed TOMBSTONED the edge because the file omitted it (I7)",
    ).toBe(false);
    const projected = buildCanvasData(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      deleted,
    );
    expect(
      projected.nodes.map((n) => n.id),
      "the seed removed the node from the canvas (I7)",
    ).toContain("n1");
    expect(
      projected.edges.map((e) => e.id),
      "the seed removed the edge from the canvas (I7)",
    ).toContain("e1");

    // I7 — absence in the observation is not a removal instruction.
    expect(n1?.get("color"), "the seed deleted `color` because the file omitted it (I7)").toBe("3");
    expect(
      n1?.get("background"),
      "the seed deleted `background` because the file omitted it (I7)",
    ).toBe("assets/card.png");
    expect(e1?.get("color"), "the seed deleted an edge key the file omitted (I7)").toBe("5");

    // ... and the merge genuinely ran, so the survival above is not the result
    // of the seed doing nothing at all.
    expect(n1?.get("text"), "the file's own value never reached the doc").toBe("new");
    expect(e1?.get("label"), "the file's own edge value never reached the doc").toBe("new");

    cs.destroy();
  });
});
