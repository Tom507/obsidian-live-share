// WP18 AC4 blind2 — the remote delta does not INTRODUCE an invalid record; it
// BREAKS a valid one that is already in the doc.
//
// A peer running an older or newer build removes a node's `type`. From this
// replica's point of view a record that was valid a moment ago is now invalid,
// and the temptation is to "heal" it — restore the type, or drop the record.
// Both are divergence: the peer's state and ours would differ with no delta to
// reconcile them, and the record is the quarantine auditor's business, not the
// ingest boundary's.
//
// The local half of the pair runs against the same doc and the same schema
// failure, so the two consequences are compared directly rather than asserted
// apart.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "healing.canvas";
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

function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  build(peer.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  peer.destroy();
}

const KEEPER = { id: "keeper", type: "text", x: 0, y: 0, width: 200, height: 90, text: "keeper" };
const VICTIM = { id: "victim", type: "text", x: 300, y: 0, width: 200, height: 90, text: "victim" };
/** The host's own file also proposes a broken record — the LOCAL control. */
const LOCAL_BROKEN = { id: "local-broken", x: 600, y: 0, width: 200, height: 90, text: "local" };

describe("WP18 AC4 blind2 — a peer that breaks an existing record is not corrected at ingest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the record stays, un-repaired and unsigned, while the local proposal with the same defect is refused", async () => {
    const vault = createVault({ [PATH]: canvasJson([KEEPER, VICTIM, LOCAL_BROKEN]) });
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
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    // LOCAL control: refused and signed.
    expect(
      nodes.has("local-broken"),
      "the local control is vacuous: the type-less LOCAL record was accepted",
    ).toBe(false);
    expect(
      lines.some((line) => line.includes("local-broken") && REASON_CODE.test(line)),
      "the LOCAL refusal produced no signature",
    ).toBe(true);

    expect(nodes.has("victim"), "the seed never created the record the peer is about to break").toBe(
      true,
    );

    // REMOTE: a peer strips the type off a record that is already shared.
    applyRemoteDelta(doc, (peerNodes) => {
      peerNodes.get("victim")?.delete("type");
    });

    const victim = nodes.get("victim");
    expect(
      victim,
      "the ingest boundary DELETED a record a peer had broken — this replica now diverges",
    ).toBeDefined();
    expect(
      victim?.get("type"),
      "the ingest boundary re-invented the `type` a peer deliberately removed",
    ).toBeUndefined();
    expect(victim?.get("text"), "the broken record was emptied instead of being left alone").toBe(
      "victim",
    );
    expect(nodes.has("keeper"), "an unrelated record was taken with the repair").toBe(true);

    expect(
      lines.filter((line) => line.includes("victim") && REASON_CODE.test(line)),
      "a rejection signature was emitted for a REMOTE record",
    ).toEqual([]);

    cs.destroy();
  });
});
