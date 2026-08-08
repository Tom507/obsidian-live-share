// WP120 — A PRESENCE LOCK NEEDS A LIFETIME.
//
// The defect, end to end and all of it production code:
//
//   files/canvas-sync.ts:4130   applyLocalDiffToYMaps -> onLocalNodeChange(path, id)
//                               for EVERY node a local capture pass upserts
//   main.ts:2505                -> canvasPresences.get(path).onDiffInferredChange(id)
//   canvas-presence.ts          -> acquireLock(id)  [AWARENESS WRITE]
//   canvas-adapter.ts:845       emitHeld() can only release ids IT put into `held`,
//                               and a diff-inferred id was never there
//   canvas-presence.ts          reconcileClaims(): a LOWER clientID co-holder wins
//
// The clientID tiebreak is fixed for the session, so the higher-id peer loses every
// contest on every card it has ever touched — for the life of the session. That is
// the owner's "every time, and it never recovers".
//
// WP119 shrank the COST of a stale claim (whole-board `setData` -> one per-node
// apply) and escalated the cause. WP120 removes the cause: a claim now carries its
// ORIGIN, and only the origin with no gesture to end it can be retired by idleness.
//
// ── WHAT THIS FILE DRIVES, AND WHAT IT DOES NOT ───────────────────────────────
//
//   REAL  `CanvasPresence`, unmocked, two instances.
//   REAL  y-protocols `Awareness` over a real `Y.Doc` per peer, joined by a wire
//         that encodes and applies genuine awareness updates. This matters and is
//         the reason this file does NOT reuse the shared-`Map` awareness double the
//         older presence tests use: the whole repair hangs on the `change` event
//         actually firing on the OTHER peer, and y-protocols emits `change` only
//         when a state deep-changed. A hand-built map that notifies on every write
//         would grant the premise the repair depends on.
//   REAL  `createCanvasAdapter` over the `CanvasDouble`, driven through
//         `InteractionDriver`, so a "gesture" claim is produced by the real
//         `updateSelection` / `setDragging` monkey-patches and not by calling
//         `acquireLock` in the test's own voice.
//   REAL  clock — injected, never slept on. Every release is asserted by advancing
//         a number.
//
//   NOT DRIVEN, deliberately, and named so nobody reads a green here as covering it:
//     * `onRevert`'s BODY. In production it is `main.ts#revertCanvasNode`; here it
//       is a recorder. Whether the revert does the right thing is WP119's subject
//       and is measured in `v2/selmove`. THIS file's subject is whether it is
//       CALLED — which is exactly what the leak got wrong.
//     * y-protocols' 30 s prune. The idle window is asserted to sit inside it; the
//       prune itself is transport behaviour and is not re-tested here.
//     * Any renderer. The `CanvasDouble` has none.
//
// ── VACUITY GUARDS (every row that must be able to go red has a control) ───────
//   A1  the release row is paired with a NOT-YET-IDLE row one millisecond inside
//       the window, so "the sweep drops everything" cannot pass both.
//   A2  the self-healing row is paired with a FRESH-CONTEST row that still reverts,
//       so "reverts stopped happening" cannot pass both. This is WP119 plant B3's
//       shape, which passed that file's headline row while breaking exactly this.
//   A3  every "it survived" row advances the SAME clock over an inferred claim that
//       does NOT survive it, so "the clock never moved" cannot pass.
//   A4  the tiebreak rows are paired with the acquisition row, so "stop claiming
//       altogether" — which would pass A1 and A2 perfectly — cannot pass here.
//   A5  the "no revert" row is paired with a row in which a revert DOES fire.

import * as Y from "yjs";

import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  outdatedTimeout,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { afterEach, describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type AwarenessLike,
  CanvasPresence,
  INFERRED_LOCK_IDLE_MS,
  holdersOf,
} from "../../../canvas/canvas-presence";
import { DEBOUNCE_MS, MAX_WAIT_MS } from "../../../files/canvas-sync";
import { CanvasDouble, type DoubleNodeRecord } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const PATH = "_liveshare-test/wp120.canvas";

