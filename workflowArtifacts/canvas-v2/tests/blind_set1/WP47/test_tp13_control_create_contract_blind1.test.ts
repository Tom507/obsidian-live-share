// WP47 / AC1 — the create contract, different angle: the adapter FAILS in
// realistic ways (mkdir rejects because the folder raced into existence, write
// rejects with EPERM), the content is large and unicode, and the "already there"
// case is checked for the exact number of adapter calls rather than only for the
// resulting bytes.
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SCRATCH_CONTENT,
  SCRATCH_EXT,
  SCRATCH_FOLDER,
  SCRATCH_PREFIX,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function adapterOf(seed: Record<string, string> = {}, folders: string[] = []) {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>(folders);
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
    mkdir: vi.fn(async (p: string) => {
      dirs.add(p);
    }),
    write: vi.fn(async (p: string, d: string) => {
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      files.delete(p);
    }),
  };
  return { adapter, files, dirs };
}

function hostOf(adapter: ScratchAdapterLike | null | undefined) {
  const plugin: E2EPluginLike = {
    settings: { clientId: "e2e-b", roomId: "raum-1", role: "guest" },
    canvasSync: null,
    scratchAdapter: adapter ?? null,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const PATH = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260215T090000Z-31337-0f0f0f${SCRATCH_EXT}`;

const BIG_UNICODE = JSON.stringify({
  nodes: Array.from({ length: 50 }, (_, i) => ({
    id: `knoten-${i}`,
    text: `Ümläute und Emoji 🧭 ${i}`,
    x: i * 10,
    y: 0,
    width: 200,
    height: 60,
  })),
  edges: [],
});

describe("scratch.create — content handling", () => {
  it("writes the supplied unicode content byte-for-byte", async () => {
    const { adapter, files } = adapterOf();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH, content: BIG_UNICODE },
    });

    expect(out.status).toBe(200);
    expect(files.get(PATH)).toBe(BIG_UNICODE);
    expect(JSON.parse(files.get(PATH) as string).nodes).toHaveLength(50);
  });

  it("an empty-string content is honoured and NOT replaced by the default", async () => {
    const { adapter, files } = adapterOf();
    await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH, content: "" },
    });
    expect(files.get(PATH)).toBe("");
  });

  it("an omitted content yields a parseable empty canvas", async () => {
    const { adapter, files } = adapterOf();
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });

    expect(files.get(PATH)).toBe(DEFAULT_SCRATCH_CONTENT);
    expect(() => JSON.parse(DEFAULT_SCRATCH_CONTENT)).not.toThrow();
    expect(JSON.parse(DEFAULT_SCRATCH_CONTENT)).toEqual({ nodes: [], edges: [] });
  });
});

describe("scratch.create — the folder is ensured, once", () => {
  it("creates the rig folder when it is missing", async () => {
    const { adapter, dirs } = adapterOf();
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });
    expect(dirs.has(SCRATCH_FOLDER)).toBe(true);
    expect(adapter.mkdir).toHaveBeenCalledTimes(1);
  });

  it("skips mkdir when the folder is already there", async () => {
    const { adapter } = adapterOf({}, [SCRATCH_FOLDER]);
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });
    expect(adapter.mkdir).not.toHaveBeenCalled();
  });

  it("a second create in the same folder does not mkdir again", async () => {
    const { adapter } = adapterOf();
    const host = hostOf(adapter);
    const other = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260215T090001Z-31337-0f0f10${SCRATCH_EXT}`;

    await host.scratchCreate(PATH);
    await host.scratchCreate(other);

    expect(adapter.mkdir).toHaveBeenCalledTimes(1);
  });
});

describe("scratch.create — adoption is impossible", () => {
  it("does not call write at all when the file is already there", async () => {
    const existing = '{"nodes":[{"id":"vom-abgestuerzten-lauf"}],"edges":[]}';
    const { adapter, files } = adapterOf({ [PATH]: existing });

    const result = await hostOf(adapter).scratchCreate(PATH, "neu");

    expect(result).toEqual({ created: false, path: PATH });
    expect(adapter.write).toHaveBeenCalledTimes(0);
    expect(files.get(PATH)).toBe(existing);
  });
});

describe("scratch.create — adapter failures are structured", () => {
  it("a rejecting write becomes a 400, not an unhandled rejection", async () => {
    const { adapter } = adapterOf();
    (adapter.write as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EPERM"));

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH },
    });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });

  it("a rejecting mkdir becomes a 400 and no file is written", async () => {
    const { adapter, files } = adapterOf();
    (adapter.mkdir as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EEXIST"));

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH },
    });

    expect(out.status).toBe(400);
    expect(files.size).toBe(0);
  });

  it("an absent adapter is a refusal, never a silent success", async () => {
    const out = await routeCommand(hostOf(null), {
      cmd: "scratch.create",
      args: { path: PATH },
    });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });
});
