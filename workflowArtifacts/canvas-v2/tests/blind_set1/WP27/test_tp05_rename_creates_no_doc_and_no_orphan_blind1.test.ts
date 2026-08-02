// WP27 / AC2 blind1 — "no new doc, no orphan" attacked through the DOC's OWN
// state rather than through the registry's key set.
//
// Different angle: the doc is given content before the rename, and the oracle is
// its Yjs STATE VECTOR plus its `clientID`. A re-created doc gets a fresh random
// `clientID` and an empty state vector; a re-created-and-refilled doc gets a
// different vector shape even when the visible content matches. Both survive a
// key-set comparison and both destroy every peer's un-flushed history, which is
// the damage the AC is actually about.
//
// The `clientID` is compared to ITSELF across the rename, never to a literal —
// it is `random.uint32()` and pinning a value would be a coin flip.
//
// STRENGTHENED (this batch, self-correction). The state-vector oracle originally
// read `toEqual(vectorBefore)` — "unchanged". That contradicts AC2: the rename
// MUST update `meta.path`, `meta` is a Yjs map, so the update IS a CRDT
// operation and the local clock cannot stay still. No correct implementation
// could satisfy it. The claim the test actually wants is not "nothing happened"
// but "the history was EXTENDED, never REPLACED, and by exactly AC2's one
// write" — see the assertion block below for the strictness delta.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const FROM = "wiki/graph.canvas";
const TO = "wiki/subfolder/graph.canvas";

const BODY = JSON.stringify({
  nodes: [
    { id: "g1", type: "text", x: 0, y: 0, width: 30, height: 30, text: "one" },
    { id: "g2", type: "text", x: 60, y: 0, width: 30, height: 30, text: "two" },
  ],
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
  const released: string[] = [];
  return {
    docs,
    released,
    getDoc(id: string) {
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc(id: string) {
      released.push(id);
    },
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
  vault.files.set(TO, vault.files.get(FROM) as string);
  vault.files.delete(FROM);
  return { vault, sync, canvasSync };
}

describe("WP27 AC2 blind1 — the document survives the rename intact", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clientID and state vector are unchanged across the rename", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(doc).toBeDefined();

    const clientIdBefore = doc.clientID;
    const vectorBefore = Y.decodeStateVector(Y.encodeStateVector(doc));
    const nodesBefore = [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
    expect(nodesBefore.length).toBeGreaterThan(0);

    await canvasSync.handleRename(FROM, TO);

    const after = sync.docs.get(canvasDocId(guid))?.doc as Y.Doc;
    expect(after.clientID).toBe(clientIdBefore);

    // ---- the "same replica" oracle -----------------------------------------
    // AC2's own words: the rename "updates `meta.path`". `meta` is a Y.Map, so
    // that update is a CRDT operation and this replica's clock MUST advance by
    // exactly one. The four assertions below say, together, that the history was
    // EXTENDED and not REPLACED, and that the extension is precisely AC2's one
    // write and nothing else.
    //
    // Strictness delta vs. the `toEqual(vectorBefore)` this replaces:
    //   kept    a re-created doc is still rejected — a fresh Y.Doc has no entry
    //           for `clientIdBefore` at all, so (1) and (4) both fail.
    //   kept    a re-created-and-refilled doc is still rejected — its clocks do
    //           not line up with the pre-rename ones, so (3)/(4) fail.
    //   GAINED  an implementation that performs SPURIOUS EXTRA writes, or that
    //           re-seeds the records during the rename, is now rejected by (4).
    //           "Unchanged" could not distinguish those from correct behaviour,
    //           because it was already red against BOTH.
    //   GAINED  an implementation that authors on a PEER's behalf, or that drops
    //           a peer's entry from the vector, is rejected by (1) and (3).
    const vectorAfter = Y.decodeStateVector(Y.encodeStateVector(after));
    /** AC2's rename writes `meta[PATH_KEY]` exactly once. There is no second write. */
    const RENAME_CRDT_WRITES = 1;

    // (1) no client entry vanished and none was invented
    expect(
      [...vectorAfter.keys()].sort(),
      "the rename changed WHICH replicas the doc knows about — it is not the same doc",
    ).toEqual([...vectorBefore.keys()].sort());
    // (2) the pre-rename vector is a strict ancestor: no clock ever moves backwards
    for (const [client, clock] of vectorBefore) {
      expect(
        vectorAfter.get(client) ?? -1,
        `clock for client ${client} went BACKWARDS — history was replaced, not extended`,
      ).toBeGreaterThanOrEqual(clock);
    }
    // (3) no PEER's clock moved — the rename authors nothing on anyone else's behalf
    for (const [client, clock] of vectorBefore) {
      if (client === clientIdBefore) continue;
      expect(vectorAfter.get(client), `the rename wrote as peer ${client}`).toBe(clock);
    }
    // (4) and this replica advanced by EXACTLY AC2's single `meta.path` write
    expect(
      (vectorAfter.get(clientIdBefore) as number) - (vectorBefore.get(clientIdBefore) as number),
      "the rename is not exactly one CRDT write: 0 means `meta.path` was never updated " +
        "(AC2 unmet), more than 1 means a spurious extra write or a re-seed of the records",
    ).toBe(RENAME_CRDT_WRITES);
    // -------------------------------------------------------------------------

    expect([...after.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(nodesBefore);
    expect(after.isDestroyed).toBe(false);

    canvasSync.destroy();
  });

  it("the canvas namespace holds exactly one doc before and after", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;

    const before = [...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX));
    expect(before).toEqual([canvasDocId(guid)]);

    await canvasSync.handleRename(FROM, TO);

    expect([...sync.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([
      canvasDocId(guid),
    ]);
    expect(sync.released.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);

    canvasSync.destroy();
  });

  it("ownership moves with the path and the handle answers under the new one", async () => {
    const { sync, canvasSync } = await boot();
    const guid = canvasSync.getCanvasGuid(FROM) as string;
    const doc = sync.docs.get(canvasDocId(guid))?.doc;

    await canvasSync.handleRename(FROM, TO);

    expect(canvasSync.isSubscribed(TO)).toBe(true);
    expect(canvasSync.isSubscribed(FROM)).toBe(false);
    expect(canvasSync.getCanvasDocHandle(TO)?.doc).toBe(doc);

    canvasSync.destroy();
  });
});