const BOARD: DoubleNodeRecord[] = [
  { id: "n1", x: 0, y: 0, width: 200, height: 100, type: "text", text: "one" },
  { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
  { id: "n3", x: 0, y: 300, width: 200, height: 100, type: "text", text: "three" },
];

/** Origin tag for wire-applied updates, so an application never echoes back out. */
const WIRE = "wp120-wire";

// ---------------------------------------------------------------------------
// A real awareness wire. Every peer owns a real `Y.Doc` + real `Awareness`; an
// update on one is ENCODED and APPLIED on the others exactly as the transport
// does it (`sync/sync.ts` uses the same two functions).
// ---------------------------------------------------------------------------
class AwarenessWire {
  private readonly members: Awareness[] = [];

  join(a: Awareness): void {
    a.on("update", (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === WIRE) return; // never echo a received update back onto the wire
      const alive = [...changes.added, ...changes.updated];
      const gone = [...changes.removed];
      for (const other of this.members) {
        if (other === a) continue;
        if (alive.length > 0) applyAwarenessUpdate(other, encodeAwarenessUpdate(a, alive), WIRE);
        if (gone.length > 0) removeAwarenessStates(other, gone, WIRE);
      }
    });
    this.members.push(a);
  }
}

interface Peer {
  id: number;
  awareness: Awareness;
  doc: Y.Doc;
  presence: CanvasPresence;
  double: CanvasDouble;
  driver: InteractionDriver;
  /** node ids `onRevert` fired for — the loser-revert, recorded not simulated. */
  reverted: string[];
  /** count of LOCAL awareness emissions, i.e. how much this peer put on the wire. */
  localEmits: () => number;
}

/** One mutable clock shared by every peer, so "time passes" means the same thing. */
interface Clock {
  t: number;
}

const world: Array<() => void> = [];

function makePeer(
  wire: AwarenessWire,
  clientId: number,
  name: string,
  clock: Clock,
  opts: { inferredLockIdleMs?: number } = {},
): Peer {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const awareness = new Awareness(doc);
  wire.join(awareness);

  let emits = 0;
  awareness.on("update", (_c: unknown, origin: unknown) => {
    if (origin === "local") emits++;
  });

  const double = new CanvasDouble({ nodes: BOARD, edges: [] });
  const adapter = createCanvasAdapter(double.view);
  const reverted: string[] = [];
  const presence = new CanvasPresence({
    path: PATH,
    awareness: awareness as unknown as AwarenessLike,
    identity: { clientId, name, color: `#${clientId}${clientId}${clientId}` },
    adapter,
    onRevert: (nodeId) => reverted.push(nodeId),
    now: () => clock.t,
    inferredLockIdleMs: opts.inferredLockIdleMs,
    showCursors: false,
    showPresence: false,
  });
  presence.start();

  world.push(() => {
    presence.destroy();
    awareness.destroy();
    doc.destroy();
  });

  return {
    id: clientId,
    awareness,
    doc,
    presence,
    double,
    driver: new InteractionDriver(double),
    reverted,
    localEmits: () => emits,
  };
}

/**
 * The only trigger the repair is allowed to use: a PEER changed its awareness state.
 * Not a gesture on the sweeping client, not a restart, not a teardown, not a timer.
 * A cursor move is the smallest honest one — it is what a colleague's mouse does.
 */
let churnTick = 0;
function peerChurn(peer: Peer, n = 1): void {
  // MONOTONIC coordinates, and this is not cosmetic. y-protocols emits `change`
  // only when a state DEEP-CHANGED, so a repeated identical cursor position is not
  // a change and reaches no peer listener. Re-using the same coordinates silently
  // turns every "it survived N seconds" row into "the sweep never ran" — the real
  // `Awareness` caught exactly that in this file's first run, which is why the
  // shared-Map awareness double was not good enough here.
  for (let i = 0; i < n; i++) peer.presence.updateCursor(100 + churnTick++, 200 + churnTick);
}

afterEach(() => {
  for (const dispose of world.splice(0)) {
    try {
      dispose();
    } catch {
      /* teardown must never mask a failure */
    }
  }
});

// ===========================================================================
// A1 — A CLAIM HAS A LIFETIME
// ===========================================================================

