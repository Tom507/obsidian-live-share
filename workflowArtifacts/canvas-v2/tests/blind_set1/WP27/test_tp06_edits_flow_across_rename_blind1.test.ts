// WP27 / AC2 blind1 — liveness across the rename, attacked from the REMOTE side
// and measured by convergence + membership rather than by a specific value.
//
// Different angle: a peer replica writes into the doc both before and after the
// rename, and the oracle is the MEMBERSHIP of the record set plus the fact that
// the observer fired under the new path. No contested key is ever written by two
// authors, so nothing here depends on Yjs's `clientID` tiebreak — the one value
// asserted (`text`) has a single author and a causal predecessor chain.
//
// The delivery hook is also checked for what it must NOT report: the OLD path.
// An implementation that re-points every map but leaves the observer closure
// bound to the pre-rename path keeps working and reports the wrong file, which
// is how a live view ends up patching a canvas the user is no longer looking at.

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

const FROM = "ideas/mind.canvas";
const TO = "ideas/2026/mind.canvas";

const BODY = JSON.stringify({
  nodes: [{ id: "m1", type: "text", x: 0, y: 0, width: 40, height: 40, text: "root" }],
  edges: [],
});

function mkVault() {
  const files = new Map([[FROM, BODY]]);
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

/** One peer writes one brand-new record. Single author, no contested key. */
function peerAdds(doc: Y.Doc, id: string, text: string): void {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  const record = new Y.Map<unknown>();
  replica.getMap<Y.Map<unknown>>("nodes").set(id, record);
  record.set("id", id);
  record.set("type", "text");
  record.set("x", 100);
  record.set("y", 100);
  record.set("width", 40);
  record.set("height", 40);
  record.set("text", text);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica));
  replica.destroy();
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
  await canvasSync.subscribe(FROM, "host");
  return { vault, sync, canvasSync };
}

describe("WP27 AC2 blind1 — peer deltas keep arriving after the rename", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the remote hook fires before and after, and reports the CURRENT path", async () => {
    const { vault, sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;

    const seen: string[] = [];
    canvasSync.setOnRemoteCanvasUpdate((path) => {
      seen.push(path);
    });

    peerAdds(doc, "m2", "before");
    expect(seen, "the hook never fired at all — fixture unwired").toContain(FROM);

    vault.files.set(TO, vault.files.get(FROM) as string);
    vault.files.delete(FROM);
    await canvasSync.handleRename(FROM, TO);

    const beforeCount = seen.length;
    peerAdds(doc, "m3", "after");

    expect(seen.length).toBeGreaterThan(beforeCount);
    expect(seen.slice(beforeCount)).toEqual([TO]);
    expect(seen.slice(beforeCount)).not.toContain(FROM);

    canvasSync.destroy();
  });

  it("membership converges and the single-author values survive", async () => {
    const { vault, sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;

    peerAdds(doc, "m2", "before");
    vault.files.set(TO, vault.files.get(FROM) as string);
    vault.files.delete(FROM);
    await canvasSync.handleRename(FROM, TO);
    peerAdds(doc, "m3", "after");

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    expect([...nodes.keys()].sort()).toEqual(["m1", "m2", "m3"]);
    expect(nodes.get("m2")?.get("text")).toBe("before");
    expect(nodes.get("m3")?.get("text")).toBe("after");

    canvasSync.destroy();
  });

  it("the snapshot reader answers under the new path and not the old one", async () => {
    const { vault, sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;

    vault.files.set(TO, vault.files.get(FROM) as string);
    vault.files.delete(FROM);
    await canvasSync.handleRename(FROM, TO);
    peerAdds(doc, "m9", "late");

    const snapshot = canvasSync.getCanvasSnapshot(TO);
    expect(snapshot?.nodes.map((n) => String(n.id)).sort()).toEqual(["m1", "m9"]);
    expect(canvasSync.getCanvasSnapshot(FROM)).toBeNull();

    canvasSync.destroy();
  });
});
