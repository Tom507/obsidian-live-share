// WP49 AC3 (blind set 2) — no fuzzy matching, no fallback file.
// Angle: the directory deliberately contains near-miss neighbours (`board.canvas.bak`,
// `Board.canvas`, `board.md`). An oracle that falls back to "the closest thing" would
// report a green convergence from a file the writer never produced — a silent lie
// that is worse than a red run.
// DATA SAFETY: OS temp dir only, removed afterwards — no vault path is opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeHost(root: string) {
  const fatal = (name: string) =>
    vi.fn(async () => {
      throw new Error(`WP49 AC3 violation: adapter.${name}`);
    });
  const adapter = {
    // Case-sensitive on purpose: `Board.canvas` must not answer for `board.canvas`.
    exists: vi.fn(async (p: string) => readdirSync(root).includes(p)),
    read: vi.fn(async (p: string) => readFileSync(join(root, p), "utf8")),
    readBinary: vi.fn(async (p: string) => toArrayBuffer(readFileSync(join(root, p)))),
    write: fatal("write"),
    writeBinary: fatal("writeBinary"),
    append: fatal("append"),
    remove: fatal("remove"),
    rename: fatal("rename"),
    mkdir: fatal("mkdir"),
    trashLocal: fatal("trashLocal"),
  };
  const plugin = {
    settings: { clientId: "cid", roomId: "room", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: null,
    app: { vault: { adapter } },
  } as unknown as E2EPluginLike;
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { adapter, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

describe("WP49 AC3 blind2 — near-miss neighbours are not substituted", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-near-"));
    writeFileSync(join(root, "board.canvas.bak"), '{"nodes":[{"id":"stale"}],"edges":[]}', "utf8");
    writeFileSync(join(root, "board.md"), "# not a canvas\n", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("the requested path is missing even though similar files exist", async () => {
    const { host } = makeHost(root);

    const result = await host.canvasFile("board.canvas");

    expect(result).toEqual({ exists: false, sha256: "", size: 0, content: null });
    // WP61 repair (class C — unsatisfiable as authored). This line was
    // `expect(result.content).not.toContain("stale")`. `content` is `null` for an
    // absent file (T3_SharedContract §6.1; the line above already pins it), and
    // vitest's `toContain` skips its string branch for a null receiver
    // (@vitest/expect/dist/index.js:1245 and :1249) and delegates to chai's
    // `include`, whose default branch THROWS for a null object
    // (chai/index.js:2067-2074) regardless of `.not`. The assertion therefore
    // could not pass against any implementation honouring the contract.
    // `toBeNull()` is strictly stronger: it admits exactly one value, where the
    // substring check admitted every string that merely lacked "stale".
    expect(result.content).toBeNull();
  });

  it("nothing is created and the neighbours are untouched", async () => {
    const before = readdirSync(root).sort();
    const bakBefore = readFileSync(join(root, "board.canvas.bak"));
    const { adapter, host } = makeHost(root);

    await host.canvasFile("board.canvas");

    expect(readdirSync(root).sort()).toEqual(before);
    expect(readFileSync(join(root, "board.canvas.bak")).equals(bakBefore)).toBe(true);
    expect(existsSync(join(root, "board.canvas"))).toBe(false);
    for (const name of ["write", "writeBinary", "append", "remove", "rename", "mkdir"] as const) {
      expect(adapter[name]).not.toHaveBeenCalled();
    }
  });

  it("the neighbour that does exist is readable under its own exact name", async () => {
    const { host } = makeHost(root);
    const result = await host.canvasFile("board.canvas.bak");
    expect(result.exists).toBe(true);
    expect(result.content).toContain("stale");
  });
});
