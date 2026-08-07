// ===========================================================================
// `fileop.inject` — the inbound file-op seam.
//
// WHAT THESE ROWS ARE FOR, AND WHAT THEY ARE NOT.
//
// They are about the INSTRUMENT, not about WP68. WP68's inbound criterion is
// validated on a live two-vault instance, where the real
// `registerControlHandlers` gate is installed on a real socket; nothing here
// stands in for that and nothing here re-states its predicate.
//
// What they do establish is the two properties that decide whether such a
// validation would mean anything:
//
//   ENTRY — the frame the command produces is handed to the socket's own
//   `message` delivery, byte-identical to the frame a peer sends. Everything
//   between that handler and the gate is production code this module does not
//   touch, so if the entry point is right, the gate under test is the one that
//   runs.
//
//   MEASUREMENT — the answer is read back from real state and therefore differs
//   between a run that changed something and a run that did not. This is the
//   property `canvas.simulateEdit` lacks: it returns a hardcoded `applied:true`,
//   which is why it is on the rig's permanent do-not-use list. Two of the rows
//   below drive the SAME command over the SAME op and differ only in what the
//   handler behind the socket does; if `injectFileOp` ever answered from a
//   literal, they would agree, and they must not.
// ===========================================================================

import { describe, expect, it, vi } from "vitest";

import {
  type E2EControlHost,
  type E2EPluginLike,
  type FileOpInjectResult,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../testing/e2e-control";

// --- a fake host for the router rows ---------------------------------------

function fakeHost(overrides: Partial<E2EControlHost> = {}): E2EControlHost {
  return {
    sessionInfo: () => ({ clientId: "c1", role: "host", roomId: "r1", connected: true }),
    canvasOpen: async () => ({ opened: true, subscribed: true }),
    canvasState: () => ({ nodes: [], edges: [] }),
    bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
    simulateEdit: async () => ({ applied: true }),
    setFlag: () => ({ set: true }),
    waitQuiescent: async () => ({ quiescent: true }),
    ...overrides,
  };
}

const RENAME_OP = {
  type: "rename",
  oldPath: "notes/shared.md",
  newPath: ".obsidian/plugins/live-share/stolen.md",
};

// --- an in-memory vault the fake adapter reads ------------------------------

class FakeVault {
  readonly files = new Map<string, string>();
  readonly adapter = {
    exists: async (path: string) => this.files.has(path),
    read: async (path: string) => {
      const value = this.files.get(path);
      if (value === undefined) throw new Error(`no such file: ${path}`);
      return value;
    },
  };
}

/**
 * A socket double shaped like the platform's: `dispatchEvent` routes a
 * `message` event to whatever is assigned to `onmessage`, exactly as a real
 * `WebSocket` does. `inbound` records the raw frames the seam received.
 */
function fakeSocket(onFrame: (frame: string) => void) {
  const inbound: string[] = [];
  const socket = {
    inbound,
    onmessage: (event: { data: unknown }) => {
      inbound.push(String(event.data));
      onFrame(String(event.data));
    },
    dispatchEvent(event: unknown) {
      const data = (event as { type?: string; data?: unknown }).data;
      if ((event as { type?: string }).type === "message") socket.onmessage({ data });
      return true;
    },
  };
  return socket;
}

interface FakeWorld {
  plugin: E2EPluginLike;
  vault: FakeVault;
  muted: Set<string>;
  socket: ReturnType<typeof fakeSocket>;
}

/**
 * A plugin double whose control socket delivers to `handler`. `handler` stands
 * in for the whole of production between `onmessage` and the vault — it is NOT
 * a model of the WP68 gate, and no row below asserts anything about what it
 * decides. It exists so the two ends of the instrument (frame in, reading out)
 * can be driven independently.
 */
function fakeWorld(handler: (op: Record<string, unknown>, world: FakeWorld) => void): FakeWorld {
  const vault = new FakeVault();
  const muted = new Set<string>();
  const world = {} as FakeWorld;
  const socket = fakeSocket((frame) => {
    const parsed = JSON.parse(frame) as { type: string; op: Record<string, unknown> };
    handler(parsed.op, world);
  });
  const plugin: E2EPluginLike = {
    settings: { clientId: "c1", roomId: "r1", role: "guest" },
    app: { vault: { adapter: vault.adapter } },
    controlChannel: { ws: socket },
    fileOpsManager: { isPathMuted: (path: string) => muted.has(path) },
  };
  Object.assign(world, { plugin, vault, muted, socket });
  return world;
}

function hostOf(world: FakeWorld) {
  const host = buildPluginHost(world.plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  // `buildPluginHost` always provides it; the base interface keeps it optional
  // for the hand-rolled fake hosts elsewhere in the suite. Asserted rather than
  // cast away, so a build that stopped providing it fails here by name.
  const inject = host.injectFileOp;
  if (typeof inject !== "function") {
    throw new Error("buildPluginHost did not provide injectFileOp");
  }
  return { ...host, injectFileOp: inject.bind(host) };
}

// ===========================================================================
// The command boundary.
// ===========================================================================

describe("fileop.inject — validated at the command boundary, before any socket", () => {
  it("a missing or non-object 'op' is a structured 400, and the host is never reached", async () => {
    const spy = vi.fn();
    for (const args of [undefined, {}, { op: null }, { op: "rename" }, { op: [] }]) {
      const out = await routeCommand(fakeHost({ injectFileOp: spy }), {
        cmd: "fileop.inject",
        ...(args === undefined ? {} : { args }),
      });
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("'op'") });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("an op without a string 'type' is refused — a typeless op is dropped for the wrong reason", async () => {
    const spy = vi.fn();
    const out = await routeCommand(fakeHost({ injectFileOp: spy }), {
      cmd: "fileop.inject",
      args: { op: { oldPath: "a.md", newPath: "b.md" } },
    });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("'op.type'") });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a non-finite or negative settleMs is refused, and the host is never reached", async () => {
    const spy = vi.fn();
    for (const settleMs of ["250", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const out = await routeCommand(fakeHost({ injectFileOp: spy }), {
        cmd: "fileop.inject",
        args: { op: RENAME_OP, settleMs },
      });
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("settleMs") });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("a host without the capability is a structured 400, never a crash", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "fileop.inject", args: { op: RENAME_OP } });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({
      ok: false,
      error: expect.stringContaining("fileop.inject unavailable"),
    });
  });

  it("rides the existing ok envelope and hands the op through verbatim", async () => {
    const result: FileOpInjectResult = {
      delivered: true,
      reason: null,
      entry: "control-socket.dispatchEvent",
      frameBytes: 10,
      paths: [],
      settleMs: 250,
      samples: 1,
      before: [],
      after: [],
      mutedAfterDispatch: false,
      changed: [],
      mutated: false,
      link: null,
    };
    const spy = vi.fn(async () => result);
    const out = await parseAndRoute(
      fakeHost({ injectFileOp: spy }),
      JSON.stringify({ cmd: "fileop.inject", args: { op: RENAME_OP, settleMs: 0 } }),
    );
    expect(spy).toHaveBeenCalledWith({ op: RENAME_OP, settleMs: 0 });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, result });
  });
});

