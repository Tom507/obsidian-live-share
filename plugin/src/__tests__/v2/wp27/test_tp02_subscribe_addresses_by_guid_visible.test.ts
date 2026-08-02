// WP27 / AC1 — subscribing a canvas opens `__canvas__:<guid>`, stamps
// `meta.guid` / `meta.path`, and publishes the `path -> guid` mapping.
//
// The oracle is the SET of ids the sync manager was asked for, not "a doc came
// back". `getDoc` answers for any string, so "we got a handle" is true of the
// path-keyed implementation too; the discriminating observation is WHICH id was
// asked for, which is why the double records every request.
//
// The mint case is asserted for its PROPERTIES, never for its value: the guid is
// generated, so pinning a literal would either force a fixed generator into
// production or make the test a coin flip.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
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
  canvasIdsRequested,
  canvasJson,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager,
  createVault,
} from "./harness";

async function wire(preboundGuid: string | null) {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager();
  const manifest = await createManifest(vault, sync);
  const io = createMemoryIO();
  const sidecar = createSidecarStore(io);
  if (preboundGuid) manifest.setCanvasGuid(CANVAS_PATH, preboundGuid);
  const identity = createCanvasIdentityStore({ manifest, sidecar });
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    createFileOps() as never,
  );
  canvasSync.setIdentityStore(identity);
  return { vault, sync, manifest, sidecar, identity, canvasSync };
}

describe("WP27 AC1 — a canvas doc is addressed by its guid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a KNOWN guid is the only doc id ever asked for", async () => {
    const { sync, canvasSync } = await wire(FIXED_GUID);

    await canvasSync.subscribe(CANVAS_PATH, "host");

    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([canvasDocId(FIXED_GUID)]);
    // The exact shape the pre-WP27 code built. Named, so the absence above is a
    // refusal of THIS id and not an empty harness.
    expect(sync.requested).not.toContain(`${CANVAS_DOC_PREFIX}${CANVAS_PATH}`);
    expect(sync.synced).toContain(canvasDocId(FIXED_GUID));

    canvasSync.destroy();
  });

  it("`meta` carries the guid AND the path after the subscribe", async () => {
    const { sync, canvasSync } = await wire(FIXED_GUID);

    await canvasSync.subscribe(CANVAS_PATH, "host");

    const handle = sync.docs.get(canvasDocId(FIXED_GUID));
    expect(handle, "no doc exists under the guid id").toBeDefined();
    const meta = (handle as { doc: Y.Doc }).doc.getMap<unknown>(META_MAP_NAME);
    expect(meta.get(GUID_KEY)).toBe(FIXED_GUID);
    expect(meta.get(PATH_KEY)).toBe(CANVAS_PATH);

    canvasSync.destroy();
  });

  it("the manifest carries the `path -> guid` mapping after the subscribe", async () => {
    const { manifest, canvasSync } = await wire(FIXED_GUID);

    await canvasSync.subscribe(CANVAS_PATH, "host");

    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    // The mapping is an ATTRIBUTE of the path's entry, not a second keyspace.
    expect(manifest.getEntries().get(CANVAS_PATH)?.guid).toBe(FIXED_GUID);

    canvasSync.destroy();
  });

  it("a host with NO known guid mints one, binds it, and uses it as the doc id", async () => {
    const { sync, manifest, identity, canvasSync } = await wire(null);

    await canvasSync.subscribe(CANVAS_PATH, "host");

    const minted = canvasSync.getCanvasGuid(CANVAS_PATH);
    expect(typeof minted).toBe("string");
    expect((minted ?? "").trim().length).toBeGreaterThan(0);
    // A guid is not a path wearing a new name.
    expect(minted).not.toBe(CANVAS_PATH);
    expect(minted).not.toContain("/");
    expect(minted).not.toContain(".canvas");

    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual([
      canvasDocId(minted as string),
    ]);
    expect(await identity.guidForPath(CANVAS_PATH)).toBe(minted);
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(minted);

    canvasSync.destroy();
  });

  it("two different canvases get two different guids and two different docs", async () => {
    const second = "boards/other.canvas";
    const vault = createVault({
      [CANVAS_PATH]: canvasJson([NODE_A]),
      [second]: canvasJson([NODE_A]),
    });
    const sync = createSyncManager();
    const manifest = await createManifest(vault, sync);
    const sidecar = createSidecarStore(createMemoryIO());
    const canvasSync = new CanvasSync(
      vault as never,
      sync as never,
      createFileOps() as never,
    );
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));

    await canvasSync.subscribe(CANVAS_PATH, "host");
    await canvasSync.subscribe(second, "host");

    const a = canvasSync.getCanvasGuid(CANVAS_PATH);
    const b = canvasSync.getCanvasGuid(second);
    expect(a).not.toBe(b);
    expect(canvasIdsRequested(sync, CANVAS_DOC_PREFIX)).toEqual(
      [canvasDocId(a as string), canvasDocId(b as string)].sort(),
    );

    canvasSync.destroy();
  });
});
