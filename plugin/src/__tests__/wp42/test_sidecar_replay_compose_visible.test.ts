// WP42 / C42 AC4 — sidecar and relay persistence COMPOSE: either alone is
// sufficient, and both together produce no duplicate application.
//
// The sidecar (WP24/WP25) is deliberately NOT imported here. It is modelled as
// what it is at this seam: an injected array of prior Uint8Array updates. The
// production seam is `applyRecoveredUpdates(apply, { sidecar, replay })`, which
// takes the doc-writing function as a parameter and therefore stays pure.
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
  return JSON.stringify(
    stable({
      nodes: mirror.getMap("nodes").toJSON(),
      edges: mirror.getMap("edges").toJSON(),
      content: mirror.getText("content").toString(),
    }),
  );
}

/** Authoritative history: three transactions on one canvas doc. */
function authoritative(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));

  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("pos", { x: 1, y: 2 });
    node.set("text", "erste Karte");
    doc.getMap("nodes").set("n1", node);
    doc.getText("content").insert(0, "board");
  });
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("pos", { x: 300, y: 2 });
    node.set("text", "zweite Karte");
    doc.getMap("nodes").set("n2", node);
  });
  doc.transact(() => {
    const edge = new Y.Map<unknown>();
    edge.set("from", { node: "n1", side: "right" });
    edge.set("to", { node: "n2", side: "left" });
    doc.getMap("edges").set("e1", edge);
  });

  return { doc, updates };
}

describe("WP42 AC4 — either persistence layer alone is sufficient", () => {
  it("reaches the authoritative state from the replay alone", () => {
    const { doc: source, updates } = authoritative();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), { replay: updates });

    expect(report.replayCount).toBe(3);
    expect(report.sidecarCount).toBe(0);
    expect(report.recovered).toBe(true);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
  });

  it("reaches the authoritative state from the sidecar alone", () => {
    const { doc: source, updates } = authoritative();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), { sidecar: updates });

    expect(report.sidecarCount).toBe(3);
    expect(report.replayCount).toBe(0);
    expect(report.recovered).toBe(true);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
  });
});

describe("WP42 AC4 — both together produce no duplicate application", () => {
  it("converges to the same state as either layer alone", () => {
    const { doc: source, updates } = authoritative();

    const replayOnly = new Y.Doc();
    applyRecoveredUpdates((u) => Y.applyUpdate(replayOnly, u), { replay: updates });
    const sidecarOnly = new Y.Doc();
    applyRecoveredUpdates((u) => Y.applyUpdate(sidecarOnly, u), { sidecar: updates });
    const both = new Y.Doc();
    applyRecoveredUpdates((u) => Y.applyUpdate(both, u), { sidecar: updates, replay: updates });

    const oracle = docSnapshot(source);
    expect(docSnapshot(replayOnly)).toBe(oracle);
    expect(docSnapshot(sidecarOnly)).toBe(oracle);
    expect(docSnapshot(both)).toBe(oracle);
  });

  it("hands each byte-identical update to the doc exactly once", () => {
    const { updates } = authoritative();
    const seen: Uint8Array[] = [];
    const report = applyRecoveredUpdates((u) => seen.push(u), {
      sidecar: updates,
      replay: updates,
    });

    expect(report.sidecarCount).toBe(3);
    expect(report.replayCount).toBe(3);
    expect(report.applied).toBe(3);
    expect(report.skippedDuplicates).toBe(3);
    expect(seen.length).toBe(3);
    expect(report.applied + report.skippedDuplicates).toBe(
      report.sidecarCount + report.replayCount,
    );
  });

  it("is still free of net double application when dedupe is switched off", () => {
    // Dedupe is an optimisation; the CORRECTNESS claim ("no duplicate
    // application in effect") must hold without it too.
    const { doc: source, updates } = authoritative();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates(
      (u) => Y.applyUpdate(target, u),
      { sidecar: updates, replay: updates },
      { dedupe: false },
    );

    expect(report.applied).toBe(6);
    expect(report.skippedDuplicates).toBe(0);
    expect(docSnapshot(target)).toBe(docSnapshot(source));
    expect(target.getMap("nodes").size).toBe(2);
    expect(target.getMap("edges").size).toBe(1);
    expect(target.getText("content").toString()).toBe("board");
  });
});
