// WP37 / C37 AC6 — the instrument drives the real editor and returns MEASURED facts.
//
// AC6's vacuity clause names the exact anti-pattern: `canvas.simulateEdit` writes
// straight into the `Y.Doc` and returns a hardcoded `applied: true`, and that
// literal has produced several false greens in this project. So this file asserts
// the negative properties directly:
//
//   * `applied` is FALSE on a run where the surface did not change — proved by a
//     surface that refuses the insert, not by argument;
//   * the driver holds no doc and no writer — asserted structurally over its own
//     source, so a future edit that adds one turns this red;
//   * a missing node and a closed canvas produce STRUCTURED failures carrying the
//     measured state, not successes and not throws.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type CanvasNodeEditorDeps,
  driveCanvasNodeEdit,
  findCanvasViewForPath,
  insertedSuffix,
  resolveNodeEditor,
} from "../../../testing/canvas-node-editor";

const PATH = "boards/plan.canvas";

/** An editor double with the shape Obsidian's canvas node exposes. */
class FakeEditor {
  constructor(
    private value: string,
    private readonly opts: { refuseInsert?: boolean } = {},
  ) {}
  focused = false;
  getValue(): string {
    return this.value;
  }
  setValue(v: string): void {
    if (this.opts.refuseInsert) return;
    this.value = v;
  }
  replaceSelection(v: string): void {
    if (this.opts.refuseInsert) return;
    this.value += v;
  }
  setCursor(): void {}
  lastLine(): number {
    return 0;
  }
  getLine(): string {
    return this.value;
  }
  focus(): void {
    this.focused = true;
  }
  blur(): void {
    this.focused = false;
  }
}

class FakeNodeEl {
  constructor(private readonly owned: unknown) {}
  contains(n: unknown): boolean {
    return n === this.owned;
  }
  querySelector(): unknown {
    return null;
  }
}

function makeWorld(opts: { refuseInsert?: boolean; text?: string } = {}) {
  const editor = new FakeEditor(opts.text ?? "alpha", { refuseInsert: opts.refuseInsert });
  const focusTarget = { marker: "cm-content" };
  const node = {
    id: "c1",
    text: opts.text ?? "alpha",
    isEditing: false,
    nodeEl: new FakeNodeEl(focusTarget),
    child: { editor },
    startEditing(): void {
      node.isEditing = true;
    },
    stopEditing(): void {
      node.isEditing = false;
    },
  };
  const view = {
    file: { path: PATH },
    canvas: { nodes: new Map([["c1", node]]) },
  };
  let active: unknown = null;
  // `activeElement` is a live GETTER, exactly as it is on a real `Document`. A
  // plain snapshot would make every focus assertion below measure the value at
  // the moment the driver first looked, which is not what a browser does.
  const documentDouble = {
    get activeElement(): unknown {
      return active;
    },
    execCommand: () => false,
  };
  const deps: CanvasNodeEditorDeps = {
    canvasViews: () => [view],
    document: () => documentDouble,
    wait: async () => {},
  };
  // Focusing the editor is what puts the caret inside the card, exactly as it
  // does in the browser.
  const originalFocus = editor.focus.bind(editor);
  editor.focus = () => {
    originalFocus();
    active = focusTarget;
  };
  const originalBlur = editor.blur.bind(editor);
  editor.blur = () => {
    originalBlur();
    active = null;
  };
  return { deps, node, editor, view };
}

describe("WP37 AC6 — the instrument drives the editor and reports what it measured", () => {
  it("T1 a successful insert reports the surface text READ BACK, not the argument", async () => {
    const { deps, node } = makeWorld();
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "-XYZ" });
    expect(out.ok).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.editingStarted).toBe(true);
    expect(out.editingReported).toBe(true);
    expect(out.surface).toBe("node-editor");
    expect(out.focusTaken).toBe(true);
    expect(out.textBefore).toBe("alpha");
    expect(out.textAfter).toBe("alpha-XYZ");
    expect(out.textSource, "the EDITOR is what can hold unflushed characters").toBe("editor");
    expect(out.applied).toBe(true);
    expect(out.inserted).toBe("-XYZ");
    // The model was NOT written: the characters are unflushed, exactly as a real
    // keystroke leaves them. This is the AC3 precondition, in one assertion.
    expect(node.text, "the node model is untouched — nothing was flushed").toBe("alpha");
  });

  it("T2 `applied` is FALSE when the surface refuses — it is not a literal", async () => {
    const { deps } = makeWorld({ refuseInsert: true });
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "-XYZ" });
    expect(out.ok, "the instrument ran").toBe(true);
    expect(out.applied, "…and honestly reports that nothing landed").toBe(false);
    expect(out.inserted).toBe("");
    expect(out.textAfter).toBe("alpha");
  });

  it("T3 a call with no text and no blur is a NON-INVASIVE read", async () => {
    const { deps, node } = makeWorld();
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1" });
    expect(out.ok).toBe(true);
    expect(out.editingStarted, "no editor was opened").toBe(false);
    expect(node.isEditing, "and no focus was stolen from whatever was being edited").toBe(false);
    expect(out.textBefore).toBe("alpha");
    expect(out.textSource).toBe("model");
    expect(out.applied).toBe(false);
  });

  it("T4 blur is reported and re-measured, not assumed", async () => {
    const { deps, node } = makeWorld();
    await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "-XYZ" });
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", blur: true });
    expect(out.blurred).toBe(true);
    expect(out.focusTaken, "focus is READ AGAIN after the blur").toBe(false);
    expect(node.isEditing).toBe(false);
  });
});

