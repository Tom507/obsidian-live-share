// WP18 AC1 blind2 — the host seed consults the validator, exercised on the two
// failure modes that are ILL-TYPED rather than ABSENT.
//
// WP14 separates "the key was never written" from "the key holds something
// that is not a value of this kind", and the second is the one a boundary is
// most likely to wave through: the key IS there, so a presence check passes.
//
//   ├── `type: ""`  — present, and not a type. An empty string is how a type
//   │                 VANISHES, and a node without a real type is skipped by
//   │                 Obsidian's importer along with every edge touching it.
//   └── `y: "40"`   — present, and not a coordinate. Half a numeric pair is not
//                     a position, so no register can be built from it.
//
// One fully valid node shares the file and must be seeded, so the boundary is
// shown to discriminate rather than to refuse a file wholesale.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "typed.canvas";
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

const SOUND = { id: "sound", type: "text", x: 0, y: 0, width: 150, height: 80, text: "fine" };
const EMPTY_TYPE = { id: "empty-type", type: "", x: 200, y: 0, width: 150, height: 80, text: "?" };
const STRING_Y = {
  id: "string-y",
  type: "text",
  x: 400,
  y: "40",
  width: 150,
  height: 80,
  text: "?",
};

describe("WP18 AC1 blind2 — ill-typed local records are refused at the host seed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an empty `type` and a non-numeric coordinate are both refused; the sound node is seeded", async () => {
    const vault = createVault({ [PATH]: canvasJson([SOUND, EMPTY_TYPE, STRING_Y]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    const lines: string[] = [];
    cs.setLogger({
      debug: (_c: string, m: string) => lines.push(m),
      warn: (_c: string, m: string) => lines.push(m),
    });

    await cs.subscribe(PATH, "host");
    const nodes = syncManager.getDoc(`__canvas__:${PATH}`).doc.getMap<Y.Map<unknown>>("nodes");

    expect(
      [...nodes.keys()],
      "the host seed did not refuse exactly the two ill-typed records",
    ).toEqual(["sound"]);
    expect(nodes.get("sound")?.get("text"), "the surviving node lost its payload").toBe("fine");

    for (const refused of ["empty-type", "string-y"]) {
      const signature = lines.find((line) => line.includes(refused));
      expect(signature, `no rejection signature was emitted for \`${refused}\``).toBeDefined();
      expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
      expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    }

    // The diagnosis distinguishes the two failures rather than merging them.
    const typeLine = lines.find((line) => line.includes("empty-type")) ?? "";
    const posLine = lines.find((line) => line.includes("string-y")) ?? "";
    expect(typeLine).toMatch(/\bINVALID_TYPE\b/);
    expect(posLine).toMatch(/\b(MISSING|INVALID)_POS\b/);

    cs.destroy();
  });
});
