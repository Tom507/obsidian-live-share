// WP18 / AC1 — "Every local write boundary consults the validator before
// writing; an invalid local record never reaches the doc and produces a
// rejection signature naming the boundary and the reason."
//
// Boundary under test: the HOST SEED (`CanvasSync.subscribe(path, "host")` →
// `applyCanvasToYMaps`). The host's own `.canvas` file is a LOCAL proposal, so
// WP14's verdict carries `reject: true` for anything that fails the schema.
//
// The oracle is STATE: the invalid record must not be in the doc afterwards,
// and its valid sibling must be. The signature is asserted only as the
// secondary check the AC explicitly names (boundary + reason).
//
// The invalid record is a node with NO `type`. That failure mode is spelt the
// same way in the file vocabulary and in the V2 register vocabulary
// (`V2_FIELD.type === "type"`), so this probe cannot be satisfied or defeated
// by which shape the seed happens to write — it isolates the validator wiring.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "board.canvas";

/** Any WP14 reason code, as it would appear inside a signature line. */
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

async function runHostSeed(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const lines: string[] = [];
  cs.setLogger({
    debug: (_c: string, m: string) => lines.push(m),
    warn: (_c: string, m: string) => lines.push(m),
  });
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  await cs.subscribe(PATH, "host");
  return { cs, doc, lines };
}

const VALID_NODE = {
  id: "n-ok",
  type: "text",
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  text: "keep me",
};
/** Same geometry, no `type` — WP14 `MISSING_TYPE`. */
const TYPELESS_NODE = { id: "n-bad", x: 400, y: 20, width: 200, height: 100, text: "drop me" };

describe("WP18 AC1 — the host seed consults the ingest validator before writing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a type-less node in the host's file never reaches the doc, while its valid sibling does", async () => {
    const seeded = await runHostSeed(canvasJson([VALID_NODE, TYPELESS_NODE]));
    const nodes = seeded.doc.getMap<Y.Map<unknown>>("nodes");

    // Primary oracle — state.
    expect(
      nodes.has("n-bad"),
      "an invalid LOCAL record reached the doc: the seed boundary does not consult the validator",
    ).toBe(false);
    expect(
      nodes.has("n-ok"),
      "the valid sibling was dropped too — the boundary rejects wholesale rather than per record",
    ).toBe(true);

    // Not merely emptied: no husk container is left behind under the id either.
    expect(nodes.get("n-bad"), "an empty container was created for the rejected id").toBeUndefined();

    // Secondary — the signature the AC names by hand: boundary + reason.
    const signature = seeded.lines.find((line) => line.includes("n-bad"));
    expect(signature, "no rejection signature was emitted for the refused record").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    expect(signature ?? "", "the reason is not the one WP14 diagnoses").toContain("MISSING_TYPE");

    seeded.cs.destroy();
  });
});
