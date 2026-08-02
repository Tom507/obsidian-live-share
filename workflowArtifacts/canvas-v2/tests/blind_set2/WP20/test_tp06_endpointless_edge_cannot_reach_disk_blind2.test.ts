// WP20 AC4 blind2 — "dangling" has TWO meanings and only one of them is the
// auditor's.
//
// An arrow can fail to reach the disk for two completely different reasons:
//
//   ├── ITS RECORD IS BROKEN — no `from.node` / no `to.node`. The record itself
//   │      violates the schema, so it is quarantined: a tombstone is written,
//   │      it travels to every peer, and it takes a repair delta to lift, and
//   └── ITS ENDPOINT IS HIDDEN — a perfectly well-formed arrow whose endpoint
//          NODE is suppressed. Nothing is wrong with the arrow. It is
//          suppressed by the CASCADE, which is a DERIVED fact recomputed by
//          `buildCanvasData` from the node's tombstone every time it projects.
//
// Conflating them is a real and destructive mistake, and it fails ASYMMETRICALLY
// in a way that only shows up later: writing a quarantine tombstone for the
// second class makes the arrow's disappearance PERMANENT. Undo the node's
// delete and the node comes back — and its arrows do not, because they now
// carry a quarantine of their own that the undo has no reason to touch. WP19
// AC3 is precisely the guarantee that breaks.
//
// So this doc holds both classes at once: `sever` is endpoint-less, `wing` is a
// whole arrow onto a user-deleted node. Both vanish from the file. Only `sever`
// may have a tombstone — and the proof is the undo at the end, which must bring
// `wing` back.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "two-kinds.canvas";

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

function fileOf(doc: Y.Doc): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  return JSON.parse(
    serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    ),
  );
}

describe("WP20 AC4 blind2 — a cascaded arrow is not an endpoint-less arrow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("quarantines only the broken arrow, so undoing the node delete brings the cascaded one back", async () => {
    const client = await auditingClient(PATH);
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["trunk", 0],
        ["bough", 500],
        ["leafnode", 1000],
      ] as const) {
        nodes.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(260, 130),
            text: `${id}`,
          }),
        );
      }
      const edges = peer.getMap<Y.Map<unknown>>("edges");
      // A WHOLE arrow onto the node the user is about to delete.
      edges.set(
        "wing",
        record({
          id: "wing",
          from: encodeEndpoint("trunk", "right"),
          to: encodeEndpoint("bough", "left"),
          label: "branches",
        }),
      );
      // A BROKEN arrow: no `to` at all.
      edges.set("sever", record({ id: "sever", from: encodeEndpoint("trunk", "bottom") }));
      // The untouched control.
      edges.set(
        "spar",
        record({
          id: "spar",
          from: encodeEndpoint("trunk", "top"),
          to: encodeEndpoint("leafnode", "top"),
        }),
      );
      // The user deletes `bough`. `wing` is now cascaded — but still valid.
      peer.getMap<unknown>("deleted").set("bough", { t: 3, by: "peer-user", on: true });
    });

    audit();
    audit();

    // Both arrows are off the file, for two different reasons.
    expect(
      fileOf(client.doc).edges.map((edge) => String(edge.id)),
      "the file should hold only the untouched arrow at this point",
    ).toEqual(["spar"]);

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "sever")),
      "the endpoint-less arrow was not quarantined",
    ).toBe(true);
    expect(
      readTombstoneEntry(deleted, "wing"),
      "the auditor wrote a tombstone for a WHOLE arrow whose endpoint merely happens to be hidden — the cascade is a derived fact, not a record defect",
    ).toBeUndefined();
    expect(
      readTombstoneEntry(deleted, "spar"),
      "the untouched arrow acquired a tombstone",
    ).toBeUndefined();

    // THE PROOF: the user undoes the node delete. WP19 AC3 says the arrows come
    // back with it — which they can only do if nothing quarantined them.
    push((peer) => {
      peer.getMap<unknown>("deleted").set("bough", { t: 4, by: "peer-user", on: false });
    });
    audit();
    audit();

    const file = fileOf(client.doc);
    expect(
      file.nodes.map((node) => String(node.id)).sort(),
      "the undone node did not come back",
    ).toEqual(["bough", "leafnode", "trunk"]);
    expect(
      file.edges.map((edge) => String(edge.id)).sort(),
      "the cascaded arrow did not come back with its node — it was quarantined and the undo cannot reach it",
    ).toEqual(["spar", "wing"]);
    expect(
      file.edges.find((edge) => edge.id === "wing"),
      "the restored arrow lost or gained a field",
    ).toEqual({
      id: "wing",
      fromNode: "trunk",
      fromSide: "right",
      toNode: "bough",
      toSide: "left",
      label: "branches",
    });
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "sever")),
      "the unrelated undo released the genuinely broken arrow",
    ).toBe(true);

    client.cs.destroy();
  });
});
