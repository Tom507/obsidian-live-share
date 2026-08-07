// WP28 / AC3 — "equal epochs merge normally as RELATED replicas — the archive
// path does not trigger."
//
// THIS FILE IS THE DISCRIMINATING HALF OF AC2, AND WITHOUT IT AC2 IS NEARLY
// VACUOUS. An implementation that archives on EVERY merge — every subscribe,
// every peer arrival, every resume — passes AC2 perfectly: the copy is always
// there, always named correctly, always written before anything else happens,
// and the user is always notified. What it produces in the field is a vault
// filling with `plan.conflict-….canvas` files nobody asked for, one per session,
// and a notification every time two people open the same board. The only thing
// that can tell the two implementations apart is an assertion that the archive
// path does NOT fire on the ordinary case.
//
// It is asserted here at four independent channels — the write channel, the
// notification channel, the log channel and the doc itself — because an
// implementation that suppresses one of them still has the defect.
//
// The LOCAL-WINS case belongs here too: the archive is the LOSER's, so a replica
// that wins must not archive either. An implementation that archives whenever
// the epochs merely DIFFER writes a conflict copy on the winning side as well,
// which is a copy of the state that is about to be kept — pure noise, and one
// more file the user must reason about.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import { resolveEpochConflict } from "../../../canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../canvas/canvas-schema";
import { CANVAS_PATH, createProbe, edge, makeDoc, node, rawEpoch, recordIds } from "./harness";

/** Every shape of "these two are related replicas", including the unstamped ones. */
const EQUAL_CASES: readonly { name: string; local: DocEpoch; remote: DocEpoch }[] = [
  { name: "both at 0", local: { epoch: 0 }, remote: { epoch: 0 } },
  { name: "both at 5", local: { epoch: 5 }, remote: { epoch: 5 } },
  { name: "both at 41", local: { epoch: 41 }, remote: { epoch: 41 } },
  { name: "neither ever stamped", local: {}, remote: {} },
  { name: "one unstamped, one at 0", local: {}, remote: { epoch: 0 } },
  { name: "one at 0, one unstamped", local: { epoch: 0 }, remote: {} },
  { name: "both corrupt in the same way", local: { epoch: "3" }, remote: { epoch: "3" } },
  { name: "corrupt vs unstamped", local: { epoch: Number.NaN }, remote: {} },
  { name: "corrupt vs 0", local: { epoch: null }, remote: { epoch: 0 } },
];

type DocEpoch = { epoch?: unknown };

function relatedPair(local: DocEpoch, remote: DocEpoch) {
  const doc = makeDoc({
    ...local,
    nodes: { "n-a": node("n-a", "alpha"), "n-mine": node("n-mine", "my card", 300) },
    edges: { "e-1": edge("e-1", "n-a", "n-mine") },
  });
  const peer = makeDoc({
    ...remote,
    nodes: { "n-a": node("n-a", "alpha"), "n-theirs": node("n-theirs", "their card", 600) },
    edges: {},
  });
  return { doc, peer };
}

