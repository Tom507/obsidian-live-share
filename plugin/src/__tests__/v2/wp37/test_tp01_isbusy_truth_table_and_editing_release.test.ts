// WP37 / C37 AC1 — `isBusy()` gains an editing arm, and the drag watchdog is untouched.
//
// WHAT MAKES THIS NON-VACUOUS
// ---------------------------
// "A predicate that returns `true` unconditionally passes" an assertion made only
// in the state where it should be `true`. So the truth table is asserted ROW BY
// ROW — {drag, editing} x {on, off}, all four — and each row names the value it
// expects rather than only the interesting one.
//
// The staleness release is asserted by ADVANCING AN INJECTED CLOCK. There is no
// sleep in this file and no wall-clock read: `createCanvasAdapter(view, { now })`
// takes the editing arm's clock, and the drag arm deliberately does NOT take it —
// which is itself asserted, because the drag watchdog's timing behaviour is
// required to be exactly what it was.

import { describe, expect, it } from "vitest";

import {
  DRAG_WATCHDOG_MS,
  EDIT_WATCHDOG_MS,
  createCanvasAdapter,
} from "../../../canvas/canvas-adapter";
import { CanvasDouble } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const SEED = [
  { id: "n1", type: "text", x: 0, y: 0, width: 160, height: 80, text: "one" },
  { id: "n2", type: "text", x: 240, y: 0, width: 160, height: 80, text: "two" },
];

interface Line {
  level: "log" | "warn";
  category: string;
  message: string;
}

function rig(opts: { now?: () => number } = {}) {
  const double = new CanvasDouble({ nodes: SEED.map((r) => ({ ...r })) });
  const lines: Line[] = [];
  const adapter = createCanvasAdapter(double.view, {
    now: opts.now,
    logger: {
      log: (category, message) => lines.push({ level: "log", category, message }),
      warn: (category, message) => lines.push({ level: "warn", category, message }),
    },
  });
  // Arm the lazy patches, exactly as the WP5 harness does: the adapter installs
  // its `setDragging` wrapper on first consultation, so a drag driven before any
  // consultation would be invisible to it and every drag row below would measure
  // an unpatched adapter rather than the predicate.
  adapter.isBusy();
  return { double, adapter, lines, driver: new InteractionDriver(double) };
}

