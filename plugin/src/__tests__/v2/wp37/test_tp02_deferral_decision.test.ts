// WP37 / C37 AC2 + AC4 — the deferral DECISION, and the shadow interlock.
//
// AC2's vacuity clause is the reason half of this file exists: "only the
// 'deferred' half is observed" passes unchanged against the pre-WP37 build,
// because today's code already defers by dropping everything. The discriminating
// half is the OTHER record still being applied, so every held case here is paired
// with an assertion that the unheld records survived into `surfaceData`.
//
// AC4's vacuity clause is the reason the receipt is exercised end-to-end rather
// than by inspecting the decision: "the shadow was not advanced because the pass
// was dropped entirely" is the PRE-WP37 behaviour. So the substitute case runs
// the real `buildApplyReceipt` / `advanceFromReceipt` seam and asserts BOTH that
// the held record kept its previous values and that the other record took the new
// ones — in the same pass.

import { describe, expect, it } from "vitest";

import {
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
} from "../../../canvas/canvas-shadow";
import {
  classifyBusyGate,
  planEditingDeferral,
  sameRecordFields,
} from "../../../canvas/canvas-editing-deferral";
import type { CanvasRecords } from "../../../canvas/reconcile-plan";

const PATH = "boards/plan.canvas";

const SURFACE_C1 = { id: "c1", type: "text", x: 0, y: 0, width: 300, height: 140, text: "one" };
const SURFACE_C2 = { id: "c2", type: "text", x: 500, y: 0, width: 300, height: 140, text: "two" };

function records(...nodes: Record<string, unknown>[]): CanvasRecords {
  return { nodes, edges: [] };
}

function input(over: Partial<Parameters<typeof planEditingDeferral>[0]> = {}) {
  return {
    path: PATH,
    lastApplied: records({ ...SURFACE_C1 }, { ...SURFACE_C2 }),
    liveNodeIds: new Set(["c1", "c2"]),
    liveEdgeIds: new Set<string>(),
    plan: "structural" as const,
    initial: false,
    editingNodeId: "c1" as string | null,
    editingSurfaceRecord: { ...SURFACE_C1 } as Record<string, unknown> | null,
    ...over,
    desired: over.desired ?? records({ ...SURFACE_C1 }, { ...SURFACE_C2 }),
  };
}

describe("WP37 — classifyBusyGate tells a drag from an edit", () => {
  it("T1 not busy, nothing edited => proceed", () => {
    expect(classifyBusyGate({ busy: false, editingNodeId: null })).toBe("proceed");
  });
  it("T2 busy, nothing edited => defer-drag (HEAD's behaviour, unchanged)", () => {
    expect(classifyBusyGate({ busy: true, editingNodeId: null })).toBe("defer-drag");
  });
  it("T3 busy, an editor focused => editing (the pass continues to the deferral)", () => {
    expect(classifyBusyGate({ busy: true, editingNodeId: "c1" })).toBe("editing");
  });
  it("T4 an editor focused wins even if the busy flag has not caught up", () => {
    // The two facts are measured separately and can disagree for one call; an
    // edit must never be mistaken for a drag, because a drag DROPS the pass.
    expect(classifyBusyGate({ busy: false, editingNodeId: "c1" })).toBe("editing");
  });
});

