// WP24 / AC2 (second half) — "loading is idempotent".
//
// The trap: Yjs update application is ALREADY idempotent, so "load twice, doc
// looks the same" is true even of a badly broken store. That assertion on its
// own cannot fail and would be one of this project's five green-but-vacuous
// classes.
//
// What is NOT free, and is what this file pins:
//
//   - load must be READ-ONLY. A store that appends what it just reconstructed
//     back into the history (or rewrites the checkpoint "to compact while we
//     are here") grows the sidecar on every open. The doc still looks right;
//     the file does not. Byte equality of both sidecar files across a load is
//     the oracle.
//   - the RESULT must be idempotent too. `historyEntriesApplied` accumulated
//     across calls, or `checkpointApplied` flipping to false on the second
//     load because an internal "already loaded" flag short-circuited, are both
//     real bugs that leave the doc untouched.
//   - two independent replicas loading the same sidecar must land on the same
//     state, not merely on a self-consistent one.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { SIDECAR_DEGRADATION, createSidecarStore } from "../../../files/canvas-sidecar";
import { createFakeIO, docSnapshot, recordUpdates } from "./harness";

const GUID = "guid-idempotent";

async function seededStore() {
  const io = createFakeIO();
  const store = createSidecarStore(io);
  const source = new Y.Doc();
  const updates = recordUpdates(source);
  source.getMap("nodes").set("a", { x: 1 });
  source.getMap("nodes").set("b", { x: 2 });
  for (const update of updates.splice(0)) await store.append(GUID, update);
  await store.checkpoint(GUID, source);
  source.getMap("nodes").set("c", { x: 3 });
  source.getMap("nodes").delete("a");
  for (const update of updates.splice(0)) await store.append(GUID, update);
  return { io, store, source };
}

describe("WP24 AC2 — loading is idempotent", () => {
  it("loading twice into the same doc equals loading once", async () => {
    const { store, source } = await seededStore();

    const doc = new Y.Doc();
    await store.load(GUID, doc);
    const afterFirst = docSnapshot(doc);
    await store.load(GUID, doc);

    expect(docSnapshot(doc)).toEqual(afterFirst);
    expect(docSnapshot(doc)).toEqual(docSnapshot(source));
  });

  it("the second load reports the same result as the first", async () => {
    const { store } = await seededStore();
    const doc = new Y.Doc();

    const first = await store.load(GUID, doc);
    const second = await store.load(GUID, doc);

    expect(second.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(second.checkpointApplied).toBe(first.checkpointApplied);
    expect(second.historyEntriesApplied).toBe(first.historyEntriesApplied);
    expect(first.historyEntriesApplied).toBe(2);
  });

  it("load writes nothing: both sidecar files are byte-identical afterwards", async () => {
    const { io, store } = await seededStore();
    const before = new Map(
      [...io.files].map(([path, bytes]) => [path, Uint8Array.from(bytes)] as const),
    );
    io.calls.length = 0;

    const doc = new Y.Doc();
    await store.load(GUID, doc);
    await store.load(GUID, doc);

    expect(io.mutationTrace()).toEqual([]);
    expect([...io.files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, bytes] of before) expect(io.files.get(path)).toEqual(bytes);
  });

  it("two independent fresh docs loaded from the same sidecar agree", async () => {
    const { store, source } = await seededStore();

    const one = new Y.Doc();
    const two = new Y.Doc();
    await store.load(GUID, one);
    await store.load(GUID, two);

    expect(docSnapshot(one)).toEqual(docSnapshot(two));
    expect(docSnapshot(one)).toEqual(docSnapshot(source));
  });

  it("a load that follows an unrelated local edit does not undo that edit", async () => {
    // Idempotence must not be implemented as "reset the doc, then apply" —
    // that would be idempotent and also destructive.
    const { store } = await seededStore();
    const doc = new Y.Doc();
    await store.load(GUID, doc);

    doc.getMap("nodes").set("local-only", { x: 99 });
    const withLocal = docSnapshot(doc);

    await store.load(GUID, doc);

    expect(docSnapshot(doc)).toEqual(withLocal);
    expect(doc.getMap("nodes").has("local-only")).toBe(true);
  });
});
