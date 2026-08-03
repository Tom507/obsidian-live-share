// WP27 / AC1 — stamping the identity keys must not strand WP8's V1→V2 migration.
//
// This is the interaction a coder cannot derive from the charter, and it is a
// silent, permanent data defect rather than a test failure.
//
// `migrateV1ToV2` (canvas-schema.ts) uses THE PRESENCE OF A NON-EMPTY `meta` AS
// ITS ONE-SHOT MARKER: `if (readMeta(doc) !== undefined) return;`. AC1 adds three
// keys to that very container, and the identity stamp happens at SUBSCRIBE time,
// while the migration runs later, inside `CanvasPersistence.coldOpen` — which
// the wiring layer runs AFTER `subscribe` resolves. An implementation that
// writes `meta.guid` first therefore arms the marker before the migration has
// run, and every V1-shaped doc that arrives from a peer or a sidecar is left
// untranslated forever: no `schemaVersion`, no `pos`/`size` registers, no `ord`.
// Nothing throws, nothing logs, and every convergence oracle stays green.
//
// The assertion is deliberately neutral about WHERE the migration runs. It says
// only: after the identity has been stamped, `migrateV1ToV2` must still be able
// to do its job (or must already have done it). Both orderings pass; the one
// that strands it does not.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import {
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
  isSchemaMajorMismatch,
  migrateV1ToV2,
} from "../../../canvas/canvas-schema";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import { CanvasSync, canvasDocId, createCanvasIdentityStore } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  canvasJson,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager,
  createVault,
  seedV1Node,
} from "./harness";

/** A V1-shaped doc already sitting under the guid id, as a peer would send it. */
async function guestOverV1Doc() {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager();
  const manifest = await createManifest(vault, sync);
  const sidecar = createSidecarStore(createMemoryIO());
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);

  const doc = new Y.Doc();
  seedV1Node(doc, NODE_A);
  sync.docs.set(canvasDocId(FIXED_GUID), {
    doc,
    text: doc.getText("content"),
    awareness: {},
  });

  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));
  return { vault, sync, doc, canvasSync };
}

describe("WP27 AC1 — the identity stamp coexists with the V1→V2 migration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the pre-condition holds: an un-stamped V1 doc IS migratable", () => {
    // Control. Without it the main assertion below could pass against a fixture
    // whose doc was never V1-shaped in the first place.
    const doc = new Y.Doc();
    seedV1Node(doc, NODE_A);
    expect(doc.share.has(META_MAP_NAME)).toBe(false);

    migrateV1ToV2(doc);

    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);
    doc.destroy();
  });

  it("after the identity stamp the doc still reaches schema V2", async () => {
    const { doc, canvasSync } = await guestOverV1Doc();

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    const meta = doc.getMap<unknown>(META_MAP_NAME);
    expect(meta.get(GUID_KEY), "the identity was never stamped").toBe(FIXED_GUID);
    expect(meta.get(PATH_KEY)).toBe(CANVAS_PATH);

    // This is what the wiring layer does next, via `CanvasPersistence.coldOpen`.
    migrateV1ToV2(doc);

    expect(
      meta.get(SCHEMA_VERSION_KEY),
      "the identity stamp armed the migration marker and stranded the doc at V1",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);
    expect(isSchemaMajorMismatch(doc)).toBe(false);

    canvasSync.destroy();
  });

  it("and the records themselves were translated, not just the version stamped", async () => {
    const { doc, canvasSync } = await guestOverV1Doc();

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    migrateV1ToV2(doc);

    const record = doc.getMap<Y.Map<unknown>>("nodes").get(NODE_A.id);
    expect(record, "the fixture's V1 record disappeared").toBeDefined();
    expect(
      (record as Y.Map<unknown>).get(V2_FIELD.pos),
      "the geometry was never folded into the pos register",
    ).toBeDefined();
    expect((record as Y.Map<unknown>).get(V2_FIELD.size)).toBeDefined();
    expect(typeof (record as Y.Map<unknown>).get(V2_FIELD.ord)).toBe("string");

    canvasSync.destroy();
  });

  it("the identity keys survive the migration that runs after them", async () => {
    const { doc, canvasSync } = await guestOverV1Doc();

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    migrateV1ToV2(doc);

    const meta = doc.getMap<unknown>(META_MAP_NAME);
    expect(meta.get(GUID_KEY)).toBe(FIXED_GUID);
    expect(meta.get(PATH_KEY)).toBe(CANVAS_PATH);
    expect(meta.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    canvasSync.destroy();
  });

  it("a stamped doc is never mistaken for a foreign schema major", async () => {
    const { doc, canvasSync } = await guestOverV1Doc();

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    // `handleLocalModify` refuses to capture anything on a major mismatch. If
    // the stamp wrote something version-shaped into `meta`, local capture would
    // be silently disabled for every canvas.
    expect(isSchemaMajorMismatch(doc)).toBe(false);

    canvasSync.destroy();
  });
});
