// WP12 AC3 — same guarantee, attacked from a different angle: an EDGE
// record (from/to endpoints, label, color) rather than a node, and the
// delete+undo cycle is run on a QUARANTINE entry (q:true) rather than a
// plain delete, proving losslessness holds for the quarantine path too.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import type { TombstoneMap } from "../../../canvas/canvas-tombstone";

class FieldContainer {
  private readonly fields = new Map<string, unknown>();
  constructor(initial: Record<string, unknown>) {
    for (const [key, value] of Object.entries(initial)) this.fields.set(key, value);
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  delete(): never {
    throw new Error("FieldContainer.delete() was called — a tombstone op must never destroy the field container");
  }
  clear(): never {
    throw new Error("FieldContainer.clear() was called — a tombstone op must never destroy the field container");
  }
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.fields);
  }
}

class StubTombstoneMap implements TombstoneMap {
  private readonly entries = new Map<string, unknown>();
  get(key: string): unknown {
    return this.entries.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.entries.set(key, value);
    return value;
  }
}

describe("WP12 AC3 — an edge record survives a quarantine+release cycle with every field intact", () => {
  it("from/to/label/color survive untouched, and the field container is never deleted/cleared", () => {
    const edgeRecord = new FieldContainer({
      id: "edge-9",
      from: { node: "n1", side: "right" },
      to: { node: "n2", side: "left" },
      label: "depends on",
      color: "6",
    });
    const originalSnapshot = edgeRecord.snapshot();

    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "edge-9", { t: 1, by: "auditor", on: true, q: true }); // quarantine
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "edge-9"))).toBe(true);
    expect(edgeRecord.snapshot()).toEqual(originalSnapshot);

    applyTombstoneOp(map, "edge-9", { t: 2, by: "auditor", on: false }); // release
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "edge-9"))).toBe(false);
    expect(edgeRecord.snapshot()).toEqual(originalSnapshot);
  });
});
