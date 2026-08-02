// WP20 / AC4 (first half) — "An endpoint-less edge can no longer reach disk."
//
// ENDPOINT-LESS MEANS `from.node` OR `to.node` ABSENT (charter clarification 1,
// 2026-08-02). It does NOT mean "no side": `fromSide`/`toSide` are optional in
// JSON Canvas and a side-less endpoint is a COMPLETE endpoint. That distinction
// is pinned separately in tp07; this test is about the genuine article.
//
// Why the disk half is the interesting one. `buildCanvasData`'s GAP-5 guard
// drops an edge whose endpoint NODE is missing or suppressed — it reads the
// endpoint's node id and checks the visible set. An edge with no endpoint
// string at all slips straight through it ("an edge with no endpoint STRING at
// all is left alone here, unchanged from P0"), so it is serialised into the
// user's `.canvas` exactly as it is. Obsidian's `importData` then meets an edge
// it cannot attach — the A.2/16 class this WP repairs rather than reports.
//
// Both endpoint NODES exist and are healthy, so nothing but the record's own
// schema failure can keep the arrow off the disk. The whole arrow beside it is
// the control: it proves the audit did not simply stop serialising edges.
//
// And the record survives: AC1's preservation rule is not suspended for an
// edge, because the same repair delta that gives it a `to` must be able to
// bring it back.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "wiring.canvas";

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

describe("WP20 AC4 — an edge with an absent endpoint is quarantined and never serialised", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the edge stops reaching the file while both its healthy neighbours and its own fields survive", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["left", 0],
        ["right", 600],
      ] as const) {
        nodeSpace.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(220, 110),
            text: `${id} card`,
          }),
        );
      }
      const edgeSpace = peer.getMap<Y.Map<unknown>>("edges");
      // ENDPOINT-LESS: `from` is whole, `to` is not there at all (MISSING_TO).
      // Both nodes exist, so the GAP-5 visible-node guard cannot catch it.
      edgeSpace.set(
        "severed",
        record({
          id: "severed",
          from: encodeEndpoint("left", "right"),
          label: "goes nowhere",
          color: "6",
        }),
      );
      edgeSpace.set(
        "whole",
        record({
          id: "whole",
          from: encodeEndpoint("left", "right"),
          to: encodeEndpoint("right", "left"),
        }),
      );
    });

    const containerBefore = edges.get("severed");
    expect(containerBefore, "the fault injection never reached the doc").toBeDefined();
    const fieldsBefore = containerBefore?.toJSON();
    expect(
      JSON.parse(serializeCanvas(nodes, edges, deleted)).edges.map((edge: { id: unknown }) =>
        String(edge.id),
      ),
      "the endpoint-less edge was already off the disk before the audit — this test proves nothing",
    ).toEqual(["severed", "whole"]);

    audit();

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "severed")),
      "the endpoint-less edge was not quarantined",
    ).toBe(true);

    const onDisk = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(
      onDisk.edges.map((edge) => String(edge.id)),
      "the endpoint-less edge still reaches disk",
    ).toEqual(["whole"]);
    expect(
      onDisk.nodes.map((node) => String(node.id)).sort(),
      "the audit took healthy nodes off the disk with it",
    ).toEqual(["left", "right"]);
    expect(
      buildCanvasData(nodes, edges, deleted).edges.map((edge) => edge.id),
      "the endpoint-less edge is still rendered",
    ).toEqual(["whole"]);

    // …and it is quarantined, not destroyed.
    expect(edges.has("severed"), "the audit removed the edge key from `edges`").toBe(true);
    expect(
      edges.get("severed"),
      "the edge container was replaced — the repair delta that gives it a `to` can no longer bring it back",
    ).toBe(containerBefore);
    expect(edges.get("severed")?.toJSON(), "the quarantined edge lost fields").toEqual(
      fieldsBefore,
    );
    expect(
      readTombstoneEntry(deleted, "whole"),
      "the audit quarantined the fully-connected arrow as well",
    ).toBeUndefined();

    client.cs.destroy();
  });
});
