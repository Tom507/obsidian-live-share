import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

// WP3 DoD — identical bytes from identical doc state.
// Angle: HISTORY independence rather than insertion-order independence. One
// replica reaches the final state through a long edit history (create, move,
// rename a field, delete a node, re-add it); the other is constructed directly
// in that final state. Byte equality must depend on the STATE only — that is the
// property the byte-equality echo breaker (D9) is built on.

type Rec = Record<string, unknown>;

interface Doc {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

function fresh(): Y.Doc & { view: Doc } {
  const doc = new Y.Doc() as Y.Doc & { view: Doc };
  doc.view = {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
  return doc;
}

function upsert(map: Y.Map<Y.Map<unknown>>, id: string, fields: Rec): void {
  let record = map.get(id);
  if (!record) {
    record = new Y.Map<unknown>();
    map.set(id, record);
  }
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

const FINAL_NODES: Record<string, Rec> = {
  keep: { id: "keep", type: "text", x: 500, y: -20, width: 250, height: 60, text: "final" },
  revived: { id: "revived", type: "file", x: 0, y: 0, width: 400, height: 400, file: "R.md" },
};

describe("byte equality depends on state, not on how the state was reached", () => {
  it("matches a directly-built replica after a long edit history", () => {
    const edited = fresh();
    edited.transact(() => {
      upsert(edited.view.nodes, "keep", { id: "keep", type: "text", x: 0, y: 0, width: 1, height: 1, text: "draft" });
      upsert(edited.view.nodes, "revived", FINAL_NODES.revived);
      upsert(edited.view.nodes, "gone", { id: "gone", type: "text", x: 9, y: 9, width: 1, height: 1, text: "bye" });
    });
    edited.transact(() => {
      upsert(edited.view.nodes, "keep", { x: 500, y: -20, width: 250, height: 60, text: "final" });
      edited.view.nodes.delete("gone");
    });
    edited.transact(() => {
      edited.view.nodes.delete("revived");
      upsert(edited.view.nodes, "revived", FINAL_NODES.revived);
    });

    const direct = fresh();
    direct.transact(() => {
      upsert(direct.view.nodes, "revived", FINAL_NODES.revived);
      upsert(direct.view.nodes, "keep", FINAL_NODES.keep);
    });

    expect(serializeCanvas(edited.view.nodes, edited.view.edges)).toBe(
      serializeCanvas(direct.view.nodes, direct.view.edges),
    );
  });

  it("keeps the seam identity serializeCanvas === canonical(buildCanvasData)", () => {
    const doc = fresh();
    doc.transact(() => {
      upsert(doc.view.nodes, "keep", FINAL_NODES.keep);
      upsert(doc.view.nodes, "revived", FINAL_NODES.revived);
      upsert(doc.view.edges, "e", {
        id: "e",
        fromNode: "revived",
        fromSide: "right",
        toNode: "keep",
        toSide: "left",
      });
    });

    expect(serializeCanvas(doc.view.nodes, doc.view.edges)).toBe(
      serializeCanonicalCanvas(buildCanvasData(doc.view.nodes, doc.view.edges)),
    );
  });

  it("does not let a per-key rewrite change the emitted key order", () => {
    const doc = fresh();
    doc.transact(() => upsert(doc.view.nodes, "keep", FINAL_NODES.keep));
    const before = serializeCanvas(doc.view.nodes, doc.view.edges);

    // Re-set the same values in reverse order — a real per-key LWW merge does
    // exactly this when a peer's delta arrives key by key.
    doc.transact(() => {
      const record = doc.view.nodes.get("keep") as Y.Map<unknown>;
      for (const [key, value] of Object.entries(FINAL_NODES.keep).reverse()) {
        record.delete(key);
        record.set(key, value);
      }
    });

    expect(serializeCanvas(doc.view.nodes, doc.view.edges)).toBe(before);
  });

  it("still writes an empty edges array when every edge was deleted", () => {
    const doc = fresh();
    doc.transact(() => {
      upsert(doc.view.nodes, "keep", FINAL_NODES.keep);
      upsert(doc.view.edges, "tmp", { id: "tmp", fromNode: "keep", toNode: "keep" });
    });
    doc.transact(() => doc.view.edges.delete("tmp"));

    expect(serializeCanvas(doc.view.nodes, doc.view.edges)).toContain('"edges": []');
  });
});
