// WP87 — the pure decision and the hold queue, headless.
//
// Everything here is a property of `canvas/canvas-editing-deferral.ts`, which
// imports nothing from Obsidian, the filesystem or a clock. No test in this file
// sleeps: the bound is driven, never read off a constant (C37 AC5's named trap,
// inherited).

import { describe, expect, it } from "vitest";

import {
  CANVAS_EDIT_DRAIN_DELAY_MS,
  type CanvasDiskWriteDecision,
  classifyBusyGate,
  createCanvasWriteHoldQueue,
  planCanvasDiskWrite,
  planCanvasDrain,
  planEditingDeferral,
} from "../../../canvas/canvas-editing-deferral";

const decide = (editingNodeId: string | null, surfaceReadable = true): CanvasDiskWriteDecision =>
  planCanvasDiskWrite({ editingNodeId, surfaceReadable });

describe("WP87 — planCanvasDiskWrite: the second consumer of the ONE predicate", () => {
  it("WITHHOLDS while an inline editor is identified, and names the node", () => {
    const d = decide("c1");
    expect(d.mode).toBe("withhold");
    expect(d.editingNodeId).toBe("c1");
    expect(d.reason).toContain("c1");
  });

  it("WRITES when nothing is being edited", () => {
    expect(decide(null).mode).toBe("write");
  });

  it("WRITES when there is no live surface to ask — the fail-OPEN direction, and why", () => {
    // Deliberately the opposite of `planEditingDeferral`'s fail-closed default.
    // Withholding a VIEW apply costs stale pixels until the next pass; withholding
    // a DISK write with no editor to blur has nothing to release it, and a
    // permanently stale `.canvas` is WP85's defect rebuilt. Only a POSITIVELY
    // identified editing session withholds.
    expect(decide("c1", false).mode).toBe("write");
    expect(decide(null, false).mode).toBe("write");
  });

  it("ANTI-VACUITY: the same function returns four alternating answers", () => {
    // A predicate that answered "withhold" unconditionally would protect the
    // editor and freeze every canvas file in the vault; one that answered
    // "write" unconditionally is HEAD. Neither passes this row.
    expect([
      decide("c1").mode,
      decide(null).mode,
      decide("c2").mode,
      decide("c1", false).mode,
    ]).toEqual(["withhold", "write", "withhold", "write"]);
  });

  it("is TOTAL: undefined and absent inputs land on a defined answer, never a throw", () => {
    expect(planCanvasDiskWrite({ editingNodeId: null, surfaceReadable: true }).mode).toBe("write");
    expect(
      planCanvasDiskWrite({
        editingNodeId: undefined as unknown as null,
        surfaceReadable: undefined as unknown as boolean,
      }).mode,
    ).toBe("write");
  });

  it("is PURE: it takes no clock, no DOM and no adapter — the fact is an argument", () => {
    const before = decide("c1");
    const after = decide("c1");
    expect(after).toEqual(before);
  });
});

describe("WP87 — the write hold queue: bounded by construction, drained by three exits", () => {
  it("COALESCES: 200 withheld flushes over one path leave exactly ONE entry, the LAST", () => {
    // Driven, not read off a cap constant — there is no cap constant, which is
    // deliberate: a cap would hide a wrongly computed key.
    const q = createCanvasWriteHoldQueue();
    for (let i = 0; i < 200; i++) q.hold("board.canvas", "board.canvas", `content-${i}`);
    expect(q.paths()).toEqual(["board.canvas"]);
    expect(q.holds("board.canvas")).toBe(200);
    const released = q.release("board.canvas");
    expect(released?.content).toBe("content-199");
    expect(released?.holds).toBe(200);
    // A queue that coalesced to the FIRST would be bounded and wrong.
    expect(q.pending("board.canvas")).toBe(false);
  });

  it("PATHS DO NOT BLEED: releasing one leaves the other intact", () => {
    const q = createCanvasWriteHoldQueue();
    q.hold("a.canvas", "a.canvas", "A1");
    q.hold("b.canvas", "b.canvas", "B1");
    expect(q.release("a.canvas")?.content).toBe("A1");
    expect(q.pending("b.canvas")).toBe(true);
    expect(q.paths()).toEqual(["b.canvas"]);
  });

  it("a release on an empty path is null, not an empty write", () => {
    const q = createCanvasWriteHoldQueue();
    expect(q.release("nothing.canvas")).toBeNull();
  });

  it("clearAll leaves nothing — nothing may outlive the surfaces it was held for", () => {
    const q = createCanvasWriteHoldQueue();
    q.hold("a.canvas", "a.canvas", "A");
    q.hold("b.canvas", "b.canvas", "B");
    q.clearAll();
    expect(q.paths()).toEqual([]);
  });

  it("release is IDEMPOTENT — a second drain of the same path writes nothing again", () => {
    const q = createCanvasWriteHoldQueue();
    q.hold("a.canvas", "a.canvas", "A");
    expect(q.release("a.canvas")).not.toBeNull();
    expect(q.release("a.canvas")).toBeNull();
  });
});

