// WP27 / AC4 — `CollabManager.activateForFile` can no longer reach a canvas doc.
//
// Same reasoning as tp09 and the same trap: after WP27 a bare `.canvas` path
// names no canvas doc, so "no canvas doc came back" is true of an unguarded call
// site too. The oracle is again the CALL.
//
//   ASSERTION                                              PRODUCTION LINE
//   `expect(syncManager.getDoc).not.toHaveBeenCalledWith(  the guard immediately
//      CANVAS_PATH)`                                        preceding
//                                                           `const docHandle =
//                                                            syncManager.getDoc(filePath)`
//                                                           in `activateForFile`
//                                                           (`editor/collab.ts`)
//   `expect(reconfigureCalls).toContainEqual([])` and       the same guard's
//   no `yCollab-extension` in the last reconfigure          early return
//
// Remove that guard and the first assertion goes red because the unguarded body
// calls `getDoc(filePath)` for every non-empty path; the second goes red because
// the mock returns a handle and `yCollab` is then installed on it — a raw
// `Y.Text` binding over a document `CanvasSync` owns, which is R5 itself.
//
// The codemirror / yjs module mocks below mirror the ones the pre-existing
// `collab.test.ts` already uses. They are duplicated rather than shared because
// a `vi.mock` factory is hoisted per test FILE and this WP may not edit a
// pre-existing test.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("yjs", () => ({
  createRelativePositionFromTypeIndex: vi.fn((_type: unknown, index: number) => ({
    type: null,
    tname: null,
    item: null,
    index,
  })),
}));

vi.mock("y-codemirror.next", () => ({
  yCollab: vi.fn(() => ["yCollab-extension"]),
}));

const reconfigureCalls: unknown[] = [];

vi.mock("@codemirror/state", () => {
  class MockCompartment {
    of(ext: unknown) {
      return { type: "compartment-of", value: ext };
    }
    reconfigure(ext: unknown) {
      reconfigureCalls.push(ext);
      return { type: "reconfigure", value: ext };
    }
  }
  return {
    Compartment: MockCompartment,
    EditorState: { readOnly: { of: (val: boolean) => ({ readOnly: val }) } },
    RangeSet: { empty: [], of: (ranges: unknown[]) => ranges },
    StateEffect: { define: () => ({ of: (val: unknown) => ({ type: "state-effect", value: val }) }) },
    StateField: { define: () => "mock-state-field" },
    Transaction: { remote: "remote" },
  };
});

vi.mock("@codemirror/view", () => {
  class MockGutterMarker {
    range(from: number) {
      return { from, marker: this };
    }
  }
  return {
    Decoration: {
      mark: () => ({ range: () => ({}) }),
      set: () => "mock-decoration-set",
      none: "mock-decoration-none",
    },
    EditorView: {
      updateListener: { of: () => "mock-update-listener" },
      decorations: { from: () => "mock-decorations-from" },
      domEventHandlers: () => "mock-dom-event-handlers",
    },
    GutterMarker: MockGutterMarker,
    ViewPlugin: { fromClass: (cls: unknown) => ({ extension: cls }) },
    gutter: () => "mock-gutter",
  };
});

const { CollabManager } = await import("../../../editor/collab");

const CANVAS_PATH = "boards/board.canvas";
const MARKDOWN_PATH = "notes/journal.md";

function createView() {
  return {
    dispatch: vi.fn(),
    state: {
      doc: { toString: () => "local content" },
      selection: { main: { anchor: 0, head: 0 } },
    },
  };
}

function createSyncManager() {
  // `length: 0` on purpose: an UNGUARDED host activation seeds an empty Y.Text
  // from the editor's content, so `_text.insert` becomes a second, independent
  // witness of the guard.
  const text = {
    length: 0,
    insert: vi.fn(),
    delete: vi.fn(),
    toString: () => "",
  };
  const doc = { transact: vi.fn((fn: () => void) => fn()) };
  const awareness = { setLocalStateField: vi.fn(), setLocalState: vi.fn() };
  return {
    _text: text,
    _awareness: awareness,
    getDoc: vi.fn((_docId: string) => ({ doc, text, awareness })),
    waitForSync: vi.fn(async (_docId: string) => {}),
  };
}

function lastReconfigure(): unknown[] {
  return reconfigureCalls[reconfigureCalls.length - 1] as unknown[];
}

describe("WP27 AC4 — the bare-path getDoc in activateForFile is guarded", () => {
  let collab: InstanceType<typeof CollabManager>;

  beforeEach(() => {
    collab = new CollabManager();
    reconfigureCalls.length = 0;
  });

  it("a `.canvas` path is never handed to the sync manager", async () => {
    const view = createView();
    const syncManager = createSyncManager();

    await collab.activateForFile(view as never, CANVAS_PATH, syncManager as never, "host");

    expect(syncManager.getDoc).not.toHaveBeenCalledWith(CANVAS_PATH);
    expect(syncManager.getDoc).not.toHaveBeenCalled();
    expect(syncManager.waitForSync).not.toHaveBeenCalled();
  });

  it("no yCollab binding is installed over a canvas path", async () => {
    const view = createView();
    const syncManager = createSyncManager();

    await collab.activateForFile(view as never, CANVAS_PATH, syncManager as never, "host");

    expect(view.dispatch).toHaveBeenCalled();
    expect(reconfigureCalls).toContainEqual([]);
    expect(lastReconfigure()).not.toContain("yCollab-extension");
  });

  it("and no Y.Text is seeded from the canvas's editor content", async () => {
    // The R5 damage in one assertion: a host activating over a canvas used to
    // push the whole JSON file into a raw `Y.Text` for that path.
    const view = createView();
    const syncManager = createSyncManager();

    await collab.activateForFile(view as never, CANVAS_PATH, syncManager as never, "host");

    expect(syncManager._text.insert).not.toHaveBeenCalled();
    expect(syncManager._awareness.setLocalStateField).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL — an ordinary markdown file still binds", async () => {
    const view = createView();
    const syncManager = createSyncManager();

    await collab.activateForFile(view as never, MARKDOWN_PATH, syncManager as never, "host");

    expect(syncManager.getDoc).toHaveBeenCalledWith(MARKDOWN_PATH);
    expect(lastReconfigure()[0]).toBe("yCollab-extension");
  });

  it("both branches in one run, so the absence is an observed refusal", async () => {
    const view = createView();
    const syncManager = createSyncManager();

    await collab.activateForFile(view as never, CANVAS_PATH, syncManager as never, "host");
    await collab.activateForFile(view as never, MARKDOWN_PATH, syncManager as never, "host");

    expect(syncManager.getDoc.mock.calls.map((call) => call[0])).toEqual([MARKDOWN_PATH]);
  });
});
