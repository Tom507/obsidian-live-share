// WP19 AC1 blind1 — a delete is a tombstone, judged from what the client PUTS
// ON THE WIRE rather than from what its own doc happens to hold.
//
// A local read cannot distinguish "the record survived" from "the record was
// removed and the removal has not propagated yet". `Y.encodeStateAsUpdate` can:
// it is byte-for-byte what this peer would send, and Yjs ships the whole delete
// set with every update, so a key removal is impossible to hide from a replica
// rebuilt out of that stream.
//
// Two deletes in ONE save, because the delete branch groups nothing — an
// implementation that tombstones the first id and falls through to a key removal
// on the rest would still look correct with a single victim.
//
// The surviving middle card is the control: it separates "this delete was
// tombstoned" from "no delete happened at all".

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "sprint/board.canvas";

const ALPHA = {
  id: "alpha",
  type: "file",
  x: -400,
  y: -200,
  width: 300,
  height: 220,
  file: "notes/alpha.md",
};
const BETA = { id: "beta", type: "text", x: 0, y: 0, width: 250, height: 120, text: "beta stays" };
const GAMMA = {
  id: "gamma",
  type: "group",
  x: 500,
  y: 500,
  width: 640,
  height: 480,
  label: "gamma group",
  color: "1",
};

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
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

describe("WP19 AC1 blind1 — two deletes in one save, judged on the outbound update stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a replica rebuilt from this client's updates still holds both deleted records, whole, and both tombstones", async () => {
    const vault = createVault({ [PATH]: canvasJson([ALPHA, BETA, GAMMA]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: {
          node: new Set(["alpha", "beta", "gamma"]),
          edge: new Set<string>(),
        },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const local = doc.getMap<Y.Map<unknown>>("nodes");
    const before = new Map<string, Record<string, unknown>>();
    for (const id of ["alpha", "beta", "gamma"]) {
      const record = local.get(id);
      expect(record, `the host seed never created ${id}`).toBeDefined();
      before.set(id, record?.toJSON() ?? {});
    }

    // The user selects the outer two cards and deletes both at once.
    vault.files.set(PATH, canvasJson([BETA]));
    await cs.handleLocalModify(PATH);

    // Everything this client would ever send, replayed into a virgin peer.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), "peer");
    const peerNodes = peer.getMap<Y.Map<unknown>>("nodes");
    const peerDeleted = peer.getMap<unknown>("deleted");

    expect(
      [...peerNodes.keys()].sort(),
      "the delete travelled as a key REMOVAL: the peer never receives the record at all",
    ).toEqual(["alpha", "beta", "gamma"]);

    for (const id of ["alpha", "gamma"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(peerDeleted, id)),
        `${id} reached the peer without a suppressing tombstone`,
      ).toBe(true);
      expect(
        peerNodes.get(id)?.toJSON(),
        `${id} reached the peer with fields missing — it is not restorable there`,
      ).toEqual(before.get(id));
    }

    // The control card is untouched by all of it.
    expect(
      isTombstoneSuppressed(readTombstoneEntry(peerDeleted, "beta")),
      "the surviving card was tombstoned too",
    ).toBe(false);
    expect(peerNodes.get("beta")?.toJSON()).toEqual(before.get("beta"));

    // And the peer's own view of the canvas shows only the survivor.
    expect(
      buildCanvasData(peerNodes, peer.getMap<Y.Map<unknown>>("edges"), peerDeleted).nodes.map(
        (node) => node.id,
      ),
      "the deletes never became visible on the peer",
    ).toEqual(["beta"]);

    cs.destroy();
  });
});
