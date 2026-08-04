// WP51 / C51 AC1 + AC2, together — the scenario WP7 AC2 must demonstrate, as a
// COMMAND SEQUENCE rather than a manual procedure:
//
//   canvas.open → canvas.setFlag(staleView=delayed) → (peer moves a node)
//   → canvas.save → canvas.state → canvas.setFlag(staleView=live) → canvas.save
//
// The point of the demonstration is that the save carries the STALE view's
// bytes while the shared doc already holds the peer's value — a doc-level
// oracle cannot see the difference (D17), so the file is read back and compared
// byte for byte.
//
// The view here is not a prop: the fake view-apply handler is the only thing
// that advances it, exactly as `reconcileLiveCanvas` is on a real instance. If
// the gate does not really withhold, the view is current and the assertions go
// red.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T102525Z-8-h.canvas";

function snapshotOf(doc: Y.Doc): RemoteData {
  const flat = (name: string) =>
    [...doc.getMap<Y.Map<unknown>>(name).entries()].map(([id, m]) => ({
      id,
      ...Object.fromEntries(m.entries()),
    }));
  return { nodes: flat("nodes"), edges: flat("edges") };
}

/** A peer's edit integrated into the shared doc, then announced to the plugin. */
function peerMoves(doc: Y.Doc, sync: { deliver(d: RemoteData): void }, x: number): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    let m = nodes.get("n1");
    if (!m) {
      m = new Y.Map<unknown>();
      nodes.set("n1", m);
    }
    m.set("x", x);
    m.set("y", 0);
  });
  sync.deliver(snapshotOf(doc));
}

function harness() {
  const doc = new Y.Doc();
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => snapshotOf(doc),
    getCanvasDocHandle: () => ({ doc }),
    deliver(data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(PATH, data);
    },
  };

  // The LIVE canvas view. Only the view-apply handler moves it.
  let view: RemoteData = { nodes: [], edges: [] };
  const files = new Map<string, string>([[PATH, '{"nodes":[],"edges":[]}']]);

  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      const bytes = JSON.stringify(view);
      files.set(PATH, bytes); // Obsidian writes what the VIEW holds
      return bytes;
    },
  };

  const plugin = {
    settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
    app: {
      vault: {
        adapter: {
          exists: async (p: string) => files.has(p),
          read: async (p: string) => files.get(p) ?? "",
        },
      },
    },
    canvasSaveChannel: (p: string) => (p === PATH ? channel : null),
  } as unknown as E2EPluginLike;

  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });

  // `main.ts:846` — reconcile applies the remote data to the open view.
  sync.setOnRemoteCanvasUpdate((_path, data) => {
    view = { nodes: data.nodes.map((n) => ({ ...n })), edges: [...data.edges] };
  });

  return { doc, sync, host, files, viewNow: () => view };
}

const setMode = (host: ReturnType<typeof harness>["host"], value: string) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

async function saveAndRead(host: ReturnType<typeof harness>["host"]) {
  const out = await routeCommand(host, { cmd: "canvas.save", args: { path: PATH } });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(out.body.error);
  return out.body.result as {
    saved: boolean;
    sha256Before: string;
    sha256After: string;
    size: number;
    byInstance: boolean;
  };
}

describe("WP51 — an Obsidian save on a deliberately stale view, as a command sequence", () => {
  it("the save carries the stale view's bytes while the doc already holds the peer's value", async () => {
    const { doc, sync, host, files, viewNow } = harness();

    peerMoves(doc, sync, 10); // the view catches up while live
    expect(viewNow().nodes).toEqual([{ id: "n1", x: 10, y: 0 }]);

    await setMode(host, "delayed");
    peerMoves(doc, sync, 500); // withheld — the view stays where it was

    expect(viewNow().nodes).toEqual([{ id: "n1", x: 10, y: 0 }]);
    const result = await saveAndRead(host);
    expect(result.byInstance).toBe(true);

    // The file is the stale view, not the doc.
    expect(JSON.parse(files.get(PATH) as string).nodes).toEqual([{ id: "n1", x: 10, y: 0 }]);

    const state = await routeCommand(host, { cmd: "canvas.state", args: { path: PATH } });
    expect(state.body).toEqual({
      ok: true,
      result: { nodes: [{ id: "n1", x: 500, y: 0 }], edges: [] },
    });
  });

  it("a doc-level oracle would have called that run converged — the file says otherwise", async () => {
    const { doc, sync, host, files } = harness();
    peerMoves(doc, sync, 10);
    await setMode(host, "delayed");
    peerMoves(doc, sync, 500);
    await saveAndRead(host);

    const docNodes = snapshotOf(doc).nodes;
    const fileNodes = JSON.parse(files.get(PATH) as string).nodes;
    expect(docNodes).toEqual([{ id: "n1", x: 500, y: 0 }]);
    expect(fileNodes).not.toEqual(docNodes); // D17, made reproducible on demand
  });

  it("leaving the state catches the view up, and the next save agrees with the doc", async () => {
    const { doc, sync, host, files, viewNow } = harness();
    peerMoves(doc, sync, 10);
    await setMode(host, "delayed");
    peerMoves(doc, sync, 500);
    await saveAndRead(host);

    await setMode(host, "live");
    expect(viewNow().nodes).toEqual([{ id: "n1", x: 500, y: 0 }]);

    const second = await saveAndRead(host);
    expect(second.byInstance).toBe(true);
    expect(second.sha256After).not.toBe(second.sha256Before);
    expect(JSON.parse(files.get(PATH) as string).nodes).toEqual(snapshotOf(doc).nodes);
  });

  it("the whole sequence writes the file exactly twice, both times through the instance", async () => {
    const { doc, sync, host, files } = harness();
    const seen: string[] = [];
    const record = () => seen.push(files.get(PATH) as string);

    peerMoves(doc, sync, 10);
    record();
    await setMode(host, "delayed");
    peerMoves(doc, sync, 500);
    const first = await saveAndRead(host);
    record();
    await setMode(host, "live");
    const second = await saveAndRead(host);
    record();

    expect(first.byInstance).toBe(true);
    expect(second.byInstance).toBe(true);
    expect(seen[0]).toBe('{"nodes":[],"edges":[]}'); // untouched before the first save
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[1]);
  });

  it("`unavailable` produces a stale save that no replay ever repairs", async () => {
    const { doc, sync, host, files } = harness();
    peerMoves(doc, sync, 10);
    await setMode(host, "unavailable");
    peerMoves(doc, sync, 500);
    await saveAndRead(host);
    await setMode(host, "live");

    // Nothing was replayed, so the view — and therefore the file — is still stale.
    expect(JSON.parse(files.get(PATH) as string).nodes).toEqual([{ id: "n1", x: 10, y: 0 }]);
    expect(snapshotOf(doc).nodes).toEqual([{ id: "n1", x: 500, y: 0 }]);
  });
});
