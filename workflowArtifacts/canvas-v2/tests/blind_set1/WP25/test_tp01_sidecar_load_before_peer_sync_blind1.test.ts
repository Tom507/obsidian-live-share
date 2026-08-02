// WP25 / AC1 blind1 — the ordering claim attacked with a CRASH, not with a log.
//
// The visible test holds an IO call open and reads a call-order trace. This one
// never looks at an order at all. Instead peer sync is made to FAIL, and the
// question becomes: what did the doc contain at the moment the failure happened?
//
// "The sidecar is loaded before peer sync begins" has exactly one consequence
// that survives a crash: at every instant from the moment the doc exists, a
// replica that has already read its own history is what the peer meets. So a
// `waitForSync` that rejects must find — and leave behind — a doc that ALREADY
// carries the sidecar's records. An implementation that loads after peer sync
// leaves an EMPTY doc there, converges perfectly whenever the network happens to
// be healthy, and reseeds an unrelated replica exactly when it is not.
//
// A second, independent angle: `waitForSync` is handed a probe that records the
// doc's STATE VECTOR at entry. The sidecar was written by a different client, so
// its clientID entry is in that vector or it is not — a binary fact about the
// doc at a single instant, with no call ordering involved.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const PATH = "atlas/regions.canvas";
const GUID = "c41f7ba903e84d2f8ee15c7d4a6b0912";

function memoryIO(): SidecarIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async ensureDir() {},
    async exists(p: string) {
      return files.has(p);
    },
    async read(p: string) {
      const found = files.get(p);
      if (!found) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    async write(p: string, d: Uint8Array) {
      files.set(p, Uint8Array.from(d));
    },
    async append(p: string, d: Uint8Array) {
      const prev = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      files.set(p, out);
    },
    async truncate(p: string) {
      files.set(p, new Uint8Array(0));
    },
    async remove(p: string) {
      files.delete(p);
    },
  };
}

function vaultDouble(files: Record<string, string>) {
  const map = new Map(Object.entries(files));
  return {
    map,
    async read(file: { path: string }) {
      return map.get(file.path) ?? "";
    },
    async modify(file: { path: string }, content: string) {
      map.set(file.path, content);
    },
    async create(p: string, c: string) {
      map.set(p, c);
      return {};
    },
    getFiles: () => [],
    async createFolder() {
      return {};
    },
    getAllLoadedFiles: () => [],
    getAbstractFileByPath: (p: string) => (map.has(p) ? { path: p } : null),
    adapter: {
      async write(p: string, c: string) {
        map.set(p, c);
      },
    },
  };
}

interface SyncDouble {
  docs: Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>;
  seenAtSync: { docId: string; nodes: string[]; clients: number[] }[];
  getDoc(id: string): { doc: Y.Doc; text: Y.Text; awareness: unknown };
  releaseDoc(id: string): void;
  waitForSync(id: string): Promise<void>;
}

function syncDouble(mode: "ok" | "reject"): SyncDouble {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const seenAtSync: { docId: string; nodes: string[]; clients: number[] }[] = [];
  return {
    docs,
    seenAtSync,
    getDoc(id: string) {
      let handle = docs.get(id);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(id, handle);
      }
      return handle;
    },
    releaseDoc() {},
    async waitForSync(id: string) {
      const handle = docs.get(id);
      const doc = handle?.doc;
      seenAtSync.push({
        docId: id,
        nodes: doc ? [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort() : [],
        clients: doc ? [...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()] : [],
      });
      // Only the CANVAS doc's sync fails. The manifest rides on the same
      // manager and a blanket rejection would break the fixture instead of the
      // subject.
      if (mode === "reject" && id.startsWith(CANVAS_DOC_PREFIX)) {
        throw new Error("relay unreachable");
      }
    },
  };
}

/** A sidecar authored by a DIFFERENT client, so its clientID is identifiable. */
async function primeSidecar(io: SidecarIO): Promise<{ clientId: number; ids: string[] }> {
  const store = createSidecarStore(io);
  const author = new Y.Doc();
  author.transact(() => {
    const nodes = author.getMap<Y.Map<unknown>>("nodes");
    for (const id of ["r-north", "r-south"]) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("type", "text");
      record.set("text", id);
    }
  });
  await store.checkpoint(GUID, author);
  const clientId = author.clientID;
  author.destroy();
  return { clientId, ids: ["r-north", "r-south"] };
}

