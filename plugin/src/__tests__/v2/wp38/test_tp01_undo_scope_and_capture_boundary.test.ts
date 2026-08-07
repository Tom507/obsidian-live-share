// WP38 / C38 AC1 + AC4 — THE SCOPE and THE STEP BOUNDARY, at the registry.
//
// Two vacuity traps are named in the charter and both are answered here rather
// than argued:
//
//   1. LEAVING `trackedOrigins` AT THE DEFAULT. Yjs's default is `{null}`, and
//      the capture transaction carried `null` until this work package tagged
//      it — so the default WOULD HAVE WORKED TODAY, by accident, and would have
//      silently absorbed the next untagged transaction anybody adds. The
//      criterion is therefore asserted by the allow-list's CONTENTS plus a
//      NEGATIVE ROW: a transaction under one of the six pre-existing origins
//      produces no undo step at all.
//   2. A `captureTimeout` OF INFINITY. It passes a collapse test perfectly and
//      never separates anything, so BOTH sides of the timeout are asserted, and
//      both come from the same comparison against an INJECTED clock. There is
//      no wall-clock sleep in this file.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CANVAS_BINDING_ORIGIN } from "../../../canvas/canvas-binding";
import { CANVAS_EPOCH_ADOPT_ORIGIN } from "../../../canvas/canvas-epoch";
import { CANVAS_MIGRATION_ORIGIN } from "../../../canvas/canvas-schema";
import {
  CANVAS_CAPTURE_MIGRATION_ORIGIN,
  CANVAS_CAPTURE_ORIGIN,
  CanvasUndoRegistry,
  DEFAULT_UNDO_CAPTURE_TIMEOUT_MS,
  UNDO_TRACKED_ORIGINS,
  captureConvertsCollabText,
  chooseCaptureOrigin,
  willConvertToYText,
} from "../../../canvas/canvas-undo";
import { CANVAS_IMPORT_SEED_ORIGIN } from "../../../files/canvas-import";
import { CANVAS_SEED_ORIGIN } from "../../../files/canvas-persistence";
import { SIDECAR_LOAD_ORIGIN } from "../../../files/canvas-sidecar";

function makeDoc(): { doc: Y.Doc; nodes: Y.Map<Y.Map<unknown>> } {
  const doc = new Y.Doc();
  return { doc, nodes: doc.getMap<Y.Map<unknown>>("nodes") };
}

function seedCard(doc: Y.Doc, id: string, fields: Record<string, unknown>, origin: unknown): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) record.set(k, v);
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
  }, origin);
}

describe("WP38 AC1 — the allow-list is explicit and asserted by its CONTENTS", () => {
  it("is exactly the two named capture origins — not Yjs's {null} default", () => {
    expect([...UNDO_TRACKED_ORIGINS]).toEqual([CANVAS_CAPTURE_ORIGIN, CANVAS_BINDING_ORIGIN]);
    // The point of the criterion: `null` is NOT a member. If it were, the scope
    // would be "whatever nobody has tagged yet".
    expect(UNDO_TRACKED_ORIGINS).not.toContain(null);
    expect(UNDO_TRACKED_ORIGINS).toHaveLength(2);
  });

  it("every origin the tree already defines is EXCLUDED, one row each", () => {
    for (const excluded of [
      CANVAS_SEED_ORIGIN,
      CANVAS_IMPORT_SEED_ORIGIN,
      CANVAS_MIGRATION_ORIGIN,
      CANVAS_EPOCH_ADOPT_ORIGIN,
      SIDECAR_LOAD_ORIGIN,
      CANVAS_CAPTURE_MIGRATION_ORIGIN,
    ]) {
      expect(UNDO_TRACKED_ORIGINS).not.toContain(excluded);
    }
  });

  it("the manager is CONSTRUCTED with that set — read off the manager, not off the constant", () => {
    const { doc } = makeDoc();
    const registry = new CanvasUndoRegistry();
    const manager = registry.attach("a.canvas", doc);
    // Yjs adds the manager ITSELF to the set in its own constructor, so that its
    // undo/redo transactions land on the opposite stack. That member is Yjs's.
    const ours = [...manager.trackedOrigins].filter((o) => o !== manager);
    expect(ours).toHaveLength(2);
    expect(ours).toContain(CANVAS_CAPTURE_ORIGIN);
    expect(ours).toContain(CANVAS_BINDING_ORIGIN);
    expect(manager.trackedOrigins.has(null)).toBe(false);
    registry.destroy();
  });
});

