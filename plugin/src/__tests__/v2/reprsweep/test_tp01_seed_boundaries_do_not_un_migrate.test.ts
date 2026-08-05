// REPRESENTATION-BLINDNESS SWEEP — member 1 (PRODUCT, LIVE).
//
// THE BLIND CHECK
//   `upsertRecordFields` (`files/canvas-sync.ts`) asks
//   `docValueEquals(record.get(key), value)` — "is the doc already holding this
//   exact value?" — and skips the write when it is. WP36 made `text` / `label`
//   a nested `Y.Text`. A `Y.Text` is never `===` a string and is no register
//   either, so from that day the predicate answered `false` for a
//   BYTE-IDENTICAL restatement. The skip could not fire, and the `set` below it
//   replaced the nested type with a plain string.
//
// WHY NOTHING WENT RED
//   The projected `.canvas`, `canvas.state`, the Surface-Shadow and every
//   cross-replica byte oracle see the SAME string before and after. The only
//   thing that changed is the doc's SHAPE — and the record's whole CRDT
//   history, which is what makes a later concurrent edit merge instead of
//   destroying a peer's characters. The visible symptom is "it merged once and
//   then stopped merging", i.e. flaky sync.
//
// WHY IT IS LIVE, NOT LATENT
//   Both production seed boundaries re-seed a path they have already seeded:
//     ├── `CanvasPersistence.coldOpen` -> `seedDocFromCanvasData`
//     │        -> `seedRecordsIntoYMaps`   (this file's first two tests)
//     └── `CanvasSync.subscribe` -> `applyCanvasToYMaps` -> `seedFlatSpace`
//              -> `writeRecordCreateOnce` -> `upsertRecordFields`
//   and the `.canvas` they read carries the RENDERED string of the very
//   `Y.Text` the write then flattens. `canvas-import.ts:307` is a third caller.
//
// THE PAIR
//   Each repair test has a CONTROL that feeds the repaired check a value it
//   MUST still reject, so the repair cannot have been a blanket skip. A skip
//   that always fires is the same defect one step along.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type FlatCanvasData,
  applyToYMap,
  seedRecordsIntoYMaps,
} from "../../../files/canvas-sync";

const SEED_ORIGIN = Symbol("reprsweep-seed");

function flat(text: string): FlatCanvasData {
  return {
    nodes: {
      c1: { id: "c1", type: "text", x: 0, y: 0, width: 260, height: 120, text },
    },
    edges: {},
  } as unknown as FlatCanvasData;
}

/** A doc whose one record has ALREADY migrated: `text` is a nested `Y.Text`. */
function migratedDoc(text: string): { doc: Y.Doc; nodes: Y.Map<Y.Map<unknown>> } {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set("id", "c1");
    record.set("type", "text");
    record.set("x", 0);
    record.set("y", 0);
    record.set("width", 260);
    record.set("height", 120);
    record.set("text", new Y.Text(text));
    nodes.set("c1", record);
  });
  return { doc, nodes };
}

const textOf = (nodes: Y.Map<Y.Map<unknown>>) => nodes.get("c1")?.get("text");

describe("reprsweep 1 — a seed may not un-migrate a Y.Text it is merely restating", () => {
  it("COLD-OPEN SEED: a byte-identical restatement leaves the Y.Text alone", () => {
    const { doc, nodes } = migratedDoc("AliceBob");
    const before = textOf(nodes);
    expect(before, "precondition: the record has not migrated").toBeInstanceOf(Y.Text);

    // The `.canvas` on disk holds the RENDERED string — the projection of the
    // very `Y.Text` above. This is the ordinary state at every re-open.
    seedRecordsIntoYMaps(doc, flat("AliceBob"), SEED_ORIGIN);

    const after = textOf(nodes);
    expect(
      after,
      "the cold-open seed flattened the Y.Text while restating its own rendered string",
    ).toBeInstanceOf(Y.Text);
    // Identity, not just shape: a fresh `Y.Text` carrying the same characters
    // would already have thrown the record's history away.
    expect(after, "the nested type was REPLACED rather than left alone").toBe(before);
    expect((after as Y.Text).toString()).toBe("AliceBob");
  });

  it("HOST-SEED HELPER (`applyToYMap`): the same restatement, the same verdict", () => {
    const doc = new Y.Doc();
    const record = doc.getMap<unknown>("record") as unknown as Y.Map<unknown>;
    doc.transact(() => {
      record.set("id", "c1");
      record.set("label", new Y.Text("depends on"));
    });
    const before = record.get("label");

    applyToYMap(record, { id: "c1", label: "depends on" });

    expect(
      record.get("label"),
      "the host seed flattened an edge label it was only restating",
    ).toBeInstanceOf(Y.Text);
    expect(record.get("label")).toBe(before);
  });

  it("the CRDT history survives, which is the whole point of not flattening", () => {
    const { doc, nodes } = migratedDoc("AliceBob");
    seedRecordsIntoYMaps(doc, flat("AliceBob"), SEED_ORIGIN);

    // A peer's concurrent character, applied as a real op on the nested text.
    // On a flattened record there is no nested text to apply it to at all.
    const ytext = textOf(nodes) as Y.Text;
    ytext.insert(5, "Y");
    expect(ytext.toString()).toBe("AliceYBob");
  });

  // ---- THE CONTROLS: the repaired check must STILL be able to fire ----------

  it("CONTROL — a genuinely DIFFERENT string is still written, not silently skipped", () => {
    const { doc, nodes } = migratedDoc("AliceBob");
    seedRecordsIntoYMaps(doc, flat("AliceBobX"), SEED_ORIGIN);

    // The write is NOT suppressed. (It still flattens; that residual is a
    // routing question, not a blind check, and it is carried up rather than
    // closed here — see the report's "found, not repaired" section.)
    const after = textOf(nodes);
    expect(String(after), "a real seed proposal was swallowed by the new skip").toBe("AliceBobX");
  });

  it("CONTROL — the skip is keyed on the RENDERED value, not on the field name", () => {
    const { doc, nodes } = migratedDoc("AliceBob");
    // One space of difference. If the guard compared anything coarser than the
    // exact characters, this would be skipped and the proposal lost.
    seedRecordsIntoYMaps(doc, flat("AliceBob "), SEED_ORIGIN);
    expect(String(textOf(nodes))).toBe("AliceBob ");
  });

  it("CONTROL — a plain-string record is unaffected: the ordinary skip still works", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({
        id: "c1",
        type: "text",
        x: 0,
        y: 0,
        width: 260,
        height: 120,
        text: "AliceBob",
      })) {
        record.set(k, v);
      }
      nodes.set("c1", record);
    });

    // A restatement of a plain string must still emit NO update at all — that
    // is the property `docValueEquals` exists for, and the repair may not have
    // disturbed it.
    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });
    seedRecordsIntoYMaps(doc, flat("AliceBob"), SEED_ORIGIN);
    expect(updates, "the plain-string restatement was written again").toBe(0);
    expect(typeof textOf(nodes)).toBe("string");
  });

  it("CONTROL — the migrated restatement emits NO update either", () => {
    const { doc, nodes } = migratedDoc("AliceBob");
    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });
    seedRecordsIntoYMaps(doc, flat("AliceBob"), SEED_ORIGIN);
    expect(updates, "the restatement still produced a CRDT write").toBe(0);
    expect(textOf(nodes)).toBeInstanceOf(Y.Text);
  });
});
