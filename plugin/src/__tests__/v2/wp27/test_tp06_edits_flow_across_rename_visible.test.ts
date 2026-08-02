// WP27 / AC2 — edits continue to flow across the rename, in BOTH directions.
//
// The metadata half of AC2 (tp04) and the no-new-doc half (tp05) can both be
// satisfied by an implementation that re-points every map and then quietly stops
// working: the doc is intact, the mapping is right, and nothing reaches it. This
// point is the liveness half.
//
// Structured as a DIFFERENTIAL wherever it can be. The same edit is driven
// before and after the rename, and the pre-rename run is the positive control —
// without it, a post-rename assertion that finds nothing is indistinguishable
// from a fixture that never worked at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createSidecarStore } from "../../../files/canvas-sidecar";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  NODE_B,
  RENAMED_PATH,
  applyRemoteDelta,
  canvasJson,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager,
  createVault,
} from "./harness";

async function subscribedHost() {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager();
  const manifest = await createManifest(vault, sync);
  const sidecar = createSidecarStore(createMemoryIO());
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    createFileOps() as never,
  );
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));
  await canvasSync.subscribe(CANVAS_PATH, "host");
  return { vault, sync, canvasSync };
}

function nodeIds(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

function moveFile(vault: { files: Map<string, string> }, from: string, to: string): void {
  vault.files.set(to, vault.files.get(from) as string);
  vault.files.delete(from);
}

describe("WP27 AC2 — the data path survives the rename", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a LOCAL edit reaches the same doc before AND after the rename", async () => {
    const { vault, sync, canvasSync } = await subscribedHost();
    const doc = sync.docs.get(canvasDocId(FIXED_GUID))?.doc as Y.Doc;
    expect(doc, "no doc under the guid id").toBeDefined();

    // CONTROL — the mechanism works under the old path.
    vault.files.set(CANVAS_PATH, canvasJson([NODE_A, NODE_B]));
    await canvasSync.handleLocalModify(CANVAS_PATH);
    expect(nodeIds(doc), "the control edit never landed — fixture is unwired").toEqual([
      NODE_A.id,
      NODE_B.id,
    ]);

    // SUBJECT — the same mechanism under the new path.
    moveFile(vault, CANVAS_PATH, RENAMED_PATH);
    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    const third = { ...NODE_B, id: "n-c", text: "gamma", x: 800 };
    vault.files.set(RENAMED_PATH, canvasJson([NODE_A, NODE_B, third]));
    await canvasSync.handleLocalModify(RENAMED_PATH);

    expect(nodeIds(doc)).toEqual([NODE_A.id, NODE_B.id, "n-c"]);
    // …and it landed in the ORIGINAL doc, not a fresh one.
    expect(sync.docs.get(canvasDocId(FIXED_GUID))?.doc).toBe(doc);

    canvasSync.destroy();
  });

  it("a local edit addressed by the OLD path after the rename is not accepted", async () => {
    const { vault, sync, canvasSync } = await subscribedHost();
    const doc = sync.docs.get(canvasDocId(FIXED_GUID))?.doc as Y.Doc;

    moveFile(vault, CANVAS_PATH, RENAMED_PATH);
    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    // The stale path is no longer owned; driving it must not reopen it, and must
    // not create a second doc for the file under its old name.
    vault.files.set(CANVAS_PATH, canvasJson([NODE_A, NODE_B]));
    await canvasSync.handleLocalModify(CANVAS_PATH);

    expect(nodeIds(doc)).toEqual([NODE_A.id]);
    expect([...sync.docs.keys()]).not.toContain(canvasDocId(CANVAS_PATH));

    canvasSync.destroy();
  });

  it("a PEER delta after the rename is delivered under the NEW path", async () => {
    const { vault, sync, canvasSync } = await subscribedHost();
    const doc = sync.docs.get(canvasDocId(FIXED_GUID))?.doc as Y.Doc;

    const seen: Array<{ path: string; ids: string[] }> = [];
    canvasSync.setOnRemoteCanvasUpdate((path, data) => {
      seen.push({ path, ids: data.nodes.map((n) => String(n.id)).sort() });
    });

    moveFile(vault, CANVAS_PATH, RENAMED_PATH);
    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    applyRemoteDelta(doc, (peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set(NODE_B.id, record);
      for (const [key, value] of Object.entries(NODE_B)) record.set(key, value);
    });

    expect(seen.length, "the remote hook never fired after the rename").toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.path).toBe(RENAMED_PATH);
    expect(last.ids).toContain(NODE_B.id);

    canvasSync.destroy();
  });
});