describe("WP87 — planCanvasDrain: the drain waits for the local capture, and is bounded", () => {
  const rec = (id: string, surface: unknown, lastApplied: unknown) => ({
    id,
    surface: surface as Record<string, unknown> | null,
    lastApplied: lastApplied as Record<string, unknown> | null,
  });

  it("RETRIES while the surface holds something the shadow has not confirmed", () => {
    // This is the state a blur produces: the editor's text has just been
    // committed into the node model and the capture has not run yet. Applying
    // here overwrites it — with WP37's own drain as the mechanism.
    const d = planCanvasDrain({
      records: [rec("c1", { id: "c1", text: "kollabo2ration" }, { id: "c1", text: "kollaboration" })],
      attempt: 0,
    });
    expect(d.mode).toBe("retry");
    expect(d.uncapturedIds).toEqual(["c1"]);
  });

  it("APPLIES once the capture has landed and the two agree", () => {
    const d = planCanvasDrain({
      records: [
        rec("c1", { id: "c1", text: "kollabo2ration" }, { id: "c1", text: "kollabo2ration" }),
      ],
      attempt: 1,
    });
    expect(d.mode).toBe("apply");
    expect(d.uncapturedIds).toEqual([]);
  });

  it("IS BOUNDED — it applies anyway at the last attempt, and says why", () => {
    // A queue that never drains is a permanently stale view: a worse defect than
    // the one being repaired. Driven, not read off the constant.
    const uncaptured = [
      rec("c1", { id: "c1", text: "never captured" }, { id: "c1", text: "old" }),
    ];
    const modes = [0, 1, 2, 3, 4].map(
      (attempt) => planCanvasDrain({ records: uncaptured, attempt }).mode,
    );
    expect(modes).toEqual(["retry", "retry", "retry", "apply", "apply"]);
    expect(planCanvasDrain({ records: uncaptured, attempt: 3 }).reason).toContain("never landed");
  });

  it("an UNREADABLE surface or an unobserved shadow APPLIES — the safe direction here", () => {
    // The opposite of `planEditingDeferral`'s default, for the same reason as
    // `planCanvasDiskWrite`: withholding a drain forever is the stale view.
    expect(planCanvasDrain({ records: [rec("c1", null, { id: "c1" })], attempt: 0 }).mode).toBe(
      "apply",
    );
    expect(planCanvasDrain({ records: [rec("c1", { id: "c1" }, null)], attempt: 0 }).mode).toBe(
      "apply",
    );
  });

  it("ANTI-VACUITY: the same function answers both ways on the same attempt", () => {
    const agreeing = [rec("c1", { id: "c1", text: "x" }, { id: "c1", text: "x" })];
    const differing = [rec("c1", { id: "c1", text: "x" }, { id: "c1", text: "y" })];
    expect([
      planCanvasDrain({ records: agreeing, attempt: 0 }).mode,
      planCanvasDrain({ records: differing, attempt: 0 }).mode,
    ]).toEqual(["apply", "retry"]);
  });

  it("an EMPTY record set applies — there is nothing to wait for", () => {
    expect(planCanvasDrain({ records: [], attempt: 0 }).mode).toBe("apply");
  });
});

describe("WP87 — nothing WP37 landed is weakened", () => {
  it("CANVAS_EDIT_DRAIN_DELAY_MS is unchanged, and no timing constant was tuned", () => {
    // C87 AC5: a timing change here would be a repair aimed at a mechanism that
    // was already falsified (removing the propagation window entirely changed
    // nothing — WP36 §4). The value is quoted so a later edit is visible.
    expect(CANVAS_EDIT_DRAIN_DELAY_MS).toBe(2500);
  });

  it("classifyBusyGate's three verdicts are unchanged", () => {
    expect(classifyBusyGate({ busy: false, editingNodeId: null })).toBe("proceed");
    expect(classifyBusyGate({ busy: true, editingNodeId: null })).toBe("defer-drag");
    expect(classifyBusyGate({ busy: true, editingNodeId: "c1" })).toBe("editing");
    expect(classifyBusyGate({ busy: false, editingNodeId: "c1" })).toBe("editing");
  });

  it("planEditingDeferral still SUBSTITUTES the edited record and applies every other", () => {
    const decision = planEditingDeferral({
      path: "b.canvas",
      desired: {
        nodes: [
          { id: "c1", text: "one REMOTE" },
          { id: "c2", text: "two REMOTE" },
        ],
        edges: [],
      },
      lastApplied: { nodes: [{ id: "c1", text: "one" }], edges: [] },
      liveNodeIds: new Set(["c1", "c2"]),
      liveEdgeIds: new Set(),
      plan: "structural",
      initial: false,
      editingNodeId: "c1",
      editingSurfaceRecord: { id: "c1", text: "one-MINE" },
    });
    expect(decision.mode).toBe("substitute");
    expect(decision.surfaceData.nodes.find((n) => n.id === "c1")?.text).toBe("one-MINE");
    expect(decision.surfaceData.nodes.find((n) => n.id === "c2")?.text).toBe("two REMOTE");
    expect(decision.heldNodeIds).toEqual(["c1"]);
  });

  it("the two queues are INDEPENDENT — a held write is not a held record", () => {
    // This is why `releaseHeldCanvasWrite` runs BEFORE `drainCanvasDeferrals`'
    // early return: the writer flushes on every doc change, the reconcile only on
    // a difference, so a path can hold a write with nothing queued for the view.
    // A drain that returned early on the empty record queue would strand the file.
    const q = createCanvasWriteHoldQueue();
    q.hold("b.canvas", "b.canvas", "bytes");
    const decision = planEditingDeferral({
      path: "b.canvas",
      desired: { nodes: [{ id: "c1", text: "same" }], edges: [] },
      lastApplied: { nodes: [{ id: "c1", text: "same" }], edges: [] },
      liveNodeIds: new Set(["c1"]),
      liveEdgeIds: new Set(),
      plan: "structural",
      initial: false,
      editingNodeId: "c1",
      editingSurfaceRecord: { id: "c1", text: "same" },
    });
    expect(decision.mode).toBe("proceed");
    expect(decision.deferred).toEqual([]);
    expect(q.pending("b.canvas")).toBe(true);
  });
});
