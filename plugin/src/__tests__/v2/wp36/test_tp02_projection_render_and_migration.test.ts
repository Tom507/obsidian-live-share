// WP36 / C36 AC4 + AC5 — the projection render, and the migration's shape.
//
// AC4's vacuity clause names the exact trap: `canvas.file` and `canvas.state`
// are BOTH JSON-serialised over HTTP, so both pass a nested `Y.Text` through
// `Y.Text.prototype.toJSON` and read back a correct string EVEN WITH THE
// EXPLICIT RENDER MISSING ENTIRELY. A green there proves nothing about the two
// consumers that matter — the OPEN Obsidian view and the Surface-Shadow —
// because neither of them is JSON.
//
// So this file asserts the render at those two consumers, in the shape they
// actually take it:
//
//   ├── the value `reconcileLiveCanvas` hands to `adapter.reloadCanvasData` is
//   │   `buildCanvasData(...)`, and it must be `typeof === "string"`; and
//   └── the value the Surface-Shadow stores after a confirmed apply is
//       `buildApplyReceipt(pass.desired)` -> `advanceFromReceipt`, where
//       `pass.desired` is that same `buildCanvasData` output.
//
// Both assertions are shown to go RED when the render is removed — the control
// at the bottom of this file reproduces the un-rendered projection and asserts
// that it FAILS the same two checks. A render whose removal changes no test is
// not being tested.

import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import {
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
} from "../../../canvas/canvas-shadow";
import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

/** A doc holding ONE text node whose `text` is a nested `Y.Text`. */
function docWithYText(text: string): {
  doc: Y.Doc;
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
} {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set("id", "c1");
    record.set("type", "text");
    record.set("x", 0);
    record.set("y", 0);
    record.set("width", 250);
    record.set("height", 60);
    // ONE operation, and the `Y.Text` is populated BEFORE it is attached —
    // exactly the shape `CanvasSync.writeCollabText` uses for the conversion.
    record.set("text", new Y.Text(text));
    nodes.set("c1", record);
  });
  return { doc, nodes, edges };
}

describe("WP36 AC4 — the OPEN VIEW consumer gets a string, not a Y.Text", () => {
  it("buildCanvasData renders `text` to a primitive string", () => {
    const { nodes, edges } = docWithYText("hello card");
    const data = buildCanvasData(nodes, edges);
    expect(data.nodes).toHaveLength(1);
    const value = data.nodes[0].text;
    expect(typeof value).toBe("string");
    expect(value).toBe("hello card");
    // The discriminating half: it is not merely string-LIKE.
    expect(value instanceof Y.Text).toBe(false);
    expect(Object.prototype.toString.call(value)).toBe("[object String]");
  });

  it("the CONTROL: the un-rendered projection would hand Obsidian an object", () => {
    // This is `toCanonicalFileRecord` with the WP36 render removed — the raw
    // doc value, copied through. It is reproduced here so the assertion above
    // is a discrimination and not a tautology.
    const { nodes } = docWithYText("hello card");
    const raw: Record<string, unknown> = {};
    const record = nodes.get("c1") as Y.Map<unknown>;
    for (const [key, value] of record) raw[key] = value;
    expect(typeof raw.text).not.toBe("string");
    expect(raw.text instanceof Y.Text).toBe(true);
  });

  it("an edge `label` is rendered too — `label` is a member of BOTH key sets", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    doc.transact(() => {
      for (const id of ["a", "b"]) {
        const n = new Y.Map<unknown>();
        n.set("id", id);
        n.set("type", "text");
        n.set("x", 0);
        n.set("y", 0);
        n.set("width", 10);
        n.set("height", 10);
        n.set("text", new Y.Text(id));
        nodes.set(id, n);
      }
      const e = new Y.Map<unknown>();
      e.set("id", "e1");
      e.set("fromNode", "a");
      e.set("toNode", "b");
      e.set("fromSide", "right");
      e.set("toSide", "left");
      e.set("label", new Y.Text("edge words"));
      edges.set("e1", e);
    });
    const data = buildCanvasData(nodes, edges);
    expect(data.edges).toHaveLength(1);
    expect(typeof data.edges[0].label).toBe("string");
    expect(data.edges[0].label).toBe("edge words");
    for (const node of data.nodes) expect(typeof node.text).toBe("string");
  });
});

