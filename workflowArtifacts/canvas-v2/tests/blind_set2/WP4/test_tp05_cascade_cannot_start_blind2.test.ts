// WP4 / Definition of Done — the cascade cannot start (alternating-authors
// angle: "first one version, then the other").
//
// The reported shape of the corruption is alternation: two versions of the same
// board take turns overwriting each other until both are damaged. That needs a
// stale client to push at least twice, against two different authors. This
// variant reproduces exactly that rhythm — peer 2 edits, the offscreen client
// saves; peer 3 edits the SAME field, the offscreen client saves again — and
// asserts that the field's value is only ever authored by the peers.
//
// The oracle is the history of the field, sampled after every step, so a value
// that appears for one round and is corrected later still fails the test.
//
//   ├── T1 the alternating rhythm never produces a value the peers did not set.
//   ├── T2 the offscreen client's own edits all survive the same sequence.
//   └── T3 the third peer, which never saved anything, sees no revert either.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "team/board.canvas";

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

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const CARD = { id: "c", type: "text", x: 100, y: 100, width: 200, height: 100, text: "v0" };
const REF = { id: "ref", type: "text", x: 600, y: 100, width: 200, height: 100, text: "ref" };
const BASE = canvasJson([CARD, REF]);

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
  const offscreen = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, BASE);
  await settle();

  const two = new Y.Doc();
  const three = new Y.Doc();
  push(offscreen, two);
  push(offscreen, three);
  return { vault, cs, offscreen, two, three };
}

describe("WP4 DoD (alternation) — two authors, one offscreen saver, no shredding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the field is only ever the value a peer authored", async () => {
    const room = await makeRoom();
    const history: unknown[] = [];
    const sample = () => {
      history.push(nodeField(room.offscreen, "c", "text"));
      history.push(nodeField(room.two, "c", "text"));
      history.push(nodeField(room.three, "c", "text"));
    };

    // Round 1: peer 2 renames, the offscreen client saves its old picture.
    room.two.transact(() => {
      room.two.getMap<Y.Map<unknown>>("nodes").get("c")?.set("text", "v1 by two");
    });
    push(room.two, room.offscreen);
    push(room.two, room.three);
    room.vault.files.set(PATH, canvasJson([{ ...CARD, y: 101 }, REF]));
    await room.cs.handleLocalModify(PATH);
    push(room.offscreen, room.two);
    push(room.offscreen, room.three);
    sample();

    // Round 2: peer 3 renames the same field, the offscreen client saves again.
    room.three.transact(() => {
      room.three.getMap<Y.Map<unknown>>("nodes").get("c")?.set("text", "v2 by three");
    });
    push(room.three, room.offscreen);
    push(room.three, room.two);
    room.vault.files.set(PATH, canvasJson([{ ...CARD, y: 102 }, REF]));
    await room.cs.handleLocalModify(PATH);
    push(room.offscreen, room.two);
    push(room.offscreen, room.three);
    sample();

    expect(
      history.includes("v0"),
      `the original value came back at some point: ${JSON.stringify(history)}`,
    ).toBe(false);
    expect(history.slice(0, 3)).toEqual(["v1 by two", "v1 by two", "v1 by two"]);
    expect(history.slice(3)).toEqual(["v2 by three", "v2 by three", "v2 by three"]);
  });

  it("T2 the offscreen client's own edits all survive the sequence", async () => {
    const room = await makeRoom();

    room.two.transact(() => {
      room.two.getMap<Y.Map<unknown>>("nodes").get("c")?.set("x", 555);
    });
    push(room.two, room.offscreen);
    // Peer 3 must SEE 555 before it writes 777, or the two writes are concurrent
    // on the same key and Yjs breaks the tie on `clientID` — which is
    // `random.uint32()`, so the winner would be a coin flip per run. This push
    // makes 777 a causal successor, which is what the assertion below asserts.
    // Nothing about the scenario needs the two peers to race: what is under test
    // is that the OFFSCREEN client's stale 100 never wins, and that holds either
    // way. Do not remove this line.
    push(room.two, room.three);

    room.vault.files.set(PATH, canvasJson([{ ...CARD, y: 101 }, { ...REF, text: "ref a" }]));
    await room.cs.handleLocalModify(PATH);

    room.three.transact(() => {
      room.three.getMap<Y.Map<unknown>>("nodes").get("c")?.set("x", 777);
    });
    push(room.three, room.offscreen);

    room.vault.files.set(PATH, canvasJson([{ ...CARD, y: 103 }, { ...REF, text: "ref b" }]));
    await room.cs.handleLocalModify(PATH);

    push(room.offscreen, room.two);
    push(room.offscreen, room.three);
    push(room.three, room.two);
    for (const doc of [room.offscreen, room.two, room.three]) {
      expect(nodeField(doc, "c", "x")).toBe(777);
      expect(nodeField(doc, "c", "y")).toBe(103);
      expect(nodeField(doc, "ref", "text")).toBe("ref b");
    }
  });

  it("T3 the peer that never saved sees no revert either", async () => {
    const room = await makeRoom();

    room.two.transact(() => {
      room.two.getMap<Y.Map<unknown>>("nodes").get("ref")?.set("width", 480);
    });
    push(room.two, room.offscreen);
    push(room.two, room.three);

    room.vault.files.set(PATH, canvasJson([CARD, REF]).replace('"text":"v0"', '"text":"v0 local"'));
    await room.cs.handleLocalModify(PATH);
    push(room.offscreen, room.three);

    expect(nodeField(room.three, "ref", "width")).toBe(480);
    expect(nodeField(room.three, "c", "text")).toBe("v0 local");
  });
});
