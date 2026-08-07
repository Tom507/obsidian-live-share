// WP10 / AC1 — blind counterpart 2. Different angle: a SINGLE endpoint is
// rewritten repeatedly on ONE replica, toggling `end` between present and
// absent, to catch a codec that leaves a stale `end` behind when a later
// write omits it — the register is replaced wholesale (BUILD_SPEC §4.3
// "atomic LWW"), never patched field-by-field.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readFrom, writeFrom } from "../../../../../plugin/src/canvas/canvas-registers";

describe("WP10 AC1 blind2 — end does not leak from a previous write when later omitted", () => {
  it("re-routing without end after a re-route WITH end clears the stale end entirely", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e1", record);

    writeFrom(record, "n1", "top", "arrow");
    expect(readFrom(record)).toEqual({ node: "n1", side: "top", end: "arrow" });

    // Re-route again, this time with NO end. The whole register is replaced
    // (atomic LWW), so `end` from the previous write must not survive.
    writeFrom(record, "n2", "bottom");
    const afterOmit = readFrom(record);
    expect(afterOmit).toEqual({ node: "n2", side: "bottom" });
    expect(afterOmit !== undefined && "end" in afterOmit).toBe(false);

    // And re-adding an end on a THIRD write proves the register still
    // accepts one after having been end-less — this is not a one-way latch.
    writeFrom(record, "n3", "left", "none");
    expect(readFrom(record)).toEqual({ node: "n3", side: "left", end: "none" });

    doc.destroy();
  });
});
