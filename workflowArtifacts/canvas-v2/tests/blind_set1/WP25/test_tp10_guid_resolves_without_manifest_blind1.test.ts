// WP25 blind1 — the R10 ordering risk, played out with THREE clients.
//
// WP27's Escalation 2 named the failure: wiring the identity store
// manifest-only "would drop a guest that subscribes before the host's manifest
// entry has replicated into the R10 raw-text fallback — with no automatic
// retry."
//
// The visible test states that as a two-row discriminating pair. This one plays
// the actual race, because "never reason from two peers only": a host mints, a
// guest whose manifest HAS replicated joins, and a third guest whose manifest
// has NOT replicated joins from the same sidecar bytes. All three must land on
// ONE document id. A manifest-only wiring puts the third guest somewhere else —
// specifically nowhere, on the raw-text path — and the board quietly has one
// participant fewer for the rest of the session.
//
// The pair that stops this being a preference rather than a property: a guest
// with NOTHING resolvable anywhere must STILL open nothing. If the sidecar path
// made an unresolvable guest succeed, it would be minting on a guest, which is
// the two-document defect — a healthy converging replica the peer's healthy
// converging replica can never meet.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import {
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import { subscribeCanvasWithHandover } from "../../../../../plugin/src/files/vault-events";

const PATH = "atlas/tectonics.canvas";
const EMPTY_CANVAS = JSON.stringify({ nodes: [], edges: [] });

function adapterDouble(shared?: Map<string, Uint8Array>) {
  const bin = shared ?? new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  return {
    bin,
    async exists(p: string) {
      return bin.has(p) || dirs.has(p);
    },
    async mkdir(p: string) {
      dirs.add(p);
    },
    async readBinary(p: string) {
      const found = bin.get(p);
      if (!found) throw new Error(`ENOENT ${p}`);
      return found.buffer.slice(
        found.byteOffset,
        found.byteOffset + found.byteLength,
      ) as ArrayBuffer;
    },
    async writeBinary(p: string, data: ArrayBuffer) {
      bin.set(p, new Uint8Array(data.slice(0)));
    },
    async remove(p: string) {
      bin.delete(p);
    },
  };
}

function vaultDouble() {
  const map = new Map<string, string>([[PATH, EMPTY_CANVAS]]);
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

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const requested: string[] = [];
  return {
    docs,
    requested,
    getDoc(id: string) {
      requested.push(id);
      let handle = docs.get(id);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(id, handle);
      }
      return handle;
    },
    releaseDoc() {},
    async waitForSync() {},
  };
}

function backgroundSyncDouble() {
  const subscribed: string[] = [];
  return {
    subscribed,
    unsubscribe() {},
    async subscribe(path: string) {
      subscribed.push(path);
    },
  };
}

const fileOps = { mutePathEvents() {}, unmutePathEvents() {}, isPathMuted: () => false };

/** One client. `wired: "sidecar"` is WP25's wiring; `"manifest-only"` is WP27's refusal. */
async function client(
  adapter: ReturnType<typeof adapterDouble>,
  wired: "sidecar" | "manifest-only",
) {
  const vault = vaultDouble();
  const sync = syncDouble();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  const canvasSync = new CanvasSync(vault as never, sync as never, fileOps as never);
  const io: SidecarIO = createVaultSidecarIO(adapter);
  let destroy = async (): Promise<void> => {};
  if (wired === "sidecar") {
    const wiring = wireCanvasSidecar({ canvasSync: canvasSync as never, manifest, io });
    destroy = () => wiring.lifecycle.destroy();
  } else {
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: null }));
  }
  return { vault, sync, manifest, canvasSync, io, destroy };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

const canvasIds = (sync: ReturnType<typeof syncDouble>): string[] => [
  ...new Set(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))),
];

