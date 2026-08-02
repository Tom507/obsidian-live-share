// WP27 / AC4 blind1 — the `setActiveFile` guard, attacked with a LONG SWITCH
// CHAIN whose expected call log is compared whole.
//
// Different angle: instead of one canvas-to-markdown transition checked with
// `not.toContain`, this drives eight transitions (markdown, canvas, canvas,
// markdown, null, markdown) and compares the ORDERED list of ids handed to
// `getDoc` against the exact expected sequence. That single assertion is
// bidirectional: an implementation that guards nothing has extra entries, and
// one that guards everything has too few.
//
// The oracle is the CALL LOG and not the returned handle, because after WP27 a
// bare `.canvas` names no canvas doc and "no canvas doc came back" is true of an
// unguarded call site too — the vacuity this AC exists to avoid.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";

const MD_A = "log/a.md";
const MD_B = "log/b.md";
const MD_C = "log/c.md";
const CANVAS_A = "log/a.canvas";
const CANVAS_B = "log/deep/b.canvas";

function harness() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  const vault = {
    // EVERY path in the corpus exists on this disk, canvases included. If the
    // canvases were absent, `setActiveFile`'s manifest branch would skip them
    // for a reason that has nothing to do with the guard, and the third test
    // below would pass vacuously.
    getAbstractFileByPath: vi.fn((p: string) => {
      const f = new TFile();
      f.path = p;
      return f;
    }),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  };
  const syncManager = {
    requested,
    getDoc(id: string) {
      requested.push(id);
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  };
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  };
  const bg = new BackgroundSync(
    vault as never,
    syncManager as never,
    manifestManager as never,
    fileOpsManager as never,
  );
  return { bg, requested, docs, manifestManager };
}

describe("WP27 AC4 blind1 — a switch chain, compared as one call log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the ordered getDoc log matches exactly", () => {
    const { bg, requested } = harness();

    // Each call makes the PREVIOUS value the `oldActive` that reaches getDoc.
    bg.setActiveFile(MD_A); // old = null       -> no call
    bg.setActiveFile(CANVAS_A); // old = MD_A      -> MD_A
    bg.setActiveFile(CANVAS_B); // old = CANVAS_A  -> guarded
    bg.setActiveFile(MD_B); // old = CANVAS_B  -> guarded
    bg.setActiveFile(MD_B); // unchanged       -> no call
    bg.setActiveFile(null); // old = MD_B      -> MD_B
    bg.setActiveFile(MD_C); // old = null      -> no call
    bg.setActiveFile(null); // old = MD_C      -> MD_C

    expect(requested).toEqual([MD_A, MD_B, MD_C]);

    bg.destroy();
  });

  it("no document is ever created under a canvas path", () => {
    const { bg, docs } = harness();

    bg.setActiveFile(CANVAS_A);
    bg.setActiveFile(CANVAS_B);
    bg.setActiveFile(MD_A);
    bg.setActiveFile(null);

    expect([...docs.keys()].filter((k) => k.endsWith(".canvas"))).toEqual([]);

    bg.destroy();
  });

  it("switching away from a canvas publishes no manifest update", () => {
    const { bg, manifestManager } = harness();

    bg.setActiveFile(CANVAS_A);
    bg.setActiveFile(MD_A);

    expect(manifestManager.updateFile).not.toHaveBeenCalled();

    // POSITIVE CONTROL — leaving a markdown file still does reach the manifest
    // path, so the absence above is a refusal and not a dead branch.
    bg.setActiveFile(MD_B);
    expect(manifestManager.updateFile).toHaveBeenCalled();

    bg.destroy();
  });

  it("OVER-GUARD CONTROL — the R10 text door is still open for a .canvas", async () => {
    const { bg, docs } = harness();

    await bg.subscribe(CANVAS_A);

    expect(docs.has(CANVAS_A)).toBe(true);

    bg.destroy();
  });
});
