// WP24 / AC3 (missing) — "a missing … sidecar is a defined degradation:
// loading yields an empty-but-valid result and reports the degradation, never
// throws".
//
// Three separable claims, three separable ways to get it wrong:
//
//   1. never throws          → a store that calls `io.read` without an `exists`
//                              guard propagates ENOENT. The harness's `read`
//                              throws on a missing path precisely so this can
//                              fail.
//   2. reports MISSING       → returning `NONE` for an absent sidecar is the
//                              dangerous silent version: the caller cannot tell
//                              "fresh doc" from "we lost your history", and
//                              WP29's seed decision depends on that distinction.
//   3. empty-BUT-VALID       → the doc must come back untouched and usable, and
//                              the store must not CREATE the files as a side
//                              effect of looking for them (an empty `.yhistory`
//                              on disk would later read as "compacted, nothing
//                              pending" rather than "never existed").

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  isSidecarDegraded,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createFakeIO, docSnapshot } from "./harness";

const GUID = "guid-never-seen";

describe("WP24 AC3 — a missing sidecar is a defined degradation", () => {
  it("does not throw and reports MISSING", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.MISSING);
    expect(isSidecarDegraded(result)).toBe(true);
  });

  it("yields an empty-but-valid result", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const result = await store.load(GUID, new Y.Doc());

    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
  });

  it("leaves the doc exactly as it found it", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();
    const pristine = docSnapshot(new Y.Doc());
    const updates: unknown[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    await store.load(GUID, doc);

    expect(updates).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(pristine);
  });

  it("creates no file while looking for one", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    await store.load(GUID, new Y.Doc());

    expect(io.mutationTrace()).toEqual([]);
    expect(io.files.has(sidecarHistoryPath(GUID))).toBe(false);
    expect(io.files.has(sidecarCheckpointPath(GUID))).toBe(false);
    expect([...io.files.keys()]).toEqual([]);
  });

  it("the doc stays usable — a load-after-miss is still a working replica", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();

    await store.load(GUID, doc);
    doc.getMap("nodes").set("fresh", { x: 1 });

    expect(doc.getMap("nodes").toJSON()).toEqual({ fresh: { x: 1 } });
  });

  it("an EMPTY history file is NOT 'missing' — it is a compacted sidecar", async () => {
    // The discriminating case: after `checkpoint()` the history is zero bytes
    // and still present. Reporting MISSING there would make every compacted doc
    // look like a lost one to WP29's seed decision.
    const io = createFakeIO({
      [sidecarHistoryPath(GUID)]: new Uint8Array(0),
    });
    const store = createSidecarStore(io);

    const result = await store.load(GUID, new Y.Doc());

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
  });
});