describe("WP36 AC4 — the SURFACE-SHADOW consumer stores a string", () => {
  it("advanceFromReceipt stores `typeof === 'string'` for a Y.Text-backed card", () => {
    const { nodes, edges } = docWithYText("shadow me");
    const shadow = createSurfaceShadow();
    const desired = buildCanvasData(nodes, edges);
    const receipt = buildApplyReceipt({
      path: "x.canvas",
      desired,
      plan: "structural",
      reloaded: true,
    });
    advanceFromReceipt(shadow, receipt);
    const stored = getField(shadow, "x.canvas", "node", "c1", "text");
    expect(typeof stored).toBe("string");
    expect(stored).toBe("shadow me");
  });

  it("the CONTROL: an un-rendered projection puts a NON-STRING into the shadow", () => {
    const { nodes } = docWithYText("shadow me");
    const record = nodes.get("c1") as Y.Map<unknown>;
    const raw: Record<string, unknown> = {};
    for (const [key, value] of record) raw[key] = value;

    const shadow = createSurfaceShadow();
    const receipt = buildApplyReceipt({
      path: "x.canvas",
      desired: { nodes: [raw], edges: [] },
      plan: "structural",
      reloaded: true,
    });
    advanceFromReceipt(shadow, receipt);
    const stored = getField(shadow, "x.canvas", "node", "c1", "text");
    // The very thing the render prevents: the next capture would diff a string
    // against this object.
    expect(typeof stored).not.toBe("string");
  });
});

describe("WP36 AC4 — the disk bytes stay valid JSON Canvas", () => {
  it("serializeCanvas emits `text` as a JSON string and reparses", () => {
    const { nodes, edges } = docWithYText('quotes " and \\ backslash');
    const text = serializeCanvas(nodes, edges);
    const parsed = JSON.parse(text) as { nodes: Record<string, unknown>[] };
    expect(typeof parsed.nodes[0].text).toBe("string");
    expect(parsed.nodes[0].text).toBe('quotes " and \\ backslash');
  });
});

describe("WP36 AC5 — the conversion shape, stated as prohibitions", () => {
  it('a Y.Text built with content is populated at its FIRST observable instant', () => {
    // The abort shape is "set to a Y.Text attached BEFORE its content is
    // inserted". `new Y.Text(s)` queues the insert and replays it at
    // integration, so an observer of the `set` event already sees the content.
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("c1", record);

    const observed: (string | null)[] = [];
    record.observe(() => {
      const value = record.get("text");
      observed.push(value instanceof Y.Text ? value.toString() : null);
    });
    doc.transact(() => {
      record.set("text", new Y.Text("already here"));
    });
    expect(observed).toEqual(["already here"]);
    // And it was never absent-then-present: exactly one event, carrying content.
    expect(observed).toHaveLength(1);
  });

  it('an EMPTY card survives as a present key equal to "" — never falsy-asserted', () => {
    const { nodes, edges } = docWithYText("");
    const data = buildCanvasData(nodes, edges);
    const record = data.nodes[0];
    // Key PRESENCE plus exact equality. `undefined`, a missing key and a dropped
    // record are all falsy, and all three are what this assertion exists to
    // catch — so none of them may satisfy it.
    expect(Object.prototype.hasOwnProperty.call(record, "text")).toBe(true);
    expect(record.text).toBe("");
    expect(typeof record.text).toBe("string");
    // The non-empty control in the same run, which excludes "empty for the
    // wrong reason" (never written / wrong id / wrong canvas).
    const other = docWithYText("not empty");
    expect(buildCanvasData(other.nodes, other.edges).nodes[0].text).toBe("not empty");
    // ...and it reaches disk as an empty JSON string, not as an absent key.
    const parsed = JSON.parse(serializeCanvas(nodes, edges)) as {
      nodes: Record<string, unknown>[];
    };
    expect(Object.prototype.hasOwnProperty.call(parsed.nodes[0], "text")).toBe(true);
    expect(parsed.nodes[0].text).toBe("");
  });
});
