// B75 · P2 — CODE-LEVEL
//
// SURFACE: DOM ownership. Not "which property", but "whose element".
//
// This drives the REAL `CanvasPresence` with a fake awareness map and a fake
// adapter whose `getNodeEl()` returns a recording element, then asks the only
// question the reported symptom needs answered at this level: when a peer takes
// a hold, does the plugin WRITE INTO Obsidian's card element?
//
// Obsidian re-renders `.canvas-node` from its own model on every frame it
// considers dirty. Anything the plugin leaves on that element — a class, an
// inline custom property, an extra child — is state Obsidian did not put there
// and does not know to preserve or account for.
//
// Independent of P1: P1 reads the stylesheet and would still pass if the ring
// were applied with an inline `el.style.position = "relative"` instead of a
// class. This one reads the DOM writes themselves.
//
// WHY IT CAN GO RED: it asserts an absence of writes on a foreign element.
import { describe, expect, it } from "vitest";
import type { CanvasAdapter } from "../../../../../plugin/src/canvas/canvas-adapter";
import type { AwarenessLike } from "../../../../../plugin/src/canvas/canvas-presence";
import { CanvasPresence, resolveHighlights } from "../../../../../plugin/src/canvas/canvas-presence";

const PATH = "_liveshare-test/SyncTesting.canvas";

interface Write {
  kind: "classList.add" | "classList.remove" | "style.setProperty" | "appendChild";
  detail: string;
}

/** A stand-in for Obsidian's `node.nodeEl`, which records every write it takes. */
function hostCardElement(writes: Write[]) {
  const children: unknown[] = [];
  const el = {
    classList: {
      add: (...c: string[]) => writes.push({ kind: "classList.add", detail: c.join(" ") }),
      remove: (...c: string[]) => writes.push({ kind: "classList.remove", detail: c.join(" ") }),
    },
    style: {
      setProperty: (k: string, v: string) =>
        writes.push({ kind: "style.setProperty", detail: `${k}: ${v}` }),
      removeProperty: () => undefined,
    },
    appendChild: (child: unknown) => {
      children.push(child);
      writes.push({ kind: "appendChild", detail: "a plugin element was inserted into the card" });
      return child;
    },
    children,
    ownerDocument: {
      createElement: () => ({
        className: "",
        textContent: "",
        style: {} as Record<string, unknown>,
        remove: () => undefined,
      }),
    },
  };
  return el as unknown as HTMLElement & { children: unknown[] };
}

function awarenessWithRemoteHold(nodeId: string): AwarenessLike {
  const states = new Map<number, Record<string, unknown>>([
    [
      7, // a remote peer, lower id than the local one below
      {
        canvasPath: PATH,
        nodeId,
        x: 0,
        y: 0,
        lockedNodes: { [nodeId]: { color: "#7c3aed", name: "Peer A" } },
      },
    ],
  ]);
  return {
    clientID: 42,
    getLocalState: () => null,
    setLocalState: () => undefined,
    getStates: () => states,
    on: () => undefined,
    off: () => undefined,
  };
}

describe("B75 P2 — the plugin's presence ring vs Obsidian's ownership of the card element", () => {
  it("applying a remote hold writes nothing into the Obsidian-owned card element", () => {
    const writes: Write[] = [];
    const nodeId = "node-under-remote-hold";
    const card = hostCardElement(writes);

    const adapter = {
      isAvailable: () => true,
      getNodeEl: (id: string) => (id === nodeId ? card : null),
      canvasToScreenRelativeToWrapper: () => null,
      getViewport: () => null,
    } as unknown as CanvasAdapter;

    const awareness = awarenessWithRemoteHold(nodeId);

    // Subject check, and it stays true after any fix: the fixture really does
    // describe one remote hold on this board, so the ring path has something to
    // do. Without this, an empty `writes` array could mean "nothing to draw".
    expect(
      resolveHighlights(42, PATH, awareness.getStates()).map((h) => h.nodeId),
      "the awareness fixture produced no held highlight — this probe would measure nothing",
    ).toEqual([nodeId]);

    const presence = new CanvasPresence({
      path: PATH,
      awareness,
      identity: { clientId: 42, name: "Local", color: "#22c55e" },
      adapter,
      overlay: null,
    });

    presence.refresh();

    expect(
      writes.map((w) => `${w.kind} — ${w.detail}`),
      "the plugin mutated an element Obsidian owns and re-renders from its own model",
    ).toEqual([]);
    expect((card.children as unknown[]).length, "foreign children inside .canvas-node").toBe(0);
  });
});
