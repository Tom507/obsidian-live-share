// WP24 / AC3 blind1 — the partial-application prohibition, attacked by sliding
// the poisoned frame through every position of a seven-frame history.
//
// Different angle: the visible test poisons frame 4 of 5 once. Here the poison
// walks positions 0..6 and the assertion is comparative rather than absolute —
// the reloaded doc must be indistinguishable from a doc that never called
// `load` at all, for EVERY poison position. That kills the whole family of
// "apply until it breaks" implementations at once, including the subtle variant
// that pre-scans the frame lengths (so it survives the truncation tests) and
// still streams the payloads into the doc one by one.
//
// Position 0 is included deliberately: a store that fails on the very first
// frame looks correct under any "nothing was applied" check, so it is the row
// that would let a broken implementation claim the suite is passing.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-partial";
const POISON = new TextEncoder().encode("<<< not a yjs update, not even close >>>");

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sevenUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  const nodes = doc.getMap("nodes");
  for (let i = 0; i < 6; i++) nodes.set(`w${i}`, { index: i, note: `record ${i}` });
  nodes.delete("w2");
  return out;
}

function makeIO(history: Uint8Array) {
  const disk = new Map<string, Uint8Array>([[sidecarHistoryPath(GUID), history]]);
  return {
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (): Promise<void> => undefined,
    append: async (): Promise<void> => undefined,
    truncate: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  };
}

describe("WP24 AC3 blind1 — poison at any position leaves the doc pristine", () => {
  const updates = sevenUpdates();

  it("PREMISE: seven real updates and a payload Yjs refuses", () => {
    expect(updates).toHaveLength(7);
    expect(() => Y.applyUpdate(new Y.Doc(), POISON)).toThrow();
    const control = new Y.Doc();
    for (const update of updates) Y.applyUpdate(control, update);
    expect(Object.keys(control.getMap("nodes").toJSON())).toHaveLength(5);
  });

  it("for every poison position the doc is byte-for-byte a doc that never loaded", async () => {
    const untouched = new Y.Doc();
    const reference = {
      sv: [...Y.encodeStateVector(untouched)].join(","),
      json: JSON.stringify(untouched.getMap("nodes").toJSON()),
    };

    for (let position = 0; position < updates.length; position++) {
      const frames = updates.map((update, index) =>
        frame(index === position ? POISON : update),
      );
      const store = createSidecarStore(makeIO(join(frames)));

      const doc = new Y.Doc();
      const events: unknown[] = [];
      doc.on("update", (u: Uint8Array) => events.push(u));

      const result = await store.load(GUID, doc);

      expect(result.degradation, `poison at ${position}`).toBe(SIDECAR_DEGRADATION.CORRUPT);
      expect(result.historyEntriesApplied, `poison at ${position}`).toBe(0);
      expect(events, `poison at ${position}`).toHaveLength(0);
      expect([...Y.encodeStateVector(doc)].join(","), `poison at ${position}`).toBe(reference.sv);
      expect(JSON.stringify(doc.getMap("nodes").toJSON()), `poison at ${position}`).toBe(
        reference.json,
      );
    }
  });

  it("the clean history over the same frames loads all seven — the sweep is not vacuous", async () => {
    const store = createSidecarStore(makeIO(join(updates.map(frame))));
    const doc = new Y.Doc();

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(7);
    expect(Object.keys(doc.getMap("nodes").toJSON())).toHaveLength(5);
  });

  it("a doc carrying unrelated local work keeps it, unchanged, after a poisoned load", async () => {
    const frames = updates.map((update, index) => frame(index === 3 ? POISON : update));
    const store = createSidecarStore(makeIO(join(frames)));

    const doc = new Y.Doc();
    doc.getArray("mine").push(["local A", "local B"]);
    const before = JSON.stringify([
      [...Y.encodeStateVector(doc)],
      doc.getArray("mine").toArray(),
      doc.getMap("nodes").toJSON(),
    ]);

    await store.load(GUID, doc);

    expect(
      JSON.stringify([
        [...Y.encodeStateVector(doc)],
        doc.getArray("mine").toArray(),
        doc.getMap("nodes").toJSON(),
      ]),
    ).toBe(before);
  });
});
