// WP15 AC3 — the delete-intent rule (C2 rule 4) is exercised through the SAME
// real tombstone-predicate-backed view as the resurrect block (test_tp04),
// for V2-composite-register records, and its existing "proven absence"
// gate keeps working unchanged.
//
// Per canvas-shadow.ts's own rule-4 contract: a present record missing from
// the save is a delete intent under proof (open view + hand-over receipt)
// regardless of whether it already carries a tombstone -- re-asserting an
// existing tombstone converges downstream (WP12's LWW merge is idempotent),
// so this is not a correctness gap. This test pins that CONSISTENT behavior
// using the real isTombstoneSuppressed-backed view rather than assuming it:
// a proven-missing record produces exactly one delete intent whether or not
// canvas-tombstone.ts already has an entry for it -- the delete rule genuinely
// operates "against the tombstone view" (the same real seam the resurrect
// block uses), it is simply not GATED by it, and this test locks that
// distinction in so a future change cannot silently start dropping proven
// deletes for already-tombstoned records (which would strand a peer's replica
// that has not yet seen the tombstone at all).

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodePos } from "../../../canvas/canvas-registers";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
  type TombstoneEntry,
  type TombstoneMap,
} from "../../../canvas/canvas-tombstone";

const PATH = "Vault/Board.canvas";

function buildTombstoneView(deleted: Array<[ShadowRecordKind, string]>): TombstoneView {
  const store = new Map<string, unknown>();
  const map: TombstoneMap = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
  const op: TombstoneEntry = { t: 1, by: "peer-a", on: true };
  for (const [kind, id] of deleted) applyTombstoneOp(map, `${kind}:${id}`, op);
  return {
    isDeleted: (kind, id) => isTombstoneSuppressed(readTombstoneEntry(map, `${kind}:${id}`)),
  };
}

function save(nodes: ParsedSave["nodes"] = []): ParsedSave {
  return { path: PATH, nodes, edges: [] };
}

function shadowWithTwoNodes() {
  const shadow = createSurfaceShadow();
  advanceField(shadow, PATH, "node", "n1", "pos", encodePos(1, 1) as any);
  advanceField(shadow, PATH, "node", "dead", "pos", encodePos(2, 2) as any);
  return shadow;
}

const REMAINING = save([{ id: "n1", fields: { pos: encodePos(1, 1) as any } }]);
const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(["n1", "dead"]), edge: new Set() },
};

describe("WP15 AC3 — the delete rule stays correct for V2 registers under the real tombstone view", () => {
  it("proven-missing record with NO existing tombstone -> one delete intent", () => {
    const plan = planIntentDiff(shadowWithTwoNodes(), REMAINING, buildTombstoneView([]), SURFACE);

    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "dead" }]);
  });

  it("proven-missing record that ALREADY carries an active tombstone -> the delete intent still converges (not a correctness gap)", () => {
    const plan = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      buildTombstoneView([["node", "dead"]]),
      SURFACE,
    );

    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "dead" }]);
  });

  it("both cases agree with each other -- the real tombstone view never changes the delete-count for a proven-missing record", () => {
    const withTombstone = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      buildTombstoneView([["node", "dead"]]),
      SURFACE,
    );
    const without = planIntentDiff(shadowWithTwoNodes(), REMAINING, buildTombstoneView([]), SURFACE);

    expect(withTombstone.deletes).toHaveLength(1);
    expect(without.deletes).toHaveLength(1);
    expect(withTombstone.deletes).toEqual(without.deletes);
  });
});
