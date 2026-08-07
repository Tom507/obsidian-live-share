// WP27 / AC3 — the awareness field shape, INCLUDING `canvasPath`, is unchanged
// and still carries a vault path.
//
// This is the only file in the WP27 set that imports nothing WP27 adds, and that
// is deliberate. It is a CHARACTERISATION pin: it passes against the tree as it
// stands today and must keep passing after the identity change. Its value is
// entirely in what turns it red — an implementation that "modernises"
// `canvasPath` to carry the guid or the `__canvas__:<guid>` doc id, which is the
// single most natural thing to do while re-keying identity, and which would
// silently split every peer's presence into two disjoint rooms for the same
// canvas.
//
// `canvas-presence.ts` is explicitly out of scope for this whole initiative
// (charter §3, ESCALATE if a WP believes otherwise), so this file only reads it.
// The exact key set is asserted whole rather than key by key: a widened payload
// is the drift this pin exists to catch, and a per-key check cannot see it.

import { describe, expect, it, vi } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanDeleteNode,
  computeCanWriteNode,
  holdersOf,
  resolveHolder,
} from "../../../canvas/canvas-presence";

const PATH = "boards/board.canvas";
const OTHER_PATH = "boards/other.canvas";
// The two shapes a guid-keyed implementation would put here instead.
const GUID = "0f2a9c6e1b4d47aa9d316c0e2f8b5a70";
const DOC_ID = `__canvas__:${GUID}`;

function fakeAwareness(states: Map<number, Record<string, unknown>> = new Map()) {
  const emitted: Record<string, unknown>[] = [];
  const awareness: AwarenessLike & { emitted: Record<string, unknown>[] } = {
    emitted,
    clientID: 1,
    getLocalState: () => null,
    setLocalState: (state) => {
      if (state) emitted.push(state);
    },
    getStates: () => states,
    on: vi.fn(),
    off: vi.fn(),
  };
  return awareness;
}

function peerState(path: string, nodeId: string): Record<string, unknown> {
  return {
    canvasPath: path,
    nodeId,
    x: 10,
    y: 20,
    lockedNodes: { [nodeId]: { color: "#ff0000", name: "peer" } },
  };
}

describe("WP27 AC3 — the canvas awareness field shape is untouched", () => {
  it("the emitted local state has exactly the six documented keys", () => {
    const awareness = fakeAwareness();
    const presence = new CanvasPresence({
      path: PATH,
      awareness,
      identity: { clientId: 1, name: "me", color: "#00ff00" },
    });

    presence.start();

    expect(awareness.emitted.length).toBeGreaterThan(0);
    const state = awareness.emitted[0];
    expect(Object.keys(state).sort()).toEqual([
      "canvasPath",
      "identity",
      "lockedNodes",
      "nodeId",
      "x",
      "y",
    ]);

    presence.destroy();
  });

  it("`canvasPath` carries the vault PATH, never a guid or a doc id", () => {
    const awareness = fakeAwareness();
    const presence = new CanvasPresence({
      path: PATH,
      awareness,
      identity: { clientId: 1, name: "me", color: "#00ff00" },
    });

    presence.start();
    presence.acquireLock("n-a");

    for (const state of awareness.emitted) {
      expect(state.canvasPath).toBe(PATH);
      expect(state.canvasPath).not.toBe(GUID);
      expect(state.canvasPath).not.toBe(DOC_ID);
      expect(String(state.canvasPath).startsWith("__canvas__:")).toBe(false);
    }

    presence.destroy();
  });

  it("every awareness resolver still matches on the path", () => {
    const states = new Map<number, Record<string, unknown>>([
      [7, peerState(PATH, "n-a")],
      [9, peerState(OTHER_PATH, "n-a")],
    ]);

    expect(holdersOf(PATH, "n-a", states)).toEqual([7]);
    expect(holdersOf(OTHER_PATH, "n-a", states)).toEqual([9]);
    // The doc id is not a room key and must find nobody.
    expect(holdersOf(DOC_ID, "n-a", states)).toEqual([]);
    expect(holdersOf(GUID, "n-a", states)).toEqual([]);

    expect(resolveHolder(PATH, "n-a", states)).toBe(7);
    expect(resolveHolder(DOC_ID, "n-a", states)).toBeNull();

    // The two advisory gates read through the same path key.
    expect(computeCanWriteNode(7, PATH, "n-a", states)).toBe(true);
    expect(computeCanWriteNode(11, PATH, "n-a", states)).toBe(false);
    expect(computeCanDeleteNode(7, PATH, "n-a", states)).toBe(true);
    expect(computeCanDeleteNode(11, PATH, "n-a", states)).toBe(false);
    // A doc-id "room" sees no holders at all, so the gates would wrongly open.
    expect(computeCanWriteNode(11, DOC_ID, "n-a", states)).toBe(true);
  });

  it("a state whose canvasPath is a doc id belongs to no path room", () => {
    // The exact damage a guid-keyed rewrite would do, stated as an assertion:
    // a peer that broadcast the doc id is invisible to every peer that
    // broadcast the path, and vice versa.
    const mixed = new Map<number, Record<string, unknown>>([
      [7, peerState(PATH, "n-a")],
      [8, peerState(DOC_ID, "n-a")],
    ]);

    expect(holdersOf(PATH, "n-a", mixed)).toEqual([7]);
    expect(holdersOf(DOC_ID, "n-a", mixed)).toEqual([8]);
    expect(holdersOf(PATH, "n-a", mixed)).not.toContain(8);
  });
});
