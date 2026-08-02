// WP24 / AC3 (the prohibition) — "never leaves a partially applied doc".
//
// This is the discriminating test of the whole WP. Shared Ownership Contract §5
// states the reason in one line: a doc that received three of five updates
// before the fourth was found to be garbage is a WORSE outcome than a doc that
// received none, because it looks healthy. Nothing downstream can tell the
// difference — the state is self-consistent, the schema validates, byte
// equality holds against a peer that never had the missing two, and the user
// sees a board that is simply, silently missing work.
//
// The obvious implementation is the broken one:
//
//     for (const f of frames) Y.applyUpdate(doc, f);   // ← partial on throw
//
// It passes tp09 (it does report CORRUPT if the throw is caught) and fails only
// here. So the assertions are: zero update events on the caller's doc, an
// unchanged state vector, and — the part that stops the test from being
// vacuous — a positive control proving the three good frames WOULD have
// produced visible content had they been applied.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import {
  GARBAGE_UPDATE,
  concatBytes,
  createFakeIO,
  docSnapshot,
  frame,
  hex,
  recordUpdates,
} from "./harness";

const GUID = "guid-partial";

/** Five updates; the caller decides which one gets replaced by garbage. */
function fiveUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  const nodes = doc.getMap("nodes");
  nodes.set("u1", { label: "one" });
  nodes.set("u2", { label: "two" });
  nodes.set("u3", { label: "three" });
  nodes.set("u4", { label: "four" });
  nodes.set("u5", { label: "five" });
  return updates;
}

describe("WP24 AC3 — a failed load leaves NO partially applied doc", () => {
  it("three good frames then a garbage fourth: the doc receives none of the three", async () => {
    const updates = fiveUpdates();
    expect(updates).toHaveLength(5);

    // Positive control FIRST: prove the three leading frames carry real content.
    const control = new Y.Doc();
    for (const update of updates.slice(0, 3)) Y.applyUpdate(control, update);
    expect(Object.keys(control.getMap("nodes").toJSON()).sort()).toEqual(["u1", "u2", "u3"]);

    const history = concatBytes(
      frame(updates[0]),
      frame(updates[1]),
      frame(updates[2]),
      frame(GARBAGE_UPDATE),
      frame(updates[4]),
    );
    const io = createFakeIO({ [sidecarHistoryPath(GUID)]: history });
    const store = createSidecarStore(io);

    const doc = new Y.Doc();
    const pristineSv = hex(Y.encodeStateVector(doc));
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(hex(Y.encodeStateVector(doc))).toBe(pristineSv);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });

  it("a doc that already held content keeps exactly that content, no more and no less", async () => {
    // The all-or-nothing rule is about the DELTA the load applies, not about
    // resetting the doc. A store that "rolls back" by clearing the doc destroys
    // the caller's own state — as bad a failure as the partial apply.
    const updates = fiveUpdates();
    const history = concatBytes(
      frame(updates[0]),
      frame(updates[1]),
      frame(GARBAGE_UPDATE),
      frame(updates[3]),
    );
    const io = createFakeIO({ [sidecarHistoryPath(GUID)]: history });
    const store = createSidecarStore(io);

    const doc = new Y.Doc();
    doc.getMap("nodes").set("pre-existing", { label: "mine" });
    const before = docSnapshot(doc);
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(events).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(before);
    expect(doc.getMap("nodes").toJSON()).toEqual({ "pre-existing": { label: "mine" } });
  });

  it("a good checkpoint with a corrupt history applies neither — not 'checkpoint only'", async () => {
    // "Apply what you can" is the plausible compromise, and it is exactly the
    // healthy-looking-but-lossy outcome AC3 forbids: the doc would come back
    // with the compacted past and none of the tail.
    const updates = fiveUpdates();
    const checkpointDoc = new Y.Doc();
    for (const update of updates.slice(0, 2)) Y.applyUpdate(checkpointDoc, update);
    const checkpoint = Y.encodeStateAsUpdate(checkpointDoc);
    expect(checkpoint.length).toBeGreaterThan(0);

    const io = createFakeIO({
      [sidecarCheckpointPath(GUID)]: checkpoint,
      [sidecarHistoryPath(GUID)]: concatBytes(frame(updates[2]), frame(GARBAGE_UPDATE)),
    });
    const store = createSidecarStore(io);

    const doc = new Y.Doc();
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });

  it("the same rule holds for a torn tail, not only for garbage", async () => {
    const updates = fiveUpdates();
    const tail = frame(updates[3]);
    const history = concatBytes(
      frame(updates[0]),
      frame(updates[1]),
      frame(updates[2]),
      tail.slice(0, tail.length - 2),
    );
    const io = createFakeIO({ [sidecarHistoryPath(GUID)]: history });
    const store = createSidecarStore(io);

    const doc = new Y.Doc();
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });
});
