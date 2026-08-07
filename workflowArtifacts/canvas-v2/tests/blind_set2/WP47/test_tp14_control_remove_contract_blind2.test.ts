// WP47 / AC2 — the remove contract, third angle: TWO instances (role a and role
// b, one per vault) are driven together, as a real run does. Teardown on one
// vault must never reach into the other, the two runs' artefacts are independent,
// and a failure on one side does not prevent teardown on the other.
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

function vaultAdapter(name: string, seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const log: string[] = [];
  const adapter: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p)),
    mkdir: vi.fn(async () => {}),
    write: vi.fn(async (p: string, d: string) => {
      log.push(`${name}:write:${p}`);
      files.set(p, d);
    }),
    remove: vi.fn(async (p: string) => {
      log.push(`${name}:remove:${p}`);
      files.delete(p);
    }),
  };
  return { adapter, files, log };
}

function hostOf(adapter: ScratchAdapterLike, role: "host" | "guest", clientId: string) {
  const plugin: E2EPluginLike = {
    settings: { clientId, roomId: "shared-room", role },
    canvasSync: null,
    scratchAdapter: adapter,
  };
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

const PATH_A = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4242-aaaaaa${SCRATCH_EXT}`;
const PATH_B = `${SCRATCH_FOLDER}/${SCRATCH_PREFIX}20260801T101112Z-4242-bbbbbb${SCRATCH_EXT}`;
const NOTES_A = { "vault-notes/a-001.md": "A note" };
const NOTES_B = { "vault-notes/b-001.md": "B note" };

describe("two vaults, one run", () => {
  it("each side removes only its own scratch file", async () => {
    const a = vaultAdapter("A", { ...NOTES_A, [PATH_A]: "{}" });
    const b = vaultAdapter("B", { ...NOTES_B, [PATH_B]: "{}" });

    await hostOf(a.adapter, "host", "e2e-a").scratchRemove(PATH_A);
    await hostOf(b.adapter, "guest", "e2e-b").scratchRemove(PATH_B);

    expect(a.files.has(PATH_A)).toBe(false);
    expect(b.files.has(PATH_B)).toBe(false);
    expect(a.log).toEqual([`A:remove:${PATH_A}`]);
    expect(b.log).toEqual([`B:remove:${PATH_B}`]);
  });

  it("a teardown addressed at the other vault's path is a no-op there", async () => {
    const a = vaultAdapter("A", { ...NOTES_A, [PATH_A]: "{}" });

    const out = await routeCommand(hostOf(a.adapter, "host", "e2e-a"), {
      cmd: "scratch.remove",
      args: { path: PATH_B },
    });

    expect(out).toEqual({ status: 200, body: { ok: true, result: { removed: false } } });
    expect(a.files.has(PATH_A)).toBe(true);
    expect(a.adapter.remove).not.toHaveBeenCalled();
  });

  it("a failure on side A does not stop teardown on side B", async () => {
    const a = vaultAdapter("A", { ...NOTES_A, [PATH_A]: "{}" });
    const b = vaultAdapter("B", { ...NOTES_B, [PATH_B]: "{}" });
    (a.adapter.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EBUSY"));

    const outA = await routeCommand(hostOf(a.adapter, "host", "e2e-a"), {
      cmd: "scratch.remove",
      args: { path: PATH_A },
    });
    const outB = await routeCommand(hostOf(b.adapter, "guest", "e2e-b"), {
      cmd: "scratch.remove",
      args: { path: PATH_B },
    });

    expect(outA.status).toBe(400);
    expect(outB.status).toBe(200);
    expect(b.files.has(PATH_B)).toBe(false);
  });

  it("pre-existing notes on both sides are never removed", async () => {
    const a = vaultAdapter("A", { ...NOTES_A, [PATH_A]: "{}" });
    const b = vaultAdapter("B", { ...NOTES_B, [PATH_B]: "{}" });

    await hostOf(a.adapter, "host", "e2e-a").scratchRemove(PATH_A);
    await hostOf(b.adapter, "guest", "e2e-b").scratchRemove(PATH_B);

    expect([...a.files.keys()]).toEqual(Object.keys(NOTES_A));
    expect([...b.files.keys()]).toEqual(Object.keys(NOTES_B));
  });
});

describe("full create/remove cycle per vault", () => {
  it("leaves both vaults exactly as they started", async () => {
    const a = vaultAdapter("A", NOTES_A);
    const b = vaultAdapter("B", NOTES_B);
    const hostA = hostOf(a.adapter, "host", "e2e-a");
    const hostB = hostOf(b.adapter, "guest", "e2e-b");

    expect(await hostA.scratchCreate(PATH_A)).toEqual({ created: true, path: PATH_A });
    expect(await hostB.scratchCreate(PATH_B)).toEqual({ created: true, path: PATH_B });
    expect(await hostA.scratchRemove(PATH_A)).toEqual({ removed: true });
    expect(await hostB.scratchRemove(PATH_B)).toEqual({ removed: true });

    expect([...a.files.entries()]).toEqual(Object.entries(NOTES_A));
    expect([...b.files.entries()]).toEqual(Object.entries(NOTES_B));
  });

  it("a repeated teardown after the cycle stays successful on both sides", async () => {
    const a = vaultAdapter("A", NOTES_A);
    const b = vaultAdapter("B", NOTES_B);
    const hostA = hostOf(a.adapter, "host", "e2e-a");
    const hostB = hostOf(b.adapter, "guest", "e2e-b");

    await hostA.scratchCreate(PATH_A);
    await hostB.scratchCreate(PATH_B);
    await hostA.scratchRemove(PATH_A);
    await hostB.scratchRemove(PATH_B);

    expect(await hostA.scratchRemove(PATH_A)).toEqual({ removed: false });
    expect(await hostB.scratchRemove(PATH_B)).toEqual({ removed: false });
  });

  it("session.info keeps working alongside the new commands", async () => {
    const a = vaultAdapter("A", NOTES_A);
    const out = await routeCommand(hostOf(a.adapter, "host", "e2e-a"), { cmd: "session.info" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true });
  });
});
