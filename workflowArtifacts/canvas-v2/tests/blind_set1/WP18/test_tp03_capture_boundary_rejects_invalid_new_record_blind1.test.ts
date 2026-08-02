// WP18 AC1 blind1 — the capture boundary (`CAPTURE_NET`), exercised on EDGES
// rather than nodes.
//
// The visible probe refuses a type-less node. This one refuses an edge the
// save introduces with only one endpoint, and accepts a complete new edge from
// the very same save — so the boundary is shown to discriminate per record,
// not per save.
//
// Nothing here asserts which vocabulary the capture path writes; only that the
// validator decides whether a proposed NEW record is created at all.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "flow.canvas";
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

const P = { id: "p", type: "text", x: 0, y: 0, width: 100, height: 50, text: "p" };
const Q = { id: "q", type: "text", x: 300, y: 0, width: 100, height: 50, text: "q" };
const R = { id: "r", type: "text", x: 600, y: 0, width: 100, height: 50, text: "r" };

describe("WP18 AC1 blind1 — the capture writer refuses a half-connected new edge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the endpoint-less new edge is not created; the complete new edge from the same save is", async () => {
    const vault = createVault({ [PATH]: canvasJson([P, Q, R]) });
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

    // One save draws two arrows: one finished, one dropped mid-drag.
    vault.files.set(
      PATH,
      canvasJson(
        [P, Q, R],
        [
          { id: "arrow-ok", fromNode: "p", fromSide: "right", toNode: "q", toSide: "left" },
          { id: "arrow-dangling", toNode: "r", toSide: "left" },
        ],
      ),
    );
    await cs.handleLocalModify(PATH);

    const edges = doc.getMap<Y.Map<unknown>>("edges");

    expect(
      edges.has("arrow-dangling"),
      "the capture path created an edge with one endpoint — the validator is not wired here",
    ).toBe(false);
    expect(edges.get("arrow-dangling"), "an empty container was created for the refused id").toBeUndefined();
    expect(edges.has("arrow-ok"), "the complete new edge was never captured").toBe(true);
    expect(edges.get("arrow-ok")?.get("id")).toBe("arrow-ok");

    const signature = lines.find((line) => line.includes("arrow-dangling"));
    expect(signature, "no rejection signature was emitted at the capture boundary").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/capture/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);

    cs.destroy();
  });
});
