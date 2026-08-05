// REPRESENTATION-BLINDNESS SWEEP — members 3 and 4.
//
// ── member 3 (PRODUCT, LATENT) ────────────────────────────────────────────
//   `writeRecordMinimal` (`canvas/canvas-binding.ts`) is the binding's minimal
//   diff: `if (ymap.get(key) !== value) ymap.set(key, value)`. A nested
//   `Y.Text` is never `===` the string that renders it, so for a migrated
//   `text` / `label` the "is this actually a change?" test could not answer
//   NO. Every capture then emitted a Yjs update for a value nobody altered AND
//   replaced the nested type with a plain string.
//
//   LATENT rather than live: the binding is constructed only when
//   `settings.useCanvasBinding` is ON (`types.ts:181` ships it `false`), so no
//   default install reaches it. It is NOT unreachable — `ui/settings.ts:303`
//   is a user-facing toggle, and this repository's own fuzzer drives
//   `captureLocal` directly in `standard-ops.ts`'s `partialCapture` op.
//
// ── member 4 (HARNESS, LATENT) ────────────────────────────────────────────
//   The `[i7]` family's unmentioned-field check was
//   `now !== value && JSON.stringify(now) !== JSON.stringify(value)`.
//   `Y.Text.prototype.toJSON` returns the plain string, so a `Y.Text("x")`
//   replaced by `"x"` compared EQUAL and the family could not see the
//   un-migration member 3 produces. This is the "right by accident" shape
//   C36 AC4 found in the projection, one layer up in the instrument.
//
//   Note the composition: member 4 is precisely the check that would have
//   caught member 3. Two independent representation blindnesses, one masking
//   the other — which is why the sweep had to be derived rather than reasoned.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasBinding, type CanvasModelBridge } from "../../../canvas/canvas-binding";
import { i7FieldValueChanged } from "../../harness/fuzz/standard-ops";

/** The same inert bridge shape the fuzzer's own `partialCapture` op uses. */
class InertBridge implements CanvasModelBridge {
  getNodeIds(): Iterable<string> {
    return [];
  }
  getEdgeIds(): Iterable<string> {
    return [];
  }
  getNode(): null {
    return null;
  }
  getEdge(): null {
    return null;
  }
  applyNodeUpsert(): void {}
  applyNodeRemove(): void {}
  applyEdgeUpsert(): void {}
  applyEdgeRemove(): void {}
  onLocalChange(): () => void {
    return () => {};
  }
}

function migratedNode(doc: Y.Doc, text: string): Y.Map<unknown> {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  doc.transact(() => {
    record.set("id", "n1");
    record.set("type", "text");
    record.set("text", new Y.Text(text));
    nodes.set("n1", record);
  });
  return record;
}

describe("reprsweep 3 — the binding's minimal diff is minimal for a Y.Text too", () => {
  it("a byte-identical restatement neither rewrites nor un-migrates the field", () => {
    const doc = new Y.Doc();
    const record = migratedNode(doc, "card one");
    const before = record.get("text");
    expect(before).toBeInstanceOf(Y.Text);

    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });

    const binding = new CanvasBinding(doc, new InertBridge(), { seedModelFromDoc: false });
    binding.captureLocal({
      kind: "node",
      id: "n1",
      record: { id: "n1", type: "text", text: "card one" },
    });
    binding.destroy();

    expect(
      record.get("text"),
      "the binding flattened a Y.Text it was only restating",
    ).toBeInstanceOf(Y.Text);
    expect(record.get("text"), "the nested type was replaced rather than left alone").toBe(before);
    expect(updates, "a value nobody altered still produced a CRDT update").toBe(0);
  });

  it("CONTROL — a genuinely different string is still captured", () => {
    const doc = new Y.Doc();
    const record = migratedNode(doc, "card one");

    const binding = new CanvasBinding(doc, new InertBridge(), { seedModelFromDoc: false });
    binding.captureLocal({
      kind: "node",
      id: "n1",
      record: { id: "n1", type: "text", text: "card two" },
    });
    binding.destroy();

    expect(String(record.get("text")), "a real local edit was swallowed").toBe("card two");
  });

  it("CONTROL — a plain-string field behaves exactly as it did before", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    doc.transact(() => {
      record.set("id", "n1");
      record.set("text", "card one");
      nodes.set("n1", record);
    });

    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });
    const binding = new CanvasBinding(doc, new InertBridge(), { seedModelFromDoc: false });
    binding.captureLocal({ kind: "node", id: "n1", record: { id: "n1", text: "card one" } });
    expect(updates).toBe(0);
    binding.captureLocal({ kind: "node", id: "n1", record: { id: "n1", text: "card two" } });
    binding.destroy();
    expect(record.get("text")).toBe("card two");
    expect(updates).toBeGreaterThan(0);
  });
});

