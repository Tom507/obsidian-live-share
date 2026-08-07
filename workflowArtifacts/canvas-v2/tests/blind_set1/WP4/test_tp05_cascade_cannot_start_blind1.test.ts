// WP4 / Definition of Done — the cascade cannot start (four peers, edges and a
// deletion in the same stale save).
//
// The reported corruption is not one lost move: it is a loop in which one stale
// surface reverts a peer, that peer's view re-saves, and the two versions shred
// each other. Four replicas make the failure unambiguous — three independent
// peers cannot all have "asked for" the value a single offscreen client pushed.
//
// The stale save here is maximally aggressive: it re-states an edge the room
// re-routed, re-states a node the room moved, and OMITS a node another peer
// added. None of it may leave this client.
//
//   ├── T1 nothing of the stale picture reaches the other three replicas.
//   ├── T2 the outbound delta, replayed on an untouched replica, changes only
//   │      the field the user genuinely edited.
//   └── T3 a peer edit that arrives BETWEEN two stale saves is not reverted by
//          the second one either.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Shared/architecture.canvas";

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

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function rec(doc: Y.Doc, which: "nodes" | "edges", id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(which).get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const BOX = { id: "box", type: "text", x: 0, y: 0, width: 200, height: 100, text: "gateway" };
const SINK = { id: "sink", type: "text", x: 500, y: 0, width: 200, height: 100, text: "store" };
const PIPE = { id: "pipe", fromNode: "box", toNode: "sink", fromSide: "right", toSide: "left" };
const BASE = canvasJson([BOX, SINK], [PIPE]);

async function makeRoom() {
  const vault = createVault({ [PATH]: BASE });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(PATH, "host");
  const stale = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, BASE);
  await settle();

  const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
  for (const peer of peers) push(stale, peer);
  return { vault, cs, stale, peers };
}

describe("WP4 DoD (4 peers) — an offscreen save cannot revert the room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 nothing of the stale picture reaches the other replicas", async () => {
    const room = await makeRoom();
    const [p2, p3, p4] = room.peers;

    p2.transact(() => {
      p2.getMap<Y.Map<unknown>>("edges").get("pipe")?.set("toSide", "top");
    });
    p3.transact(() => {
      p3.getMap<Y.Map<unknown>>("nodes").get("sink")?.set("x", 900);
    });
    p4.transact(() => {
      const fresh = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({
        id: "cache",
        type: "text",
        x: 250,
        y: 300,
        width: 200,
        height: 100,
        text: "redis",
      })) {
        fresh.set(k, v);
      }
      p4.getMap<Y.Map<unknown>>("nodes").set("cache", fresh);
    });
    for (const peer of room.peers) push(peer, room.stale);

    // The offscreen client saves the picture it had before any of that, with
    // one genuine rename of its own.
    room.vault.files.set(PATH, canvasJson([{ ...BOX, text: "edge gateway" }, SINK], [PIPE]));
    await room.cs.handleLocalModify(PATH);
    for (const peer of room.peers) push(room.stale, peer);

    for (const doc of [room.stale, ...room.peers]) {
      expect(rec(doc, "edges", "pipe", "toSide"), "the re-route was reverted").toBe("top");
      expect(rec(doc, "nodes", "sink", "x"), "the move was reverted").toBe(900);
      expect(rec(doc, "nodes", "cache", "text"), "the added card was deleted").toBe("redis");
      expect(rec(doc, "nodes", "box", "text")).toBe("edge gateway");
    }
  });

  it("T2 the outbound delta touches only the genuinely edited field", async () => {
    const room = await makeRoom();
    const [p2] = room.peers;

    p2.transact(() => {
      p2.getMap<Y.Map<unknown>>("nodes").get("box")?.set("x", 42);
      p2.getMap<Y.Map<unknown>>("edges").get("pipe")?.set("fromSide", "bottom");
    });
    push(p2, room.stale);

    const before = Y.encodeStateVector(room.stale);
    const witness = new Y.Doc();
    Y.applyUpdate(witness, Y.encodeStateAsUpdate(room.stale), "peer");

    room.vault.files.set(PATH, canvasJson([BOX, { ...SINK, text: "cold store" }], [PIPE]));
    await room.cs.handleLocalModify(PATH);

    Y.applyUpdate(witness, Y.encodeStateAsUpdate(room.stale, before), "peer");
    expect(rec(witness, "nodes", "box", "x")).toBe(42);
    expect(rec(witness, "edges", "pipe", "fromSide")).toBe("bottom");
    expect(rec(witness, "nodes", "sink", "text")).toBe("cold store");
  });

  it("T3 a peer edit arriving between two stale saves is not reverted either", async () => {
    const room = await makeRoom();
    const [p2, p3] = room.peers;

    p2.transact(() => {
      p2.getMap<Y.Map<unknown>>("nodes").get("box")?.set("y", 250);
    });
    push(p2, room.stale);

    room.vault.files.set(PATH, canvasJson([BOX, { ...SINK, text: "s1" }], [PIPE]));
    await room.cs.handleLocalModify(PATH);
    expect(rec(room.stale, "nodes", "box", "y")).toBe(250);

    // Second peer edit lands, then the offscreen client saves again — still the
    // same old picture of `box`.
    p3.transact(() => {
      p3.getMap<Y.Map<unknown>>("nodes").get("box")?.set("width", 320);
    });
    push(p3, room.stale);

    room.vault.files.set(PATH, canvasJson([BOX, { ...SINK, text: "s2" }], [PIPE]));
    await room.cs.handleLocalModify(PATH);

    for (const peer of room.peers) push(room.stale, peer);
    for (const peer of room.peers) push(peer, room.stale);
    for (const doc of [room.stale, ...room.peers]) {
      expect(rec(doc, "nodes", "box", "y")).toBe(250);
      expect(rec(doc, "nodes", "box", "width")).toBe(320);
      expect(rec(doc, "nodes", "sink", "text")).toBe("s2");
    }
  });
});
