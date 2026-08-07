// WP25 / AC4 — "`coldOpen`'s existing ordering contract is preserved: it still
// runs after `waitForSync` and before `start()`."
//
// ANOTHER PURE ORDERING CLAIM, and a preservation one at that — which makes it
// the easiest AC in the WP to "verify" with a test that could never have failed.
// The end state after an attach is identical whether `coldOpen` ran before or
// after `start()`: the doc holds the seed either way and the file holds the
// projection either way. So the oracles here are, in order of strength:
//
//   1. THE SEQUENCE, across the whole lifecycle, in ONE trace:
//        sidecar load → waitForSync → coldOpen's file IO → persistence observer
//      Three of those four seams are things WP25 does not own, and the fourth
//      (`observeDeep` on the doc's `nodes` map) is spied on the SAME `Y.Map`
//      instance `CanvasPersistence`'s constructor reaches through `doc.getMap`,
//      so the spy sees the real `start()` and not a proxy of it.
//
//   2. THE CONSEQUENCE the ordering exists to produce (US5 AC17): on the
//      `seeded-from-file` branch, the one-time file→CRDT seed must not be
//      persisted straight back out. With the correct order the seed happens
//      before any observer exists, so NO write is ever scheduled. Swap the two
//      statements and the seed fires the observer and arms the debounce. That is
//      observable at the injected scheduler, with no timing at all.
//
// PRODUCTION LINE ↔ ASSERTION: `attachCanvasPersistence`
// (`canvas-persistence.ts`) is where the order is expressed —
// `const coldOpen = await persistence.coldOpen();` immediately followed by
// `persistence.start();`. Removing the `coldOpen()` line reddens the
// "coldOpen ran" assertion; swapping the two lines reddens BOTH the sequence
// assertion and the "no write was scheduled" assertion. The `waitForSync` half
// is expressed by the caller awaiting `CanvasSync.subscribe` before attaching,
// and by WP25's own sidecar load sitting ahead of `waitForSync` inside it.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type PersistenceIO, attachCanvasPersistence } from "../../../files/canvas-persistence";
import { createSidecarStore } from "../../../files/canvas-sidecar";
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
  createManualScheduler,
  createSidecarIO,
  createSyncManager,
  createTrace,
  createVault,
  firstContaining,
  seedRecord,
} from "./harness";

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function persistenceIO(trace: Trace, files: Map<string, string>): PersistenceIO {
  return {
    async read(path: string) {
      trace.push(`persistence:read:${path}`);
      return files.get(path) ?? "";
    },
    async write(path: string, content: string) {
      trace.push(`persistence:write:${path}`);
      files.set(path, content);
    },
    async exists(path: string) {
      trace.push(`persistence:exists:${path}`);
      return files.has(path);
    },
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };
}

/** Spy `observeDeep` on the SAME map instance `CanvasPersistence` will grab. */
function spyStart(doc: Y.Doc, trace: Trace): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const original = nodes.observeDeep.bind(nodes);
  (nodes as unknown as { observeDeep: (f: unknown) => void }).observeDeep = (f: unknown) => {
    trace.push("persistence:start");
    return original(f as never);
  };
}

async function subscribed(trace: Trace, fileContent: string) {
  const files = new Map<string, string>([[CANVAS_PATH, fileContent]]);
  const vault = createVault(Object.fromEntries(files));
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const io = createSidecarIO(trace);
  const store = createSidecarStore(io);
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));
  await canvasSync.subscribe(CANVAS_PATH, "guest");
  const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
  return { files, vault, sync, manifest, io, store, canvasSync, doc };
}