/**
 * The comparison as `standard-ops.ts` held it before this sweep, VERBATIM.
 *
 * It is kept executable rather than quoted. An assertion's blindness is a
 * property of the code that was there, so the only honest way to show it is to
 * run it — and a control that is only described in a comment stops being true
 * the moment somebody edits the comment.
 */
const preRepairI7Changed = (before: unknown, now: unknown): boolean =>
  now !== before && JSON.stringify(now) !== JSON.stringify(before);

describe("reprsweep 4 — the [i7] value check sees the SHAPE, not only the JSON", () => {
  it("PRE-REPAIR CONTROL: the inherited comparison calls the un-migration UNCHANGED", () => {
    const doc = new Y.Doc();
    const held = new Y.Text("x");
    doc.getMap<unknown>("r").set("text", held);

    // This is the blindness, executed. The field's nested type was destroyed
    // and the [i7] family was told nothing happened.
    expect(preRepairI7Changed(held, "x")).toBe(false);
    // ...while the repaired one says it changed.
    expect(i7FieldValueChanged(held, "x")).toBe(true);

    // And the pre-repair comparison was NOT broken in general — which is why
    // nobody noticed. It still discriminates everything it used to.
    expect(preRepairI7Changed("same", "same")).toBe(false);
    expect(preRepairI7Changed("same", "other")).toBe(true);
    expect(preRepairI7Changed(Object.freeze([20, 40]), Object.freeze([20, 40]))).toBe(false);
    expect(preRepairI7Changed(Object.freeze([20, 40]), Object.freeze([20, 60]))).toBe(true);
  });

  it("THE BLIND CASE: a Y.Text replaced by its own rendered string is a change", () => {
    // The `Y.Text` has to be ATTACHED for this, and that is the real case: a
    // DETACHED one's `toJSON` answers `""` (Yjs queues the content until
    // integration), so a fixture built off a bare `new Y.Text("x")` would
    // reproduce nothing and the demonstration would be vacuous.
    const doc = new Y.Doc();
    const held = new Y.Text("x");
    doc.getMap<unknown>("r").set("text", held);

    expect(JSON.stringify(held), "the fixture is not attached — nothing is proven").toBe(
      JSON.stringify("x"),
    );
    expect(
      i7FieldValueChanged(held, "x"),
      "the [i7] check cannot see a Y.Text being replaced by a plain string",
    ).toBe(true);
    expect(i7FieldValueChanged("x", held)).toBe(true);
  });

  it("CONTROL — the register arm the JSON comparison exists for still works", () => {
    // `encodePos` freezes a NEW array per call, so a same-pixel restatement is
    // reference-unequal and value-equal. Comparing by reference would make the
    // family fire on every restatement; that arm must survive the repair.
    expect(i7FieldValueChanged(Object.freeze([20, 40]), Object.freeze([20, 40]))).toBe(false);
    expect(i7FieldValueChanged(Object.freeze([20, 40]), Object.freeze([20, 60]))).toBe(true);
  });

  it("CONTROL — ordinary equal and unequal primitives are unaffected", () => {
    expect(i7FieldValueChanged("same", "same")).toBe(false);
    expect(i7FieldValueChanged("same", "other")).toBe(true);
    expect(i7FieldValueChanged(7, 7)).toBe(false);
    expect(i7FieldValueChanged(7, 8)).toBe(true);
    expect(i7FieldValueChanged(undefined, undefined)).toBe(false);
  });

  it("CONTROL — two Y.Texts holding the same characters are still unchanged", () => {
    const same = new Y.Text("x");
    expect(i7FieldValueChanged(same, same)).toBe(false);
  });
});
