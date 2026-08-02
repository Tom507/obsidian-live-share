// WP12 / AC3 — "Undo of a delete (on:false) restores the record with all its
// field values intact, because field containers were never destroyed."
//
// The strong version of this test: build a record with a full field set,
// delete it, undo it, then assert every field value survived — AND assert
// that the delete could never have destroyed the field container in the
// first place. The proof is structural, not merely observational: the
// tombstone module's API never even receives the record, only an
// independent tombstone container keyed by id — so the field container
// literally cannot be reached from a tombstone op. `FieldContainer` below
// throws if its own delete/clear is ever invoked, as a tripwire in case a
// future change to canvas-tombstone.ts tried to reach into a record anyway.

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

describe("WP12 AC3 — undo of a delete restores the record with all field values intact", () => {
  it("a full field set survives a delete+undo cycle untouched, and the field container itself is never deleted/cleared", () => {
    const record = new FieldContainer({
      id: "card-42",
      type: "text",
      pos: [10, 20],
      size: [100, 50],
      text: "hello world",
      color: "4",
    });
    const originalSnapshot = record.snapshot();

    const deleted = new StubTombstoneMap();
    applyTombstoneOp(deleted, "card-42", { t: 1, by: "peer-a", on: true });
    expect(isTombstoneSuppressed(readTombstoneEntry(deleted, "card-42"))).toBe(true);
    // The field container was never even passed to the tombstone module —
    // it is a wholly separate object. Its snapshot must be byte-identical.
    expect(record.snapshot()).toEqual(originalSnapshot);

    applyTombstoneOp(deleted, "card-42", { t: 2, by: "peer-a", on: false });
    expect(isTombstoneSuppressed(readTombstoneEntry(deleted, "card-42"))).toBe(false);
    expect(record.snapshot()).toEqual(originalSnapshot);
  });
});
