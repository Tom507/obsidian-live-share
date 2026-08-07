// WP18 AC1 blind1 — same claim as the visible probe (the host seed consults the
// validator and an invalid LOCAL record never reaches the doc), different
// angle: the refused record is an EDGE with only ONE endpoint, not a node, and
// the run also carries a VALID edge so "rejects edges" cannot pass for
// "rejects invalid edges".
//
// An edge is the harder case: its validity core is `id ∧ from.node ∧ to.node`,
// so the failure is a MISSING endpoint rather than a missing scalar, and it is
// the exact record shape that used to reach every peer and then vanish there.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "wiring.canvas";
const REASON_CODE = /\b(MISSING|INVALID)_[A-Z_]+\b/;

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

const A = { id: "a", type: "text", x: 0, y: 0, width: 120, height: 60, text: "left" };
const B = { id: "b", type: "text", x: 400, y: 0, width: 120, height: 60, text: "right" };
const GOOD_EDGE = { id: "wire-ok", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" };
/** Half an edge: `from` is whole, `to` was never written. */
const HALF_EDGE = { id: "wire-half", fromNode: "a", fromSide: "bottom" };

describe("WP18 AC1 blind1 — a half-connected edge in the host's file is refused at the seed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the endpoint-less edge never enters the doc while the complete edge does", async () => {
    const vault = createVault({ [PATH]: canvasJson([A, B], [GOOD_EDGE, HALF_EDGE]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    const lines: string[] = [];
    cs.setLogger({
      debug: (_c: string, m: string) => lines.push(m),
      warn: (_c: string, m: string) => lines.push(m),
    });

    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    expect(
      edges.has("wire-half"),
      "an edge with one endpoint reached the doc: the seed does not consult the validator",
    ).toBe(false);
    expect(edges.get("wire-half"), "an empty container was left under the refused id").toBeUndefined();
    expect(edges.has("wire-ok"), "the valid edge was refused as well").toBe(true);
    expect(
      [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the edge refusal took the nodes with it",
    ).toEqual(["a", "b"]);

    const signature = lines.find((line) => line.includes("wire-half"));
    expect(signature, "no rejection signature was emitted for the refused edge").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    expect(signature ?? "", "the reason does not identify the missing endpoint").toMatch(
      /MISSING_(FROM|TO)\b/,
    );

    cs.destroy();
  });
});
