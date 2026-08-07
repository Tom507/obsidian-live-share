// WP21 AC1 blind2 — the baseline judged by its CONSEQUENCE across two passes,
// not by reading the private map.
//
// "No code path holds a diff baseline because a write was denied" has an
// observable that needs no privileged access: a held baseline makes the SECOND
// save of the same disk content look like a fresh edit and re-attempt the write,
// while an advanced baseline makes it a byte-identical echo that emits nothing.
// Counting Yjs update events across two passes therefore separates the two
// states from the outside — the doc is the oracle, and the log is not consulted
// at all in this file.
//
// The fixture attacks from the far side of the visible test:
//
//   ├── the peer holds the node the WHOLE time, across both passes, so a
//   │      surviving gate has every opportunity to hold the baseline;
//   ├── the second pass writes the SAME bytes, so an advanced baseline must
//   │      produce exactly zero further updates — the discrimination point; and
//   └── a third pass then makes a genuinely new edit, proving the silence in
//          pass two was an echo and not a jammed capture path.
//
// CRDT ORDERING: every write here is authored by the local client alone. The two
// peers hold locks and never write, so no assertion depends on a Yjs clientID
// tiebreak between concurrent same-key writes.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type AwarenessLike, CanvasPresence } from "../../../canvas/canvas-presence";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "arch/decision-log.canvas";

const CARD = { id: "adr", type: "text", x: 10, y: 20, width: 320, height: 160, text: "draft" };
const SIDE = { id: "side", type: "text", x: 500, y: 20, width: 320, height: 160, text: "aside" };
const LINK = { id: "link", fromNode: "adr", fromSide: "right", toNode: "side", toSide: "left" };

const canvasJson = (nodes: Record<string, unknown>[], edges: Record<string, unknown>[]) =>
  JSON.stringify({ nodes, edges });

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

describe("WP21 AC1 blind2 — a locked-node pass advances the baseline, proven by echo silence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pass 1 writes, pass 2 on identical bytes emits nothing, pass 3 writes again", async () => {
    const first = canvasJson([CARD, SIDE], [LINK]);
    const vault = createVault({ [PATH]: first });
    const syncManager = createSyncManager();
    const net = makeAwarenessNetwork();

    // Two peers hold the card for the whole test — the local client is never the
    // lowest-id holder and its UX gate stays false throughout.
    const P1 = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "p1", color: "#101" },
    });
    const P3 = new CanvasPresence({
      path: PATH,
      awareness: net.client(3),
      identity: { clientId: 3, name: "p3", color: "#303" },
    });
    const LOCAL = new CanvasPresence({
      path: PATH,
      awareness: net.client(7),
      identity: { clientId: 7, name: "local", color: "#707" },
    });
    P1.acquireLock("adr");
    P3.acquireLock("adr");

    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
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
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    expect(
      LOCAL.canWriteNode("adr"),
      "the fixture is vacuous: no peer holds the card being written",
    ).toBe(false);
    const surface = cs as unknown as Record<string, unknown>;
    expect(typeof surface.setCanWriteNode, "a lock write-gate is still injectable").toBe(
      "undefined",
    );
    expect(typeof surface.setCanDeleteNode, "a lock delete-gate is still injectable").toBe(
      "undefined",
    );

    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });

    // PASS 1 — a real edit on the held card, plus an edge label.
    const second = canvasJson(
      [{ ...CARD, text: "accepted", color: "4" }, SIDE],
      [{ ...LINK, label: "supersedes" }],
    );
    vault.files.set(PATH, second);
    await cs.handleLocalModify(PATH);

    expect(
      (nodes.get("adr") as Y.Map<unknown>).get("text"),
      "the edit to the peer-held card never reached the doc",
    ).toBe("accepted");
    const afterFirstPass = updates;
    expect(afterFirstPass, "the first pass emitted no CRDT update at all").toBeGreaterThan(0);

    // PASS 2 — the SAME bytes. With the baseline advanced this is an echo.
    await cs.handleLocalModify(PATH);
    expect(
      updates,
      "a second pass over identical bytes emitted an update: the baseline was HELD, so the edit read as fresh intent",
    ).toBe(afterFirstPass);

    // PASS 3 — a genuinely new edit, proving pass 2's silence was an echo and
    // not a capture path that had stopped working.
    const third = canvasJson(
      [{ ...CARD, text: "accepted", color: "6" }, SIDE],
      [{ ...LINK, label: "supersedes" }],
    );
    vault.files.set(PATH, third);
    await cs.handleLocalModify(PATH);

    expect(
      (nodes.get("adr") as Y.Map<unknown>).get("color"),
      "the third pass was swallowed — the capture path is jammed, not quiet",
    ).toBe("6");
    expect(updates, "the third pass emitted no CRDT update").toBeGreaterThan(afterFirstPass);
    expect(
      LOCAL.canWriteNode("adr"),
      "the peers' UX lock evaporated during the passes",
    ).toBe(false);

    cs.destroy();
    P1.destroy();
    P3.destroy();
    LOCAL.destroy();
  });
});
