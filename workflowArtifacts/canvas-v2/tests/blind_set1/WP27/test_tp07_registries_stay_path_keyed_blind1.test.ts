// WP27 / AC3 blind1 — path-keying attacked with TWO canvases at once, so the
// test can see a registry that answers "some path" rather than "this path".
//
// Different angle: a single-canvas probe cannot distinguish a correctly
// path-keyed registry from one that ignores its argument and answers for the
// only thing it holds. Two subscribed canvases plus one unsubscribed one make
// the lookup discriminating: the registry must answer TRUE for two specific
// paths, FALSE for a third, and FALSE for both guid spellings of the first two.
//
// The whole verdict table is compared as one object, so an implementation that
// keyed by guid flips a row that a per-assertion read might not reach.

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

const ONE = "rooms/one.canvas";
const TWO = "rooms/two.canvas";
const ABSENT = "rooms/three.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "x", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x" }],
  edges: [],
});

function mkVault() {
  const files = new Map([
    [ONE, BODY],
    [TWO, BODY],
  ]);
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
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(
    createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
  );
  await canvasSync.subscribe(ONE, "host");
  await canvasSync.subscribe(TWO, "host");
  return { vault, sync, canvasSync };
}

describe("WP27 AC3 blind1 — two canvases make the path key discriminating", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the whole subscription verdict table", async () => {
    const { canvasSync } = await boot();
    const guidOne = canvasSync.getCanvasGuid(ONE) as string;
    const guidTwo = canvasSync.getCanvasGuid(TWO) as string;
    expect(guidOne).not.toBe(guidTwo);

    expect({
      one: canvasSync.isSubscribed(ONE),
      two: canvasSync.isSubscribed(TWO),
      absent: canvasSync.isSubscribed(ABSENT),
      guidOne: canvasSync.isSubscribed(guidOne),
      docIdOne: canvasSync.isSubscribed(canvasDocId(guidOne)),
      docIdTwo: canvasSync.isSubscribed(canvasDocId(guidTwo)),
    }).toEqual({
      one: true,
      two: true,
      absent: false,
      guidOne: false,
      docIdOne: false,
      docIdTwo: false,
    });

    canvasSync.destroy();
  });

  it("each path resolves to its OWN doc, never to the other one", async () => {
    const { sync, canvasSync } = await boot();
    const guidOne = canvasSync.getCanvasGuid(ONE) as string;
    const guidTwo = canvasSync.getCanvasGuid(TWO) as string;

    const docOne = sync.docs.get(canvasDocId(guidOne))?.doc;
    const docTwo = sync.docs.get(canvasDocId(guidTwo))?.doc;
    expect(docOne).not.toBe(docTwo);

    expect(canvasSync.getCanvasDocHandle(ONE)?.doc).toBe(docOne);
    expect(canvasSync.getCanvasDocHandle(TWO)?.doc).toBe(docTwo);
    expect(canvasSync.getCanvasDocHandle(ABSENT)).toBeNull();

    canvasSync.destroy();
  });

  it("`canvasOwned` verdicts, as one table", async () => {
    const { canvasSync } = await boot();
    const guidOne = canvasSync.getCanvasGuid(ONE) as string;

    expect(
      [ONE, TWO, ABSENT, "rooms/one.md", guidOne, canvasDocId(guidOne)].map((key) =>
        canvasOwned(key, canvasSync),
      ),
    ).toEqual([true, true, false, false, false, false]);

    canvasSync.destroy();
  });

  it("the mute registry counts by path and does not leak between two canvases", () => {
    const fileOps = new FileOpsManager({} as never, {} as never);
    try {
      fileOps.mutePathEvents(ONE);
      fileOps.mutePathEvents(ONE);

      expect([ONE, TWO, ABSENT].map((p) => fileOps.isPathMuted(p))).toEqual([
        true,
        false,
        false,
      ]);

      fileOps.unmutePathEvents(ONE);
      expect(fileOps.isPathMuted(ONE)).toBe(true); // still one claim outstanding
      fileOps.unmutePathEvents(ONE);
      expect(fileOps.isPathMuted(ONE)).toBe(false);
    } finally {
      fileOps.destroy();
    }
  });
});
