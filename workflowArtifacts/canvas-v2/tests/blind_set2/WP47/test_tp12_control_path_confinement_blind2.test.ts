// WP47 / AC1 — confinement, third angle: instead of a hand-written deny list the
// accepted shape is derived COMBINATORIALLY. Every combination of (folder,
// prefix, extension, depth) is generated and exactly one combination — the fully
// correct one — may be accepted. Create and remove must agree on that predicate:
// a divergence between them is itself the bug.
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

function adapterOf(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const mutations: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p)),
    mkdir: vi.fn(async (p: string) => {
      mutations.push(`mkdir ${p}`);
    }),
    write: vi.fn(async (p: string, d: string) => {
      mutations.push(`write ${p}`);
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      mutations.push(`remove ${p}`);
      files.delete(p);
    }),
  };
  return { adapter, files, mutations };
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

const ID = "20260801T101112Z-4242-abcdef";

const FOLDERS = [SCRATCH_FOLDER, "notes", "", `${SCRATCH_FOLDER}/inner`];
const PREFIXES = [SCRATCH_PREFIX, "", "scratch-"];
const EXTS = [SCRATCH_EXT, ".md", ""];

type Combo = { path: string; correct: boolean };

const COMBOS: Combo[] = [];
for (const folder of FOLDERS) {
  for (const prefix of PREFIXES) {
    for (const ext of EXTS) {
      const name = `${prefix}${ID}${ext}`;
      const path = folder === "" ? name : `${folder}/${name}`;
      COMBOS.push({
        path,
        correct: folder === SCRATCH_FOLDER && prefix === SCRATCH_PREFIX && ext === SCRATCH_EXT,
      });
    }
  }
}

const CORRECT = COMBOS.filter((c) => c.correct);
const WRONG = COMBOS.filter((c) => !c.correct);

describe("the accepted shape is unique", () => {
  it("exactly one generated combination is correct", () => {
    expect(CORRECT).toHaveLength(1);
    expect(WRONG.length).toBeGreaterThan(30);
  });

  it("isScratchPath accepts only that one", () => {
    expect(isScratchPath(CORRECT[0].path)).toBe(true);
    for (const combo of WRONG) {
      expect(isScratchPath(combo.path)).toBe(false);
    }
  });
});

describe("create and remove share the same predicate", () => {
  it.each(WRONG.map((c) => c.path))("both refuse %s", async (path) => {
    const { adapter, mutations } = adapterOf({ "notes/real.md": "keep" });

    const created = await routeCommand(hostOf(adapter), {
      cmd: "scratch.create",
      args: { path },
    });
    const removed = await routeCommand(hostOf(adapter), {
      cmd: "scratch.remove",
      args: { path },
    });

    expect(created.status).toBe(400);
    expect(removed.status).toBe(400);
    expect(mutations).toEqual([]);
  });

  it("both accept the correct one", async () => {
    const path = CORRECT[0].path;
    const { adapter, files } = adapterOf();
    const host = hostOf(adapter);

    const created = await routeCommand(host, { cmd: "scratch.create", args: { path } });
    expect(created.status).toBe(200);
    expect(files.has(path)).toBe(true);

    const removed = await routeCommand(host, { cmd: "scratch.remove", args: { path } });
    expect(removed.status).toBe(200);
    expect(files.has(path)).toBe(false);
  });
});

describe("a pre-existing note can never be reached", () => {
  it("no wrong combination ever touches an unrelated file", async () => {
    const seed = { "notes/real.md": "keep", "vault-notes/note-000.md": "keep too" };
    for (const combo of WRONG) {
      const { adapter, files } = adapterOf(seed);
      await routeCommand(hostOf(adapter), {
        cmd: "scratch.create",
        args: { path: combo.path, content: "clobber" },
      });
      await routeCommand(hostOf(adapter), {
        cmd: "scratch.remove",
        args: { path: combo.path },
      });
      expect([...files.entries()]).toEqual(Object.entries(seed));
    }
  });
});
