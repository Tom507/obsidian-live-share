// WP4 / Definition of Done — the Symptom-2 cascade cannot start.
//
// "the Symptom-2 cascade cannot start — a stale save produces no outbound delta."
//
// The user-reported symptom is a cascade, not a single lost edit: reloading from
// an offscreen (stale) surface shreds first one version, then the other. The loop
// needs a first step — one client pushing a value it never received. This test
// point attacks exactly that first step, and it uses THREE peers because the
// interesting property is what the OTHER peers observe: with two peers a revert
// and a merge are hard to tell apart, with three the revert is visible as a
// value that two independent replicas never asked for.
//
// The oracle is the outbound delta itself: `Y.encodeStateAsUpdate(doc, svBefore)`
// is byte-for-byte what this client would send. Applying it to a replica that
// already holds the peer's value proves whether the field was written at all —
// far stronger than reading the local doc, which a local write would also win.
//
//   ├── T1 the stale save emits no delta for the stale field; all three peers
//   │      keep the peer's value and still receive the genuine change.
//   ├── T2 a three-way interleaving (two peers editing different records while
//   │      the third saves a stale file) converges with nothing reverted.
//   └── T3 repeated stale saves never accumulate into a cascade.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "board.canvas";

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
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

/** One-way replication, as the relay would deliver it (a REMOTE transaction). */
function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "one" };
const N2 = { id: "n2", type: "text", x: 600, y: 0, width: 200, height: 100, text: "two" };

/** Peer 1 owns the real CanvasSync; peers 2 and 3 are plain replicas. */
async function makeRoom(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();

  const doc2 = new Y.Doc();
  const doc3 = new Y.Doc();
  push(doc1, doc2);
  push(doc1, doc3);
  return { vault, cs, doc1, doc2, doc3, surface };
}

/** Everything peer 1 would send after `svBefore`, applied to a fresh replica. */
function outboundReplica(doc1: Y.Doc, svBefore: Uint8Array, base: Y.Doc): Y.Doc {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(base), "peer");
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc1, svBefore), "peer");
  return replica;
}

describe("WP4 DoD — a stale save produces no outbound delta (3 peers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the stale field is absent from the outbound delta; the genuine one is in it", async () => {
    const room = await makeRoom(canvasJson([N1, N2]));

    // Peer 2 moves n1 far to the right. Peers 1 and 3 integrate it.
    room.doc2.transact(() => {
      room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 500);
    });
    push(room.doc2, room.doc1);
    push(room.doc2, room.doc3);
    expect(nodeField(room.doc1, "n1", "x")).toBe(500);

    // Peer 1's surface is offscreen: it never saw the move, and Obsidian saves
    // its own picture — the old x, plus a genuine drag on the y axis.
    const beforeSave = Y.encodeStateVector(room.doc1);
    const staleBase = new Y.Doc();
    Y.applyUpdate(staleBase, Y.encodeStateAsUpdate(room.doc1), "peer");

    room.vault.files.set(PATH, canvasJson([{ ...N1, y: 40 }, N2]));
    await room.cs.handleLocalModify(PATH);

    // What peer 1 puts on the wire, evaluated on a replica that holds x=500.
    const replica = outboundReplica(room.doc1, beforeSave, staleBase);
    expect(nodeField(replica, "n1", "x"), "the outbound delta carried the stale x").toBe(500);
    expect(nodeField(replica, "n1", "y"), "the genuine drag never left this client").toBe(40);

    // And the room agrees.
    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x")).toBe(500);
      expect(nodeField(doc, "n1", "y")).toBe(40);
    }
  });

  it("T2 two peers editing different records + one stale save converge with no revert", async () => {
    const room = await makeRoom(canvasJson([N1, N2]));

    room.doc2.transact(() => {
      room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 500);
    });
    room.doc3.transact(() => {
      room.doc3.getMap<Y.Map<unknown>>("nodes").get("n2")?.set("text", "renamed by 3");
    });
    push(room.doc2, room.doc1);
    push(room.doc3, room.doc1);

    // Peer 1 saves a file that predates BOTH edits, with one real change of its
    // own (a new card).
    room.vault.files.set(
      PATH,
      canvasJson([
        N1,
        N2,
        { id: "n3", type: "text", x: 0, y: 400, width: 200, height: 100, text: "mine" },
      ]),
    );
    await room.cs.handleLocalModify(PATH);

    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    push(room.doc2, room.doc3);
    push(room.doc3, room.doc2);

    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x"), "peer 2's move was reverted").toBe(500);
      expect(nodeField(doc, "n2", "text"), "peer 3's rename was reverted").toBe("renamed by 3");
      expect(nodeField(doc, "n3", "text"), "peer 1's own new card was lost").toBe("mine");
    }
  });

  it("T3 repeated stale saves never accumulate into a cascade", async () => {
    const room = await makeRoom(canvasJson([N1, N2]));

    room.doc2.transact(() => {
      room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 500);
      room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("text", "peer one");
    });
    push(room.doc2, room.doc1);
    push(room.doc2, room.doc3);

    // Three saves of the same offscreen surface, each with a fresh real change.
    for (const y of [40, 41, 42]) {
      room.vault.files.set(PATH, canvasJson([{ ...N1, y }, N2]));
      await room.cs.handleLocalModify(PATH);
      expect(nodeField(room.doc1, "n1", "x")).toBe(500);
      expect(nodeField(room.doc1, "n1", "text")).toBe("peer one");
    }

    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x")).toBe(500);
      expect(nodeField(doc, "n1", "text")).toBe("peer one");
      expect(nodeField(doc, "n1", "y")).toBe(42);
    }
  });
});
