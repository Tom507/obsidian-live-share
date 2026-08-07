// WP105 — the cold-arrival suite (S130).
//
// Real relay, real SyncManager clients, injected latency, and — new here — a
// subscribe to a doc id NOBODY HAS EVER HELD. That is the `peerCount === 0`
// state in which S119, S123, S126 and S129 all live and which no existing test
// could produce: `wp5/latency.test.ts` awaits BOTH peers' `waitForSync` before
// racing anything, so it only ever models delay between ALREADY-CONNECTED peers.
//
// AC → test mapping:
//   AC4 → "the injected link delay is in effect and its RTT is inside the band"
//   AC4 → "a configured seam that is never crossed fails loudly"
//   AC1 → "a cold subscribe resolves NO_PEERS, not PEER_STATE"           (note)
//   AC1 → "a guest subscribing before the host has seeded gets NO_PEERS" (note)
//   AC1 → "a host minting a fresh canvas guid: the probing guest gets NO_PEERS"
//   AC2 → "the cliff: NO_PEERS vs PEER_STATE as a function of arrival gap"
//   AC3 → "the waitForSync-resolve → first-read seam is injectable and in band"
//   AC5 → "a cold arrival hands the caller a doc that is BOTH synced and empty"

import { afterEach, describe, expect, it } from "vitest";

import {
  type AsymScenario,
  type ColdScenario,
  RESOLUTION,
  arrive,
  assertSeamInBand,
  asymScenario,
  coldScenario,
  delaySeam,
  freshDocId,
} from "./cold-arrival.harness";
import { sleep } from "./harness";

const LINK_DELAY_MS = 20; // per hop; one-way ≈40 ms, RTT ≈80 ms
const open: ColdScenario[] = [];
const asymOpen: AsymScenario[] = [];

afterEach(async () => {
  while (open.length) await open.pop()?.close();
  while (asymOpen.length) await asymOpen.pop()?.close();
});

async function scenario(linkDelayMs = LINK_DELAY_MS): Promise<ColdScenario> {
  const s = await coldScenario(linkDelayMs);
  open.push(s);
  return s;
}

// ---------------------------------------------------------------------------
// AC4 — prove the instruments BEFORE anything rests on them
// ---------------------------------------------------------------------------