// ===========================================================================
// ENTRY — the frame goes to the socket's own message delivery.
// ===========================================================================

describe("fileop.inject — the frame enters at the socket, not behind it", () => {
  it("delivers a `file-op` frame carrying the op verbatim, through dispatchEvent", async () => {
    const world = fakeWorld(() => {});
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 0 });

    expect(out.delivered).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.entry).toBe("control-socket.dispatchEvent");
    // ONE frame, and it is exactly what a peer puts on the wire.
    expect(world.socket.inbound).toHaveLength(1);
    expect(JSON.parse(world.socket.inbound[0])).toEqual({ type: "file-op", op: RENAME_OP });
    expect(out.frameBytes).toBe(Buffer.byteLength(world.socket.inbound[0], "utf8"));
    expect(out.paths).toEqual([RENAME_OP.oldPath, RENAME_OP.newPath]);
  });

  it("falls back to onmessage when the socket has no event target, and says which it used", async () => {
    const world = fakeWorld(() => {});
    (world.socket as { dispatchEvent?: unknown }).dispatchEvent = undefined;
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 0 });

    expect(out.entry).toBe("control-socket.onmessage");
    expect(JSON.parse(world.socket.inbound[0])).toEqual({ type: "file-op", op: RENAME_OP });
  });

  it("no live socket → a NAMED refusal, nothing delivered, and the readings are unmoved", async () => {
    const world = fakeWorld(() => {});
    world.plugin.controlChannel = null;
    world.vault.files.set("notes/shared.md", "hello");
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 0 });

    expect(out.delivered).toBe(false);
    expect(out.entry).toBeNull();
    expect(out.reason).toContain("no live control socket");
    expect(out.after).toEqual(out.before);
    expect(out.mutated).toBe(false);
    expect(world.socket.inbound).toHaveLength(0);
  });

  it("a socket with no message handler → a NAMED refusal, not a silent swallow", async () => {
    const world = fakeWorld(() => {});
    (world.socket as { onmessage?: unknown }).onmessage = null;
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 0 });

    expect(out.delivered).toBe(false);
    expect(out.reason).toContain("no message handler");
  });

  it("a throwing seam is reported as a throwing seam, never as a refusal by the gate", async () => {
    const world = fakeWorld(() => {
      throw new Error("handler exploded");
    });
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 0 });

    expect(out.delivered).toBe(false);
    expect(out.reason).toContain("handler exploded");
  });
});

