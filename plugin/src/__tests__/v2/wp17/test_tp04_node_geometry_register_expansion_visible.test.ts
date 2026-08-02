import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { buildCanvasData } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC1 (part 2) — "pos/size/from/to are expanded into x/y/width/height
// and the endpoint keys exactly as Obsidian expects."
//
// A node record whose doc fields are the ATOMIC `pos`/`size` registers
// (WP9) must serialise back to the flat file keys `x`/`y`/`width`/`height`
// — and the register keys themselves must not survive into the output.
// `buildCanvasData` currently copies every Y.Map key straight through with
// no register decoding at all, so a `pos`/`size`-only record today
// serialises with literal `pos`/`size` array values and no `x`/`y`/`width`/
// `height` — this test fails for that reason until WP17 wires in
// `decodePos`/`decodeSize` (WP9), never a hand-rolled re-expansion.
// ===========================================================================

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC1 — node pos/size registers expand into flat file geometry keys", () => {
  it("a register-only node record serialises x/y/width/height and drops pos/size", () => {
    const { nodes, edges } = makeDoc();
    const record = new Y.Map<unknown>();
    nodes.set("n1", record);
    record.set("id", "n1");
    record.set("type", "text");
    record.set("pos", encodePos(-120, 45));
    record.set("size", encodeSize(250, 60));
    record.set("text", "hello");

    const data = buildCanvasData(nodes, edges);
    const out = data.nodes[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "n1",
      type: "text",
      x: -120,
      y: 45,
      width: 250,
      height: 60,
      text: "hello",
    });
    expect(out).not.toHaveProperty("pos");
    expect(out).not.toHaveProperty("size");
  });
});
