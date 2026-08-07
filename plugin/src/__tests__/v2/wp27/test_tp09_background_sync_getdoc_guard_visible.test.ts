// WP27 / AC4 — `BackgroundSync.setActiveFile` can no longer reach a canvas doc,
// verified by an explicit test rather than by a reachability argument.
//
// READ THIS BEFORE CHANGING AN ASSERTION HERE.
//
// After WP27 a canvas doc is `__canvas__:<guid>`, which collides with no path.
// The naive form of this test — "calling `setActiveFile` with a `.canvas` did
// not return a canvas doc" — is therefore TRUE AGAINST A COMPLETELY UNGUARDED
// CALL SITE. It cannot fail, and it is exactly the vacuity class this project
// has shipped five times. The charter (AC4) says so in as many words: verified
// by an explicit test rather than by a reachability argument.
//
// So the ORACLE HERE IS THE CALL, NOT THE RESULT. The sync-manager double
// records every id ever handed to `getDoc`, and the assertion is that the canvas
// path is not among them.
//
//   ASSERTION                                            PRODUCTION LINE
//   `expect(sync.requested).not.toContain(CANVAS_PATH)`  the guard immediately
//                                                        preceding
//                                                        `this.syncManager.getDoc(oldActive)`
//                                                        in `setActiveFile`
//                                                        (`files/background-sync.ts`)
//
// Delete that guard and this assertion goes red, because the unguarded body
// calls `getDoc(oldActive)` unconditionally for any non-null `oldActive`.
//
// The last `it` is the OVER-GUARD control: `subscribe()` is the announced R10
// text-fallback door (WP33 owns closing it) and must stay open for a `.canvas`.
// Without it, "no canvas path ever reaches getDoc" could be satisfied by
// refusing `.canvas` everywhere, which would silently retire the fallback.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";

const CANVAS_PATH = "boards/board.canvas";
const FIRST_MD = "notes/first.md";
const SECOND_MD = "notes/second.md";

function createHarness() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  const vault = {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as never;
  const syncManager = {
    requested,
    getDoc(docId: string) {
      requested.push(docId);
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  };
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as never;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as never;
  const bg = new BackgroundSync(vault, syncManager as never, manifestManager, fileOpsManager);
  return { bg, syncManager, docs, requested };
}

describe("WP27 AC4 — the bare-path getDoc in setActiveFile is guarded", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switching AWAY from a canvas never asks the sync manager for it", () => {
    const { bg, requested, docs } = createHarness();

    bg.setActiveFile(CANVAS_PATH);
    bg.setActiveFile(FIRST_MD);

    expect(requested).not.toContain(CANVAS_PATH);
    expect(docs.has(CANVAS_PATH)).toBe(false);
    // Not by any spelling: the canonicalised form is the same string here, and
    // the namespaced form must not appear either.
    expect(requested.some((id) => id.includes(".canvas"))).toBe(false);

    bg.destroy();
  });

  it("POSITIVE CONTROL — an ordinary text file IS still asked for", () => {
    const { bg, requested } = createHarness();

    bg.setActiveFile(FIRST_MD);
    bg.setActiveFile(SECOND_MD);

    expect(requested).toContain(FIRST_MD);

    bg.destroy();
  });

  it("both branches in one run, so the absence is an observed refusal", () => {
    const { bg, requested } = createHarness();

    bg.setActiveFile(CANVAS_PATH);
    bg.setActiveFile(FIRST_MD);
    bg.setActiveFile(SECOND_MD);
    bg.setActiveFile(null);

    expect(requested).toEqual([FIRST_MD, SECOND_MD]);

    bg.destroy();
  });

  it("the same refusal seen through a spy on getDoc itself", () => {
    // Stated a second way, through vitest's own call matcher rather than the
    // harness's log, so a mistake in the log wiring cannot hide the guard.
    const { bg, syncManager } = createHarness();
    const spy = vi.spyOn(syncManager, "getDoc");

    bg.setActiveFile(CANVAS_PATH);
    bg.setActiveFile(FIRST_MD);

    expect(spy).not.toHaveBeenCalledWith(CANVAS_PATH);

    bg.destroy();
  });

  it("OVER-GUARD CONTROL — `subscribe()` is still the open R10 door for a .canvas", async () => {
    const { bg, docs } = createHarness();

    await bg.subscribe(CANVAS_PATH);

    expect(docs.has(CANVAS_PATH)).toBe(true);

    bg.destroy();
  });
});