describe("WP37 AC6 — both negative cases are STRUCTURED failures", () => {
  it("T5 a canvas that is not open", async () => {
    const deps: CanvasNodeEditorDeps = {
      canvasViews: () => [],
      document: () => null,
      wait: async () => {},
    };
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("canvas-not-open");
    expect(out.canvasOpen).toBe(false);
    expect(out.applied, "a failure never claims an apply").toBe(false);
    expect(out.reason).toContain(PATH);
  });

  it("T6 a node that does not exist — and the ids it DOES have are reported", async () => {
    const { deps } = makeWorld();
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "nope", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("node-not-found");
    expect(out.canvasOpen).toBe(true);
    expect(out.nodeFound).toBe(false);
    expect(out.liveNodeIds, "diagnosable, not mysterious").toEqual(["c1"]);
    expect(out.applied).toBe(false);
  });

  it("T7 a node with no editing surface at all", async () => {
    const node = { id: "c1", text: "alpha" };
    const deps: CanvasNodeEditorDeps = {
      canvasViews: () => [{ file: { path: PATH }, canvas: { nodes: new Map([["c1", node]]) } }],
      document: () => null,
      wait: async () => {},
    };
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no-editing-surface");
    expect(out.applied).toBe(false);
    expect(out.probe.hasStartEditing).toBe(false);
  });

  it("T8 a workspace that throws is a structured failure, never a crash", async () => {
    const deps: CanvasNodeEditorDeps = {
      canvasViews: () => {
        throw new Error("workspace is gone");
      },
      document: () => null,
      wait: async () => {},
    };
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("workspace-unavailable");
    expect(out.reason).toContain("workspace is gone");
  });

  it("T9 a private shape with no node Map", async () => {
    const deps: CanvasNodeEditorDeps = {
      canvasViews: () => [{ file: { path: PATH }, canvas: {} }],
      document: () => null,
      wait: async () => {},
    };
    const out = await driveCanvasNodeEdit(deps, { path: PATH, nodeId: "c1" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("canvas-surface-unavailable");
  });
});

describe("WP37 AC6 — the driver CANNOT reach the doc or the file", () => {
  const SOURCE = readFileSync(
    new URL("../../../testing/canvas-node-editor.ts", import.meta.url),
    "utf8",
  );
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("T10 it imports nothing at all — no Yjs, no Obsidian, no filesystem", () => {
    expect([...CODE.matchAll(/from\s+["'][^"']+["']/g)]).toHaveLength(0);
    expect([...CODE.matchAll(/\brequire\s*\(/g)]).toHaveLength(0);
    expect([...CODE.matchAll(/\bimport\s*\(/g)]).toHaveLength(0);
  });

  it("T11 it names no doc, no transaction and no writer", () => {
    for (const forbidden of [
      /\bY\./,
      /getCanvasDocHandle/,
      /\btransact\s*\(/,
      /getMap\s*\(/,
      /vault\.(create|modify|adapter)/,
      /\bwriteBinary\b/,
      /requestSave/,
    ]) {
      expect(CODE, `must not reach ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("T12 it returns no hardcoded success — `ok` and `applied` are never literals", () => {
    expect(CODE, "the simulateEdit anti-pattern").not.toMatch(/applied:\s*true/);
    expect(CODE).not.toMatch(/return\s*\{\s*ok:\s*true/);
    // `applied` is a comparison of two reads.
    expect(CODE).toMatch(/out\.applied\s*=\s*out\.textAfter\s*!==\s*out\.textBefore/);
  });
});

describe("WP37 AC6 — the helpers, exercised on their own", () => {
  it("T13 insertedSuffix reports only what was really gained", () => {
    expect(insertedSuffix("abc", "abcdef")).toBe("def");
    expect(insertedSuffix("abc", "abc")).toBe("");
    expect(insertedSuffix("abc", "ab")).toBe("");
    expect(insertedSuffix("abc", "xyzabc"), "a non-suffix change is not an insert").toBe("");
    expect(insertedSuffix(null, "abc")).toBe("abc");
    expect(insertedSuffix("abc", null)).toBe("");
  });

  it("T14 findCanvasViewForPath normalises separators and leading slashes", () => {
    const v = { file: { path: "a/b.canvas" } };
    expect(findCanvasViewForPath([v], "a/b.canvas")).toBe(v);
    expect(findCanvasViewForPath([v], "a\\b.canvas")).toBe(v);
    expect(findCanvasViewForPath([v], "/a/b.canvas")).toBe(v);
    expect(findCanvasViewForPath([v], "a/c.canvas")).toBeNull();
    expect(findCanvasViewForPath([{}], "a/b.canvas")).toBeNull();
  });

  it("T15 resolveNodeEditor only accepts a candidate it can READ from", () => {
    expect(resolveNodeEditor(null)).toBeNull();
    expect(resolveNodeEditor({ child: { editor: {} } }), "no getValue ⇒ not an editor").toBeNull();
    const editor = { getValue: () => "x" };
    expect(resolveNodeEditor({ child: { editor } })).toBe(editor);
    expect(resolveNodeEditor({ child: { editMode: { editor } } })).toBe(editor);
    expect(resolveNodeEditor({ editor })).toBe(editor);
  });
});
