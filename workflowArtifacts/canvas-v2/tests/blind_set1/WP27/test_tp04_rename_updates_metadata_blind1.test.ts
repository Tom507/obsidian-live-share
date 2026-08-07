// WP27 / AC2 blind1 — the rename metadata, attacked as a CHAIN of three renames
// instead of one.
//
// Different angle: A → B → C, with C deliberately re-using A's directory. Each
// hop must move `meta.path`, the manifest mapping and the `index.json` value,
// and the guid must be the same string at every hop. A single-hop test cannot
// see an implementation that re-mints on the second rename, nor one that leaves
// a stale index row behind after the first — both show up here as a growing
// `index.json`, which is asserted by key COUNT rather than by looking for one
// value.
//
// The last hop lands on a path that is a PREFIX-SIBLING of the first, so a
// `startsWith`-based cleanup of the old mapping would take the wrong row.

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
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const A = "team/sprint.canvas";
const B = "archive/2026/sprint.canvas";
const C = "team/sprint-final.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "s1", type: "text", x: 4, y: 4, width: 20, height: 20, text: "s" }],
  edges: [],
});

function mkVault() {
  const files = new Map([[A, BODY]]);
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
  return {
    docs,
    getDoc(id: string) {
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

async function boot() {
  const vault = mkVault();
  const sync = mkSync();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  const sidecar = createSidecarStore(mkIO());
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));
  await canvasSync.subscribe(A, "host");
  return { vault, sync, manifest, sidecar, canvasSync };
}

function move(vault: ReturnType<typeof mkVault>, from: string, to: string) {
  vault.files.set(to, vault.files.get(from) as string);
  vault.files.delete(from);
}

describe("WP27 AC2 blind1 — a rename chain moves metadata and mints nothing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A -> B -> C keeps one guid, one index row and a live meta.path", async () => {
    const { vault, sync, manifest, sidecar, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(A) as string;
    expect(typeof guid).toBe("string");
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(doc).toBeDefined();

    const hops: Array<[string, string]> = [
      [A, B],
      [B, C],
    ];
    for (const [from, to] of hops) {
      move(vault, from, to);
      await canvasSync.handleRename(from, to);

      const meta = doc.getMap<unknown>(META_MAP_NAME);
      expect(meta.get(PATH_KEY), `meta.path after ${from} -> ${to}`).toBe(to);
      expect(meta.get(GUID_KEY), `the guid was re-minted at ${to}`).toBe(guid);
      expect(manifest.getCanvasGuid(to)).toBe(guid);
      expect(manifest.getCanvasGuid(from)).toBeNull();

      const index = await sidecar.readIndex();
      expect(Object.keys(index).length, `index grew at ${to}`).toBe(1);
      expect(index[guid]).toBe(to);
    }

    canvasSync.destroy();
  });

  it("the final path is the only one the identity view answers for", async () => {
    const { vault, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(A) as string;

    move(vault, A, B);
    await canvasSync.handleRename(A, B);
    move(vault, B, C);
    await canvasSync.handleRename(B, C);

    expect(canvasSync.getCanvasGuid(C)).toBe(guid);
    expect(canvasSync.getCanvasGuid(A)).toBeNull();
    expect(canvasSync.getCanvasGuid(B)).toBeNull();

    canvasSync.destroy();
  });

  it("renaming a path the client does not own writes nothing", async () => {
    const { manifest, sidecar, canvasSync } = await boot();
    const before = await sidecar.readIndex();

    await canvasSync.handleRename("unrelated/other.canvas", "unrelated/moved.canvas");

    expect(await sidecar.readIndex()).toEqual(before);
    expect(manifest.getCanvasGuid("unrelated/moved.canvas")).toBeNull();

    canvasSync.destroy();
  });
});
