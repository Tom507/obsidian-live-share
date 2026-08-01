// WP2 / AC4 — a tombstoned record in the save is a resurrect attempt, not intent.
//
// AC4: "A record present in the save whose id is tombstoned with `on:true`
// produces no intent at all (resurrect block)."
//
// Why: deletion in V2 is a converging flag, not key absence (D3). Between the
// delete reaching the doc and the reconciler removing the record from the view,
// Obsidian's next save still contains it. Without the block, that save would
// re-create the record on every peer — the delete would never stick. The
// reconciler removes it from the view; the capture path must simply stay quiet.
//
// "No intent at all" is read strictly here: the record contributes nothing to any
// of the three categories — not an upsert, not a delete, and not a discarded
// entry either. A tombstoned record is not staleness; it is out of scope.
//
// `tombstoneView` is the injected seam: the same shadow and the same save with
// `isDeleted` returning false must produce the full intent set. That is the
// discrimination variant required by BUILD_SPEC section 8.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/Board.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

/** `on:true` for exactly the listed `kind:id` pairs. */
function tombstones(...keys: string[]): TombstoneView {
  const on = new Set(keys);
  return { isDeleted: (kind, id) => on.has(`${kind}:${id}`) };
}

function openSurface(nodes: string[] = [], edges: string[] = []): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodes), edge: new Set(edges) } };
}

function save(nodes: ParsedSave["nodes"] = [], edges: ParsedSave["edges"] = []): ParsedSave {
  return { path: PATH, nodes, edges };
}

describe("WP2 AC4 — the resurrect block", () => {
  it("a tombstoned record with changed fields produces nothing", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "dead", { x: 10, y: 20 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "dead", fields: { x: 999, y: 888, text: "back from the grave" } }]),
      tombstones("node:dead"),
      openSurface(["dead"]),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("a tombstoned record with unchanged fields is not even a discard", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "dead", { x: 10, y: 20 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "dead", fields: { x: 10, y: 20 } }]),
      tombstones("node:dead"),
      openSurface(["dead"]),
    );

    expect(plan.discarded).toEqual([]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("the block discriminates: the same inputs without the tombstone yield intent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "dead", { x: 10, y: 20 });
    const stillThere = save([{ id: "dead", fields: { x: 999, y: 20 } }]);

    const blocked = planIntentDiff(shadow, stillThere, tombstones("node:dead"), openSurface(["dead"]));
    const allowed = planIntentDiff(shadow, stillThere, NO_TOMBSTONES, openSurface(["dead"]));

    expect(blocked.upserts).toEqual([]);
    expect(blocked.discarded).toEqual([]);
    expect(allowed.upserts).toEqual([
      { path: PATH, kind: "node", id: "dead", field: "x", value: 999 },
    ]);
    expect(allowed.discarded).toHaveLength(1);
  });

  it("blocks only the tombstoned record, never its neighbours", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "dead", { x: 1 });
    advanceRecord(shadow, PATH, "node", "alive", { x: 2 });
    advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "dead", toNode: "alive" });

    const plan = planIntentDiff(
      shadow,
      save(
        [
          { id: "dead", fields: { x: 111 } },
          { id: "alive", fields: { x: 222 } },
        ],
        [{ id: "e1", fields: { fromNode: "dead", toNode: "alive", color: "5" } }],
      ),
      tombstones("node:dead"),
      openSurface(["dead", "alive"], ["e1"]),
    );

    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "alive", field: "x", value: 222 });
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "edge", id: "e1", field: "color", value: "5" });
    expect(plan.upserts.some((intent) => intent.id === "dead")).toBe(false);
  });

  it("the tombstone lookup is kind-scoped", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "x", { x: 1 });
    advanceRecord(shadow, PATH, "edge", "x", { fromNode: "a" });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "x", fields: { x: 9 } }], [{ id: "x", fields: { fromNode: "b" } }]),
      tombstones("node:x"),
      openSurface(["x"], ["x"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "x", field: "fromNode", value: "b" },
    ]);
  });

  it("a record whose tombstone is off (`on:false`) is processed normally", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "undeleted", { x: 1 });

    // The view is `on:false` — an undone delete. The record is live again.
    const plan = planIntentDiff(
      shadow,
      save([{ id: "undeleted", fields: { x: 42 } }]),
      { isDeleted: () => false },
      openSurface(["undeleted"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "undeleted", field: "x", value: 42 },
    ]);
  });

  it("a tombstoned record the shadow never saw is still blocked", () => {
    const shadow = createSurfaceShadow();

    const plan = planIntentDiff(
      shadow,
      save([{ id: "ghost", fields: { x: 1, y: 2, type: "text" } }]),
      tombstones("node:ghost"),
      openSurface(),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("is consulted with the record kind and id of the save", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1 });
    const seen: string[] = [];
    const recording: TombstoneView = {
      isDeleted: (kind: ShadowRecordKind, id: string) => {
        seen.push(`${kind}:${id}`);
        return false;
      },
    };

    planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 2 } }], [{ id: "e1", fields: { fromNode: "n1" } }]),
      recording,
      openSurface(["n1"], ["e1"]),
    );

    expect(seen).toContain("node:n1");
    expect(seen).toContain("edge:e1");
  });

  it("the block covers records in the save only — a missing record still follows the delete rule", () => {
    // Contract boundary, stated in the charter's module API: rule 4 speaks about
    // records PRESENT in the save. A record that is both tombstoned and missing
    // is classified by rule 3, and re-asserting an existing tombstone converges.
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1 });
    advanceRecord(shadow, PATH, "node", "dead", { x: 2 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 1 } }]),
      tombstones("node:dead"),
      openSurface(["n1", "dead"]),
    );

    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "dead" }]);
  });
});
