// WP11 AC1 — same guarantee, attacked from a different angle: the guard's
// notion of "first write" is per RECORD, not a doc-wide flag. Accepting
// record A's first type write must not affect whether a second, unrelated
// record still counts as unwritten.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

describe("WP11 AC1 — first-write acceptance is scoped per record", () => {
  it("accepting record A's first type write does not pre-empt record B's", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const recordA = new Y.Map<unknown>();
    const recordB = new Y.Map<unknown>();
    nodes.set("a", recordA);
    nodes.set("b", recordB);

    const verdictA = guardTypeWrite(recordA, "a", "group");
    expect(verdictA.kind).toBe("accepted");
    expect(recordA.get(V2_FIELD.type)).toBe("group");
    expect(recordB.get(V2_FIELD.type)).toBeUndefined();

    const verdictB = guardTypeWrite(recordB, "b", "file");
    expect(verdictB.kind).toBe("accepted");
    expect(recordB.get(V2_FIELD.type)).toBe("file");
    expect(recordA.get(V2_FIELD.type)).toBe("group");

    doc.destroy();
  });
});
