import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { decodeEndpointToFile } from "../../../canvas/canvas-registers";
import { decodeCanvasDataToFlat, parseCanvas } from "../../../files/canvas-sync";

// AC2 (no field gains or loses a value) — angle: a full write/read round trip
// through the real reader (`parseCanvas`) rather than in-memory inspection, with
// payloads that break naive string handling: emoji (surrogate pairs), combining
// marks, embedded quotes/backslashes/newlines, and a very long text body.

type Rec = Record<string, unknown>;

const LONG = "λ".repeat(5000);

const NODES: Rec[] = [
  {
    id: "emoji",
    type: "text",
    x: 0,
    y: 0,
    width: 250,
    height: 60,
    text: "👩‍👩‍👧‍👦 family · 🇩🇪 flag · é combining",
  },
  {
    id: "quotes",
    type: "text",
    x: 10,
    y: 10,
    width: 250,
    height: 60,
    text: 'he said "hi"\\ then\nnewline\ttab',
  },
  { id: "long", type: "text", x: 20, y: 20, width: 250, height: 60, text: LONG },
  {
    id: "paths",
    type: "file",
    x: 30,
    y: 30,
    width: 400,
    height: 400,
    file: "Ordner mit Leerzeichen/Übersicht – v2.md",
    subpath: "#Überschrift",
  },
];

describe("AC2 — a full round trip loses no field and no character", () => {
  it("returns every node byte-for-byte through serialise → parseCanvas", () => {
    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));
    // WP59 amendment: `parseCanvas` is a V2 reader since WP16 — it collapses
    // `x,y` → `pos` and `width,height` → `size`. The file bytes are unchanged;
    // only the reader's shape moved. `decodeCanvasDataToFlat` is the exact
    // inverse, applied at every internal `parseCanvas` call site, so the round
    // trip under test is `serialise → parseCanvas → decode`. Nothing is
    // softened: the key set below is still an exact whole-collection `toEqual`
    // over the complete sorted list, and it now additionally pins that the V2
    // register bridge is invertible — which nothing pinned before.
    const flat = decodeCanvasDataToFlat(parsed);

    expect(Object.keys(flat.nodes).sort()).toEqual(["emoji", "long", "paths", "quotes"]);
    for (const original of NODES) {
      const back = flat.nodes[original.id as string];
      expect(Object.keys(back).sort()).toEqual(Object.keys(original).sort());
      for (const [key, value] of Object.entries(original)) {
        expect(back[key]).toBe(value);
      }
    }
  });

  it("keeps the exact code-unit length of a long unicode payload", () => {
    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));

    expect((parsed.nodes.long.text as string).length).toBe(5000);
    expect(parsed.nodes.long.text).toBe(LONG);
  });

  it("preserves an edge's optional fields and adds none", () => {
    const edges: Rec[] = [
      { id: "full", fromNode: "a", fromSide: "right", fromEnd: "none", toNode: "b", toSide: "left", toEnd: "arrow", color: "5", label: "über" },
      { id: "bare", fromNode: "a", toNode: "b" },
    ];

    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: [], edges }));
    // WP59 amendment: same cause as the node case above — WP16's reader folds
    // `fromNode/fromSide/fromEnd` → `from` and `toNode/toSide/toEnd` → `to`.
    // Read the round trip through the sanctioned inverse. The nine-key list is
    // unchanged and still an exact whole-collection `toEqual`.
    const flat = decodeCanvasDataToFlat(parsed);

    expect(Object.keys(flat.edges.full).sort()).toEqual(
      ["color", "fromEnd", "fromNode", "fromSide", "id", "label", "toEnd", "toNode", "toSide"],
    );
    // Added strictness (WP59): the endpoint register itself is decoded and its
    // side pinned, so a register that survived the key-set check while carrying
    // a wrong or absent side cannot pass. Mirrors the already-sanctioned form in
    // the visible twin `v2/wp3/test_file_shape_tabs_visible.test.ts`.
    expect(decodeEndpointToFile("to", parsed.edges.full.to)).toEqual({
      toNode: "b",
      toSide: "left",
      toEnd: "arrow",
    });
    // WP59 amendment (extended licence, 2026-08-02): the bare edge is the same
    // staleness class as the two sites above, not a defect. WP10 AC5 made a
    // side-less `{fromNode}` a WHOLE endpoint register — `*Node` alone decides
    // presence — so `parsed.edges.bare` now reads `{from, id, to}`. This
    // assertion previously passed only because `toV2Edge` keeps an edge's flat
    // keys when the endpoint register FAILS to build: pre-AC5 a side-less
    // endpoint failed to build, so the flat keys survived. The green was
    // produced by the very defect AC5 exists to fix — a fully-connected edge
    // being read as not-an-endpoint and written out of the user's `.canvas`.
    // Read through the sanctioned inverse instead; `flat` is already bound
    // above. The three-key list is kept verbatim as an exact whole-collection
    // `toEqual` — nothing is softened.
    expect(Object.keys(flat.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
    // Added strictness (WP59 AC6): pin AC5's actual contract, which nothing
    // pinned here before — a side-less endpoint decodes to its `*Node` key and
    // NO `*Side`/`*End` key at all. An implementation that re-emitted
    // `fromSide: null` or `fromSide: ""` would still satisfy the key-set check
    // on `flat` above but fails this exact whole-object `toEqual`.
    expect(decodeEndpointToFile("from", parsed.edges.bare.from)).toEqual({ fromNode: "a" });
    expect(flat.edges.full.label).toBe("über");
  });

  it("does not deep-clone away a value the caller still holds a reference to", () => {
    const shared = { keepMe: [1, 2, 3] };
    const nodes: Rec[] = [
      { id: "n", type: "text", x: 0, y: 0, width: 1, height: 1, text: "t", extra: shared },
    ];

    const out = canonicalizeCanvasData({ nodes, edges: [] });

    expect(out.nodes[0].extra).toBe(shared);
  });
});
