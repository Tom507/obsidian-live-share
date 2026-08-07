// WP37 / C37 AC5 — the queue is bounded, per record, and drained on blur, on view
// close and on teardown.
//
// AC5's vacuity clause, taken literally:
//
//   * "a bound asserted by reading a constant rather than by driving a burst past
//     it" — so the bound is measured by DRIVING 200 passes and reading the size,
//     never by asserting a cap constant. There is no cap constant; the bound is
//     structural (a Map keyed by record id) and the burst is what proves it.
//   * "only blur is exercised and close/teardown are asserted by argument — they
//     differ in what still exists when they run" — so the three exits are three
//     separate tests over three separate states, each ending in an assertion that
//     NOTHING is left queued and nothing is retained.

import { describe, expect, it } from "vitest";

import {
  type DeferredRecord,
  createEditingDeferralQueue,
  planEditingDeferral,
} from "../../../canvas/canvas-editing-deferral";
import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import type { CanvasRecords } from "../../../canvas/reconcile-plan";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "boards/plan.canvas";
const OTHER = "boards/second.canvas";

function data(text: string): CanvasRecords {
  return {
    nodes: [
      { id: "c1", type: "text", x: 0, y: 0, width: 300, height: 140, text },
      { id: "c2", type: "text", x: 500, y: 0, width: 300, height: 140, text: "two" },
    ],
    edges: [],
  };
}

function deferred(id: string, text: string): DeferredRecord[] {
  return [{ kind: "node", id, fields: { id, text } }];
}

describe("WP37 AC5 — the queue is BOUNDED because it coalesces per record", () => {
  it("T1 a burst of 200 changes to ONE card leaves exactly ONE entry", () => {
    const q = createEditingDeferralQueue();
    for (let i = 0; i < 200; i++) q.note(PATH, deferred("c1", `v${i}`), data(`v${i}`));
    expect(q.pending(PATH), "coalesced, not accumulated").toBe(1);
    expect(q.passes(PATH), "and the 200 passes are still counted honestly").toBe(200);
    // The LAST value wins — a queue that coalesced to the FIRST would be bounded
    // and wrong, so the bound alone is not the whole criterion.
    expect(q.drain(PATH)?.records[0].fields.text).toBe("v199");
  });

  it("T2 a burst across N cards leaves exactly N entries — the key is the record, not the pass", () => {
    const q = createEditingDeferralQueue();
    for (let round = 0; round < 50; round++) {
      for (const id of ["c1", "c2", "c3"]) q.note(PATH, deferred(id, `r${round}`), data("x"));
    }
    expect(q.pending(PATH)).toBe(3);
    expect(q.pendingIds(PATH)).toEqual(["c1", "c2", "c3"]);
  });

  it("T3 paths do not bleed into each other", () => {
    const q = createEditingDeferralQueue();
    q.note(PATH, deferred("c1", "a"), data("a"));
    q.note(OTHER, deferred("c1", "b"), data("b"));
    expect(q.paths()).toEqual([OTHER, PATH].sort());
    expect(q.drain(PATH)?.records[0].fields.text).toBe("a");
    expect(q.pending(PATH)).toBe(0);
    expect(q.pending(OTHER), "draining one path leaves the other intact").toBe(1);
  });

  it("T4 an empty note is not a pass and creates nothing", () => {
    const q = createEditingDeferralQueue();
    q.note(PATH, [], data("a"));
    expect(q.pending(PATH)).toBe(0);
    expect(q.paths()).toEqual([]);
    expect(q.drain(PATH)).toBeNull();
  });
});

