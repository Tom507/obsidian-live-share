// WP11 / AC2 — "A subsequent write with the SAME value is a no-op and
// produces no delta and no signature."
//
// The sharpest AC here (TaskCharter test-design rules): a deep-equal on the
// stored value would pass even if the guard re-set an identical value — Yjs
// still emits a real `update` for a same-value LWW `set` (verified
// precedent: WP8 tp04, `test_tp04_migration_idempotent_no_delta_visible`).
// The real oracle is the CRDT delta: snapshot the state vector right after
// the accepted first write, attempt the identical value again while counting
// `update` events, then diff the encoded update against the snapshot. Zero
// events AND an empty delta is what "no delta" means for a CRDT — `update`
// (unlike `afterTransaction`, which fires even for an empty `doc.transact()`)
// only fires when a transaction actually produced content.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

describe("WP11 AC2 — a same-value rewrite is a no-op: zero delta, zero signature", () => {
  it("produces no update event and no encoded delta when the value is re-submitted unchanged", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n5", record);

    const first = guardTypeWrite(record, "n5", "text");
    expect(first.kind).toBe("accepted");

    const stateVectorAfterFirstWrite = Y.encodeStateVector(doc);

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    doc.on("update", onUpdate);
    const verdict = guardTypeWrite(record, "n5", "text");
    doc.off("update", onUpdate);

    expect(verdict.kind).toBe("noop");
    expect("signature" in verdict).toBe(false);
    expect(record.get(V2_FIELD.type)).toBe("text");
    expect(updateCount, "a same-value rewrite must fire zero update events").toBe(0);

    const deltaSinceFirstWrite = Y.encodeStateAsUpdate(doc, stateVectorAfterFirstWrite);
    const emptyReferenceDoc = new Y.Doc();
    const emptyReferenceUpdate = Y.encodeStateAsUpdate(
      emptyReferenceDoc,
      Y.encodeStateVector(emptyReferenceDoc),
    );
    expect(
      Array.from(deltaSinceFirstWrite),
      "a same-value rewrite must produce zero further CRDT delta",
    ).toEqual(Array.from(emptyReferenceUpdate));

    emptyReferenceDoc.destroy();
    doc.destroy();
  });
});
