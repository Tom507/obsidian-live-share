// WP51 AC1+AC2 — blind set 1 (the scenario end to end).
//
// Angle: node DELETION and edge rerouting rather than a node move. A stale view
// that still holds a node the peers have removed is the case that produces the
// revert WP7 AC2 is watching for: the stale save reintroduces a deleted record
// into the file. The visible test moves a card; this one removes one and
// reroutes an edge, so a gate that happens to work for geometry only is red.
//
// Second angle: the sequence is issued exactly as a driver script would — every
// step through `routeCommand`, no direct host calls, no reliance on ordering
// beyond what the commands themselves establish.
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

const PATH = "_e2e-rig/e2e-scratch-20260803T140000Z-b1-del.canvas";

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
    announce() {
      sync.onRemoteCanvasUpdate?.(PATH, flatten(doc));
    },
  };

  let view: RemoteData = { nodes: [], edges: [] };
  const files = new Map<string, string>([[PATH, '{"nodes":[],"edges":[]}']]);
  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      const bytes = JSON.stringify(view);
      files.set(PATH, bytes);
      return bytes;
    },
  };

  const host = buildPluginHost(
    {
      settings: { clientId: "del", roomId: "canvas-v2-t3", role: "guest" },
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
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  sync.setOnRemoteCanvasUpdate((_p, data) => {
    view = data;
  });
  return { doc, sync, host, files, viewNow: () => view };
}

function flatten(doc: Y.Doc): RemoteData {
  const list = (name: string) =>
    [...doc.getMap<Y.Map<unknown>>(name).entries()]
      .map(([id, m]) => ({ id, ...Object.fromEntries(m.entries()) }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { nodes: list("nodes"), edges: list("edges") };
}

function upsert(doc: Y.Doc, map: "nodes" | "edges", id: string, fields: Record<string, unknown>) {
  doc.transact(() => {
    const target = doc.getMap<Y.Map<unknown>>(map);
    let m = target.get(id);
    if (!m) {
      m = new Y.Map<unknown>();
      target.set(id, m);
    }
    for (const [k, v] of Object.entries(fields)) m.set(k, v);
  });
}

const remove = (doc: Y.Doc, map: "nodes" | "edges", id: string) =>
  doc.transact(() => doc.getMap<Y.Map<unknown>>(map).delete(id));

const setMode = (host: ReturnType<typeof rig>["host"], value: string) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

const saveCmd = (host: ReturnType<typeof rig>["host"]) =>
  routeCommand(host, { cmd: "canvas.save", args: { path: PATH } });

const onDisk = (files: Map<string, string>) => JSON.parse(files.get(PATH) as string) as RemoteData;

describe("WP51 (blind1) — a stale save reintroduces a record the peers deleted", () => {
  it("the deleted node is gone from the doc and still present in the stale file", async () => {
    const { doc, sync, host, files } = rig();
    upsert(doc, "nodes", "keep", { x: 0 });
    upsert(doc, "nodes", "doomed", { x: 100 });
    sync.announce();

    expect((await setMode(host, "delayed")).status).toBe(200);
    remove(doc, "nodes", "doomed");
    sync.announce();

    expect((await saveCmd(host)).status).toBe(200);
    expect(onDisk(files).nodes.map((n) => n.id)).toEqual(["doomed", "keep"]);
    expect(flatten(doc).nodes.map((n) => n.id)).toEqual(["keep"]);
  });

  it("an edge reroute the view never saw is not in the saved bytes", async () => {
    const { doc, sync, host, files } = rig();
    upsert(doc, "edges", "e1", { fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" });
    sync.announce();

    await setMode(host, "delayed");
    upsert(doc, "edges", "e1", { fromSide: "bottom", toSide: "top" });
    sync.announce();

    await saveCmd(host);
    expect(onDisk(files).edges[0].fromSide).toBe("right");
    expect(flatten(doc).edges[0].fromSide).toBe("bottom");
  });

  it("catching up and saving again puts the peers' truth on disk", async () => {
    const { doc, sync, host, files } = rig();
    upsert(doc, "nodes", "keep", { x: 0 });
    upsert(doc, "nodes", "doomed", { x: 100 });
    sync.announce();
    await setMode(host, "delayed");
    remove(doc, "nodes", "doomed");
    sync.announce();
    await saveCmd(host);

    await setMode(host, "live");
    const second = await saveCmd(host);
    expect(second.status).toBe(200);
    expect(onDisk(files).nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(onDisk(files)).toEqual(flatten(doc));
  });

  it("the driver can read the state it is in at every step", async () => {
    const { doc, sync, host } = rig();
    const read = async () => {
      const out = await routeCommand(host, { cmd: "canvas.flags" });
      if (!out.body.ok) throw new Error("canvas.flags failed");
      return out.body.result as { staleView: string; withheld: number };
    };

    expect(await read()).toMatchObject({ staleView: "live", withheld: 0 });
    await setMode(host, "delayed");
    upsert(doc, "nodes", "n1", { x: 1 });
    sync.announce();
    expect(await read()).toMatchObject({ staleView: "delayed", withheld: 1 });
    await saveCmd(host);
    expect(await read()).toMatchObject({ staleView: "delayed", withheld: 1 }); // saving is not leaving
    await setMode(host, "live");
    expect(await read()).toMatchObject({ staleView: "live", withheld: 0 });
  });

  it("the whole demonstration is commands only — no rig write ever appears", async () => {
    const { doc, sync, host, files } = rig();
    const seen: string[] = [];
    upsert(doc, "nodes", "n1", { x: 1 });
    sync.announce();
    seen.push(files.get(PATH) as string);

    await setMode(host, "delayed");
    upsert(doc, "nodes", "n1", { x: 2 });
    sync.announce();
    seen.push(files.get(PATH) as string);
    await saveCmd(host);
    seen.push(files.get(PATH) as string);

    // The file moved exactly once, at the save, and never at a delivery.
    expect(seen[0]).toBe('{"nodes":[],"edges":[]}');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[1]);
  });
});
