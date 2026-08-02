// WP47 / AC2 — the remove contract, different angle: teardown is driven as a
// SEQUENCE (create, edit, remove, remove again) against a vault that also holds
// pre-existing notes and a second run's artefact, and the ordering of adapter
// calls is asserted — teardown must check existence before it deletes.
import { describe, expect, it, vi } from "vitest";

import {
  SCRATCH_EXT,
  SCRATCH_FOLDER,
  SCRATCH_PREFIX,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../../testing/e2e-control";

function tracedAdapter(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const trace: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => {
      trace.push(`exists(${p})`);
      return files.has(p);
    }),
    mkdir: vi.fn(async (p: string) => {
      trace.push(`mkdir(${p})`);
    }),
    write: vi.fn(async (p: string, d: string) => {
      trace.push(`write(${p})`);
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      trace.push(`remove(${p})`);
      files.delete(p);
    }),
  };
  return { adapter, files, trace };
}

function hostOf(adapter: ScratchAdapterLike | null) {
  const plugin: E2EPluginLike = {
    settings: { clientId: "e2e-a", roomId: "raum-1", role: "host" },
    canvasSync: null,
    scratchAdapter: adapter,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const MINE = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260215T090000Z-31337-0f0f0f${SCRATCH_EXT}`;
const OTHER = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260215T090000Z-31338-0f0f11${SCRATCH_EXT}`;
const VAULT = {
  "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n",
  "Ideen & Skizzen/roadmap.canvas": '{"nodes":[],"edges":[]}',
};

describe("scratch.remove — the teardown sequence", () => {
  it("create, edit, remove, remove again leaves only the pre-existing files", async () => {
    const { adapter, files } = tracedAdapter(VAULT);
    const host = hostOf(adapter);

    await host.scratchCreate(MINE, '{"nodes":[],"edges":[]}');
    await host.scratchCreate(MINE, "would-be-overwrite"); // no adoption
    const first = await host.scratchRemove(MINE);
    const second = await host.scratchRemove(MINE);

    expect(first).toEqual({ removed: true });
    expect(second).toEqual({ removed: false });
    expect([...files.keys()].sort()).toEqual(Object.keys(VAULT).sort());
    expect(files.get("Meeting Notes/2026 Q3 Review.md")).toBe("# Rückblick\n");
  });

  it("checks existence before deleting", async () => {
    const { adapter, trace } = tracedAdapter({ ...VAULT, [MINE]: "{}" });

    await hostOf(adapter).scratchRemove(MINE);

    const existsAt = trace.indexOf(`exists(${MINE})`);
    const removeAt = trace.indexOf(`remove(${MINE})`);
    expect(existsAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThan(existsAt);
  });

  it("never issues a delete for a file that is not there", async () => {
    const { adapter, trace } = tracedAdapter(VAULT);

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path: MINE },
    });

    expect(out.status).toBe(200);
    expect(trace.filter((t) => t.startsWith("remove("))).toEqual([]);
  });

  it("a concurrent run's artefact survives this run's teardown", async () => {
    const { adapter, files } = tracedAdapter({ ...VAULT, [MINE]: "{}", [OTHER]: "{}" });

    await hostOf(adapter).scratchRemove(MINE);

    expect(files.has(MINE)).toBe(false);
    expect(files.has(OTHER)).toBe(true);
  });

  it("ten teardown calls in a row are all successful and delete once", async () => {
    const { adapter } = tracedAdapter({ [MINE]: "{}" });
    const host = hostOf(adapter);

    const results = [];
    for (let i = 0; i < 10; i++) results.push(await host.scratchRemove(MINE));

    expect(results[0]).toEqual({ removed: true });
    expect(results.slice(1).every((r) => r.removed === false)).toBe(true);
    expect(adapter.remove).toHaveBeenCalledTimes(1);
  });
});

describe("scratch.remove — failure surfaces", () => {
  it("an adapter that throws synchronously still yields a 400", async () => {
    const { adapter } = tracedAdapter({ [MINE]: "{}" });
    (adapter.remove as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("locked by Obsidian");
    });

    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.remove", args: { path: MINE } }),
    );

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });

  it("an empty path string is refused like any other bad arg", async () => {
    const { adapter, files } = tracedAdapter({ ...VAULT, [MINE]: "{}" });

    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path: "" },
    });

    expect(out.status).toBe(400);
    expect(files.has(MINE)).toBe(true);
  });

  it("an unknown scratch-ish command is still an unknown command", async () => {
    const { adapter } = tracedAdapter(VAULT);
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.purge",
      args: { path: MINE },
    });
    expect(out.status).toBe(400);
    expect(adapter.remove).not.toHaveBeenCalled();
  });
});
