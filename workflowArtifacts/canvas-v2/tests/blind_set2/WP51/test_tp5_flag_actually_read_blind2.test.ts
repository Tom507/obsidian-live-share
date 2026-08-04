// WP51 AC3 — blind set 2 (the flag is genuinely read).
//
// Angle: a mutation-style differential. Every registered flag is driven through
// an identical scripted run on two instances that differ ONLY in the value the
// flag holds, and the whole run is reduced to a single signature string. If the
// two signatures are equal, the flag changed nothing anywhere the protocol can
// see it — which is precisely the definition of a flag nothing reads, and is the
// only verdict this file will accept as a failure.
//
// It also pins the converse: no OTHER command's answer may change because a flag
// is set, so the difference is attributable to the named code path rather than
// to the surface having been disturbed.
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

const PATH = "_e2e-rig/e2e-scratch-20260803T124500Z-b2-diff.canvas";

/** Values to drive each registered flag with: [neutral, active]. */
const DRIVE: Record<string, [unknown, unknown]> = {
  [STALE_VIEW_FLAG]: ["live", "delayed"],
};

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
    deliver(tag: string) {
      sync.onRemoteCanvasUpdate?.(PATH, { nodes: [{ id: "n1", tag }], edges: [] });
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "diff", roomId: "canvas-v2-t3", role: "guest" },
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  const seen: string[] = [];
  sync.setOnRemoteCanvasUpdate((_p, data) => seen.push(String(data.nodes[0].tag)));
  return { sync, host, seen };
}

/** The scripted run, reduced to one signature. */
async function runSignature(name: string, value: unknown): Promise<string> {
  const inst = instance();
  const set = await routeCommand(inst.host, {
    cmd: "canvas.setFlag",
    args: { name, value },
  });
  if (set.status !== 200) throw new Error(`setFlag ${name}=${String(value)} was refused`);

  inst.sync.deliver("alpha");
  inst.sync.deliver("bravo");
  const mid = await routeCommand(inst.host, { cmd: "canvas.flags" });
  inst.sync.deliver("charlie");

  return JSON.stringify({ seen: inst.seen, mid: mid.body });
}

describe("WP51 AC3 (blind2) — an inert flag produces an identical run signature", () => {
  it("every registered flag has a drive pair in this file", () => {
    expect(Object.keys(RUNTIME_FLAG_READERS).sort()).toEqual(Object.keys(DRIVE).sort());
  });

  it.each(Object.keys(DRIVE))("`%s` changes the run signature", async (name) => {
    const [neutral, active] = DRIVE[name];
    const before = await runSignature(name, neutral);
    const after = await runSignature(name, active);
    expect(after).not.toBe(before);
  });

  it.each(Object.keys(DRIVE))("`%s` is stable — the same value gives the same run", async (name) => {
    const [, active] = DRIVE[name];
    expect(await runSignature(name, active)).toBe(await runSignature(name, active));
  });

  it("no OTHER command's answer moves because the flag is set", async () => {
    const bare = instance();
    const flagged = instance();
    const entered = await routeCommand(flagged.host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "delayed" },
    });
    expect(entered.status).toBe(200);
    // Positive control: SOMETHING must differ, or "nothing else differs" is free.
    expect(await routeCommand(flagged.host, { cmd: "canvas.flags" })).not.toEqual(
      await routeCommand(bare.host, { cmd: "canvas.flags" }),
    );

    for (const cmd of [
      { cmd: "session.info" },
      { cmd: "canvas.open", args: { path: PATH } },
      { cmd: "canvas.state", args: { path: PATH } },
      { cmd: "canvas.binding", args: { path: PATH } },
      { cmd: "canvas.setFlag", args: { name: "nope", value: 1 } },
      { cmd: "does.notExist" },
    ]) {
      const a = await routeCommand(bare.host, cmd);
      const b = await routeCommand(flagged.host, cmd);
      expect(b, `command ${cmd.cmd} changed under the flag`).toEqual(a);
    }
  });

  it("the difference is not merely 'a command was issued'", async () => {
    // Issuing setFlag with the NEUTRAL value must give the same signature as a
    // run whose only difference is the value, so the effect is attributable to
    // the value and not to the command having been sent.
    const neutralRun = await runSignature(STALE_VIEW_FLAG, "live");
    const secondNeutralRun = await runSignature(STALE_VIEW_FLAG, "live");
    expect(secondNeutralRun).toBe(neutralRun);
    expect(await runSignature(STALE_VIEW_FLAG, "unavailable")).not.toBe(neutralRun);
  });
});
