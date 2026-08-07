// WP20 AC4 blind1 — a board made entirely of LEGAL-BUT-UNUSUAL records, and the
// tombstone container that must stay completely empty.
//
// The E1 ruling was needed because a validator treated an optional component as
// a required one. That mistake has a shape, and the shape is not specific to
// `side`: it is "this key is usually there, so its absence is damage". Every
// record on this board is missing something that is usually there, and every
// one of them is legal:
//
//   ├── an edge with NO side on either end (the E1 case itself),
//   ├── an edge with a `fromSide` and no `toSide`,
//   ├── an edge with an arrowhead (`toEnd`) and no side,
//   ├── a `group` node with no type-specific field, because `group` demands none,
//   ├── an EMPTY text card (`text: ""`), legal per the E1-b ruling, and
//   └── a node carrying an unknown, future key nobody has a rule for.
//
// The oracle is the emptiest one available: `deleted` has NO KEYS AT ALL. Not
// "no suppressed entries", not "no quarantines" — no entries. An auditor that
// writes `{on:false}` for records it judged healthy would leave a key behind,
// and that alone is a delta broadcast to every peer for every healthy record on
// every board.
//
// The file bytes are checked afterwards, unchanged from what the doc describes,
// so "nothing was quarantined" cannot be satisfied by an auditor that suppresses
// records without recording it.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "unusual/legal.canvas";

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

describe("WP20 AC4 blind1 — an entirely legal board leaves the tombstone container empty", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes no tombstone of any kind, and every record still reaches the file whole", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      nodeSpace.set(
        "wall",
        record({
          id: "wall",
          type: "group",
          pos: encodePos(-100, -100),
          size: encodeSize(1400, 900),
          label: "no type-specific field is demanded of a group",
        }),
      );
      nodeSpace.set(
        "untyped-yet",
        record({
          id: "untyped-yet",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
          text: "",
        }),
      );
      nodeSpace.set(
        "futureproof",
        record({
          id: "futureproof",
          type: "text",
          pos: encodePos(400, 0),
          size: encodeSize(200, 100),
          text: "carries a key from a later schema",
          sparkleLevel: 11,
        }),
      );
      nodeSpace.set(
        "plain",
        record({
          id: "plain",
          type: "text",
          pos: encodePos(800, 0),
          size: encodeSize(200, 100),
          text: "plain",
        }),
      );

      const edgeSpace = peer.getMap<Y.Map<unknown>>("edges");
      edgeSpace.set(
        "nosides",
        record({ id: "nosides", from: encodeEndpoint("plain"), to: encodeEndpoint("futureproof") }),
      );
      edgeSpace.set(
        "onesided",
        record({
          id: "onesided",
          from: encodeEndpoint("plain", "top"),
          to: encodeEndpoint("untyped-yet"),
        }),
      );
      edgeSpace.set(
        "arrowonly",
        record({
          id: "arrowonly",
          from: encodeEndpoint("untyped-yet"),
          to: encodeEndpoint("futureproof", undefined, "arrow"),
        }),
      );
    });

    const nodeKeysBefore = [...nodes.keys()].sort();
    const edgeKeysBefore = [...edges.keys()].sort();
    const before = serializeCanvas(nodes, edges, deleted);

    audit();
    audit();
    audit();

    expect(
      [...deleted.keys()].sort(),
      "the auditor wrote a tombstone on a board where every single record is legal — a side-less endpoint is a COMPLETE endpoint (E1 ruling)",
    ).toEqual([]);
    expect([...nodes.keys()].sort(), "a node key was lost").toEqual(nodeKeysBefore);
    expect([...edges.keys()].sort(), "an edge key was lost").toEqual(edgeKeysBefore);
    expect(
      serializeCanvas(nodes, edges, deleted),
      "the projected file changed although nothing about the board was wrong",
    ).toBe(before);

    const file = JSON.parse(before) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(file.nodes.map((node) => String(node.id)).sort()).toEqual([
      "futureproof",
      "plain",
      "untyped-yet",
      "wall",
    ]);
    expect(file.edges.map((edge) => String(edge.id)).sort()).toEqual([
      "arrowonly",
      "nosides",
      "onesided",
    ]);

    const nosides = file.edges.find((edge) => edge.id === "nosides") as Record<string, unknown>;
    expect(Object.keys(nosides).sort(), "a side-less arrow gained or lost keys on the way out").toEqual(
      ["fromNode", "id", "toNode"],
    );
    const arrowonly = file.edges.find((edge) => edge.id === "arrowonly") as Record<string, unknown>;
    expect(arrowonly.toEnd, "the arrowhead was lost").toBe("arrow");
    expect("toSide" in arrowonly, "a side was invented for a side-less endpoint").toBe(false);
    expect(
      (file.nodes.find((node) => node.id === "futureproof") as Record<string, unknown>).sparkleLevel,
      "an unknown future key was dropped from the user's file",
    ).toBe(11);

    client.cs.destroy();
  });
});
