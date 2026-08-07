// WP27 / AC4 blind2 — the `activateForFile` guard, attacked through the CURSOR
// and AWARENESS side effects rather than through the `getDoc` call.
//
// Different angle: blind1 enumerates roles and permissions and reads the call
// log. This one reads what the unguarded body leaves behind on the awareness
// channel — a `user` field, a `cursor` field, and a `yCollab` extension bound to
// a `Y.Text` that belongs to a document `CanvasSync` owns structurally. Those
// are the artefacts a user would actually see (a text cursor floating over a
// canvas), and they are produced strictly after `getDoc` succeeds, so they
// cannot be true of a guarded body.
//
// A second angle sits in the last `it`: after a canvas activation the manager
// must not be left believing it is bound to that path, because `deactivateAll`
// and the next activation both branch on `currentPath`.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("yjs", () => ({
  createRelativePositionFromTypeIndex: vi.fn((_t: unknown, index: number) => ({
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
      return { type: "of", value: ext };
    }
    reconfigure(ext: unknown) {
      reconfigureCalls.push(ext);
      return { type: "reconfigure", value: ext };
    }
  }
  return {
    Compartment: MockCompartment,
    EditorState: { readOnly: { of: (v: boolean) => ({ readOnly: v }) } },
    RangeSet: { empty: [], of: (r: unknown[]) => r },
    StateEffect: { define: () => ({ of: (v: unknown) => ({ type: "effect", value: v }) }) },
    StateField: { define: () => "field" },
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
    Decoration: { mark: () => ({ range: () => ({}) }), set: () => "set", none: "none" },
    EditorView: {
      updateListener: { of: () => "listener" },
      decorations: { from: () => "decorations" },
      domEventHandlers: () => "handlers",
    },
    GutterMarker: MockGutterMarker,
    ViewPlugin: { fromClass: (cls: unknown) => ({ extension: cls }) },
    gutter: () => "gutter",
  };
});

const { CollabManager } = await import("../../../../../plugin/src/editor/collab");
const { yCollab } = await import("y-codemirror.next");

const CANVAS = "workspace/flow.canvas";
const MARKDOWN = "workspace/flow.md";

function view() {
  return {
    dispatch: vi.fn(),
    state: {
      doc: { toString: () => "{}" },
      selection: { main: { anchor: 3, head: 7 } },
    },
  };
}

function syncManager() {
  const text = { length: 12, insert: vi.fn(), delete: vi.fn(), toString: () => "x".repeat(12) };
  const awareness = { setLocalStateField: vi.fn(), setLocalState: vi.fn() };
  return {
    _text: text,
    _awareness: awareness,
    getDoc: vi.fn((_id: string) => ({
      doc: { transact: vi.fn((fn: () => void) => fn()) },
      text,
      awareness,
    })),
    waitForSync: vi.fn(async (_id: string) => {}),
  };
}

const CURSOR_USER = { name: "me", color: "#0f0", colorLight: "#0f03" };

describe("WP27 AC4 blind2 — the guard read through its absent side effects", () => {
  beforeEach(() => {
    reconfigureCalls.length = 0;
    vi.mocked(yCollab).mockClear();
  });

  it("no awareness field is published for a canvas path", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = syncManager();

    await collab.activateForFile(
      v as never,
      CANVAS,
      s as never,
      "guest",
      "read-write",
      CURSOR_USER,
    );

    expect(s._awareness.setLocalStateField).not.toHaveBeenCalled();
  });

  it("`yCollab` is never constructed over a canvas path", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = syncManager();

    await collab.activateForFile(v as never, CANVAS, s as never, "host", "read-write", CURSOR_USER);

    expect(yCollab).not.toHaveBeenCalled();
    expect(reconfigureCalls[reconfigureCalls.length - 1]).toEqual([]);
  });

  it("POSITIVE CONTROL — a markdown path produces both effects", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = syncManager();

    await collab.activateForFile(
      v as never,
      MARKDOWN,
      s as never,
      "host",
      "read-write",
      CURSOR_USER,
    );

    expect(yCollab).toHaveBeenCalledTimes(1);
    const fields = s._awareness.setLocalStateField.mock.calls.map((c) => c[0]);
    expect(fields).toContain("user");
    expect(fields).toContain("cursor");
  });

  it("a read-only canvas activation is refused just as a read-write one is", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = syncManager();

    await collab.activateForFile(
      v as never,
      CANVAS,
      s as never,
      "guest",
      "read-only",
      CURSOR_USER,
    );

    expect(s.getDoc).not.toHaveBeenCalled();
    expect(yCollab).not.toHaveBeenCalled();
  });

  it("a canvas activation leaves nothing bound for the next one to inherit", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = syncManager();

    await collab.activateForFile(v as never, CANVAS, s as never, "host", "read-write", CURSOR_USER);
    // The next real activation must still work — i.e. the refusal did not leave
    // the manager in a state where it believes it is already on this view.
    await collab.activateForFile(
      v as never,
      MARKDOWN,
      s as never,
      "host",
      "read-write",
      CURSOR_USER,
    );

    expect(s.getDoc.mock.calls.map((c) => c[0])).toEqual([MARKDOWN]);
    expect(yCollab).toHaveBeenCalledTimes(1);
  });
});
