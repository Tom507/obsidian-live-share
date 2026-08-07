// WP21 AC3 blind2 — the authorisation guard judged as a LIVE predicate, not as
// a value captured at wiring time.
//
// The visible test builds one client per permission shape. That cannot tell a
// guard that is consulted on every pass from one whose answer was read once and
// cached at injection — and caching is a very attractive "simplification" while
// the neighbouring lock predicate is being deleted, because after WP21 the
// injected `canWrite` is the only remaining predicate in that neighbourhood.
//
// So: ONE client, ONE subscription, and a settings object that flips underneath
// it. The host promotes the guest mid-session (which is what the control channel
// does when a permission changes), and the edit the guard refused earlier must
// then land — from the SAME disk content, because the refusal must not have
// consumed it.
//
//   ├── pass 1, read-only  → refused, doc unchanged
//   ├── pass 2, read-write → the same pending disk edit finally lands, and
//   └── pass 3, demoted again → a NEW edit is refused again
//
// Pass 2 is also the AC1 crossover this WP makes possible: nothing about the
// refusal is allowed to depend on a lock, and a peer holds the card throughout.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type AwarenessLike, CanvasPresence } from "../../../canvas/canvas-presence";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "docs/handbook.canvas";

const CARD = { id: "sec1", type: "text", x: 0, y: 0, width: 400, height: 200, text: "chapter" };

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
  return {
    states,
    client(clientID: number): AwarenessLike {
      return {
        clientID,
        getLocalState: () => states.get(clientID) ?? null,
        setLocalState: (s: Record<string, unknown> | null) => {
          if (s === null) states.delete(clientID);
          else states.set(clientID, s);
          for (const l of [...listeners]) l();
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

describe("WP21 AC3 blind2 — the authorisation guard is consulted per pass, not cached", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a mid-session permission change flips the same client's ability to write", async () => {
    // The mutable settings object `main.ts::canWriteCanvasPath` closes over.
    const settings = { permission: "read-only" as "read-only" | "read-write" };
    const consulted: string[] = [];

    const vault = createVault({ [PATH]: canvasJson([CARD]) });
    const syncManager = createSyncManager();
    const net = makeAwarenessNetwork();

    // A peer holds the card for the whole session: authorisation must be decided
    // by permission alone, never by a lock (AC1 + AC3 together).
    const HOLDER = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "holder", color: "#111" },
    });
    const LOCAL = new CanvasPresence({
      path: PATH,
      awareness: net.client(5),
      identity: { clientId: 5, name: "local", color: "#555" },
    });
    HOLDER.acquireLock("sec1");

    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setCanWrite((path) => {
      consulted.push(path);
      return settings.permission !== "read-only";
    });
    cs.setOnLocalNodeChange((_p, nodeId) => LOCAL.onDiffInferredChange(nodeId));
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: false,
        handedToView: { node: new Set<string>(), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const nodes = syncManager.getDoc(`__canvas__:${PATH}`).doc.getMap<Y.Map<unknown>>("nodes");
    expect(LOCAL.canWriteNode("sec1"), "the fixture is vacuous: nobody holds the card").toBe(false);

    // PASS 1 — read-only. The edit is refused and stays pending on disk.
    const pending = canvasJson([{ ...CARD, text: "chapter v2", color: "3" }]);
    vault.files.set(PATH, pending);
    await cs.handleLocalModify(PATH);
    expect(
      (nodes.get("sec1") as Y.Map<unknown>).get("text"),
      "a read-only client pushed a local edit",
    ).toBe("chapter");
    const consultsAfterFirst = consulted.length;
    expect(consultsAfterFirst, "the authorisation guard was never consulted").toBeGreaterThan(0);

    // PASS 2 — promoted mid-session. The SAME disk bytes must now land.
    settings.permission = "read-write";
    await cs.handleLocalModify(PATH);
    expect(
      (nodes.get("sec1") as Y.Map<unknown>).get("text"),
      "the guard's answer was cached at injection time, or the refusal consumed the pending edit",
    ).toBe("chapter v2");
    expect((nodes.get("sec1") as Y.Map<unknown>).get("color")).toBe("3");
    expect(
      consulted.length,
      "the guard was not consulted again on the second pass",
    ).toBeGreaterThan(consultsAfterFirst);

    // PASS 3 — demoted again. A NEW edit is refused again.
    settings.permission = "read-only";
    vault.files.set(PATH, canvasJson([{ ...CARD, text: "chapter v3", color: "3" }]));
    await cs.handleLocalModify(PATH);
    expect(
      (nodes.get("sec1") as Y.Map<unknown>).get("text"),
      "a demoted client kept writing — the guard is consulted once and remembered",
    ).toBe("chapter v2");

    expect(
      new Set(consulted).size,
      "the guard was asked about a path other than the one being saved",
    ).toBe(1);
    expect(consulted[0], "the guard received a non-canonical path").toBe(PATH);

    cs.destroy();
    HOLDER.destroy();
    LOCAL.destroy();
  });
});