describe("WP38 AC1 — the NEGATIVE ROW: a non-capture origin produces no step", () => {
  it("a transaction under each pre-existing origin leaves the stack empty, and the capture origin does not", () => {
    for (const origin of [
      CANVAS_SEED_ORIGIN,
      CANVAS_IMPORT_SEED_ORIGIN,
      CANVAS_MIGRATION_ORIGIN,
      CANVAS_EPOCH_ADOPT_ORIGIN,
      SIDECAR_LOAD_ORIGIN,
      CANVAS_CAPTURE_MIGRATION_ORIGIN,
      null,
      undefined,
    ]) {
      const { doc } = makeDoc();
      const registry = new CanvasUndoRegistry();
      const manager = registry.attach("a.canvas", doc);
      seedCard(doc, "c1", { text: "hello" }, origin);
      expect(manager.undoStack).toHaveLength(0);

      // THE POSITIVE CONTROL, in the same fixture: the very same write under
      // the capture origin DOES produce a step. Without it, "the stack is
      // empty" would be satisfied by a manager that never worked at all.
      seedCard(doc, "c2", { text: "hello" }, CANVAS_CAPTURE_ORIGIN);
      expect(manager.undoStack).toHaveLength(1);
      registry.destroy();
    }
  });

  it("`null` in particular is not tracked — the accident this WP exists to close", () => {
    const { doc, nodes } = makeDoc();
    const registry = new CanvasUndoRegistry();
    const manager = registry.attach("a.canvas", doc);
    doc.transact(() => {
      const r = new Y.Map<unknown>();
      r.set("text", "untagged");
      nodes.set("c1", r);
    });
    expect(manager.undoStack).toHaveLength(0);
    expect(nodes.get("c1")?.get("text")).toBe("untagged");
    registry.destroy();
  });
});

describe("WP38 AC1 — one manager per canvas doc, and the stacks do not interact", () => {
  it("two canvases yield two managers; undoing one leaves the other untouched", () => {
    const a = makeDoc();
    const b = makeDoc();
    const registry = new CanvasUndoRegistry();
    registry.attach("a.canvas", a.doc);
    registry.attach("b.canvas", b.doc);
    expect(registry.size()).toBe(2);
    expect(registry.managerFor("a.canvas")).not.toBe(registry.managerFor("b.canvas"));

    seedCard(a.doc, "c1", { text: "A" }, CANVAS_CAPTURE_ORIGIN);
    seedCard(b.doc, "c1", { text: "B" }, CANVAS_CAPTURE_ORIGIN);
    expect(registry.report("a.canvas").undoDepth).toBe(1);
    expect(registry.report("b.canvas").undoDepth).toBe(1);

    const outcome = registry.undo("a.canvas");
    expect(outcome.popped).toBe(true);
    expect(outcome.undoDepthBefore).toBe(1);
    expect(outcome.undoDepthAfter).toBe(0);
    // THE CRITERION: canvas B is untouched, in both its stack and its content.
    expect(registry.report("b.canvas").undoDepth).toBe(1);
    expect(b.nodes.get("c1")?.get("text")).toBe("B");
    expect(a.nodes.has("c1")).toBe(false);
    registry.destroy();
  });

  it("attaching the same path twice returns the SAME manager, never a second stack", () => {
    const { doc } = makeDoc();
    const registry = new CanvasUndoRegistry();
    const first = registry.attach("a.canvas", doc);
    const second = registry.attach("a.canvas", doc);
    expect(second).toBe(first);
    expect(registry.size()).toBe(1);
    registry.destroy();
  });
});