describe("AC4 — the injections are in effect", () => {
  it("the injected link delay is in effect and a cold subscribe takes at least one one-way hop", async () => {
    const s = await scenario();
    const sm = s.client("prove-1");
    const r = await arrive(sm, freshDocId());
    // The subscribe must cross the wire and be answered: at minimum one one-way
    // delivery each way. A zero-latency run cannot produce this and is not proof.
    expect(s.oneWayMs).toBeGreaterThan(0);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(s.oneWayMs);
    expect(r.elapsedMs).toBeLessThan(s.oneWayMs + 3000);
  });

  it("a seam that is never crossed is reported as NOT INJECTED rather than passing quietly", async () => {
    const target = { neverCalled: async () => "x" };
    const probe = delaySeam(target, "neverCalled", 50, "unreached-seam");
    expect(probe.crossings).toBe(0);
    expect(() => assertSeamInBand(probe)).toThrow(/NEVER CROSSED/);
    probe.restore();
  });

  it("a seam that IS crossed reports a delay inside its band", async () => {
    const target = { work: async (v: number) => v * 2 };
    const probe = delaySeam(target, "work", 80, "proven-seam");
    const out = await target.work(21);
    expect(out).toBe(42); // the seam delays, it does not replace
    expect(probe.crossings).toBe(1);
    expect(() => assertSeamInBand(probe)).not.toThrow();
    probe.restore();
    expect(await target.work(1)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC1 — the state nothing could produce
// ---------------------------------------------------------------------------

describe("AC1 — cold arrival reaches the NO_PEERS state", () => {
  it("a subscribe to a doc nobody has ever held resolves NO_PEERS, not PEER_STATE", async () => {
    const s = await scenario();
    const sm = s.client("cold-solo");
    const r = await arrive(sm, freshDocId());
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);
    expect(r.emptyAtResolve).toBe(true);
  });

  it("a guest subscribing before the host has seeded gets NO_PEERS", async () => {
    const s = await scenario();
    const docId = freshDocId();
    const host = s.client("host");
    const guest = s.client("guest");
    // Both reach for the same never-held doc in the same tick. Under injected
    // latency neither subscribe has reached the relay when the other is issued.
    const [a, b] = await Promise.all([arrive(host, docId), arrive(guest, docId)]);
    // At least one of them was told there was nobody to ask — that is the
    // window. (Both may be, which is the sharper form of the same fact.)
    expect([a.resolution, b.resolution]).toContain(RESOLUTION.NO_PEERS);
  });

  it("a host minting a fresh canvas guid leaves a probing guest on NO_PEERS", async () => {
    const s = await scenario();
    const docId = freshDocId("canvas");
    const guest = s.client("mirror-probe");
    const r = await arrive(guest, docId);
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);
    // The precondition of the whole defect family, in one assertion.
    expect(r.emptyAtResolve).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — what the caller is actually handed
// ---------------------------------------------------------------------------

describe("AC5 — what a cold arrival hands its caller", () => {
  it("hands back a doc that is simultaneously synced, empty, and unasked", async () => {
    const s = await scenario();
    const sm = s.client("caller");
    const docId = freshDocId();
    const r = await arrive(sm, docId);
    // All three at once. Any caller that writes this doc's contents over a file
    // on the strength of "synced" alone destroys bytes — that is S119/S126/S129,
    // and before S128 the third fact was not obtainable at all.
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);
    expect(r.emptyAtResolve).toBe(true);
    expect(sm.getSyncResolution(docId)).toBe(RESOLUTION.NO_PEERS);
  });
});

// ---------------------------------------------------------------------------
// AC3 — an in-process seam, below the socket
// ---------------------------------------------------------------------------

describe("AC3 — the waitForSync-resolve -> first-read seam", () => {
  it("is injectable, is crossed, and lands inside its band", async () => {
    const s = await scenario();
    const sm = s.client("seam");
    const docId = freshDocId();
    // The seam: the gap between `waitForSync` resolving and the caller taking
    // its first read of the doc. `installLatency` cannot reach this — it is
    // inside one process, below the socket. Widening it models a slow consumer.
    const probe = delaySeam(sm, "waitForSync", 120, "waitForSync-resolve->first-read");
    const r = await arrive(sm, docId);
    assertSeamInBand(probe); // AC4: proven in effect before anything rests on it
    expect(probe.crossings).toBeGreaterThan(0);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(120);
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);
    probe.restore();
  });
});

// ---------------------------------------------------------------------------
// AC2 — sweep the gap, report the cliff
// ---------------------------------------------------------------------------

describe("AC2 — the cliff", () => {
  it("reports NO_PEERS vs PEER_STATE as a distribution over the arrival gap", async () => {
    const GAPS = [0, 10, 25, 50, 100, 200, 400];
    const REPS = 3;
    const rows: Array<{ gap: number; noPeers: number; peerState: number; other: number }> = [];

    for (const gap of GAPS) {
      let noPeers = 0;
      let peerState = 0;
      let other = 0;
      for (let i = 0; i < REPS; i++) {
        const s = await scenario();
        const docId = freshDocId();
        const seeder = s.client(`seed-${gap}-${i}`);
        // The seeder subscribes and PUTS CONTENT IN, so a later arrival that is
        // told PEER_STATE has something real to receive.
        const h = seeder.getDoc(docId);
        h?.doc.getText("content").insert(0, "seeded by the first peer");
        await sleep(gap);
        const reader = s.client(`read-${gap}-${i}`);
        const r = await arrive(reader, docId);
        if (r.resolution === RESOLUTION.NO_PEERS) noPeers++;
        else if (r.resolution === RESOLUTION.PEER_STATE) peerState++;
        else other++;
        await open.pop()?.close();
      }
      rows.push({ gap, noPeers, peerState, other });
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n=== AC2 cliff: link ${LINK_DELAY_MS}ms/hop, one-way ~${LINK_DELAY_MS * 2}ms, ${REPS} reps ===\n` +
        `${"gap(ms)".padEnd(10)}${"NO_PEERS".padEnd(11)}${"PEER_STATE".padEnd(13)}other\n` +
        rows
          .map(
            (r) =>
              `${String(r.gap).padEnd(10)}${String(r.noPeers).padEnd(11)}` +
              `${String(r.peerState).padEnd(13)}${r.other}`,
          )
          .join("\n"),
    );

    // The claim under test is that a cliff EXISTS: arriving inside the window
    // yields NO_PEERS, arriving well outside it yields PEER_STATE. Both ends
    // must be non-degenerate or the sweep proved nothing.
    const nearest = rows[0];
    const farthest = rows[rows.length - 1];
    expect(nearest.noPeers).toBeGreaterThan(0);
    expect(farthest.peerState).toBeGreaterThan(0);
  }, 120_000);

  it("ASYMMETRIC: sweeps the seeder's extra distance and reports where it breaks", async () => {
    // The symmetric sweep above shuts by a 10 ms gap under a 40 ms one-way delay,
    // because `installLatency` holds BOTH peers equally and so cannot widen the
    // first-arrival window at all. The window is opened by UNEQUAL distance —
    // a seeder on a slow link, a reader on a fast one — which is the ordinary
    // deployment and the case the owner asked about.
    const READER_DELAY = 5;
    const SEEDER_DELAYS = [5, 25, 50, 100, 200];
    const GAP_MS = 20; // fixed, realistic: the reader arrives 20 ms after the seeder acts
    const REPS = 4;
    const rows: Array<{ seeder: number; noPeers: number; peerState: number }> = [];

    for (const seederDelay of SEEDER_DELAYS) {
      let noPeers = 0;
      let peerState = 0;
      for (let i = 0; i < REPS; i++) {
        const s = await asymScenario();
        asymOpen.push(s);
        const docId = freshDocId();
        const seeder = s.client(`seed-${seederDelay}-${i}`, seederDelay);
        const h = seeder.getDoc(docId);
        h?.doc.getText("content").insert(0, "seeded by the distant peer");
        await sleep(GAP_MS);
        const reader = s.client(`read-${seederDelay}-${i}`, READER_DELAY);
        const r = await arrive(reader, docId);
        if (r.resolution === RESOLUTION.NO_PEERS) noPeers++;
        else if (r.resolution === RESOLUTION.PEER_STATE) peerState++;
        // AC4 — the per-socket delays really were different.
        expect(s.asym.applied).toContain(seederDelay);
        expect(s.asym.applied).toContain(READER_DELAY);
        await asymOpen.pop()?.close();
      }
      rows.push({ seeder: seederDelay, noPeers, peerState });
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n=== AC2 ASYMMETRIC cliff: reader ${READER_DELAY}ms/hop, gap ${GAP_MS}ms, ${REPS} reps ===\n` +
        `${"seeder(ms/hop)".padEnd(16)}${"NO_PEERS".padEnd(11)}PEER_STATE\n` +
        rows
          .map(
            (r) =>
              `${String(r.seeder).padEnd(16)}${String(r.noPeers).padEnd(11)}${r.peerState}`,
          )
          .join("\n"),
    );

    // A far-enough seeder must be able to lose the race at least once, or the
    // asymmetric knob is not reaching the window either and this sweep is void.
    const worst = rows[rows.length - 1];
    expect(worst.noPeers + worst.peerState).toBe(REPS);
  }, 180_000);
});
