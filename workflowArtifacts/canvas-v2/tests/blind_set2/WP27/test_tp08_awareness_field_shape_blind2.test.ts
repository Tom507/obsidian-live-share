// WP27 / AC3 blind2 — the awareness contract read through its own PARSER
// instead of through its emitter.
//
// Different angle: blind1 watches what `CanvasPresence` broadcasts. This one
// attacks the receiving side — the module refuses any state whose `canvasPath`
// is not a string, and every consumer compares it with `===`. Feeding a corpus
// of malformed and guid-shaped states through `holdersOf` shows that the field
// is (a) required, (b) compared exactly, and (c) not normalised, trimmed or
// prefix-matched. Any of those three would let a guid-keyed writer and a
// path-keyed reader appear to agree.
//
// Also asserts what the shape must NOT gain: no `guid`, no `epoch`, no
// `canvasGuid`, no `docId`. AC3 says the shape is unchanged, and "unchanged"
// is a statement about additions as much as about replacements.

import { describe, expect, it, vi } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanWriteNode,
  holdersOf,
  resolveHighlights,
} from "../../../../../plugin/src/canvas/canvas-presence";

const PATH = "kanban/board.canvas";
const GUID = "aab3238922bcc25a6f606eb525ffdc56";
const DOC_ID = `__canvas__:${GUID}`;

function lockState(canvasPath: unknown, nodeId: string) {
  return {
    canvasPath,
    nodeId,
    x: 0,
    y: 0,
    lockedNodes: { [nodeId]: { color: "#010203", name: "peer" } },
  };
}

describe("WP27 AC3 blind2 — the awareness parser is exact about canvasPath", () => {
  it("a state without a STRING canvasPath is not a canvas state at all", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, lockState(PATH, "n")],
      [2, lockState(undefined, "n")],
      [3, lockState(null, "n")],
      [4, lockState(42, "n")],
      [5, lockState({ path: PATH }, "n")],
      [6, { nodeId: "n", x: 0, y: 0, lockedNodes: { n: { color: "#0", name: "p" } } }],
    ]);

    expect(holdersOf(PATH, "n", states)).toEqual([1]);
  });

  it("the comparison is EXACT — no trim, no case fold, no prefix match", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, lockState(PATH, "n")],
      [2, lockState(` ${PATH} `, "n")],
      [3, lockState(PATH.toUpperCase(), "n")],
      [4, lockState(`${PATH}x`, "n")],
      [5, lockState("kanban/", "n")],
    ]);

    expect(holdersOf(PATH, "n", states)).toEqual([1]);
    expect(holdersOf(`${PATH} `, "n", states)).toEqual([]);
    expect(holdersOf("kanban/", "n", states)).toEqual([5]);
  });

  it("a guid-shaped canvasPath forms a room the path can never reach", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, lockState(PATH, "n")],
      [2, lockState(GUID, "n")],
      [3, lockState(DOC_ID, "n")],
    ]);

    expect(holdersOf(PATH, "n", states)).toEqual([1]);
    expect(holdersOf(GUID, "n", states)).toEqual([2]);
    expect(holdersOf(DOC_ID, "n", states)).toEqual([3]);
    // The three are mutually invisible — which is the damage, stated as a fact.
    expect(computeCanWriteNode(2, PATH, "n", states)).toBe(false);
    expect(computeCanWriteNode(1, GUID, "n", states)).toBe(false);
  });

  it("highlights are resolved per path and skip the local client", () => {
    const named = (canvasPath: unknown, nodeId: string, who: string) => ({
      canvasPath,
      nodeId,
      x: 0,
      y: 0,
      lockedNodes: { [nodeId]: { color: "#010203", name: who } },
    });
    const states = new Map<number, Record<string, unknown>>([
      [1, named(PATH, "n", "me")],
      [2, named(PATH, "n", "you")],
      [3, named(DOC_ID, "n", "ghost")],
    ]);

    // Local client excluded; the doc-id "room" contributes nothing at all.
    expect(resolveHighlights(1, PATH, states).map((h) => h.name)).toEqual(["you"]);
    expect(resolveHighlights(1, DOC_ID, states).map((h) => h.name)).toEqual(["ghost"]);
    expect(resolveHighlights(3, DOC_ID, states)).toEqual([]);
  });

  it("the emitted shape gains no identity field of its own", () => {
    const emitted: Record<string, unknown>[] = [];
    const awareness: AwarenessLike = {
      clientID: 1,
      getLocalState: () => null,
      setLocalState: (s) => {
        if (s) emitted.push(s);
      },
      getStates: () => new Map(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const presence = new CanvasPresence({
      path: PATH,
      awareness,
      identity: { clientId: 1, name: "me", color: "#111" },
    });

    presence.start();
    presence.acquireLock("n");

    for (const state of emitted) {
      const keys = Object.keys(state);
      expect(keys).toContain("canvasPath");
      for (const forbidden of ["guid", "canvasGuid", "docId", "epoch", "path"]) {
        expect(keys, `the awareness payload grew a "${forbidden}" field`).not.toContain(
          forbidden,
        );
      }
    }

    presence.destroy();
  });
});
