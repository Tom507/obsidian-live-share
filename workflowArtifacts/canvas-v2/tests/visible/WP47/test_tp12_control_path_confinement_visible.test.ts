// WP47 / AC1 — the `scratch.create` / `scratch.remove` control commands are
// CONFINED to SCRATCH_FOLDER. Structural, not advisory: a path outside the rig
// folder is refused before the adapter is ever reached, so the plugin side
// cannot open a pre-existing note for writing even if asked to.
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
  isScratchPath,
  routeCommand,
} from "../../testing/e2e-control";

// ---------------------------------------------------------------------------
// A vault adapter that records every call. Nothing is ever really written.
// ---------------------------------------------------------------------------
function fakeAdapter(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const folders = new Set<string>();
  const calls: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p) || folders.has(p)),
    mkdir: vi.fn(async (p: string) => {
      calls.push(`mkdir:${p}`);
      folders.add(p);
    }),
    write: vi.fn(async (p: string, data: string) => {
      calls.push(`write:${p}`);
      files.set(p, data);
    }),
    remove: vi.fn(async (p: string) => {
      calls.push(`remove:${p}`);
      files.delete(p);
    }),
  };
  return { adapter, files, folders, calls };
}

function fakePlugin(adapter: ScratchAdapterLike): E2EPluginLike {
  return {
    settings: { clientId: "e2e-a", roomId: "room-1", role: "host" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
    scratchAdapter: adapter,
  };
}

function hostOf(adapter: ScratchAdapterLike) {
  return buildPluginHost(fakePlugin(adapter), {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const GOOD = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4242-abcdef${SCRATCH_EXT}`;

// Every one of these must be refused. They are the realistic ways a bad path
// reaches the command: a plain note, a traversal, an absolute path, a
// look-alike folder, a wrong extension.
const REFUSED = [
  "Inbox.md",
  "Daily/2026-07-31.md",
  "boards/board.canvas",
  `${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `notes/${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}/../Inbox.md`,
  `${SCRATCH_FOLDER}/../${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}/nested/${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `/${SCRATCH_FOLDER}/${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}x/${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}/abc${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}abc.md`,
  `${SCRATCH_FOLDER}\\${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
  `.obsidian/plugins/live-share/${SCRATCH_PREFIX}abc${SCRATCH_EXT}`,
];

describe("isScratchPath — the confinement predicate (AC1)", () => {
  it("accepts a path derived from the pinned constants", () => {
    expect(isScratchPath(GOOD)).toBe(true);
  });

  it.each(REFUSED)("refuses %s", (path) => {
    expect(isScratchPath(path)).toBe(false);
  });
});

describe("scratch.create — refuses every path outside the rig folder", () => {
  it.each(REFUSED)("returns 400 and touches no file for %s", async (path) => {
    const { adapter, calls } = fakeAdapter({ "Inbox.md": "# Inbox\n" });
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path, content: "{}" },
    });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("scratch.remove — refuses every path outside the rig folder", () => {
  it.each(REFUSED)("returns 400 and deletes nothing for %s", async (path) => {
    const { adapter, files } = fakeAdapter({
      "Inbox.md": "# Inbox\n",
      "boards/board.canvas": '{"nodes":[],"edges":[]}',
    });
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path },
    });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(files.get("Inbox.md")).toBe("# Inbox\n");
    expect(files.has("boards/board.canvas")).toBe(true);
  });
});

describe("the sanctioned path still works", () => {
  it("creates inside the rig folder and reports the path back", async () => {
    const { adapter, files } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: GOOD, content: '{"nodes":[],"edges":[]}' },
    });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, result: { created: true, path: GOOD } });
    expect(files.get(GOOD)).toBe('{"nodes":[],"edges":[]}');
    expect([...files.keys()]).toEqual([GOOD]);
  });

  it("a refusal never crashes the router (US4 AC5)", async () => {
    const { adapter } = fakeAdapter();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: "Inbox.md" },
    });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
  });

  it("the host itself refuses, not only the router", async () => {
    const { adapter } = fakeAdapter();
    await expect(hostOf(adapter).scratchCreate("Inbox.md")).rejects.toThrow();
    await expect(hostOf(adapter).scratchRemove("Inbox.md")).rejects.toThrow();
  });
});
