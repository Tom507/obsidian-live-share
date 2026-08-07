// WP27 / AC1 blind2 — subscribe addressing, attacked through the ADVERSARIAL
// PATH corpus rather than through ordinary file names.
//
// Different angle: every canvas here has a path chosen to break a
// string-manipulating implementation — a path containing the doc-id prefix, a
// path that is itself a guid-shaped string, a path with a colon, and a deeply
// nested one. If any part of the doc id is still derived from the path, one of
// these rows produces a collision or a malformed id; a corpus of ordinary
// `boards/x.canvas` names never would.
//
// The oracle is that the four canvases occupy four DISTINCT docs and that each
// doc's `meta.path` names its own file — a pairing, not two independent checks.

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

const HOSTILE_PATHS = [
  "vault/__canvas__:not-an-id.canvas",
  "vault/deadbeefdeadbeefdeadbeefdeadbeef.canvas",
  "vault/a/b/c/d/e/f/deep.canvas",
  "vault/name with spaces and ümläuts.canvas",
];

const BODY = JSON.stringify({
  nodes: [{ id: "p", type: "text", x: 1, y: 1, width: 5, height: 5, text: "p" }],
  edges: [],
});

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
  const files = new Map(HOSTILE_PATHS.map((p) => [p, BODY] as const));
  const vault = {
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
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  const sync = {
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
  return { vault, sync, manifest, canvasSync };
}

describe("WP27 AC1 blind2 — hostile paths cannot bleed into the doc id", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("four hostile paths produce four distinct docs and four distinct guids", async () => {
    const { sync, canvasSync } = await boot();

    for (const path of HOSTILE_PATHS) await canvasSync.subscribe(path, "host");

    const guids = HOSTILE_PATHS.map((p) => canvasSync.getCanvasGuid(p));
    for (const guid of guids) expect(typeof guid).toBe("string");
    expect(new Set(guids).size).toBe(HOSTILE_PATHS.length);

    const ids = [...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX)).sort();
    expect(ids).toEqual((guids as string[]).map((g) => canvasDocId(g)).sort());

    canvasSync.destroy();
  });

  it("no doc id contains any part of its own path", async () => {
    const { canvasSync } = await boot();

    for (const path of HOSTILE_PATHS) {
      await canvasSync.subscribe(path, "host");
      const guid = canvasSync.getCanvasGuid(path) as string;
      const id = canvasDocId(guid);
      expect(id).not.toContain(path);
      expect(id).not.toContain("/");
      expect(id).not.toContain(".canvas");
      // Every path segment long enough not to collide with a hex digit by
      // chance. One- and two-character segments are excluded on purpose: a
      // random guid legitimately contains them.
      for (const segment of path.split("/").filter((s) => s.length >= 4)) {
        expect(id, `${id} carries the segment ${segment}`).not.toContain(segment);
      }
    }

    canvasSync.destroy();
  });

  it("each doc's meta names its own path and its own guid", async () => {
    const { sync, canvasSync } = await boot();

    for (const path of HOSTILE_PATHS) await canvasSync.subscribe(path, "host");

    for (const path of HOSTILE_PATHS) {
      const guid = canvasSync.getCanvasGuid(path) as string;
      const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
      const meta = doc.getMap<unknown>(META_MAP_NAME);
      expect(meta.get(PATH_KEY)).toBe(path);
      expect(meta.get(GUID_KEY)).toBe(guid);
    }

    canvasSync.destroy();
  });

  it("the manifest holds one guid per path and no cross-links", async () => {
    const { manifest, canvasSync } = await boot();

    for (const path of HOSTILE_PATHS) await canvasSync.subscribe(path, "host");

    const mapped = HOSTILE_PATHS.map((p) => manifest.getCanvasGuid(p));
    expect(new Set(mapped).size).toBe(HOSTILE_PATHS.length);
    for (const guid of mapped) expect(typeof guid).toBe("string");
    expect(manifest.getCanvasGuid("vault/never-subscribed.canvas")).toBeNull();

    canvasSync.destroy();
  });
});
