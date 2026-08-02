// WP27 / AC2 blind2 — the rename metadata, attacked with a destination that is
// a PREFIX SIBLING of the source and with a second, innocent canvas present.
//
// Different angle: `notes/plan.canvas` → `notes/plan-v2.canvas` is the shape a
// `startsWith`-based cleanup gets wrong, and a bystander canvas whose own
// mapping must not move is the shape a "rewrite the whole index" implementation
// gets wrong. The oracle for `index.json` is therefore the WHOLE object compared
// with `toEqual`, not a lookup of one key — that catches both the missed
// deletion and the collateral one in a single assertion.
//
// `meta.path` is read back through the doc rather than through any accessor, so
// an accessor that lies cannot mask a doc that was never written.

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

const SOURCE = "notes/plan.canvas";
const DESTINATION = "notes/plan-v2.canvas";
const BYSTANDER = "notes/plan-archive.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "q", type: "text", x: 2, y: 2, width: 9, height: 9, text: "q" }],
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
  const files = new Map([
    [SOURCE, BODY],
    [BYSTANDER, BODY],
  ]);
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
  const sidecar = createSidecarStore(mkIO());
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));
  await canvasSync.subscribe(SOURCE, "host");
  await canvasSync.subscribe(BYSTANDER, "host");
  files.set(DESTINATION, files.get(SOURCE) as string);
  files.delete(SOURCE);
  return { vault, sync, manifest, sidecar, canvasSync };
}

describe("WP27 AC2 blind2 — a prefix-sibling rename with a bystander present", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("`index.json` as a whole object: one row moved, one row untouched", async () => {
    const { sidecar, canvasSync } = await boot();
    const moved = canvasSync.getCanvasGuid(SOURCE) as string;
    const stayed = canvasSync.getCanvasGuid(BYSTANDER) as string;
    expect(moved).not.toBe(stayed);

    await canvasSync.handleRename(SOURCE, DESTINATION);

    expect(await sidecar.readIndex()).toEqual({
      [moved]: DESTINATION,
      [stayed]: BYSTANDER,
    });

    canvasSync.destroy();
  });

  it("the manifest as a whole: the bystander's mapping is untouched", async () => {
    const { manifest, canvasSync } = await boot();
    const moved = canvasSync.getCanvasGuid(SOURCE) as string;
    const stayed = canvasSync.getCanvasGuid(BYSTANDER) as string;

    await canvasSync.handleRename(SOURCE, DESTINATION);

    expect(manifest.getCanvasGuid(DESTINATION)).toBe(moved);
    expect(manifest.getCanvasGuid(SOURCE)).toBeNull();
    expect(manifest.getCanvasGuid(BYSTANDER)).toBe(stayed);

    canvasSync.destroy();
  });

  it("`meta.path` is read straight out of the doc and names the destination", async () => {
    const { sync, canvasSync } = await boot();
    const moved = canvasSync.getCanvasGuid(SOURCE) as string;
    const stayed = canvasSync.getCanvasGuid(BYSTANDER) as string;

    await canvasSync.handleRename(SOURCE, DESTINATION);

    const movedDoc = sync.docs.get(canvasDocId(moved))?.doc as Y.Doc;
    const stayedDoc = sync.docs.get(canvasDocId(stayed))?.doc as Y.Doc;

    expect(movedDoc.getMap<unknown>(META_MAP_NAME).get(PATH_KEY)).toBe(DESTINATION);
    expect(movedDoc.getMap<unknown>(META_MAP_NAME).get(GUID_KEY)).toBe(moved);
    // The bystander's own doc must not have been re-stamped in passing.
    expect(stayedDoc.getMap<unknown>(META_MAP_NAME).get(PATH_KEY)).toBe(BYSTANDER);

    canvasSync.destroy();
  });

  it("the bystander stays subscribed and reachable", async () => {
    const { canvasSync } = await boot();
    const stayed = canvasSync.getCanvasGuid(BYSTANDER) as string;

    await canvasSync.handleRename(SOURCE, DESTINATION);

    expect(canvasSync.isSubscribed(BYSTANDER)).toBe(true);
    expect(canvasSync.getCanvasGuid(BYSTANDER)).toBe(stayed);
    expect(canvasSync.getCanvasDocHandle(BYSTANDER)).not.toBeNull();

    canvasSync.destroy();
  });
});
