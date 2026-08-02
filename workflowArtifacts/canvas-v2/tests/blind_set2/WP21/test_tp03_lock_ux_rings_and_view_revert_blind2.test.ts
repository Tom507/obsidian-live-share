// WP21 AC2 blind2 — the loser-revert over TWO contested cards at once, and the
// cursor/highlight resolution that shares its awareness snapshot.
//
// The visible test loses one card. A settle that loses two at once is a
// different code shape (the loop over `lockedNodes`, the single `emitLocalState`
// after it), and it is where an over-deletion shows up as "only the first lost
// card reverts" or "the release is broadcast once per node instead of once per
// settle". Two cards, one uncontested card, and a peer on a DIFFERENT canvas —
// the last one because the whole presence layer is path-scoped and a careless
// simplification of the lock code is the classic way that scoping is lost.
//
// The second half is what the ring actually renders while all this happens:
// `resolveCursors` and `resolveHighlights` read the same awareness snapshot the
// tiebreak reads, so they are the cheapest proof that the snapshot itself was
// not disturbed by the removal.
//
// The onRevert here is `main.ts::revertCanvasNode` reduced to its observable
// shape: it is called once per lost node, and it never writes.

import { describe, expect, it } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanWriteNode,
  resolveCursors,
  resolveHighlights,
} from "../../../canvas/canvas-presence";

const PATH = "kanban/sprint.canvas";
const ELSEWHERE = "kanban/backlog.canvas";

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

describe("WP21 AC2 blind2 — a settle that loses two cards at once still reverts both", () => {
  it("both lost cards revert exactly once, the uncontested card is untouched", () => {
    const net = makeAwarenessNetwork();

    const reverted: string[] = [];
    const LOSER = new CanvasPresence({
      path: PATH,
      awareness: net.client(20),
      identity: { clientId: 20, name: "Loser", color: "#e67e22" },
      onRevert: (nodeId: string) => reverted.push(nodeId),
    });
    LOSER.start();
    // The local user drags three cards in one gesture chain.
    for (const nodeId of ["todo", "doing", "solo"]) LOSER.acquireLock(nodeId);
    expect(reverted, "a revert fired before any contest existed").toEqual([]);

    // A single lower-id peer arrives already holding TWO of them. Its state is
    // published in ONE awareness change — the state a peer that was offline
    // during our claims comes back with — so the loser must settle both cards in
    // a single pass, which two sequential `acquireLock` calls would never test.
    net.client(4).setLocalState({
      canvasPath: PATH,
      nodeId: null,
      x: 0,
      y: 0,
      lockedNodes: {
        todo: { color: "#16a085", name: "Contender" },
        doing: { color: "#16a085", name: "Contender" },
      },
      identity: { clientId: 4, name: "Contender", color: "#16a085" },
    });

    expect(
      reverted.sort(),
      "the settle did not revert both contested cards — only the first was handled",
    ).toEqual(["doing", "todo"]);
    expect(LOSER.isLockedByMe("todo"), "a lost card kept its claim").toBe(false);
    expect(LOSER.isLockedByMe("doing"), "a lost card kept its claim").toBe(false);
    expect(
      LOSER.isLockedByMe("solo"),
      "the uncontested card was released too — the settle is not per-node",
    ).toBe(true);

    // Idempotent: settling again reverts nothing further.
    expect(LOSER.reconcileClaims(), "a re-settle reverted an already-lost card").toEqual([]);
    expect(reverted, "the view revert fired twice for the same loss").toHaveLength(2);

    // The tiebreak result the ring is drawn from.
    expect(computeCanWriteNode(20, PATH, "todo", net.states)).toBe(false);
    expect(computeCanWriteNode(4, PATH, "todo", net.states)).toBe(true);
    expect(computeCanWriteNode(20, PATH, "solo", net.states)).toBe(true);

    LOSER.destroy();
  });

  it("rings and cursors stay scoped to this canvas after the settle", () => {
    const net = makeAwarenessNetwork();
    const HERE = new CanvasPresence({
      path: PATH,
      awareness: net.client(4),
      identity: { clientId: 4, name: "Here", color: "#16a085" },
    });
    const THERE = new CanvasPresence({
      path: ELSEWHERE,
      awareness: net.client(9),
      identity: { clientId: 9, name: "There", color: "#8e44ad" },
    });
    HERE.acquireLock("todo");
    THERE.acquireLock("todo");
    HERE.updateCursor(120, 240);
    THERE.updateCursor(-40, -40);

    // Seen from a third client sitting on PATH.
    expect(
      resolveHighlights(20, PATH, net.states),
      "a lock held on ANOTHER canvas leaked into this canvas's rings",
    ).toEqual([{ nodeId: "todo", color: "#16a085", name: "Here" }]);

    const cursors = resolveCursors(20, PATH, net.states);
    expect(cursors.map((c) => c.clientId), "a peer on another canvas leaked into the cursors").toEqual(
      [4],
    );
    expect(cursors[0]).toMatchObject({ x: 120, y: 240, color: "#16a085", name: "Here" });

    HERE.destroy();
    THERE.destroy();
  });
});
