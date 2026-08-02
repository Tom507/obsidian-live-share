// WP22 AC3 blind2 — the rig aimed at a doc a real binding is ALSO attached to.
//
// The visible test and blind1 both drive the control server against a bare doc.
// That is not the configuration AC3 is about: on a live instance the control
// channel writes into the same doc a `CanvasBinding` observes, and the binding
// reacts by projecting the result into the model. If the rig's mirror still swept
// absent keys, the damage would not stay in the doc — it would be handed straight
// to the canvas view through `applyRemote`, which is the failure the E2E rig
// exists to catch and would instead have caused.
//
// So the oracle here is the MODEL on the other side of the binding, plus a
// `bindingCounters` read proving the rig's edit really did travel through the
// binding's observer rather than being invisible to it.
//
// Second angle: the rig's two write paths are compared against each other —
// `canvas.simulateEdit` with a partial record versus `removeNodes`. One must be
// non-destructive and the other destructive. A mirror "fixed" by making the whole
// command a no-op would pass a one-sided test and fails this one.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
  setCanvasBindingInstrument,
} from "../../../canvas/canvas-binding";
import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
} from "../../../testing/e2e-control";

const PATH = "Ops/Runbook.canvas";

const STEP: CanvasRecord = {
  id: "step-1",
  type: "text",
  text: "drain the queue",
  x: 0,
  y: 0,
  width: 320,
  height: 160,
  color: "4",
};
const FLOW: CanvasRecord = {
  id: "flow",
  fromNode: "step-1",
  fromSide: "right",
  toNode: "step-2",
  toSide: "left",
  label: "then",
};

class Bridge implements CanvasModelBridge {
  readonly nodes = new Map<string, CanvasRecord>();
  readonly edges = new Map<string, CanvasRecord>();
  private readonly subscribers = new Set<(change: LocalChange) => void>();

  getNodeIds(): Iterable<string> {
    return [...this.nodes.keys()];
  }
  getEdgeIds(): Iterable<string> {
    return [...this.edges.keys()];
  }
  getNode(id: string): CanvasRecord | null {
    const r = this.nodes.get(id);
    return r ? { ...r } : null;
  }
  getEdge(id: string): CanvasRecord | null {
    const r = this.edges.get(id);
    return r ? { ...r } : null;
  }
  applyNodeUpsert(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
  }
  applyNodeRemove(id: string): void {
    this.nodes.delete(id);
  }
  applyEdgeUpsert(id: string, record: CanvasRecord): void {
    this.edges.set(id, { ...record });
  }
  applyEdgeRemove(id: string): void {
    this.edges.delete(id);
  }
  onLocalChange(cb: (change: LocalChange) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }
}

function rig(doc: Y.Doc) {
  const subscribed = new Set<string>();
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  const plugin: E2EPluginLike = {
    settings: { clientId: "ops", roomId: "ops-room", role: "host" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: {
      subscribe: async (path: string) => {
        subscribed.add(path);
      },
      isSubscribed: (path: string) => subscribed.has(path),
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: (path: string) => (subscribed.has(path) ? { doc } : null),
    },
  };
  return { host: buildPluginHost(plugin, { counters, bump: () => {} }), counters };
}

describe("WP22 AC3 blind2 — a rig edit reaches the model whole, or not at all", () => {
  it("a partial rig edit is projected to a peer's model as the complete record", async () => {
    const rigDoc = new Y.Doc();
    const { host, counters } = rig(rigDoc);
    await host.canvasOpen(PATH);
    await host.simulateEdit(PATH, { nodes: [STEP], edges: [FLOW] });

    // The peer whose canvas view is bound. It seeds from the full state, so
    // everything after this point arrives as a genuine remote delta and really
    // does travel through the binding's observer.
    const viewDoc = new Y.Doc();
    Y.applyUpdate(viewDoc, Y.encodeStateAsUpdate(rigDoc));
    const model = new Bridge();
    setCanvasBindingInstrument((counter) => {
      if (counter === "applyRemote") counters.applyRemote++;
    });
    const binding = new CanvasBinding(viewDoc, model);
    const seedApplies = counters.applyRemote;

    await host.simulateEdit(PATH, { edges: [{ id: "flow", label: "afterwards" }] });
    Y.applyUpdate(viewDoc, Y.encodeStateAsUpdate(rigDoc, Y.encodeStateVector(viewDoc)));

    expect(
      counters.applyRemote,
      "the rig's write never reached the binding's observer — the test proves nothing",
    ).toBeGreaterThan(seedApplies);
    expect(
      model.getEdge("flow"),
      "the canvas model was handed a disconnected edge produced by the rig",
    ).toEqual({ ...FLOW, label: "afterwards" });
    expect(model.getNode("step-1"), "the untouched node changed").toEqual(STEP);

    setCanvasBindingInstrument(null);
    binding.destroy();
  });

  it("omission preserves and `removeNodes` deletes — the rig kept exactly one of the two", async () => {
    const doc = new Y.Doc();
    const { host } = rig(doc);
    await host.canvasOpen(PATH);
    await host.simulateEdit(PATH, { nodes: [STEP], edges: [FLOW] });

    await host.simulateEdit(PATH, { nodes: [{ id: "step-1", color: "6" }] });
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").get("step-1")?.toJSON(),
      "omission is still destructive on the control channel",
    ).toEqual({ ...STEP, color: "6" });

    await host.simulateEdit(PATH, { removeNodes: ["step-1"] });
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("step-1"),
      "the explicit rig removal stopped working — the change went beyond AC3",
    ).toBe(false);
    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("flow")?.toJSON(),
      "removing a node took an edge's fields with it",
    ).toEqual(FLOW);
  });

  it("re-sending an identical full record through the rig changes nothing", async () => {
    const doc = new Y.Doc();
    const { host } = rig(doc);
    await host.canvasOpen(PATH);
    await host.simulateEdit(PATH, { nodes: [STEP] });

    let updates = 0;
    doc.on("update", () => {
      updates++;
    });
    await host.simulateEdit(PATH, { nodes: [STEP] });

    expect(updates, "the rig's mirror stopped being minimal-diff").toBe(0);
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("step-1")?.toJSON()).toEqual(STEP);
  });
});
