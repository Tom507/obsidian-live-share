// WP28 / AC1 — "the higher epoch wins COMPLETELY".
//
// THE FAILURE MODE THIS FILE EXISTS FOR: winning PARTIALLY.
//
// A merge that adopts every one of the winner's records but leaves the loser's
// behind converges (all replicas agree), passes SEC, passes the schema
// invariants, passes byte-equality and passes the shadow oracle — and is a
// corrupt document. It is a board carrying two unrelated histories at once,
// which is the exact outcome C28's Responsibility line forbids in as many words:
// "make unrelated histories detectable and named instead of silently merged".
//
// A test that asserts only "every winner record is present" is GREEN against
// that implementation, because the winner's records ARE all present. So this
// file asserts the id set EXACTLY, from both directions, and asserts the
// loser-only record is ABSENT AS A KEY rather than merely suppressed: a
// tombstone would leave the loser's history in the doc, re-exportable and
// re-resurrectable the moment the epochs equalise. The archive file — not the
// tombstone map — is where the loser's work is preserved.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import {
  CANVAS_EPOCH_ADOPT_ORIGIN,
  readEpoch,
  resolveEpochConflict,
} from "../../../canvas/canvas-epoch";
import { EPOCH_KEY, GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
import {
  CANVAS_PATH,
  FIXED_GUID,
  createProbe,
  edge,
  fieldOf,
  makeDoc,
  node,
  recordIds,
} from "./harness";

/**
 * Loser and winner overlap on `n-shared` (with DIFFERENT content) and each has a
 * record only it holds — in both id spaces. That is what makes "wins completely"
 * a set equation rather than a slogan.
 */
function conflictingPair() {
  const loser = makeDoc({
    epoch: 3,
    nodes: {
      "n-shared": node("n-shared", "LOSER text"),
      "n-loser-only": node("n-loser-only", "only the loser has this", 300),
    },
    edges: { "e-loser-only": edge("e-loser-only", "n-shared", "n-loser-only") },
    deleted: { "n-old": { t: 1, by: "loser", on: true } },
  });
  const winner = makeDoc({
    epoch: 9,
    nodes: {
      "n-shared": node("n-shared", "WINNER text"),
      "n-winner-only": node("n-winner-only", "only the winner has this", 600),
    },
    edges: { "e-winner-only": edge("e-winner-only", "n-shared", "n-winner-only") },
    deleted: { "n-ancient": { t: 2, by: "winner", on: true } },
  });
  return { loser, winner };
}

describe("WP28 AC1 — the higher epoch wins completely, not partially", () => {
  it("the loser's node id set becomes EXACTLY the winner's", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(outcome.verdict).toBe("remote-wins");
    expect(outcome.adopted).toBe(true);
    expect(recordIds(loser, "nodes")).toEqual(recordIds(winner, "nodes"));
    expect(recordIds(loser, "nodes")).toEqual(["n-shared", "n-winner-only"]);
    loser.destroy();
    winner.destroy();
  });

  it("the loser-only NODE is gone — absent as a key, not tombstoned", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(
      loser.getMap<Y.Map<unknown>>("nodes").has("n-loser-only"),
      "the loser's own record survived the adoption — this converges, passes SEC, " +
        "passes the schema and byte oracles, and is a document holding two unrelated histories",
    ).toBe(false);
    expect(loser.getMap<unknown>("deleted").has("n-loser-only")).toBe(false);
    loser.destroy();
    winner.destroy();
  });

  it("the loser-only EDGE is gone too — both id spaces are replaced", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(recordIds(loser, "edges")).toEqual(["e-winner-only"]);
    expect(loser.getMap<Y.Map<unknown>>("edges").has("e-loser-only")).toBe(false);
    loser.destroy();
    winner.destroy();
  });

  it("a SHARED record takes the winner's content, not a field-wise blend", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(fieldOf(loser, "nodes", "n-shared", "text")).toBe("WINNER text");
    expect(
      loser.getMap<Y.Map<unknown>>("nodes").get("n-shared")?.toJSON(),
      "the shared record is the WINNER's record, whole — a blend is a card nobody authored",
    ).toEqual(winner.getMap<Y.Map<unknown>>("nodes").get("n-shared")?.toJSON());
    loser.destroy();
    winner.destroy();
  });

  it("the tombstone space is replaced as well — the loser's tombstones do not survive", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect([...loser.getMap<unknown>("deleted").keys()].sort()).toEqual(["n-ancient"]);
    loser.destroy();
    winner.destroy();
  });

  it("`meta.epoch` becomes the winner's, and the identity keys do not move", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    // Single-authored: the adoption is one local write of one value by one
    // author, so this is safe to assert by identity (no concurrent same-key
    // write exists to be tie-broken on clientID).
    expect(readEpoch(loser)).toBe(9);
    expect(loser.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBe(9);
    expect(loser.getMap<unknown>(META_MAP_NAME).get(GUID_KEY)).toBe(FIXED_GUID);
    expect(loser.getMap<unknown>(META_MAP_NAME).get(PATH_KEY)).toBe(CANVAS_PATH);
    loser.destroy();
    winner.destroy();
  });

  it("the adoption is ONE transaction under WP28's own origin", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    const adoptions = probe.transactions.filter((tr) => tr.origin === CANVAS_EPOCH_ADOPT_ORIGIN);
    expect(
      adoptions.length,
      "the adoption must be exactly one transaction carrying WP28's origin — a doc " +
        "observed mid-replacement shows a board that is half of each history",
    ).toBe(1);
    expect(probe.transactions.length).toBe(1);
    loser.destroy();
    winner.destroy();
  });

  it("the WINNER's doc is never mutated by the loser's adoption", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    const before = JSON.stringify({
      nodes: recordIds(winner, "nodes"),
      edges: recordIds(winner, "edges"),
      epoch: readEpoch(winner),
    });

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(
      JSON.stringify({
        nodes: recordIds(winner, "nodes"),
        edges: recordIds(winner, "edges"),
        epoch: readEpoch(winner),
      }),
    ).toBe(before);
    loser.destroy();
    winner.destroy();
  });

  it("adopting a winner with an EMPTY board empties the loser — no rescue merge", async () => {
    const loser = makeDoc({ epoch: 1, nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 2 });
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(
      recordIds(loser, "nodes"),
      "keeping the loser's records because the winner had none is a partial win " +
        "wearing a helpful face — the archive is what preserves them",
    ).toEqual([]);
    expect(readEpoch(loser)).toBe(2);
    loser.destroy();
    winner.destroy();
  });
});
