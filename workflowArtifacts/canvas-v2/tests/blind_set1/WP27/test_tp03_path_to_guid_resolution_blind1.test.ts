// WP27 / AC1 blind1 — resolution, attacked through the RESTART story rather
// than through two independent lookups.
//
// Different angle: one vault, three successive client instances over the SAME
// persistent state (manifest doc + `index.json`), simulating a restart and a
// late-joining guest. The oracle is the count of distinct canvas doc ids that
// have EVER existed in the shared sync manager across all three lifetimes: it
// must be one. Any client that mints on a resolution miss shows up as a second
// id, and no amount of per-client checking would reveal it because each client
// is internally consistent.
//
// The third client resolves from `index.json` ONLY — its manifest is a fresh,
// empty doc, which is the honest shape of "the manifest has not synced yet".

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const BOARD = "planning/roadmap.canvas";
const BODY = JSON.stringify({
  nodes: [{ id: "r1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "r" }],
  edges: [],
});

function mkVault() {
  const files = new Map([[BOARD, BODY]]);
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
    adapter: { write: vi.fn(async () => {}) },
  };
}

function mkSync() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  return {
    docs,
    requested,
    getDoc(id: string) {
      requested.push(id);
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** One persistent sidecar directory shared by every "lifetime" below. */
function mkPersistentIO(): SidecarIO {
  const blobs = new Map<string, Uint8Array>();
  return {
    ensureDir: vi.fn(async () => {}),
    exists: vi.fn(async (p: string) => blobs.has(p)),
    read: vi.fn(async (p: string) => {
      const b = blobs.get(p);
      if (!b) throw new Error("missing");
      return b;
    }),
    write: vi.fn(async (p: string, d: Uint8Array) => {
      blobs.set(p, new Uint8Array(d));
    }),
    append: vi.fn(async () => {}),
    truncate: vi.fn(async () => {}),
    remove: vi.fn(async (p: string) => {
      blobs.delete(p);
    }),
  };
}

async function bootClient(
  vault: ReturnType<typeof mkVault>,
  sync: ReturnType<typeof mkSync>,
  io: SidecarIO,
  manifestSync: ReturnType<typeof mkSync>,
) {
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(manifestSync as never);
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(
    createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(io) }),
  );
  return { manifest, canvasSync };
}

function canvasIds(sync: ReturnType<typeof mkSync>): string[] {
  return [...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX)).sort();
}

describe("WP27 AC1 blind1 — one file, three lifetimes, one doc", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("across a mint, a restart and a late guest exactly one canvas doc exists", async () => {
    const vault = mkVault();
    const sync = mkSync();
    const io = mkPersistentIO();
    const manifestSync = mkSync();

    // Lifetime 1 — the host mints.
    const a = await bootClient(vault, sync, io, manifestSync);
    await a.canvasSync.subscribe(BOARD, "host");
    const guid = a.canvasSync.getCanvasGuid(BOARD);
    expect(typeof guid).toBe("string");
    a.canvasSync.destroy();

    // Lifetime 2 — restart. Same manifest doc, same sidecar.
    const b = await bootClient(vault, sync, io, manifestSync);
    await b.canvasSync.subscribe(BOARD, "guest");
    expect(b.canvasSync.getCanvasGuid(BOARD)).toBe(guid);
    b.canvasSync.destroy();

    // Lifetime 3 — a client whose manifest has NOT synced yet; only the local
    // sidecar index can answer.
    const c = await bootClient(vault, sync, io, mkSync());
    await c.canvasSync.subscribe(BOARD, "guest");
    expect(c.canvasSync.getCanvasGuid(BOARD)).toBe(guid);
    c.canvasSync.destroy();

    expect(canvasIds(sync)).toEqual([canvasDocId(guid as string)]);
  });

  it("a client with NEITHER source opens nothing at all", async () => {
    const vault = mkVault();
    const sync = mkSync();
    const client = await bootClient(vault, sync, mkPersistentIO(), mkSync());

    await client.canvasSync.subscribe(BOARD, "guest");

    expect(client.canvasSync.getCanvasGuid(BOARD)).toBeNull();
    expect(client.canvasSync.isSubscribed(BOARD)).toBe(false);
    expect(canvasIds(sync)).toEqual([]);
    expect(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);

    client.canvasSync.destroy();
  });

  it("an index entry for a DIFFERENT path does not answer for this one", async () => {
    const vault = mkVault();
    const sync = mkSync();
    const io = mkPersistentIO();
    const sidecar = createSidecarStore(io);
    await sidecar.writeIndex({ "11223344556677889900aabbccddeeff": "planning/other.canvas" });

    const client = await bootClient(vault, sync, io, mkSync());
    await client.canvasSync.subscribe(BOARD, "guest");

    expect(client.canvasSync.getCanvasGuid(BOARD)).toBeNull();
    expect(canvasIds(sync)).toEqual([]);

    client.canvasSync.destroy();
  });
});
