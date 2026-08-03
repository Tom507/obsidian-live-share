// WP25 — the INHERITED WIRING GAP. Not in the charter; it arrives from
// `ImplementationReport_WP27.md` Escalation 2 and it is WP25's to close.
//
// WP27 shipped a TWO-MODE design. With an identity store injected, canvas docs
// are `__canvas__:<guid>` and `meta` is stamped. WITHOUT one, the canonical PATH
// is the identity token and `canvasDocId()` reproduces the pre-WP27 doc id byte
// for byte — deliberately, so ~40 pre-existing test files stayed green. WP27
// then left `setIdentityStore(...)` and `handleRename(...)` with NO PRODUCTION
// CALLER, because `createCanvasIdentityStore` needs a `SidecarIO` adapter that
// only WP25 can supply.
//
// The consequence is the reason this file is the highest-value one in the WP:
// WP27's AC1 and AC2 are true of the MODULE and not of the SHIPPED PLUGIN. That
// is precisely the class that reads DONE while being unobservable end to end —
// every WP27 test passes, every WP25 test could pass, and the plugin a user
// installs still addresses canvas docs by path.
//
// So this file pins the wiring itself, at three levels:
//
//   1. THE ADAPTER — `createVaultSidecarIO` over an Obsidian `DataAdapter`. This
//      is the piece WP24 deliberately did not ship (its AC4 forbids it to import
//      Obsidian or `node:fs`), and it is the piece whose absence blocked WP27.
//      Its `append` is the trap: `DataAdapter.append(path, data)` takes a
//      STRING, and a frame log is binary, so an adapter that reaches for it
//      mangles every payload through UTF-8 while the length headers still parse.
//   2. THE DECISION — `wireCanvasSidecar(...)`, the whole wiring as ONE testable
//      unit. `main.ts` may hold wiring only, never logic, and it HAS NO TEST
//      FILE; the precedent for extracting the decision is
//      `attachCanvasPersistence` (canvas-persistence.ts), which exists for
//      exactly this reason.
//   3. THE SHIPPED PLUGIN — a source-level pin that `main.ts` actually calls the
//      entry point and that `vault-events.ts` actually calls `handleRename`.
//      Level 2 without level 3 is what WP27 already shipped: a correct, tested,
//      uncalled seam.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by omitting the `wireCanvasSidecar(...)`
// call from `main.ts`, by omitting `canvasSync.setIdentityStore(...)` inside it,
// by building the store with `sidecar: null`, by an `append` that round-trips
// through a string, and by omitting the `handleRename` call from the vault
// rename handler.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { SIDECAR_DIR, createSidecarStore, sidecarIndexPath } from "../../../files/canvas-sidecar";
import {
  createSidecarLifecycle,
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "../../../files/canvas-sidecar-lifecycle";
import { CANVAS_DOC_PREFIX, CanvasSync, canvasDocId } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  canvasJson,
  createDataAdapter,
  createFileOps,
  createManifest,
  createSyncManager,
  createTrace,
  createVault,
} from "./harness";

const MAIN_SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
const VAULT_EVENTS_SOURCE = readFileSync(
  new URL("../../../files/vault-events.ts", import.meta.url),
  "utf8",
);

