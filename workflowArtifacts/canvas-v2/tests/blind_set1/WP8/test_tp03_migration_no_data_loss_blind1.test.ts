// WP8 AC2 completeness — different angle: attack via PARTIAL records. Real
// V1 canvases are sparse — most optional keys are absent on most records.
// A migration that only survives a fully-populated fixture (the visible
// test) could still be silently fabricating or dropping values on the more
// common sparse case. Different unknown-key name/value/type from the
// visible test as well (a nested object, not a string).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { decodeEndpoint, decodePos, decodeSize, V2_FIELD } from "../../../canvas/canvas-registers";
import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
}

function v1Edge(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  edges.set(id, record);
}

describe("WP8 AC2 — sparse records lose nothing and gain nothing", () => {
  it("a bare-minimum node and a single-ended edge with a structured unknown key survive intact", () => {
    const doc = new Y.Doc();

    // A node with ONLY the geometry + type it needs, no color/text/file.
    v1Node(doc, "bare", {
      id: "bare",
      type: "file",
      x: 0,
      y: 0,
      width: 160,
      height: 90,
      file: "readme.md",
      __sync_meta__: { origin: "import", tags: ["a", "b"] },
    });

    // An edge with only ONE side carrying an `end` — the other has none.
    v1Edge(doc, "one-end", {
      id: "one-end",
      fromNode: "bare",
      fromSide: "bottom",
      // no fromEnd
      toNode: "bare",
      toSide: "top",
      toEnd: "arrow",
    });

    migrateV1ToV2(doc);

    const node = doc.getMap<Y.Map<unknown>>("nodes").get("bare");
    expect(node).toBeDefined();
    if (!node) throw new Error("unreachable");
    expect(decodePos(node.get(V2_FIELD.pos) as never)).toEqual({ x: 0, y: 0 });
    expect(decodeSize(node.get(V2_FIELD.size) as never)).toEqual({ width: 160, height: 90 });
    expect(node.get(V2_FIELD.file)).toBe("readme.md");
    // Fields never supplied must stay absent, not fabricated.
    expect(node.get(V2_FIELD.text)).toBeUndefined();
    expect(node.get(V2_FIELD.color)).toBeUndefined();
    expect(node.get("__sync_meta__")).toEqual({ origin: "import", tags: ["a", "b"] });

    const edge = doc.getMap<Y.Map<unknown>>("edges").get("one-end");
    expect(edge).toBeDefined();
    if (!edge) throw new Error("unreachable");
    expect(decodeEndpoint(edge.get(V2_FIELD.from) as never)).toEqual({
      node: "bare",
      side: "bottom",
    });
    expect(decodeEndpoint(edge.get(V2_FIELD.to) as never)).toEqual({
      node: "bare",
      side: "top",
      end: "arrow",
    });
    expect(edge.get(V2_FIELD.color)).toBeUndefined();
    expect(edge.get(V2_FIELD.label)).toBeUndefined();

    doc.destroy();
  });
});
