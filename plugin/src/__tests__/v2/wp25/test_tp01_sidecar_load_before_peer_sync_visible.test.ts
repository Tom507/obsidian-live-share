// WP25 / AC1 — "On subscribe the sidecar is loaded BEFORE peer sync begins, so
// the subsequent exchange is between related replicas."
//
// THE POINT OF THIS FILE: the end state is IDENTICAL under both orders. Load the
// sidecar first and then sync, or sync first and then load, and once both have
// finished the doc holds the union either way — Yjs merges are commutative, so
// the resulting document cannot tell you which happened first. An end-state
// oracle therefore CANNOT FAIL, and this WP's headline property would be pinned
// by nothing at all.
//
// So the oracle is the SEQUENCE, observed at two seams WP25 does not own:
//
//   ├── WP24's `SidecarIO` — every `exists` / `read` the load performs, traced
//   └── the sync manager's `waitForSync` — traced at start AND end
//
// and the pin is `sidecar:read:end` < `sync:waitForSync:start`. The strong form
// matters: "load STARTED first" is satisfied by an implementation that issues
// both concurrently and wins the race by luck of scheduling, which is exactly
// the shape that produces an unrelated replica on a slow disk. The blocking
// probe below kills that variant outright.
//
// The second half of AC1 — "so the subsequent exchange is between RELATED
// replicas" — is asserted as content, not as order: at the instant `waitForSync`
// is entered, the doc must ALREADY carry what the sidecar held. An
// implementation that loads first but into a different doc, or that discards the
// load result, passes the order pin and fails this one.
//
// PRODUCTION LINE ↔ ASSERTION (anti-vacuity): the assertions here are reddened
// by removing, or by moving after `waitForSync`, the single
// `await this.sidecar.load(guid, docHandle.doc)` statement that WP25 places in
// `CanvasSync.subscribe` between `getDoc(docId)` and
// `await this.syncManager.waitForSync(docId)`.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import { CanvasSync, canvasDocId, createCanvasIdentityStore } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  NODE_B,
  type Trace,
  canvasJson,
  createFileOps,
  createManifest,
  createSidecarIO,
  createSyncManager,
  createTrace,
  createVault,
  firstContaining,
  seedRecord,
} from "./harness";

/** A sidecar on disk holding one record, written by WP24's own store. */
async function primeSidecar(io: ReturnType<typeof createSidecarIO>): Promise<void> {
  const store = createSidecarStore(io);
  const source = new Y.Doc();
  seedRecord(source, "nodes", NODE_B);
  await store.checkpoint(FIXED_GUID, source);
  source.destroy();
}

async function wire(trace: Trace) {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const io = createSidecarIO(trace);
  const store = createSidecarStore(io);
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  const lifecycle = createSidecarLifecycle(store);
  canvasSync.setSidecarLifecycle(lifecycle);
  return { vault, sync, manifest, io, store, lifecycle, canvasSync };
}

