// WP47 / AC1 — confinement, different angle: the adapter here is a HOSTILE
// recorder that would happily clobber a real note, and the paths pushed at the
// commands are the ones a buggy driver actually produces — Windows separators,
// percent-encoded traversal, a UNC-ish prefix, a unicode look-alike folder and
// a trailing-dot Windows name.
import { describe, expect, it, vi } from "vitest";

import {
  SCRATCH_EXT,
  SCRATCH_FOLDER,
  SCRATCH_PREFIX,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  isScratchPath,
  parseAndRoute,
} from "../../testing/e2e-control";

function recorder(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const touched: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p)),
    mkdir: vi.fn(async (p: string) => {
      touched.push(p);
    }),
    write: vi.fn(async (p: string, d: string) => {
      touched.push(p);
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      touched.push(p);
      files.delete(p);
    }),
  };
  return { adapter, files, touched };
}

function hostOf(adapter: ScratchAdapterLike) {
  const plugin: E2EPluginLike = {
    settings: { clientId: "e2e-b", roomId: "raum-1", role: "guest" },
    canvasSync: null,
    scratchAdapter: adapter,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const VAULT = {
  "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n",
  "Ideen & Skizzen/roadmap.canvas": '{"nodes":[],"edges":[]}',
  "Anhänge/foto.png": "binary-ish",
};

const HOSTILE = [
  `..\\${SCRATCH_FOLDER}\\${SCRATCH_PREFIX}x${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}\\..\\Meeting Notes\\2026 Q3 Review.md`,
  `${SCRATCH_FOLDER}/%2e%2e/Meeting Notes/2026 Q3 Review.md`,
  `//server/share/${SCRATCH_PREFIX}x${SCRATCH_EXT}`,
  `C:/vault/${SCRATCH_FOLDER}/${SCRATCH_PREFIX}x${SCRATCH_EXT}`,
  `_е2e-rig/${SCRATCH_PREFIX}x${SCRATCH_EXT}`, // cyrillic 'е' look-alike
  `${SCRATCH_FOLDER.toUpperCase()}/${SCRATCH_PREFIX}x${SCRATCH_EXT}`,
  `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}x${SCRATCH_EXT}.`,
  `${SCRATCH_FOLDER}/./${SCRATCH_PREFIX}x${SCRATCH_EXT}`,
  `Meeting Notes/2026 Q3 Review.md`,
  `Ideen & Skizzen/roadmap.canvas`,
  "..",
  ".",
];

describe("isScratchPath rejects hostile shapes (AC1)", () => {
  it.each(HOSTILE)("rejects %s", (path) => {
    expect(isScratchPath(path)).toBe(false);
  });
});

describe("scratch.create over the raw body — hostile paths change nothing", () => {
  it.each(HOSTILE)("leaves the vault untouched for %s", async (path) => {
    const { adapter, files, touched } = recorder(VAULT);
    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.create", args: { path, content: "clobber" } }),
    );

    expect(out.status).toBe(400);
    expect(touched).toEqual([]);
    expect(Object.entries(VAULT).every(([k, v]) => files.get(k) === v)).toBe(true);
    expect(files.size).toBe(Object.keys(VAULT).length);
  });
});

describe("scratch.remove over the raw body — hostile paths delete nothing", () => {
  it.each(HOSTILE)("keeps every file for %s", async (path) => {
    const { adapter, files } = recorder(VAULT);
    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.remove", args: { path } }),
    );

    expect(out.status).toBe(400);
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(files.size).toBe(Object.keys(VAULT).length);
  });
});

describe("the refusal is reported, not swallowed", () => {
  it("names a non-empty error string", async () => {
    const { adapter } = recorder(VAULT);
    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.remove", args: { path: "Anhänge/foto.png" } }),
    );
    expect(out.body.ok).toBe(false);
    if (!out.body.ok) expect(out.body.error.length).toBeGreaterThan(0);
  });

  it("the only accepted shape is folder + prefix + ext, one level deep", async () => {
    const good = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T000000Z-1-abcdef${SCRATCH_EXT}`;
    const { adapter, files } = recorder(VAULT);

    const out = await parseAndRoute(
      hostOf(adapter),
      JSON.stringify({ cmd: "scratch.create", args: { path: good } }),
    );

    expect(out.status).toBe(200);
    expect(files.has(good)).toBe(true);
    expect(files.size).toBe(Object.keys(VAULT).length + 1);
  });
});
