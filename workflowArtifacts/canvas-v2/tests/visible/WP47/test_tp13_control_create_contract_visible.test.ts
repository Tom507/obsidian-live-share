// WP47 / AC1 — the `scratch.create` command contract:
//   * result shape `{created, path}` (T3 shared contract §6.1)
//   * the rig folder is ensured, and it is the ONLY folder ever created
//   * an EXISTING file is never adopted and never overwritten
//   * a missing `path` arg is a structured 400, not a crash
//
// Staged location: plugin/src/__tests__/wp47/
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SCRATCH_CONTENT,
  SCRATCH_EXT,
  SCRATCH_FOLDER,
  SCRATCH_PREFIX,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  parseAndRoute,
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
    settings: { clientId: "e2e-a", roomId: "room-1", role: "host" },
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

const RUN_ID = "20260801T101112Z-4242-abcdef";
const SCRATCH = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}${RUN_ID}${SCRATCH_EXT}`;

describe("scratch.create — happy path", () => {
  it("returns {created:true, path} and writes exactly one file", async () => {
    const { adapter, files } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: SCRATCH, content: '{"nodes":[{"id":"n1"}],"edges":[]}' },
    });

    expect(out).toEqual({
      status: 200,
      body: { ok: true, result: { created: true, path: SCRATCH } },
    });
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect([...files.keys()]).toEqual([SCRATCH]);
  });

  it("ensures the rig folder and creates no other folder", async () => {
    const { adapter, folders } = fakeAdapter();
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: SCRATCH } });

    expect(adapter.mkdir).toHaveBeenCalledWith(SCRATCH_FOLDER);
    expect([...folders]).toEqual([SCRATCH_FOLDER]);
  });

  it("does not re-create the rig folder when it already exists", async () => {
    const { adapter, folders } = fakeAdapter();
    folders.add(SCRATCH_FOLDER);

    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: SCRATCH } });

    expect(adapter.mkdir).not.toHaveBeenCalled();
  });

  it("falls back to an empty canvas document when content is omitted", async () => {
    const { adapter, files } = fakeAdapter();
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: SCRATCH } });

    expect(files.get(SCRATCH)).toBe(DEFAULT_SCRATCH_CONTENT);
    const parsed = JSON.parse(files.get(SCRATCH) as string);
    expect(parsed).toEqual({ nodes: [], edges: [] });
  });
});

describe("scratch.create — an existing file is never adopted (AC1)", () => {
  it("reports created:false and leaves the bytes untouched", async () => {
    const existing = '{"nodes":[{"id":"someone-elses"}],"edges":[]}';
    const { adapter, files } = fakeAdapter({ [SCRATCH]: existing });

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: SCRATCH, content: "{}" },
    });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, result: { created: false, path: SCRATCH } });
    expect(adapter.write).not.toHaveBeenCalled();
    expect(files.get(SCRATCH)).toBe(existing);
  });
});

describe("scratch.create — argument contract", () => {
  it("a missing path is a structured 400", async () => {
    const { adapter } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: {} });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("a non-string path is a structured 400", async () => {
    const { adapter } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: 42 },
    });
    expect(out.status).toBe(400);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("a non-string content is rejected rather than coerced", async () => {
    const { adapter, files } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: SCRATCH, content: { nodes: [] } },
    });
    expect(out.status).toBe(400);
    expect(files.size).toBe(0);
  });

  it("survives the raw-body path exactly the same way", async () => {
    const { adapter, files } = fakeAdapter();
    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.create", args: { path: SCRATCH } }),
    );
    expect(out.status).toBe(200);
    expect(files.has(SCRATCH)).toBe(true);
  });

  it("a plugin without a scratch adapter fails structurally, not by crashing", async () => {
    const out = await routeCommand(hostOf(null), {
      cmd: "scratch.create",
      args: { path: SCRATCH },
    });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });
});
