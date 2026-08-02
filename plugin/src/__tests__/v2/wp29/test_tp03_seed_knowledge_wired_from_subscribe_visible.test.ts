// WP29 / AC1, the WIRING half — the two conditions are not constants a caller
// invents, they are things `CanvasSync.subscribe` LEARNS.
//
// tp01 pins the decision and tp02 pins that `coldOpen` obeys it. Both take the
// knowledge as an argument, so both are satisfied in full by a plugin in which
// nothing ever computes that knowledge and every cold open is handed
// `NOTHING_KNOWS_DOC`. That plugin has R4. This test is the one that says the
// two conditions are actually observed.
//
// THE TWO CONDITIONS ARE VARIED INDEPENDENTLY, which is why the sync-manager
// double hands over peer state INSIDE `waitForSync` rather than pre-populating
// the doc. Pre-populating cannot distinguish "a peer knows this board" from "the
// doc is non-empty" — and the second is the condition that already existed.
//
//   sidecarKnowsDoc  <- the sidecar load for this path's guid replayed a replica
//                       (a checkpoint and/or at least one history frame).
//   peerKnowsDoc     <- this replica GAINED state across `waitForSync`.
//
// THE LAST TEST IS THE POINT OF THE WHOLE WORK PACKAGE. A user clears a board;
// the sidecar faithfully records that it is now empty; the same client rejoins
// with last week's `.canvas` file still on disk. The doc is empty, so the
// pre-WP29 emptiness test reads "nobody has ever seen this board" and pushes
// last week's cards back in. Nothing in the doc, the file, or the sidecar is
// corrupt — the seed decision is simply asked the wrong question.
//
// PRODUCTION LINE <-> ASSERTION: `CanvasSync.seedKnowledgeFor(path)` and the two
// measurements inside `subscribe` that fill it — the `SidecarLoadResult` the
// sidecar load already returns and is currently discarded, and the state-vector
// comparison across `await this.syncManager.waitForSync(docId)`. Dropping either
// measurement reddens two of the four rows below.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME } from "../../../canvas/canvas-schema";
import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import { CanvasSync, canvasDocId, createCanvasIdentityStore } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  canvasJson,
  createFileOps,
  createManifest,
  createManualScheduler,
  createPersistenceIO,
  createSidecarIO,
  createSyncManager,
  createTrace,
  createVault,
  settle,
  surviving,
  textNode,
} from "./harness";

const STALE_FILE = canvasJson([textNode("old-1", 0, "last week"), textNode("old-2", 300, "also")]);

interface Options {
  /** Give the sidecar a checkpoint of `build` before the subscribe. */
  sidecarReplica?: (source: Y.Doc) => void;
  /** Let a peer hand state over during `waitForSync`. */
  peerReplica?: (peer: Y.Doc) => void;
}

async function subscribedGuest(options: Options = {}) {
  const trace = createTrace();
  const files = new Map<string, string>([[CANVAS_PATH, STALE_FILE]]);
  const vault = createVault(Object.fromEntries(files));
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const io = createSidecarIO(trace);
  const store = createSidecarStore(io);
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);

  if (options.sidecarReplica) {
    const source = new Y.Doc();
    options.sidecarReplica(source);
    await store.checkpoint(FIXED_GUID, source);
    source.destroy();
  }
  if (options.peerReplica) {
    sync.peerHolds(canvasDocId(FIXED_GUID), options.peerReplica);
  }

  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));
  // GUEST: no host seed, so nothing this client owns can be mistaken for
  // knowledge that arrived from somewhere else.
  await canvasSync.subscribe(CANVAS_PATH, "guest");
  await settle();

  const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
  return { canvasSync, doc, files, trace, io, store, sync };
}

/** A replica of the board with nothing on it — the cleared-board case. */
function emptyBoard(doc: Y.Doc): void {
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set("schemaVersion", 2);
  });
}

/** A replica of the board carrying one card. */
function boardWithCard(id: string, text: string) {
  return (doc: Y.Doc): void => {
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
      for (const [k, v] of Object.entries(textNode(id, 0, text))) record.set(k, v);
    });
  };
}

