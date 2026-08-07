// WP27 / AC1 blind1 — subscribe addressing, attacked as a SET PARTITION over
// three canvases subscribed in one run rather than as one canvas checked twice.
//
// Different angle: two of the three canvases have a pre-published guid and one
// does not, so the run exercises the resolve branch and the mint branch in the
// same process, and the oracle is the whole sorted set of ids the sync manager
// was ever asked for. A per-path `not.toContain(prefix + path)` passes against a
// harness that subscribed nothing; a whole-set comparison against a non-empty
// expectation cannot.
//
// The expected set is BUILT FROM the guids the implementation itself resolved or
// minted, so nothing here pins a generated value — only the relationship
// `askedFor == {canvasDocId(g) : g in resolvedGuids}`.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
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

const ALPHA = "atlas/alpha.canvas";
const BETA = "atlas/deep/beta.canvas";
const GAMMA = "gamma.canvas";

const GUID_ALPHA = "aa11bb22cc33dd44ee55ff6677889900";
const GUID_BETA = "bb22cc33dd44ee55ff6677889900aa11";

function body(): string {
  return JSON.stringify({
    nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x" }],
    edges: [],
  });
}

function mkVault(files: Map<string, string>) {
  return {
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

function mkIO(): SidecarIO {
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

describe("WP27 AC1 blind1 — three canvases, one keyspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the set of requested canvas ids is exactly the set of resolved guids", async () => {
    const files = new Map([
      [ALPHA, body()],
      [BETA, body()],
      [GAMMA, body()],
    ]);
    const vault = mkVault(files);
    const sync = mkSync();
    const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
    await manifest.connect(sync as never);
    manifest.setCanvasGuid(ALPHA, GUID_ALPHA);
    manifest.setCanvasGuid(BETA, GUID_BETA);

    const canvasSync = new CanvasSync(
      vault as never,
      sync as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
    );
    canvasSync.setIdentityStore(
      createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
    );

    for (const path of [ALPHA, BETA, GAMMA]) {
      await canvasSync.subscribe(path, "host");
    }

    const resolved = [ALPHA, BETA, GAMMA].map((p) => canvasSync.getCanvasGuid(p));
    for (const guid of resolved) expect(typeof guid).toBe("string");
    expect(resolved[0]).toBe(GUID_ALPHA);
    expect(resolved[1]).toBe(GUID_BETA);
    // GAMMA was minted: distinct from both, and not derived from its path.
    expect(new Set(resolved).size).toBe(3);
    expect(resolved[2]).not.toBe(GAMMA);

    const asked = [...new Set(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX)))].sort();
    expect(asked).toEqual((resolved as string[]).map((g) => canvasDocId(g)).sort());

    canvasSync.destroy();
  });

  it("each doc's meta names its own path and its own guid", async () => {
    const files = new Map([
      [ALPHA, body()],
      [BETA, body()],
    ]);
    const vault = mkVault(files);
    const sync = mkSync();
    const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
    await manifest.connect(sync as never);
    manifest.setCanvasGuid(ALPHA, GUID_ALPHA);
    manifest.setCanvasGuid(BETA, GUID_BETA);

    const canvasSync = new CanvasSync(
      vault as never,
      sync as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
    );
    canvasSync.setIdentityStore(
      createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
    );

    await canvasSync.subscribe(ALPHA, "host");
    await canvasSync.subscribe(BETA, "host");

    for (const [path, guid] of [
      [ALPHA, GUID_ALPHA],
      [BETA, GUID_BETA],
    ] as const) {
      const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
      expect(doc, `no doc for ${path}`).toBeDefined();
      const meta = doc.getMap<unknown>(META_MAP_NAME);
      expect(meta.get(GUID_KEY)).toBe(guid);
      expect(meta.get(PATH_KEY)).toBe(path);
    }

    canvasSync.destroy();
  });

  it("subscribing the same path twice opens no second doc", async () => {
    const files = new Map([[ALPHA, body()]]);
    const vault = mkVault(files);
    const sync = mkSync();
    const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
    await manifest.connect(sync as never);

    const canvasSync = new CanvasSync(
      vault as never,
      sync as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
    );
    canvasSync.setIdentityStore(
      createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
    );

    await canvasSync.subscribe(ALPHA, "host");
    const first = canvasSync.getCanvasGuid(ALPHA);
    await canvasSync.subscribe(ALPHA, "host");

    expect(canvasSync.getCanvasGuid(ALPHA)).toBe(first);
    expect([...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([
      canvasDocId(first as string),
    ]);

    canvasSync.destroy();
  });
});