describe("WP25 AC4 — coldOpen still runs after waitForSync and before start()", () => {
  it("the four stages appear in exactly the contracted order", async () => {
    const trace = createTrace();
    const { doc, files, canvasSync } = await subscribed(trace, canvasJson([NODE_A]));

    // The spy is installed AFTER the subscribe, so `CanvasSync`'s own
    // `observeDeep` calls cannot be mistaken for the persistence writer's.
    spyStart(doc, trace);
    await attachCanvasPersistence(doc, persistenceIO(trace, files), CANVAS_PATH, {
      scheduler: createManualScheduler(),
    });

    const sidecarLoad = firstContaining(trace, "sidecar:exists:start:");
    const peerSync = firstContaining(trace, "sync:waitForSync:start:");
    const coldOpen = firstContaining(trace, "persistence:");
    const start = trace.indexOf("persistence:start");

    expect(sidecarLoad, `no sidecar activity\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(peerSync, `waitForSync never ran\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(coldOpen, `coldOpen performed no file IO\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(start, `start() was never called\n${trace.join("\n")}`).toBeGreaterThan(-1);

    expect(sidecarLoad, "the sidecar was loaded after peer sync (AC1)").toBeLessThan(peerSync);
    expect(peerSync, "coldOpen ran before waitForSync").toBeLessThan(coldOpen);
    expect(coldOpen, "start() ran before coldOpen").toBeLessThan(start);

    canvasSync.destroy();
  });

  it("the seed does not escape back to disk — the consequence the order protects", async () => {
    // US5 AC17, restated as an oracle with no timing in it. On the
    // `seeded-from-file` branch the seed is a real CRDT write; if `start()` had
    // already installed the observer, that write arms the debounce. The manual
    // scheduler makes "a timer was armed" directly countable.
    const trace = createTrace();
    const { doc, files, canvasSync } = await subscribed(trace, canvasJson([NODE_A]));
    // A guest subscribe seeds nothing, so the doc is empty and coldOpen takes
    // the `seeded-from-file` branch — which is the branch that writes.
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBe(0);

    const scheduler = createManualScheduler();
    const { coldOpen } = await attachCanvasPersistence(
      doc,
      persistenceIO(trace, files),
      CANVAS_PATH,
      { scheduler },
    );

    expect(coldOpen).toBe("seeded-from-file");
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBeGreaterThan(0);
    expect(
      scheduler.pending(),
      "the cold-open seed armed a disk write — start() ran before coldOpen",
    ).toBe(0);
    expect(
      trace.filter((entry) => entry.startsWith("persistence:write:")).length,
      "the cold-open seed was written straight back out",
    ).toBe(0);

    canvasSync.destroy();
  });

  it("the doc-wins branch still overwrites the stale file, exactly once", async () => {
    // The other coldOpen branch, unchanged by WP25. Pinned so a sidecar load
    // that populates the doc cannot silently move a board from
    // `seeded-from-file` to `doc-wins` without anyone noticing — that IS the
    // intended new behaviour for a returning client, and it must be visible.
    const trace = createTrace();
    const { doc, files, canvasSync } = await subscribed(trace, canvasJson([NODE_A]));
    seedRecord(doc, "nodes", NODE_B);

    const scheduler = createManualScheduler();
    const { coldOpen } = await attachCanvasPersistence(
      doc,
      persistenceIO(trace, files),
      CANVAS_PATH,
      { scheduler },
    );

    expect(coldOpen).toBe("doc-wins");
    // The file was NOT read on this branch (no file→CRDT input, I3/I9).
    expect(trace.filter((e) => e === `persistence:read:${CANVAS_PATH}`).length).toBe(0);
    expect(trace.filter((e) => e === `persistence:write:${CANVAS_PATH}`).length).toBe(1);
    expect(files.get(CANVAS_PATH)).toContain(NODE_B.id);

    canvasSync.destroy();
  });

  it("a returning client resumes from the sidecar and takes the doc-wins branch", async () => {
    // The Definition of Done, expressed through AC4's contract rather than
    // around it: the sidecar load happens inside `subscribe`, before
    // `waitForSync`, so by the time `coldOpen` runs the doc is NON-EMPTY and the
    // stale local file is overwritten from it. No reseed, no second document.
    const trace = createTrace();
    const io = createSidecarIO(trace);
    const store = createSidecarStore(io);
    const source = new Y.Doc();
    seedRecord(source, "nodes", NODE_B);
    await store.checkpoint(FIXED_GUID, source);
    source.destroy();

    const files = new Map<string, string>([[CANVAS_PATH, canvasJson([NODE_A])]]);
    const vault = createVault(Object.fromEntries(files));
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
    canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    await settle();
    const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;

    const { coldOpen } = await attachCanvasPersistence(
      doc,
      persistenceIO(trace, files),
      CANVAS_PATH,
      { scheduler: createManualScheduler() },
    );

    expect(
      coldOpen,
      "the returning client reseeded from the file instead of resuming its replica",
    ).toBe("doc-wins");
    expect(files.get(CANVAS_PATH)).toContain(NODE_B.id);

    canvasSync.destroy();
  });
});
