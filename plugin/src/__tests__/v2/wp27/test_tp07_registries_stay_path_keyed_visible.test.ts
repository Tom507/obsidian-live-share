// WP27 / AC3 — the in-memory registries and the ownership predicate stay
// path-keyed, and are OBSERVED still working after the identity change.
//
// AC3 is a negative acceptance criterion, which is where a green suite is most
// often unable to fail. This file therefore never asserts "nothing broke". Every
// assertion is a positive path-keyed lookup performed AFTER a guid-addressed
// subscribe, paired with the guid-shaped key that must NOT answer:
//
//     isSubscribed(path)          -> true      isSubscribed(canvasDocId(guid)) -> false
//     getCanvasDocHandle(path)    -> the doc   getCanvasDocHandle(guid)        -> null
//     canvasOwned(path, cs)       -> true      canvasOwned(docId, cs)          -> false
//     isPathMuted(path)           -> true      isPathMuted(docId)              -> false
//
// The pairing is what makes it falsifiable: an implementation that re-keyed a
// registry by guid would flip BOTH columns, and an implementation that keyed by
// neither would fail the left column alone.
//
// The mute registry is the REAL `FileOpsManager`, not a double — a double's own
// `Map` would prove nothing about the registry the WP must leave alone.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarStore } from "../../../files/canvas-sidecar";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../files/canvas-sync";
import { FileOpsManager } from "../../../files/file-ops";
import { canvasOwned } from "../../../files/vault-events";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  canvasIdsRequested,
  canvasJson,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager,
  createVault,
} from "./harness";

/** Lazy so the module still COLLECTS before `canvasDocId` exists. */
function docId(): string {
  return canvasDocId(FIXED_GUID);
}

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

describe("WP27 AC3 — path-keying survives the guid identity change", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the subscription registry answers to the PATH and not to the doc id", async () => {
    const { canvasSync } = await subscribedHost();

    expect(canvasSync.isSubscribed(CANVAS_PATH)).toBe(true);
    expect(canvasSync.isSubscribed(docId())).toBe(false);
    expect(canvasSync.isSubscribed(FIXED_GUID)).toBe(false);

    canvasSync.destroy();
  });

  it("the doc-handle lookup takes a PATH and resolves it to the guid doc", async () => {
    const { sync, canvasSync } = await subscribedHost();

    expect(canvasSync.getCanvasDocHandle(CANVAS_PATH)?.doc).toBe(sync.docs.get(docId())?.doc);
    // An unknown path answers null WITHOUT conjuring a doc for it — the
    // create-on-demand behaviour must not leak back in through this door.
    expect(canvasSync.getCanvasDocHandle("boards/never-seen.canvas")).toBeNull();
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([docId()]);

    canvasSync.destroy();
  });

  it("the snapshot reader is still addressed by path", async () => {
    const { canvasSync } = await subscribedHost();

    const snapshot = canvasSync.getCanvasSnapshot(CANVAS_PATH);
    expect(snapshot?.nodes.map((n) => String(n.id))).toEqual([NODE_A.id]);
    expect(canvasSync.getCanvasSnapshot(docId())).toBeNull();

    canvasSync.destroy();
  });

  it("`canvasOwned` is unchanged: a `.canvas` PATH is owned, a doc id is not", async () => {
    const { canvasSync } = await subscribedHost();

    expect(canvasOwned(CANVAS_PATH, canvasSync)).toBe(true);
    expect(canvasOwned(docId(), canvasSync)).toBe(false);
    expect(canvasOwned(FIXED_GUID, canvasSync)).toBe(false);
    expect(canvasOwned("notes/journal.md", canvasSync)).toBe(false);
    expect(canvasOwned("boards/unowned.canvas", canvasSync)).toBe(false);
    expect(canvasOwned(CANVAS_PATH, null)).toBe(false);

    canvasSync.destroy();
  });

  it("the mute registry is still keyed by path", () => {
    const fileOps = new FileOpsManager({} as never, {} as never);
    try {
      fileOps.mutePathEvents(CANVAS_PATH);

      expect(fileOps.isPathMuted(CANVAS_PATH)).toBe(true);
      expect(fileOps.isPathMuted(docId())).toBe(false);
      expect(fileOps.isPathMuted(FIXED_GUID)).toBe(false);

      fileOps.unmutePathEvents(CANVAS_PATH);
      expect(fileOps.isPathMuted(CANVAS_PATH)).toBe(false);
    } finally {
      fileOps.destroy();
    }
  });

  it("the persistence-facing seams still take a path", async () => {
    const { canvasSync } = await subscribedHost();

    // `seedRefusalLedger` and `noteExternalDiskWrite` are the two seams
    // `CanvasPersistence` reaches CanvasSync through, and both are per-PATH.
    expect(canvasSync.seedRefusalLedger(CANVAS_PATH)).toBe(
      canvasSync.seedRefusalLedger(CANVAS_PATH),
    );
    expect(canvasSync.seedRefusalLedger(CANVAS_PATH)).not.toBe(
      canvasSync.seedRefusalLedger(docId()),
    );

    canvasSync.noteExternalDiskWrite(CANVAS_PATH, canvasJson([NODE_A]));
    expect(canvasSync.isRecentDiskWrite(CANVAS_PATH)).toBe(true);
    expect(canvasSync.isRecentDiskWrite(docId())).toBe(false);

    canvasSync.destroy();
  });
});
