// WP20 AC4 blind2 — a side-less edge that is ALREADY wrongly quarantined must
// be RELEASED.
//
// The E1 defect shipped. Some peer in the room is still running the build that
// believed a side-less endpoint was incomplete, and it has already written
// `{on:true, q:true}` over three perfectly legal arrows. Those tombstones are
// now in the shared doc and they travel to everybody.
//
// A corrected auditor that merely stops CREATING the bad quarantine leaves the
// user's arrows deleted forever: the tombstone is a value, it converges, and
// nothing else in the system has any reason to clear it. AC2 says the auditor
// releases a quarantine when the record satisfies the schema — and these
// records satisfy the schema, they always did — so the fix and the repair are
// the same mechanism, and this is the case that proves the release rule is
// stated in terms of VALIDITY rather than in terms of "a delta arrived".
//
// It is also the strictest possible statement of the E1 pin: it is not enough
// for the auditor to leave a side-less arrow alone, it has to actively disagree
// with a peer that condemned one.
//
// The genuinely broken arrow carries an identical-looking quarantine from the
// same peer, and must stay suppressed — so "release everything that peer
// quarantined" is not an answer either.

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
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "legacy-peer.canvas";

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

describe("WP20 AC4 blind2 — the auditor lifts another peer's wrongful quarantine of a legal arrow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("releases the three side-less arrows a legacy peer condemned, and keeps the genuinely broken one suppressed", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    const legal = ["bare", "halfdressed", "tipped"];

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["west", 0],
        ["east", 600],
      ] as const) {
        nodeSpace.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(240, 120),
            text: `${id} card`,
          }),
        );
      }
      const edgeSpace = peer.getMap<Y.Map<unknown>>("edges");
      edgeSpace.set(
        "bare",
        record({ id: "bare", from: encodeEndpoint("west"), to: encodeEndpoint("east") }),
      );
      edgeSpace.set(
        "halfdressed",
        record({
          id: "halfdressed",
          from: encodeEndpoint("east", "bottom"),
          to: encodeEndpoint("west"),
          label: "returns",
        }),
      );
      edgeSpace.set(
        "tipped",
        record({
          id: "tipped",
          from: encodeEndpoint("west", undefined, "none"),
          to: encodeEndpoint("east", undefined, "arrow"),
        }),
      );
      edgeSpace.set("truly-severed", record({ id: "truly-severed", to: encodeEndpoint("east") }));

      // The legacy peer's verdicts — all four look identical as data.
      const tombstones = peer.getMap<unknown>("deleted");
      for (const id of [...legal, "truly-severed"]) {
        tombstones.set(id, { t: 9, by: "peer-legacy", on: true, q: true });
      }
    });

    const containers = new Map(legal.map((id) => [id, edges.get(id)]));
    for (const id of legal) {
      expect(
        isTombstoneQuarantined(readTombstoneEntry(deleted, id)),
        `the legacy peer's wrongful quarantine of ${id} never reached the doc`,
      ).toBe(true);
    }

    audit();
    audit();

    for (const id of legal) {
      const entry = readTombstoneEntry(deleted, id);
      expect(
        isTombstoneSuppressed(entry),
        `${id} is a legal, fully-connected arrow and is still suppressed — the wrongful quarantine was never lifted, so the user's arrow is gone for good`,
      ).toBe(false);
      expect(
        entry?.t,
        `the release of ${id} does not dominate the legacy peer's quarantine and will lose the merge`,
      ).toBeGreaterThan(9);
      expect(edges.get(id), `${id}'s container was replaced rather than released in place`).toBe(
        containers.get(id),
      );
    }

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "truly-severed")),
      "the genuinely endpoint-less arrow was released along with the legal ones",
    ).toBe(true);

    const file = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(
      file.edges.map((edge) => String(edge.id)).sort(),
      "the released arrows did not come back to the user's file, or the broken one came back with them",
    ).toEqual(["bare", "halfdressed", "tipped"]);
    expect(
      file.nodes.map((node) => String(node.id)).sort(),
      "the nodes were disturbed",
    ).toEqual(["east", "west"]);

    const bare = file.edges.find((edge) => edge.id === "bare") as Record<string, unknown>;
    expect(Object.keys(bare).sort(), "the released arrow came back with a side it never had").toEqual(
      ["fromNode", "id", "toNode"],
    );

    client.cs.destroy();
  });
});
