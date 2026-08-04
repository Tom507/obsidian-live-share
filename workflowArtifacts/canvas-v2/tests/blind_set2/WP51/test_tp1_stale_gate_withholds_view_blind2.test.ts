// WP51 AC1 — blind set 2.
//
// Angle: three peers, not two. Interleaving classes from three peers upward are
// distinct (charter §5), so the withheld sequence is built from three separate
// authors writing DIFFERENT records — every asserted value therefore has a
// single author and a causal predecessor chain (T3 contract §10).
//
// The oracle is a trajectory fingerprint of the view rather than a call count:
// a gate that withheld the wrong subset, or reordered the catch-up, produces a
// different string even when the number of calls happens to match.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T112233Z-b2-tri.canvas";

function rig() {
  const doc = new Y.Doc();
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => flatten(doc),
    getCanvasDocHandle: () => ({ doc }),
    deliver(data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(PATH, data);
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "orga", roomId: "canvas-v2-t3", role: "host" },
      muxConnected: true,
      controlConnected: true,
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );

  /** The view's own record of everything it was ever asked to render. */
  const trajectory: string[] = [];
  sync.setOnRemoteCanvasUpdate((_p, data) => {
    trajectory.push(data.nodes.map((n) => `${n.id}@${n.x}`).join(","));
  });
  return { doc, sync, host, trajectory };
}

function flatten(doc: Y.Doc): RemoteData {
  const nodes = [...doc.getMap<Y.Map<unknown>>("nodes").entries()]
    .map(([id, m]) => ({ id, ...Object.fromEntries(m.entries()) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { nodes, edges: [] };
}

/** Peer `author` writes its OWN record — never a concurrent same-key write. */
function peerWrites(doc: Y.Doc, author: string, x: number): RemoteData {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    let m = nodes.get(author);
    if (!m) {
      m = new Y.Map<unknown>();
      nodes.set(author, m);
    }
    m.set("x", x);
  });
  return flatten(doc);
}

async function setMode(host: ReturnType<typeof rig>["host"], value: string) {
  const out = await routeCommand(host, {
    cmd: "canvas.setFlag",
    args: { name: STALE_VIEW_FLAG, value },
  });
  // A pinned mode must be accepted. Without this every case below would also
  // hold on a surface that refuses the flag and therefore never gates anything.
  expect(out.status, `mode '${value}' was refused`).toBe(200);
  return out;
}

describe("WP51 AC1 (blind2) — three authors, one held-back view", () => {
  it("live: the view follows every author", () => {
    const { doc, sync, trajectory } = rig();
    sync.deliver(peerWrites(doc, "peerA", 1));
    sync.deliver(peerWrites(doc, "peerB", 2));
    sync.deliver(peerWrites(doc, "peerC", 3));
    expect(trajectory).toEqual(["peerA@1", "peerA@1,peerB@2", "peerA@1,peerB@2,peerC@3"]);
  });

  it("stale: the trajectory stops at the last pre-stale frame", async () => {
    const { doc, sync, host, trajectory } = rig();
    sync.deliver(peerWrites(doc, "peerA", 1));
    await setMode(host, "delayed");
    sync.deliver(peerWrites(doc, "peerB", 2));
    sync.deliver(peerWrites(doc, "peerC", 3));
    expect(trajectory).toEqual(["peerA@1"]);
  });

  it("the doc still holds all three authors while the view holds one", async () => {
    const { doc, sync, host, trajectory } = rig();
    sync.deliver(peerWrites(doc, "peerA", 1));
    await setMode(host, "delayed");
    sync.deliver(peerWrites(doc, "peerB", 2));
    sync.deliver(peerWrites(doc, "peerC", 3));

    const state = await routeCommand(host, { cmd: "canvas.state", args: { path: PATH } });
    expect(state.status).toBe(200);
    if (!state.body.ok) throw new Error("canvas.state failed");
    const result = state.body.result as RemoteData;
    expect(result.nodes.map((n) => n.id)).toEqual(["peerA", "peerB", "peerC"]);
    expect(trajectory.at(-1)).toBe("peerA@1");
  });

  it("catching up replays the frames in arrival order, not merged into one", async () => {
    const { doc, sync, host, trajectory } = rig();
    await setMode(host, "delayed");
    sync.deliver(peerWrites(doc, "peerA", 1));
    sync.deliver(peerWrites(doc, "peerB", 2));
    sync.deliver(peerWrites(doc, "peerC", 3));
    await setMode(host, "live");
    expect(trajectory).toEqual(["peerA@1", "peerA@1,peerB@2", "peerA@1,peerB@2,peerC@3"]);
  });

  it("re-entering after a catch-up starts a fresh withheld run", async () => {
    const { doc, sync, host, trajectory } = rig();
    await setMode(host, "delayed");
    sync.deliver(peerWrites(doc, "peerA", 1));
    await setMode(host, "live");
    expect(trajectory).toHaveLength(1);

    await setMode(host, "delayed");
    sync.deliver(peerWrites(doc, "peerB", 2));
    expect(trajectory).toHaveLength(1); // nothing new reached the view
    await setMode(host, "live");
    expect(trajectory).toEqual(["peerA@1", "peerA@1,peerB@2"]);
  });

  it("`canvas.open` while stale still subscribes — the gate is not a session freeze", async () => {
    const { host } = rig();
    await setMode(host, "delayed");
    const out = await routeCommand(host, { cmd: "canvas.open", args: { path: PATH } });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { opened: true, subscribed: true } } });
  });
});
