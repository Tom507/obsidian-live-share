// WP22 AC3 blind1 — the rig mirror judged from the WIRE, and by equivalence with
// the production seam rather than by its own fixture.
//
// The visible test drives `host.simulateEdit(...)` and `routeCommand(...)`. This
// one goes one layer further out: `parseAndRoute` with a raw JSON body, which is
// what an actual E2E client sends. A mirror repaired at the host method but not
// at the shared helper would still pass the visible test's router call and fail
// here only if the helper is the thing that changed — which is the point.
//
// The stronger oracle is EQUIVALENCE. AC3 says the mirror is changed to "the same
// semantics" as the binding, so the test drives BOTH with an identical sequence
// of partial edits over identical starting state and requires the two resulting
// docs to be byte-equal in content. That cannot be satisfied by patching one side
// only, and it does not depend on the tester having guessed the right fixture.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";
import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
} from "../../../testing/e2e-control";

const PATH = "Atlas/Regions.canvas";

const SEED_NODES: CanvasRecord[] = [
  { id: "north", type: "group", x: 0, y: 0, width: 800, height: 600, label: "North" },
  { id: "south", type: "text", text: "warm", x: 0, y: 900, width: 300, height: 120, color: "1" },
];
const SEED_EDGES: CanvasRecord[] = [
  { id: "meridian", fromNode: "north", fromSide: "bottom", toNode: "south", toSide: "top" },
];

/** The partial edits both sides receive, in order. */
const PARTIALS: Array<{ kind: "node" | "edge"; id: string; record: CanvasRecord }> = [
  { kind: "edge", id: "meridian", record: { id: "meridian" } },
  { kind: "node", id: "north", record: { id: "north", label: "Northern Reach" } },
  { kind: "node", id: "south", record: { x: 40 } },
  { kind: "edge", id: "meridian", record: { color: "4" } },
];

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

function seed(doc: Y.Doc): void {
  doc.transact(() => {
    for (const [name, records] of [
      ["nodes", SEED_NODES],
      ["edges", SEED_EDGES],
    ] as const) {
      const map = doc.getMap<Y.Map<unknown>>(name);
      for (const record of records) {
        const ymap = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(record)) ymap.set(k, v);
        map.set(String(record.id), ymap);
      }
    }
  });
}

function contentOf(doc: Y.Doc): unknown {
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes").toJSON(),
    edges: doc.getMap<Y.Map<unknown>>("edges").toJSON(),
  };
}

function rigHost(doc: Y.Doc) {
  const subscribed = new Set<string>();
  const plugin: E2EPluginLike = {
    settings: { clientId: "atlas", roomId: "atlas-room", role: "guest" },
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
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  return buildPluginHost(plugin, { counters, bump: () => {} });
}

describe("WP22 AC3 blind1 — the control channel writes exactly what the binding writes", () => {
  it("a raw JSON partial edit over the wire keeps the record whole", async () => {
    const doc = new Y.Doc();
    seed(doc);
    const host = rigHost(doc);
    await parseAndRoute(host, JSON.stringify({ cmd: "canvas.open", args: { path: PATH } }));

    const response = await parseAndRoute(
      host,
      JSON.stringify({
        cmd: "canvas.simulateEdit",
        args: { path: PATH, change: { edges: [{ id: "meridian" }] } },
      }),
    );

    expect(response.status, "the raw command was refused").toBe(200);
    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("meridian")?.toJSON(),
      "a wire-level partial edit disconnected the edge — the rig can still manufacture R1",
    ).toEqual(SEED_EDGES[0]);
  });

  it("the rig and the binding converge on identical content from identical partial edits", async () => {
    const viaRig = new Y.Doc();
    const viaBinding = new Y.Doc();
    seed(viaRig);
    seed(viaBinding);

    const host = rigHost(viaRig);
    await parseAndRoute(host, JSON.stringify({ cmd: "canvas.open", args: { path: PATH } }));
    const binding = new CanvasBinding(viaBinding, new Bridge());

    for (const step of PARTIALS) {
      await host.simulateEdit(PATH, {
        [step.kind === "node" ? "nodes" : "edges"]: [{ id: step.id, ...step.record }],
      });
      binding.captureLocal({ kind: step.kind, id: step.id, record: step.record });
    }

    expect(
      contentOf(viaRig),
      "the rig and the production seam disagree — one of the two still deletes by omission",
    ).toEqual(contentOf(viaBinding));
    // …and the agreed-on content is the non-destructive one, not two matching losses.
    expect(
      contentOf(viaRig),
      "the two sides agree, but they agree on a record that lost its keys",
    ).toEqual({
      nodes: {
        north: { ...SEED_NODES[0], label: "Northern Reach" },
        south: { ...SEED_NODES[1], x: 40 },
      },
      edges: { meridian: { ...SEED_EDGES[0], color: "4" } },
    });

    binding.destroy();
  });
});
