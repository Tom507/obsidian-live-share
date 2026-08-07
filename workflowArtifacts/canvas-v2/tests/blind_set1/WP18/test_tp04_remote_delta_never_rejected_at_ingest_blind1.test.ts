// WP18 AC4 blind1 — remote deltas are never rejected at ingest, shown on
// EDGES and carried across a LATER local write.
//
// The extra angle over the visible probe: after the peer's broken edge has been
// integrated, this client performs a real local capture pass. A boundary that
// filtered remote content lazily — tolerating it at ingest but sweeping it on
// the next local write — would pass a probe that only looks immediately after
// the delta, and fails here. The peer's record must still be there afterwards,
// with its payload intact and unrepaired.
//
// Both halves share one doc, and every write is causally ordered: the peer's
// update is fully integrated before the local save runs, so nothing depends on
// a concurrent tie-break.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "peers.canvas";
const REASON_CODE = /\b(MISSING|INVALID)_[A-Z_]+\b/;

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

/** A completed peer transaction, integrated into `doc` as a real remote delta. */
function applyRemoteDelta(doc: Y.Doc, build: (edges: Y.Map<Y.Map<unknown>>) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  build(peer.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  peer.destroy();
}

const U = { id: "u", type: "text", x: 0, y: 0, width: 100, height: 50, text: "u" };
const V = { id: "v", type: "text", x: 300, y: 0, width: 100, height: 50, text: "v" };
/** The host's own file proposes a broken edge — a LOCAL proposal, `reject: true`. */
const LOCAL_BROKEN_EDGE = { id: "local-broken", fromNode: "u", fromSide: "right" };

describe("WP18 AC4 blind1 — a peer's broken edge outlives both the seed and a later local save", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only the local twin is signed and dropped; the remote edge is still intact after a capture pass", async () => {
    const vault = createVault({ [PATH]: canvasJson([U, V], [LOCAL_BROKEN_EDGE]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    const lines: string[] = [];
    cs.setLogger({
      debug: (_c: string, m: string) => lines.push(m),
      warn: (_c: string, m: string) => lines.push(m),
    });

    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    // The LOCAL half: the host's own broken edge never entered the doc.
    expect(
      edges.has("local-broken"),
      "the local half is vacuous: the broken LOCAL edge was accepted",
    ).toBe(false);
    expect(
      lines.some((line) => line.includes("local-broken") && REASON_CODE.test(line)),
      "the LOCAL refusal produced no signature",
    ).toBe(true);

    // The REMOTE half: a peer authors the same brokenness.
    applyRemoteDelta(doc, (peerEdges) => {
      const broken = new Y.Map<unknown>();
      peerEdges.set("remote-broken", broken);
      broken.set("id", "remote-broken");
      broken.set("fromNode", "u");
      broken.set("fromSide", "right");
      broken.set("label", "peer authored");
    });

    expect(
      edges.has("remote-broken"),
      "an invalid REMOTE record was rejected at ingest — this replica now diverges from its peer",
    ).toBe(true);

    // A later, ordinary local save must not sweep it either.
    vault.files.set(PATH, canvasJson([U, { ...V, text: "v edited" }], []));
    await cs.handleLocalModify(PATH);

    expect(
      edges.has("remote-broken"),
      "a later local write swept the peer's record — rejection was merely deferred, not absent",
    ).toBe(true);
    expect(
      edges.get("remote-broken")?.get("label"),
      "the remote record was emptied or repaired instead of being left to the auditor",
    ).toBe("peer authored");
    expect(
      edges.get("remote-broken")?.get("toNode"),
      "the ingest boundary invented an endpoint for a remote record",
    ).toBeUndefined();

    expect(
      lines.filter((line) => line.includes("remote-broken") && REASON_CODE.test(line)),
      "a rejection signature was emitted for a REMOTE record",
    ).toEqual([]);

    cs.destroy();
  });
});