describe("WP25 blind1 — host and two guests land on one document", () => {
  it("the guest whose manifest has NOT replicated still joins the host's doc", async () => {
    // One shared vault directory, three separate clients.
    const disk = new Map<string, Uint8Array>();

    const host = await client(adapterDouble(disk), "sidecar");
    await host.canvasSync.subscribe(PATH, "host");
    await settle();
    const guid = host.canvasSync.getCanvasGuid(PATH) as string;
    expect(guid).toMatch(/^[0-9a-f]{32}$/);

    // Guest A: the manifest entry HAS replicated.
    const guestA = await client(adapterDouble(disk), "sidecar");
    guestA.manifest.setCanvasGuid(PATH, guid);
    await guestA.canvasSync.subscribe(PATH, "guest");
    await settle();

    // Guest B: the manifest entry has NOT replicated. Only `index.json` knows.
    const guestB = await client(adapterDouble(disk), "sidecar");
    expect(guestB.manifest.getCanvasGuid(PATH)).toBeFalsy();
    const backgroundSync = backgroundSyncDouble();
    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync: guestB.canvasSync,
    });
    await settle();

    expect(owned, "the lagging guest was dropped into the raw-text fallback").toBe(true);
    expect(backgroundSync.subscribed).toEqual([]);
    expect(guestB.canvasSync.getCanvasGuid(PATH)).toBe(guid);
    expect(canvasIds(host.sync)).toEqual(canvasIds(guestB.sync));
    expect(canvasIds(guestA.sync)).toEqual(canvasIds(guestB.sync));

    await host.destroy();
    await guestA.destroy();
    await guestB.destroy();
    host.canvasSync.destroy();
    guestA.canvasSync.destroy();
    guestB.canvasSync.destroy();
  });

  it("the SAME lagging guest, wired manifest-only, ends up on the text path", async () => {
    // The control. Identical bytes on disk, identical empty manifest; the only
    // difference is the wiring WP27 refused to ship.
    const disk = new Map<string, Uint8Array>();
    const host = await client(adapterDouble(disk), "sidecar");
    await host.canvasSync.subscribe(PATH, "host");
    await settle();
    await host.destroy();
    host.canvasSync.destroy();

    const lagging = await client(adapterDouble(disk), "manifest-only");
    const backgroundSync = backgroundSyncDouble();
    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync: lagging.canvasSync,
    });
    await settle();

    expect(owned).toBe(false);
    expect(backgroundSync.subscribed).toEqual([PATH]);
    expect(canvasIds(lagging.sync)).toEqual([]);
    // "no automatic retry": a second attempt fails identically, because nothing
    // about the client's state changed when the first one failed.
    const again = await subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync: lagging.canvasSync,
    });
    expect(again).toBe(false);

    lagging.canvasSync.destroy();
  });

  it("with NO mapping anywhere the guest opens nothing — the sidecar is not a mint", async () => {
    const guest = await client(adapterDouble(), "sidecar");
    const backgroundSync = backgroundSyncDouble();

    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync: guest.canvasSync,
    });
    await settle();

    expect(owned).toBe(false);
    expect(guest.canvasSync.getCanvasGuid(PATH)).toBeNull();
    expect(canvasIds(guest.sync)).toEqual([]);
    expect(backgroundSync.subscribed).toEqual([PATH]);

    await guest.destroy();
    guest.canvasSync.destroy();
  });

  it("the offline resolution is republished, so the window closes for everyone", async () => {
    // Reading the guid out of `index.json` puts it back into the manifest, which
    // is what stops the R10 window recurring on every session.
    const disk = new Map<string, Uint8Array>();
    const host = await client(adapterDouble(disk), "sidecar");
    await host.canvasSync.subscribe(PATH, "host");
    await settle();
    const guid = host.canvasSync.getCanvasGuid(PATH) as string;
    await host.destroy();
    host.canvasSync.destroy();

    const lagging = await client(adapterDouble(disk), "sidecar");
    await lagging.canvasSync.subscribe(PATH, "guest");
    await settle();

    expect(lagging.manifest.getCanvasGuid(PATH)).toBe(guid);
    expect(await createSidecarStore(lagging.io).readIndex()).toEqual({ [guid]: PATH });

    await lagging.destroy();
    lagging.canvasSync.destroy();
  });
});