describe("WP28 AC3 — equal epochs do not trigger the archive path", () => {
  it.each(EQUAL_CASES)("$name: no conflict copy is written", async ({ local, remote }) => {
    const { doc, peer } = relatedPair(local, remote);
    const probe = createProbe();

    const outcome = await resolveEpochConflict({
      doc,
      winner: peer,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(outcome.verdict).toBe("equal");
    expect(
      probe.writes,
      "a conflict copy was written for two RELATED replicas — an implementation that " +
        "archives on every merge passes AC2 and fails here",
    ).toEqual([]);
    doc.destroy();
    peer.destroy();
  });

  it.each(EQUAL_CASES)("$name: the user is not notified", async ({ local, remote }) => {
    const { doc, peer } = relatedPair(local, remote);
    const probe = createProbe();

    await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.notices, "the user was warned about a conflict that did not happen").toEqual([]);
    doc.destroy();
    peer.destroy();
  });

  it.each(EQUAL_CASES)(
    "$name: nothing is adopted and no signature exists",
    async ({ local, remote }) => {
      const { doc, peer } = relatedPair(local, remote);
      const probe = createProbe();

      const outcome = await resolveEpochConflict({
        doc,
        winner: peer,
        canvasPath: CANVAS_PATH,
        env: probe.env,
      });

      expect(outcome.adopted).toBe(false);
      expect(outcome.archivedTo).toBeNull();
      expect(outcome.signature).toBeNull();
      expect(probe.logs).toEqual([]);
      doc.destroy();
      peer.destroy();
    },
  );

  it("the local doc is not written to AT ALL on the equal path", async () => {
    const { doc, peer } = relatedPair({ epoch: 5 }, { epoch: 5 });
    const probe = createProbe();
    probe.watch(doc);

    await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });

    expect(
      probe.transactions,
      "a related-replica merge opened a transaction on the doc — the epoch path must " +
        "be inert here and leave merging to Yjs",
    ).toEqual([]);
    expect(probe.serializations).toEqual([]);
    doc.destroy();
    peer.destroy();
  });

  it("the local records SURVIVE — an equal-epoch peer is a merge, not a replacement", async () => {
    const { doc, peer } = relatedPair({ epoch: 5 }, { epoch: 5 });
    const probe = createProbe();

    await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });

    expect(recordIds(doc, "nodes")).toEqual(["n-a", "n-mine"]);
    expect(recordIds(doc, "edges")).toEqual(["e-1"]);
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-theirs"),
      "the peer's record was force-adopted at equal epochs — that is the unrelated-" +
        "history path firing on a related pair",
    ).toBe(false);
    doc.destroy();
    peer.destroy();
  });

  it("an unstamped doc is not stamped as a side effect of comparing", async () => {
    const { doc, peer } = relatedPair({}, {});
    const probe = createProbe();

    await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });

    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY),
      "the comparison stamped an epoch — WP27 owns the initial stamp, not WP28",
    ).toBeUndefined();
    expect(rawEpoch(peer)).toBeUndefined();
    doc.destroy();
    peer.destroy();
  });
});

describe("WP28 AC3 — the WINNING side does not archive either", () => {
  it("local-wins writes no conflict copy and raises no notification", async () => {
    const { doc, peer } = relatedPair({ epoch: 9 }, { epoch: 2 });
    const probe = createProbe();
    probe.watch(doc);

    const outcome = await resolveEpochConflict({
      doc,
      winner: peer,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(outcome.verdict).toBe("local-wins");
    expect(outcome.adopted).toBe(false);
    expect(outcome.archivedTo).toBeNull();
    expect(
      probe.writes,
      "the winning replica archived itself — an implementation that archives whenever " +
        "the epochs merely DIFFER writes a copy of the state it is about to keep",
    ).toEqual([]);
    expect(probe.notices).toEqual([]);
    expect(probe.transactions).toEqual([]);
    doc.destroy();
    peer.destroy();
  });

  it("local-wins keeps the local records and the local epoch", async () => {
    const { doc, peer } = relatedPair({ epoch: 9 }, { epoch: 2 });
    const probe = createProbe();

    await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });

    expect(recordIds(doc, "nodes")).toEqual(["n-a", "n-mine"]);
    expect(rawEpoch(doc)).toBe(9);
    doc.destroy();
    peer.destroy();
  });

  it("across a run of merges, only the strictly-lower side ever archives", async () => {
    const probe = createProbe();
    const pairs: [number, number][] = [
      [3, 3],
      [4, 3],
      [3, 4],
      [0, 0],
      [7, 7],
      [1, 9],
    ];
    for (const [localEpoch, remoteEpoch] of pairs) {
      const { doc, peer } = relatedPair({ epoch: localEpoch }, { epoch: remoteEpoch });
      await resolveEpochConflict({ doc, winner: peer, canvasPath: CANVAS_PATH, env: probe.env });
      doc.destroy();
      peer.destroy();
    }

    expect(
      probe.writes.length,
      `six merges produced ${probe.writes.length} conflict copies; exactly two of the ` +
        "six pairs have a strictly lower local epoch",
    ).toBe(2);
    expect(probe.notices.length).toBe(2);
  });
});