describe("WP38 AC1 — a manager is DESTROYED with its doc", () => {
  it("detach drops the manager, releases the doc reference and stops observing", () => {
    const { doc, nodes } = makeDoc();
    const registry = new CanvasUndoRegistry();
    const manager = registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { text: "A" }, CANVAS_CAPTURE_ORIGIN);
    expect(manager.undoStack).toHaveLength(1);

    registry.detach("a.canvas");
    expect(registry.size()).toBe(0);
    expect(registry.has("a.canvas")).toBe(false);
    expect(registry.managerFor("a.canvas")).toBeNull();

    // The destroyed manager no longer OBSERVES: a further capture on the doc it
    // was bound to does not reach it. Stated as "the depth did not move" rather
    // than as "the depth is zero", because `Y.UndoManager.destroy()` detaches
    // the handler without clearing the stack it already held — asserting zero
    // here would have been asserting Yjs's cleanup, not this WP's detachment.
    const depthAtDetach = manager.undoStack.length;
    expect(depthAtDetach).toBe(1);
    seedCard(doc, "c2", { text: "B" }, CANVAS_CAPTURE_ORIGIN);
    expect(manager.undoStack).toHaveLength(depthAtDetach);
    expect(nodes.size).toBe(2);
    // POSITIVE CONTROL: a still-attached manager over the same doc DOES grow on
    // that same write shape — so "it did not move" is detachment, not inertness.
    const live = new CanvasUndoRegistry();
    const liveManager = live.attach("a.canvas", doc);
    seedCard(doc, "c3", { text: "C" }, CANVAS_CAPTURE_ORIGIN);
    expect(liveManager.undoStack).toHaveLength(1);
    live.destroy();

    // And an undo aimed at the detached path is a named refusal, not a crash.
    const outcome = registry.undo("a.canvas");
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBe("no undo manager for this canvas");
    expect(outcome.popped).toBe(false);
  });

  it("destroy() releases every manager", () => {
    const a = makeDoc();
    const b = makeDoc();
    const registry = new CanvasUndoRegistry();
    registry.attach("a.canvas", a.doc);
    registry.attach("b.canvas", b.doc);
    registry.destroy();
    expect(registry.size()).toBe(0);
    expect(registry.report("a.canvas").available).toBe(false);
    expect(registry.report("b.canvas").available).toBe(false);
  });
});

describe("WP38 AC4 — one drag burst is one step, BOTH sides of the capture timeout", () => {
  it("collapses a burst INSIDE the timeout into ONE step (injected clock)", () => {
    const { doc, nodes } = makeDoc();
    let clock = 1_000;
    const registry = new CanvasUndoRegistry({ now: () => clock, captureTimeoutMs: 500 });
    const manager = registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { x: 0, y: 0 }, CANVAS_CAPTURE_MIGRATION_ORIGIN); // untracked setup

    for (const [i, at] of [1_000, 1_100, 1_200, 1_300].entries()) {
      clock = at;
      registry.noteCapture("a.canvas");
      doc.transact(() => {
        nodes.get("c1")?.set("x", (i + 1) * 10);
      }, CANVAS_CAPTURE_ORIGIN);
    }
    expect(nodes.get("c1")?.get("x")).toBe(40);
    expect(manager.undoStack).toHaveLength(1);

    // One undo returns the whole burst to its pre-burst value.
    registry.undo("a.canvas");
    expect(nodes.get("c1")?.get("x")).toBe(0);
    registry.destroy();
  });

  it("SEPARATES a burst that SPANS the timeout into TWO steps (same clock, same fixture)", () => {
    const { doc, nodes } = makeDoc();
    let clock = 1_000;
    const registry = new CanvasUndoRegistry({ now: () => clock, captureTimeoutMs: 500 });
    const manager = registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { x: 0, y: 0 }, CANVAS_CAPTURE_MIGRATION_ORIGIN);

    // 1_000 and 1_100 are inside the window; 1_900 is 800 ms after the last one.
    for (const [i, at] of [1_000, 1_100, 1_900, 2_000].entries()) {
      clock = at;
      registry.noteCapture("a.canvas");
      doc.transact(() => {
        nodes.get("c1")?.set("x", (i + 1) * 10);
      }, CANVAS_CAPTURE_ORIGIN);
    }
    expect(nodes.get("c1")?.get("x")).toBe(40);
    expect(manager.undoStack).toHaveLength(2);

    // The second undo step is the second half of the burst only.
    registry.undo("a.canvas");
    expect(nodes.get("c1")?.get("x")).toBe(20);
    registry.undo("a.canvas");
    expect(nodes.get("c1")?.get("x")).toBe(0);
    registry.destroy();
  });

  it("a multi-node move in ONE transaction is ONE step, because it is one transaction", () => {
    const { doc, nodes } = makeDoc();
    let clock = 1_000;
    const registry = new CanvasUndoRegistry({ now: () => clock, captureTimeoutMs: 500 });
    const manager = registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { x: 0 }, CANVAS_CAPTURE_MIGRATION_ORIGIN);
    seedCard(doc, "c2", { x: 0 }, CANVAS_CAPTURE_MIGRATION_ORIGIN);
    seedCard(doc, "c3", { x: 0 }, CANVAS_CAPTURE_MIGRATION_ORIGIN);

    clock = 5_000; // deliberately far past the timeout — the collapse is not timing
    registry.noteCapture("a.canvas");
    doc.transact(() => {
      for (const id of ["c1", "c2", "c3"]) nodes.get(id)?.set("x", 99);
    }, CANVAS_CAPTURE_ORIGIN);

    expect(manager.undoStack).toHaveLength(1);
    registry.undo("a.canvas");
    for (const id of ["c1", "c2", "c3"]) expect(nodes.get(id)?.get("x")).toBe(0);
    registry.destroy();
  });

  it("the default timeout is 500 ms and is not infinity", () => {
    expect(DEFAULT_UNDO_CAPTURE_TIMEOUT_MS).toBe(500);
    expect(Number.isFinite(DEFAULT_UNDO_CAPTURE_TIMEOUT_MS)).toBe(true);
    expect(new CanvasUndoRegistry().captureTimeoutMs).toBe(500);
  });
});

