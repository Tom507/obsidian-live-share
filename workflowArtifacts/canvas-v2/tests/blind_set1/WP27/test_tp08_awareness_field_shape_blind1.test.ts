// WP27 / AC3 blind1 — the awareness shape, attacked as a THREE-PEER PARTITION
// over two canvases instead of one emitted state inspected key by key.
//
// Different angle: the charter's own constraint note says never to reason from
// two peers, because interleaving classes start at three. Here three peers sit
// on two paths with overlapping node ids, and the oracle is the exact holder
// partition per (path, nodeId). A `canvasPath` that carried the guid or the doc
// id would collapse or scatter that partition, and it would do so invisibly to
// any single-peer shape check.
//
// The emitted state is also sampled at EVERY emission across an acquire/release
// cycle, so a shape that is right on the first broadcast and drifts on a later
// one is caught.

import { describe, expect, it, vi } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanDeleteNode,
  computeCanWriteNode,
  holdersOf,
  resolveCursors,
  resolveHolder,
} from "../../../../../plugin/src/canvas/canvas-presence";

const ROOM_A = "shared/room-a.canvas";
const ROOM_B = "shared/room-b.canvas";
const GUID = "5d41402abc4b2a76b9719d911017c592";
const DOC_ID = `__canvas__:${GUID}`;

const EXPECTED_KEYS = ["canvasPath", "identity", "lockedNodes", "nodeId", "x", "y"];

function state(path: string, locked: string[], x = 0, y = 0) {
  return {
    canvasPath: path,
    nodeId: locked[0] ?? null,
    x,
    y,
    lockedNodes: Object.fromEntries(
      locked.map((id) => [id, { color: "#123456", name: "peer" }]),
    ),
  };
}

function fakeAwareness(states: Map<number, Record<string, unknown>>) {
  const emitted: Record<string, unknown>[] = [];
  const awareness: AwarenessLike & { emitted: Record<string, unknown>[] } = {
    emitted,
    clientID: 1,
    getLocalState: () => null,
    setLocalState: (s) => {
      if (s) emitted.push(s);
    },
    getStates: () => states,
    on: vi.fn(),
    off: vi.fn(),
  };
  return awareness;
}

describe("WP27 AC3 blind1 — three peers, two rooms, one field shape", () => {
  it("the holder partition is exact for every (path, node) pair", () => {
    const states = new Map<number, Record<string, unknown>>([
      [11, state(ROOM_A, ["n1", "n2"])],
      [22, state(ROOM_A, ["n2"])],
      [33, state(ROOM_B, ["n1"])],
    ]);

    expect(holdersOf(ROOM_A, "n1", states)).toEqual([11]);
    expect(holdersOf(ROOM_A, "n2", states).sort()).toEqual([11, 22]);
    expect(holdersOf(ROOM_B, "n1", states)).toEqual([33]);
    expect(holdersOf(ROOM_B, "n2", states)).toEqual([]);
    // Neither guid spelling is a room.
    expect(holdersOf(GUID, "n1", states)).toEqual([]);
    expect(holdersOf(DOC_ID, "n1", states)).toEqual([]);
  });

  it("the advisory gates follow the same partition", () => {
    const states = new Map<number, Record<string, unknown>>([
      [11, state(ROOM_A, ["n2"])],
      [22, state(ROOM_A, ["n2"])],
      [33, state(ROOM_B, ["n2"])],
    ]);

    // Lowest holder wins inside ROOM_A; peer 33 is in a different room entirely.
    expect(resolveHolder(ROOM_A, "n2", states)).toBe(11);
    expect(resolveHolder(ROOM_B, "n2", states)).toBe(33);
    expect(computeCanWriteNode(11, ROOM_A, "n2", states)).toBe(true);
    expect(computeCanWriteNode(22, ROOM_A, "n2", states)).toBe(false);
    expect(computeCanDeleteNode(33, ROOM_B, "n2", states)).toBe(true);
    expect(computeCanDeleteNode(11, ROOM_A, "n2", states)).toBe(false);
  });

  it("cursors are resolved per path and exclude the local client", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, state(ROOM_A, [], 5, 5)],
      [11, state(ROOM_A, [], 10, 20)],
      [33, state(ROOM_B, [], 99, 99)],
    ]);

    const cursors = resolveCursors(1, ROOM_A, states);
    expect(cursors.map((c) => c.clientId)).toEqual([11]);
    expect(resolveCursors(1, DOC_ID, states)).toEqual([]);
  });

  it("every emission across an acquire/release cycle has the same six keys", () => {
    const awareness = fakeAwareness(new Map());
    const presence = new CanvasPresence({
      path: ROOM_A,
      awareness,
      identity: { clientId: 1, name: "local", color: "#abcdef" },
    });

    presence.start();
    presence.acquireLock("n1");
    presence.acquireLock("n2");
    presence.releaseLock("n1");
    presence.releaseLock("n2");

    expect(awareness.emitted.length).toBeGreaterThanOrEqual(5);
    for (const emitted of awareness.emitted) {
      expect(Object.keys(emitted).sort()).toEqual(EXPECTED_KEYS);
      expect(emitted.canvasPath).toBe(ROOM_A);
      expect(String(emitted.canvasPath).includes("__canvas__")).toBe(false);
    }

    presence.destroy();
  });
});