describe("WP120 A1 — a claim the capture path made has a lifetime", () => {
  it("is released with no gesture, no restart and no teardown — only the clock moved", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    // The capture path claimed n2 on B. The user made NO gesture on n2 — a diff
    // pass upserted the record (canvas-sync.ts:4130 -> main.ts:2505).
    B.presence.onDiffInferredChange("n2");
    expect(B.presence.isLockedByMe("n2"), "the capture path did not claim at all").toBe(true);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()),
      "B's claim never reached A over a real awareness update",
    ).toEqual([2]);

    // The user walks away. Nothing on B happens: no select, no drag, no reload, no
    // reconnect, no destroy. A colleague moves their mouse.
    clock.t += INFERRED_LOCK_IDLE_MS;
    peerChurn(A);

    expect(
      B.presence.isLockedByMe("n2"),
      "the diff-inferred claim outlived its idle window — the leak is still there",
    ).toBe(false);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()),
      "B released locally but never told the peer — the card is still ringed on A",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: one millisecond inside the window it is still held", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    B.presence.onDiffInferredChange("n2");

    clock.t += INFERRED_LOCK_IDLE_MS - 1;
    peerChurn(A, 5);

    expect(
      B.presence.isLockedByMe("n2"),
      "the sweep fired INSIDE the window — it is dropping claims by event, not by idleness",
    ).toBe(true);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()),
      "the peer already lost sight of a claim that is still held",
    ).toEqual([2]);

    // …and one more millisecond is all it takes. Same object, same churn.
    clock.t += 1;
    peerChurn(A);
    expect(B.presence.isLockedByMe("n2"), "the window boundary is not where it says").toBe(false);
  });

  it("the whole board is swept, not just the contested card", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    for (const id of ["n1", "n2", "n3"]) B.presence.onDiffInferredChange(id);
    expect(["n1", "n2", "n3"].every((id) => B.presence.isLockedByMe(id))).toBe(true);

    clock.t += INFERRED_LOCK_IDLE_MS;
    peerChurn(A);

    for (const id of ["n1", "n2", "n3"]) {
      expect(B.presence.isLockedByMe(id), `${id} kept a stale ring`).toBe(false);
      expect(holdersOf(PATH, id, A.awareness.getStates()), `${id} still ringed on A`).toEqual([]);
    }
  });
});

// ===========================================================================
// A2 — SELF-HEALING (the owner's own criterion: "it also fixed itself after a while")
// ===========================================================================

describe("WP120 A2 — the loser stops losing, by itself", () => {
  it("a peer holding stale claims on the whole board recovers without touching anything", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock); // lower id: wins every tiebreak
    const B = makePeer(wire, 2, "B", clock); // higher id: loses every tiebreak, forever

    // B worked on the board earlier in the session. Every card it touched is claimed.
    for (const id of ["n1", "n2", "n3"]) B.presence.onDiffInferredChange(id);

    // Time passes. B's user is reading, not editing.
    clock.t += INFERRED_LOCK_IDLE_MS + 5_000;

    // A now picks up a card — a REAL gesture through the real adapter patches.
    A.driver.select(["n2"]);

    expect(
      B.reverted,
      "B's card was yanked back by a claim it had abandoned — the owner's symptom",
    ).toEqual([]);
    expect(
      ["n1", "n2", "n3"].map((id) => B.presence.isLockedByMe(id)),
      "B is still holding the board it walked away from",
    ).toEqual([false, false, false]);
    expect(
      holdersOf(PATH, "n2", B.awareness.getStates()),
      "the contest did not resolve cleanly onto A",
    ).toEqual([1]);
  });

  it("POSITIVE CONTROL: a claim that is NOT stale still loses the tiebreak and still reverts", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    for (const id of ["n1", "n2", "n3"]) B.presence.onDiffInferredChange(id);

    // One second, not fifteen. B is genuinely mid-work.
    clock.t += 1_000;
    A.driver.select(["n2"]);

    expect(
      B.reverted,
      "the loser-revert stopped firing — this build would pass A1 and A2 and be broken",
    ).toEqual(["n2"]);
    expect(B.presence.isLockedByMe("n2"), "the loser kept the contested card").toBe(false);
    expect(
      ["n1", "n3"].map((id) => B.presence.isLockedByMe(id)),
      "an UNCONTESTED fresh claim was collateral of the contest",
    ).toEqual([true, true]);
  });
});

// ===========================================================================
// A3 — A REAL CLAIM IS NOT EXPIRED OUT FROM UNDER A USER
// ===========================================================================

