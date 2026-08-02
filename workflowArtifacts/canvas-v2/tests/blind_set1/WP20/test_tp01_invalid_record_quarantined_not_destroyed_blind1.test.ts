// WP20 AC1 blind1 — the quarantine judged from what this client PUTS ON THE
// WIRE, not from what its own doc happens to hold.
//
// A local read cannot separate "the record survived the quarantine" from "the
// record was destroyed and nobody has looked yet". `Y.encodeStateAsUpdate` can:
// it is byte-for-byte what this peer would send, Yjs ships the delete set with
// every update, and a replica rebuilt from that stream is the closest thing to
// what the rest of the room actually receives. If the auditor destroyed the
// record to hide it, the rebuilt peer cannot hold it — and then the repair
// delta AC2 promises has nothing to land on, on any machine but this one.
//
// The fault is a `file` node with no `file` key, which is the class Obsidian's
// `importData` punishes hardest (it drops the node AND every edge attached to
// it), and which the legacy `fileNodesWithoutFile` counter could only ever
// count.
//
// The node is a HUB with an arrow on each side. Those arrows are schema-VALID —
// they name two existing nodes — so they must survive the quarantine as
// records, while disappearing from the projection through the ordinary
// suppression cascade rather than through anything the auditor does to them.
// That separates "quarantined the broken node" from "quarantined everything it
// touched".

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "research/sources.canvas";

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

describe("WP20 AC1 blind1 — a rebuilt peer receives the quarantined record whole", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the outbound stream carries the quarantine AND every field of the record it suppresses", async () => {
    const client = await auditingClient(PATH);
    const push = makePeer(client.doc);

    push((peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, y] of [
        ["above", -500],
        ["below", 500],
      ] as const) {
        nodes.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(0, y),
            size: encodeSize(300, 140),
            text: `note ${id}`,
          }),
        );
      }
      // A `file` node whose `file` key never arrived — MISSING_TYPE_SPECIFIC.
      nodes.set(
        "citation",
        record({
          id: "citation",
          type: "file",
          pos: encodePos(0, 0),
          size: encodeSize(400, 400),
          color: "2",
          subpath: "#abstract",
        }),
      );
      const edges = peer.getMap<Y.Map<unknown>>("edges");
      edges.set(
        "cites",
        record({
          id: "cites",
          from: encodeEndpoint("above", "bottom"),
          to: encodeEndpoint("citation", "top"),
        }),
      );
      edges.set(
        "citedby",
        record({
          id: "citedby",
          from: encodeEndpoint("citation", "bottom"),
          to: encodeEndpoint("below", "top"),
          label: "supports",
        }),
      );
    });

    const fieldsBefore = client.doc.getMap<Y.Map<unknown>>("nodes").get("citation")?.toJSON();
    expect(fieldsBefore, "the fault injection never reached the doc").toBeDefined();

    audit();

    // Everything this client would ever send, replayed into a virgin peer.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(client.doc), "peer");
    const peerNodes = rebuilt.getMap<Y.Map<unknown>>("nodes");
    const peerEdges = rebuilt.getMap<Y.Map<unknown>>("edges");
    const peerDeleted = rebuilt.getMap<unknown>("deleted");

    expect(
      [...peerNodes.keys()].sort(),
      "the quarantine travelled as a key REMOVAL: the rebuilt peer never receives the record at all",
    ).toEqual(["above", "below", "citation"]);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(peerDeleted, "citation")),
      "the rebuilt peer holds no quarantine for the invalid record",
    ).toBe(true);
    expect(
      peerNodes.get("citation")?.toJSON(),
      "the record reached the peer with fields missing — a repair delta there cannot restore it",
    ).toEqual(fieldsBefore);

    // The two arrows are schema-valid records and stay records.
    expect([...peerEdges.keys()].sort(), "a valid arrow lost its key").toEqual([
      "citedby",
      "cites",
    ]);
    for (const id of ["cites", "citedby"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(peerDeleted, id)),
        `the auditor tombstoned the valid arrow ${id} instead of letting the cascade hide it`,
      ).toBe(false);
    }

    // The rebuilt peer's own picture of the canvas: hub gone, arrows cascaded.
    const rendered = buildCanvasData(peerNodes, peerEdges, peerDeleted);
    expect(
      rendered.nodes.map((node) => node.id).sort(),
      "the quarantined record is rendered on the peer",
    ).toEqual(["above", "below"]);
    expect(
      rendered.edges.map((edge) => edge.id),
      "an arrow into the quarantined record is still drawn",
    ).toEqual([]);

    client.cs.destroy();
  });
});
