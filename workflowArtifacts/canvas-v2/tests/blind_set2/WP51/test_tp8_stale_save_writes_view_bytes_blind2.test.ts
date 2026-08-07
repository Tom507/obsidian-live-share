// WP51 AC1+AC2 — blind set 2 (the scenario end to end).
//
// Angle: two canvases open at once on the same instance, and the save is aimed
// at each of them in turn. The stale state belongs to the INSTANCE, so both
// boards must be stale; the save belongs to a PATH, so each file must carry its
// own board's stale bytes and nothing of the other's.
//
// This is the failure a per-path implementation of the flag would produce
// silently: board A stale, board B live, and a run recorded as a stale-view
// demonstration that only half happened.
import { createHash } from "node:crypto";
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

const ALPHA = "_e2e-rig/e2e-scratch-20260803T141500Z-b2-alpha.canvas";
const BETA = "_e2e-rig/e2e-scratch-20260803T141500Z-b2-beta.canvas";
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function rig() {
  const doc = new Y.Doc();
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [] }) as RemoteData,
    getCanvasDocHandle: () => ({ doc }),
    deliver(path: string, label: string) {
      sync.onRemoteCanvasUpdate?.(path, { nodes: [{ id: "n1", label }], edges: [] });
    },
  };

  const views = new Map<string, RemoteData>([
    [ALPHA, { nodes: [], edges: [] }],
    [BETA, { nodes: [], edges: [] }],
  ]);
  const files = new Map<string, string>([
    [ALPHA, "{}"],
    [BETA, "{}"],
  ]);

  const channelFor = (path: string): CanvasSaveChannelLike => ({
    path: () => path,
    requestSave: async () => {
      const bytes = JSON.stringify(views.get(path));
      files.set(path, bytes);
      return bytes;
    },
  });

  const host = buildPluginHost(
    {
      settings: { clientId: "two-boards", roomId: "canvas-v2-t3", role: "host" },
      canvasSync: sync,
      app: {
        vault: {
          adapter: {
            exists: async (p: string) => files.has(p),
            read: async (p: string) => files.get(p) ?? "",
          },
        },
      },
      canvasSaveChannel: (p: string) => (views.has(p) ? channelFor(p) : null),
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );

  sync.setOnRemoteCanvasUpdate((path, data) => views.set(path, data));
  return { sync, host, files, views };
}

const setMode = (host: ReturnType<typeof rig>["host"], value: string) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

async function save(host: ReturnType<typeof rig>["host"], path: string) {
  const out = await routeCommand(host, { cmd: "canvas.save", args: { path } });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(out.body.error);
  return out.body.result as { sha256Before: string; sha256After: string; byInstance: boolean };
}

const labelOnDisk = (files: Map<string, string>, path: string) =>
  (JSON.parse(files.get(path) as string) as RemoteData).nodes[0]?.label;

describe("WP51 (blind2) — one instance, two boards, one stale state", () => {
  it("both boards go stale on a single command", async () => {
    const { sync, host, views } = rig();
    sync.deliver(ALPHA, "a0");
    sync.deliver(BETA, "b0");
    await setMode(host, "delayed");
    sync.deliver(ALPHA, "a1");
    sync.deliver(BETA, "b1");

    expect(views.get(ALPHA)?.nodes[0].label).toBe("a0");
    expect(views.get(BETA)?.nodes[0].label).toBe("b0");
  });

  it("each save carries its own board's stale bytes", async () => {
    const { sync, host, files } = rig();
    sync.deliver(ALPHA, "a0");
    sync.deliver(BETA, "b0");
    await setMode(host, "delayed");
    sync.deliver(ALPHA, "a1");
    sync.deliver(BETA, "b1");

    const ra = await save(host, ALPHA);
    const rb = await save(host, BETA);
    expect(labelOnDisk(files, ALPHA)).toBe("a0");
    expect(labelOnDisk(files, BETA)).toBe("b0");
    expect(ra.byInstance).toBe(true);
    expect(rb.byInstance).toBe(true);
    expect(ra.sha256After).not.toBe(rb.sha256After);
  });

  it("saving one board does not touch the other's file", async () => {
    const { sync, host, files } = rig();
    sync.deliver(ALPHA, "a0");
    sync.deliver(BETA, "b0");
    await setMode(host, "delayed");
    const betaBefore = files.get(BETA);
    await save(host, ALPHA);
    expect(files.get(BETA)).toBe(betaBefore);
  });

  it("the catch-up advances both boards, and the next saves agree with the peers", async () => {
    const { sync, host, files } = rig();
    sync.deliver(ALPHA, "a0");
    sync.deliver(BETA, "b0");
    await setMode(host, "delayed");
    sync.deliver(ALPHA, "a1");
    sync.deliver(BETA, "b1");
    await save(host, ALPHA);
    await save(host, BETA);

    await setMode(host, "live");
    await save(host, ALPHA);
    await save(host, BETA);
    expect(labelOnDisk(files, ALPHA)).toBe("a1");
    expect(labelOnDisk(files, BETA)).toBe("b1");
  });

  it("the digests reported are the digests of what is on disk, per board", async () => {
    const { sync, host, files } = rig();
    sync.deliver(ALPHA, "a0");
    sync.deliver(BETA, "b0");
    await setMode(host, "unavailable");
    sync.deliver(ALPHA, "a1");

    const ra = await save(host, ALPHA);
    expect(ra.sha256After).toBe(sha(files.get(ALPHA) as string));
    expect(ra.sha256Before).toBe(sha("{}"));
    const rb = await save(host, BETA);
    expect(rb.sha256After).toBe(sha(files.get(BETA) as string));
  });

  it("a board with no open view is refused even while the instance is stale", async () => {
    const { host, files } = rig();
    await setMode(host, "delayed");
    const out = await routeCommand(host, {
      cmd: "canvas.save",
      args: { path: "_e2e-rig/e2e-scratch-20260803T141500Z-b2-gamma.canvas" },
    });
    expect(out.status).toBe(400);
    expect(files.size).toBe(2);
    // Positive control: the boards that ARE open still save while stale.
    expect((await save(host, ALPHA)).byInstance).toBe(true);
  });
});
