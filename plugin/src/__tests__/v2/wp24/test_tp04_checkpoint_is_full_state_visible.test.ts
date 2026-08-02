// WP24 / AC1 + AC2 — the checkpoint has to be a FULL-STATE checkpoint, because
// the history is destroyed immediately afterwards.
//
// The plausible wrong implementation here is not a silly one: writing
// `Y.encodeStateAsUpdate(doc, lastCheckpointStateVector)` — a delta — is the
// natural thing to write if you are thinking about file size, and it is
// correct-looking in every scenario where the process never restarts. It only
// shows up when a FRESH replica (empty state vector) loads the sidecar after a
// truncate: the delta is meaningless to it and the pre-checkpoint history is
// already gone. So the assertions below always reconstruct into a brand-new
// `Y.Doc`, never into the doc that produced the data.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createFakeIO, docSnapshot, readFrames, recordUpdates } from "./harness";

const GUID = "guid-checkpoint";

describe("WP24 AC1 — the checkpoint carries the whole state, not a delta", () => {
  it("a fresh doc loaded after checkpoint+truncate equals the doc that was checkpointed", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    const updates = recordUpdates(source);
    source.getMap("nodes").set("a", { x: 0, y: 0 });
    source.getMap("nodes").set("b", { x: 100, y: 0 });
    source.getMap("nodes").set("c", { x: 200, y: 0 });
    source.getMap("edges").set("e", { from: "a", to: "c" });
    for (const update of updates) await store.append(GUID, update);

    await store.checkpoint(GUID, source);

    // The history is gone; only the checkpoint can carry the four records now.
    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(new Uint8Array(0));
    expect((io.files.get(sidecarCheckpointPath(GUID)) as Uint8Array).length).toBeGreaterThan(0);

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(true);
    expect(result.historyEntriesApplied).toBe(0);
    expect(docSnapshot(revived)).toEqual(docSnapshot(source));
  });

  it("the checkpoint bytes alone rebuild the state — no history involved", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    const updates = recordUpdates(source);
    source.getMap("nodes").set("solo", { text: "only record" });
    for (const update of updates) await store.append(GUID, update);
    await store.checkpoint(GUID, source);

    const probe = new Y.Doc();
    Y.applyUpdate(probe, io.files.get(sidecarCheckpointPath(GUID)) as Uint8Array);
    expect(probe.getMap("nodes").toJSON()).toEqual({ solo: { text: "only record" } });
  });

  it("updates appended after the checkpoint are replayed on top of it", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    const updates = recordUpdates(source);
    source.getMap("nodes").set("before", { v: 1 });
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, source);

    source.getMap("nodes").set("after1", { v: 2 });
    source.getMap("nodes").set("after2", { v: 3 });
    for (const update of updates.splice(0)) await store.append(GUID, update);

    expect(readFrames(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array)).toHaveLength(2);

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.checkpointApplied).toBe(true);
    expect(result.historyEntriesApplied).toBe(2);
    expect(docSnapshot(revived)).toEqual(docSnapshot(source));
    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual([
      "after1",
      "after2",
      "before",
    ]);
  });

  it("a second checkpoint replaces the first and still rebuilds everything", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    const updates = recordUpdates(source);
    source.getMap("nodes").set("gen1", { v: 1 });
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, source);

    source.getMap("nodes").set("gen2", { v: 2 });
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, source);

    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(new Uint8Array(0));

    const revived = new Y.Doc();
    await store.load(GUID, revived);
    expect(revived.getMap("nodes").toJSON()).toEqual({ gen1: { v: 1 }, gen2: { v: 2 } });
    expect(docSnapshot(revived)).toEqual(docSnapshot(source));
  });
});
