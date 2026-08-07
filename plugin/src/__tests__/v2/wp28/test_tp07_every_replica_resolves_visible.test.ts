// WP28 / AC1 — "the higher epoch wins completely ON EVERY REPLICA", and the
// fuzzer link: "replicas with unequal epochs all resolve to the higher epoch's
// state, and no replica silently merges the two histories".
//
// THREE replicas, never two. With two peers an agreed-but-wrong outcome and a
// converged one are the same picture (WP23 AC1 enforces the same floor in the
// fuzzer core), and the interleaving classes from three upward are distinct.
//
// WHICH ASSERTIONS ARE SAFE HERE, AND WHY (Shared Ownership Contract §5, WP28)
// ---------------------------------------------------------------------------
// Yjs tie-breaks a genuinely concurrent same-key write on `clientID =
// random.uint32()`, so an assertion on a specific winner where both sides wrote
// concurrently passes about half the time.
//
//   ├── `meta.epoch` after adoption IS assertable by IDENTITY. The adoption is a
//   │      local write on each loser's own doc, of a value read from the winner —
//   │      one author per doc, no concurrent same-key write to arbitrate. That
//   │      single-authorship is not incidental: it is exactly why an epoch can
//   │      carry an ordering that record content cannot, and therefore why this
//   │      mechanism exists at all.
//   ├── the RECORD ID SET after adoption is assertable by identity for the same
//   │      reason — each loser replaced its own containers, alone.
//   └── record CONTENT after the adopted replicas are merged back together is
//          GENUINELY CONTESTED (three replicas re-authoring the same field
//          concurrently), so it is asserted as CONVERGENCE + MEMBERSHIP: every
//          replica agrees, and the surviving value is one somebody actually
//          wrote. Never which one.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import { readEpoch, resolveEpochConflict } from "../../../canvas/canvas-epoch";
import { CANVAS_PATH, createProbe, fieldOf, makeDoc, mergeDocs, node, recordIds } from "./harness";

const REPLICA_COUNT = 3;

function losers() {
  return Array.from({ length: REPLICA_COUNT }, (_unused, index) =>
    makeDoc({
      epoch: index, // 0, 1, 2 — all strictly below the winner
      nodes: {
        "n-shared": node("n-shared", `replica ${index} text`),
        [`n-only-${index}`]: node(`n-only-${index}`, `private to replica ${index}`, 100 * index),
      },
    }),
  );
}

function winnerDoc() {
  return makeDoc({
    epoch: 9,
    nodes: {
      "n-shared": node("n-shared", "the imported text"),
      "n-imported": node("n-imported", "imported only", 900),
    },
  });
}

