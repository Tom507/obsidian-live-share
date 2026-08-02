// WP11 / AC1 (first half) — "The first write of `type` on a record is
// accepted."
//
// This is C11's decision function in isolation (BUILD_SPEC §5 C11): input is
// a proposed field write for `type` on a record that has none yet, output is
// accept. Wiring the guard into the real write boundaries is WP18 — out of
// scope here (TaskCharter §2). The guard is exercised directly against a
// record, never through `handleLocalModify` or any capture path.
//
// State is the oracle: the record's stored `type` after the call is the
// primary assertion, the returned verdict is checked alongside it.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

describe("WP11 AC1 — first write of type is accepted", () => {
  it("stores the proposed type and reports 'accepted' when the record has none yet", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n1", record);

    expect(record.get(V2_FIELD.type)).toBeUndefined();

    const verdict = guardTypeWrite(record, "n1", "text");

    expect(verdict.kind).toBe("accepted");
    expect(record.get(V2_FIELD.type)).toBe("text");

    doc.destroy();
  });
});
