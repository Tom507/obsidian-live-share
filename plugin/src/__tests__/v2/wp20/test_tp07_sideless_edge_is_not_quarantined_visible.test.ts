// WP20 / AC4 — the REGRESSION PIN for the E1 ruling (charter clarification 1,
// 2026-08-02): a SIDE-LESS endpoint is a COMPLETE endpoint.
//
// `fromSide` / `toSide` are optional in the JSON Canvas format. WP10 AC5 and
// WP14 both say so explicitly, and both had to be corrected to say so — the
// earlier reading ("an endpoint needs a side") made a fully-connected edge
// unrepresentable, then refused it at ingest, then wrote it out of the user's
// own `.canvas` file. That is the data loss the E1 ruling removed from the
// ingest path.
//
// The auditor is where it would come back, and WORSE: ingest only sees records
// on their way in, whereas the auditor runs periodically over docs that are
// already healthy. An auditor that read "no side → endpoint-less → quarantine"
// would delete every side-less arrow in every open canvas, on a timer, with the
// tombstone replicated to every peer.
//
// So the oracle here is the QUARANTINE SET, stated exactly: of three arrows,
// only the one with a genuinely absent `to` may be quarantined. The two legal
// ones must have no tombstone at all — not a released one, none — and must
// still reach the file with their `*Side` keys ABSENT rather than `null` or
// `""` (WP10 AC5's round-trip).
//
// A `group` node rides along as the node-side counterpart: it carries no
// type-specific requirement at all, and an auditor that demanded one per type
// would quarantine every frame on the board.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "sides.canvas";

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

describe("WP20 AC4 — a side-less edge is a valid edge and the auditor leaves it alone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("quarantines exactly the arrow whose `to` is absent, and no side-less arrow", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["one", 0],
        ["two", 500],
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
      // A `group` carries NO type-specific requirement — silence in the table
      // means "nothing further is demanded", never "unknown, therefore refuse".
      nodeSpace.set(
        "frame",
        record({
          id: "frame",
          type: "group",
          pos: encodePos(-100, -100),
          size: encodeSize(900, 400),
          label: "the frame",
        }),
      );

      const edgeSpace = peer.getMap<Y.Map<unknown>>("edges");
      // Legal: two whole endpoints, neither carrying a side.
      edgeSpace.set(
        "sideless",
        record({ id: "sideless", from: encodeEndpoint("one"), to: encodeEndpoint("two") }),
      );
      // Legal: one side named, the other left to the renderer.
      edgeSpace.set(
        "halfsided",
        record({
          id: "halfsided",
          from: encodeEndpoint("two", "bottom"),
          to: encodeEndpoint("one"),
          label: "asymmetric",
        }),
      );
      // NOT legal: no `to` register at all.
      edgeSpace.set("severed", record({ id: "severed", from: encodeEndpoint("one", "right") }));
    });

    audit();
    audit();

    // The quarantine set, stated exactly.
    const quarantined = [...["sideless", "halfsided", "severed", "one", "two", "frame"]].filter(
      (id) => isTombstoneQuarantined(readTombstoneEntry(deleted, id)),
    );
    expect(
      quarantined,
      "the auditor quarantined a legal record — a side-less endpoint is a COMPLETE endpoint (E1 ruling)",
    ).toEqual(["severed"]);

    for (const id of ["sideless", "halfsided", "frame"]) {
      expect(
        readTombstoneEntry(deleted, id),
        `the auditor wrote a tombstone for the legal record ${id}`,
      ).toBeUndefined();
    }

    // …and the legal arrows still reach the file, with their `*Side` keys ABSENT
    // rather than `null` or `""` (WP10 AC5's round-trip).
    const onDisk = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(
      onDisk.edges.map((edge) => String(edge.id)).sort(),
      "a legal arrow was taken off the user's file",
    ).toEqual(["halfsided", "sideless"]);
    expect(
      onDisk.nodes.map((node) => String(node.id)).sort(),
      "a legal node was taken off the user's file",
    ).toEqual(["frame", "one", "two"]);

    const sideless = onDisk.edges.find((edge) => edge.id === "sideless") as Record<string, unknown>;
    expect(sideless.fromNode).toBe("one");
    expect(sideless.toNode).toBe("two");
    expect(
      "fromSide" in sideless,
      "a side-less endpoint round-tripped with a `fromSide` key it never had",
    ).toBe(false);
    expect(
      "toSide" in sideless,
      "a side-less endpoint round-tripped with a `toSide` key it never had",
    ).toBe(false);

    const halfsided = onDisk.edges.find((edge) => edge.id === "halfsided") as Record<
      string,
      unknown
    >;
    expect(halfsided.fromSide, "the named side was lost").toBe("bottom");
    expect("toSide" in halfsided, "the unnamed side was invented").toBe(false);

    client.cs.destroy();
  });
});
