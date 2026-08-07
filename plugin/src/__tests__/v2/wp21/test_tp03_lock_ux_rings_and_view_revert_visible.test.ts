// WP21 / AC2 — "Locks still work as UX: rings still colour, the loser's **view**
// revert still happens."
//
// This is the PRESERVATION half of a removal WP, and it is the half that goes
// wrong. The deleted code (`canWriteEntity`, the injected gates, the baseline
// hold) sits inside the same lock story as the code that must survive, so the
// realistic failure mode is not "the gate is still there" but "the ring
// bookkeeping / the loser-revert / the diff-inferred claim went with it".
//
// Three peers, because a tiebreak is not a two-peer property: with holders
// {1, 2, 3} the winner is 1, and BOTH 2 and 3 must lose — a `min` replaced by
// "any other holder" or by a pairwise comparison still passes with two peers.
//
// WHAT CHANGED AND WHAT DID NOT, after this WP:
//   ├── UNCHANGED — the loser releases its claim and `onRevert` fires exactly
//   │      once per lost node, and the ring shows the WINNER's colour.
//   └── CHANGED   — the revert is now a VIEW operation only. It reloads the
//          shared snapshot into the view; it emits no CRDT write, and it does
//          not roll the loser's data back, because the loser's write was never
//          denied in the first place (AC1). The doc is the oracle for that: the
//          revert must move the view, and must not move the doc.
//
// `onRevert` here mirrors `main.ts::revertCanvasNode` (snapshot + authoritative
// full reconcile), which is the established way this repo pins main.ts glue that
// has no test file of its own (`canvas-sync.test.ts`, the US2 AC9 block).
//
// No timers, no sleeps: `reconcileClaims()` is called directly, exactly as the
// awareness "change" listener calls it.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type AwarenessLike,
  CanvasPresence,
  computeRingDelta,
  resolveHighlights,
} from "../../../canvas/canvas-presence";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "studio/plan.canvas";

const CARD = { id: "c1", type: "text", x: 0, y: 0, width: 240, height: 120, text: "the card" };
const OTHER = { id: "c2", type: "text", x: 600, y: 0, width: 240, height: 120, text: "other" };

const canvasJson = (nodes: Record<string, unknown>[]) => JSON.stringify({ nodes, edges: [] });

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

