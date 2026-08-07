// WP27 / AC1 blind1 — the migration interaction, attacked through an EDGE-BEARING
// V1 document instead of a single node.
//
// Different angle: `migrateV1ToV2` translates geometry AND endpoint registers and
// assigns `ord`s. A doc carrying two nodes and one edge therefore exercises three
// separate translation paths, and a stranded migration is visible as three
// distinct absences rather than one. The `ord` assignment is the sharpest of the
// three: it is the only one that must touch EVERY record, so a partially armed
// marker shows up as a subset rather than as nothing.
//
// The claim under test is narrow and ordering-neutral: after the identity has
// been stamped, `migrateV1ToV2` must still be able to complete. WP8's guard is
// the mere PRESENCE of a non-empty `meta`, and AC1 writes into that container —
// so an implementation that stamps first and migrates never leaves every V1 doc
// in the field permanently untranslated, silently.

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

const PATH = "legacy/old-board.canvas";
const GUID = "c0ffee00c0ffee00c0ffee00c0ffee00";

const V1_NODES: Record<string, unknown>[] = [
  { id: "v1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "left" },
  { id: "v2", type: "text", x: 300, y: 0, width: 100, height: 50, text: "right" },
];
const V1_EDGE = {
  id: "e1",
  fromNode: "v1",
  fromSide: "right",
  toNode: "v2",
  toSide: "left",
};

function buildV1Doc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const node of V1_NODES) {
      const record = new Y.Map<unknown>();
      nodes.set(String(node.id), record);
      for (const [k, v] of Object.entries(node)) record.set(k, v);
    }
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const edge = new Y.Map<unknown>();
    edges.set(V1_EDGE.id, edge);
    for (const [k, v] of Object.entries(V1_EDGE)) edge.set(k, v);
  });
  return doc;
}

function mkVault() {
  const files = new Map([[PATH, JSON.stringify({ nodes: V1_NODES, edges: [V1_EDGE] })]]);
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

async function bootOverV1() {
  const vault = mkVault();
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
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  manifest.setCanvasGuid(PATH, GUID);

  const v1 = buildV1Doc();
  docs.set(canvasDocId(GUID), { doc: v1, text: v1.getText("content"), awareness: {} });

  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(
    createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
  );
  return { canvasSync, doc: v1 };
}

describe("WP27 AC1 blind1 — an edge-bearing V1 doc still migrates after the stamp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PRE-CONDITION — the fixture really is un-migrated V1", () => {
    const doc = buildV1Doc();
    expect(doc.share.has(META_MAP_NAME)).toBe(false);
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("v1")?.get(V2_FIELD.pos)).toBeUndefined();

    migrateV1ToV2(doc);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );
    doc.destroy();
  });

  it("after the identity stamp all three translation paths still complete", async () => {
    const { canvasSync, doc } = await bootOverV1();

    await canvasSync.subscribe(PATH, "guest");
    expect(doc.getMap<unknown>(META_MAP_NAME).get(GUID_KEY)).toBe(GUID);

    migrateV1ToV2(doc);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );
    // geometry
    for (const id of ["v1", "v2"]) {
      expect(nodes.get(id)?.get(V2_FIELD.pos), `pos for ${id}`).toBeDefined();
      expect(nodes.get(id)?.get(V2_FIELD.size), `size for ${id}`).toBeDefined();
    }
    // endpoints
    expect(edges.get("e1")?.get(V2_FIELD.from)).toBeDefined();
    expect(edges.get("e1")?.get(V2_FIELD.to)).toBeDefined();
    // ords — every record, which is the sharpest of the three
    const ords = [...nodes.values(), ...edges.values()].map((r) => r.get(V2_FIELD.ord));
    expect(ords.length).toBe(3);
    for (const ord of ords) expect(typeof ord).toBe("string");

    canvasSync.destroy();
  });

  it("the stamped doc is not read as a foreign schema major", async () => {
    const { canvasSync, doc } = await bootOverV1();

    await canvasSync.subscribe(PATH, "guest");

    expect(isSchemaMajorMismatch(doc)).toBe(false);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(PATH_KEY)).toBe(PATH);

    canvasSync.destroy();
  });

  it("running the migration twice after the stamp is still a no-op", async () => {
    const { canvasSync, doc } = await bootOverV1();

    await canvasSync.subscribe(PATH, "guest");
    migrateV1ToV2(doc);
    const after = Array.from(Y.encodeStateVector(doc));
    migrateV1ToV2(doc);

    expect(Array.from(Y.encodeStateVector(doc))).toEqual(after);

    canvasSync.destroy();
  });
});
