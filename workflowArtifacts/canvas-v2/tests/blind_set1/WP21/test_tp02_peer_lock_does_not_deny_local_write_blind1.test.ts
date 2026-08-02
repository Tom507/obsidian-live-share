// WP21 AC1 blind1 — the write judged from what the ROOM ends up holding, not
// from what the writing client's own doc happens to say.
//
// A local read cannot separate "the write landed" from "the write landed only
// here". `Y.encodeStateAsUpdate` can: it is byte-for-byte what this peer puts on
// the wire. Two virgin replicas are rebuilt from that stream, and all three are
// required to agree — three replicas, never two, because a two-replica agreement
// is also what a broadcast of nothing produces.
//
// The subject is the same as the visible test — a peer's lock must not deny a
// local write — but the fixture is inverted in every dimension that matters:
//
//   ├── the LOCK HOLDER is the lowest-id peer AND the local client is a genuine
//   │      co-claimant that has already lost the tiebreak (the visible test never
//   │      claims locally at all), so the diff-inferred claim runs into a lock it
//   │      cannot win — historically the exact shape that produced a denial;
//   ├── the write is a TEXT + COLOUR change, not geometry, so it goes nowhere
//   │      near the `pos` register the visible test moves; and
//   └── two records are touched in ONE pass, one held and one free, so a
//          surviving gate that dropped the whole pass and one that dropped only
//          the held record are distinguishable.
//
// CRDT ORDERING: every write in this test has a single author. The peers here
// hold locks and never write, so no assertion depends on a Yjs clientID tiebreak.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type AwarenessLike, CanvasPresence } from "../../../canvas/canvas-presence";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "notes/retro.canvas";

const HELD = { id: "held", type: "text", x: 0, y: 0, width: 300, height: 150, text: "before" };
const FREE = { id: "free", type: "text", x: 500, y: 0, width: 300, height: 150, text: "untouched" };

const canvasJson = (nodes: Record<string, unknown>[]) => JSON.stringify({ nodes, edges: [] });

function createVault(initial: Record<string, string>) {
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

function makeAwarenessNetwork() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners: Array<() => void> = [];
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    states,
    client(clientID: number): AwarenessLike {
      return {
        clientID,
        getLocalState: () => states.get(clientID) ?? null,
        setLocalState: (s: Record<string, unknown> | null) => {
          if (s === null) states.delete(clientID);
          else states.set(clientID, s);
          notify();
        },
        getStates: () => states,
        on: (_e, cb) => {
          listeners.push(cb);
        },
        off: (_e, cb) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };
}

/** The record as a plain object, read off whichever replica is asked. */
const readNode = (doc: Y.Doc, id: string) =>
  (doc.getMap<Y.Map<unknown>>("nodes").get(id) as Y.Map<unknown> | undefined)?.toJSON() as
    | Record<string, unknown>
    | undefined;

describe("WP21 AC1 blind1 — the whole room receives a write made under a peer's lock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a losing co-claimant's edit reaches every replica, and the free record with it", async () => {
    const vault = createVault({ [PATH]: canvasJson([HELD, FREE]) });
    const syncManager = createSyncManager();
    const net = makeAwarenessNetwork();

    // clientID 1 holds `held`; 4 is this client and will claim it too and lose.
    const HOLDER = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "holder", color: "#0a0" },
    });
    const LOCAL = new CanvasPresence({
      path: PATH,
      awareness: net.client(4),
      identity: { clientId: 4, name: "local", color: "#a00" },
    });
    HOLDER.start();
    LOCAL.start();
    HOLDER.acquireLock("held");

    const warns: string[] = [];
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: (_c: string, m: string) => warns.push(m) });
    cs.setCanWrite(() => true);
    cs.setOnLocalNodeChange((_p, nodeId) => LOCAL.onDiffInferredChange(nodeId));
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: false,
        handedToView: { node: new Set<string>(), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    // There is no gate left for main.ts to hand a lock predicate to.
    const surface = cs as unknown as Record<string, unknown>;
    expect(typeof surface.setCanWriteNode, "a lock write-gate is still injectable").toBe(
      "undefined",
    );
    expect(typeof surface.setCanDeleteNode, "a lock delete-gate is still injectable").toBe(
      "undefined",
    );
    expect(LOCAL.canWriteNode("held"), "the fixture is vacuous: nobody holds the record").toBe(
      false,
    );

    // ONE pass touching a held record and a free record.
    const edited = canvasJson([
      { ...HELD, text: "after", color: "6" },
      { ...FREE, text: "untouched", color: "2" },
    ]);
    vault.files.set(PATH, edited);
    await cs.handleLocalModify(PATH);

    // The diff-inferred claim ran into a lock it cannot win — and still wrote.
    expect(
      LOCAL.canWriteNode("held"),
      "the UX lock silently released; AC2 requires it to be untouched",
    ).toBe(false);

    // Three replicas, rebuilt from exactly what this client would broadcast.
    const replicas = [doc, new Y.Doc(), new Y.Doc()];
    const wire = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(replicas[1], wire, "peer-b");
    Y.applyUpdate(replicas[2], wire, "peer-c");

    for (const [index, replica] of replicas.entries()) {
      expect(
        readNode(replica, "held")?.text,
        `replica ${index} never received the edit made under the peer's lock`,
      ).toBe("after");
      expect(readNode(replica, "held")?.color, `replica ${index} lost the colour write`).toBe("6");
      expect(readNode(replica, "free")?.color, `replica ${index} lost the free record's write`).toBe(
        "2",
      );
    }

    expect(
      warns.filter((m) => m.startsWith("LOCK DENIED:")),
      "the removed denial signature was emitted",
    ).toEqual([]);
    expect(
      (cs as unknown as { lastWrittenContent: Map<string, string> }).lastWrittenContent.get(PATH),
      "the diff baseline was held because a write was 'denied'",
    ).toBe(edited);

    cs.destroy();
    HOLDER.destroy();
    LOCAL.destroy();
  });
});
