// WP25 blind1 — the inherited wiring gap, attacked at the BYTE LEVEL of the
// adapter and at the identity of the doc a SECOND PROCESS opens.
//
// Different angle from the visible test, which checks the adapter's method
// contract and the injected-store call. Here:
//
//   1. The adapter is fed all 256 byte values, in every position, through the
//      real WP24 store. `DataAdapter.append` is STRING-ONLY in Obsidian, and a
//      binary frame log routed through it comes back mangled: 0x80–0xFF each
//      become U+FFFD, the u32 length header still parses, and every payload is
//      silently garbage. That failure is invisible to any test whose fixtures
//      happen to be ASCII-safe, which is most of them.
//   2. The identity check is done across a SIMULATED RESTART. A wiring that
//      resolves a guid only from live memory looks perfect in one process; the
//      question that matters is whether the SECOND process opens the SAME
//      document, and the only thing that can answer it is `index.json` on the
//      adapter.
//   3. The source pin looks for the wiring's presence in `main.ts` from the
//      other direction — the identity store must be reachable from the plugin's
//      entry point, not merely exported by a module.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
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

const PATH = "atlas/plates.canvas";

const MAIN_SOURCE = readFileSync(
  new URL("../../../../../plugin/src/main.ts", import.meta.url),
  "utf8",
);
const MAIN_CODE = MAIN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1",
);

/** An Obsidian `DataAdapter` double with NO string surface whatsoever. */
function adapterDouble() {
  const bin = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  return {
    bin,
    dirs,
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

const fileOps = {
  mutePathEvents() {},
  unmutePathEvents() {},
  isPathMuted: () => false,
};

async function bootPlugin(adapter: ReturnType<typeof adapterDouble>) {
  const vault = vaultDouble({ [PATH]: JSON.stringify({ nodes: [], edges: [] }) });
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

describe("WP25 blind1 — the vault sidecar adapter is byte-exact", () => {
  it("all 256 byte values survive a write, an append and a read", async () => {
    const io = createVaultSidecarIO(adapterDouble());
    const path = `${SIDECAR_DIR}/bytes.bin`;
    const head = Uint8Array.from({ length: 256 }, (_, i) => i);
    const tail = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);

    await io.ensureDir(SIDECAR_DIR);
    await io.write(path, head);
    await io.append(path, tail);

    expect([...(await io.read(path))], "the adapter mangled a byte value").toEqual([
      ...head,
      ...tail,
    ]);
  });

  it("a real Yjs frame log round-trips through the adapter", async () => {
    // The consequence of the byte test, at the level that actually matters: a
    // mangled payload still parses as a frame and then fails to decode as Yjs,
    // which the store reports as CORRUPT — i.e. every returning client silently
    // loses its history.
    const adapter = adapterDouble();
    const store = createSidecarStore(createVaultSidecarIO(adapter));
    const guid = "3f7d21ba9c604e58ad13f6e0782c95b4";

    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
    for (let i = 0; i < 8; i++) {
      doc.transact(() => {
        const record = new Y.Map<unknown>();
        doc.getMap<Y.Map<unknown>>("nodes").set(`n-${i}`, record);
        record.set("id", `n-${i}`);
        record.set("text", `card ${i} éü✓🔥`);
      });
    }
    for (const update of updates) await store.append(guid, update);

    expect(adapter.bin.has(sidecarHistoryPath(guid))).toBe(true);
    const replica = new Y.Doc();
    const result = await store.load(guid, replica);
    expect(result.degradation, "the history came back undecodable").toBe("none");
    expect(result.historyEntriesApplied).toBe(updates.length);
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(
      [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
    );
    expect(replica.getMap<Y.Map<unknown>>("nodes").get("n-3")?.get("text")).toBe(
      doc.getMap<Y.Map<unknown>>("nodes").get("n-3")?.get("text"),
    );
  });
});

describe("WP25 blind1 — a second process opens the SAME document", () => {
  it("the guid minted in process one is what process two resolves", async () => {
    const adapter = adapterDouble();

    const first = await bootPlugin(adapter);
    await first.canvasSync.subscribe(PATH, "host");
    await settle();
    const guid = first.canvasSync.getCanvasGuid(PATH);
    expect(guid, "no identity was established at all").toMatch(/^[0-9a-f]{32}$/);
    const firstIds = first.sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX));
    await first.wiring.lifecycle.destroy();
    first.canvasSync.destroy();

    // Process two: fresh everything except the adapter's bytes, and — the point
    // — a fresh, EMPTY manifest, exactly as a restart before the host republishes.
    const second = await bootPlugin(adapter);
    expect(second.manifest.getCanvasGuid(PATH)).toBeFalsy();
    await second.canvasSync.subscribe(PATH, "guest");
    await settle();

    expect(
      second.canvasSync.getCanvasGuid(PATH),
      "the second process could not resolve the identity from index.json",
    ).toBe(guid);
    expect(second.sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual(
      firstIds,
    );
    expect(firstIds).toEqual([canvasDocId(guid as string)]);

    await second.wiring.lifecycle.destroy();
    second.canvasSync.destroy();
  });

  it("neither process ever asks for a PATH-keyed canvas doc", async () => {
    const adapter = adapterDouble();
    const boot = await bootPlugin(adapter);
    await boot.canvasSync.subscribe(PATH, "host");
    await settle();

    for (const id of boot.sync.requested) {
      expect(id, "a canvas doc was addressed by its path").not.toBe(
        `${CANVAS_DOC_PREFIX}${PATH}`,
      );
      if (id.startsWith(CANVAS_DOC_PREFIX)) {
        expect(id).not.toContain("/");
        expect(id).not.toContain(".canvas");
      }
    }

    await boot.wiring.lifecycle.destroy();
    boot.canvasSync.destroy();
  });

  it("`main.ts` reaches the wiring — an uncalled seam is what WP27 already shipped", () => {
    // WP27's `setIdentityStore` was correct, unit-proven and had NO PRODUCTION
    // CALLER, so its AC1/AC2 were true of the module and false of the plugin. A
    // behavioural test over an extracted unit cannot see that. `main.ts` holds
    // wiring only and has no test file, so its source is the pin.
    expect(MAIN_CODE, "main.ts does not import canvas-sidecar-lifecycle").toMatch(
      /import[\s\S]{0,200}?from\s+["'][^"']*canvas-sidecar-lifecycle["']/,
    );
    expect(MAIN_CODE, "main.ts never calls the sidecar wiring entry point").toMatch(
      /wireCanvasSidecar\s*\(/,
    );
  });
});
