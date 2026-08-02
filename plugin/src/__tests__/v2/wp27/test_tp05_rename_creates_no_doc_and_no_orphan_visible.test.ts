// WP27 / AC2 — a rename creates no new doc and orphans no old one.
//
// Both claims are NEGATIVE, which is the class this project has repeatedly
// discovered cannot fail. Two instruments make them observable:
//
//   ├── the doc registry is COUNTED and its key set compared whole, before and
//   │   after. "A doc exists afterwards" is true of a re-created one too.
//   └── the `Y.Doc` OBJECT IDENTITY is compared with `toBe`. A rename that
//       tears down and re-opens the same id would keep every key set identical
//       and still lose every peer's un-flushed state; only reference identity
//       sees it.
//
// "No orphan" is asserted in two directions: the old doc was never released,
// AND it is still reachable — through the NEW path, which is the only way a
// user can get to it after the rename.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarStore } from "../../../files/canvas-sidecar";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  RENAMED_PATH,
  canvasDocsAlive,
  canvasIdsRequested,
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
  vault.files.set(RENAMED_PATH, vault.files.get(CANVAS_PATH) as string);
  vault.files.delete(CANVAS_PATH);
  return { vault, sync, canvasSync };
}

describe("WP27 AC2 — the rename moves no data and destroys no doc", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the doc registry is byte-for-byte the same set afterwards", async () => {
    const { sync, canvasSync } = await subscribedHost();
    const idsBefore = [...sync.docs.keys()].sort();
    const countBefore = sync.docs.size;

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect([...sync.docs.keys()].sort()).toEqual(idsBefore);
    expect(sync.docs.size).toBe(countBefore);
    expect(canvasDocsAlive(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);
    // Nothing under the new path's name, either as an id or as a prefixed id.
    expect(sync.requested).not.toContain(RENAMED_PATH);
    expect(sync.requested).not.toContain(`${CANVAS_DOC_PREFIX}${RENAMED_PATH}`);

    canvasSync.destroy();
  });

  it("it is the SAME `Y.Doc` instance, not an equal one", async () => {
    const { sync, canvasSync } = await subscribedHost();
    const before = sync.docs.get(canvasDocId(FIXED_GUID))?.doc;
    expect(before).toBeDefined();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect(sync.docs.get(canvasDocId(FIXED_GUID))?.doc).toBe(before);
    expect(canvasSync.getCanvasDocHandle(RENAMED_PATH)?.doc).toBe(before);
    expect((before as { isDestroyed: boolean }).isDestroyed).toBe(false);

    canvasSync.destroy();
  });

  it("the old doc is never released, so nothing is orphaned", async () => {
    const { sync, canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect(sync.released).not.toContain(canvasDocId(FIXED_GUID));
    expect(sync.released.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);

    canvasSync.destroy();
  });

  it("the subscription follows the path — new path owned, old path not", async () => {
    const { sync, canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect(canvasSync.isSubscribed(RENAMED_PATH)).toBe(true);
    expect(canvasSync.isSubscribed(CANVAS_PATH)).toBe(false);
    // Reading through the new path must not conjure a second doc.
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);

    canvasSync.destroy();
  });

  it("unsubscribing after the rename releases the GUID id, not a path id", async () => {
    const { sync, canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);
    canvasSync.unsubscribe(RENAMED_PATH);

    expect(sync.released).toContain(canvasDocId(FIXED_GUID));
    expect(sync.released).not.toContain(`${CANVAS_DOC_PREFIX}${RENAMED_PATH}`);
    expect(sync.released).not.toContain(`${CANVAS_DOC_PREFIX}${CANVAS_PATH}`);

    canvasSync.destroy();
  });
});
