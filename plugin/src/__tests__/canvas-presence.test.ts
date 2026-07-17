import { describe, expect, it, vi } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanDeleteNode,
  computeCanWriteNode,
  resolveCursors,
  resolveHighlights,
} from "../canvas/canvas-presence";

const PATH = "board.canvas";

// A shared in-memory "network" of awareness states, so several CanvasPresence
// instances contend over the same states map exactly as peers do on the wire —
// but deterministically, with no transport or timers.
function makeNetwork() {
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

function lockState(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return { canvasPath: PATH, nodeId: null, x: 0, y: 0, lockedNodes: {}, ...over };
}

describe("canvas-presence pure decision functions", () => {
  it("computeCanWriteNode: free node is writable", () => {
    const states = new Map<number, Record<string, unknown>>();
    expect(computeCanWriteNode(1, PATH, "n1", states)).toBe(true);
  });

  it("computeCanWriteNode: false while another (lower-id) peer holds (US3 AC5)", () => {
    const states = new Map([[1, lockState({ lockedNodes: { n1: { color: "#a", name: "A" } } })]]);
    expect(computeCanWriteNode(2, PATH, "n1", states)).toBe(false);
  });

  it("computeCanWriteNode: lowest-id co-claimant wins the tiebreak (GAP-1)", () => {
    const states = new Map([
      [1, lockState({ lockedNodes: { n1: { color: "#a", name: "A" } } })],
      [2, lockState({ lockedNodes: { n1: { color: "#b", name: "B" } } })],
    ]);
    expect(computeCanWriteNode(1, PATH, "n1", states)).toBe(true); // lowest id
    expect(computeCanWriteNode(2, PATH, "n1", states)).toBe(false); // loser
  });

  it("computeCanDeleteNode: false when a peer holds the node (US3 AC7 / GAP-2)", () => {
    const states = new Map([[1, lockState({ lockedNodes: { n1: { color: "#a", name: "A" } } })]]);
    expect(computeCanDeleteNode(2, PATH, "n1", states)).toBe(false);
    expect(computeCanDeleteNode(1, PATH, "n1", states)).toBe(true); // own hold
  });

  it("resolveCursors: excludes peers on a different canvas (US2 AC3)", () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { ...lockState({ x: 5, y: 6 }), identity: { clientId: 2, name: "Bob", color: "#00f" } }],
      [3, { canvasPath: "other.canvas", nodeId: null, x: 1, y: 1, lockedNodes: {} }],
    ]);
    const cursors = resolveCursors(1, PATH, states);
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({ clientId: 2, x: 5, y: 6, color: "#00f", name: "Bob" });
  });

  it("resolveHighlights: renders a peer-held node in the holder color (US3 AC1)", () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, lockState({ lockedNodes: { n1: { color: "#0f0", name: "Bob" } } })],
    ]);
    const highlights = resolveHighlights(1, PATH, states);
    expect(highlights).toEqual([{ nodeId: "n1", color: "#0f0", name: "Bob" }]);
  });
});

describe("CanvasPresence lock lifecycle", () => {
  it("emits exactly the shared awareness field shape (US2 AC6)", () => {
    const net = makeNetwork();
    const presence = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "A", color: "#a" },
    });
    presence.start();
    presence.updateCursor(12, 34);

    const emitted = net.states.get(1) as Record<string, unknown>;
    expect(Object.keys(emitted).sort()).toEqual(
      ["canvasPath", "identity", "lockedNodes", "nodeId", "x", "y"].sort(),
    );
    expect(emitted.canvasPath).toBe(PATH);
    expect(emitted.x).toBe(12);
    expect(emitted.y).toBe(34);
  });

  it("acquireLock writes lockedNodes and the sole holder can write (US3 AC1)", () => {
    const net = makeNetwork();
    const presence = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "A", color: "#a" },
    });
    presence.start();
    presence.acquireLock("n1");

    expect((net.states.get(1) as { lockedNodes: Record<string, unknown> }).lockedNodes.n1).toBeDefined();
    expect(presence.canWriteNode("n1")).toBe(true);
  });

  it("lowest-clientID tiebreak: loser reverts optimistic edit + releases (GAP-1, US3 AC3)", () => {
    const net = makeNetwork();
    const revertedByB = vi.fn();
    const A = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "A", color: "#a" },
    });
    const B = new CanvasPresence({
      path: PATH,
      awareness: net.client(2),
      identity: { clientId: 2, name: "B", color: "#b" },
      onRevert: revertedByB,
    });
    A.start();
    B.start();

    // Both grab n1 inside one RTT. As the shared awareness converges, the loser
    // (higher id = B) settles the tiebreak, reverts its optimistic edit, and
    // releases; the winner A keeps exactly one holder.
    A.acquireLock("n1");
    B.acquireLock("n1");

    expect(revertedByB).toHaveBeenCalledWith("n1");
    expect(B.isLockedByMe("n1")).toBe(false);
    expect(A.isLockedByMe("n1")).toBe(true);
    // After settle there is exactly one holder and B may not write (US3 AC4/AC5).
    expect(B.canWriteNode("n1")).toBe(false);
    expect(A.canWriteNode("n1")).toBe(true);
  });

  it("canDeleteNode blocks deleting a peer-held node (US3 AC7)", () => {
    const net = makeNetwork();
    const A = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "A", color: "#a" },
    });
    const B = new CanvasPresence({
      path: PATH,
      awareness: net.client(2),
      identity: { clientId: 2, name: "B", color: "#b" },
    });
    A.start();
    B.start();
    A.acquireLock("n1");

    expect(B.canDeleteNode("n1")).toBe(false);
  });

  it("onRemoteNodeDeleted drops the local lock (GAP-2 behavioral half)", () => {
    const net = makeNetwork();
    const presence = new CanvasPresence({
      path: PATH,
      awareness: net.client(1),
      identity: { clientId: 1, name: "A", color: "#a" },
    });
    presence.start();
    presence.acquireLock("n1");
    expect(presence.isLockedByMe("n1")).toBe(true);

    presence.onRemoteNodeDeleted("n1");
    expect(presence.isLockedByMe("n1")).toBe(false);
  });

  it("onReconnect withholds all locks then re-claims only still-free nodes (US4 AC3/AC4, GAP-4)", () => {
    vi.useFakeTimers();
    try {
      const net = makeNetwork();
      const A = new CanvasPresence({
        path: PATH,
        awareness: net.client(1),
        identity: { clientId: 1, name: "A", color: "#a" },
        reclaimDeferMs: 100,
      });
      const B = new CanvasPresence({
        path: PATH,
        awareness: net.client(2),
        identity: { clientId: 2, name: "B", color: "#b" },
      });
      A.start();
      B.start();

      // A held n1 and n2 before a drop.
      A.acquireLock("n1");
      A.acquireLock("n2");
      // A's socket drops: its ephemeral awareness auto-clears from the network.
      net.states.delete(1);
      // While A was gone, B grabbed n1 unopposed.
      B.acquireLock("n1");

      A.onReconnect();

      // (1) Withheld immediately: A asserts NO locks until peers re-sync — this is
      // what stops A (even as the lower id) from stealing n1 back on reconnect.
      expect(A.isLockedByMe("n1")).toBe(false);
      expect(A.isLockedByMe("n2")).toBe(false);

      // (2) After the defer window A re-claims only the still-free n2; n1 stays
      // with B (the outage-time acquirer) for any clientID ordering.
      vi.advanceTimersByTime(100);
      expect(A.isLockedByMe("n1")).toBe(false);
      expect(A.isLockedByMe("n2")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
