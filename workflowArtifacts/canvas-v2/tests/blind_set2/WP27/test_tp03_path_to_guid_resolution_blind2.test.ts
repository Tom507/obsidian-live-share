// WP27 / AC1 blind2 — the "never a second doc" claim, driven from THREE clients
// sharing one relay rather than from one client twice.
//
// Different angle: the charter's own constraint says never to reason from two
// peers. Here a host and two guests join the same file in an order that puts one
// guest AHEAD of the mapping and one BEHIND it, which is the real mixed-version
// shape: guest-early cannot resolve, guest-late can. The oracle is the count of
// distinct canvas doc ids in the shared sync manager at the end — one.
//
// The failure this catches is invisible to convergence: every client is
// internally consistent, both docs converge perfectly, and the users simply
// never see each other's work.

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

const SHARED = "team/board.canvas";
const BODY = JSON.stringify({
  nodes: [{ id: "b1", type: "text", x: 0, y: 0, width: 8, height: 8, text: "b" }],
  edges: [],
});

function mkVault() {
  const files = new Map([[SHARED, BODY]]);
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

/** ONE relay: every client's `getDoc` lands in the same map. */
function mkRelay() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  return {
    docs,
    requested,
    getDoc(id: string) {
      requested.push(id);
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** Each client gets its OWN manifest replica and its OWN sidecar. */
async function client(relay: ReturnType<typeof mkRelay>, manifestSync: ReturnType<typeof mkRelay>) {
  const vault = mkVault();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(manifestSync as never);
  const canvasSync = new CanvasSync(
    vault as never,
    relay as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  canvasSync.setIdentityStore(
    createCanvasIdentityStore({ manifest, sidecar: createSidecarStore(mkIO()) }),
  );
  return { manifest, canvasSync };
}

function canvasIds(relay: ReturnType<typeof mkRelay>): string[] {
  return [...relay.docs.keys()].filter((id) => id.startsWith(CANVAS_DOC_PREFIX)).sort();
}

describe("WP27 AC1 blind2 — three clients, one file, one document", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a guest ahead of the mapping opens nothing; the late guest joins the host", async () => {
    const relay = mkRelay();
    const sharedManifestDoc = mkRelay(); // the manifest itself is shared state

    // GUEST-EARLY — joins before anybody published a mapping.
    const early = await client(relay, mkRelay());
    await early.canvasSync.subscribe(SHARED, "guest");
    expect(early.canvasSync.getCanvasGuid(SHARED)).toBeNull();
    expect(canvasIds(relay), "the early guest seeded a doc of its own").toEqual([]);

    // HOST — mints and publishes into the shared manifest.
    const host = await client(relay, sharedManifestDoc);
    await host.canvasSync.subscribe(SHARED, "host");
    const guid = host.canvasSync.getCanvasGuid(SHARED) as string;
    expect(typeof guid).toBe("string");

    // GUEST-LATE — its manifest replica is the same shared doc.
    const late = await client(relay, sharedManifestDoc);
    await late.canvasSync.subscribe(SHARED, "guest");
    expect(late.canvasSync.getCanvasGuid(SHARED)).toBe(guid);

    expect(canvasIds(relay)).toEqual([canvasDocId(guid)]);

    early.canvasSync.destroy();
    host.canvasSync.destroy();
    late.canvasSync.destroy();
  });

  it("the early guest joins the SAME doc once its manifest catches up", async () => {
    const relay = mkRelay();
    const sharedManifestDoc = mkRelay();

    const early = await client(relay, mkRelay());
    await early.canvasSync.subscribe(SHARED, "guest");

    const host = await client(relay, sharedManifestDoc);
    await host.canvasSync.subscribe(SHARED, "host");
    const guid = host.canvasSync.getCanvasGuid(SHARED) as string;

    // The early guest learns the mapping (its own manifest replica receives it).
    early.manifest.setCanvasGuid(SHARED, guid);
    await early.canvasSync.subscribe(SHARED, "guest");

    expect(early.canvasSync.getCanvasGuid(SHARED)).toBe(guid);
    expect(canvasIds(relay)).toEqual([canvasDocId(guid)]);
    expect(
      relay.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX)).every((id) => id === canvasDocId(guid)),
    ).toBe(true);

    early.canvasSync.destroy();
    host.canvasSync.destroy();
  });

  it("two guests that BOTH cannot resolve still open nothing between them", async () => {
    const relay = mkRelay();

    const g1 = await client(relay, mkRelay());
    const g2 = await client(relay, mkRelay());
    await g1.canvasSync.subscribe(SHARED, "guest");
    await g2.canvasSync.subscribe(SHARED, "guest");

    expect(canvasIds(relay)).toEqual([]);
    expect(g1.canvasSync.isSubscribed(SHARED)).toBe(false);
    expect(g2.canvasSync.isSubscribed(SHARED)).toBe(false);

    g1.canvasSync.destroy();
    g2.canvasSync.destroy();
  });
});
