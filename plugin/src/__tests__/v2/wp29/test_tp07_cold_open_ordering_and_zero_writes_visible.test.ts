// WP29 / AC4, second half — "the `coldOpen`-after-`waitForSync`-before-`start()`
// ordering is preserved."
//
// ORDERING CLAIMS NEED AN ORDERING ORACLE. The end state after an attach is
// identical whichever order the steps ran in: the doc holds the seed either way
// and the file holds the projection either way. An end-state check here could
// never fail, which is precisely why AC4 spells the ordering out.
//
// WP29 is the work package that inserts a NEW GUARD into `coldOpen`, and the
// guard needs an answer that is only correct after `waitForSync` has resolved —
// "does any peer know this doc?" cannot be answered before the peers have
// spoken. The realistic way to get that wrong is to move the measurement, or the
// whole cold open, earlier. So this file pins the sequence across the WP29
// branch as well as across the seeding branch, which is the case WP25's own AC4
// test does not cover (it has no knowledge to supply).
//
// TWO ORACLES, in decreasing strength:
//
//   1. THE SEQUENCE, in one trace: sidecar load -> waitForSync -> coldOpen's
//      file IO -> the persistence observer being installed. Three of the four
//      seams belong to modules WP29 does not own, and the fourth is spied on the
//      SAME `Y.Map` instance `CanvasPersistence`'s constructor reaches through
//      `doc.getMap`, so the spy sees the real `start()`.
//
//   2. THE CONSEQUENCE the ordering exists to produce (US5 AC17): the one-time
//      file->CRDT seed must not be persisted straight back out. With the correct
//      order the seed happens before any observer exists, so NO timer is armed.
//      That is countable at the injected scheduler with no timing in it.
//
// AND ONE PROPERTY WP29 MUST NOT BREAK: `CanvasPersistence` emits zero CRDT
// writes outside the seed (I3). Its new branch seeds nothing, so it must open no
// transaction at all — a guard that "marks" the doc as decided would violate the
// class's defining invariant.
//
// PRODUCTION LINE <-> ASSERTION: `attachCanvasPersistence`'s
// `const coldOpen = await persistence.coldOpen(); persistence.start();`.
// Swapping those two lines reddens both the sequence assertion and the
// no-timer-armed assertion.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import { CanvasSync, canvasDocId, createCanvasIdentityStore } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  type Trace,
  canvasJson,
  countTransactions,
  createFileOps,
  createManifest,
  createManualScheduler,
  createPersistenceIO,
  createSidecarIO,
  createSyncManager,
  createTrace,
  createVault,
  firstContaining,
  settle,
  textNode,
} from "./harness";

const FILE = canvasJson([textNode("f-1", 0, "on disk")]);

/** Spy `observeDeep` on the SAME map instance `CanvasPersistence` will grab. */
function spyStart(doc: Y.Doc, trace: Trace): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const original = nodes.observeDeep.bind(nodes);
  (nodes as unknown as { observeDeep: (f: unknown) => void }).observeDeep = (f: unknown) => {
    trace.push("persistence:start");
    return original(f as never);
  };
}

async function subscribedGuest(trace: Trace, peer?: (peer: Y.Doc) => void) {
  const files = new Map<string, string>([[CANVAS_PATH, FILE]]);
  const vault = createVault(Object.fromEntries(files));
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const store = createSidecarStore(createSidecarIO(trace));
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  if (peer) sync.peerHolds(canvasDocId(FIXED_GUID), peer);

  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));
  await canvasSync.subscribe(CANVAS_PATH, "guest");
  await settle();

  const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
  return { canvasSync, doc, files, sync };
}

/** A peer replica that holds the board but has no records on it. */
function clearedBoard(peer: Y.Doc): void {
  peer.transact(() => {
    peer.getMap<unknown>("meta").set("schemaVersion", 2);
  });
}

