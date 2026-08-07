// WP25 / AC3 (GC half) — "uses Yjs' built-in GC".
//
// "USES YJS' GC" IS ONLY TESTABLE THROUGH ITS ONE OBSERVABLE CONSEQUENCE: with
// `Y.Doc.gc === true` the content of a deleted item is physically replaced by a
// `GC` struct at transaction cleanup, so `Y.encodeStateAsUpdate(doc)` no longer
// contains its bytes. With `gc === false` the bytes survive in the encoding
// forever. Measured against the installed Yjs before this test was written:
//
//     gc=true   → 75 bytes, deleted text ABSENT
//     gc=false  → 122 bytes, deleted text PRESENT
//     doc.gc flipped to true AFTER the delete → still PRESENT (no retro-GC)
//     the same state re-applied into a fresh gc:true doc → ABSENT
//
// So the oracle is a byte search for a distinctive marker string, over the WHOLE
// sidecar — not just the checkpoint. That "whole sidecar" part is what makes the
// test bite: the frame log still holds the update that CREATED the doomed
// record, so a "compaction" that writes a beautifully GC'd checkpoint and forgets
// to truncate leaves the deleted content sitting in the history, and the next
// load replays it. Both halves are the claim.
//
// A byte-length assertion was deliberately NOT used. It is brittle across Yjs
// versions and it is satisfied by any compaction at all; the marker search is
// specific to GC and it is stable.
//
// TOMBSTONE AGES ARE FIXTURE DATA, NOT WALL CLOCK. `TombstoneEntry.t` is a
// Lamport counter, so "old" means "far behind the newest stamp in the container"
// — hence the deliberate `t: 1` against a `t: 60` sibling with
// `horizonTicks: 5`. See tp06 for the horizon rule itself.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by compacting through a
// `new Y.Doc({ gc: false })` (the natural "preserve the history" mistake), by
// disabling `doc.gc`, and by any compaction path that writes the checkpoint
// without WP24's `checkpoint()` (which is what truncates).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import {
  FIXED_GUID,
  anySidecarFileContains,
  bytesContain,
  createSidecarIO,
  createTrace,
  seedRecord,
  utf8,
  writeTombstone,
} from "./harness";

const DOOMED = "ZZ-DOOMED-CARD-TEXT-ZZ";
const KEPT = "ZZ-KEPT-CARD-TEXT-ZZ";
const HORIZON = 5;

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("WP25 AC3 — compaction uses Yjs' built-in garbage collection", () => {
  it("the premise: with GC on, deleted content leaves the encoding", () => {
    // Stated first so nothing below can pass because the oracle is inert. If
    // this ever fails, the Yjs GC behaviour the AC names has changed and the
    // rest of this file is measuring nothing.
    const gcOn = new Y.Doc({ gc: true });
    const gcOff = new Y.Doc({ gc: false });
    for (const doc of [gcOn, gcOff]) {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      doc.transact(() => {
        const record = new Y.Map<unknown>();
        nodes.set("n-doomed", record);
        record.set("text", DOOMED);
      });
      doc.transact(() => {
        nodes.delete("n-doomed");
      });
    }
    expect(bytesContain(Y.encodeStateAsUpdate(gcOn), utf8(DOOMED))).toBe(false);
    expect(bytesContain(Y.encodeStateAsUpdate(gcOff), utf8(DOOMED))).toBe(true);
  });

  it("after a compaction, physically removed content is in NO sidecar file", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);

    seedRecord(doc, "nodes", { id: "n-doomed", type: "text", text: DOOMED });
    seedRecord(doc, "nodes", { id: "n-kept", type: "text", text: KEPT });
    await settle();

    // Premise: right now the history DOES carry the doomed text, so the
    // assertion after the compaction is a change and not a tautology.
    expect(
      anySidecarFileContains(io, DOOMED),
      "the fixture never wrote the marker into the sidecar",
    ).toBe(true);

    // An OLD suppression (t=1) alongside a RECENT one (t=60): with a horizon of
    // 5 ticks the first is beyond it and the second is not.
    writeTombstone(doc, "n-doomed", { t: 1, by: "peer-a", on: true });
    writeTombstone(doc, "n-kept", { t: 60, by: "peer-b", on: false });
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(
      anySidecarFileContains(io, DOOMED),
      "the removed record's content survived the compaction somewhere on disk",
    ).toBe(false);
    // Control: the LIVE record's content is still there, so "nothing survives"
    // was not achieved by writing an empty sidecar.
    expect(
      anySidecarFileContains(io, KEPT),
      "the compaction discarded a live record's content",
    ).toBe(true);
  });

  it("the history is emptied by the compaction, not merely superseded", async () => {
    // The half a GC-only implementation forgets. A checkpoint that leaves the
    // frame log intact is not a compaction: the deleted content is still in the
    // frames and the next load replays every one of them.
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", { id: "n-kept", type: "text", text: KEPT });
    seedRecord(doc, "nodes", { id: "n-2", type: "text", text: "two" });
    await settle();

    const historyBefore = io.files.get(sidecarHistoryPath(FIXED_GUID));
    expect((historyBefore?.length ?? 0) > 0, "the fixture wrote no history").toBe(true);

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(
      io.files.get(sidecarHistoryPath(FIXED_GUID)),
      "the history was not truncated by the compaction",
    ).toEqual(new Uint8Array(0));
    const checkpoint = io.files.get(sidecarCheckpointPath(FIXED_GUID));
    expect(checkpoint, "no checkpoint was written").toBeDefined();
    expect((checkpoint as Uint8Array).length).toBeGreaterThan(0);
  });

  it("the compaction does not build its checkpoint through a GC-disabled doc", async () => {
    // The specific wrong implementation this catches: re-encoding through
    // `new Y.Doc({ gc: false })` "so nothing is lost". It compacts, it truncates,
    // it reloads correctly — and it preserves every deleted byte forever, which
    // is the one thing "uses Yjs' built-in GC" forbids.
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);

    seedRecord(doc, "nodes", { id: "n-doomed", type: "text", text: DOOMED });
    seedRecord(doc, "nodes", { id: "n-kept", type: "text", text: KEPT });
    writeTombstone(doc, "n-doomed", { t: 1, by: "peer-a", on: true });
    writeTombstone(doc, "n-kept", { t: 60, by: "peer-b", on: false });
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    const checkpoint = io.files.get(sidecarCheckpointPath(FIXED_GUID)) as Uint8Array;
    expect(
      bytesContain(checkpoint, utf8(DOOMED)),
      "the checkpoint still carries the removed record's content — GC was off",
    ).toBe(false);
    expect(bytesContain(checkpoint, utf8(KEPT))).toBe(true);
  });

  it("a doc reloaded from the compacted sidecar is a usable replica, not a husk", async () => {
    // GC removes DELETED content only. A compaction that GC'd live content, or
    // that produced a checkpoint a fresh replica cannot decode, would satisfy
    // every "absent" assertion above.
    const io = createSidecarIO(createTrace());
    const store = createSidecarStore(io);
    const lifecycle = createSidecarLifecycle(store, { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", { id: "n-kept", type: "text", text: KEPT });
    seedRecord(doc, "edges", { id: "e-1", fromNode: "n-kept", toNode: "n-kept" });
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    const replica = new Y.Doc();
    const result = await store.load(FIXED_GUID, replica);
    expect(result.degradation).toBe("none");
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["n-kept"]);
    expect(replica.getMap<Y.Map<unknown>>("nodes").get("n-kept")?.get("text")).toBe(KEPT);
    expect([...replica.getMap<Y.Map<unknown>>("edges").keys()]).toEqual(["e-1"]);
  });
});