describe("WP21 AC2 — locks remain a working UX after the write-denial removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("with three co-claimants the ring shows the winner's colour on both losers' screens", () => {
    const net = makeAwarenessNetwork();
    const peers = [
      { id: 1, name: "Ada", color: "#2ecc71" },
      { id: 2, name: "Bo", color: "#e74c3c" },
      { id: 3, name: "Cy", color: "#3498db" },
    ];
    const presences = peers.map((p) => {
      const presence = new CanvasPresence({
        path: PATH,
        awareness: net.client(p.id),
        identity: { clientId: p.id, name: p.name, color: p.color },
      });
      presence.start();
      return presence;
    });
    // Claim in DESCENDING id order, so the winner arrives last — a tiebreak that
    // silently depended on arrival order would show Cy's colour instead.
    presences[2].acquireLock("c1");
    presences[1].acquireLock("c1");
    presences[0].acquireLock("c1");

    for (const loser of [2, 3]) {
      const highlights = resolveHighlights(loser, PATH, net.states);
      expect(
        highlights,
        `client ${loser} does not see the held ring at all — the UX lock stopped colouring`,
      ).toEqual([{ nodeId: "c1", color: "#2ecc71", name: "Ada" }]);

      const delta = computeRingDelta(new Map(), highlights);
      expect(delta.add.map((h) => h.nodeId), `client ${loser} adds no ring`).toEqual(["c1"]);
      expect(delta.remove, `client ${loser} removes a ring it never had`).toEqual([]);
    }

    // The winner sees no ring for its OWN hold (a ring marks a PEER's hold).
    expect(
      resolveHighlights(1, PATH, net.states),
      "the winner draws a held ring around its own card",
    ).toEqual([]);

    for (const presence of presences) presence.destroy();
  });

  it("the loser releases and its view reverts once, without the revert touching the doc", async () => {
    const vault = createVault({ [PATH]: canvasJson([CARD, OTHER]) });
    const syncManager = createSyncManager();
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["c1", "c2"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    const net = makeAwarenessNetwork();
    // clientID 1 is the deterministic winner; 2 (this client) and 3 both lose.
    const WINNER = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "Ada", color: "#2ecc71" },
    });
    const reverted: string[] = [];
    const viewReloads: Record<string, unknown>[][] = [];
    const LOCAL = new CanvasPresence({
      path: PATH,
      awareness: net.client(2),
      identity: { clientId: 2, name: "Bo", color: "#e74c3c" },
      // Exactly `main.ts::revertCanvasNode`: read the shared snapshot, force it
      // onto the live view. A null snapshot is a no-op, never a view wipe.
      onRevert: (nodeId: string) => {
        reverted.push(nodeId);
        const snapshot = cs.getCanvasSnapshot(PATH);
        if (!snapshot) return;
        viewReloads.push(snapshot.nodes as Record<string, unknown>[]);
      },
    });
    const thirdReverted: string[] = [];
    const THIRD = new CanvasPresence({
      path: PATH,
      awareness: net.client(3),
      identity: { clientId: 3, name: "Cy", color: "#3498db" },
      onRevert: (nodeId: string) => thirdReverted.push(nodeId),
    });
    WINNER.start();
    LOCAL.start();
    THIRD.start();

    // This client drags the card, so it claims it.
    LOCAL.acquireLock("c1");
    expect(LOCAL.isLockedByMe("c1"), "the local claim never registered").toBe(true);

    // A THIRD peer with a HIGHER id also grabs it: it loses to us on the spot.
    // (Three peers, so the tiebreak is a minimum and not a pairwise accident.)
    THIRD.acquireLock("c1");
    expect(thirdReverted, "the higher-id peer did not lose the tiebreak to us").toEqual(["c1"]);
    expect(THIRD.isLockedByMe("c1"), "the higher-id peer kept a claim it lost").toBe(false);
    expect(LOCAL.isLockedByMe("c1"), "we lost a tiebreak against a HIGHER id").toBe(true);

    // The local drag reaches the doc — AC1: the claim carries no write authority.
    const moved = canvasJson([{ ...CARD, x: 120 }, OTHER]);
    vault.files.set(PATH, moved);
    await cs.handleLocalModify(PATH);
    expect(
      (nodes.get("c1") as Y.Map<unknown>).get("x"),
      "the optimistic local move was denied — a lock still carries write authority",
    ).toBe(120);

    const updatesAfterClaim: number[] = [];
    doc.on("update", () => updatesAfterClaim.push(1));

    // The winner's claim arrives. Settling is driven by the awareness "change"
    // listener `start()` installed, exactly as in production.
    WINNER.acquireLock("c1");

    expect(reverted, "the loser's view revert did not fire exactly once").toEqual(["c1"]);
    expect(viewReloads, "the revert never reloaded the view from the shared snapshot").toHaveLength(
      1,
    );
    expect(
      viewReloads[0].find((n) => n.id === "c1")?.x,
      "the view was reloaded from something other than the current shared state",
    ).toBe(120);
    expect(LOCAL.isLockedByMe("c1"), "the loser kept its claim").toBe(false);
    expect(WINNER.isLockedByMe("c1"), "the winner lost its claim to the loser-revert").toBe(true);
    expect(
      LOCAL.reconcileClaims(),
      "settling again reverts a second time — the revert is not idempotent",
    ).toEqual([]);
    expect(reverted, "a re-settle fired the view revert again").toEqual(["c1"]);

    expect(
      updatesAfterClaim,
      "the loser-revert emitted a CRDT write: the view revert became a data revert",
    ).toEqual([]);

    cs.destroy();
    WINNER.destroy();
    LOCAL.destroy();
    THIRD.destroy();
  });

  it("the diff-inferred lock claim still fires from a local save", async () => {
    const vault = createVault({ [PATH]: canvasJson([CARD, OTHER]) });
    const syncManager = createSyncManager();
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    await cs.subscribe(PATH, "host");

    const net = makeAwarenessNetwork();
    const LOCAL = new CanvasPresence({
      path: PATH,
      awareness: net.client(7),
      identity: { clientId: 7, name: "solo", color: "#888" },
    });
    LOCAL.start();
    // The production wiring this WP must NOT remove: the lock is claimed from the
    // diff when the private Canvas API never fired an interaction event.
    cs.setOnLocalNodeChange((_p, nodeId) => LOCAL.onDiffInferredChange(nodeId));

    expect(LOCAL.isLockedByMe("c1"), "the fixture pre-claimed the card").toBe(false);

    vault.files.set(PATH, canvasJson([{ ...CARD, x: 42 }, OTHER]));
    await cs.handleLocalModify(PATH);

    expect(
      LOCAL.isLockedByMe("c1"),
      "the diff-inferred lock claim was deleted with the write gate — a drag no longer holds the card",
    ).toBe(true);
    expect(
      LOCAL.isLockedByMe("c2"),
      "an untouched card was claimed too — the claim is no longer per-changed-node",
    ).toBe(false);

    cs.destroy();
    LOCAL.destroy();
  });
});