describe("WP28 AC1 — every replica resolves to the winner, none merges the two histories", () => {
  it("all three replicas end on the winner's exact id set", async () => {
    const replicas = losers();
    const winner = winnerDoc();

    for (const replica of replicas) {
      const probe = createProbe();
      await resolveEpochConflict({
        doc: replica,
        winner,
        canvasPath: CANVAS_PATH,
        env: probe.env,
      });
    }

    for (const [index, replica] of replicas.entries()) {
      expect(recordIds(replica, "nodes"), `replica ${index}`).toEqual(["n-imported", "n-shared"]);
      expect(
        replica.getMap<Y.Map<unknown>>("nodes").has(`n-only-${index}`),
        `replica ${index} kept its own private record — it merged the two histories`,
      ).toBe(false);
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("all three land on the SAME epoch, and it is the winner's", async () => {
    const replicas = losers();
    const winner = winnerDoc();

    for (const replica of replicas) {
      const probe = createProbe();
      await resolveEpochConflict({ doc: replica, winner, canvasPath: CANVAS_PATH, env: probe.env });
    }

    // Single-authored per doc — see the header. Safe by identity.
    const epochs = replicas.map((replica) => readEpoch(replica));
    expect(epochs).toEqual([9, 9, 9]);
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("every replica archives its OWN state — three conflicts, three distinct copies", async () => {
    const replicas = losers();
    const winner = winnerDoc();
    const probes = replicas.map(() => createProbe());

    for (const [index, replica] of replicas.entries()) {
      await resolveEpochConflict({
        doc: replica,
        winner,
        canvasPath: CANVAS_PATH,
        env: probes[index].env,
      });
    }

    for (const [index, probe] of probes.entries()) {
      expect(probe.writes.length, `replica ${index} archived ${probe.writes.length} times`).toBe(1);
      expect(probe.writes[0].content, `replica ${index} archived somebody else's state`).toContain(
        `private to replica ${index}`,
      );
      expect(probe.writes[0].content).not.toContain("imported only");
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("a replica ALREADY at the winner's epoch archives nothing and keeps merging", async () => {
    // The related-replica case sitting beside the unrelated ones: three peers,
    // one of which already carries epoch 9. It must be untouched.
    const related = makeDoc({
      epoch: 9,
      nodes: { "n-shared": node("n-shared", "already current"), "n-mine": node("n-mine", "mine") },
    });
    const winner = winnerDoc();
    const probe = createProbe();

    const outcome = await resolveEpochConflict({
      doc: related,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(outcome.verdict).toBe("equal");
    expect(probe.writes).toEqual([]);
    expect(probe.notices).toEqual([]);
    expect(
      recordIds(related, "nodes"),
      "an equal-epoch replica had its records replaced — that is the archive path " +
        "firing on an ordinary related-replica merge",
    ).toEqual(["n-mine", "n-shared"]);
    related.destroy();
    winner.destroy();
  });

  it("after adoption the replicas still MERGE — contested content converges, membership holds", async () => {
    const replicas = losers();
    const winner = winnerDoc();
    for (const replica of replicas) {
      const probe = createProbe();
      await resolveEpochConflict({ doc: replica, winner, canvasPath: CANVAS_PATH, env: probe.env });
    }

    // Genuinely concurrent same-key writes: three authors, one field, no causal
    // predecessor chain. The winner is arbitrated on clientID.
    const authored: unknown[] = [];
    for (const [index, replica] of replicas.entries()) {
      const value = `edited by ${index}`;
      authored.push(value);
      replica.transact(() => {
        replica.getMap<Y.Map<unknown>>("nodes").get("n-shared")?.set("text", value);
      });
    }
    for (const a of replicas) for (const b of replicas) if (a !== b) mergeDocs(a, b);
    for (const a of replicas) for (const b of replicas) if (a !== b) mergeDocs(a, b);

    const settled = replicas.map((replica) => fieldOf(replica, "nodes", "n-shared", "text"));
    expect(new Set(settled).size, "the replicas did not converge").toBe(1);
    expect(
      authored,
      "the surviving value was authored by nobody — assert membership, never identity",
    ).toContain(settled[0]);

    // The epoch, by contrast, is identical on every replica because every author
    // wrote the SAME value: the tie-break cannot change the answer.
    expect(replicas.map((replica) => readEpoch(replica))).toEqual([9, 9, 9]);
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("no replica ends up holding another replica's private record", async () => {
    const replicas = losers();
    const winner = winnerDoc();
    for (const replica of replicas) {
      const probe = createProbe();
      await resolveEpochConflict({ doc: replica, winner, canvasPath: CANVAS_PATH, env: probe.env });
    }
    for (const a of replicas) for (const b of replicas) if (a !== b) mergeDocs(a, b);

    for (const [index, replica] of replicas.entries()) {
      for (let other = 0; other < REPLICA_COUNT; other++) {
        expect(
          replica.getMap<Y.Map<unknown>>("nodes").has(`n-only-${other}`),
          `replica ${index} resurrected replica ${other}'s private record through the merge`,
        ).toBe(false);
      }
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });
});