describe("WP25 AC1 — the sidecar is loaded before peer sync begins", () => {
  it("the checkpoint read FINISHES before waitForSync is entered", async () => {
    const trace = createTrace();
    const io = createSidecarIO(trace);
    await primeSidecar(io);
    // Everything before the subscribe is fixture noise.
    trace.length = 0;

    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const store = createSidecarStore(io);
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
    canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    const loadEnd = trace.lastIndexOf(`sidecar:read:end:${sidecarCheckpointPath(FIXED_GUID)}`);
    const syncStart = firstContaining(trace, "sync:waitForSync:start:");

    expect(loadEnd, `the sidecar checkpoint was never read\n${trace.join("\n")}`).toBeGreaterThan(
      -1,
    );
    expect(syncStart, `waitForSync was never called\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(
      loadEnd,
      `the sidecar load did not finish before peer sync began\n${trace.join("\n")}`,
    ).toBeLessThan(syncStart);

    canvasSync.destroy();
  });

  it("peer sync does not begin while the sidecar read is still in flight", async () => {
    // This is the assertion that kills a CONCURRENT issue. Holding `read` open
    // and letting every ungated microtask drain proves that `waitForSync` is
    // sequenced BEHIND the load rather than merely losing a race to it.
    const trace = createTrace();
    const io = createSidecarIO(trace);
    await primeSidecar(io);
    trace.length = 0;

    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const store = createSidecarStore(io);
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
    canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));

    const release = io.block("read");
    const pending = canvasSync.subscribe(CANVAS_PATH, "guest");
    for (let i = 0; i < 40; i++) await Promise.resolve();

    expect(
      sync.synced,
      `waitForSync ran while the sidecar read was still open\n${trace.join("\n")}`,
    ).toEqual([]);

    release();
    await pending;

    expect(sync.synced).toContain(canvasDocId(FIXED_GUID));

    canvasSync.destroy();
  });

  it("the doc handed to waitForSync ALREADY carries the sidecar's records", async () => {
    // AC1's purpose clause: "so the subsequent exchange is between RELATED
    // replicas". Ordering alone does not deliver that — loading into the wrong
    // doc, or dropping the load result, keeps the order and loses the property.
    const trace = createTrace();
    const io = createSidecarIO(trace);
    await primeSidecar(io);

    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const store = createSidecarStore(io);
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);

    const seenAtSyncTime: string[][] = [];
    const traced = {
      ...sync,
      async waitForSync(docId: string) {
        const handle = sync.docs.get(docId);
        const nodes = handle ? [...handle.doc.getMap<Y.Map<unknown>>("nodes").keys()] : [];
        seenAtSyncTime.push(nodes.sort());
        return sync.waitForSync(docId);
      },
    };

    const canvasSync = new CanvasSync(vault as never, traced as never, createFileOps() as never);
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
    canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(seenAtSyncTime.length, "waitForSync was never reached").toBe(1);
    expect(
      seenAtSyncTime[0],
      "the sidecar's record was not in the doc when peer sync began",
    ).toEqual([NODE_B.id]);

    canvasSync.destroy();
  });

  it("a MISSING sidecar still subscribes, and still reads before it syncs", async () => {
    // The degradation path must not become the "load later" path: WP24 answers
    // MISSING for a guid with no files, and AC1's ordering still has to hold, or
    // the very first session of every board syncs before it loads and nobody
    // ever notices.
    const trace = createTrace();
    const { sync, canvasSync } = await wire(trace);

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    expect(canvasSync.isSubscribed(CANVAS_PATH)).toBe(true);
    const firstExists = firstContaining(trace, `sidecar:exists:start:`);
    const syncStart = firstContaining(trace, "sync:waitForSync:start:");
    expect(firstExists, `the sidecar was never consulted\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(firstExists).toBeLessThan(syncStart);
    expect(sync.synced).toEqual([canvasDocId(FIXED_GUID)]);

    canvasSync.destroy();
  });

  it("the load targets the guid's OWN sidecar paths, never a path-derived name", async () => {
    // WP25 consumes WP24's path helpers and never concatenates a path itself
    // (Shared Ownership Contract §1). A store that built
    // `.obsidian/liveshare/state/boards/board.canvas.yhistory` would still
    // "load before sync" and would resume nothing.
    const trace = createTrace();
    const { io, canvasSync } = await wire(trace);

    await canvasSync.subscribe(CANVAS_PATH, "guest");

    const touched = io.ops.map((op) => op.split(":").slice(1).join(":"));
    expect(touched).toContain(sidecarHistoryPath(FIXED_GUID));
    expect(touched).toContain(sidecarCheckpointPath(FIXED_GUID));
    for (const path of touched) {
      expect(path, `a sidecar path was built from the canvas path: ${path}`).not.toContain(
        ".canvas",
      );
    }

    canvasSync.destroy();
  });
});
