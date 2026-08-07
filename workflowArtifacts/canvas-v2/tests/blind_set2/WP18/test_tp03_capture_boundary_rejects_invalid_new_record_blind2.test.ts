// WP18 AC1 blind2 — the capture boundary, with the OPPOSITE error explicitly
// guarded against.
//
// Wiring a whole-record validator into a FIELD-granular writer has a
// characteristic way of going wrong: applied naively, every partial upsert to
// an existing record is judged as if it were a whole proposal, and ordinary
// edits stop reaching the doc. That failure is silent — the suite still shows
// "invalid records are refused" — so it is asserted here directly.
//
//   ├── a NEW node with `type: ""` is refused (present, and not a type), and
//   └── an EXISTING, valid node still takes an ordinary single-field edit in
//       the very same save.
//
// Passing needs both. Refusing everything fails the second half; refusing
// nothing fails the first.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "edits.canvas";
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

const ANCHOR = { id: "anchor", type: "text", x: 0, y: 0, width: 300, height: 120, text: "original" };
const NEW_BAD = { id: "new-bad", type: "", x: 0, y: 400, width: 300, height: 120, text: "?" };

describe("WP18 AC1 blind2 — capture refuses a malformed NEW record without blocking ordinary edits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the new node with an empty type is refused; the existing node's single-field edit still lands", async () => {
    const vault = createVault({ [PATH]: canvasJson([ANCHOR]) });
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
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    vault.files.set(PATH, canvasJson([{ ...ANCHOR, text: "retyped" }, NEW_BAD]));
    await cs.handleLocalModify(PATH);

    expect(
      nodes.has("new-bad"),
      "a record with an empty `type` was created by the capture path",
    ).toBe(false);
    expect(nodes.get("new-bad"), "a husk container was created for the refused id").toBeUndefined();

    expect(
      nodes.get("anchor")?.get("text"),
      "an ordinary edit to an EXISTING valid record was blocked — the whole-record verdict is being applied to a partial upsert",
    ).toBe("retyped");
    expect(nodes.get("anchor")?.get("id"), "the existing record was damaged by the refusal").toBe(
      "anchor",
    );

    const signature = lines.find((line) => line.includes("new-bad"));
    expect(signature, "no rejection signature was emitted at the capture boundary").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/capture/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    expect(
      lines.filter((line) => line.includes("anchor") && REASON_CODE.test(line)),
      "a rejection was signed for the record that was legitimately edited",
    ).toEqual([]);

    cs.destroy();
  });
});