describe("WP120 A3 — a real claim is never expired out from under a user", () => {
  it("a GESTURE claim survives ten idle windows; an inferred claim on the same clock does not", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    // GESTURE: produced by the real `updateSelection` patch -> emitHeld ->
    // onNodeInteractionStart -> acquireLock. The test never says "gesture".
    B.driver.select(["n2"]);
    // INFERRED, same instant: the discriminator that proves the clock really moved.
    B.presence.onDiffInferredChange("n3");
    expect([B.presence.isLockedByMe("n2"), B.presence.isLockedByMe("n3")]).toEqual([true, true]);

    clock.t += INFERRED_LOCK_IDLE_MS * 10;
    peerChurn(A, 3);

    expect(
      B.presence.isLockedByMe("n2"),
      "a card the user is HOLDING was handed to someone else — worse than the leak",
    ).toBe(true);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()),
      "the peer stopped seeing a ring on a card that is genuinely held",
    ).toEqual([2]);
    expect(
      B.presence.isLockedByMe("n3"),
      "the clock did not move — the row above proves nothing",
    ).toBe(false);

    // The gesture claim's release is the interaction END, and it still works.
    B.driver.select([]);
    expect(B.presence.isLockedByMe("n2"), "the gesture claim is now the immortal one").toBe(false);
  });

  it("MID-GESTURE: a 60 s drag keeps its card, and the drag END is still what releases it", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    // A slow, deliberate drag: begin, hold, end. Real `setDragging` patch.
    B.driver.beginDrag("n2");
    B.presence.onDiffInferredChange("n1"); // capture noise during the same drag
    expect(B.presence.isLockedByMe("n2"), "the drag never claimed the card").toBe(true);

    // 60 s of a user thinking with the card in hand, while the room stays busy.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
      clock.t += 5_000;
      peerChurn(A);
      expect(
        B.presence.isLockedByMe("n2"),
        `the drag lost its card ${elapsed + 5_000} ms in — an expiry fired mid-gesture`,
      ).toBe(true);
    }
    // The same 60 s took the inferred claim, so the loop above is not a frozen clock.
    expect(
      B.presence.isLockedByMe("n1"),
      "nothing expired at all in 60 s — the mid-gesture row is vacuous",
    ).toBe(false);

    B.driver.endDrag();
    expect(
      B.presence.isLockedByMe("n2"),
      "the drag ended and the claim outlived it — the gesture release path is gone",
    ).toBe(false);
  });

  it("CONTINUING WORK: capture at the real cadence refreshes the claim indefinitely", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    // A user typing in a card. Capture fires at worst every MAX_WAIT_MS.
    B.presence.onDiffInferredChange("n2");
    for (let elapsed = 0; elapsed < INFERRED_LOCK_IDLE_MS * 4; elapsed += MAX_WAIT_MS) {
      clock.t += MAX_WAIT_MS;
      B.presence.onDiffInferredChange("n2"); // the refresh
      peerChurn(A);
      expect(
        B.presence.isLockedByMe("n2"),
        `active work lost its claim after ${elapsed + MAX_WAIT_MS} ms`,
      ).toBe(true);
    }

    // The user stops. One window later it is gone — the refresh is a refresh, not
    // an exemption.
    clock.t += INFERRED_LOCK_IDLE_MS;
    peerChurn(A);
    expect(
      B.presence.isLockedByMe("n2"),
      "a refreshed claim became permanent — the refresh disabled the lifetime",
    ).toBe(false);
  });

  it("the idle window is DERIVED from the capture cadence, not picked", () => {
    // Both numbers are imported from the module that owns them, so this row moves
    // if the capture cadence moves. It is the justification, in executable form.
    expect(DEBOUNCE_MS, "the capture debounce moved").toBe(200);
    expect(MAX_WAIT_MS, "the capture max-wait cap moved").toBe(500);
    expect(
      INFERRED_LOCK_IDLE_MS,
      "the idle window is no longer at least 30x the worst-case capture interval — " +
        "a user still working can now be expired out from under",
    ).toBeGreaterThanOrEqual(30 * MAX_WAIT_MS);
    // …and it must still fit inside y-protocols' own prune window, or the claim is
    // retired by the transport dropping the state rather than by this rule.
    expect(
      INFERRED_LOCK_IDLE_MS,
      "the idle window no longer fits inside the awareness prune window",
    ).toBeLessThan(outdatedTimeout);
  });
});

// ===========================================================================
// A4 — CONTESTED EDITS STILL RESOLVE
// ===========================================================================

