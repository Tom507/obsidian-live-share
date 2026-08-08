// WP117 / A7 — THE RESIDUAL, DEMONSTRATED CLOSED WITH `NO_PEERS` ACTUALLY
// INDUCED. It is not argued about anywhere in this file.
//
// THE DEFECT, as `BUILD_SPEC` §7 states it: `canvas-sync.ts` computes
// `peerKnowsDoc` as "did bytes arrive across the await". Under `NO_PEERS`
// (`S131`) nothing arrives, because there was NOBODY TO ASK — so the flag is
// `false`, `decideSeed` returns `SEED_FROM_FILE`, and a guest holding a STALE
// canvas that wins the subscribe race seeds its stale content into the shared
// document. The host's later subscribe finds a non-empty doc, takes `doc-wins`,
// and the host's own `.canvas` is rewritten from it.
//
// THE CONDITION IS INDUCED, NOT SIMULATED. The relay in this harness answers the
// sync step with the same rule the product's does — `peerCount === 0` means
// nobody else holds this doc — and the ledger it keeps is asserted on below, so
// "the run was in the `NO_PEERS` arm" is a measurement rather than a comment.
//
// BOTH ARMS ARE RUN, and they differ in EXACTLY ONE FIELD of ONE object: the
// `role` the writer attach stamps onto the seed knowledge. Everything else —
// the files, the order of the subscribes, the relay, the manifest — is identical.
// The control arm is the pre-WP117 line, and it LOSES DATA. Scored on disk bytes
// (S138), on the host's own file.
//
// PRODUCTION LINES <-> ASSERTIONS: `files/canvas-seed-decision.ts`
// (`explainSeed`'s authority clause), and the `seedKnowledge` argument built in
// `main.ts`'s `attachCanvasWriter`.

import { describe, expect, it } from "vitest";

import {
  SEED_DECISION,
  SEED_RULE,
  decideSeed,
  explainSeed,
} from "../../../files/canvas-seed-decision";
import { SYNC_OUTCOME, canvasJson, canvasPath, createWorld, settle, textNode } from "./harness";

const PATH = canvasPath("board");
const PUBLISHED_GUID = "8f14e45fceea167a5a36dedd4bea2543";

// The host's board TODAY: one card. The card the user deleted last week is gone.
const HOST_NOW = canvasJson([textNode("keep", 0, "still on the board")]);
// The guest's copy from LAST WEEK, still holding the deleted card.
const GUEST_STALE = canvasJson([
  textNode("keep", 0, "still on the board"),
  textNode("deleted-last-week", 400, "the user removed this"),
]);

/**
 * The race, set up so the GUEST reaches the relay first.
 *
 * `stampSeedRole: false` is the pre-WP117 arm. Nothing else differs.
 */
async function raceWorld(stampSeedRole: boolean) {
  const world = await createWorld();
  const host = await world.add({ id: "host", role: "host", files: { [PATH]: HOST_NOW } });
  const guest = await world.add({
    id: "g1",
    role: "guest",
    files: { [PATH]: GUEST_STALE },
    stampSeedRole,
  });

  // A PREVIOUS session published this canvas's identity, and the relay still
  // holds the manifest. Nobody holds the DOCUMENT: that is what makes the first
  // subscriber of this session a `NO_PEERS` subscriber, and it is the ordinary
  // state of every rejoin.
  host.manifest.setCanvasGuid(PATH, PUBLISHED_GUID);
  await settle();
  expect(guest.manifest.getCanvasGuid(PATH)).toBe(PUBLISHED_GUID);

  return { world, host, guest };
}

describe("WP117 A7 — the condition itself, measured", () => {
  it("the first subscriber of a session is told NO_PEERS, and the relay says so", async () => {
    const { world, guest } = await raceWorld(true);
    await guest.subscribe(PATH);
    await settle();

    const answers = world.relay.resolutions.filter(
      (r) => r.peer === "g1" && r.docId.includes(PUBLISHED_GUID),
    );
    expect(answers.length, "the guest never performed a sync step for this doc").toBeGreaterThan(0);
    expect(answers[0].outcome).toBe(SYNC_OUTCOME.NO_PEERS);

    // …and this is the fact the seed decision is handed: nothing arrived across
    // the await, so the "somebody else knows this board" witness is false.
    expect(guest.canvasSync.seedKnowledgeFor(PATH)).toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: false,
    });

    world.peers.forEach((p) => p.destroy());
  });

  it("POSITIVE CONTROL: with both witnesses false and no role, the decision IS to seed", () => {
    // If this row ever goes the other way the whole file is vacuous — the arms
    // below would agree because nothing seeds under any circumstances.
    const knowledge = { sidecarKnowsDoc: false, peerKnowsDoc: false };
    expect(decideSeed(knowledge)).toBe(SEED_DECISION.SEED_FROM_FILE);
    expect(explainSeed(knowledge).rule).toBe(SEED_RULE.SEED_NOTHING_KNOWS_DOC);
  });
});

