// WP28 / AC1 (second half) — "`meta.epoch` is monotonic and host-incremented".
//
// MONOTONIC is a property of the WRITER, not of the comparator: `nextEpoch` must
// return a value strictly greater than the normalised current one, for every
// input, including the corrupt ones. `epoch + 1` on a doc whose cell holds
// `undefined` produces `NaN`, and `NaN` normalises to 0 — so a single corrupt
// cell would pin the board at epoch 0 forever and every subsequent import would
// silently stop being able to win. `Number("9") + 1` produces 10 out of a value
// that is not an epoch at all.
//
// HOST-INCREMENTED is why the epoch rule can be asserted deterministically at
// all, and it is asserted here as SINGLE AUTHORSHIP: one bump is exactly one
// transaction that touches `meta` and nothing else, and it leaves `guid` and
// `path` — WP27's, not WP28's — byte-identical. Two peers bumping concurrently
// would be a genuine clientID tie-break; the mechanism exists precisely so that
// never happens, and the bump being one doc-local write by one author is the
// shape that guarantees it.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { EPOCH_KEY, GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
import { bumpEpoch, nextEpoch, readEpoch } from "../../../canvas/canvas-epoch";
import { CANVAS_PATH, FIXED_GUID, createProbe, makeDoc, metaSnapshot, node } from "./harness";

describe("WP28 AC1 — the epoch is monotonic", () => {
  it("`nextEpoch` is strictly greater than the current epoch, always", () => {
    for (const current of [0, 1, 2, 7, 41, 1000, Number.MAX_SAFE_INTEGER - 2]) {
      expect(nextEpoch(current), `next(${current})`).toBeGreaterThan(current);
      expect(nextEpoch(current)).toBe(current + 1);
    }
  });

  it("a corrupt or absent epoch bumps to 1 — never to NaN and never to 0", () => {
    for (const corrupt of [undefined, null, Number.NaN, "3", -4, 1.5, true, {}]) {
      const produced = nextEpoch(corrupt);
      expect(
        produced,
        `nextEpoch(${JSON.stringify(corrupt) ?? String(corrupt)}) produced ${produced} — ` +
          "a corrupt cell must not freeze the board's epoch",
      ).toBe(1);
    }
  });

  it("repeated bumping never decreases and never repeats a value", () => {
    const doc = makeDoc({ epoch: 0, nodes: { "n-a": node("n-a", "alpha") } });
    const seen: number[] = [readEpoch(doc)];
    for (let i = 0; i < 12; i++) {
      const produced = bumpEpoch(doc);
      expect(produced, "the bump must return the value it wrote").toBe(readEpoch(doc));
      expect(produced).toBeGreaterThan(seen[seen.length - 1]);
      seen.push(produced);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(seen).size, "a bump repeated a value").toBe(seen.length);
    doc.destroy();
  });

  it("a bump on an UNSTAMPED doc lands on 1 and reads back as 1", () => {
    const doc = new Y.Doc();
    expect(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBeUndefined();
    expect(readEpoch(doc)).toBe(0);
    expect(bumpEpoch(doc)).toBe(1);
    expect(readEpoch(doc)).toBe(1);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBe(1);
    doc.destroy();
  });

  it("a bump repairs a corrupt cell instead of propagating it", () => {
    const doc = makeDoc({ epoch: "9" });
    expect(bumpEpoch(doc)).toBe(1);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBe(1);
    doc.destroy();
  });
});

describe("WP28 AC1 — the epoch is HOST-incremented: one author, one write", () => {
  it("one bump is exactly ONE transaction, and it touches only `meta`", () => {
    const doc = makeDoc({ epoch: 4, nodes: { "n-a": node("n-a", "alpha") } });
    const probe = createProbe();
    probe.watch(doc);

    bumpEpoch(doc);

    expect(
      probe.transactions.length,
      "a bump must be one transaction — two make the increment observable half-done",
    ).toBe(1);
    expect(probe.transactions[0].touchedTypes).toEqual(["meta"]);
    doc.destroy();
  });

  it("a bump leaves WP27's identity keys exactly as they were", () => {
    const doc = makeDoc({ epoch: 4 });
    const before = metaSnapshot(doc);

    bumpEpoch(doc);

    const after = metaSnapshot(doc);
    expect(after[GUID_KEY]).toBe(FIXED_GUID);
    expect(after[PATH_KEY]).toBe(CANVAS_PATH);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect({ ...after, [EPOCH_KEY]: null }).toEqual({ ...before, [EPOCH_KEY]: null });
    doc.destroy();
  });

  it("a bump does not touch the records — the epoch is metadata, not content", () => {
    const doc = makeDoc({
      epoch: 2,
      nodes: { "n-a": node("n-a", "alpha"), "n-b": node("n-b", "beta", 400) },
      edges: { "e-1": { id: "e-1", fromNode: "n-a", toNode: "n-b" } },
    });
    const beforeNodes = JSON.stringify(
      Object.fromEntries([...doc.getMap<Y.Map<unknown>>("nodes")].map(([id, m]) => [id, m.toJSON()])),
    );

    bumpEpoch(doc);

    const afterNodes = JSON.stringify(
      Object.fromEntries([...doc.getMap<Y.Map<unknown>>("nodes")].map(([id, m]) => [id, m.toJSON()])),
    );
    expect(afterNodes).toBe(beforeNodes);
    expect([...doc.getMap<Y.Map<unknown>>("edges").keys()]).toEqual(["e-1"]);
    doc.destroy();
  });

  it("`readEpoch` never writes — reading an unstamped doc leaves it unstamped", () => {
    const doc = new Y.Doc();
    const probe = createProbe();
    probe.watch(doc);

    expect(readEpoch(doc)).toBe(0);
    expect(readEpoch(doc)).toBe(0);

    expect(probe.transactions, "`readEpoch` opened a transaction").toEqual([]);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBeUndefined();
    doc.destroy();
  });
});
