// WP27 / AC2 — a rename mid-session updates `meta.path`, the manifest mapping
// and `index.json`.
//
// Three destinations, three separate assertions, because they are written by
// three different mechanisms and any one of them can be forgotten without the
// other two noticing. The FOURTH assertion in each group is the one that makes
// them mean something: the guid must be UNCHANGED. A rename that also re-mints
// the identity would satisfy "the new path maps to a guid" perfectly while
// stranding every peer on the old one.
//
// `index.json` is exercised through WP24's own `SidecarStore`, so the JSON
// encoding is not re-implemented here and cannot silently agree with a wrong
// writer.

import { afterEach, describe, expect, it, vi } from "vitest";

import { GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import { CanvasSync, canvasDocId, createCanvasIdentityStore } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  RENAMED_PATH,
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
  const identity = createCanvasIdentityStore({ manifest, sidecar });
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(identity);
  await canvasSync.subscribe(CANVAS_PATH, "host");
  // The file moves on disk first; the handler runs afterwards.
  vault.files.set(RENAMED_PATH, vault.files.get(CANVAS_PATH) as string);
  vault.files.delete(CANVAS_PATH);
  return { vault, sync, manifest, sidecar, identity, canvasSync };
}

describe("WP27 AC2 — a rename is a metadata update", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("`meta.path` follows the file and `meta.guid` does not move", async () => {
    const { sync, canvasSync } = await subscribedHost();
    const doc = sync.docs.get(canvasDocId(FIXED_GUID))?.doc;
    expect(doc, "no doc under the guid id — the fixture never subscribed").toBeDefined();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    const meta = (doc as NonNullable<typeof doc>).getMap<unknown>(META_MAP_NAME);
    expect(meta.get(PATH_KEY)).toBe(RENAMED_PATH);
    expect(meta.get(GUID_KEY)).toBe(FIXED_GUID);

    canvasSync.destroy();
  });

  it("the manifest mapping moves to the new key and leaves none behind", async () => {
    const { manifest, canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect(manifest.getCanvasGuid(RENAMED_PATH)).toBe(FIXED_GUID);
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBeNull();

    canvasSync.destroy();
  });

  it("`index.json` re-points the SAME guid and mints no second one", async () => {
    const { sidecar, canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    const index = await sidecar.readIndex();
    expect(index[FIXED_GUID]).toBe(RENAMED_PATH);
    expect(Object.keys(index)).toEqual([FIXED_GUID]);
    expect(Object.values(index)).not.toContain(CANVAS_PATH);

    canvasSync.destroy();
  });

  it("the in-memory identity view follows the path too", async () => {
    const { canvasSync } = await subscribedHost();

    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

    expect(canvasSync.getCanvasGuid(RENAMED_PATH)).toBe(FIXED_GUID);
    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBeNull();

    canvasSync.destroy();
  });

  it("`ManifestManager.renameFile` carries the guid with the entry", async () => {
    // The production order runs `renameFile` (vault-events, host branch) before
    // the canvas handler. Asserted on its own because it is a DIFFERENT writer:
    // the one manifest writer that re-keys an entry without consulting anything.
    const { manifest, canvasSync } = await subscribedHost();

    manifest.renameFile(CANVAS_PATH, RENAMED_PATH);

    expect(manifest.getEntries().get(RENAMED_PATH)?.guid).toBe(FIXED_GUID);
    expect(manifest.getEntries().has(CANVAS_PATH)).toBe(false);

    // And running the canvas handler afterwards is idempotent, not a conflict.
    await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);
    expect(manifest.getCanvasGuid(RENAMED_PATH)).toBe(FIXED_GUID);
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBeNull();

    canvasSync.destroy();
  });
});
