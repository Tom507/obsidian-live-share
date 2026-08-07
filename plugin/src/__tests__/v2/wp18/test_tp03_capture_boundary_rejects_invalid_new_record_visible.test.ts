// WP18 / AC1 — the THIRD local write boundary: the capture writer
// (`CanvasSync.handleLocalModify` → `applyIntentPlan`, the `CAPTURE_NET`
// input named in the component's Interfaces list).
//
// The seed boundaries are not the only local proposers. A save that introduces
// a BRAND NEW record proposes that whole record to the doc, and AC1 admits no
// exception: an invalid one must not be created, and the refusal must be
// signed with the boundary and the reason.
//
// Deliberately NOT asserted here: which vocabulary the capture path writes.
// This probe pins only that the validator is consulted at this boundary, so it
// stays valid whether or not WP18 also moves capture onto the V2 registers.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// WP19 AC1: deletion became a VALUE, so "the bystander survived" can no longer
// be proved by key presence — a refusal that "spared" a record by tombstoning
// it would still show the key. This is the E2/I11 loss class, so it is pinned
// through suppression and the projection as well.
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "board.canvas";

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

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "existing" };
/** A complete new card the user really drew. */
const CAP_GOOD = { id: "cap-good", type: "text", x: 0, y: 300, width: 200, height: 100, text: "new" };
/** The same card, but the save carries no `type` — WP14 `MISSING_TYPE`. */
const CAP_BAD = { id: "cap-bad", x: 400, y: 300, width: 200, height: 100, text: "malformed" };

describe("WP18 AC1 — the capture writer consults the ingest validator before creating a record", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a type-less new node in a save is never created; the complete new node in the same save is", async () => {
    const vault = createVault({ [PATH]: canvasJson([N1]) });
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

    // The user adds two cards in one save: one complete, one malformed.
    vault.files.set(PATH, canvasJson([N1, CAP_GOOD, CAP_BAD]));
    await cs.handleLocalModify(PATH);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    expect(
      nodes.has("cap-bad"),
      "an invalid LOCAL record was created by the capture path: the validator is not wired here",
    ).toBe(false);
    expect(nodes.get("cap-bad"), "an empty container was created for the rejected id").toBeUndefined();

    expect(nodes.has("cap-good"), "the valid new record was not captured at all").toBe(true);
    expect(nodes.get("cap-good")?.get("id")).toBe("cap-good");
    expect(nodes.get("cap-good")?.get("type")).toBe("text");

    // The pre-existing record is untouched by the refusal.
    expect(nodes.has("n1"), "the refusal took an unrelated record with it").toBe(true);
    // ...and, post-WP19, "untouched" has to mean NOT TOMBSTONED and still on the
    // canvas — key presence alone would survive a refusal that deleted it.
    const deleted = doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "n1")),
      "the refusal TOMBSTONED an unrelated record",
    ).toBe(false);
    expect(
      buildCanvasData(nodes, doc.getMap<Y.Map<unknown>>("edges"), deleted).nodes.map((n) => n.id),
      "the refusal removed an unrelated record from the canvas",
    ).toContain("n1");
    expect(nodes.get("n1")?.get("text"), "the bystander's field values were damaged").toBe(
      "existing",
    );

    const signature = lines.find((line) => line.includes("cap-bad"));
    expect(signature, "no rejection signature was emitted at the capture boundary").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/capture/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    expect(signature ?? "", "the reason is not the one WP14 diagnoses").toContain("MISSING_TYPE");

    cs.destroy();
  });
});
