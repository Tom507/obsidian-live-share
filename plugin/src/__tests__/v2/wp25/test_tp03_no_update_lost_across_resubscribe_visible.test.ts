// WP25 / AC2 (second half) — "no update is lost across a clean
// unsubscribe/resubscribe cycle".
//
// This is a SEPARATE CLAIM from "exactly once", not a restatement of it. A
// lifecycle can append every update exactly once while it is attached and still
// lose the tail of the session at teardown, and it can survive the teardown
// while double-counting on the way back in. Three things have to hold together:
//
//   ├── the LAST update before the unsubscribe is durable (nothing is left in a
//   │   queue that teardown drops),
//   ├── the handler is DETACHED, so a doc that outlives the unsubscribe stops
//   │   writing into a history nobody is reading, and
//   └── the resubscribe REPLAYS everything and appends nothing extra.
//
// The `unsubscribe → resubscribe` cycle is driven through the real
// `CanvasSync`, because that is where the lifecycle is wired and the teardown
// order is decided; the per-update accounting is read off the sidecar files.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by the `await this.sidecar.detach(guid)`
// WP25 adds to `CanvasSync.unsubscribe` (omit it → the doc keeps appending after
// teardown and the resubscribe double-counts) and by the `attach` in
// `subscribe` (omit it → the post-resubscribe edits are lost).

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
  readFrames,
  seedRecord,
} from "./harness";

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function wire(trace: Trace) {
  const vault = createVault({ [CANVAS_PATH]: canvasJson([]) });
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const io = createSidecarIO(trace);
  const store = createSidecarStore(io);
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const lifecycle = createSidecarLifecycle(store);
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(lifecycle);
  return { vault, sync, manifest, io, store, lifecycle, canvasSync };
}

/** Rebuild a replica from what is on the sidecar disk right now. */
async function replicaFromSidecar(io: ReturnType<typeof createSidecarIO>): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await createSidecarStore(io).load(FIXED_GUID, doc);
  return doc;
}

describe("WP25 AC2 — a clean unsubscribe/resubscribe cycle loses no update", () => {
  it("every record written before the unsubscribe is recoverable afterwards", async () => {
    const { sync, io, canvasSync } = await wire(createTrace());
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;

    seedRecord(doc, "nodes", NODE_A);
    seedRecord(doc, "nodes", NODE_B);
    // The LAST write before teardown is the one a dropped queue eats.
    seedRecord(doc, "edges", { id: "e-1", fromNode: NODE_A.id, toNode: NODE_B.id });
    await settle();

    canvasSync.unsubscribe(CANVAS_PATH);
    await settle();

    const replica = await replicaFromSidecar(io);
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(
      [NODE_A.id, NODE_B.id].sort(),
    );
    expect(
      [...replica.getMap<Y.Map<unknown>>("edges").keys()],
      "the last update before the unsubscribe was lost",
    ).toEqual(["e-1"]);

    canvasSync.destroy();
  });

  it("the resubscribed doc reaches the pre-unsubscribe state, without the peer", async () => {
    // The DoD, stated as a test: "a returning client resumes a RELATED replica
    // instead of reseeding an unrelated one". The fake sync manager hands back a
    // brand-new empty `Y.Doc` for the same id, so anything the second subscribe
    // ends up holding came from the sidecar and from nowhere else.
    const { sync, canvasSync } = await wire(createTrace());
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const first = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
    seedRecord(first, "nodes", NODE_A);
    seedRecord(first, "nodes", NODE_B);
    await settle();

    canvasSync.unsubscribe(CANVAS_PATH);
    await settle();
    // A fresh replica for the same id, exactly as a restarted process gets.
    sync.docs.delete(canvasDocId(FIXED_GUID));

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const second = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;

    expect(second, "the resubscribe opened no doc").not.toBe(first);
    expect(
      [...second.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the returning client reseeded an unrelated replica",
    ).toEqual([NODE_A.id, NODE_B.id].sort());

    canvasSync.destroy();
  });

  it("the retired doc stops appending after the unsubscribe", async () => {
    // A handler that is never detached keeps writing into a history that the
    // next session will replay — the SAME id gets two lifetimes of frames and
    // the board silently accumulates state nobody edited in this session.
    const { sync, io, canvasSync } = await wire(createTrace());
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
    seedRecord(doc, "nodes", NODE_A);
    await settle();

    canvasSync.unsubscribe(CANVAS_PATH);
    await settle();
    const afterTeardown = io.appends.length;

    // The doc object is still alive (the fake never destroys it). Anything it
    // emits now belongs to no subscription.
    seedRecord(doc, "nodes", { ...NODE_B, id: "n-ghost" });
    await settle();

    expect(io.appends.length, "the update handler was still attached after unsubscribe").toBe(
      afterTeardown,
    );

    canvasSync.destroy();
  });

  it("the cycle appends each update once, never twice", async () => {
    // The duplication direction across the cycle. Reconstructed state cannot see
    // it (idempotent applies), so the pin is the total number of distinct
    // payloads that ever reached the append channel.
    const { sync, io, canvasSync } = await wire(createTrace());
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const first = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
    seedRecord(first, "nodes", NODE_A);
    await settle();

    canvasSync.unsubscribe(CANVAS_PATH);
    await settle();
    sync.docs.delete(canvasDocId(FIXED_GUID));

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const second = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
    seedRecord(second, "nodes", NODE_B);
    await settle();

    const payloads = io.appends.map((a) => [...a.bytes].join(","));
    expect(new Set(payloads).size, "an update was appended twice across the cycle").toBe(
      payloads.length,
    );

    // And the reload still holds both records — "no duplicates" must not have
    // been bought by dropping one.
    const replica = await replicaFromSidecar(io);
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(
      [NODE_A.id, NODE_B.id].sort(),
    );

    canvasSync.destroy();
  });

  it("a checkpoint taken at teardown does not truncate anything it has not written", async () => {
    // If WP25 checkpoints on `detach` it must inherit WP24's ordering, not
    // reimplement it: whatever is on disk after the cycle must be sufficient on
    // its own. Both files are read back and the union is asserted, so a
    // teardown that truncated the history before its checkpoint landed is red.
    const { sync, io, canvasSync } = await wire(createTrace());
    await canvasSync.subscribe(CANVAS_PATH, "guest");
    const doc = (sync.docs.get(canvasDocId(FIXED_GUID)) as { doc: Y.Doc }).doc;
    seedRecord(doc, "nodes", NODE_A);
    seedRecord(doc, "nodes", NODE_B);
    await settle();

    canvasSync.unsubscribe(CANVAS_PATH);
    await settle();

    const checkpoint = io.files.get(sidecarCheckpointPath(FIXED_GUID));
    const history = io.files.get(sidecarHistoryPath(FIXED_GUID));
    const rebuilt = new Y.Doc();
    if (checkpoint && checkpoint.length > 0) Y.applyUpdate(rebuilt, checkpoint);
    if (history && history.length > 0) {
      for (const frame of readFrames(history)) Y.applyUpdate(rebuilt, frame);
    }
    expect(
      [...rebuilt.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the files left on disk do not reconstruct the pre-teardown state",
    ).toEqual([NODE_A.id, NODE_B.id].sort());

    canvasSync.destroy();
  });
});
