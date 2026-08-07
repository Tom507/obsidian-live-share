// WP11 / AC1 (second half) — "every subsequent write with a different value
// is rejected and produces a signature in the log."
//
// Project rule: state is the oracle, log strings are for humans. The record's
// stored `type` staying UNCHANGED after a rejected write is the primary
// check, alongside the returned verdict's `kind`. The emitted signature is a
// SECONDARY assertion — only that one was produced, and that it names the
// record and the offending (proposed) value — never asserted as an exact
// hardcoded string.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

describe("WP11 AC1 — a later differing write is rejected with a signature", () => {
  it("leaves the stored type unchanged and returns a signature naming the record and the offending value", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n9", record);

    const first = guardTypeWrite(record, "n9", "text");
    expect(first.kind).toBe("accepted");

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    doc.on("update", onUpdate);
    const verdict = guardTypeWrite(record, "n9", "link");
    doc.off("update", onUpdate);

    // Primary oracle: state. A rejected write must never touch the stored
    // value, and — as a direct structural consequence — must never open a
    // CRDT write either.
    expect(record.get(V2_FIELD.type)).toBe("text");
    expect(updateCount).toBe(0);

    // Primary oracle: the returned verdict.
    expect(verdict.kind).toBe("rejected");

    // Secondary oracle: a signature was produced and names the record + the
    // offending value.
    if (verdict.kind !== "rejected") throw new Error("unreachable");
    expect(typeof verdict.signature).toBe("string");
    expect(verdict.signature.length).toBeGreaterThan(0);
    expect(verdict.signature).toContain("n9");
    expect(verdict.signature).toContain("link");

    doc.destroy();
  });
});
