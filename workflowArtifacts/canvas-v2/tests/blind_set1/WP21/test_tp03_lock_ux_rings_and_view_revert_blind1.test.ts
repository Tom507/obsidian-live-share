// WP21 AC2 blind1 — the UX lock judged over a SUCCESSION of holders, not a
// single settle.
//
// The visible test settles one contest once. This one walks the ring through
// three states — claimed, recoloured when the winner leaves, removed when the
// last holder leaves — because the failure mode an over-deletion produces is
// rarely "no ring ever": it is a ring that stops being maintained after the
// first settle, which a single-settle test cannot see.
//
// The second half attacks the revert from its degenerate side: `main.ts`'s
// `revertCanvasNode` reads `getCanvasSnapshot(path)` and a null snapshot must be
// a NO-OP, never a view wipe. An unsubscribed path is the honest way to produce
// that null, and it is the shape most likely to be "simplified away" while the
// surrounding lock code is being deleted.
//
// Four peers here, not three: with holders {2, 5, 9} both non-minimal peers must
// lose, and when 2 leaves the ring must move to 5 rather than to 9 or to nobody.

import { describe, expect, it } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanWriteNode,
  computeRingDelta,
  resolveHighlights,
  resolveHolder,
} from "../../../canvas/canvas-presence";
import type { HeldHighlight } from "../../../canvas/canvas-overlay";

const PATH = "team/roadmap.canvas";
const CARD = "epic-7";

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

/** One observer's ring bookkeeping, advanced across successive settles. */
function makeRingObserver(localId: number, states: Map<number, Record<string, unknown>>) {
  const applied = new Map<string, string>();
  return {
    applied,
    settle(): { add: HeldHighlight[]; recolor: HeldHighlight[]; remove: string[] } {
      const desired = resolveHighlights(localId, PATH, states);
      const delta = computeRingDelta(applied, desired);
      for (const h of [...delta.add, ...delta.recolor]) applied.set(h.nodeId, h.color);
      for (const nodeId of delta.remove) applied.delete(nodeId);
      return delta;
    },
  };
}

describe("WP21 AC2 blind1 — the held ring is maintained across a succession of holders", () => {
  it("the ring appears, recolours when the winner leaves, and disappears with the last holder", () => {
    const net = makeAwarenessNetwork();
    const peers = [
      { id: 2, name: "Two", color: "#222222" },
      { id: 5, name: "Five", color: "#555555" },
      { id: 9, name: "Nine", color: "#999999" },
    ].map((p) => {
      // Deliberately NOT started: `start()` installs the awareness listener that
      // settles the tiebreak on every change, and this scenario needs all three
      // claims to coexist — the genuine in-flight state before a settle, which is
      // exactly the moment the ring has to render correctly.
      const presence = new CanvasPresence({
        path: PATH,
        awareness: net.client(p.id),
        identity: { clientId: p.id, name: p.name, color: p.color },
      });
      return { ...p, presence };
    });
    // A fourth client that only WATCHES — the ring is drawn on its screen.
    const observer = makeRingObserver(11, net.states);

    expect(observer.settle().add, "a ring appeared with nobody holding anything").toEqual([]);

    for (const peer of peers) peer.presence.acquireLock(CARD);
    // The winner is the minimum, and both other claimants have already lost.
    expect(resolveHolder(PATH, CARD, net.states), "the winner is not the lowest clientID").toBe(2);
    expect(computeCanWriteNode(5, PATH, CARD, net.states)).toBe(false);
    expect(computeCanWriteNode(9, PATH, CARD, net.states)).toBe(false);

    const first = observer.settle();
    expect(first.add, "the held ring was never added").toEqual([
      { nodeId: CARD, color: "#222222", name: "Two" },
    ]);
    expect(first.recolor, "a fresh ring was reported as a recolour").toEqual([]);

    // The winner walks away. The ring must follow the NEXT-lowest holder.
    peers[0].presence.releaseLock(CARD);
    const second = observer.settle();
    expect(second.add, "the ring was re-added instead of recoloured").toEqual([]);
    expect(second.recolor, "the ring did not follow the new winner").toEqual([
      { nodeId: CARD, color: "#555555", name: "Five" },
    ]);
    expect(second.remove, "the ring was dropped when the first holder left").toEqual([]);
    expect(resolveHolder(PATH, CARD, net.states), "the new winner is not the lowest id").toBe(5);

    // The remaining holders leave; only then does the ring go.
    peers[1].presence.releaseLock(CARD);
    const third = observer.settle();
    expect(third.recolor, "the ring did not fall through to the last holder").toEqual([
      { nodeId: CARD, color: "#999999", name: "Nine" },
    ]);
    expect(third.remove, "the ring was removed while a holder remained").toEqual([]);

    peers[2].presence.releaseLock(CARD);
    const fourth = observer.settle();
    expect(fourth.remove, "the ring outlived its last holder").toEqual([CARD]);
    expect(observer.applied.size, "ring bookkeeping leaked an entry").toBe(0);

    for (const peer of peers) peer.presence.destroy();
  });

  it("the loser's view revert on an unsubscribed path is a no-op, not a view wipe", async () => {
    const { CanvasSync } = await import("../../../files/canvas-sync");
    const cs = new CanvasSync(
      { getAbstractFileByPath: () => null } as never,
      { getDoc: () => ({}), releaseDoc: () => {}, waitForSync: async () => {} } as never,
      { mutePathEvents: () => {}, unmutePathEvents: () => {} } as never,
    );

    const net = makeAwarenessNetwork();
    const reverted: string[] = [];
    const viewReloads: unknown[] = [];
    const WINNER = new CanvasPresence({
      path: PATH,
      awareness: net.client(3),
      identity: { clientId: 3, name: "win", color: "#3" },
    });
    const LOSER = new CanvasPresence({
      path: PATH,
      awareness: net.client(8),
      identity: { clientId: 8, name: "lose", color: "#8" },
      // `main.ts::revertCanvasNode`, degenerate branch first.
      onRevert: (nodeId: string) => {
        reverted.push(nodeId);
        const snapshot = cs.getCanvasSnapshot("never/subscribed.canvas");
        if (!snapshot) return;
        viewReloads.push(snapshot);
      },
    });
    WINNER.start();
    LOSER.start();

    LOSER.acquireLock(CARD);
    WINNER.acquireLock(CARD);

    expect(reverted, "the loser-revert did not fire for the lost card").toEqual([CARD]);
    expect(
      viewReloads,
      "a null snapshot was pushed into the view — the revert became a view wipe",
    ).toEqual([]);
    expect(LOSER.isLockedByMe(CARD), "the loser kept the claim it lost").toBe(false);

    cs.destroy();
    WINNER.destroy();
    LOSER.destroy();
  });
});