describe("WP29 AC1 — subscribe measures both conditions independently", () => {
  it("nothing knows the board: both flags are false", async () => {
    const { canvasSync, doc } = await subscribedGuest();
    expect(canvasSync.seedKnowledgeFor(CANVAS_PATH)).toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: false,
    });
    // The control: this really is the case the file is allowed to seed.
    expect(surviving(doc).nodes).toEqual([]);
    canvasSync.destroy();
  });

  it("a sidecar replica alone sets sidecarKnowsDoc, and NOT peerKnowsDoc", async () => {
    const { canvasSync } = await subscribedGuest({ sidecarReplica: boardWithCard("s-1", "mine") });
    expect(
      canvasSync.seedKnowledgeFor(CANVAS_PATH),
      "the sidecar's own replay was counted as a peer",
    ).toEqual({ sidecarKnowsDoc: true, peerKnowsDoc: false });
    canvasSync.destroy();
  });

  it("a peer alone sets peerKnowsDoc, and NOT sidecarKnowsDoc", async () => {
    const { canvasSync } = await subscribedGuest({ peerReplica: boardWithCard("p-1", "theirs") });
    expect(
      canvasSync.seedKnowledgeFor(CANVAS_PATH),
      "state that arrived over the relay was attributed to the sidecar",
    ).toEqual({ sidecarKnowsDoc: false, peerKnowsDoc: true });
    canvasSync.destroy();
  });

  it("both sources set both flags", async () => {
    const { canvasSync } = await subscribedGuest({
      sidecarReplica: boardWithCard("s-1", "mine"),
      peerReplica: boardWithCard("p-1", "theirs"),
    });
    expect(canvasSync.seedKnowledgeFor(CANVAS_PATH)).toEqual({
      sidecarKnowsDoc: true,
      peerKnowsDoc: true,
    });
    canvasSync.destroy();
  });

  it("a path that was never subscribed knows nothing", async () => {
    const { canvasSync } = await subscribedGuest();
    expect(canvasSync.seedKnowledgeFor("boards/never-opened.canvas")).toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: false,
    });
    canvasSync.destroy();
  });

  it("a MISSING sidecar is not knowledge — the degraded verdict does not claim a replica", async () => {
    // WP24 AC3: a missing sidecar is a defined degradation that reports itself
    // and applies nothing. Reading "the load ran" as "the sidecar knows this
    // doc" would make EVERY board unseedable the moment a lifecycle is wired.
    const { canvasSync, io } = await subscribedGuest();
    expect(
      io.ops.some((op) => op.startsWith("exists:")),
      "no sidecar load was attempted",
    ).toBe(true);
    expect(canvasSync.seedKnowledgeFor(CANVAS_PATH).sidecarKnowsDoc).toBe(false);
    canvasSync.destroy();
  });

  it("THE R4 CASE: a sidecar that replays an EMPTY board is not re-seeded from the stale file", async () => {
    // The board was cleared last session. The sidecar records exactly that. The
    // `.canvas` file on disk still holds last week's cards.
    const { canvasSync, doc, files, trace } = await subscribedGuest({ sidecarReplica: emptyBoard });

    expect(surviving(doc).nodes, "the fixture did not actually produce an empty board").toEqual([]);
    const knowledge = canvasSync.seedKnowledgeFor(CANVAS_PATH);
    expect(knowledge.sidecarKnowsDoc, "the empty replica was not recognised as a replica").toBe(
      true,
    );

    const io = createPersistenceIO(files, trace);
    const { coldOpen } = await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: knowledge,
    });

    expect(coldOpen, "last week's cards were pushed back into a board the user cleared").toBe(
      "empty",
    );
    expect(surviving(doc).nodes).toEqual([]);
    expect(io.reads).toEqual([]);
    expect(io.writes, "an empty projection was flushed over the user's file").toEqual([]);
    expect(files.get(CANVAS_PATH), "the user's file was rewritten").toBe(STALE_FILE);

    canvasSync.destroy();
  });

  it("THE R4 CASE, peer arm: a peer's EMPTY board is not re-seeded either", async () => {
    // Same failure, different witness: the peers cleared the board and this
    // client arrives with a stale file. Nothing about the doc distinguishes
    // this from a brand-new board except the fact that state arrived.
    const { canvasSync, doc, files, trace } = await subscribedGuest({ peerReplica: emptyBoard });

    const knowledge = canvasSync.seedKnowledgeFor(CANVAS_PATH);
    expect(knowledge.peerKnowsDoc, "peer state arrived and was not noticed").toBe(true);

    const io = createPersistenceIO(files, trace);
    const { coldOpen } = await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: knowledge,
    });

    expect(coldOpen).toBe("empty");
    expect(surviving(doc).nodes).toEqual([]);
    expect(io.reads).toEqual([]);
    expect(files.get(CANVAS_PATH)).toBe(STALE_FILE);

    canvasSync.destroy();
  });

  it("a genuinely NEW board still seeds end to end — the guard did not just switch seeding off", async () => {
    const { canvasSync, doc, files, trace } = await subscribedGuest();
    const io = createPersistenceIO(files, trace);
    const { coldOpen } = await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: canvasSync.seedKnowledgeFor(CANVAS_PATH),
    });

    expect(coldOpen).toBe("seeded-from-file");
    expect(surviving(doc).nodes.sort()).toEqual(["old-1", "old-2"]);
    canvasSync.destroy();
  });
});
