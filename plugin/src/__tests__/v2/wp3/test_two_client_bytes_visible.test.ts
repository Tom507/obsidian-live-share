import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

// ===========================================================================
// WP3 Definition of Done — "the same doc state, serialised on two different
// clients, produces identical bytes."
//
// AC1 proves the pure helper is order-independent. This test proves the helper
// is actually WIRED INTO the seam: `buildCanvasData` / `serializeCanvas`
// (`canvas-sync.ts:98-137`), the only path `CanvasPersistence` writes through.
//
// Two clients converge to the same doc state but their Y.Map iteration order is
// a function of local integration history — that is the difference the canonical
// form has to erase before byte equality can be used as the echo breaker (D9).
// ===========================================================================

type Rec = Record<string, unknown>;

const NODES: Record<string, Rec> = {
  "n-alpha": { id: "n-alpha", type: "file", x: -200, y: 0, width: 400, height: 400, file: "A.md" },
  "n-beta": { id: "n-beta", type: "text", x: 300, y: 120, width: 250, height: 60, text: "beta" },
  "n-gamma": { id: "n-gamma", type: "group", x: 0, y: 0, width: 900, height: 700, label: "G" },
};

const EDGES: Record<string, Rec> = {
  "e-one": { id: "e-one", fromNode: "n-alpha", fromSide: "right", toNode: "n-beta", toSide: "left" },
  "e-two": { id: "e-two", fromNode: "n-beta", fromSide: "bottom", toNode: "n-gamma", toSide: "top" },
};

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

/** Fill a fresh doc with the same state, but in a caller-chosen insertion order. */
function peer(nodeOrder: string[], edgeOrder: string[], reverseKeys: boolean): Peer {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const fill = (target: Y.Map<Y.Map<unknown>>, id: string, source: Rec) => {
    const record = new Y.Map<unknown>();
    target.set(id, record);
    const entries = Object.entries(source);
    for (const [key, value] of reverseKeys ? entries.reverse() : entries) record.set(key, value);
  };
  doc.transact(() => {
    for (const id of nodeOrder) fill(nodes, id, NODES[id]);
    for (const id of edgeOrder) fill(edges, id, EDGES[id]);
  });
  return { nodes, edges };
}

describe("WP3 DoD — two clients serialise the same doc state to the same bytes", () => {
  it("serializeCanvas is byte-identical across two different integration orders", () => {
    const clientA = peer(["n-gamma", "n-alpha", "n-beta"], ["e-two", "e-one"], false);
    const clientB = peer(["n-beta", "n-gamma", "n-alpha"], ["e-one", "e-two"], true);

    // Premise: the raw CRDT iteration orders really do differ.
    expect([...clientA.nodes.keys()]).not.toEqual([...clientB.nodes.keys()]);
    expect([...(clientA.nodes.get("n-alpha") as Y.Map<unknown>).keys()]).not.toEqual([
      ...(clientB.nodes.get("n-alpha") as Y.Map<unknown>).keys(),
    ]);

    expect(serializeCanvas(clientA.nodes, clientA.edges)).toBe(
      serializeCanvas(clientB.nodes, clientB.edges),
    );
  });

  it("buildCanvasData returns canonical, id-sorted records", () => {
    const client = peer(["n-gamma", "n-beta", "n-alpha"], ["e-two", "e-one"], true);

    const data = buildCanvasData(client.nodes, client.edges);

    expect(data.nodes.map((n) => (n as Rec).id)).toEqual(["n-alpha", "n-beta", "n-gamma"]);
    expect(data.edges.map((e) => (e as Rec).id)).toEqual(["e-one", "e-two"]);
    expect(Object.keys(data.nodes[0] as Rec)).toEqual([
      "id",
      "type",
      "x",
      "y",
      "width",
      "height",
      "file",
    ]);
  });

  it("serializeCanvas is exactly the canonical serialisation of buildCanvasData", () => {
    const client = peer(["n-beta", "n-alpha", "n-gamma"], ["e-one", "e-two"], false);

    expect(serializeCanvas(client.nodes, client.edges)).toBe(
      serializeCanonicalCanvas(buildCanvasData(client.nodes, client.edges)),
    );
  });

  it("still prunes a dangling edge before canonicalising (GAP-5 behaviour kept)", () => {
    const client = peer(["n-alpha", "n-beta"], ["e-one"], false);
    client.edges.doc?.transact(() => {
      const orphan = new Y.Map<unknown>();
      client.edges.set("e-orphan", orphan);
      orphan.set("id", "e-orphan");
      orphan.set("fromNode", "n-alpha");
      orphan.set("toNode", "n-missing");
    });

    const data = buildCanvasData(client.nodes, client.edges);

    expect(data.edges.map((e) => (e as Rec).id)).toEqual(["e-one"]);
  });
});
