// WP42 / C42 AC4 (blind 1) — composition when the two layers carry the SAME
// history in DIFFERENT SHAPES: the sidecar holds the incremental delta log, the
// relay replay holds a single compacted checkpoint. Neither is byte-comparable to
// the other, so the dedupe short-cut cannot be what makes this pass — only the
// CRDT property can.
//
// The sidecar is modelled as an injected Uint8Array[]; nothing under
// plugin/src/files/ is imported or created.
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
      deleted: mirror.getMap("deleted").toJSON(),
      content: mirror.getText("content").toString(),
    }),
  );
}

/**
 * Deterministic generator: three replicas contribute to one shared history, so
 * the log contains genuinely concurrent operations rather than a single chain.
 */
function threePeerHistory(): { merged: Y.Doc; log: Uint8Array[] } {
  const base = new Y.Doc();
  const log: Uint8Array[] = [];
  base.on("update", (u: Uint8Array) => log.push(u));
  base.transact(() => {
    base.getText("content").insert(0, "gemeinsam");
    const node = new Y.Map<unknown>();
    node.set("pos", { x: 0, y: 0 });
    base.getMap("nodes").set("base", node);
  });

  const baseState = Y.encodeStateAsUpdate(base);
  for (let peer = 0; peer < 3; peer++) {
    const replica = new Y.Doc();
    Y.applyUpdate(replica, baseState);
    replica.on("update", (u: Uint8Array) => log.push(u));
    replica.transact(() => {
      const node = new Y.Map<unknown>();
      node.set("ord", `a${peer}`);
      node.set("owner", `peer-${peer}`);
      replica.getMap("nodes").set(`p${peer}`, node);
      replica.getText("content").insert(0, `${peer}`);
    });
  }
  // One peer also tombstones the base node.
  const remover = new Y.Doc();
  Y.applyUpdate(remover, baseState);
  remover.on("update", (u: Uint8Array) => log.push(u));
  remover.getMap("deleted").set("base", { at: 3, by: "peer-2" });

  const merged = new Y.Doc();
  for (const u of log) Y.applyUpdate(merged, u);
  return { merged, log };
}

describe("WP42 AC4 (blind1) — delta log vs. compacted checkpoint", () => {
  it("reaches the same state from the sidecar delta log alone", () => {
    const { merged, log } = threePeerHistory();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), { sidecar: log });

    expect(report.sidecarCount).toBe(log.length);
    expect(docSnapshot(target)).toBe(docSnapshot(merged));
  });

  it("reaches the same state from the single compacted replay checkpoint alone", () => {
    const { merged } = threePeerHistory();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), {
      replay: [Y.encodeStateAsUpdate(merged)],
    });

    expect(report.replayCount).toBe(1);
    expect(report.applied).toBe(1);
    expect(docSnapshot(target)).toBe(docSnapshot(merged));
  });

  it("reaches the same state from both, with nothing applied twice in effect", () => {
    const { merged, log } = threePeerHistory();
    const target = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(target, u), {
      sidecar: log,
      replay: [Y.encodeStateAsUpdate(merged)],
    });

    // The two shapes share no bytes, so nothing is deduped — the equality below
    // is carried by the CRDT, which is exactly the claim AC4 makes.
    expect(report.skippedDuplicates).toBe(0);
    expect(report.applied).toBe(log.length + 1);
    expect(docSnapshot(target)).toBe(docSnapshot(merged));
    expect(target.getMap("nodes").size).toBe(4);
    expect(target.getMap("deleted").get("base")).toEqual({ at: 3, by: "peer-2" });
  });

  it("is insensitive to which layer is applied first", () => {
    const { merged, log } = threePeerHistory();
    const checkpoint = Y.encodeStateAsUpdate(merged);

    const sidecarFirst = new Y.Doc();
    applyRecoveredUpdates((u) => Y.applyUpdate(sidecarFirst, u), {
      sidecar: log,
      replay: [checkpoint],
    });

    // Swap the roles: the checkpoint arrives as the "sidecar" and the log as the
    // "replay", which inverts the internal apply order.
    const replayFirst = new Y.Doc();
    applyRecoveredUpdates((u) => Y.applyUpdate(replayFirst, u), {
      sidecar: [checkpoint],
      replay: log,
    });

    expect(docSnapshot(replayFirst)).toBe(docSnapshot(sidecarFirst));
    expect(docSnapshot(replayFirst)).toBe(docSnapshot(merged));
  });
});
