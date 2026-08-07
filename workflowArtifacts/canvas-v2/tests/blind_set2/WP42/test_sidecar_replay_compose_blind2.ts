// WP42 / C42 AC4 (blind 2) — composition at the degenerate boundaries: no source
// at all, one empty array, partially overlapping sources, a source repeated four
// times, and a doc that already holds part of the history before recovery runs.
//
// The sidecar remains an injected Uint8Array[]; no sidecar module is imported.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyRecoveredUpdates } from "../../sync/mux-protocol.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return value;
}

function docSnapshot(doc: Y.Doc): string {
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(doc));
  return JSON.stringify(stable({ nodes: mirror.getMap("nodes").toJSON() }));
}

function linearHistory(count: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < count; i++) {
    const node = new Y.Map<unknown>();
    node.set("ord", `a${i}`);
    node.set("pos", { x: i * 40, y: i * 25 });
    doc.getMap("nodes").set(`n${i}`, node);
  }
  return { doc, updates };
}

describe("WP42 AC4 (blind2) — degenerate source combinations", () => {
  it("reports nothing recovered and applies nothing for an entirely empty input", () => {
    const doc = new Y.Doc();
    const calls: Uint8Array[] = [];
    const report = applyRecoveredUpdates((u) => calls.push(u), { sidecar: [], replay: [] });

    expect(calls).toEqual([]);
    expect(report.applied).toBe(0);
    expect(report.skippedDuplicates).toBe(0);
    expect(report.recovered).toBe(false);
    expect(doc.getMap("nodes").size).toBe(0);
  });

  it("treats an omitted source and an empty source identically", () => {
    const { updates } = linearHistory(4);
    const omitted = new Y.Doc();
    const omittedReport = applyRecoveredUpdates((u) => Y.applyUpdate(omitted, u), {
      sidecar: updates,
    });
    const explicit = new Y.Doc();
    const explicitReport = applyRecoveredUpdates((u) => Y.applyUpdate(explicit, u), {
      sidecar: updates,
      replay: [],
    });

    expect(explicitReport).toEqual(omittedReport);
    expect(docSnapshot(explicit)).toBe(docSnapshot(omitted));
  });
});

describe("WP42 AC4 (blind2) — partial overlap and heavy repetition", () => {
  it("converges when the two layers overlap only partially", () => {
    const { doc: source, updates } = linearHistory(6);
    // The sidecar was compacted after update 3; the relay kept everything from 2.
    const sidecar = updates.slice(0, 4);
    const replay = updates.slice(2);

    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), { sidecar, replay });

    expect(report.sidecarCount).toBe(4);
    expect(report.replayCount).toBe(4);
    expect(report.skippedDuplicates).toBe(2); // updates 2 and 3 appear in both
    expect(report.applied).toBe(6);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
    expect(target.getMap("nodes").size).toBe(6);
  });

  it("applies a four-times repeated history exactly once", () => {
    const { doc: source, updates } = linearHistory(3);
    const seen: Uint8Array[] = [];
    const report = applyRecoveredUpdates((u) => seen.push(u), {
      sidecar: [...updates, ...updates],
      replay: [...updates, ...updates],
    });

    expect(report.applied).toBe(3);
    expect(report.skippedDuplicates).toBe(9);
    expect(seen.length).toBe(3);

    const target = new Y.Doc();
    for (const u of seen) Y.applyUpdate(target, u);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
  });

  it("is a no-op in effect when the doc already carries the whole history", () => {
    const { doc: source, updates } = linearHistory(5);

    const target = new Y.Doc();
    for (const u of updates) Y.applyUpdate(target, u);
    const before = docSnapshot(target);

    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), {
      sidecar: updates,
      replay: [Y.encodeStateAsUpdate(source)],
    });

    expect(report.recovered).toBe(true);
    expect(docSnapshot(target)).toBe(before);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
  });
});
