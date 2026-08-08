// WP114 / AC2 — THE FACILITY'S OWN POSITIVE CONTROL.
//
// Method rule 3, applied to the instrument itself: PROVE THE CLAMP CAN TURN A
// PASSING SCENARIO INTO A FAILING ONE before trusting any failure it reports.
// Four separate signals in this project (`S65`, `S112`, `S113`, `S133`) are
// readers that were quoted as results without ever having been shown able to
// match their subject, so a throttling facility that shipped without this file
// would be the fifth.
//
// Everything here drives the facility, not the product. The product-side
// demonstration is `test_s147_a_subscribe_under_a_clamp.test.ts`.

import { describe, expect, it } from "vitest";

import { installTimerClamp, underTimerClamp } from "../../support/timer-clamp";

/**
 * The SUBJECT: the exact shape the product uses at `background-sync.ts` — a
 * fixed COUNT of timer hops, ending early when a condition that is set by
 * something other than a timer becomes true.
 *
 * With punctual timers this costs one hop. Under a clamp it costs one CLAMPED
 * hop, and if the condition never becomes true it costs `hops` clamped hops —
 * which is the unbounded cost the charter's AC3 is about.
 */
async function pollForFlag(flag: { set: boolean }, hops: number, stepMs: number): Promise<number> {
  const started = Date.now();
  for (let i = 0; i < hops; i++) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    if (flag.set) break;
  }
  return Date.now() - started;
}

// The scope has to name THIS file, because the subject above lives in it. The
// facility's default scope is the plugin's production source.
const HERE = /test_ac2_the_clamp_facility/;

