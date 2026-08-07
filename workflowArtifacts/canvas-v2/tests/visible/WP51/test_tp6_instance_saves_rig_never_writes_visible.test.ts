// WP51 / C51 AC2 — "a control command causes THE INSTANCE to perform an Obsidian
// save of the scratch canvas, WITH THE RIG NEVER WRITING THE FILE ITSELF".
//
// Two separable claims, and both are asserted here as state:
//   1. the instance's own save channel was invoked, and the bytes that landed are
//      the bytes the instance handed to Obsidian's writer — the command carries
//      no content argument, so the rig has nothing to inject;
//   2. no writable adapter was reached on this path. `CanvasPersistence` is the
//      single CRDT→disk writer (charter §3) and `canvas.save` must not become a
//      second one, so the WP47 scratch adapter — the only writable surface the
//      host owns — is a spy that must stay untouched.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  type ScratchAdapterLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const PATH = "_e2e-rig/e2e-scratch-20260803T095959Z-6-f.canvas";
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** What the LIVE canvas view currently holds, serialised the way Obsidian saves it. */
function viewBytes(x: number): string {
  return JSON.stringify({ nodes: [{ id: "n1", type: "text", x, y: 0, width: 400, height: 200 }], edges: [] });
}

function harness(opts: { seed?: string } = {}) {
  const files = new Map<string, string>();
  if (opts.seed !== undefined) files.set(PATH, opts.seed);

  // READ-ONLY view of the vault (WP49's `CanvasFileAdapterLike` shape) plus the
  // WRITABLE scratch adapter (WP47). The writable one is the tripwire.
  const scratch: ScratchAdapterLike = {
    exists: vi.fn(async (p: string) => files.has(p)),
    mkdir: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const vaultAdapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? "",
    // The real `DataAdapter` also has writers; the host must never reach them.
    write: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };

  let live = 10;
  const saves: string[] = [];
  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      // Obsidian's own save of the OPEN VIEW. The instance is the writer.
      const bytes = viewBytes(live);
      files.set(PATH, bytes);
      saves.push(bytes);
      return bytes;
    },
  };

  const plugin = {
    settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
    scratchAdapter: scratch,
    app: { vault: { adapter: vaultAdapter } },
    canvasSaveChannel: (p: string) => (p === PATH ? channel : null),
  } as unknown as E2EPluginLike;

  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  return {
    host,
    files,
    scratch,
    vaultAdapter,
    saves,
    moveViewTo: (x: number) => {
      live = x;
    },
  };
}

async function save(host: ReturnType<typeof harness>["host"], path = PATH) {
  const out = await routeCommand(host, { cmd: "canvas.save", args: { path } });
  return out;
}

describe("WP51 AC2 — the instance performs the save", () => {
  it("writes the bytes the instance's own view produced, and reports them back", async () => {
    const { host, files, saves } = harness({ seed: '{"nodes":[],"edges":[]}' });
    const out = await save(host);

    expect(out.status).toBe(200);
    if (!out.body.ok) throw new Error(out.body.error);
    const result = out.body.result as {
      saved: boolean;
      sha256Before: string;
      sha256After: string;
      size: number;
      byInstance: boolean;
    };

    expect(saves).toHaveLength(1);
    expect(files.get(PATH)).toBe(saves[0]);
    expect(result.saved).toBe(true);
    expect(result.byInstance).toBe(true);
    expect(result.sha256Before).toBe(sha('{"nodes":[],"edges":[]}'));
    expect(result.sha256After).toBe(sha(saves[0]));
    expect(result.size).toBe(Buffer.byteLength(saves[0], "utf8"));
    expect(result.sha256After).not.toBe(result.sha256Before);
  });

  it("reaches NO writable adapter — the rig is not a second CRDT→disk writer", async () => {
    const { host, scratch, vaultAdapter, saves } = harness({ seed: "{}" });
    const out = await save(host);

    // Positive control: the command really ran. Without this the assertions
    // below would also hold for a surface that has no `canvas.save` at all.
    expect(out.status).toBe(200);
    expect(saves).toHaveLength(1);

    expect(scratch.write).not.toHaveBeenCalled();
    expect(scratch.mkdir).not.toHaveBeenCalled();
    expect(scratch.remove).not.toHaveBeenCalled();
    expect(vaultAdapter.write).not.toHaveBeenCalled();
    expect(vaultAdapter.mkdir).not.toHaveBeenCalled();
    expect(vaultAdapter.remove).not.toHaveBeenCalled();
  });

  it("carries no content channel — a driver cannot hand the command bytes to write", async () => {
    const { host, files, saves } = harness({ seed: "{}" });
    const injected = '{"nodes":[{"id":"forged"}],"edges":[]}';
    const out = await routeCommand(host, {
      cmd: "canvas.save",
      args: { path: PATH, content: injected, data: injected, bytes: injected },
    });
    expect(out.status).toBe(200);
    // Whatever the driver sent, what landed is what the instance serialised.
    expect(files.get(PATH)).toBe(saves[0]);
    expect(files.get(PATH)).not.toContain("forged");
  });

  it("saves what the VIEW holds now, not a cached first answer", async () => {
    const { host, files, moveViewTo } = harness({ seed: "{}" });
    await save(host);
    expect(files.get(PATH)).toBe(viewBytes(10));

    moveViewTo(777);
    await save(host);
    expect(files.get(PATH)).toBe(viewBytes(777));
  });

  it("a path with no open canvas view is a structured 400 and writes nothing", async () => {
    const { host, files, scratch } = harness({ seed: "{}" });
    const other = "_e2e-rig/e2e-scratch-20260803T095959Z-6-zz.canvas";
    const out = await save(host, other);
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    expect(files.has(other)).toBe(false);
    expect(scratch.write).not.toHaveBeenCalled();
    // Positive control: the SAME host answers 200 for the board it does have open.
    expect((await save(host)).status).toBe(200);
  });

  it("a missing `path` arg keeps the existing structured-400 contract", async () => {
    const { host } = harness({ seed: "{}" });
    expect((await routeCommand(host, { cmd: "canvas.save", args: {} })).status).toBe(400);
    expect((await routeCommand(host, { cmd: "canvas.save", args: { path: 7 } })).status).toBe(400);
    expect((await save(host)).status).toBe(200); // positive control
  });
});