describe("WP29 AC4 — the coldOpen ordering contract is preserved", () => {
  it("the four stages still appear in the contracted order on the SEEDING branch", async () => {
    const trace = createTrace();
    const { canvasSync, doc, files } = await subscribedGuest(trace);
    spyStart(doc, trace);

    await attachCanvasPersistence(doc, createPersistenceIO(files, trace), CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: canvasSync.seedKnowledgeFor(CANVAS_PATH),
    });

    const sidecarLoad = firstContaining(trace, "sidecar:exists:start:");
    const peerSync = firstContaining(trace, "sync:waitForSync:start:");
    const coldOpen = firstContaining(trace, "persistence:exists:");
    const start = trace.indexOf("persistence:start");

    expect(sidecarLoad, `no sidecar activity\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(peerSync, `waitForSync never ran\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(coldOpen, `coldOpen performed no file IO\n${trace.join("\n")}`).toBeGreaterThan(-1);
    expect(start, `start() was never called\n${trace.join("\n")}`).toBeGreaterThan(-1);

    expect(sidecarLoad, "the sidecar was loaded after peer sync").toBeLessThan(peerSync);
    expect(peerSync, "coldOpen ran before waitForSync").toBeLessThan(coldOpen);
    expect(coldOpen, "start() ran before coldOpen").toBeLessThan(start);

    canvasSync.destroy();
  });

  it("the ordering also holds on WP29's own no-seed branch", async () => {
    // The branch WP25's AC4 test cannot reach: the doc is empty AND a peer knows
    // it, so `coldOpen` decides not to seed. It must still be called, still be
    // called after `waitForSync`, and still be called before `start()`.
    const trace = createTrace();
    const { canvasSync, doc, files } = await subscribedGuest(trace, clearedBoard);
    const knowledge = canvasSync.seedKnowledgeFor(CANVAS_PATH);
    expect(knowledge.peerKnowsDoc, "the fixture produced no peer knowledge").toBe(true);
    spyStart(doc, trace);

    const { coldOpen: outcome } = await attachCanvasPersistence(
      doc,
      createPersistenceIO(files, trace),
      CANVAS_PATH,
      { scheduler: createManualScheduler(), seedKnowledge: knowledge },
    );

    expect(outcome).toBe("empty");
    const peerSync = firstContaining(trace, "sync:waitForSync:start:");
    const start = trace.indexOf("persistence:start");
    expect(peerSync, "waitForSync never ran").toBeGreaterThan(-1);
    expect(start, "start() was never called on the no-seed branch").toBeGreaterThan(peerSync);

    canvasSync.destroy();
  });

  it("the seed does not escape back to disk — the consequence the order protects", async () => {
    const trace = createTrace();
    const { canvasSync, doc, files } = await subscribedGuest(trace);
    expect(doc.getMap<Y.Map<unknown>>("nodes").size, "the guest arrived with records").toBe(0);

    const scheduler = createManualScheduler();
    const io = createPersistenceIO(files, trace);
    const { coldOpen } = await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler,
      seedKnowledge: canvasSync.seedKnowledgeFor(CANVAS_PATH),
    });

    expect(coldOpen).toBe("seeded-from-file");
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBeGreaterThan(0);
    expect(
      scheduler.pending(),
      "the cold-open seed armed a disk write — start() ran before coldOpen",
    ).toBe(0);
    expect(io.writes, "the cold-open seed was written straight back out").toEqual([]);

    canvasSync.destroy();
  });

  it("the no-seed branch opens NO transaction on the doc (I3)", async () => {
    // `CanvasPersistence` emits zero CRDT writes; the seed is the single
    // exception and WP29's branch does not seed. A guard that recorded its own
    // verdict in the doc would break the class's defining invariant and would be
    // invisible to every projection-based oracle in this suite.
    const trace = createTrace();
    const { canvasSync, doc, files } = await subscribedGuest(trace, clearedBoard);
    const knowledge = canvasSync.seedKnowledgeFor(CANVAS_PATH);

    const transactions = await countTransactions(doc, async () => {
      const attached = await attachCanvasPersistence(
        doc,
        createPersistenceIO(files, trace),
        CANVAS_PATH,
        { scheduler: createManualScheduler(), seedKnowledge: knowledge },
      );
      expect(attached.coldOpen).toBe("empty");
    });

    expect(transactions, "the no-seed cold open wrote to the doc").toBe(0);
    expect(files.get(CANVAS_PATH), "the no-seed cold open rewrote the file").toBe(FILE);

    canvasSync.destroy();
  });

  it("`start()` still installs the observer, so later changes still persist", async () => {
    // The other direction of the same ordering: an implementation that "fixed"
    // the seed-escape by never calling `start()` on the no-seed branch would
    // leave the board with no writer at all.
    const trace = createTrace();
    const { canvasSync, doc, files } = await subscribedGuest(trace, clearedBoard);
    const scheduler = createManualScheduler();
    const io = createPersistenceIO(files, trace);
    await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler,
      seedKnowledge: canvasSync.seedKnowledgeFor(CANVAS_PATH),
    });

    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("later", record);
      for (const [k, v] of Object.entries(textNode("later", 0, "drawn after the join"))) {
        record.set(k, v);
      }
    });
    expect(scheduler.pending(), "no write was scheduled — the observer is not installed").toBe(1);
    scheduler.runAll();
    await settle();
    expect(files.get(CANVAS_PATH)).toContain("later");

    canvasSync.destroy();
  });
});
