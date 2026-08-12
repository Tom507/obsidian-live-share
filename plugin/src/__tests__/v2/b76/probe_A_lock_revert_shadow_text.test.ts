// B76 — PROBE A. The lock revert's receipt, the merge base, and whose
// characters survive.
//
// WHY AN AUTHOR-INTENT ORACLE, and why every existing oracle here is blind.
// The canvas suite compares the two peer replicas to each other. Both replicas
// converge — on whichever text survived. Convergence cannot answer *whose*
// characters survived, which is the entire question in B76. So the assertions
// below ask: after this pass, are peer B's characters still present at all?
//
// WHY THE ORACLE IS DRIVEN BY THE PRODUCT'S SOURCE. `main.ts` has no test file
// of its own and `applyCanvasNodeRevert` is private, so a hand-built receipt
// would only test this file's own re-implementation — it would stay RED after a
// correct fix and GREEN after a wrong one. Following the technique B72 already
// established for this exact gap (`v2/b72/test_tp04...`, "the wiring is asserted
// over the SOURCE — the one oracle a double cannot fake"), T1/T2 read the record
// literal the product actually hands to `buildApplyReceipt` and then run the
// REAL `canvas-shadow` and `canvas-text-merge` against that field set.
//
//   ├── T1  the fields `applyCanvasNodeRevert` reports are a subset of the
//   │       fields it applied. `applyNodeGeometry` writes x/y/width/height and
//   │       nothing else, and the method logs "not applied: text" itself.
//   ├── T2  THE DATA-LOSS ASSERTION. Feed the product's own reported field set
//   │       through the real shadow, then use the shadow as the three-way merge
//   │       base exactly as `canvas-sync.ts::writeCollabText` does. Peer B's
//   │       characters must still be there afterwards.
//   ├── T3  the mechanism, pinned as an invariant: a receipt built from the
//   │       WHOLE shared record DOES poison the shadow and DOES delete the
//   │       peer's characters. This is what T1/T2 protect against; it is a
//   │       property of the shadow module and is deliberately unchanged.
//   ├── T4  the geometry half must keep working — x/y/width/height still advance.
//   └── T5  an unconfirmed outcome advances nothing (the existing rule-2 control).
//
// Pure module test. No Obsidian, no rig, no doc, no timers.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planTextMerge } from "../../../canvas/canvas-text-merge";
import {
  type ApplyOutcome,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
} from "../../../canvas/canvas-shadow";
import { parseUnits, stripComments } from "../wp87/surface-route-census";

const SRC = join(__dirname, "..", "..", "..");
const PATH = "boards/team.canvas";
const NODE = "c1";

/** What both peers started from, before either of them typed. */
const COMMON = "Agenda:";
/** Local author A types this. While the editor is open it never leaves the CM view. */
const LOCAL = "Agenda: A-item";
/** Peer B types this; it is what the shared doc and the shared record hold. */
const PEER = "Agenda: B-item";

/** The shared record the loser is reverted to: the winner's geometry AND text. */
const DESIRED: Record<string, unknown> = {
  id: NODE,
  type: "text",
  x: 120,
  y: 64,
  width: 400,
  height: 200,
  text: PEER,
};

// --- the product half -------------------------------------------------------

/** `main.ts#applyCanvasNodeRevert`, comments stripped so prose cannot satisfy a check. */
function revertUnitBody(): string {
  const raw = readFileSync(join(SRC, "main.ts"), "utf8");
  const unit = parseUnits("main.ts", stripComments(raw)).find(
    (u) => u.id === "main.ts#applyCanvasNodeRevert",
  );
  if (!unit) throw new Error("census is vacuous: main.ts#applyCanvasNodeRevert not found");
  return unit.body;
}

/**
 * The record literal the product hands to `buildApplyReceipt`, reduced to the
 * set of FIELD NAMES it reports as having reached the surface.
 *
 * Two shapes are recognised, and anything else is a hard failure rather than a
 * silent pass — an unparsed call must never read as "reports nothing".
 *
 *   ├── `desired: { nodes: [{ id: nodeId, x, y, width, height }], edges: [] }`
 *   │       → the literal's own keys.
 *   └── `desired: { nodes: [desired], edges: [] }`
 *           → an identifier: the WHOLE shared record, so every key of it.
 */
function reportedFields(): string[] {
  const body = revertUnitBody();
  const call = /buildApplyReceipt\s*\(\s*\{([\s\S]*?)\}\s*\)\s*,?\s*\)/.exec(body);
  if (!call) throw new Error("census is vacuous: no buildApplyReceipt(...) call in the revert");
  const nodes = /desired\s*:\s*\{\s*nodes\s*:\s*\[([\s\S]*?)\]/.exec(call[1]);
  if (!nodes) throw new Error("census is vacuous: no `desired.nodes` in the receipt call");
  const entry = nodes[1].trim();

  if (entry.startsWith("{")) {
    // An inline literal — its keys are exactly what this pass claims it applied.
    const inner = entry.slice(1, entry.lastIndexOf("}"));
    return inner
      .split(",")
      .map((part) => part.split(":")[0].trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  }
  if (/^[A-Za-z_$][\w$]*$/.test(entry)) {
    // A bare identifier: whatever that record holds. In the live path it is the
    // shared snapshot record, i.e. every field the peer's truth carries.
    return Object.keys(DESIRED);
  }
  throw new Error(`census cannot read the receipt's node record: ${entry}`);
}

/** The desired record projected onto the fields the product actually reports. */
function reportedRecord(): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of reportedFields()) {
    if (field in DESIRED) record[field] = DESIRED[field];
  }
  record.id = NODE; // the receipt is keyed on it; a receipt without it describes nothing
  return record;
}

