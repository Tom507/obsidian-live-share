// WP27 / AC4 blind1 — the `activateForFile` guard, attacked across every ROLE
// and PERMISSION combination rather than once as a host.
//
// Different angle: the pre-WP27 body has four distinct behaviours downstream of
// `getDoc` (host seed, guest wait loop, read-only extension, read-write
// extension). A guard placed too late — after the role branch, or inside only
// one of them — closes some of those doors and leaves others open. Driving all
// four combinations against the same double and comparing the whole call log
// catches a partial guard that a single-role probe would call fixed.
//
// The oracle is again the CALL, not the returned handle.

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
    Decoration: {
      mark: () => ({ range: () => ({}) }),
      set: () => "set",
      none: "none",
    },
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

const CANVAS = "atlas/plan.canvas";
const MARKDOWN = "atlas/plan.md";

function view() {
  return {
    dispatch: vi.fn(),
    state: {
      doc: { toString: () => "{\"nodes\":[],\"edges\":[]}" },
      selection: { main: { anchor: 0, head: 0 } },
    },
  };
}

function sync(textLength: number) {
  const text = {
    length: textLength,
    insert: vi.fn(),
    delete: vi.fn(),
    toString: () => "x".repeat(textLength),
  };
  return {
    _text: text,
    getDoc: vi.fn((_id: string) => ({
      doc: { transact: vi.fn((fn: () => void) => fn()) },
      text,
      awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
    })),
    waitForSync: vi.fn(async (_id: string) => {}),
  };
}

const COMBOS: Array<{ role: "host" | "guest"; permission: "read-only" | "read-write" }> = [
  { role: "host", permission: "read-write" },
  { role: "host", permission: "read-only" },
  { role: "guest", permission: "read-write" },
  { role: "guest", permission: "read-only" },
];

describe("WP27 AC4 blind1 — the guard holds for every role and permission", () => {
  beforeEach(() => {
    reconfigureCalls.length = 0;
  });

  it("no combination hands a canvas path to getDoc", async () => {
    for (const combo of COMBOS) {
      const collab = new CollabManager();
      const v = view();
      const s = sync(0);

      await collab.activateForFile(
        v as never,
        CANVAS,
        s as never,
        combo.role,
        combo.permission,
      );

      expect(
        s.getDoc.mock.calls.map((c) => c[0]),
        `role=${combo.role} permission=${combo.permission}`,
      ).toEqual([]);
      expect(s.waitForSync).not.toHaveBeenCalled();
      expect(s._text.insert).not.toHaveBeenCalled();
    }
  });

  it("POSITIVE CONTROL — every combination still binds an ordinary file", async () => {
    for (const combo of COMBOS) {
      const collab = new CollabManager();
      const v = view();
      const s = sync(9);

      await collab.activateForFile(
        v as never,
        MARKDOWN,
        s as never,
        combo.role,
        combo.permission,
      );

      expect(
        s.getDoc.mock.calls.map((c) => c[0]),
        `role=${combo.role} permission=${combo.permission}`,
      ).toEqual([MARKDOWN]);
    }
  });

  it("the compartment is reconfigured to EMPTY for a canvas, in every combination", async () => {
    for (const combo of COMBOS) {
      reconfigureCalls.length = 0;
      const collab = new CollabManager();
      const v = view();
      const s = sync(0);

      await collab.activateForFile(
        v as never,
        CANVAS,
        s as never,
        combo.role,
        combo.permission,
      );

      const last = reconfigureCalls[reconfigureCalls.length - 1] as unknown[];
      expect(last, `role=${combo.role}`).toEqual([]);
    }
  });

  it("alternating canvas and markdown leaves only the markdown calls", async () => {
    const collab = new CollabManager();
    const v = view();
    const s = sync(9);

    await collab.activateForFile(v as never, CANVAS, s as never, "host");
    await collab.activateForFile(v as never, MARKDOWN, s as never, "host");
    await collab.activateForFile(v as never, CANVAS, s as never, "guest");
    await collab.activateForFile(v as never, null, s as never, "guest");

    expect(s.getDoc.mock.calls.map((c) => c[0])).toEqual([MARKDOWN]);
  });
});