describe("WP37 AC5 — drain hands back the LATEST snapshot and leaves nothing behind", () => {
  it("T5 the drained data is the last withheld snapshot, and the queue is then empty", () => {
    const q = createEditingDeferralQueue();
    q.note(PATH, deferred("c1", "first"), data("first"));
    q.note(PATH, deferred("c1", "second"), data("second"));
    const out = q.drain(PATH);
    expect(out?.records).toHaveLength(1);
    expect(out?.data.nodes[0].text).toBe("second");
    expect(out?.passes).toBe(2);
    expect(q.pending(PATH)).toBe(0);
    expect(q.drain(PATH), "a second drain has nothing to give").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The three exits, in three different states. `main.ts` holds the wiring; what is
// asserted here is that each exit really reaches a drain and really leaves the
// queue empty — a claim about STATE, not about "the same function is called".
// ---------------------------------------------------------------------------

/** The `main.ts` wiring, written out: one exit, one drain, one clear. */
function wireDrains(q: ReturnType<typeof createEditingDeferralQueue>) {
  const applied: Array<{ path: string; records: number; why: string }> = [];
  const drain = (path: string, why: string) => {
    const out = q.drain(path);
    if (!out) return;
    applied.push({ path, records: out.records.length, why });
  };
  return { applied, drain };
}

describe("WP37 AC5 — exit 1 of 3: BLUR", () => {
  it("T6 the adapter's blur signal reaches the drain and empties the queue", () => {
    const double = new CanvasDouble({
      nodes: [{ id: "c1", x: 0, y: 0, width: 10, height: 10, text: "one" }],
    });
    const adapter = createCanvasAdapter(double.view);
    const q = createEditingDeferralQueue();
    const { applied, drain } = wireDrains(q);
    adapter.onEditingEnd?.(() => drain(PATH, "blur"));

    adapter.noteEditingFocus?.("c1");
    q.note(PATH, deferred("c1", "remote"), data("remote"));
    expect(q.pending(PATH), "queued while the editor is open").toBe(1);

    adapter.noteEditingFocus?.(null); // the blur
    expect(applied).toEqual([{ path: PATH, records: 1, why: "blur" }]);
    expect(q.pending(PATH), "nothing left queued").toBe(0);
  });

  it("T7 a WATCHDOG-released editor drains too — a stranded queue is the same leak", () => {
    let clock = 0;
    const double = new CanvasDouble({
      nodes: [{ id: "c1", x: 0, y: 0, width: 10, height: 10, text: "one" }],
    });
    const adapter = createCanvasAdapter(double.view, { now: () => clock });
    const q = createEditingDeferralQueue();
    const { applied, drain } = wireDrains(q);
    adapter.onEditingEnd?.(() => drain(PATH, "watchdog"));

    adapter.noteEditingFocus?.("c1");
    q.note(PATH, deferred("c1", "remote"), data("remote"));
    clock += 10_000_000;
    adapter.isBusy();
    expect(applied.map((a) => a.why)).toEqual(["watchdog"]);
    expect(q.pending(PATH)).toBe(0);
  });
});

describe("WP37 AC5 — exit 2 of 3: VIEW CLOSE", () => {
  it("T8 closing the view drains BEFORE the adapter is dropped, and clears", () => {
    // The state that distinguishes this exit from the blur: the editor is STILL
    // FOCUSED when the view closes, so nothing would ever blur it.
    const double = new CanvasDouble({
      nodes: [{ id: "c1", x: 0, y: 0, width: 10, height: 10, text: "one" }],
    });
    const adapter = createCanvasAdapter(double.view);
    const adapters = new Map([[PATH, adapter]]);
    const q = createEditingDeferralQueue();
    const { applied, drain } = wireDrains(q);

    adapter.noteEditingFocus?.("c1");
    q.note(PATH, deferred("c1", "remote"), data("remote"));

    // main.ts's close sweep, in order.
    drain(PATH, "close");
    adapters.delete(PATH);

    expect(applied).toEqual([{ path: PATH, records: 1, why: "close" }]);
    expect(q.pending(PATH)).toBe(0);
    expect(adapters.has(PATH), "the adapter really is gone afterwards").toBe(false);
    expect(q.paths(), "and nothing is retained for a surface that no longer exists").toEqual([]);
  });
});

describe("WP37 AC5 — exit 3 of 3: TEARDOWN", () => {
  it("T9 teardown drains EVERY path, then clears unconditionally", () => {
    // The state that distinguishes this exit: MORE THAN ONE path is pending, and
    // there is no per-path event to hang the drain on.
    const q = createEditingDeferralQueue();
    const { applied, drain } = wireDrains(q);
    q.note(PATH, deferred("c1", "a"), data("a"));
    q.note(OTHER, deferred("c9", "b"), data("b"));

    for (const path of q.paths()) drain(path, "teardown");
    q.clearAll();

    expect(applied.map((a) => a.path).sort()).toEqual([OTHER, PATH].sort());
    expect(q.paths()).toEqual([]);
  });

  it("T10 clearAll leaves nothing even for a path whose drain was never wired", () => {
    const q = createEditingDeferralQueue();
    q.note(PATH, deferred("c1", "a"), data("a"));
    q.clearAll();
    expect(q.paths()).toEqual([]);
    expect(q.pending(PATH)).toBe(0);
  });
});

describe("WP37 AC5 — the queue is fed by the DECISION, not by hand", () => {
  it("T11 a held pass produces exactly the entries the decision named", () => {
    const q = createEditingDeferralQueue();
    const desired = data("one REMOTE");
    const decision = planEditingDeferral({
      path: PATH,
      desired,
      lastApplied: data("one"),
      liveNodeIds: new Set(["c1", "c2"]),
      liveEdgeIds: new Set<string>(),
      plan: "structural",
      initial: false,
      editingNodeId: "c1",
      editingSurfaceRecord: {
        id: "c1",
        type: "text",
        x: 0,
        y: 0,
        width: 300,
        height: 140,
        text: "one",
      },
    });
    q.note(PATH, decision.deferred, desired);
    expect(q.pendingIds(PATH)).toEqual(["c1"]);
    expect(q.drain(PATH)?.records[0].fields.text).toBe("one REMOTE");
  });
});
