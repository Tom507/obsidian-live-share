// WP27 / AC2 blind2 — liveness across TWO renames, driven from the LOCAL side.
//
// Different angle: blind1 drives peer deltas; this one drives the local capture
// path (`handleLocalModify`) and does it after two consecutive renames, so an
// implementation that re-keys one map correctly and another only on the first
// hop is caught. Every hop carries a control edit first, so a hop that stops
// accepting edits is distinguishable from a fixture that never accepted any.
//
// The oracle is record MEMBERSHIP in the one doc plus the doc's own identity.
// No key is written by two authors anywhere in this file.

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
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const P0 = "drafts/story.canvas";
const P1 = "drafts/wip/story.canvas";
const P2 = "published/story.canvas";

function node(id: string, x: number, text: string) {
  return { id, type: "text", x, y: 0, width: 50, height: 30, text };
}

function body(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
}

const BASE = [node("a", 0, "a")];

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
  const files = new Map([[P0, body(BASE)]]);
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
  await canvasSync.subscribe(P0, "host");
  return { vault, sync, canvasSync };
}

function ids(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

function move(files: Map<string, string>, from: string, to: string) {
  files.set(to, files.get(from) as string);
  files.delete(from);
}

describe("WP27 AC2 blind2 — local capture survives two consecutive renames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an edit lands at every hop, always in the same doc", async () => {
    const { vault, sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(P0) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(doc).toBeDefined();

    // hop 0 — control, before any rename
    vault.files.set(P0, body([...BASE, node("b", 100, "b")]));
    await canvasSync.handleLocalModify(P0);
    expect(ids(doc), "the control edit never landed").toEqual(["a", "b"]);

    // hop 1
    move(vault.files, P0, P1);
    await canvasSync.handleRename(P0, P1);
    vault.files.set(P1, body([...BASE, node("b", 100, "b"), node("c", 200, "c")]));
    await canvasSync.handleLocalModify(P1);
    expect(ids(doc)).toEqual(["a", "b", "c"]);

    // hop 2
    move(vault.files, P1, P2);
    await canvasSync.handleRename(P1, P2);
    vault.files.set(
      P2,
      body([...BASE, node("b", 100, "b"), node("c", 200, "c"), node("d", 300, "d")]),
    );
    await canvasSync.handleLocalModify(P2);
    expect(ids(doc)).toEqual(["a", "b", "c", "d"]);

    // and it was ONE doc the whole time
    expect(sync.docs.get(canvasDocId(guid))?.doc).toBe(doc);
    expect(canvasSync.getCanvasGuid(P2)).toBe(guid);

    canvasSync.destroy();
  });

  it("a stale path stops being accepted at each hop", async () => {
    const { vault, sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(P0) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;

    move(vault.files, P0, P1);
    await canvasSync.handleRename(P0, P1);

    // Driving the retired path must not resurrect it or fork a second doc.
    vault.files.set(P0, body([...BASE, node("z", 900, "z")]));
    await canvasSync.handleLocalModify(P0);

    expect(ids(doc)).toEqual(["a"]);
    expect(canvasSync.isSubscribed(P0)).toBe(false);
    expect([...sync.docs.keys()]).not.toContain(canvasDocId(P0));

    canvasSync.destroy();
  });

  it("the ownership predicate follows the file through both hops", async () => {
    const { vault, canvasSync } = await boot();

    move(vault.files, P0, P1);
    await canvasSync.handleRename(P0, P1);
    expect([canvasSync.isSubscribed(P0), canvasSync.isSubscribed(P1)]).toEqual([false, true]);

    move(vault.files, P1, P2);
    await canvasSync.handleRename(P1, P2);
    expect([
      canvasSync.isSubscribed(P0),
      canvasSync.isSubscribed(P1),
      canvasSync.isSubscribed(P2),
    ]).toEqual([false, false, true]);

    canvasSync.destroy();
  });
});
