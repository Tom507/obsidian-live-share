import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC5 (part 2) — "No serialisation path may emit `null` or `""` for an
// optional endpoint or geometry key, INCLUDING VIA THE VERBATIM FLAT-KEY PASS.
// A junk value already sitting in the doc under a flat key is dropped, not
// carried to disk."
//
// Why the register codec alone does not close this: the canonical step drops
// only `undefined` — `null` and `""` pass through by identity. So a doc record
// holding a flat `fromSide: null` (a hand-edited file seeded through the flat
// vocabulary, or a V1 record whose flat keys the additive migration KEPT)
// reaches disk as `"fromSide": null`, and — because the flat key wins the
// flat-vs-register precedence — it also OVERRIDES the valid register that still
// holds the real side. Two defects from one value.
//
// NOTE on the geometry half: `x`/`y`/`width`/`height` remain REQUIRED numeric
// JSON Canvas keys. "Drop the junk" means a `null`/`""` under one of them must
// not reach disk; it does NOT make the keys optional, and a register that knows
// the real geometry still expands normally (asserted below).
// ===========================================================================

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

function setRecord(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const held = new Y.Map<unknown>();
  container.set(id, held);
  held.set("id", id);
  for (const [key, value] of Object.entries(fields)) held.set(key, value);
}

function setPlainNode(container: Y.Map<Y.Map<unknown>>, id: string): void {
  setRecord(container, id, { type: "text", x: 0, y: 0, width: 10, height: 10 });
}

function findById(records: Record<string, unknown>[], id: string): Record<string, unknown> {
  return records.find((record) => record.id === id) as Record<string, unknown>;
}

describe("WP17 AC5 — a junk flat value is dropped rather than carried to disk", () => {
  it("a flat `fromSide: null` neither reaches disk nor overrides the register that holds the real side", () => {
    const { nodes, edges } = makeDoc();
    setPlainNode(nodes, "n1");
    setPlainNode(nodes, "n2");

    setRecord(edges, "e1", {
      from: encodeEndpoint("n1", "right"),
      to: encodeEndpoint("n2", "left"),
      fromSide: null,
      toSide: "",
    });

    const out = findById(buildCanvasData(nodes, edges).edges, "e1");

    expect(out).toEqual({
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      toNode: "n2",
      toSide: "left",
    });
    expect(serializeCanvas(nodes, edges)).not.toMatch(/"(from|to)Side"\s*:\s*(null|"")/);
  });

  it("a flat `fromSide: null` on a record with NO register simply omits the key", () => {
    const { nodes, edges } = makeDoc();
    setPlainNode(nodes, "n1");
    setPlainNode(nodes, "n2");

    setRecord(edges, "e1", {
      fromNode: "n1",
      fromSide: null,
      fromEnd: "",
      toNode: "n2",
      toSide: "",
      toEnd: null,
    });

    const out = findById(buildCanvasData(nodes, edges).edges, "e1");

    expect(out).toEqual({ id: "e1", fromNode: "n1", toNode: "n2" });
    expect(out).not.toHaveProperty("fromSide");
    expect(out).not.toHaveProperty("toEnd");
  });

  it("a junk `fromNode`/`toNode` is dropped too — never written as `null`", () => {
    const { nodes, edges } = makeDoc();
    setPlainNode(nodes, "n1");
    setPlainNode(nodes, "n2");

    // The register still knows the endpoint; the junk flat spelling must not
    // win, and must not reach disk on its own account either.
    setRecord(edges, "e1", { from: encodeEndpoint("n1", "top"), fromNode: null, toNode: "" });

    const out = findById(buildCanvasData(nodes, edges).edges, "e1");

    expect(out).toEqual({ id: "e1", fromNode: "n1", fromSide: "top" });
    expect(serializeCanvas(nodes, edges)).not.toMatch(/"(from|to)Node"\s*:\s*(null|"")/);
  });

  it("junk geometry is dropped, and a register still expands into the required numeric keys", () => {
    const { nodes, edges } = makeDoc();

    setRecord(nodes, "n1", {
      type: "text",
      pos: encodePos(12, 34),
      size: encodeSize(56, 78),
      x: null,
      width: "",
    });
    setRecord(nodes, "n2", { type: "text", x: null, y: 5, width: "", height: 6 });

    const built = buildCanvasData(nodes, edges);

    // The keys stay REQUIRED and numeric wherever the doc actually knows them.
    expect(findById(built.nodes, "n1")).toEqual({
      id: "n1",
      type: "text",
      x: 12,
      y: 34,
      width: 56,
      height: 78,
    });
    // With no register to fall back on, the junk is simply absent — never a
    // `"x": null` that would make the record unreadable to Obsidian.
    expect(findById(built.nodes, "n2")).toEqual({ id: "n2", type: "text", y: 5, height: 6 });

    const text = serializeCanvas(nodes, edges);
    expect(text).not.toMatch(/"(x|y|width|height)"\s*:\s*(null|"")/);
    expect(text).not.toMatch(/:\s*null/);
  });

  it("an unknown/future key keeps passing through untouched — the drop is scoped to typed file keys", () => {
    const { nodes, edges } = makeDoc();

    // Canonicalisation is a REORDERING: deleting a key this build does not
    // understand would delete user data on every peer. `null` under such a key
    // is therefore NOT junk, and stays.
    setRecord(nodes, "n1", {
      type: "text",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      futureThing: null,
      alsoFuture: "",
    });

    expect(findById(buildCanvasData(nodes, edges).nodes, "n1")).toEqual({
      id: "n1",
      type: "text",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      alsoFuture: "",
      futureThing: null,
    });
  });
});