// ===========================================================================
// MEASUREMENT — the answer differs because the world differs.
//
// These two rows are the anti-`canvas.simulateEdit` control. Same command, same
// op, same settle window; the only difference is what the code behind the socket
// did. A hardcoded answer cannot produce both.
// ===========================================================================

describe("fileop.inject — the outcome is read back, never asserted", () => {
  it("nothing happened behind the socket → mutated:false, mutedAfterDispatch:false", async () => {
    const world = fakeWorld(() => {
      /* the frame arrived and nothing downstream acted on it */
    });
    world.vault.files.set("notes/shared.md", "hello");
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 30 });

    expect(out.delivered).toBe(true);
    expect(out.mutated).toBe(false);
    expect(out.changed).toEqual([]);
    expect(out.mutedAfterDispatch).toBe(false);
    // The endpoint that existed still exists, byte-identical.
    expect(out.before[0]).toMatchObject({ exists: true, size: 5 });
    expect(out.after[0]).toEqual(out.before[0]);
    expect(out.after[1]).toMatchObject({ exists: false, sha256: "", size: 0 });
  });

  it("the rename was applied behind the socket → mutated:true, and BOTH endpoints named", async () => {
    const world = fakeWorld((op, w) => {
      const oldPath = String(op.oldPath);
      const newPath = String(op.newPath);
      w.muted.add(oldPath);
      w.muted.add(newPath);
      const content = w.vault.files.get(oldPath);
      if (content !== undefined) {
        w.vault.files.delete(oldPath);
        w.vault.files.set(newPath, content);
      }
    });
    world.vault.files.set("notes/shared.md", "hello");
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 30 });

    expect(out.delivered).toBe(true);
    expect(out.mutated).toBe(true);
    expect(out.changed).toEqual([RENAME_OP.oldPath, RENAME_OP.newPath]);
    expect(out.mutedAfterDispatch).toBe(true);
    expect(out.before[0].exists).toBe(true);
    expect(out.after[0].exists).toBe(false);
    expect(out.after[1]).toMatchObject({ exists: true, size: 5 });
    // The digest is over the bytes and the bytes never leave: no `content` field.
    expect(out.after[1].sha256).toHaveLength(64);
    expect(Object.keys(out.after[1]).sort()).toEqual([
      "exists",
      "localPath",
      "muted",
      "path",
      "sha256",
      "size",
    ]);
  });

  it("a mute taken and released inside the window is still seen — the latch, not a snapshot", async () => {
    const world = fakeWorld((op, w) => {
      const oldPath = String(op.oldPath);
      w.muted.add(oldPath);
      // Released well before the window closes, exactly as an armed release does.
      setTimeout(() => w.muted.delete(oldPath), 20);
    });
    const out = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 120 });

    expect(out.mutedAfterDispatch).toBe(true);
    expect(out.samples).toBeGreaterThan(1);
    // …and the FINAL reading has already lost it, which is why a snapshot fails.
    expect(out.after[0].muted).toBe(false);
  });

  it("the reported window is the window that was measured", async () => {
    const world = fakeWorld(() => {});
    const explicit = await hostOf(world).injectFileOp({ op: RENAME_OP, settleMs: 40 });
    expect(explicit.settleMs).toBe(40);
    const defaulted = await hostOf(world).injectFileOp({ op: RENAME_OP });
    expect(defaulted.settleMs).toBe(250);
  });
});
