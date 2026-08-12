import { describe, expect, it, vi } from "vitest";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../testing/e2e-control";

const PATH = "_liveshare-test/SyncTesting.canvas";

interface LeafReading {
  leafId: string;
  active: boolean;
  model: { count: number };
  paint: {
    label: {
      divergentNodes: string[];
      unpaintedNodes: string[];
      nodesDetail: Record<string, { styleVerdict: string }>;
    };
  };
}

interface LeafCensus {
  available: boolean;
  count: number;
  duplicate: boolean;
  leaves: LeafReading[];
}

interface DiagResult {
  diagProto: number;
  leafCensus: LeafCensus;
  armLeafCensus?: LeafCensus;
}

function canvasLeaf(path: string, modelX: number, paintedX: number) {
  const style = {
    transform: `translate(${paintedX}px, 20px)`,
    width: "100px",
    height: "50px",
  };
  const nodeEl = Object.freeze({
    isConnected: true,
    className: "canvas-node",
    style,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => style,
      },
    },
  });
  const canvas = Object.freeze({
    nodes: new Map([["n1", { id: "n1", x: modelX, y: 20, width: 100, height: 50, nodeEl }]]),
    x: 0,
    y: 0,
    zoom: 0,
  });
  return Object.freeze({
    isDeferred: false,
    view: Object.freeze({ file: { path }, canvas }),
  });
}

describe("canvas.diag leaf census", () => {
  it("keeps duplicate same-path leaves distinct after the registry-tracked leaf closes", async () => {
    const original = canvasLeaf("_liveshare-test\\SyncTesting.canvas", 45, 45);
    const survivor = canvasLeaf(PATH, 45, 0);
    let privateCanvasRead = false;
    const privateView = { file: { path: "Private.canvas" } } as {
      file: { path: string };
      canvas?: unknown;
    };
    Object.defineProperty(privateView, "canvas", {
      get() {
        privateCanvasRead = true;
        throw new Error("a non-authorized Canvas surface was inspected");
      },
    });
    const privateLeaf = Object.freeze({ view: privateView });
    let leaves: unknown[] = [original, survivor, privateLeaf];

    const destroyedRegistryAdapter = {
      isAvailable: () => true,
      getLiveNodeIds: () => new Set<string>(),
      getNodeGeometry: () => null,
      getNodeEl: () => null,
      getOverlayHost: () => null,
    };
    const workspace = {
      activeLeaf: survivor,
      getLeavesOfType: vi.fn((type: string) => {
        expect(type).toBe("canvas");
        return leaves;
      }),
    };
    const plugin: E2EPluginLike = {
      settings: { clientId: "cid", roomId: "room", role: "guest" },
      muxConnected: true,
      controlConnected: true,
      app: { workspace },
      canvasDiagTargets: () => [{ path: PATH, adapter: destroyedRegistryAdapter, presence: null }],
    };
    const counters: BindingCounters = {
      applyRemote: 0,
      captureLocal: 0,
      rePush: 0,
      originUpdates: 0,
    };
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    expect(host.canvasDiag).toBeTypeOf("function");

    const census = (await host.canvasDiag!({ op: "census", path: PATH })) as DiagResult;
    expect(census.diagProto).toBe(4);
    expect(census.leafCensus).toMatchObject({ available: true, count: 2, duplicate: true });
    expect(census.leafCensus.leaves.map((leaf) => leaf.model.count)).toEqual([1, 1]);
    expect(census.leafCensus.leaves[0].paint.label.divergentNodes).toEqual([]);
    expect(census.leafCensus.leaves[1].paint.label.divergentNodes).toEqual(["n1"]);
    expect(census.leafCensus.leaves[1].paint.label.nodesDetail.n1.styleVerdict).toBe("DIVERGENT");
    expect(census.leafCensus.leaves.map((leaf) => leaf.leafId)).toHaveLength(2);
    expect(new Set(census.leafCensus.leaves.map((leaf) => leaf.leafId)).size).toBe(2);
    const survivorId = census.leafCensus.leaves[1].leafId;

    const armed = (await host.canvasDiag!({ op: "arm", path: PATH })) as DiagResult;
    expect(armed.leafCensus.leaves[1].leafId).toBe(survivorId);

    leaves = [survivor, privateLeaf];
    const dumped = (await host.canvasDiag!({ op: "dump", path: PATH })) as DiagResult;
    expect(dumped.armLeafCensus).toMatchObject({ count: 2, duplicate: true });
    expect(dumped.leafCensus).toMatchObject({ available: true, count: 1, duplicate: false });
    expect(dumped.leafCensus.leaves[0]).toMatchObject({ leafId: survivorId, active: true });
    expect(dumped.leafCensus.leaves[0].paint.label.divergentNodes).toEqual(["n1"]);
    expect(privateCanvasRead).toBe(false);
  });
});
