// WP25 blind2 — the offline resolution, attacked through `index.json`'s SHAPE
// and through the unbind spelling nobody documented.
//
// The visible test states the R10 window as a discriminating pair; blind1 plays
// it with three clients. This one goes at the mapping itself, because the sidecar
// index is the thing WP25 adds to the resolution path and it is the thing that
// can be subtly wrong in ways every happy-path test passes:
//
//   ├── `index.json` is `guid -> path`, so resolving a PATH means scanning it by
//   │   VALUE. An implementation that read it as `path -> guid` resolves nothing
//   │   and quietly falls back to the manifest — i.e. it degrades to exactly the
//   │   wiring WP27 refused to ship, while looking wired.
//   ├── one path is named by exactly ONE guid. A stale second row survives a
//   │   rename and resolves peers to a board nobody is editing, and the scan
//   │   picks whichever row `Object.entries` happens to yield first.
//   └── `unbind` has no clean spelling: WP27's `Pick<ManifestManager,
//       "getCanvasGuid" | "setCanvasGuid">` exposes no delete, so a BLANK guid is
//       how the mapping is cleared — recorded only in an implementation report.
//       A future "tidy-up" into a real delete takes the manifest ENTRY with it.
//
// Every one of those is invisible while the manifest happens to be populated,
// which it is in every ordinary test — so the fixtures below keep it empty.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createSidecarStore } from "../../../../../plugin/src/files/canvas-sidecar";
import {
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const PATH = "studio/board.canvas";
const OTHER_PATH = "studio/other.canvas";
const GUID = "3ad9f60c81e74b25ac0e7f13d6b8925a";
const STALE_GUID = "cc71042ebd3f4986a15c7de0398b46f2";

function adapterDouble() {
  const bin = new Map<string, Uint8Array>();
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
  const map = new Map<string, string>([
    [PATH, JSON.stringify({ nodes: [], edges: [] })],
    [OTHER_PATH, JSON.stringify({ nodes: [], edges: [] })],
  ]);
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

const fileOps = { mutePathEvents() {}, unmutePathEvents() {}, isPathMuted: () => false };

async function boot(adapter: ReturnType<typeof adapterDouble>) {
  const vault = vaultDouble();
  const sync = syncDouble();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  const canvasSync = new CanvasSync(vault as never, sync as never, fileOps as never);
  const wiring = wireCanvasSidecar({
    canvasSync: canvasSync as never,
    manifest,
    io: createVaultSidecarIO(adapter),
  });
  return { vault, sync, manifest, canvasSync, wiring };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

const canvasIds = (sync: ReturnType<typeof syncDouble>): string[] => [
  ...new Set(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))),
];

describe("WP25 blind2 — index.json is guid → path, and it is scanned by VALUE", () => {
  it("a path is resolved from an index that holds several boards", async () => {
    // If the mapping were read as `path -> guid`, this lookup returns nothing
    // and the empty manifest sends the guest to the raw-text path.
    const adapter = adapterDouble();
    const io = createVaultSidecarIO(adapter);
    await createSidecarStore(io).writeIndex({
      [STALE_GUID]: OTHER_PATH,
      [GUID]: PATH,
      "0000000000000000000000000000dead": "studio/unrelated.canvas",
    });

    const boot1 = await boot(adapter);
    expect(boot1.manifest.getCanvasGuid(PATH)).toBeFalsy();

    await boot1.canvasSync.subscribe(PATH, "guest");
    await settle();

    expect(
      boot1.canvasSync.getCanvasGuid(PATH),
      "the index was not scanned by value — the path resolved to nothing",
    ).toBe(GUID);
    expect(canvasIds(boot1.sync)).toEqual([canvasDocId(GUID)]);

    await boot1.wiring.lifecycle.destroy();
    boot1.canvasSync.destroy();
  });

  it("the guid the index yields is the one the OTHER board does not use", async () => {
    // Discrimination: with several rows present, resolving "some guid" is not
    // the property; resolving THIS path's guid is.
    const adapter = adapterDouble();
    await createSidecarStore(createVaultSidecarIO(adapter)).writeIndex({
      [STALE_GUID]: OTHER_PATH,
      [GUID]: PATH,
    });

    const client = await boot(adapter);
    await client.canvasSync.subscribe(PATH, "guest");
    await client.canvasSync.subscribe(OTHER_PATH, "guest");
    await settle();

    expect(client.canvasSync.getCanvasGuid(PATH)).toBe(GUID);
    expect(client.canvasSync.getCanvasGuid(OTHER_PATH)).toBe(STALE_GUID);
    expect(canvasIds(client.sync).sort()).toEqual(
      [canvasDocId(GUID), canvasDocId(STALE_GUID)].sort(),
    );

    await client.wiring.lifecycle.destroy();
    client.canvasSync.destroy();
  });

  it("a rename leaves ONE row for the path, never two", async () => {
    // A second row pointing at the same path is what a naive rename leaves, and
    // a value scan then answers with whichever row comes out of `Object.entries`
    // first — i.e. non-deterministically, per session.
    const adapter = adapterDouble();
    const client = await boot(adapter);
    await client.canvasSync.subscribe(PATH, "host");
    await settle();
    const guid = client.canvasSync.getCanvasGuid(PATH) as string;

    const renamed = "studio/renamed.canvas";
    await client.canvasSync.handleRename(PATH, renamed);
    await settle();

    const index = await client.wiring.store.readIndex();
    expect(index, "the rename left a stale row behind").toEqual({ [guid]: renamed });
    expect(Object.values(index).filter((p) => p === PATH)).toEqual([]);

    await client.wiring.lifecycle.destroy();
    client.canvasSync.destroy();
  });

  it("unbind clears the guid with a BLANK value and keeps the manifest entry", async () => {
    // The one spelling `CanvasIdentityStore.unbind` has, recorded in WP27's
    // implementation report and nowhere in a signature. A "tidier" delete would
    // remove the file's manifest row along with its guid.
    const adapter = adapterDouble();
    const client = await boot(adapter);
    await createSidecarStore(createVaultSidecarIO(adapter)).writeIndex({ [GUID]: PATH });
    client.manifest.setCanvasGuid(PATH, GUID);
    expect(client.manifest.getEntries().has(PATH)).toBe(true);

    await client.wiring.identityStore.unbind(PATH);

    expect(client.manifest.getCanvasGuid(PATH)).toBeFalsy();
    expect(
      client.manifest.getEntries().has(PATH),
      "unbind removed the manifest ENTRY, not just its guid",
    ).toBe(true);
    expect(await client.wiring.store.readIndex()).toEqual({});

    await client.wiring.lifecycle.destroy();
    client.canvasSync.destroy();
  });

  it("bind is idempotent and rewrites nothing when the mapping already agrees", async () => {
    // `index.json` is rewritten in full on every change, and this runs on every
    // subscribe of every board. A bind that wrote unconditionally would rewrite
    // the file on every open — and, because WP26 excludes it from the manifest,
    // do so entirely invisibly.
    const adapter = adapterDouble();
    const io = createVaultSidecarIO(adapter);
    const store = createSidecarStore(io);
    await store.writeIndex({ [GUID]: PATH });
    const client = await boot(adapter);

    let writes = 0;
    const originalWriteBinary = adapter.writeBinary.bind(adapter);
    adapter.writeBinary = async (p: string, data: ArrayBuffer) => {
      if (p.endsWith("index.json")) writes += 1;
      return originalWriteBinary(p, data);
    };

    await client.wiring.identityStore.bind(GUID, PATH);
    await client.wiring.identityStore.bind(GUID, PATH);

    expect(writes, "an unchanged mapping rewrote index.json").toBe(0);
    expect(await store.readIndex()).toEqual({ [GUID]: PATH });

    await client.wiring.lifecycle.destroy();
    client.canvasSync.destroy();
  });
});
