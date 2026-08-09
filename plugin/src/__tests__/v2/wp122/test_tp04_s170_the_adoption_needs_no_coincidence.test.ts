// WP122 B5 (`S170`) — THE ADOPTION HAPPENS WITH NO OTHER MANIFEST ACTIVITY.
//
// THE MEASUREMENT. An originator sat unadopted for 240 s, then adopted in 0.20 s
// the moment the host created an unrelated note somewhere else in the share.
// The mirror pass is armed by manifest key changes alone, and an accepted
// creation result is not one — so before this package the adoption waited for a
// coincidence. That is also why WP118's third round converged in 0.22 s while
// rounds 1 and 2 waited for the next unrelated manifest write.
//
// 🔴 THE CRITERION IS "NO OTHER MANIFEST ACTIVITY AT ALL" (charter B5). A test
// that permits any other manifest write cannot distinguish the fix from the
// accident. `manifestWrites` counts every mutation of the manifest, of any kind,
// and every row below asserts the exact list.
//
// THE PLANT (charter §5): arm the pass on the REFUSED branch instead of the
// accepted one. `tp04c` is what goes red — and note that `adoptionsArmed`
// increments on the accepted branch either way, so a pass armed on refusal is
// invisible in the stats. The stats are therefore not the oracle here.

import { afterEach, describe, expect, it } from "vitest";

import { BOARD, createAdoptionWorld } from "./harness";

let world: ReturnType<typeof createAdoptionWorld> | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

describe("WP122 B5 — `S170`: an accepted creation re-asks the mirror by itself", () => {
  it("tp04a: the accepted result adopts the board, and the manifest is not touched to do it", async () => {
    world = createAdoptionWorld();
    expect(await world.request()).toBe("sent");
    // The host's publish is the ONE manifest write in this world, and it has
    // already happened before the answer arrives.
    expect(world.manifestWrites).toStrictEqual([`publish:${BOARD}`]);
    expect(world.passes).toBe(0);
    expect(world.hasWriter(BOARD)).toBe(false);

    expect(world.answer(true)).toBe(true);
    await world.settle();

    // THE CRITERION: a pass ran, the path was adopted, and NOTHING ELSE wrote
    // the manifest between the answer and the adoption.
    expect(world.passes).toBe(1);
    expect(world.hasWriter(BOARD)).toBe(true);
    expect(world.manifestWrites).toStrictEqual([`publish:${BOARD}`]);
    // One-shot: the adoption was consumed, so a later pass is an ordinary skip.
    expect(world.coordinator.originatedHere(BOARD)).toBe(false);
    expect(world.coordinator.getStats().adoptionsCleared).toBe(1);
  });

  it("tp04b: 🔴 THE DISCRIMINATOR — without the arm seam nothing runs, and this is the 240 s stall", async () => {
    // Identical inputs, identical answer. The env differs in ONE member, and it
    // is the member this package adds.
    world = createAdoptionWorld({ withoutArmSeam: true });
    expect(await world.request()).toBe("sent");
    expect(world.answer(true)).toBe(true);
    await world.settle();

    expect(world.passes).toBe(0);
    expect(world.hasWriter(BOARD)).toBe(false);
    // The adoption is armed and waiting — for a manifest write that this world,
    // like the live share, has no reason to perform.
    expect(world.coordinator.originatedHere(BOARD)).toBe(true);
    expect(world.coordinator.getStats().adoptionsArmed).toBe(1);
    expect(world.coordinator.getStats().adoptionsCleared).toBe(0);
    expect(world.manifestWrites).toStrictEqual([`publish:${BOARD}`]);
  });

  it("tp04c: a REFUSED result arms nothing — the branch matters, not the call", async () => {
    world = createAdoptionWorld();
    expect(await world.request()).toBe("sent");

    expect(world.answer(false)).toBe(true);
    await world.settle();

    expect(world.passes).toBe(0);
    expect(world.hasWriter(BOARD)).toBe(false);
    expect(world.coordinator.originatedHere(BOARD)).toBe(false);
    // A4 — and the user was told. A refusal that armed a pass would also be a
    // refusal that looked, from the stats alone, exactly like an acceptance.
    expect(world.notices.some((n) => n.includes(BOARD))).toBe(true);
    expect(world.coordinator.getStats().refused).toBe(1);
    expect(world.coordinator.getStats().adoptionsArmed).toBe(0);
  });

  it("tp04d: 🔴 `adoptionsArmed` cannot tell the two branches apart, so it is not the oracle", async () => {
    // Stated as a row because it is the reason tp04a asserts `passes` and
    // `hasWriter` rather than the ledger: the counter this package's plant would
    // move is the same either way.
    const accepted = createAdoptionWorld();
    await accepted.request();
    accepted.answer(true);
    await accepted.settle();

    const refused = createAdoptionWorld();
    await refused.request();
    refused.answer(false);
    await refused.settle();

    expect(accepted.coordinator.getStats().adoptionsArmed).toBe(1);
    expect(refused.coordinator.getStats().adoptionsArmed).toBe(0);
    // …but `results` — the counter a live validator watching "did the handshake
    // complete" would read — is identical on both branches.
    expect(accepted.coordinator.getStats().results).toBe(
      refused.coordinator.getStats().results,
    );
    accepted.destroy();
    refused.destroy();
  });

  it("tp04e: a result this peer never requested arms nothing at all", async () => {
    // The ordinary case for every peer but one: the relay broadcasts. An arm on
    // an unmatched result would re-run the pass on every peer for every
    // creation in the session.
    world = createAdoptionWorld();
    await world.request();
    const armed = world.coordinator.handleResult({
      requestId: "somebody-elses-request",
      path: BOARD,
      accepted: true,
      reason: "materialise",
      detail: "",
    });
    await world.settle();

    expect(armed).toBe(false);
    expect(world.passes).toBe(0);
    expect(world.coordinator.getStats().unmatchedResults).toBe(1);
  });
});
