// WP20 / AC3 (first half) — "repeated audits of an unchanged doc produce no
// further deltas."
//
// The discriminant is the UPDATE COUNT, not the state. Every plausible broken
// auditor reaches the same STATE on the second pass — it re-writes
// `{on:true, q:true}` over `{on:true, q:true}`, which is semantically a no-op
// and completely invisible to a state assertion. What it is not is a no-op on
// the WIRE: each rewrite is a CRDT delta broadcast to every peer, and because
// the audit is driven by the doc observer, each peer's delta wakes every other
// peer's audit. Three clients in a room and the repair pass becomes a permanent
// update storm that no amount of state-checking can see.
//
// So the doc's own `update` event is the oracle, and the loop is measured in
// AUDIT PASSES rather than milliseconds: `runOnlyPendingTimers` runs exactly
// the timers pending at that moment, so a pass that schedules another one (the
// tombstone write is itself an observed change) does not silently run inside
// the same call. No new timing constant is introduced and nothing sleeps.
//
// Pass 1 MUST emit deltas — the repair has to happen at all, and a "no further
// deltas" assertion is trivially satisfied by an auditor that never writes
// anything. Passes 2..5 must emit exactly zero.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "storm.canvas";

function createVault() {
  const files = new Map<string, string>();
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

describe("WP20 AC3 — a second audit of an unchanged doc emits zero updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the repair pass writes once and every later pass is a fixed point", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["a", 0],
        ["b", 400],
      ] as const) {
        nodeSpace.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(200, 100),
            text: `card ${id}`,
          }),
        );
      }
      // Two faults of different kinds, so the pass has real work to do.
      nodeSpace.set(
        "typeless",
        record({ id: "typeless", pos: encodePos(0, 400), size: encodeSize(200, 100) }),
      );
      peer
        .getMap<Y.Map<unknown>>("edges")
        .set("dangler", record({ id: "dangler", from: encodeEndpoint("a") }));
      // …plus a healthy edge, so a fixed point is not merely an empty doc.
      peer
        .getMap<Y.Map<unknown>>("edges")
        .set("span", record({ id: "span", from: encodeEndpoint("a"), to: encodeEndpoint("b") }));
    });

    let updates = 0;
    client.doc.on("update", () => {
      updates += 1;
    });

    audit();
    const afterRepair = updates;
    expect(
      afterRepair,
      "the audit emitted no delta at all — nothing was repaired, so idempotence is vacuous",
    ).toBeGreaterThan(0);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "typeless")),
      "the invalid node was not quarantined by the pass being measured",
    ).toBe(true);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "dangler")),
      "the endpoint-less edge was not quarantined by the pass being measured",
    ).toBe(true);

    const settledState = serializeCanvas(nodes, edges, deleted);

    audit();
    expect(
      updates - afterRepair,
      "the SECOND audit of an unchanged doc emitted deltas: the repair is not idempotent and every peer's audit will re-trigger it",
    ).toBe(0);

    audit();
    audit();
    audit();
    expect(
      updates - afterRepair,
      "the audit never reaches a fixed point — repeated passes keep rewriting the doc",
    ).toBe(0);

    expect(
      serializeCanvas(nodes, edges, deleted),
      "the extra passes changed the projected file even though they emitted no delta",
    ).toBe(settledState);

    client.cs.destroy();
  });
});
