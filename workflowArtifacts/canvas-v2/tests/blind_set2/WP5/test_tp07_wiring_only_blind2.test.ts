// WP5 / AC4 — `main.ts` gains wiring only.
//
// Angle: DEGRADED surfaces. Every pass here runs against a canvas that is only
// partly usable — no `setData`, a node without a mutator, a view that vanishes
// mid-session — because that is where "just wire it up" quietly turns into a
// conditional over canvas state. The wiring sequence below never inspects an
// outcome or a field; the modules decide, and the four passes must still be right.
//
// Secondary oracle: a narrow source scan of `main.ts`.

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

const PATH = "degraded/view.canvas";

const NODES = [
  { id: "d1", type: "text", x: 0, y: 0, width: 70, height: 70, text: "d1", color: "1" },
  { id: "d2", type: "text", x: 90, y: 0, width: 70, height: 70, text: "d2", color: "2" },
];

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

function snapshot(): CanvasRecords {
  return { nodes: NODES.map((record) => ({ ...record })), edges: [] };
}

const SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WP5 AC4 (blind2) — the wiring is honest about a degraded view", () => {
  it("a canvas without setData reports the plan but records no receipt", () => {
    const double = new CanvasDouble({ nodes: NODES.map((record) => ({ ...record })) });
    (double.canvas as unknown as Record<string, unknown>).setData = undefined;
    const adapter = createCanvasAdapter(double.view);
    const shadow = createSurfaceShadow();
    const store = createSurfaceStateStore(() => true);

    expect(wire({ path: PATH, shadow, store, adapter, data: snapshot(), initial: true })).toBe(
      "structural",
    );
    expect(shadowToCanvasRecords(shadow, PATH)).toBeNull();
    expect(store.stateFor(PATH).handedToView.node.size).toBe(0);

    // …and because nothing was recorded, the next pass is still structural: the
    // reconciler keeps retrying instead of believing a reload that never happened.
    expect(wire({ path: PATH, shadow, store, adapter, data: snapshot() })).toBe("structural");
  });

  it("one card without a mutator does not cost the other card its advance", () => {
    const double = new CanvasDouble({ nodes: NODES.map((record) => ({ ...record })) });
    const adapter = createCanvasAdapter(double.view);
    const shadow = createSurfaceShadow();
    const store = createSurfaceStateStore(() => true);

    wire({ path: PATH, shadow, store, adapter, data: snapshot(), initial: true });
    (double.getNode("d1") as unknown as Record<string, unknown>).moveAndResize = undefined;

    const moved: CanvasRecords = {
      nodes: [
        { ...NODES[0], x: 25 },
        { ...NODES[1], x: 115 },
      ],
      edges: [],
    };
    expect(wire({ path: PATH, shadow, store, adapter, data: moved })).toBe("geometry");
    expect(getField(shadow, PATH, "node", "d1", "x")).toBe(0);
    expect(getField(shadow, PATH, "node", "d2", "x")).toBe(115);
    expect(store.stateFor(PATH).handedToView.node.has("d1")).toBe(false);
    expect(store.stateFor(PATH).handedToView.node.has("d2")).toBe(true);
  });

  it("a view that disappears defers and changes nothing", () => {
    const shadow = createSurfaceShadow();
    const store = createSurfaceStateStore(() => false);
    const gone = createCanvasAdapter({ canvas: {} });

    expect(wire({ path: PATH, shadow, store, adapter: gone, data: snapshot(), initial: true })).toBe(
      "deferred",
    );
    expect(getRecordState(shadow, PATH, "node", "d1")).toBe("unknown");
    expect(store.stateFor(PATH).viewOpen).toBe(false);
  });

  it("`initial` re-hands everything even on an already-settled surface", () => {
    const double = new CanvasDouble({ nodes: NODES.map((record) => ({ ...record })) });
    const adapter = createCanvasAdapter(double.view);
    const shadow = createSurfaceShadow();
    const store = createSurfaceStateStore(() => true);

    wire({ path: PATH, shadow, store, adapter, data: snapshot(), initial: true });
    expect(wire({ path: PATH, shadow, store, adapter, data: snapshot() })).toBe("noop");

    // The view was closed and reopened: the hand-over is gone, `initial` is forced.
    store.clearPath(PATH);
    expect(store.stateFor(PATH).handedToView.node.size).toBe(0);
    expect(wire({ path: PATH, shadow, store, adapter, data: snapshot(), initial: true })).toBe(
      "structural",
    );
    expect([...store.stateFor(PATH).handedToView.node].sort()).toEqual(["d1", "d2"]);
  });

  it("main.ts contains no canvas decision over the shadow", () => {
    expect(CODE).not.toMatch(/\bcanvasApplied\b/);
    expect(CODE).not.toMatch(/\bgetField\s*\(/);
    expect(CODE).not.toMatch(/\bgetRecordFields\s*\(/);
    expect(CODE).not.toMatch(/\bplanIntentDiff\s*\(/);
  });

  it("main.ts wires the surface-state seam WP4 left at its default", () => {
    expect(CODE).toMatch(/setSurfaceStateProvider\s*\(/);
    expect(CODE).toMatch(/buildApplyReceipt\s*\(/);
    expect(CODE).toMatch(/shadowToCanvasRecords\s*\(/);
  });
});
