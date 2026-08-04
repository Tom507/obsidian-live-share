// WP51 / C51 AC1 (+ AC4) — entering the stale-view state stops the OPEN CANVAS
// VIEW being advanced by incoming remote changes, while the shared doc keeps
// advancing exactly as before.
//
// The seam is the one production hook `main.ts:846` already installs on
// `CanvasSync.setOnRemoteCanvasUpdate` — the same boundary WP6's "view apply
// artificially delayed" scenario gates. Nothing in `plugin/src/canvas/**` is
// touched: the gate is installed FROM the testing module, over the handler the
// plugin itself registered.
//
// Oracle is state, never a log line: what the downstream view-apply handler
// received, and what the Y.Doc holds.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T090000Z-1-a.canvas";

/**
 * Double for the production `CanvasSync`. It owns the handler `main.ts` installs
 * and can deliver a remote delta the way the relay does. `onRemoteCanvasUpdate`
 * is a plain runtime property (TypeScript `private` is compile-time only), which
 * is how the gate adopts the handler already in place.
 */
function fakeCanvasSync(doc: Y.Doc) {
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => snapshotOf(doc),
    getCanvasDocHandle: () => ({ doc }),
    /** The relay integrated a delta and told the plugin about it. */
    deliver(path: string, data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(path, data);
    },
  };
  return sync;
}

/** Flat snapshot of the shared doc, in `canvas.state` shape. */
function snapshotOf(doc: Y.Doc): RemoteData {
  const flat = (name: string) =>
    [...doc.getMap<Y.Map<unknown>>(name).entries()].map(([id, m]) => ({
      id,
      ...Object.fromEntries(m.entries()),
    }));
  return { nodes: flat("nodes"), edges: flat("edges") };
}

function harness() {
  const doc = new Y.Doc();
  const sync = fakeCanvasSync(doc);
  const plugin = {
    settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
  } as unknown as E2EPluginLike;

  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });

  // `main.ts:846` — the production wiring, installed BEFORE any control command,
  // exactly as it is in the real lifecycle (`canvasSync` does not exist yet when
  // `maybeStartE2EControlServer` runs).
  const viewApply = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(viewApply);

  return { doc, sync, plugin, host, viewApply };
}

/** Write a node into the shared doc, the way an integrated remote delta does. */
function seedRemote(doc: Y.Doc, id: string, fields: Record<string, unknown>): RemoteData {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    let m = nodes.get(id);
    if (!m) {
      m = new Y.Map<unknown>();
      nodes.set(id, m);
    }
    for (const [k, v] of Object.entries(fields)) m.set(k, v);
  });
  return snapshotOf(doc);
}

const enterDelayed = (host: ReturnType<typeof harness>["host"]) =>
  routeCommand(host, {
    cmd: "canvas.setFlag",
    args: { name: STALE_VIEW_FLAG, value: "delayed" },
  });

describe("WP51 AC1 — the stale-view state holds the view back", () => {
  it("a remote change reaches the view while live", async () => {
    const { doc, sync, viewApply } = harness();
    const data = seedRemote(doc, "n1", { x: 10, y: 20, width: 100, height: 60 });
    sync.deliver(PATH, data);

    expect(viewApply).toHaveBeenCalledTimes(1);
    expect(viewApply.mock.calls[0][0]).toBe(PATH);
    expect(viewApply.mock.calls[0][1].nodes).toEqual([
      { id: "n1", x: 10, y: 20, width: 100, height: 60 },
    ]);
  });

  it("once stale, the same change no longer reaches the view", async () => {
    const { doc, sync, host, viewApply } = harness();
    sync.deliver(PATH, seedRemote(doc, "n1", { x: 10, y: 20 }));
    expect(viewApply).toHaveBeenCalledTimes(1);

    const entered = await enterDelayed(host);
    expect(entered).toEqual({ status: 200, body: { ok: true, result: { set: true } } });

    sync.deliver(PATH, seedRemote(doc, "n1", { x: 500, y: 20 }));
    sync.deliver(PATH, seedRemote(doc, "n2", { x: 7, y: 8 }));

    // The view saw the pre-stale delta and nothing after it.
    expect(viewApply).toHaveBeenCalledTimes(1);
    expect(viewApply.mock.calls[0][1].nodes).toEqual([{ id: "n1", x: 10, y: 20 }]);
  });

  it("the SHARED DOC keeps advancing while the view does not — that is the staleness", async () => {
    const { doc, sync, host, viewApply } = harness();
    await enterDelayed(host);

    sync.deliver(PATH, seedRemote(doc, "n1", { x: 500, y: 20 }));

    expect(viewApply).not.toHaveBeenCalled();
    // `canvas.state` is the doc, not the view (D17) — it must still report the
    // remote value, otherwise the gate has broken sync instead of the view.
    const state = await routeCommand(host, { cmd: "canvas.state", args: { path: PATH } });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      ok: true,
      result: { nodes: [{ id: "n1", x: 500, y: 20 }], edges: [] },
    });
  });

  it("entering twice is idempotent and never double-forwards", async () => {
    const { doc, sync, host, viewApply } = harness();
    await enterDelayed(host);
    await enterDelayed(host);
    sync.deliver(PATH, seedRemote(doc, "n1", { x: 1 }));
    expect(viewApply).not.toHaveBeenCalled();

    await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "live" },
    });
    sync.deliver(PATH, seedRemote(doc, "n1", { x: 2 }));
    // Exactly one delivery per delta: a gate installed twice would forward twice.
    expect(viewApply).toHaveBeenCalledTimes(2); // 1 replayed + 1 live
  });

  it("the gate refuses to install when the plugin has installed no view-apply handler", async () => {
    const doc = new Y.Doc();
    const sync = fakeCanvasSync(doc); // `main.ts` wiring deliberately NOT done
    const plugin = {
      settings: { clientId: "e2e-a", roomId: "r", role: "host" },
      canvasSync: sync,
    } as unknown as E2EPluginLike;
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });

    // Swallowing updates into a gate with nothing behind it would look identical
    // to a working stale state and would silently break the run. It must refuse.
    const out = await enterDelayed(host);
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    expect(sync.onRemoteCanvasUpdate).toBeNull();

    // Positive control: once the plugin HAS wired its handler, the same command
    // on the same host is accepted. Without this the refusal above would also
    // hold on a surface that does not know the flag at all.
    sync.setOnRemoteCanvasUpdate(vi.fn<RemoteHandler>());
    expect((await enterDelayed(host)).status).toBe(200);
  });
});
