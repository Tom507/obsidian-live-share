// WP20 AC4 blind1 — the endpoint that is PRESENT but is not an endpoint.
//
// WP14 keeps `MISSING_FROM` and `INVALID_FROM` apart because "the key was never
// written" and "the key holds something that is not an endpoint" are different
// stories about how a record got here. An auditor that asks `record.get("from")
// === undefined` handles only the first and lets the second straight through to
// the user's `.canvas` — and the second is the commoner one in practice, since
// it is what a half-written register, a hand-edited vault or a peer running an
// older schema produces.
//
// Three shapes of "present but not an endpoint" ride together here, all of them
// values `isEndpointRegister` refuses:
//
//   ├── an object with a `side` and no `node` at all,
//   ├── a `node` of the wrong type (a number), and
//   └── a well-formed `node` with a wrong-typed `side` — a register is whole or
//          absent, never half-read, so this one is invalid too even though its
//          attachment point looks fine.
//
// The oracle is the FILE, read off a replica rebuilt from this client's own
// outbound stream, because "cannot reach disk" is a statement about what every
// peer writes, not about what this client happens to render.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "malformed/edges.canvas";

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

describe("WP20 AC4 blind1 — a malformed endpoint keeps its edge off the disk just as an absent one does", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("all three malformed arrows are quarantined and none of them reaches a rebuilt peer's file", async () => {
    const client = await auditingClient(PATH);
    const push = makePeer(client.doc);

    push((peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, y] of [
        ["north", -300],
        ["south", 300],
      ] as const) {
        nodes.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(0, y),
            size: encodeSize(280, 140),
            text: `${id} pole`,
          }),
        );
      }
      const edges = peer.getMap<Y.Map<unknown>>("edges");
      // `from` present, no `node` component at all.
      edges.set(
        "sideonly",
        record({ id: "sideonly", from: { side: "top" }, to: encodeEndpoint("south", "top") }),
      );
      // `node` present but not a string.
      edges.set(
        "numeric",
        record({ id: "numeric", from: encodeEndpoint("north", "bottom"), to: { node: 42 } }),
      );
      // Attachment point fine, decoration wrong-typed — whole or absent.
      edges.set(
        "tornside",
        record({
          id: "tornside",
          from: encodeEndpoint("north", "left"),
          to: { node: "south", side: 7 },
        }),
      );
      // The control, whole in every respect.
      edges.set(
        "sound",
        record({
          id: "sound",
          from: encodeEndpoint("north", "bottom"),
          to: encodeEndpoint("south", "top"),
        }),
      );
    });

    const brokenIds = ["sideonly", "numeric", "tornside"];
    const fieldsBefore = new Map(
      brokenIds.map((id) => [id, client.doc.getMap<Y.Map<unknown>>("edges").get(id)?.toJSON()]),
    );
    for (const id of brokenIds) {
      expect(fieldsBefore.get(id), `the fault injection never created ${id}`).toBeDefined();
    }

    audit();
    audit();

    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(client.doc), "peer");
    const peerEdges = rebuilt.getMap<Y.Map<unknown>>("edges");
    const peerDeleted = rebuilt.getMap<unknown>("deleted");

    for (const id of brokenIds) {
      expect(
        isTombstoneQuarantined(readTombstoneEntry(peerDeleted, id)),
        `the malformed endpoint on ${id} was not quarantined — 'absent' was checked, 'not an endpoint' was not`,
      ).toBe(true);
      expect(
        peerEdges.get(id)?.toJSON(),
        `${id} reached the peer with fields missing — it is not repairable there`,
      ).toEqual(fieldsBefore.get(id));
    }
    expect(
      readTombstoneEntry(peerDeleted, "sound"),
      "the whole arrow was quarantined too",
    ).toBeUndefined();

    const file = JSON.parse(
      serializeCanvas(
        rebuilt.getMap<Y.Map<unknown>>("nodes"),
        peerEdges,
        peerDeleted,
      ),
    ) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    expect(
      file.edges.map((edge) => String(edge.id)),
      "a malformed-endpoint arrow still reaches the file on a peer",
    ).toEqual(["sound"]);
    expect(
      file.nodes.map((node) => String(node.id)).sort(),
      "the audit took the healthy nodes with it",
    ).toEqual(["north", "south"]);

    client.cs.destroy();
  });
});
