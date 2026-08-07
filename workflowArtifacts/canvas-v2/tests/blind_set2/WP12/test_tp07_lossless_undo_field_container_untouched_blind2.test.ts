// WP12 AC3 — same guarantee, attacked with a REPEATED delete/undo cycle
// (delete, undo, delete, undo again) rather than a single cycle, and the
// FieldContainer's set() calls are counted to prove there are ZERO writes to
// the field container across the whole sequence — not merely that delete()
// and clear() were never called.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import type { TombstoneMap } from "../../../canvas/canvas-tombstone";

class FieldContainer {
  private readonly fields = new Map<string, unknown>();
  setCallCount = 0;
  constructor(initial: Record<string, unknown>) {
    for (const [key, value] of Object.entries(initial)) this.fields.set(key, value);
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(): never {
    this.setCallCount += 1;
    throw new Error("FieldContainer.set() was called — a tombstone op must never write to the field container");
  }
  delete(): never {
    throw new Error("FieldContainer.delete() was called — a tombstone op must never destroy the field container");
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

describe("WP12 AC3 — repeated delete/undo cycles never write to the field container, not even once", () => {
  it("two full delete+undo cycles leave every field value untouched and never trigger a field-container write", () => {
    const record = new FieldContainer({
      id: "card-cycle",
      type: "file",
      pos: [3, 4],
      size: [80, 60],
      file: "note.md",
    });
    const originalSnapshot = record.snapshot();

    const map = new StubTombstoneMap();

    applyTombstoneOp(map, "card-cycle", { t: 1, by: "peer-a", on: true });
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-cycle"))).toBe(true);
    applyTombstoneOp(map, "card-cycle", { t: 2, by: "peer-a", on: false });
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-cycle"))).toBe(false);

    applyTombstoneOp(map, "card-cycle", { t: 3, by: "peer-b", on: true });
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-cycle"))).toBe(true);
    applyTombstoneOp(map, "card-cycle", { t: 4, by: "peer-b", on: false });
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-cycle"))).toBe(false);

    expect(record.snapshot()).toEqual(originalSnapshot);
    expect(record.setCallCount).toBe(0);
  });
});
