// WP25 blind2 — the wiring gap, checked at the RENAME and at the module's
// import discipline.
//
// The visible test pins the adapter contract and the injected store; blind1
// pushes 256 byte values through the adapter and boots two processes. This one
// takes the second half of WP27's escalation — `handleRename(...)` has no
// production caller either — and asks what a rename actually costs when nobody
// calls it, then pins the call site.
//
// A rename with no `handleRename`:
//
//   ├── `index.json` keeps the OLD path under the guid, so the next session's
//   │   offline resolution answers for a file that no longer exists,
//   ├── `meta.path` keeps the old name, so every peer reads the wrong path, and
//   └── the class of failure is silent: the live session keeps working, because
//       the doc id never changed. It breaks on the NEXT restart, by which time
//       nothing points at the rename.
//
// The second half of the file pins WP25's own module discipline. WP25 consumes
// WP24's constants and WP27's names and re-spells NONE of them (Shared Ownership
// Contract §1) — no `.obsidian/liveshare/state` literal, no `__canvas__:`
// literal, no `"guid"` / `"path"` / `"epoch"` string, no hand-built sidecar path.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
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

const OLD_PATH = "studio/sketch.canvas";
const NEW_PATH = "studio/archive/sketch-final.canvas";

const LIFECYCLE_SOURCE = readFileSync(
  new URL("../../../../../plugin/src/files/canvas-sidecar-lifecycle.ts", import.meta.url),
  "utf8",
);
const VAULT_EVENTS_SOURCE = readFileSync(
  new URL("../../../../../plugin/src/files/vault-events.ts", import.meta.url),
  "utf8",
);

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIFECYCLE_CODE = stripComments(LIFECYCLE_SOURCE);
const VAULT_EVENTS_CODE = stripComments(VAULT_EVENTS_SOURCE);

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
  const map = new Map<string, string>([[OLD_PATH, JSON.stringify({ nodes: [], edges: [] })]]);
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
  const released: string[] = [];
  return {
    docs,
    requested,
    released,
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
    releaseDoc(id: string) {
      released.push(id);
    },
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

describe("WP25 blind2 — a rename survives a restart because handleRename is wired", () => {
  it("index.json, meta.path and the manifest all move; the doc does not", async () => {
    const adapter = adapterDouble();
    const first = await boot(adapter);
    await first.canvasSync.subscribe(OLD_PATH, "host");
    await settle();
    const guid = first.canvasSync.getCanvasGuid(OLD_PATH) as string;
    expect(guid).toMatch(/^[0-9a-f]{32}$/);
    const doc = (first.sync.docs.get(canvasDocId(guid)) as { doc: Y.Doc }).doc;

    await first.canvasSync.handleRename(OLD_PATH, NEW_PATH);
    await settle();

    // The doc is the SAME object under the SAME id — a rename is metadata.
    expect(first.sync.released, "the rename released the doc").toEqual([]);
    expect(
      [...new Set(first.sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX)))],
    ).toEqual([canvasDocId(guid)]);
    expect((first.sync.docs.get(canvasDocId(guid)) as { doc: Y.Doc }).doc).toBe(doc);

    // The three places the new name has to reach.
    expect(doc.getMap<unknown>(META_MAP_NAME).get(PATH_KEY)).toBe(NEW_PATH);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(GUID_KEY)).toBe(guid);
    expect(first.manifest.getCanvasGuid(NEW_PATH)).toBe(guid);
    expect(await first.wiring.store.readIndex()).toEqual({ [guid]: NEW_PATH });

    await first.wiring.lifecycle.destroy();
    first.canvasSync.destroy();
  });

  it("the NEXT session resolves the new path offline, and the old one not at all", async () => {
    // Where an unwired rename actually bites. In-session everything works; the
    // damage appears on the restart, when `index.json` is the only thing left.
    const adapter = adapterDouble();
    const first = await boot(adapter);
    await first.canvasSync.subscribe(OLD_PATH, "host");
    await settle();
    const guid = first.canvasSync.getCanvasGuid(OLD_PATH) as string;
    await first.canvasSync.handleRename(OLD_PATH, NEW_PATH);
    await settle();
    await first.wiring.lifecycle.destroy();
    first.canvasSync.destroy();

    const second = await boot(adapter);
    expect(second.manifest.getCanvasGuid(NEW_PATH)).toBeFalsy();
    await second.canvasSync.subscribe(NEW_PATH, "guest");
    await settle();

    expect(
      second.canvasSync.getCanvasGuid(NEW_PATH),
      "the renamed board could not be resolved after a restart",
    ).toBe(guid);
    expect(await second.wiring.store.readIndex()).toEqual({ [guid]: NEW_PATH });

    await second.wiring.lifecycle.destroy();
    second.canvasSync.destroy();
  });

  it("the vault rename handler calls handleRename, on the rename path", () => {
    // WP27 shipped this seam with no caller. A module test cannot see that.
    expect(
      VAULT_EVENTS_CODE,
      "vault-events.ts never calls handleRename — a rename is lost on the next restart",
    ).toMatch(/handleRename\s*\(/);
    const renameBlock = VAULT_EVENTS_CODE.slice(VAULT_EVENTS_CODE.indexOf('vault.on("rename"'));
    expect(renameBlock, "handleRename exists but not on the rename path").toMatch(
      /handleRename\s*\(/,
    );
  });
});

describe("WP25 blind2 — the lifecycle module re-spells nothing it consumes", () => {
  it("no sidecar directory, extension or filename literal", () => {
    // Shared Ownership Contract §1: WP24 owns these and WP25 imports them.
    expect(LIFECYCLE_CODE).not.toContain(".obsidian/liveshare/state");
    expect(LIFECYCLE_CODE).not.toMatch(/["']\.yhistory["']/);
    expect(LIFECYCLE_CODE).not.toMatch(/["']\.ycheckpoint["']/);
    expect(LIFECYCLE_CODE).not.toMatch(/["']index\.json["']/);
  });

  it("no doc-id prefix and no meta-key literal", () => {
    // WP27 owns these. `canvasDocId(guid)` is the sole constructor and the three
    // meta keys live in `canvas-schema.ts`.
    expect(LIFECYCLE_CODE).not.toContain("__canvas__:");
    // `"guid"` and `"epoch"` are checked rather than `"path"`: the first two are
    // meta keys and nothing else, while `path` is an ordinary identifier in this
    // module's own signatures and a quoted occurrence would be ambiguous.
    expect(LIFECYCLE_CODE).not.toMatch(/["']guid["']/);
    expect(LIFECYCLE_CODE).not.toMatch(/["']epoch["']/);
  });

  it("it imports the names it uses from their owning modules", () => {
    expect(LIFECYCLE_CODE).toMatch(/from\s+["']\.\/canvas-sidecar["']/);
    // and it never reaches for Obsidian directly — the vault adapter is
    // injected, exactly as WP24's `SidecarIO` is.
    expect(LIFECYCLE_CODE).not.toMatch(/from\s+["']obsidian["']/);
  });

  it("the tombstone container name is imported, not spelt", () => {
    expect(LIFECYCLE_CODE).not.toMatch(/getMap\s*[<(][^)]*["']deleted["']/);
  });
});
