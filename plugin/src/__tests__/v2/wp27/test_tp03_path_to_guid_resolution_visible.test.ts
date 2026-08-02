// WP27 / AC1 — a client that knows only the PATH resolves the guid, and a client
// that CANNOT resolve one never seeds a second doc for the same file.
//
// The last `it` is the two-writer defect on the identity axis, and it is the
// reason the charter's mixed-version rule (§3) is load-bearing rather than
// decorative: the naive fallback for "I cannot find a guid for this path" is to
// mint one, which produces a SECOND doc for a file a peer is already editing.
// Both docs then look healthy, both converge internally, and the two halves of
// the user's canvas never meet again. No convergence oracle can see it — there
// is nothing to converge.
//
// Two resolution sources are asserted separately because they fail
// independently: the manifest (a peer published it) and `index.json` (this
// client wrote it before the last restart).

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarStore, sidecarIndexPath } from "../../../files/canvas-sidecar";
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
  canvasDocsAlive,
  canvasIdsRequested,
  canvasJson,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager,
  createVault,
} from "./harness";

async function wire() {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager();
  const manifest = await createManifest(vault, sync);
  const io = createMemoryIO();
  const sidecar = createSidecarStore(io);
  const identity = createCanvasIdentityStore({ manifest, sidecar });
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    createFileOps() as never,
  );
  canvasSync.setIdentityStore(identity);
  return { vault, sync, manifest, io, sidecar, identity, canvasSync };
}

describe("WP27 AC1 — resolving a guid from a bare path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves from the MANIFEST when a peer already published the mapping", async () => {
    const { sync, manifest, canvasSync } = await wire();
    // The peer's publication, and nothing else this client could have learned.
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);

    canvasSync.destroy();
  });

  it("resolves from `index.json` when the manifest has no mapping", async () => {
    const { sync, sidecar, io, canvasSync } = await wire();
    await sidecar.writeIndex({ [FIXED_GUID]: CANVAS_PATH });
    expect(io.files.has(sidecarIndexPath())).toBe(true);

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);

    canvasSync.destroy();
  });

  it("the index is read by VALUE — an unrelated guid for another path resolves nothing", async () => {
    const { sync, sidecar, canvasSync } = await wire();
    await sidecar.writeIndex({ [FIXED_GUID]: "boards/somebody-else.canvas" });

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBeNull();
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([]);

    canvasSync.destroy();
  });

  it("a guest that cannot resolve a guid seeds NO doc at all", async () => {
    const { sync, canvasSync } = await wire();

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBeNull();
    expect(canvasSync.isSubscribed(CANVAS_PATH)).toBe(false);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([]);
    expect(canvasDocsAlive(sync, CANVAS_DOC_PREFIX)).toEqual([]);
    // Not even under the old, path-shaped id.
    expect(sync.requested).not.toContain(`${CANVAS_DOC_PREFIX}${CANVAS_PATH}`);

    canvasSync.destroy();
  });

  it("and once the mapping ARRIVES it joins the peer's doc — never a second one", async () => {
    const { sync, manifest, canvasSync } = await wire();

    // Attempt 1: nothing is known yet.
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    expect(canvasDocsAlive(sync, CANVAS_DOC_PREFIX)).toEqual([]);

    // The peer's manifest entry lands (this is the "asks peers or the manifest"
    // half of AC1).
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    // EXACTLY ONE canvas doc has ever existed for this file, across both
    // attempts. This is the assertion the whole test point exists for.
    expect(canvasDocsAlive(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);

    canvasSync.destroy();
  });
});
