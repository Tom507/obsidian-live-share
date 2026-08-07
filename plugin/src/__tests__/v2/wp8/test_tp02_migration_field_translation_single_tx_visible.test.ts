// WP8 / AC2 — "A V1 doc is migrated in a single transaction: x/y -> pos,
// width/height -> size, endpoint keys -> from/to, an ord is assigned to
// every record."
//
// Two properties, both required by the AC text itself (not just "does the
// data look right afterwards"):
//   ├── the TRANSLATION is correct: pos/size/from/to decode back to exactly
//   │   what the V1 record held, using the OWNED codecs from WP9/WP10
//   │   (canvas-registers.ts) — never a local re-implementation.
//   └── it happens in ONE transaction — asserted by counting Yjs
//       `afterTransaction` firings across the whole migrateV1ToV2() call,
//       not by inspecting source.
//
// `ord` well-formedness is pinned against WP13's documented format (base-62
// alphabet, canonical = never ends in the zero digit) rather than against
// `compareOrd`'s numeric behaviour, which the wp13 suite already owns.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { decodeEndpoint, decodePos, decodeSize, V2_FIELD } from "../../../canvas/canvas-registers";
import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

const ORD_FORMAT = /^[0-9A-Za-z]+$/;

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): Y.Map<unknown> {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
  return record;
}

function v1Edge(doc: Y.Doc, id: string, fields: Record<string, unknown>): Y.Map<unknown> {
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  edges.set(id, record);
  return record;
}

function assertWellFormedOrd(value: unknown): void {
  expect(typeof value).toBe("string");
  const ord = value as string;
  expect(ord.length).toBeGreaterThan(0);
  expect(ord).toMatch(ORD_FORMAT);
  expect(ord.endsWith("0")).toBe(false);
}

describe("WP8 AC2 — migration translates V1 fields to V2 registers in one transaction", () => {
  it("pos/size/from/to decode back to the original V1 values, ord is assigned, and exactly one transaction fires", () => {
    const doc = new Y.Doc();
    v1Node(doc, "n1", {
      id: "n1",
      type: "file",
      x: 40,
      y: -25,
      width: 220,
      height: 140,
      file: "attachment.pdf",
    });
    v1Edge(doc, "e1", {
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      fromEnd: "arrow",
      toNode: "n1",
      toSide: "left",
    });

    let transactionCount = 0;
    const onAfterTx = () => {
      transactionCount++;
    };
    doc.on("afterTransaction", onAfterTx);
    migrateV1ToV2(doc);
    doc.off("afterTransaction", onAfterTx);

    expect(transactionCount, "the whole migration must be exactly one Yjs transaction").toBe(1);

    const nodeRecord = doc.getMap<Y.Map<unknown>>("nodes").get("n1");
    expect(nodeRecord).toBeDefined();
    if (!nodeRecord) throw new Error("unreachable");
    const pos = nodeRecord.get(V2_FIELD.pos);
    const size = nodeRecord.get(V2_FIELD.size);
    expect(decodePos(pos as never)).toEqual({ x: 40, y: -25 });
    expect(decodeSize(size as never)).toEqual({ width: 220, height: 140 });
    assertWellFormedOrd(nodeRecord.get(V2_FIELD.ord));

    const edgeRecord = doc.getMap<Y.Map<unknown>>("edges").get("e1");
    expect(edgeRecord).toBeDefined();
    if (!edgeRecord) throw new Error("unreachable");
    const from = edgeRecord.get(V2_FIELD.from);
    const to = edgeRecord.get(V2_FIELD.to);
    expect(decodeEndpoint(from as never)).toEqual({ node: "n1", side: "right", end: "arrow" });
    // `toEnd` was never supplied — decodeEndpoint must omit the key, not
    // invent an empty string for it.
    expect(decodeEndpoint(to as never)).toEqual({ node: "n1", side: "left" });
    assertWellFormedOrd(edgeRecord.get(V2_FIELD.ord));

    doc.destroy();
  });
});