describe("WP38 AC5 — the conversion predicate, pure and by shape", () => {
  it("a plain string and an ABSENT field both convert; a Y.Text and an unknown shape do not", () => {
    expect(willConvertToYText("hello")).toBe(true);
    expect(willConvertToYText("")).toBe(true);
    expect(willConvertToYText(undefined)).toBe(true);
    expect(willConvertToYText(new Y.Text("hello"))).toBe(false);
    expect(willConvertToYText(42)).toBe(false);
    expect(willConvertToYText(null)).toBe(false);
  });

  it("a pass converts when ANY of its collaborative-text targets would", () => {
    expect(captureConvertsCollabText([])).toBe(false);
    expect(captureConvertsCollabText([new Y.Text("a"), new Y.Text("b")])).toBe(false);
    expect(captureConvertsCollabText([new Y.Text("a"), "plain"])).toBe(true);
  });

  it("the origin decision follows the predicate, and the migration origin is not tracked", () => {
    expect(chooseCaptureOrigin(false)).toBe(CANVAS_CAPTURE_ORIGIN);
    expect(chooseCaptureOrigin(true)).toBe(CANVAS_CAPTURE_MIGRATION_ORIGIN);
    expect(UNDO_TRACKED_ORIGINS).toContain(chooseCaptureOrigin(false));
    expect(UNDO_TRACKED_ORIGINS).not.toContain(chooseCaptureOrigin(true));
  });
});

describe("WP38 AC6 — the empty stack answers honestly, and it is MEASURED", () => {
  it("an undo with nothing on the stack reports 0 -> 0, not popped, and changes nothing", () => {
    const { doc, nodes } = makeDoc();
    const registry = new CanvasUndoRegistry();
    registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { text: "untouched" }, CANVAS_SEED_ORIGIN); // untracked

    const outcome = registry.undo("a.canvas");
    expect(outcome.available).toBe(true);
    expect(outcome.undoDepthBefore).toBe(0);
    expect(outcome.undoDepthAfter).toBe(0);
    expect(outcome.popped).toBe(false);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("empty stack");
    expect(nodes.get("c1")?.get("text")).toBe("untouched");

    // THE DISCRIMINATOR: the same registry, the same doc, after a real capture.
    registry.noteCapture("a.canvas");
    doc.transact(() => nodes.get("c1")?.set("text", "edited"), CANVAS_CAPTURE_ORIGIN);
    const second = registry.undo("a.canvas");
    expect(second.undoDepthBefore).toBe(1);
    expect(second.undoDepthAfter).toBe(0);
    expect(second.popped).toBe(true);
    expect(second.changed).toBe(true);
    expect(nodes.get("c1")?.get("text")).toBe("untouched");
    // And the two invocations are distinguishable — a stale receipt cannot pass
    // for a fresh one.
    expect(second.seq).toBeGreaterThan(outcome.seq);
    registry.destroy();
  });

  it("redo puts back exactly what undo took, and the depths move the other way", () => {
    const { doc, nodes } = makeDoc();
    const registry = new CanvasUndoRegistry();
    registry.attach("a.canvas", doc);
    seedCard(doc, "c1", { text: "base" }, CANVAS_SEED_ORIGIN);
    registry.noteCapture("a.canvas");
    doc.transact(() => nodes.get("c1")?.set("text", "edited"), CANVAS_CAPTURE_ORIGIN);

    registry.undo("a.canvas");
    expect(nodes.get("c1")?.get("text")).toBe("base");
    const redone = registry.redo("a.canvas");
    expect(redone.redoDepthBefore).toBe(1);
    expect(redone.redoDepthAfter).toBe(0);
    expect(redone.popped).toBe(true);
    expect(nodes.get("c1")?.get("text")).toBe("edited");
    registry.destroy();
  });
});