// --- the shadow half --------------------------------------------------------

/**
 * The shadow as it stands when the revert fires: this client last confirmed the
 * pre-edit geometry and the pre-edit text reached its own surface.
 */
function shadowAtRevert() {
  const shadow = createSurfaceShadow();
  advanceFromReceipt(
    shadow,
    buildApplyReceipt({
      path: PATH,
      desired: {
        nodes: [{ id: NODE, type: "text", x: 0, y: 0, width: 400, height: 200, text: COMMON }],
        edges: [],
      },
      plan: "structural",
      reloaded: true,
    }),
  );
  return shadow;
}

/** The receipt seam `applyCanvasNodeRevert` executes, with a chosen field set. */
function revertReceipt(
  shadow: ReturnType<typeof createSurfaceShadow>,
  record: Record<string, unknown>,
  outcome: ApplyOutcome,
) {
  return advanceFromReceipt(
    shadow,
    buildApplyReceipt({
      path: PATH,
      desired: { nodes: [record], edges: [] },
      plan: "geometry",
      nodeOutcomes: new Map<string, ApplyOutcome>([[NODE, outcome]]),
    }),
  );
}

/**
 * `canvas-sync.ts::writeCollabText`, verbatim in shape: base is read from the
 * shadow inside the capture, `next` is the local `.canvas` file, `current` is
 * the doc's `Y.Text`.
 */
function captureAfterRevert(shadow: ReturnType<typeof createSurfaceShadow>) {
  const shadowValue = getField(shadow, PATH, "node", NODE, "text");
  const base = typeof shadowValue === "string" ? shadowValue : undefined;
  return planTextMerge(base, LOCAL, PEER);
}

describe("B76 probe A — a geometry-only lock revert must not report a text it did not apply", () => {
  it("T0 the census is not vacuous — it finds the revert and reads its receipt call", () => {
    // S53's recursive-vacuity trap: a census that silently found nothing would
    // make every assertion below pass while measuring nothing at all.
    expect(revertUnitBody()).toMatch(/buildApplyReceipt/);
    expect(reportedFields().length).toBeGreaterThan(0);
    expect(reportedFields()).toContain("x");
  });

  it("T1 the fields the revert reports are a subset of the fields it applied", () => {
    // `CanvasAdapter` has exactly one per-record write — `applyNodeGeometry`,
    // i.e. x/y/width/height — and the method says so in its own log line.
    const applied = new Set(["id", "x", "y", "width", "height"]);
    const overclaimed = reportedFields().filter((f) => !applied.has(f));
    expect(
      overclaimed,
      "the revert's receipt claims fields `applyNodeGeometry` cannot write; the shadow will " +
        "record them as confirmed on a surface that never took them",
    ).toEqual([]);
  });

  for (const outcome of ["applied", "unchanged"] as const) {
    it(`T2 (${outcome}) peer B's characters survive the capture that follows the revert`, () => {
      const shadow = shadowAtRevert();
      revertReceipt(shadow, reportedRecord(), outcome);
      const merged = captureAfterRevert(shadow);

      expect(
        merged.result.includes("B-item"),
        "peer B's characters were computed as a DELETION: the merge base came from a revert " +
          "receipt that claimed a text the surface never took",
      ).toBe(true);
      expect(
        merged.result.includes("A-item"),
        "the local author's characters must survive too",
      ).toBe(true);
    });
  }

  it("T3 the mechanism this protects against, pinned: a whole-record receipt does destroy text", () => {
    // Deliberately NOT driven by the product source — this is the shadow
    // module's own behaviour and it is correct on every route where
    // `planReconcile` guaranteed the non-geometry fields already matched.
    // It is only wrong when a caller hard-codes `plan: "geometry"` for a record
    // whose text differs. If this ever goes green, the fix moved into the shadow
    // and T1/T2 above are no longer measuring what they claim to.
    const shadow = shadowAtRevert();
    revertReceipt(shadow, { ...DESIRED }, "applied");
    expect(getField(shadow, PATH, "node", NODE, "text")).toBe(PEER);
    expect(captureAfterRevert(shadow).result.includes("B-item")).toBe(false);
  });

  it("T4 the geometry half of the same receipt still advances", () => {
    const shadow = shadowAtRevert();
    revertReceipt(shadow, reportedRecord(), "applied");
    expect(getField(shadow, PATH, "node", NODE, "x")).toBe(120);
    expect(getField(shadow, PATH, "node", NODE, "y")).toBe(64);
    expect(getField(shadow, PATH, "node", NODE, "width")).toBe(400);
    expect(getField(shadow, PATH, "node", NODE, "height")).toBe(200);
  });

  it("T5 an unconfirmed revert (interacting) advances nothing — the rule-2 control", () => {
    const shadow = shadowAtRevert();
    revertReceipt(shadow, reportedRecord(), "interacting");
    expect(getField(shadow, PATH, "node", NODE, "text")).toBe(COMMON);
    expect(getField(shadow, PATH, "node", NODE, "x")).toBe(0);
  });

  it("T6 the honest base keeps both authors — the merge itself was never the defect", () => {
    const merged = planTextMerge(COMMON, LOCAL, PEER);
    expect(merged.result.includes("B-item")).toBe(true);
    expect(merged.result.includes("A-item")).toBe(true);
  });
});
