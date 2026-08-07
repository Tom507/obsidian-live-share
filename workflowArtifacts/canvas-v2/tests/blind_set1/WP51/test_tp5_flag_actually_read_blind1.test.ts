// WP51 AC3 — blind set 1 (the flag is genuinely read).
//
// Angle: the visible test measures the difference at the view-apply callback.
// This one refuses to look at the callback at all. It measures the DIVERGENCE
// BETWEEN THE TWO PROJECTIONS an instance owns — the shared doc and the rendered
// view — because that divergence is the thing WP7 has to demonstrate and it
// cannot be produced by a value sitting in a map.
//
// An implementation that stores the flag and consults nothing keeps the two
// projections equal for every input below, so every case here is red against it.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  RUNTIME_FLAG_READERS,
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T123000Z-b1-proj.canvas";

function instance() {
  const doc = new Y.Doc();
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => docProjection(doc),
    getCanvasDocHandle: () => ({ doc }),
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "proj", roomId: "canvas-v2-t3", role: "host" },
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );

  let view: RemoteData = { nodes: [], edges: [] };
  sync.setOnRemoteCanvasUpdate((_p, data) => {
    view = data;
  });

  /** A peer writes its own record and the plugin is told. */
  const peerWrite = (id: string, x: number) => {
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      let m = nodes.get(id);
      if (!m) {
        m = new Y.Map<unknown>();
        nodes.set(id, m);
      }
      m.set("x", x);
    });
    sync.onRemoteCanvasUpdate?.(PATH, docProjection(doc));
  };

  return { host, peerWrite, docNow: () => docProjection(doc), viewNow: () => view };
}

function docProjection(doc: Y.Doc): RemoteData {
  return {
    nodes: [...doc.getMap<Y.Map<unknown>>("nodes").entries()]
      .map(([id, m]) => ({ id, ...Object.fromEntries(m.entries()) }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    edges: [],
  };
}

const set = (host: ReturnType<typeof instance>["host"], value: string) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

describe("WP51 AC3 (blind1) — the flag is measured as doc/view divergence", () => {
  it("without the flag the two projections agree after every write", () => {
    const inst = instance();
    inst.peerWrite("p1", 1);
    expect(inst.viewNow()).toEqual(inst.docNow());
    inst.peerWrite("p2", 2);
    expect(inst.viewNow()).toEqual(inst.docNow());
    inst.peerWrite("p3", 3);
    expect(inst.viewNow()).toEqual(inst.docNow());
  });

  it("with the flag set they diverge — and only because of the flag", async () => {
    const inst = instance();
    inst.peerWrite("p1", 1);
    expect(inst.viewNow()).toEqual(inst.docNow());

    expect((await set(inst.host, "delayed")).status).toBe(200);
    inst.peerWrite("p2", 2);
    inst.peerWrite("p3", 3);

    expect(inst.docNow().nodes.map((n) => n.id)).toEqual(["p1", "p2", "p3"]);
    expect(inst.viewNow().nodes.map((n) => n.id)).toEqual(["p1"]);
    expect(inst.viewNow()).not.toEqual(inst.docNow());
  });

  it("clearing the flag restores agreement without any further peer traffic", async () => {
    const inst = instance();
    await set(inst.host, "delayed");
    inst.peerWrite("p1", 1);
    inst.peerWrite("p2", 2);
    expect(inst.viewNow()).not.toEqual(inst.docNow());

    await set(inst.host, "live");
    expect(inst.viewNow()).toEqual(inst.docNow());
  });

  it("`unavailable` diverges too, and does NOT reconverge on release", async () => {
    const inst = instance();
    inst.peerWrite("p1", 1);
    await set(inst.host, "unavailable");
    inst.peerWrite("p2", 2);
    await set(inst.host, "live");
    expect(inst.viewNow()).not.toEqual(inst.docNow());
    // …until the next delta arrives.
    inst.peerWrite("p3", 3);
    expect(inst.viewNow()).toEqual(inst.docNow());
  });

  it("two instances, one flagged: only the flagged one diverges", async () => {
    const flagged = instance();
    const plain = instance();
    await set(flagged.host, "delayed");
    for (const inst of [flagged, plain]) {
      inst.peerWrite("p1", 1);
      inst.peerWrite("p2", 2);
    }
    expect(flagged.viewNow()).not.toEqual(flagged.docNow());
    expect(plain.viewNow()).toEqual(plain.docNow());
  });

  it("the registry names one flag and this file exercises it", () => {
    expect(Object.keys(RUNTIME_FLAG_READERS)).toEqual([STALE_VIEW_FLAG]);
  });
});