describe("WP37 AC2 — the decision is PER RECORD", () => {
  it("T5 nothing edited => proceed, and `surfaceData` IS the desired data", () => {
    const inp = input({ editingNodeId: null });
    const d = planEditingDeferral(inp);
    expect(d.mode).toBe("proceed");
    expect(d.surfaceData).toBe(inp.desired);
    expect(d.deferred).toEqual([]);
    expect(d.heldNodeIds).toEqual([]);
  });

  it("T6 the edited card is unchanged by the pass => proceed, nothing queued", () => {
    const d = planEditingDeferral(input());
    expect(d.mode).toBe("proceed");
    expect(d.deferred).toEqual([]);
  });

  it("T7 SUBSTITUTE — the edited card keeps the surface value, the OTHER card takes the new one", () => {
    const d = planEditingDeferral(
      input({
        desired: records(
          { ...SURFACE_C1, text: "one REMOTE" },
          { ...SURFACE_C2, text: "two REMOTE" },
        ),
      }),
    );
    expect(d.mode).toBe("substitute");
    const byId = new Map(d.surfaceData.nodes.map((n) => [n.id as string, n]));
    // THE DISCRIMINATOR: without this half the assertion below passes against
    // the pre-WP37 build, which defers by dropping everything.
    expect(byId.get("c2")?.text, "the unrelated card is NOT held hostage").toBe("two REMOTE");
    expect(byId.get("c1")?.text, "the edited card keeps what the surface holds").toBe("one");
    expect(d.heldNodeIds).toEqual(["c1"]);
    expect(d.deferred).toEqual([
      { kind: "node", id: "c1", fields: { ...SURFACE_C1, text: "one REMOTE" } },
    ]);
  });

  it("T8 the substitution does not mutate the caller's desired data", () => {
    const desired = records({ ...SURFACE_C1, text: "one REMOTE" }, { ...SURFACE_C2 });
    planEditingDeferral(input({ desired }));
    expect(desired.nodes[0].text, "the input is untouched").toBe("one REMOTE");
  });

  it("T9 the surface record is preferred over the shadow — it is a measurement", () => {
    // The shadow says "one"; the live card says "one plus local". Substituting the
    // SHADOW value would write "one" over the card and destroy the local edit,
    // which is the defect wearing the fix's clothes.
    const d = planEditingDeferral(
      input({
        desired: records({ ...SURFACE_C1, text: "one REMOTE" }, { ...SURFACE_C2 }),
        editingSurfaceRecord: { ...SURFACE_C1, text: "one plus local" },
      }),
    );
    const c1 = d.surfaceData.nodes.find((n) => n.id === "c1");
    expect(c1?.text).toBe("one plus local");
  });

  it("T10 with no readable surface state at all => HOLD, never a guess", () => {
    const d = planEditingDeferral(
      input({
        desired: records({ ...SURFACE_C1, text: "one REMOTE" }, { ...SURFACE_C2 }),
        editingSurfaceRecord: null,
        lastApplied: null,
      }),
    );
    expect(d.mode).toBe("hold");
    expect(d.heldNodeIds.sort()).toEqual(["c1", "c2"]);
  });

  it("T11 the shadow is the FALLBACK when the adapter cannot answer", () => {
    const d = planEditingDeferral(
      input({
        desired: records({ ...SURFACE_C1, text: "one REMOTE" }, { ...SURFACE_C2 }),
        editingSurfaceRecord: null,
      }),
    );
    expect(d.mode).toBe("substitute");
    expect(d.surfaceData.nodes.find((n) => n.id === "c1")?.text).toBe("one");
  });
});

describe("WP37 AC5 — membership changes are NOT held; only the unsalvageable cases are", () => {
  // The first build held every membership change, on the reasoning that `setData`
  // rebuilds the view. MEASURED on the live rig and that reasoning is wrong: the
  // editor survives a card being added by a peer (run 035215, S3, PASSING on the
  // unmodified tree). Holding bought nothing and stopped the board updating while
  // anyone was typing — a stale view, which this WP may not introduce.

  it("T12 a card added remotely => the add goes through, the edited card is protected", () => {
    const d = planEditingDeferral(
      input({
        desired: records(
          { ...SURFACE_C1, text: "one REMOTE" },
          { ...SURFACE_C2 },
          { ...SURFACE_C1, id: "c3" },
        ),
      }),
    );
    expect(d.mode).toBe("substitute");
    expect(
      d.surfaceData.nodes.map((n) => n.id).sort(),
      "the new card really is handed to the surface",
    ).toEqual(["c1", "c2", "c3"]);
    expect(d.surfaceData.nodes.find((n) => n.id === "c1")?.text).toBe("one");
    expect(d.heldNodeIds).toEqual(["c1"]);
  });

  it("T13 a card added remotely while the edited card is UNCHANGED => plain proceed", () => {
    const d = planEditingDeferral(
      input({
        desired: records({ ...SURFACE_C1 }, { ...SURFACE_C2 }, { ...SURFACE_C1, id: "c3" }),
      }),
    );
    expect(d.mode).toBe("proceed");
    expect(d.deferred).toEqual([]);
    expect(d.reason).toContain("membership changed elsewhere");
  });

  it("T14 the EDITED card removed remotely => hold; a live editor is not yanked away", () => {
    const d = planEditingDeferral({ ...input(), desired: records({ ...SURFACE_C2 }) });
    expect(d.mode).toBe("hold");
    expect(d.reason).toContain("absent from the pass");
  });

  it("T15 an edge added remotely => it reaches the surface, the edited card does not", () => {
    const d = planEditingDeferral({
      ...input(),
      desired: {
        nodes: [{ ...SURFACE_C1, text: "one REMOTE" }, { ...SURFACE_C2 }],
        edges: [{ id: "e1", fromNode: "c1", toNode: "c2" }],
      },
    });
    expect(d.mode).toBe("substitute");
    expect(d.surfaceData.edges).toHaveLength(1);
    expect(d.surfaceData.nodes.find((n) => n.id === "c1")?.text).toBe("one");
  });

  it("T16 an authoritative (initial) pass => hold", () => {
    const d = planEditingDeferral(input({ initial: true }));
    expect(d.mode).toBe("hold");
    expect(d.reason).toContain("authoritative");
  });

  it("T17 the edited card missing from the pass, with ids intact => hold", () => {
    const d = planEditingDeferral({
      ...input(),
      desired: records({ ...SURFACE_C2 }),
      liveNodeIds: new Set(["c2"]),
    });
    expect(d.mode).toBe("hold");
  });
});

