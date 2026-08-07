// WP5 / AC4 — `main.ts` gains wiring only: construction, injection, forwarding.
//
// AC4: "`main.ts` gains wiring only — construction, injection and forwarding. No
// canvas decision logic is added to this file."
//
// `main.ts` has no test file and must not get one (BUILD_SPEC §3.1 S11), so the
// claim is tested where it is falsifiable:
//
//   PRIMARY ORACLE (behavioural) — the whole reconcile pass is expressed here as
//   `wire()`, a fixed sequence over the module API whose ONLY conditionals are the
//   two guards the adapter surface forces (available / busy) and the two mechanical
//   execution branches (`reloadCanvasData` vs the per-node loop) that already exist
//   in HEAD. It contains no predicate over shadow content, record fields or apply
//   outcomes, and it calls the receipt seam from exactly ONE place with the same
//   arguments in every branch. If any C5 decision still needed to live in `main.ts`,
//   at least one of the four scenarios below could not come out right.
//
//   SECONDARY ORACLE (structural) — a narrow source scan of `main.ts`, the repo's
//   established pattern for file-level claims (`canvas-single-writer.test.ts`,
//   `v2/wp1/test_tp02_headless_purity_visible.test.ts`). It pins the two facts AC1
//   and AC4 turn on: the parallel `canvasApplied` structure is gone, and the shadow
//   is OBTAINED from `CanvasSync`, never constructed or hand-advanced here.
//
// No timers, no sleeps, no timing constants. The `"interacting"` scenario uses an
// adapter decorator that reports `isBusy() === false` while the drag target is
// retained — the real watchdog-released state (`DRAG_WATCHDOG_MS`, canvas-adapter.ts)
// reproduced without touching any clock.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type CanvasAdapter, createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  type SurfaceShadow,
  type SurfaceStateStore,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  createSurfaceStateStore,
  getField,
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { type CanvasRecords, planReconcile } from "../../../canvas/reconcile-plan";
import { CanvasDouble } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const PATH = "design/system.canvas";

const SEED = [
  { id: "n1", type: "text", x: 0, y: 0, width: 160, height: 80, text: "in", color: "1" },
  { id: "n2", type: "text", x: 240, y: 0, width: 160, height: 80, text: "out", color: "2" },
];

type PassResult = "deferred" | "noop" | "structural" | "geometry";

/**
 * The entire `reconcileLiveCanvas` body, as wiring. Every canvas DECISION is a
 * call into a tested module; nothing here inspects canvas state to choose one.
 */
function wire(deps: {
  path: string;
  shadow: SurfaceShadow;
  store: SurfaceStateStore;
  adapter: CanvasAdapter;
  data: CanvasRecords;
  initial?: boolean;
}): PassResult {
  if (!deps.adapter.isAvailable()) return "deferred";
  if (deps.adapter.isBusy()) return "deferred";

  const plan = planReconcile({
    desired: deps.data,
    lastApplied: shadowToCanvasRecords(deps.shadow, deps.path),
    liveNodeIds: deps.adapter.getLiveNodeIds(),
    liveEdgeIds: deps.adapter.getLiveEdgeIds(),
    initial: deps.initial,
  });
  if (plan === "noop") return "noop";

  let reloaded: boolean | undefined;
  let nodeOutcomes: Map<string, ApplyOutcome> | undefined;
  if (plan === "structural") {
    reloaded = deps.adapter.reloadCanvasData({ nodes: deps.data.nodes, edges: deps.data.edges });
  } else {
    nodeOutcomes = new Map<string, ApplyOutcome>();
    for (const node of deps.data.nodes) {
      if (
        typeof node.id !== "string" ||
        typeof node.x !== "number" ||
        typeof node.y !== "number" ||
        typeof node.width !== "number" ||
        typeof node.height !== "number"
      ) {
        continue;
      }
      nodeOutcomes.set(
        node.id,
        deps.adapter.applyNodeGeometry(node.id, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        }),
      );
    }
  }

  const summary = advanceFromReceipt(
    deps.shadow,
    buildApplyReceipt({ path: deps.path, desired: deps.data, plan, reloaded, nodeOutcomes }),
  );
  // S83: the model forwards BOTH halves of the receipt, because production
  // does. `handed` grants, `summary.revoked` (an `"interacting"` refusal, or
  // the `exhaustive` absent sweep) revokes, and a record named by neither keeps
  // the licence it had. A `wire()` that forwarded `handed` alone would model the
  // pre-repair `noteHandover`, which REPLACED — and T2 below would then be
  // green for the wrong reason: it would read the held card's lost licence off
  // wholesale revocation rather than off the refusal that actually justifies it.
  deps.store.noteHandover(deps.path, summary.handed, summary.revoked);
  return plan;
}

function makeRig() {
  const double = new CanvasDouble({ nodes: SEED.map((record) => ({ ...record })) });
  const adapter = createCanvasAdapter(double.view);
  const shadow = createSurfaceShadow();
  const store = createSurfaceStateStore(() => true);
  adapter.isBusy();
  return { double, adapter, shadow, store, driver: new InteractionDriver(double) };
}

