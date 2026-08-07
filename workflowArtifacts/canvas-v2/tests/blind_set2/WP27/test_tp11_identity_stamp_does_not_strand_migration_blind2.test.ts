// WP27 / AC1 blind2 — the identity stamp against an ALREADY-MIGRATED doc and
// against a FRESH one, i.e. the two cases blind1 does not cover.
//
// Different angle: blind1 asks whether a V1 doc still migrates after the stamp.
// This one asks the two neighbouring questions, both of which a naive fix breaks:
//
//   ├── an already-V2 doc must NOT be migrated a second time. `migrateV1ToV2`
//   │   is guarded on the presence of `meta`, so an implementation that "fixed"
//   │   the stranding problem by forcing the migration on every subscribe would
//   │   re-run `assignOrds` and re-stamp `schemaVersion`, emitting a delta to
//   │   every peer on every open, forever.
//   └── a brand-new empty doc must end up stamped with BOTH the identity and the
//       schema version, because nothing else will ever visit it.
//
// The no-op case is measured as a Yjs STATE VECTOR delta, which is the only
// oracle that distinguishes "wrote the same value" from "wrote nothing" — Yjs
// emits a real update for a same-value LWW `set`.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../../../plugin/src/canvas/canvas-registers";
import {
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
  isSchemaMajorMismatch,
  migrateV1ToV2,
} from "../../../../../plugin/src/canvas/canvas-schema";
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

const PATH = "vault/mixed.canvas";
const GUID = "beadfeedbeadfeedbeadfeedbeadfeed";

const NODES = [
  { id: "k1", type: "text", x: 0, y: 0, width: 60, height: 40, text: "k1" },
  { id: "k2", type: "text", x: 200, y: 0, width: 60, height: 40, text: "k2" },
];

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

function v1Doc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const node of NODES) {
      const record = new Y.Map<unknown>();
      nodes.set(String(node.id), record);
      for (const [k, v] of Object.entries(node)) record.set(k, v);
    }
  });
  return doc;
}

async function bootOver(existing: Y.Doc | null) {
  const files = new Map([[PATH, JSON.stringify({ nodes: NODES, edges: [] })]]);
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
  const sync = {
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
  if (existing) {
    docs.set(canvasDocId(GUID), {
      doc: existing,
      text: existing.getText("content"),
      awareness: {},
    });
  }
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  manifest.setCanvasGuid(PATH, GUID);
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(
    createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
  );
  return { sync, canvasSync };
}

describe("WP27 AC1 blind2 — the stamp against already-V2 and brand-new docs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an ALREADY-migrated doc is not migrated a second time by the stamp", async () => {
    const doc = v1Doc();
    migrateV1ToV2(doc);
    const ordsBefore = [...doc.getMap<Y.Map<unknown>>("nodes").values()].map((r) =>
      r.get(V2_FIELD.ord),
    );

    const { canvasSync } = await bootOver(doc);
    await canvasSync.subscribe(PATH, "guest");

    // The stamp is allowed to write the identity keys. It is NOT allowed to
    // re-run the translation.
    const ordsAfter = [...doc.getMap<Y.Map<unknown>>("nodes").values()].map((r) =>
      r.get(V2_FIELD.ord),
    );
    expect(ordsAfter).toEqual(ordsBefore);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );
    expect(doc.getMap<unknown>(META_MAP_NAME).get(GUID_KEY)).toBe(GUID);

    canvasSync.destroy();
  });

  it("a further migrateV1ToV2 after the stamp writes NOTHING", async () => {
    const doc = v1Doc();
    migrateV1ToV2(doc);

    const { canvasSync } = await bootOver(doc);
    await canvasSync.subscribe(PATH, "guest");

    const vectorBefore = Array.from(Y.encodeStateVector(doc));
    migrateV1ToV2(doc);
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(vectorBefore);

    canvasSync.destroy();
  });

  it("a brand-new empty doc ends up carrying identity AND a readable version", async () => {
    const { sync, canvasSync } = await bootOver(null);

    await canvasSync.subscribe(PATH, "host");

    const doc = sync.docs.get(canvasDocId(GUID))?.doc as Y.Doc;
    expect(doc, "the host never opened the guid doc").toBeDefined();

    // Whichever ordering the implementation chose, the doc must be readable by
    // the next client that opens it.
    migrateV1ToV2(doc);
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    expect(meta.get(GUID_KEY)).toBe(GUID);
    expect(meta.get(PATH_KEY)).toBe(PATH);
    expect(meta.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);
    expect(isSchemaMajorMismatch(doc)).toBe(false);

    canvasSync.destroy();
  });

  it("a V1 doc reached by the stamp is still translatable — the stranding case", async () => {
    const doc = v1Doc();
    const { canvasSync } = await bootOver(doc);

    await canvasSync.subscribe(PATH, "guest");
    migrateV1ToV2(doc);

    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "the identity stamp armed WP8's one-shot marker before the migration ran",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);
    for (const id of ["k1", "k2"]) {
      expect(doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(V2_FIELD.pos)).toBeDefined();
    }

    canvasSync.destroy();
  });
});
