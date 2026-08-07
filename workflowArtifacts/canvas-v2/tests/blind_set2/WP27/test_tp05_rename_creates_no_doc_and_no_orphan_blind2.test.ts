// WP27 / AC2 blind2 — "no orphan" attacked from the PEER's side: an update
// authored before the rename must still be integrable after it.
//
// Different angle: instead of inspecting the local registry, this captures a
// real Yjs update from a peer replica BEFORE the rename and applies it to the
// doc AFTER. A doc that was torn down and re-created (the orphan case) either no
// longer exists under the id, or exists with a fresh state that the pre-rename
// update no longer composes with — the record either fails to appear or appears
// without the causal history it belonged to.
//
// Membership is the oracle, plus one value that has a single author. Nothing
// here writes the same key from two replicas, so no assertion depends on Yjs's
// `clientID` tiebreak.

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

const FROM = "studio/scene.canvas";
const TO = "studio/act-two/scene.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "s0", type: "text", x: 0, y: 0, width: 12, height: 12, text: "s0" }],
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
  const files = new Map([[FROM, BODY]]);
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
  const released: string[] = [];
  const sync = {
    docs,
    released,
    getDoc(id: string) {
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc(id: string) {
      released.push(id);
    },
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
  await canvasSync.subscribe(FROM, "host");
  files.set(TO, files.get(FROM) as string);
  files.delete(FROM);
  return { vault, sync, canvasSync };
}

describe("WP27 AC2 blind2 — an in-flight peer update survives the rename", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an update authored BEFORE the rename integrates AFTER it", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(doc).toBeDefined();

    // The peer forks from the pre-rename state and authors one record.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const record = new Y.Map<unknown>();
    peer.getMap<Y.Map<unknown>>("nodes").set("s1", record);
    record.set("id", "s1");
    record.set("type", "text");
    record.set("text", "authored before the rename");
    const inFlight = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc));
    peer.destroy();

    await canvasSync.handleRename(FROM, TO);

    // The relay delivers it late.
    const target = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(target, "the doc no longer exists under its guid — it was orphaned").toBe(doc);
    Y.applyUpdate(target, inFlight);

    const nodes = target.getMap<Y.Map<unknown>>("nodes");
    expect([...nodes.keys()].sort()).toEqual(["s0", "s1"]);
    expect(nodes.get("s1")?.get("text")).toBe("authored before the rename");

    canvasSync.destroy();
  });

  it("the canvas namespace never grows and nothing is released", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;

    await canvasSync.handleRename(FROM, TO);

    expect([...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([
      canvasDocId(guid),
    ]);
    expect(sync.released).toEqual([]);

    canvasSync.destroy();
  });

  it("unsubscribing the NEW path releases the guid id exactly once", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;

    await canvasSync.handleRename(FROM, TO);
    canvasSync.unsubscribe(TO);

    expect(sync.released.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([
      canvasDocId(guid),
    ]);

    canvasSync.destroy();
  });

  it("unsubscribing the OLD path after the rename releases nothing", async () => {
    const { sync, canvasSync } = await boot();

    await canvasSync.handleRename(FROM, TO);
    canvasSync.unsubscribe(FROM);

    expect(sync.released.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);
    expect(canvasSync.isSubscribed(TO)).toBe(true);

    canvasSync.destroy();
  });
});