describe("WP37 AC1 — the isBusy() truth table, row by row", () => {
  it("T1 {drag: off, editing: off} => false", () => {
    const { adapter } = rig();
    expect(adapter.isBusy()).toBe(false);
    expect(adapter.getEditingNodeId?.()).toBeNull();
  });

  it("T2 {drag: off, editing: ON} => true", () => {
    const { adapter } = rig();
    adapter.noteEditingFocus?.("n1");
    expect(adapter.isBusy()).toBe(true);
    expect(adapter.getEditingNodeId?.()).toBe("n1");
  });

  it("T3 {drag: ON, editing: off} => true", () => {
    const { adapter, driver } = rig();
    driver.beginDrag("n1");
    expect(adapter.isBusy()).toBe(true);
    // The editing arm must NOT claim a drag as an edit — the deferral would then
    // treat a drag as an editing session and stop dropping the pass.
    expect(adapter.getEditingNodeId?.()).toBeNull();
    driver.endDrag();
  });

  it("T4 {drag: ON, editing: ON} => true, and releasing ONE leaves the other", () => {
    const { adapter, driver } = rig();
    driver.beginDrag("n1");
    adapter.noteEditingFocus?.("n2");
    expect(adapter.isBusy()).toBe(true);

    driver.endDrag();
    expect(adapter.isBusy(), "still editing").toBe(true);
    expect(adapter.getEditingNodeId?.()).toBe("n2");

    adapter.noteEditingFocus?.(null);
    expect(adapter.isBusy(), "neither arm is set any more").toBe(false);
    expect(adapter.getEditingNodeId?.()).toBeNull();
  });

  it("T5 the editing arm alone can make isBusy() flip both ways repeatedly", () => {
    // The falsification of "returns true unconditionally": the same adapter,
    // the same call, four alternating answers.
    const { adapter } = rig();
    const seen: boolean[] = [];
    for (const id of ["n1", null, "n2", null] as Array<string | null>) {
      adapter.noteEditingFocus?.(id);
      seen.push(adapter.isBusy());
    }
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe("WP37 AC1 — the editing staleness release (injected clock, never a sleep)", () => {
  it("T6 releases after EDIT_WATCHDOG_MS of silence, under its OWN signature", () => {
    let clock = 1_000;
    const { adapter, lines } = rig({ now: () => clock });
    adapter.noteEditingFocus?.("n1");
    expect(adapter.isBusy()).toBe(true);

    clock += EDIT_WATCHDOG_MS - 1;
    expect(adapter.isBusy(), "one millisecond inside the budget").toBe(true);

    clock += 1;
    expect(adapter.isBusy(), "the budget expired").toBe(false);
    expect(adapter.getEditingNodeId?.()).toBeNull();

    const warns = lines.filter((l) => l.level === "warn").map((l) => l.message);
    expect(warns.some((m) => m.startsWith("EDIT WATCHDOG:"))).toBe(true);
    // The two releases must never be confusable in a log.
    expect(warns.some((m) => m.startsWith("DRAG WATCHDOG:"))).toBe(false);
  });

  it("T7 an editing signal inside the budget refreshes it", () => {
    let clock = 0;
    const { adapter } = rig({ now: () => clock });
    adapter.noteEditingFocus?.("n1");
    for (let i = 0; i < 5; i++) {
      clock += EDIT_WATCHDOG_MS - 10;
      expect(adapter.isBusy(), `still inside the budget at step ${i}`).toBe(true);
      adapter.noteEditingFocus?.("n1"); // a keystroke
    }
    clock += EDIT_WATCHDOG_MS;
    expect(adapter.isBusy()).toBe(false);
  });

  it("T8 POSITIVE LIVENESS — a node that leaves the canvas releases immediately", () => {
    let clock = 0;
    const { adapter, double, lines } = rig({ now: () => clock });
    adapter.noteEditingFocus?.("n1");
    expect(adapter.isBusy()).toBe(true);

    double.canvas.nodes.delete("n1");
    // No clock advance at all: this release must NOT depend on the timeout.
    expect(adapter.isBusy()).toBe(false);
    expect(adapter.getEditingNodeId?.()).toBeNull();
    expect(
      lines.some((l) => l.message.includes("no longer in the live canvas")),
      "the release names why",
    ).toBe(true);
  });

  it("T9 every release fires the blur subscribers, so a queue can never be stranded", () => {
    let clock = 0;
    const { adapter, double } = rig({ now: () => clock });
    const ended: string[] = [];
    adapter.onEditingEnd?.((id) => ended.push(id));

    adapter.noteEditingFocus?.("n1");
    adapter.noteEditingFocus?.(null); // an ordinary blur
    expect(ended).toEqual(["n1"]);

    adapter.noteEditingFocus?.("n2");
    clock += EDIT_WATCHDOG_MS + 1;
    adapter.isBusy(); // the timeout release
    expect(ended).toEqual(["n1", "n2"]);

    adapter.noteEditingFocus?.("n2");
    double.canvas.nodes.delete("n2");
    adapter.isBusy(); // the liveness release
    expect(ended).toEqual(["n1", "n2", "n2"]);
  });

  it("T10 focus moving straight from one card's editor to another's ends the first", () => {
    const { adapter } = rig();
    const ended: string[] = [];
    adapter.onEditingEnd?.((id) => ended.push(id));
    adapter.noteEditingFocus?.("n1");
    adapter.noteEditingFocus?.("n2");
    expect(ended).toEqual(["n1"]);
    expect(adapter.getEditingNodeId?.()).toBe("n2");
  });
});

describe("WP37 AC1 — the drag watchdog is byte-for-byte the behaviour it was", () => {
  it("T11 the drag arm does NOT read the injected clock", () => {
    // A clock frozen a long way in the past would make a `now()`-based drag
    // watchdog release instantly. The drag flag must be completely unaffected.
    const { adapter, driver } = rig({ now: () => 0 });
    driver.beginDrag("n1");
    expect(adapter.isBusy()).toBe(true);
    expect(adapter.applyNodeGeometry("n1", { x: 9, y: 9, width: 160, height: 80 })).toBe(
      "interacting",
    );
    driver.endDrag();
  });

  it("T12 DRAG_WATCHDOG_MS is unchanged and the drag release still warns once", () => {
    expect(DRAG_WATCHDOG_MS).toBe(5000);
    // EDIT_WATCHDOG_MS is a SEPARATE budget and must not have been folded into it.
    expect(EDIT_WATCHDOG_MS).not.toBe(DRAG_WATCHDOG_MS);
    expect(EDIT_WATCHDOG_MS).toBeGreaterThan(DRAG_WATCHDOG_MS);
  });

  it("T13 an edit does not make a node a drag target (the two flags never merge)", () => {
    const { adapter } = rig();
    adapter.noteEditingFocus?.("n1");
    // `applyNodeGeometry` consults the DRAG seam. An editing session must not
    // start reporting "interacting" there — that is `main.ts`'s job through the
    // deferral, not the adapter's through the drag flag.
    expect(adapter.applyNodeGeometry("n1", { x: 5, y: 5, width: 160, height: 80 })).toBe(
      "applied",
    );
  });

  it("T14 destroy() clears the editing flag and notifies, so nothing outlives the adapter", () => {
    const { adapter } = rig();
    const ended: string[] = [];
    adapter.onEditingEnd?.((id) => ended.push(id));
    adapter.noteEditingFocus?.("n1");
    adapter.destroy();
    expect(ended, "TEARDOWN is one of the three drain exits").toEqual(["n1"]);
    expect(adapter.isBusy()).toBe(false);
    expect(adapter.getEditingNodeId?.()).toBeNull();
  });
});

describe("WP37 AC1 — the editing flag is PULLED from the canvas, not only pushed", () => {
  // Why this exists: the first live build detected editing only from `focusin`,
  // and it deferred NOTHING (run 033302). Two independent reasons, both measured:
  // the editor is routinely focused BEFORE this adapter mounts, so the event is
  // missed; and the card's editor is not reachable through a `contenteditable`
  // selector at all (run 031340, `contenteditableFound: false`). Obsidian's own
  // `node.isEditing` is the signal, and it is READ on every consultation.

  function withIsEditing() {
    const double = new CanvasDouble({ nodes: SEED.map((r) => ({ ...r })) });
    for (const node of double.canvas.nodes.values()) {
      (node as unknown as Record<string, unknown>).isEditing = false;
    }
    const adapter = createCanvasAdapter(double.view);
    adapter.isBusy();
    return { double, adapter };
  }

  it("T18 a card that reports isEditing is picked up with NO event at all", () => {
    const { double, adapter } = withIsEditing();
    expect(adapter.isBusy()).toBe(false);
    // Nothing is dispatched, nothing is notified — the flag simply becomes true.
    (double.canvas.nodes.get("n2") as unknown as Record<string, unknown>).isEditing = true;
    expect(adapter.getEditingNodeId?.()).toBe("n2");
    expect(adapter.isBusy()).toBe(true);
  });

  it("T19 the card ceasing to report isEditing is EVIDENCE of a blur, and drains", () => {
    const { double, adapter } = withIsEditing();
    const ended: string[] = [];
    adapter.onEditingEnd?.((id) => ended.push(id));
    (double.canvas.nodes.get("n1") as unknown as Record<string, unknown>).isEditing = true;
    expect(adapter.isBusy()).toBe(true);

    (double.canvas.nodes.get("n1") as unknown as Record<string, unknown>).isEditing = false;
    expect(adapter.isBusy()).toBe(false);
    expect(ended, "the blur subscribers fired without any focusout").toEqual(["n1"]);
  });

  it("T20 a shape that cannot answer does NOT overrule the direct seam", () => {
    // The CanvasDouble's nodes expose no `isEditing` and there is no wrapperEl,
    // so the probe has no answer. Absence of evidence must not release the flag
    // (I11) — otherwise every headless caller would silently lose the signal.
    const { adapter } = rig();
    adapter.noteEditingFocus?.("n1");
    expect(adapter.isBusy()).toBe(true);
    expect(adapter.getEditingNodeId?.()).toBe("n1");
  });

  it("T21 the probe wins over a stale flag when the two disagree", () => {
    const { double, adapter } = withIsEditing();
    adapter.noteEditingFocus?.("n1"); // a flag left over from a missed exit
    (double.canvas.nodes.get("n2") as unknown as Record<string, unknown>).isEditing = true;
    expect(adapter.getEditingNodeId?.(), "the canvas's own answer wins").toBe("n2");
  });
});

describe("WP37 AC1 — getNodeFields is a MEASUREMENT of the live card", () => {
  it("T15 returns the live record and follows a live mutation", () => {
    const { adapter, double } = rig();
    const before = adapter.getNodeFields?.("n1");
    expect(before).toMatchObject({ id: "n1", x: 0, text: "one" });

    double.canvas.nodes.get("n1")!.text = "one EDITED";
    expect(adapter.getNodeFields?.("n1")).toMatchObject({ text: "one EDITED" });
  });

  it("T16 an absent node answers null rather than an invented record", () => {
    const { adapter } = rig();
    expect(adapter.getNodeFields?.("nope")).toBeNull();
  });

  it("T17 the returned record is DETACHED — mutating it cannot rewrite the card", () => {
    const { adapter, double } = rig();
    const fields = adapter.getNodeFields?.("n1") as Record<string, unknown>;
    fields.text = "tampered";
    expect(double.canvas.nodes.get("n1")!.text).toBe("one");
  });
});
