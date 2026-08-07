import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  buildCanvasData,
  decodeCanvasDataToFlat,
  parseCanvas,
  serializeCanvas,
} from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC5 (part 1) — "An endpoint register with no `side` emits its
// `fromNode`/`toNode` and OMITS the `fromSide`/`toSide` key entirely — never
// `null`, never `""`. Same for `fromEnd`/`toEnd`. A `.canvas` file containing
// side-less edges must survive parse → doc → serialize BYTE-IDENTICALLY, so
// such a file does not churn on its first write."
//
// This is deliberately a BYTE-IDENTITY test and not a shape test. A shape
// assertion (`not.toHaveProperty("fromSide")`) passes against an implementation
// that emits `"fromSide": null`, because `null` is a property value too — and
// `null` is exactly what rewrites every side-less file on its first write. That
// churn looks like a sync storm and destroys the round-trip stability AC4
// promises, so the oracle here is the file's BYTES.
//
// The fixture is exercised through BOTH doc vocabularies a P1 doc can be in:
//
//   ├── the REGISTER vocabulary — `parseCanvas`'s own V2 output seeded straight
//   │   into the Y.Maps (what a V2 cold-open seed leaves behind), so the
//   │   side-less edge exists only as `{node}` with no `side` component at all
//   └── the FLAT vocabulary — the same file through WP16's
//       `decodeCanvasDataToFlat` bridge (what `seedRecordsIntoYMaps` and the
//       capture path still write), so the verbatim flat-key pass is covered too
//
// Both must land on the same bytes as the file they came from.
// ===========================================================================

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/sideless_edges.canvas", import.meta.url));

/**
 * The fixture's canonical text. The CRLF normalisation is a CHECKOUT artifact of
 * the Windows dev host (`core.autocrlf`), never a normalisation of the
 * serializer's output — the assertions below compare `serializeCanvas`'s real
 * bytes against this, unmodified. The sibling `fixtures/.gitattributes` pins
 * `*.canvas -text` so the artifact does not arise in the first place.
 */
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8").replace(/\r\n/g, "\n");

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

/** Seed one id space verbatim — one `Y.Map` per record, key by key. */
function seed(
  container: Y.Map<Y.Map<unknown>>,
  records: Record<string, Record<string, unknown> | object>,
): void {
  for (const [id, record] of Object.entries(records)) {
    const held = new Y.Map<unknown>();
    container.set(id, held);
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      held.set(key, value);
    }
  }
}

describe("WP17 AC5 — a side-less `.canvas` file survives parse → doc → serialize byte-identically", () => {
  it("sanity: the fixture really does carry a side-less edge and a sided control edge", () => {
    const parsed = parseCanvas(FIXTURE);

    // e1 is attached at both ends but names no side — a legal, fully-connected
    // JSON Canvas edge, and the case that used to be unrepresentable.
    expect(parsed.edges.e1.from).toEqual({ node: "n1" });
    expect(parsed.edges.e1.to).toEqual({ node: "n2" });
    expect(parsed.edges.e1.from).not.toHaveProperty("side");

    // e2 is the control: sides (and an end) present, so a blanket "omit the
    // optional keys" implementation cannot pass this file either.
    expect(parsed.edges.e2.from).toEqual({ node: "n1", side: "right", end: "none" });
    expect(parsed.edges.e2.to).toEqual({ node: "n2", side: "left" });

    // e3 is the asymmetric case: one end names a side, the other does not.
    expect(parsed.edges.e3.from).toEqual({ node: "n2" });
    expect(parsed.edges.e3.to).toEqual({ node: "n1", side: "top" });
  });

  it("register vocabulary: the doc built from parseCanvas's V2 output re-serialises to the exact same bytes", () => {
    const { nodes, edges } = makeDoc();
    const parsed = parseCanvas(FIXTURE);
    seed(nodes, parsed.nodes);
    seed(edges, parsed.edges);

    expect(serializeCanvas(nodes, edges)).toBe(FIXTURE);
  });

  it("flat vocabulary: the same file through decodeCanvasDataToFlat re-serialises to the exact same bytes", () => {
    const { nodes, edges } = makeDoc();
    const flat = decodeCanvasDataToFlat(parseCanvas(FIXTURE));
    seed(nodes, flat.nodes);
    seed(edges, flat.edges);

    expect(serializeCanvas(nodes, edges)).toBe(FIXTURE);
  });

  it("the emitted text carries no `null` and no `\"\"` for any omitted optional endpoint key", () => {
    const { nodes, edges } = makeDoc();
    const parsed = parseCanvas(FIXTURE);
    seed(nodes, parsed.nodes);
    seed(edges, parsed.edges);

    const text = serializeCanvas(nodes, edges);

    // Explicit absence, asserted on the raw text rather than inferred from a
    // deep-equal: `"fromSide": null` and `"fromSide": ""` are the two shapes a
    // shape test would have accepted.
    expect(text).not.toMatch(/"(from|to)(Side|End)"\s*:\s*(null|"")/);
    expect(text).not.toMatch(/:\s*null/);

    // …and the side-less edge really is emitted, keys and all — omission must
    // not have been achieved by dropping the edge.
    const built = buildCanvasData(nodes, edges);
    const e1 = built.edges.find((edge) => edge.id === "e1") as Record<string, unknown>;
    expect(e1).toEqual({ id: "e1", fromNode: "n1", toNode: "n2" });
  });

  it("the round trip is stable a second time: serialize(parse(serialize(...))) is a fixed point", () => {
    const first = makeDoc();
    const parsed = parseCanvas(FIXTURE);
    seed(first.nodes, parsed.nodes);
    seed(first.edges, parsed.edges);
    const once = serializeCanvas(first.nodes, first.edges);

    const second = makeDoc();
    const reparsed = parseCanvas(once);
    seed(second.nodes, reparsed.nodes);
    seed(second.edges, reparsed.edges);

    expect(serializeCanvas(second.nodes, second.edges)).toBe(once);
    expect(once).toBe(FIXTURE);
  });
});