describe("WP120 A4 — a contested edit still resolves", () => {
  it("two clients on one card: the loser converges and the winner keeps it", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    B.driver.select(["n2"]);
    expect(B.presence.isLockedByMe("n2")).toBe(true);

    A.driver.select(["n2"]); // same card, same second

    expect(B.reverted, "the contest did not resolve — the loser was never told").toEqual(["n2"]);
    expect(B.presence.isLockedByMe("n2"), "the loser kept the card").toBe(false);
    expect(A.presence.isLockedByMe("n2"), "the winner lost the card it won").toBe(true);
    expect(A.reverted, "the WINNER reverted — the tiebreak is inverted").toEqual([]);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()).concat(
        holdersOf(PATH, "n2", B.awareness.getStates()),
      ),
      "the two peers do not agree on who holds the card",
    ).toEqual([1, 1]);
  });

  it("a GESTURE claim still loses the tiebreak — immunity from expiry is not immunity from the contest", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    B.driver.select(["n2"]); // gesture: never expires
    clock.t += INFERRED_LOCK_IDLE_MS * 3; // …and has been held a long time
    peerChurn(A);
    expect(B.presence.isLockedByMe("n2"), "the gesture claim expired after all").toBe(true);

    A.driver.select(["n2"]);

    expect(
      B.reverted,
      "the sweep put gesture claims outside reconcileClaims — a permanent unbreakable lock",
    ).toEqual(["n2"]);
    expect(B.presence.isLockedByMe("n2")).toBe(false);
  });

  it("the capture path STILL claims — 'stop claiming' would pass A1 and A2 and destroy US3 AC2", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    // The private Canvas API is the OTHER acquisition path; for peers without it
    // (US3 AC2) this one is the only per-card presence there is.
    B.presence.onDiffInferredChange("n2");

    expect(
      B.presence.isLockedByMe("n2"),
      "the diff-inferred acquisition path is gone — peers without the private API " +
        "now have no per-card presence at all",
    ).toBe(true);
    expect(
      holdersOf(PATH, "n2", A.awareness.getStates()),
      "the claim is local-only — no peer can see the ring",
    ).toEqual([2]);
  });
});

// ===========================================================================
// A5 — DO NOT WIDEN THE BLAST RADIUS
// ===========================================================================

describe("WP120 A5 — the blast radius is not widened", () => {
  it("an expiry issues NO revert — housekeeping must never snap a card back", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    for (const id of ["n1", "n2", "n3"]) B.presence.onDiffInferredChange(id);
    clock.t += INFERRED_LOCK_IDLE_MS;
    peerChurn(A);

    expect(["n1", "n2", "n3"].some((id) => B.presence.isLockedByMe(id))).toBe(false);
    expect(
      B.reverted,
      "the sweep routed into onRevert -> revertCanvasNode: an expiry became three " +
        "canvas applies nobody asked for",
    ).toEqual([]);

    // CONTROL: onRevert is wired and does fire when there IS a contest, so the
    // empty array above is a measurement and not a dead callback.
    B.presence.onDiffInferredChange("n2");
    A.driver.select(["n2"]);
    expect(B.reverted, "onRevert never fires at all — the row above is vacuous").toEqual(["n2"]);
  });

  it("a sweep that expires nothing emits nothing; a sweep that expires N emits exactly one state", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const B = makePeer(wire, 2, "B", clock);

    for (const id of ["n1", "n2", "n3"]) B.presence.onDiffInferredChange(id);

    // Nothing is idle yet.
    const beforeQuiet = B.localEmits();
    expect(B.presence.expireIdleInferredLocks(), "something expired inside the window").toEqual([]);
    expect(
      B.localEmits() - beforeQuiet,
      "an idle client turned the sweep into an awareness heartbeat of its own",
    ).toBe(0);

    // Three expire at once.
    clock.t += INFERRED_LOCK_IDLE_MS;
    const beforeSweep = B.localEmits();
    expect(B.presence.expireIdleInferredLocks().sort()).toEqual(["n1", "n2", "n3"]);
    expect(
      B.localEmits() - beforeSweep,
      "the sweep broadcast once per expired node instead of once per sweep",
    ).toBe(1);
  });

  it("the awareness wire shape is still exactly the six WP27 keys — no origin, no touchedAt", () => {
    const clock: Clock = { t: 1_000_000 };
    const wire = new AwarenessWire();
    const A = makePeer(wire, 1, "A", clock);
    const B = makePeer(wire, 2, "B", clock);

    B.presence.onDiffInferredChange("n2");
    B.driver.select(["n3"]);
    clock.t += INFERRED_LOCK_IDLE_MS;
    peerChurn(A);

    const seen = A.awareness.getStates().get(2) as Record<string, unknown>;
    expect(seen, "B's state never reached A").toBeTruthy();
    expect(
      Object.keys(seen).sort(),
      "WP120 put local bookkeeping on the wire — the awareness field shape is pinned",
    ).toEqual(["canvasPath", "identity", "lockedNodes", "nodeId", "x", "y"]);

    const serialised = JSON.stringify(seen);
    expect(serialised.includes("touchedAt"), "the idle clock is being broadcast").toBe(false);
    expect(serialised.includes("origin"), "the claim origin is being broadcast").toBe(false);
    // The lock entry itself is untouched: colour + name, and the optional epoch.
    const entry = (seen.lockedNodes as Record<string, Record<string, unknown>>).n3;
    expect(entry, "the surviving gesture claim is not on the wire").toBeTruthy();
    expect(Object.keys(entry).sort(), "LockEntry grew a field").toEqual(["color", "name"]);
  });
});
