// WP47 / AC1 — the create contract, third angle: byte-preservation. The command
// must hand the content through UNCHANGED — no JSON re-serialisation, no
// normalisation, no BOM, no trailing newline added. (The single-writer invariant
// says the rig must never re-serialise a `.canvas` file; the same discipline
// applies to the file it creates.) Plus the exact adapter call ORDER.
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

function tracing(seed: Record<string, string> = {}, dirs: string[] = []) {
  const files = new Map<string, string>(Object.entries(seed));
  const folders = new Set<string>(dirs);
  const trace: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => {
      trace.push(`exists:${p}`);
      return files.has(p) || folders.has(p);
    }),
    mkdir: vi.fn(async (p: string) => {
      trace.push(`mkdir:${p}`);
      folders.add(p);
    }),
    write: vi.fn(async (p: string, d: string) => {
      trace.push(`write:${p}`);
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      trace.push(`remove:${p}`);
      files.delete(p);
    }),
  };
  return { adapter, files, folders, trace };
}

function hostOf(adapter: ScratchAdapterLike) {
  const plugin: E2EPluginLike = {
    settings: { clientId: "e2e-a", roomId: "r", role: "host" },
    canvasSync: null,
    scratchAdapter: adapter,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const PATH = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4242-abcdef${SCRATCH_EXT}`;

const EXOTIC_CONTENTS = [
  '{"nodes":[],"edges":[]}',
  '{\n  "nodes": [],\n  "edges": []\n}\n',
  '{"nodes":[],"edges":[]}\r\n',
  '{ "edges": [], "nodes": [] }', // key order that a re-serialiser would change
  '{"nodes":[{"id":"a","text":"tab\\there"}],"edges":[]}',
  "not json at all",
  " ",
];

describe("scratch.create — content passes through byte-for-byte", () => {
  it.each(EXOTIC_CONTENTS)("preserves %j exactly", async (content) => {
    const { adapter, files } = tracing();
    const out = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH, content },
    });

    expect(out.status).toBe(200);
    expect(files.get(PATH)).toBe(content);
    expect(adapter.write).toHaveBeenCalledWith(PATH, content);
  });

  it("adds no trailing newline and no BOM", async () => {
    const { adapter, files } = tracing();
    await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH, content: "{}" },
    });
    const written = files.get(PATH) as string;
    expect(written).toBe("{}");
    expect(written.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("scratch.create — adapter call order", () => {
  it("checks existence and ensures the folder BEFORE it writes", async () => {
    const { adapter, trace } = tracing();

    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });

    const writeAt = trace.findIndex((t) => t === `write:${PATH}`);
    const mkdirAt = trace.findIndex((t) => t === `mkdir:${SCRATCH_FOLDER}`);
    const existsAt = trace.findIndex((t) => t === `exists:${PATH}`);

    expect(existsAt).toBeGreaterThanOrEqual(0);
    expect(mkdirAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(mkdirAt);
    expect(writeAt).toBeGreaterThan(existsAt);
  });

  it("writes exactly once for one create", async () => {
    const { adapter, trace } = tracing();
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });
    expect(trace.filter((t) => t.startsWith("write:"))).toHaveLength(1);
  });

  it("touches no path other than the scratch file and its folder", async () => {
    const { adapter, trace } = tracing({ "vault-notes/note-000.md": "keep" });
    await routeCommand(hostOf(adapter), { cmd: "scratch.create", args: { path: PATH } });

    const mutated = trace
      .filter((t) => t.startsWith("write:") || t.startsWith("mkdir:") || t.startsWith("remove:"))
      .map((t) => t.split(":")[1]);
    expect(new Set(mutated)).toEqual(new Set([PATH, SCRATCH_FOLDER]));
  });
});

describe("scratch.create — the default document", () => {
  it("is a canvas document with no nodes and no edges", () => {
    const parsed = JSON.parse(DEFAULT_SCRATCH_CONTENT);
    expect(parsed).toEqual({ nodes: [], edges: [] });
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it("is used only when content is absent, never when it is falsy-but-present", async () => {
    const { adapter, files } = tracing();
    await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path: PATH, content: "" },
    });
    expect(files.get(PATH)).toBe("");
    expect(files.get(PATH)).not.toBe(DEFAULT_SCRATCH_CONTENT);
  });
});

describe("scratch.create — an existing file wins", () => {
  it("keeps the existing bytes and reports created:false for every content", async () => {
    for (const content of EXOTIC_CONTENTS) {
      const { adapter, files } = tracing({ [PATH]: "ORIGINAL" });
      const out = await routeCommand(hostOf(adapter), {
        cmd: "scratch.create",
        args: { path: PATH, content },
      });
      expect(out.body).toEqual({ ok: true, result: { created: false, path: PATH } });
      expect(files.get(PATH)).toBe("ORIGINAL");
      expect(adapter.write).not.toHaveBeenCalled();
    }
  });
});