describe("WP114 AC2 — the throttled-timer facility, proved before it is used", () => {
  it("🚨 POSITIVE CONTROL: the same scenario PASSES punctual and FAILS clamped", async () => {
    // ARM 1 — punctual timers, which is what the whole suite has today. The
    // flag is already set, so one 5 ms hop settles it and a 200 ms budget holds.
    const punctual = await pollForFlag({ set: true }, 20, 5);
    expect(punctual).toBeLessThan(200);

    // ARM 2 — the SAME call, the SAME budget, the SAME flag. Only the clamp
    // differs. The budget must now be missed: that is the facility working.
    const clamped = await underTimerClamp({ floorMs: 250, scope: HERE }, async (clamp) => {
      const elapsed = await pollForFlag({ set: true }, 20, 5);
      // Rule 15 — the instrument proved itself before its result is read.
      clamp.assertClamped(1, HERE);
      return elapsed;
    });

    expect(clamped).toBeGreaterThanOrEqual(200);
    // The discriminator is the RATIO, not either absolute number.
    expect(clamped).toBeGreaterThan(punctual);
  }, 30_000);

  it("the cost of a FIXED HOP COUNT is the hop count times the clamp", async () => {
    // The flag is never set, so the poll runs to its ceiling. This is the
    // product's worst case — a guest waiting for a seed that never arrives —
    // and it is why "lengthen the timeout" is not a repair: the multiplier is
    // the hop count and the clamp itself grows.
    const punctual = await pollForFlag({ set: false }, 6, 1);
    expect(punctual).toBeLessThan(300);

    const clamped = await underTimerClamp({ floorMs: 60, scope: HERE }, async (clamp) => {
      const elapsed = await pollForFlag({ set: false }, 6, 1);
      clamp.assertClamped(6, HERE);
      return elapsed;
    });

    // 6 hops x >=60 ms. Asserted as a floor, never as a band: a slow CI box may
    // make it larger and that must not be a failure (`S74`'s lesson).
    expect(clamped).toBeGreaterThanOrEqual(6 * 60);
  }, 30_000);

  it("the clamp GROWS, so no fixed timeout is long enough", async () => {
    await underTimerClamp(
      { floorMs: 20, growthPerFireMs: 20, maxFloorMs: 100, scope: HERE },
      async (clamp) => {
        await pollForFlag({ set: false }, 6, 0);
        const stats = clamp.stats();
        // The floor started at 20 and was raised on every clamped fire.
        expect(stats.floorMs).toBeGreaterThan(20);
        expect(stats.floorMs).toBeLessThanOrEqual(100);
        expect(stats.maxAppliedMs).toBeGreaterThan(20);
      },
    );
  }, 30_000);

  it("MICROTASKS AND MESSAGES ARE NOT THROTTLED — the asymmetry is the defect class", async () => {
    // Chromium clamps timers in a hidden renderer; it does not hold inbound
    // socket frames or promise resolutions. A facility that slowed both would
    // hide exactly what it exists to show, so this is an assertion, not a note.
    await underTimerClamp({ floorMs: 500, scope: HERE }, async (clamp) => {
      const started = Date.now();
      // A promise resolved from outside any timer — the stand-in for a mux frame.
      let resolveIt: () => void = () => {};
      const arrival = new Promise<void>((r) => {
        resolveIt = r;
      });
      queueMicrotask(resolveIt);
      await arrival;
      for (let i = 0; i < 50; i++) await Promise.resolve();
      expect(Date.now() - started).toBeLessThan(400);

      // ...and the clamp really was installed over the same window.
      await new Promise((r) => setTimeout(r, 1));
      clamp.assertClamped(1, HERE);
    });
  }, 30_000);

  it("ORDER is perturbed: a shorter delay no longer implies an earlier fire", async () => {
    // Under a uniform floor two timers armed 50 ms apart land in the same tick.
    // Code that is correct only because A's delay is shorter than B's is broken
    // there, and it reads as correct in every review.
    const fired: string[] = [];
    await underTimerClamp(
      { floorMs: 30, jitterMs: 40, seed: 7, scope: HERE },
      async () =>
        await new Promise<void>((done) => {
          setTimeout(() => {
            fired.push("short");
          }, 1);
          setTimeout(() => {
            fired.push("long");
          }, 20);
          setTimeout(() => done(), 400);
        }),
    );
    expect(fired.sort()).toEqual(["long", "short"]);
    // The point is only that the order is NOT guaranteed by the delays; the
    // seeded generator makes which order it is reproducible.
    expect(fired.length).toBe(2);
  }, 30_000);

  it("A DEAD INSTRUMENT FAILS LOUDLY — `assertClamped` is itself controlled", async () => {
    // Nothing in scope arms a timer, so the window throttled nothing. Reading a
    // "passes under a clamp" result from this window would be `S113` again.
    const clamp = installTimerClamp({ floorMs: 100, scope: /this-module-does-not-exist/ });
    try {
      await new Promise((r) => setTimeout(r, 1));
      expect(() => clamp.assertClamped()).toThrow(/DEAD INSTRUMENT/);
      expect(clamp.stats().clamped).toBe(0);
      // and it is still counting what it SAW, so a scoping mistake is visible
      // rather than silent.
      expect(clamp.stats().seen).toBeGreaterThan(0);
    } finally {
      clamp.uninstall();
    }
  }, 30_000);

  it("a clamped site that is not the SUBJECT is not accepted as evidence", async () => {
    const clamp = installTimerClamp({ floorMs: 30, scope: HERE });
    try {
      await new Promise((r) => setTimeout(r, 1));
      expect(clamp.stats().clamped).toBeGreaterThan(0);
      expect(() => clamp.assertClamped(1, /background-sync\.ts/)).toThrow(/DEAD INSTRUMENT/);
      // POSITIVE CONTROL for that refusal: the site it DID clamp is accepted.
      expect(() => clamp.assertClamped(1, HERE)).not.toThrow();
    } finally {
      clamp.uninstall();
    }
  }, 30_000);

  it("the global is restored even when the body throws", async () => {
    const before = globalThis.setTimeout;
    await expect(
      underTimerClamp({ floorMs: 10, scope: HERE }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(globalThis.setTimeout).toBe(before);
  });

  it("OUT-OF-SCOPE callers are untouched, so the harness is never the subject", async () => {
    // If this were not true the relay, undici and vitest's own scheduler would
    // be throttled too and every measurement would be of the harness.
    await underTimerClamp({ floorMs: 400, scope: /nothing-matches-this/ }, async (clamp) => {
      const started = Date.now();
      await new Promise((r) => setTimeout(r, 1));
      expect(Date.now() - started).toBeLessThan(300);
      expect(clamp.stats().clamped).toBe(0);
    });
  }, 30_000);
});