describe("WP117 A7 — the pre-WP117 arm loses the host's data", () => {
  it("a stale guest that wins the race resurrects a deleted card ONTO THE HOST'S DISK", async () => {
    const { world, host, guest } = await raceWorld(false);

    // 1. The guest wins the race and seeds. Its cold open is the real one.
    await guest.subscribe(PATH);
    await settle();
    guest.scheduler.runAll();
    await settle();

    // 2. The host arrives second and finds a non-empty document.
    await host.subscribe(PATH);
    await settle();
    host.scheduler.runAll();
    await settle();

    // THE LOSS, ON THE HOST'S OWN DISK. The card the user deleted last week is
    // back, written into the host's `.canvas` by the host's own writer.
    expect(host.disk(PATH)).toContain("deleted-last-week");
    expect(host.disk(PATH)).not.toBe(HOST_NOW);

    world.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A7 — with the repair, the same run leaves the host's board alone", () => {
  it("the guest does not seed, and the host's disk keeps exactly the records it had", async () => {
    const { world, host, guest } = await raceWorld(true);

    await guest.subscribe(PATH);
    await settle();
    guest.scheduler.runAll();
    await settle();

    // THE GUEST SEEDED NOTHING. Measured on the shared document, which is what
    // the host will meet — not on the guest's own file, which is untouched
    // either way at this point.
    const sharedDoc = guest.docFor(PATH);
    expect(sharedDoc?.getMap("nodes").size, "the guest seeded its stale file").toBe(0);

    await host.subscribe(PATH);
    await settle();
    host.scheduler.runAll();
    await settle();

    // THE HOST'S BOARD IS INTACT — the deleted card stayed deleted.
    expect(host.disk(PATH)).not.toContain("deleted-last-week");
    expect(host.disk(PATH)).toContain("still on the board");

    // …and the guest converged ONTO THE HOST'S document, which is the other half
    // of the same statement: it did not merely fail to seed and keep its copy.
    await settle();
    guest.scheduler.runAll();
    await settle();
    expect(guest.disk(PATH), "the guest kept its stale copy").not.toContain(
      "deleted-last-week",
    );

    world.peers.forEach((p) => p.destroy());
  });

  it("the refusal is ATTRIBUTED, so a live log can tell it from a decision never reached", () => {
    // S155. Four of the five rules are declines and they are different facts:
    // "a guest may not seed" is a design rule and "a peer knows this doc" is a
    // measurement. A single boolean cannot say which one answered.
    expect(
      explainSeed({ sidecarKnowsDoc: false, peerKnowsDoc: false, role: "guest" }),
    ).toEqual({ decision: SEED_DECISION.LOAD_OR_MERGE, rule: SEED_RULE.LOAD_NOT_THE_SEEDER });
    expect(
      explainSeed({ sidecarKnowsDoc: true, peerKnowsDoc: false, role: "host" }).rule,
    ).toBe(SEED_RULE.LOAD_SIDECAR_KNOWS);
    expect(
      explainSeed({ sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" }).rule,
    ).toBe(SEED_RULE.LOAD_PEER_KNOWS);
    expect(explainSeed(null as never).rule).toBe(SEED_RULE.LOAD_PROBE_UNANSWERABLE);
    // `decideSeed` is exactly `explainSeed(...).decision`, so the two cannot
    // disagree about any input.
    for (const role of [undefined, "host", "guest"] as const) {
      for (const sidecarKnowsDoc of [true, false]) {
        for (const peerKnowsDoc of [true, false]) {
          const knowledge = { sidecarKnowsDoc, peerKnowsDoc, role };
          expect(decideSeed(knowledge)).toBe(explainSeed(knowledge).decision);
        }
      }
    }
  });

  it("AUTHORITY IS ASKED FIRST, and an OMITTED role keeps the pre-WP117 table exactly", () => {
    // The ordering claim: a guest with both witnesses false refuses on the role
    // and not on the evidence.
    expect(
      explainSeed({ sidecarKnowsDoc: false, peerKnowsDoc: false, role: "guest" }).rule,
    ).toBe(SEED_RULE.LOAD_NOT_THE_SEEDER);
    // The compatibility claim, both directions. An omitted role answers exactly
    // what WP29's table answered; a stated host role answers the same.
    const rows: Array<[boolean, boolean, string]> = [
      [false, false, SEED_DECISION.SEED_FROM_FILE],
      [true, false, SEED_DECISION.LOAD_OR_MERGE],
      [false, true, SEED_DECISION.LOAD_OR_MERGE],
      [true, true, SEED_DECISION.LOAD_OR_MERGE],
    ];
    for (const [sidecarKnowsDoc, peerKnowsDoc, expected] of rows) {
      expect(decideSeed({ sidecarKnowsDoc, peerKnowsDoc })).toBe(expected);
      expect(decideSeed({ sidecarKnowsDoc, peerKnowsDoc, role: "host" })).toBe(expected);
      expect(decideSeed({ sidecarKnowsDoc, peerKnowsDoc, role: "guest" })).toBe(
        SEED_DECISION.LOAD_OR_MERGE,
      );
    }
  });
});
