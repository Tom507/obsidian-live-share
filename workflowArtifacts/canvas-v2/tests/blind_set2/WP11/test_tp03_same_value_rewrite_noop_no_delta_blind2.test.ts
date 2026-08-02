// WP11 AC2 — same guarantee, attacked from the repeated-idempotence angle:
// THREE consecutive same-value re-attempts, not one, must each individually
// stay a no-op — proving the guard checks the record's actual current state
// on every call rather than only ever getting it right the first time.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

describe("WP11 AC2 — repeated same-value rewrites stay a no-op every time", () => {
  it("fires zero update events across three consecutive identical re-attempts", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n42", record);

    const first = guardTypeWrite(record, "n42", "url");
    expect(first.kind).toBe("accepted");

    const stateVectorAfterFirstWrite = Y.encodeStateVector(doc);

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    doc.on("update", onUpdate);

    for (let i = 0; i < 3; i++) {
      const verdict = guardTypeWrite(record, "n42", "url");
      expect(verdict.kind).toBe("noop");
      expect("signature" in verdict).toBe(false);
    }

    doc.off("update", onUpdate);

    expect(record.get(V2_FIELD.type)).toBe("url");
    expect(
      updateCount,
      "three consecutive same-value re-attempts must fire zero update events combined",
    ).toBe(0);

    const deltaSinceFirstWrite = Y.encodeStateAsUpdate(doc, stateVectorAfterFirstWrite);
    const emptyReferenceDoc = new Y.Doc();
    const emptyReferenceUpdate = Y.encodeStateAsUpdate(
      emptyReferenceDoc,
      Y.encodeStateVector(emptyReferenceDoc),
    );
    expect(Array.from(deltaSinceFirstWrite)).toEqual(Array.from(emptyReferenceUpdate));

    emptyReferenceDoc.destroy();
    doc.destroy();
  });
});
