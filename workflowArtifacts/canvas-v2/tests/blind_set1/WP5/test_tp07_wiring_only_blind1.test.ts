// WP5 / AC4 — `main.ts` gains wiring only.
//
// Angle: MEMBERSHIP churn. The visible case walks a settling surface; this one
// adds and removes records, which is where V1's whole-snapshot advance and its
// teardown `delete` used to hide. The wiring sequence below is fixed — no
// predicate over shadow content, record fields or apply outcomes — so if any C5
// decision still had to live in `main.ts`, one of these four passes comes out wrong.
//
// Secondary oracle: a narrow source scan of `main.ts`, the repo's established
// pattern for file-level claims.

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
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { type CanvasRecords, planReconcile } from "../../../canvas/reconcile-plan";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "churn/board.canvas";

const START_NODES = [
  { id: "a", type: "text", x: 0, y: 0, width: 60, height: 60, text: "a" },
  { id: "b", type: "text", x: 80, y: 0, width: 60, height: 60, text: "b" },
];
const START_EDGES = [{ id: "ab", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }];

type PassResult = "deferred" | "noop" | "structural" | "geometry";

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
  deps.store.noteHandover(deps.path, summary.handed);
  return plan;
}

function makeRig() {
  const double = new CanvasDouble({
    nodes: START_NODES.map((record) => ({ ...record })),
    edges: START_EDGES.map((record) => ({ ...record })),
  });
  const adapter = createCanvasAdapter(double.view);
  adapter.isBusy();
  return {
    double,
    adapter,
    shadow: createSurfaceShadow(),
    store: createSurfaceStateStore(() => true),
  };
}

function pass(rig: ReturnType<typeof makeRig>, data: CanvasRecords, initial?: boolean): PassResult {
  return wire({
    path: PATH,
    shadow: rig.shadow,
    store: rig.store,
    adapter: rig.adapter,
    data,
    initial,
  });
}

const SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WP5 AC4 (blind1) — the wiring survives membership churn", () => {
  it("a record added to the shared doc reaches the view and the basis", () => {
    const rig = makeRig();
    const seed: CanvasRecords = {
      nodes: START_NODES.map((record) => ({ ...record })),
      edges: START_EDGES.map((record) => ({ ...record })),
    };
    expect(pass(rig, seed, true)).toBe("structural");

    const grown: CanvasRecords = {
      nodes: [
        ...START_NODES.map((record) => ({ ...record })),
        { id: "c", type: "text", x: 160, y: 0, width: 60, height: 60, text: "c" },
      ],
      edges: START_EDGES.map((record) => ({ ...record })),
    };
    expect(pass(rig, grown)).toBe("structural");
    expect(getRecordState(rig.shadow, PATH, "node", "c")).toBe("present");
    expect(rig.store.stateFor(PATH).handedToView.node.has("c")).toBe(true);
    expect(pass(rig, grown)).toBe("noop");
  });

  it("a record removed from the shared doc goes absent and stops the churn", () => {
    const rig = makeRig();
    const seed: CanvasRecords = {
      nodes: START_NODES.map((record) => ({ ...record })),
      edges: START_EDGES.map((record) => ({ ...record })),
    };
    pass(rig, seed, true);

    const shrunk: CanvasRecords = {
      nodes: [{ ...START_NODES[0] }],
      edges: [],
    };
    expect(pass(rig, shrunk)).toBe("structural");
    expect(getRecordState(rig.shadow, PATH, "node", "b")).toBe("absent");
    expect(getRecordState(rig.shadow, PATH, "edge", "ab")).toBe("absent");
    expect(rig.store.stateFor(PATH).handedToView.node.has("b")).toBe(false);

    expect(pass(rig, shrunk), "the surface never settled after a removal").toBe("noop");
  });

  it("an edge-only change is structural and advances the edge space", () => {
    const rig = makeRig();
    const seed: CanvasRecords = {
      nodes: START_NODES.map((record) => ({ ...record })),
      edges: START_EDGES.map((record) => ({ ...record })),
    };
    pass(rig, seed, true);

    const rerouted: CanvasRecords = {
      nodes: START_NODES.map((record) => ({ ...record })),
      edges: [{ ...START_EDGES[0], toSide: "top" }],
    };
    expect(pass(rig, rerouted)).toBe("structural");
    expect(shadowToCanvasRecords(rig.shadow, PATH)?.edges[0]?.toSide).toBe("top");
  });

  it("main.ts keeps no canvas record snapshot of its own", () => {
    expect(CODE).not.toMatch(/\bcanvasApplied\b/);
    expect(CODE).not.toMatch(/new\s+Map<\s*string\s*,\s*CanvasRecords\s*>/);
    expect(CODE).not.toMatch(/\bcloneCanvasRecords\b/);
  });

  it("main.ts obtains the shadow instead of owning one", () => {
    expect(CODE).not.toMatch(/\bcreateSurfaceShadow\s*\(/);
    expect(CODE).toMatch(/getSurfaceShadow\s*\(/);
    expect(CODE).toMatch(/advanceFromReceipt\s*\(/);
  });
});
