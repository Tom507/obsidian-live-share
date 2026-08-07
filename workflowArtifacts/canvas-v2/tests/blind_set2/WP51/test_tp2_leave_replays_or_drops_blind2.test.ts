// WP51 AC1/AC4 — blind set 2.
//
// Angle: the difference between the two seams is asserted through the STATE OF
// THE VIEW after the catch-up, not through how many callbacks fired. A gate that
// replays a merged summary frame instead of the withheld frames satisfies a
// call-count test and fails this one, because the view it produces differs.
//
// Second angle: the withheld payloads are deep objects, and the replayed ones
// must be the SAME values — a gate that clones them through JSON, normalises
// them or drops unknown fields is a second serialiser in the path, which the
// charter forbids for the file oracle and which would be no better here.
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

const PATH = "_e2e-rig/e2e-scratch-20260803T114500Z-b2-seams.canvas";

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
    deliver(data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(PATH, data);
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "seams", roomId: "canvas-v2-t3", role: "guest" },
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );

  // The rendered board: the last frame the view was asked to draw.
  let rendered: RemoteData = { nodes: [], edges: [] };
  const received: RemoteData[] = [];
  sync.setOnRemoteCanvasUpdate((_p, data) => {
    rendered = data;
    received.push(data);
  });
  return { sync, host, received, renderedNow: () => rendered };
}

async function setMode(host: ReturnType<typeof rig>["host"], value: string) {
  const out = await routeCommand(host, {
    cmd: "canvas.setFlag",
    args: { name: STALE_VIEW_FLAG, value },
  });
  expect(out.status, `mode '${value}' was refused`).toBe(200);
  return out;
}

const frame = (label: string): RemoteData => ({
  nodes: [
    {
      id: "card",
      type: "text",
      text: label,
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      color: "3",
      styleAttributes: { shape: "rounded", border: null },
    },
  ],
  edges: [],
});

describe("WP51 AC1 (blind2) — what the view holds after each seam is released", () => {
  it("after `delayed` is released the view holds the LATEST withheld frame", async () => {
    const { sync, host, renderedNow } = rig();
    sync.deliver(frame("start"));
    await setMode(host, "delayed");
    sync.deliver(frame("mid"));
    sync.deliver(frame("end"));
    expect(renderedNow().nodes[0].text).toBe("start");

    await setMode(host, "live");
    expect(renderedNow().nodes[0].text).toBe("end");
  });

  it("after `unavailable` is released the view still holds the PRE-STALE frame", async () => {
    const { sync, host, renderedNow } = rig();
    sync.deliver(frame("start"));
    await setMode(host, "unavailable");
    sync.deliver(frame("mid"));
    sync.deliver(frame("end"));
    await setMode(host, "live");
    expect(renderedNow().nodes[0].text).toBe("start");
  });

  it("the replayed payloads are the values that arrived, unaltered", async () => {
    const { sync, host, received } = rig();
    await setMode(host, "delayed");
    const sent = frame("verbatim");
    sync.deliver(sent);
    await setMode(host, "live");

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sent);
    // Field-for-field, including the nested private-API shape a normaliser drops.
    expect(received[0].nodes[0].styleAttributes).toEqual({ shape: "rounded", border: null });
    expect(Object.keys(received[0].nodes[0]).sort()).toEqual(Object.keys(sent.nodes[0]).sort());
  });

  it("the released view is genuinely live again in both cases", async () => {
    for (const mode of ["delayed", "unavailable"]) {
      const { sync, host, renderedNow } = rig();
      await setMode(host, mode);
      sync.deliver(frame("held"));
      await setMode(host, "live");
      sync.deliver(frame("after"));
      expect(renderedNow().nodes[0].text, `mode ${mode}`).toBe("after");
    }
  });

  it("entering `unavailable` from `delayed` discards what `delayed` had buffered", async () => {
    const { sync, host, received } = rig();
    await setMode(host, "delayed");
    sync.deliver(frame("buffered"));
    await setMode(host, "unavailable");
    await setMode(host, "live");
    expect(received).toEqual([]);
  });
});