/** One reconcile pass over a rig — the deps object, written out explicitly. */
function pass(
  rig: ReturnType<typeof makeRig>,
  data: CanvasRecords,
  opts: { initial?: boolean; adapter?: CanvasAdapter } = {},
): PassResult {
  return wire({
    path: PATH,
    shadow: rig.shadow,
    store: rig.store,
    adapter: opts.adapter ?? rig.adapter,
    data,
    initial: opts.initial,
  });
}

/** The watchdog-released shape: not busy overall, drag target still protected. */
function idleAdapter(adapter: CanvasAdapter): CanvasAdapter {
  return { ...adapter, isBusy: () => false };
}

const SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WP5 AC4 — the reconcile pass is expressible as wiring only", () => {
  it("T1 an initial mount reloads, advances the shadow and then settles to noop", () => {
    const rig = makeRig();
    const data: CanvasRecords = { nodes: SEED.map((r) => ({ ...r })), edges: [] };

    expect(pass(rig, data, { initial: true })).toBe("structural");
    expect(getField(rig.shadow, PATH, "node", "n1", "text")).toBe("in");
    expect([...rig.store.stateFor(PATH).handedToView.node].sort()).toEqual(["n1", "n2"]);

    expect(pass(rig, data)).toBe("noop");
  });

  it("T2 a geometry delta with a held card advances every other record only", () => {
    const rig = makeRig();
    const seedData: CanvasRecords = { nodes: SEED.map((record) => ({ ...record })), edges: [] };
    pass(rig, seedData, { initial: true });

    const moved: CanvasRecords = {
      nodes: [
        { ...SEED[0], x: 60 },
        { ...SEED[1], x: 300 },
      ],
      edges: [],
    };

    let result: PassResult = "deferred";
    rig.driver.driveDrag(
      "n1",
      { x: 5, y: 5 },
      {
        during: () => {
          result = pass(rig, moved, { adapter: idleAdapter(rig.adapter) });
        },
      },
    );

    expect(result).toBe("geometry");
    expect(getField(rig.shadow, PATH, "node", "n1", "x"), "the held card was advanced").toBe(0);
    expect(getField(rig.shadow, PATH, "node", "n2", "x")).toBe(300);
    expect(rig.store.stateFor(PATH).handedToView.node.has("n1")).toBe(false);
    expect(rig.store.stateFor(PATH).handedToView.node.has("n2")).toBe(true);
  });

  it("T3 an unavailable adapter defers and touches nothing", () => {
    const shadow = createSurfaceShadow();
    const store = createSurfaceStateStore(() => false);
    const adapter = createCanvasAdapter({});

    expect(
      wire({
        path: PATH,
        shadow,
        store,
        adapter,
        data: { nodes: SEED.map((record) => ({ ...record })), edges: [] },
        initial: true,
      }),
    ).toBe("deferred");
    expect(shadowToCanvasRecords(shadow, PATH)).toBeNull();
    expect(store.stateFor(PATH).handedToView.node.size).toBe(0);
  });

  it("T4 a reload the private API cannot perform advances nothing", () => {
    const rig = makeRig();
    // The structural-reload surface disappears (I5: degrade, never break).
    (rig.double.canvas as unknown as Record<string, unknown>).setData = undefined;

    expect(
      pass(rig, { nodes: SEED.map((record) => ({ ...record })), edges: [] }, { initial: true }),
    ).toBe("structural");
    expect(getRecordState(rig.shadow, PATH, "node", "n1")).toBe("unknown");
    expect(rig.store.stateFor(PATH).handedToView.node.size).toBe(0);
  });

  it("T5 main.ts holds no parallel structure and no hand-rolled advance", () => {
    expect(CODE, "the V1 record snapshot must be gone (AC1)").not.toMatch(/\bcanvasApplied\b/);
    expect(CODE, "the V1 snapshot advance must be gone").not.toMatch(/\bcloneCanvasRecords\s*\(/);
    expect(CODE, "main.ts must not construct a second shadow (AC1)").not.toMatch(
      /\bcreateSurfaceShadow\s*\(/,
    );
    expect(CODE, "the shadow must be advanced through the receipt seam, not by hand").not.toMatch(
      /\b(?:advanceField|advanceRecord|markRecordAbsent|planIntentDiff)\s*\(/,
    );
  });

  it("T6 main.ts obtains the one shared shadow and forwards the receipt", () => {
    expect(CODE, "the shadow must come from CanvasSync (AC1)").toMatch(/getSurfaceShadow\s*\(/);
    expect(CODE).toMatch(/buildApplyReceipt\s*\(/);
    expect(CODE).toMatch(/advanceFromReceipt\s*\(/);
    expect(CODE, "the surface-state seam WP4 left at its default must be wired").toMatch(
      /setSurfaceStateProvider\s*\(/,
    );
  });
});
