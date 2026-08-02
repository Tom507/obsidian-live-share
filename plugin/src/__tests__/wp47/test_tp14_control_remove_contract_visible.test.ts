// WP47 / AC2 — the `scratch.remove` command contract, i.e. the teardown half:
//   * `{removed:true}` when the file was there, `{removed:false}` when it was not
//   * calling it twice is safe — teardown runs on every exit path and may well
//     run after a partial teardown already happened
//   * only the named scratch file is removed, never a neighbour
//
// Staged location: plugin/src/__tests__/wp47/
import { describe, expect, it, vi } from "vitest";

import {
  SCRATCH_EXT,
  SCRATCH_FOLDER,
  SCRATCH_PREFIX,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function fakeAdapter(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const folders = new Set<string>();
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p) || folders.has(p)),
    mkdir: vi.fn(async (p: string) => {
      folders.add(p);
    }),
    write: vi.fn(async (p: string, data: string) => {
      files.set(p, data);
    }),
    remove: vi.fn(async (p: string) => {
      files.delete(p);
    }),
  };
  return { adapter, files, folders };
}

function hostOf(adapter: ScratchAdapterLike | null) {
  const plugin: E2EPluginLike = {
    settings: { clientId: "e2e-b", roomId: "room-1", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
    scratchAdapter: adapter,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const MINE = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4242-abcdef${SCRATCH_EXT}`;
const OTHER = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4243-fedcba${SCRATCH_EXT}`;

describe("scratch.remove", () => {
  it("removes an existing scratch file and reports removed:true", async () => {
    const { adapter, files } = fakeAdapter({ [MINE]: "{}" });

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path: MINE },
    });

    expect(out).toEqual({ status: 200, body: { ok: true, result: { removed: true } } });
    expect(files.has(MINE)).toBe(false);
  });

  it("reports removed:false for a file that is not there — and does not throw", async () => {
    const { adapter } = fakeAdapter();

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path: MINE },
    });

    expect(out).toEqual({ status: 200, body: { ok: true, result: { removed: false } } });
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it("is idempotent: a second teardown call is a no-op success", async () => {
    const { adapter, files } = fakeAdapter({ [MINE]: "{}" });
    const host = hostOf(adapter);

    const first = await host.scratchRemove(MINE);
    const second = await host.scratchRemove(MINE);
    const third = await host.scratchRemove(MINE);

    expect(first).toEqual({ removed: true });
    expect(second).toEqual({ removed: false });
    expect(third).toEqual({ removed: false });
    expect(adapter.remove).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(0);
  });

  it("removes only the named file, never a neighbour in the same folder", async () => {
    const { adapter, files } = fakeAdapter({ [MINE]: "{}", [OTHER]: "{}" });

    await routeCommand(hostOf(adapter), { cmd: "scratch.remove", args: { path: MINE } });

    expect(files.has(MINE)).toBe(false);
    expect(files.has(OTHER)).toBe(true);
    expect(adapter.remove).toHaveBeenCalledTimes(1);
    expect(adapter.remove).toHaveBeenCalledWith(MINE);
  });

  it("a missing path arg is a structured 400 and deletes nothing", async () => {
    const { adapter, files } = fakeAdapter({ [MINE]: "{}" });

    const out = await routeCommand(hostOf(adapter), { cmd: "scratch.remove", args: {} });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
    expect(files.has(MINE)).toBe(true);
  });

  it("an adapter failure surfaces as a structured 400, not as a crash", async () => {
    const { adapter } = fakeAdapter({ [MINE]: "{}" });
    (adapter.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EBUSY"));

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path: MINE },
    });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });

  it("a plugin without a scratch adapter fails structurally", async () => {
    const out = await routeCommand(hostOf(null), {
      cmd: "scratch.remove",
      args: { path: MINE },
    });
    expect(out.status).toBe(400);
  });

  it("create then remove leaves the vault exactly as it was", async () => {
    const { adapter, files } = fakeAdapter({ "Inbox.md": "# Inbox\n" });
    const host = hostOf(adapter);

    await host.scratchCreate(MINE);
    expect(files.has(MINE)).toBe(true);
    await host.scratchRemove(MINE);

    expect([...files.keys()]).toEqual(["Inbox.md"]);
    expect(files.get("Inbox.md")).toBe("# Inbox\n");
  });
});