async function wire(mode: "ok" | "reject") {
  const io = memoryIO();
  const primed = await primeSidecar(io);
  const vault = vaultDouble({ [PATH]: JSON.stringify({ nodes: [], edges: [] }) });
  const sync = syncDouble(mode);
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  // FIXTURE ONLY — the observation channel, not the subject.
  //
  // `ManifestManager.connect` unconditionally does
  // `getDoc("__manifest__")` + `await waitForSync("__manifest__")`
  // (`manifest.ts:74-80`). In this fixture that runs during SETUP, before
  // `CanvasSync` even exists, so it can be neither early nor late relative to a
  // subscribe that has not started. But it lands in `seenAtSync` first, which
  // made `seenAtSync[0]` the MANIFEST's doc rather than the canvas doc — so the
  // AC1 assertions below sampled the wrong event and could not pass for ANY
  // implementation, correct or broken.
  //
  // The doc is still acquired through the real fake, so `docs` and every id the
  // manager was asked for are unchanged; only the manifest's own setup-time sync
  // wait is kept out of the ordering channel. No assertion, subject or name
  // changes. Same repair as the visible `wp25/harness.ts`.
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  manifest.setCanvasGuid(PATH, GUID);
  const store = createSidecarStore(io);
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    { mutePathEvents() {}, unmutePathEvents() {}, isPathMuted: () => false } as never,
  );
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));
  return { io, primed, sync, canvasSync };
}

describe("WP25 AC1 blind1 — peer sync meets a replica that has already read its history", () => {
  it("the doc handed to waitForSync already holds the sidecar's records", async () => {
    const { primed, sync, canvasSync } = await wire("ok");

    await canvasSync.subscribe(PATH, "guest");

    expect(sync.seenAtSync.length, "waitForSync was never reached").toBe(1);
    expect(sync.seenAtSync[0].docId).toBe(canvasDocId(GUID));
    expect(
      sync.seenAtSync[0].nodes,
      "peer sync began against an EMPTY replica — the sidecar was loaded too late",
    ).toEqual(primed.ids);

    canvasSync.destroy();
  });

  it("the foreign author's clientID is in the state vector at sync time", async () => {
    // A different fact about the same instant, and one that no re-seed from the
    // local file could produce: the sidecar was written by another client, so
    // its entry can only be present if the history was really replayed.
    const { primed, sync, canvasSync } = await wire("ok");

    await canvasSync.subscribe(PATH, "guest");

    expect(
      sync.seenAtSync[0].clients,
      "the sidecar author's clock was absent when peer sync began",
    ).toContain(primed.clientId);

    canvasSync.destroy();
  });

  it("a FAILED peer sync still leaves a loaded replica behind", async () => {
    // The crash form. If the load came after `waitForSync`, a rejection means it
    // never happened at all, and this client's next attempt starts from nothing.
    const { primed, sync, canvasSync } = await wire("reject");

    await canvasSync.subscribe(PATH, "guest");

    expect(canvasSync.isSubscribed(PATH), "a rejected sync must abandon the subscribe").toBe(
      false,
    );
    const handle = sync.docs.get(canvasDocId(GUID));
    expect(handle, "no doc was opened at all").toBeDefined();
    expect(
      [...(handle as { doc: Y.Doc }).doc.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the sidecar was never applied — the load ran after peer sync",
    ).toEqual(primed.ids);

    canvasSync.destroy();
  });

  it("the load is not a re-read of the vault file — the file is empty here", async () => {
    // Discrimination against "loaded" meaning "re-parsed the .canvas". The
    // fixture's file has no records at all, so everything in the doc came from
    // the sidecar.
    const { sync, canvasSync } = await wire("ok");

    await canvasSync.subscribe(PATH, "guest");

    const doc = (sync.docs.get(canvasDocId(GUID)) as { doc: Y.Doc }).doc;
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("r-north")?.get("text")).toBe("r-north");

    canvasSync.destroy();
  });
});
