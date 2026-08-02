// WP18 / AC4 — "Remote deltas are never rejected at ingest; they are left to
// the quarantine auditor."
//
// This is the trap the Shared Ownership Contract §2.3 names: WP14 computes the
// consequence ONCE, as `IngestInvalid.reject = origin === "local"`, and WP18
// must OBEY that field rather than re-derive rejection at the call site. A
// boundary that re-derives it — or that simply refuses everything the schema
// dislikes — makes this replica hold a state its peers do not, which is
// divergence, the one failure a CRDT exists to make impossible.
//
// The two halves run in ONE scenario against ONE doc, so they are a genuine
// discrimination pair rather than two independent claims: the SAME schema
// failure (`MISSING_TYPE`) must be refused when it is proposed locally and
// kept when it arrives from a peer.
//
// The remote write is applied as a completed update from a second Y.Doc, i.e.
// strictly after the local seed. Nothing here asserts on the winner of a
// concurrent same-key write.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "board.canvas";

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

/** A completed peer transaction, integrated into `doc` as a genuine remote delta. */
function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  build(peer.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  peer.destroy();
}

const VALID_NODE = { id: "n-ok", type: "text", x: 0, y: 0, width: 100, height: 50, text: "ok" };
const LOCAL_BAD = { id: "n-local-bad", x: 200, y: 0, width: 100, height: 50, text: "local" };

describe("WP18 AC4 — an invalid REMOTE record is kept while the same invalidity is refused locally", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the local proposal is rejected and signed; the peer's identically-invalid record survives unsigned", async () => {
    const vault = createVault({ [PATH]: canvasJson([VALID_NODE, LOCAL_BAD]) });
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

    // ── Half A: LOCAL. `reject: true` — the record must not be in the doc. ──
    expect(
      nodes.has("n-local-bad"),
      "the local half is vacuous: the invalid local record was accepted",
    ).toBe(false);
    const localSignature = lines.find((line) => line.includes("n-local-bad"));
    expect(localSignature, "the local half emitted no rejection signature").toBeDefined();
    expect(localSignature ?? "").toMatch(REASON_CODE);

    // ── Half B: REMOTE. `reject: false` — the record must survive intact. ──
    applyRemoteDelta(doc, (peerNodes) => {
      const record = new Y.Map<unknown>();
      peerNodes.set("n-remote-bad", record);
      record.set("id", "n-remote-bad");
      record.set("x", 500);
      record.set("y", 500);
      record.set("width", 100);
      record.set("height", 50);
      record.set("text", "from a peer");
      // No `type`: the SAME schema failure as the local half.
    });

    expect(
      nodes.has("n-remote-bad"),
      "an invalid REMOTE record was rejected at ingest — this replica now diverges from its peer",
    ).toBe(true);
    expect(
      nodes.get("n-remote-bad")?.get("text"),
      "the remote record was silently repaired or emptied instead of being left to the auditor",
    ).toBe("from a peer");
    expect(
      nodes.get("n-remote-bad")?.get("type"),
      "the ingest boundary invented a `type` for a remote record",
    ).toBeUndefined();

    // WP64 — post-WP19, "rejected at ingest" can also be spelled as a tombstone.
    // Key presence and intact fields both survive that spelling, so the ingest
    // boundary suppressing the record would leave every assertion above green.
    const deleted = doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "n-remote-bad")),
      "an invalid REMOTE record was TOMBSTONED at ingest — this replica now diverges from its peer",
    ).toBe(false);
    expect(
      buildCanvasData(nodes, doc.getMap<Y.Map<unknown>>("edges"), deleted).nodes.map((n) => n.id),
      "the remote record was removed from the canvas at ingest",
    ).toContain("n-remote-bad");

    const remoteRejection = lines.filter(
      (line) => line.includes("n-remote-bad") && REASON_CODE.test(line),
    );
    expect(
      remoteRejection,
      "a rejection signature was emitted for a REMOTE record: origin is being re-derived at the call site",
    ).toEqual([]);

    cs.destroy();
  });
});
