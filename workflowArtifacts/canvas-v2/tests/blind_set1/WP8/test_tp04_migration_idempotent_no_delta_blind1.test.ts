// WP8 AC3 — same update-delta oracle, attacked from the "nothing to
// migrate" angle: a doc that was NEVER V1-shaped at all (zero records,
// meta ensured by the very first migrateV1ToV2 call). If idempotence only
// holds for docs that had real V1 records to translate, a fresh-doc caller
// (every brand-new canvas, per the WP's own Interfaces block) would still
// see a spurious delta on every subsequent open.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

describe("WP8 AC3 — idempotence holds for a doc with zero records too", () => {
  it("a second migrateV1ToV2 call on a fresh (record-less) doc produces zero delta and zero update events", () => {
    const doc = new Y.Doc();

    migrateV1ToV2(doc);
    const stateVectorAfterFirstCall = Y.encodeStateVector(doc);

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    doc.on("update", onUpdate);
    migrateV1ToV2(doc);
    doc.off("update", onUpdate);

    const delta = Y.encodeStateAsUpdate(doc, stateVectorAfterFirstCall);

    const emptyReferenceDoc = new Y.Doc();
    const emptyReferenceUpdate = Y.encodeStateAsUpdate(
      emptyReferenceDoc,
      Y.encodeStateVector(emptyReferenceDoc),
    );

    expect(Array.from(delta)).toEqual(Array.from(emptyReferenceUpdate));
    expect(updateCount).toBe(0);

    emptyReferenceDoc.destroy();
    doc.destroy();
  });
});
