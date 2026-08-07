// WP51 / C51 AC3, second half — "a runtime flag the control server accepts is
// ACTUALLY READ by the code path it names".
//
// This is the test the work package exists for. A test that sets a flag and then
// reads it back proves only that a Map works; it passes unchanged against the
// inert `runtimeFlags` map that is there today, and that is exactly the vacuous
// class this project is eliminating. So nothing here reads a flag back as an
// oracle. Every assertion is a DIFFERENCE IN BEHAVIOUR between two otherwise
// identical instances — one with the flag set, one without — measured at the
// production seam the flag's registry entry names.
//
// The test is driven from `RUNTIME_FLAG_READERS`, so a flag added to the
// registry without a reader reddens it rather than sliding through.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it, vi } from "vitest";
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

const PATH = "_e2e-rig/e2e-scratch-20260803T094500Z-5-e.canvas";

function instance() {
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
  const viewApply = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(viewApply);
  return { sync, host, viewApply, plugin };
}

/**
 * The one stimulus every registered flag is measured against: an integrated
 * remote delta, delivered through the hook `main.ts` installs. `observe` is the
 * whole observable outcome — what the view-apply path received.
 */
function driveAndObserve(inst: ReturnType<typeof instance>): unknown {
  inst.sync.deliver({ nodes: [{ id: "n1", x: 11, y: 22 }], edges: [] });
  inst.sync.deliver({ nodes: [{ id: "n2", x: 33, y: 44 }], edges: [] });
  return inst.viewApply.mock.calls.map(([p, d]) => [p, d.nodes]);
}

/** A non-default value for each registered flag, keyed by name. */
const NON_DEFAULT: Record<string, unknown> = {
  [STALE_VIEW_FLAG]: "delayed",
};

describe("WP51 AC3 — an accepted flag changes what the named code path does", () => {
  it("the registry is exactly the flags this suite exercises", () => {
    // If a flag is registered without an entry here, the loop below cannot drive
    // it and this assertion fails first — an unexercised flag can never be added
    // silently, which is the only structural defence against a second inert map.
    expect(Object.keys(RUNTIME_FLAG_READERS).sort()).toEqual(Object.keys(NON_DEFAULT).sort());
  });

  it.each(Object.keys(NON_DEFAULT))(
    "`%s` set through the protocol produces a different outcome than not setting it",
    async (name) => {
      const withoutFlag = instance();
      const observedWithout = driveAndObserve(withoutFlag);

      const withFlag = instance();
      const set = await routeCommand(withFlag.host, {
        cmd: "canvas.setFlag",
        args: { name, value: NON_DEFAULT[name] },
      });
      expect(set.status).toBe(200);
      const observedWith = driveAndObserve(withFlag);

      // The ONLY difference between the two instances is the command above.
      // If the flag is merely stored, these are equal and the test is red.
      expect(observedWith).not.toEqual(observedWithout);
    },
  );

  it("the difference is caused by the flag's VALUE, not by having issued a command", async () => {
    // Setting the flag to its default must leave behaviour untouched — otherwise
    // "issuing any setFlag" would look like a working flag.
    const control = instance();
    const neutral = await routeCommand(control.host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "live" },
    });
    expect(neutral.status).toBe(200);
    const observedNeutral = driveAndObserve(control);

    const untouched = instance();
    expect(observedNeutral).toEqual(driveAndObserve(untouched));
  });

  it("the effect is reversible through the protocol, in both directions", async () => {
    const inst = instance();
    const set = (value: string) =>
      routeCommand(inst.host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

    inst.sync.deliver({ nodes: [{ id: "n1", x: 1 }], edges: [] });
    expect(inst.viewApply).toHaveBeenCalledTimes(1);

    await set("delayed");
    inst.sync.deliver({ nodes: [{ id: "n1", x: 2 }], edges: [] });
    expect(inst.viewApply).toHaveBeenCalledTimes(1); // withheld

    await set("live");
    expect(inst.viewApply).toHaveBeenCalledTimes(2); // replayed
    inst.sync.deliver({ nodes: [{ id: "n1", x: 3 }], edges: [] });
    expect(inst.viewApply).toHaveBeenCalledTimes(3); // live again

    await set("delayed");
    inst.sync.deliver({ nodes: [{ id: "n1", x: 4 }], edges: [] });
    expect(inst.viewApply).toHaveBeenCalledTimes(3); // withheld again
  });

  it("a flag set on ONE instance does not change another instance's view path", async () => {
    // Per-instance state, not module-global: the gate must not leak across the
    // two hosts a two-vault run drives.
    const a = instance();
    const b = instance();
    await routeCommand(a.host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "unavailable" },
    });
    a.sync.deliver({ nodes: [{ id: "n1", x: 1 }], edges: [] });
    b.sync.deliver({ nodes: [{ id: "n1", x: 1 }], edges: [] });
    expect(a.viewApply).not.toHaveBeenCalled();
    expect(b.viewApply).toHaveBeenCalledTimes(1);
  });

  it("every registry entry names a reader, and no entry names an unread store", () => {
    for (const [name, reader] of Object.entries(RUNTIME_FLAG_READERS)) {
      expect(typeof reader).toBe("string");
      expect(reader.trim().length).toBeGreaterThan(0);
      // The reader description must not be the flag's own name — that would be a
      // registry that documents storage rather than consumption.
      expect(reader).not.toBe(name);
    }
  });
});