describe("WP37 AC4 — the Surface-Shadow interlock, through the REAL receipt seam", () => {
  it("T17 a deferred record's fields are NOT advanced while the other record's ARE", () => {
    const shadow = createSurfaceShadow();
    // Establish a basis exactly as a normal pass would.
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: records({ ...SURFACE_C1 }, { ...SURFACE_C2 }),
        plan: "structural",
        reloaded: true,
      }),
    );
    expect(getField(shadow, PATH, "node", "c1", "text")).toBe("one");

    const d = planEditingDeferral(
      input({
        desired: records(
          { ...SURFACE_C1, text: "one REMOTE" },
          { ...SURFACE_C2, text: "two REMOTE" },
        ),
      }),
    );
    expect(d.mode).toBe("substitute");
    // main.ts builds the receipt from `surfaceData` — WHAT WAS HANDED OVER.
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: d.surfaceData,
        plan: "structural",
        reloaded: true,
      }),
    );

    expect(
      getField(shadow, PATH, "node", "c1", "text"),
      "the deferred record was NOT advanced to the remote value",
    ).toBe("one");
    expect(
      getField(shadow, PATH, "node", "c2", "text"),
      "the applied record WAS advanced — this is the half that fails on a dropped pass",
    ).toBe("two REMOTE");
  });

  it("T18 …and the shadow DOES advance at the drain — unadvanced-then-never is a leak", () => {
    const shadow = createSurfaceShadow();
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: records({ ...SURFACE_C1 }, { ...SURFACE_C2 }),
        plan: "structural",
        reloaded: true,
      }),
    );
    const deferredData = records(
      { ...SURFACE_C1, text: "one REMOTE" },
      { ...SURFACE_C2, text: "two REMOTE" },
    );
    const held = planEditingDeferral(input({ desired: deferredData }));
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: held.surfaceData,
        plan: "structural",
        reloaded: true,
      }),
    );
    expect(getField(shadow, PATH, "node", "c1", "text")).toBe("one");

    // The drain: the same data, re-run with the editor closed.
    const drained = planEditingDeferral(
      input({ desired: deferredData, editingNodeId: null, editingSurfaceRecord: null }),
    );
    expect(drained.mode).toBe("proceed");
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: drained.surfaceData,
        plan: "structural",
        reloaded: true,
      }),
    );
    expect(
      getField(shadow, PATH, "node", "c1", "text"),
      "the withheld value reached the shadow at the drain",
    ).toBe("one REMOTE");
  });

  it("T19 a geometry pass holds the edited card and applies the other", () => {
    const d = planEditingDeferral(
      input({
        plan: "geometry",
        desired: records({ ...SURFACE_C1, x: 99 }, { ...SURFACE_C2, x: 777 }),
      }),
    );
    expect(d.mode).toBe("substitute");
    expect(d.surfaceData.nodes.find((n) => n.id === "c1")?.x).toBe(0);
    expect(d.surfaceData.nodes.find((n) => n.id === "c2")?.x).toBe(777);
  });
});

describe("WP37 — sameRecordFields compares over the UNION of keys", () => {
  it("T20 a key present on one side only is a difference, not an equality", () => {
    expect(sameRecordFields({ id: "a", text: "x" }, { id: "a", text: "x" })).toBe(true);
    expect(sameRecordFields({ id: "a", text: "x" }, { id: "a", text: "x", color: "1" })).toBe(
      false,
    );
    expect(sameRecordFields({ id: "a", text: "x", color: "1" }, { id: "a", text: "x" })).toBe(
      false,
    );
    expect(sameRecordFields(null, { id: "a" })).toBe(false);
    expect(sameRecordFields({ id: "a" }, null)).toBe(false);
  });
});
