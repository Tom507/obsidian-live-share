// WP27 / AC3 blind2 — path-keying observed ACROSS a rename, which is where a
// guid-keyed shortcut is most tempting.
//
// Different angle: blind1 proves the registries discriminate between two
// canvases. This one proves they still track the PATH after the identity has
// been divorced from it — the exact moment at which "the guid is the real key,
// the path is just a label" starts to look like a simplification. Every lookup
// is performed twice, once before and once after the rename, and the verdict
// table is compared whole each time.
//
// The mute registry is exercised through a mute that spans the rename, because
// `FileOpsManager` is REFERENCE-COUNTED: an implementation that re-keyed it
// would either drop the count or double it, and both are visible here.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { FileOpsManager } from "../../../../../plugin/src/files/file-ops";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import { canvasOwned } from "../../../../../plugin/src/files/vault-events";

const BEFORE = "cards/inbox.canvas";
const AFTER = "cards/done/inbox.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "c", type: "text", x: 0, y: 0, width: 7, height: 7, text: "c" }],
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
  const files = new Map([[BEFORE, BODY]]);
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
  const sync = {
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
  await canvasSync.subscribe(BEFORE, "host");
  files.set(AFTER, files.get(BEFORE) as string);
  files.delete(BEFORE);
  return { vault, sync, canvasSync };
}

function verdicts(cs: CanvasSync, guid: string) {
  return {
    before: cs.isSubscribed(BEFORE),
    after: cs.isSubscribed(AFTER),
    guid: cs.isSubscribed(guid),
    docId: cs.isSubscribed(canvasDocId(guid)),
    ownedBefore: canvasOwned(BEFORE, cs),
    ownedAfter: canvasOwned(AFTER, cs),
    ownedDocId: canvasOwned(canvasDocId(guid), cs),
  };
}

describe("WP27 AC3 blind2 — the path stays the key across a rename", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the verdict table before and after the rename", async () => {
    const { canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(BEFORE) as string;

    expect(verdicts(canvasSync, guid)).toEqual({
      before: true,
      after: false,
      guid: false,
      docId: false,
      ownedBefore: true,
      ownedAfter: false,
      ownedDocId: false,
    });

    await canvasSync.handleRename(BEFORE, AFTER);

    expect(verdicts(canvasSync, guid)).toEqual({
      before: false,
      after: true,
      guid: false,
      docId: false,
      ownedBefore: false,
      ownedAfter: true,
      ownedDocId: false,
    });

    canvasSync.destroy();
  });

  it("the doc-handle lookup answers under the current path only", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(BEFORE) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc;

    expect(canvasSync.getCanvasDocHandle(BEFORE)?.doc).toBe(doc);

    await canvasSync.handleRename(BEFORE, AFTER);

    expect(canvasSync.getCanvasDocHandle(AFTER)?.doc).toBe(doc);
    expect(canvasSync.getCanvasDocHandle(BEFORE)).toBeNull();

    canvasSync.destroy();
  });

  it("the reference-counted mute registry keeps counting by path", () => {
    const fileOps = new FileOpsManager({} as never, {} as never);
    try {
      fileOps.mutePathEvents(BEFORE);
      fileOps.mutePathEvents(BEFORE);
      fileOps.mutePathEvents(AFTER);

      expect([fileOps.isPathMuted(BEFORE), fileOps.isPathMuted(AFTER)]).toEqual([true, true]);

      fileOps.unmutePathEvents(AFTER);
      expect([fileOps.isPathMuted(BEFORE), fileOps.isPathMuted(AFTER)]).toEqual([true, false]);

      fileOps.unmutePathEvents(BEFORE);
      expect(fileOps.isPathMuted(BEFORE)).toBe(true);
      fileOps.unmutePathEvents(BEFORE);
      expect(fileOps.isPathMuted(BEFORE)).toBe(false);
    } finally {
      fileOps.destroy();
    }
  });

  it("the disk-write memory is per path and does not follow the guid", async () => {
    const { canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(BEFORE) as string;

    await canvasSync.handleRename(BEFORE, AFTER);
    canvasSync.noteExternalDiskWrite(AFTER, BODY);

    expect(canvasSync.isRecentDiskWrite(AFTER)).toBe(true);
    expect(canvasSync.isRecentDiskWrite(BEFORE)).toBe(false);
    expect(canvasSync.isRecentDiskWrite(canvasDocId(guid))).toBe(false);

    canvasSync.destroy();
  });
});