/** Comments may legitimately NAME a call; code may not merely mention it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MAIN_CODE = stripComments(MAIN_SOURCE);
const VAULT_EVENTS_CODE = stripComments(VAULT_EVENTS_SOURCE);

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("WP25 — the sidecar adapter WP24 could not ship", () => {
  it("createVaultSidecarIO satisfies the whole SidecarIO contract over an adapter", async () => {
    const adapter = createDataAdapter();
    const io = createVaultSidecarIO(adapter);

    await io.ensureDir(SIDECAR_DIR);
    expect(await io.exists(`${SIDECAR_DIR}/x.bin`)).toBe(false);
    await io.write(`${SIDECAR_DIR}/x.bin`, Uint8Array.from([1, 2, 3]));
    expect(await io.exists(`${SIDECAR_DIR}/x.bin`)).toBe(true);
    expect([...(await io.read(`${SIDECAR_DIR}/x.bin`))]).toEqual([1, 2, 3]);
    await io.truncate(`${SIDECAR_DIR}/x.bin`);
    expect([...(await io.read(`${SIDECAR_DIR}/x.bin`))]).toEqual([]);
    await io.remove(`${SIDECAR_DIR}/x.bin`);
    expect(await io.exists(`${SIDECAR_DIR}/x.bin`)).toBe(false);
  });

  it("append is BINARY-SAFE — every byte value survives, in order", async () => {
    // The trap. `DataAdapter.append` is string-only, and a frame log holds bytes
    // that are not valid UTF-8: 0x80–0xFF round-trip through the replacement
    // character and the payload is destroyed while the u32 length header still
    // parses, so the corruption reads as a valid frame carrying garbage.
    const adapter = createDataAdapter();
    const io = createVaultSidecarIO(adapter);
    const path = `${SIDECAR_DIR}/frames.bin`;

    const first = Uint8Array.from([0x00, 0x7f, 0x80, 0xfe, 0xff]);
    const second = Uint8Array.from([0xed, 0xa0, 0x80, 0x01]);
    await io.append(path, first);
    await io.append(path, second);

    expect([...(await io.read(path))]).toEqual([...first, ...second]);
  });

  it("append on an absent file creates it; truncate leaves the file in place", async () => {
    const adapter = createDataAdapter();
    const io = createVaultSidecarIO(adapter);
    const path = `${SIDECAR_DIR}/fresh.bin`;

    await io.append(path, Uint8Array.from([9, 8, 7]));
    expect([...(await io.read(path))]).toEqual([9, 8, 7]);

    await io.truncate(path);
    // WP24's contract: truncate reduces to zero bytes and LEAVES the file;
    // `remove` unlinks. A truncate that unlinked would make `exists` false and
    // the store would report MISSING instead of an empty (compacted) history.
    expect(await io.exists(path)).toBe(true);
    expect([...(await io.read(path))]).toEqual([]);
  });

  it("a whole WP24 store runs on the adapter, index.json included", async () => {
    // End-to-end over the real store: this is what `createCanvasIdentityStore`
    // needs and what did not exist before WP25.
    const adapter = createDataAdapter();
    const store = createSidecarStore(createVaultSidecarIO(adapter));

    const doc = new Y.Doc();
    doc.getMap<unknown>("nodes").set("n-1", "x");
    await store.append(FIXED_GUID, Y.encodeStateAsUpdate(doc));
    await store.checkpoint(FIXED_GUID, doc);
    await store.writeIndex({ [FIXED_GUID]: CANVAS_PATH });

    expect(await store.readIndex()).toEqual({ [FIXED_GUID]: CANVAS_PATH });
    expect(adapter.bin.has(sidecarIndexPath())).toBe(true);

    const replica = new Y.Doc();
    const result = await store.load(FIXED_GUID, replica);
    expect(result.degradation).toBe("none");
    expect([...replica.getMap<unknown>("nodes").keys()]).toEqual(["n-1"]);
  });
});

describe("WP25 — the identity store is wired, and the plugin uses guid identity", () => {
  it("wireCanvasSidecar injects BOTH the identity store and the lifecycle", async () => {
    const trace = createTrace();
    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const adapter = createDataAdapter();

    const injected: string[] = [];
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    const probe = {
      setIdentityStore: (store: unknown) => {
        injected.push("identity");
        canvasSync.setIdentityStore(store as never);
      },
      setSidecarLifecycle: (lifecycle: unknown) => {
        injected.push("lifecycle");
        canvasSync.setSidecarLifecycle(lifecycle as never);
      },
    };

    const wiring = wireCanvasSidecar({
      canvasSync: probe as never,
      manifest,
      io: createVaultSidecarIO(adapter),
    });

    expect(injected.sort()).toEqual(["identity", "lifecycle"]);
    expect(wiring.identityStore).toBeDefined();
    expect(wiring.lifecycle).toBeDefined();
    expect(wiring.store).toBeDefined();

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("the wired plugin addresses a canvas by GUID, never by path", async () => {
    // The behavioural half of "the shipped plugin actually uses guid identity".
    // The oracle is the SET of ids the sync manager was asked for: `getDoc`
    // answers for any string, so "a handle came back" is true of the path-keyed
    // implementation too.
    const trace = createTrace();
    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);

    const wiring = wireCanvasSidecar({
      canvasSync: canvasSync as never,
      manifest,
      io: createVaultSidecarIO(createDataAdapter()),
    });

    await canvasSync.subscribe(CANVAS_PATH, "host");
    await settle();

    const canvasIds = [...new Set(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX)))];
    expect(canvasIds.length, "no canvas doc was opened at all").toBe(1);
    expect(
      canvasIds[0],
      "the plugin is still addressing the canvas by its PATH — WP27 is not wired",
    ).not.toBe(`${CANVAS_DOC_PREFIX}${CANVAS_PATH}`);

    const guid = canvasSync.getCanvasGuid(CANVAS_PATH);
    expect(guid, "no guid was minted or resolved").toBeTruthy();
    expect(guid).toMatch(/^[0-9a-f]{32}$/);
    expect(canvasIds[0]).toBe(canvasDocId(guid as string));

    // and the mapping was published to BOTH stores, so the next session and any
    // peer can resolve it.
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(guid);
    expect(await wiring.store.readIndex()).toEqual({ [guid as string]: CANVAS_PATH });

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("a rename through handleRename re-points the mapping without a new doc", async () => {
    // WP27 AC2, now reachable because the store exists. The doc id is unchanged,
    // so `releaseDoc` must never be called and no second canvas id may appear.
    const trace = createTrace();
    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    const wiring = wireCanvasSidecar({
      canvasSync: canvasSync as never,
      manifest,
      io: createVaultSidecarIO(createDataAdapter()),
    });

    await canvasSync.subscribe(CANVAS_PATH, "host");
    await settle();
    const guid = canvasSync.getCanvasGuid(CANVAS_PATH) as string;
    const renamed = "boards/archive/plan.canvas";

    await canvasSync.handleRename(CANVAS_PATH, renamed);
    await settle();

    expect(canvasSync.getCanvasGuid(renamed)).toBe(guid);
    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBeNull();
    expect(sync.released, "the rename released the doc").toEqual([]);
    expect([...new Set(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX)))]).toEqual([
      canvasDocId(guid),
    ]);
    // `index.json` carries ONE row for the guid, under the NEW path — a stale
    // second row would resolve a peer to a board nobody is editing.
    expect(await wiring.store.readIndex()).toEqual({ [guid]: renamed });

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("`main.ts` actually calls the wiring — level 2 without level 3 is WP27's bug", () => {
    // WP27's seam was correct, tested and NEVER CALLED. A behavioural test over
    // an extracted unit cannot see that, and it is exactly the state this WP
    // exists to leave behind. `main.ts` has no test file of its own, so the pin
    // is its source.
    expect(MAIN_CODE, "main.ts does not import the sidecar wiring").toMatch(
      /from\s+["'][^"']*canvas-sidecar-lifecycle["']/,
    );
    expect(MAIN_CODE, "main.ts never calls wireCanvasSidecar(...)").toMatch(
      /\bwireCanvasSidecar\s*\(/,
    );
  });

  it("the vault rename handler actually calls handleRename", () => {
    expect(
      VAULT_EVENTS_CODE,
      "vault-events.ts never calls canvasSync.handleRename(...) — a rename still orphans the doc",
    ).toMatch(/canvasSync\??\.handleRename\s*\(/);
    // It has to run on the rename path, i.e. inside the `vault.on("rename", …)`
    // registration, not merely somewhere in the file.
    const renameBlock = VAULT_EVENTS_CODE.slice(VAULT_EVENTS_CODE.indexOf('vault.on("rename"'));
    expect(renameBlock, "handleRename is in the file but not on the rename path").toMatch(
      /handleRename\s*\(/,
    );
  });
});
