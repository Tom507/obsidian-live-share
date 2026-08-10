// WP21 / AC2 — "the awareness liveness machinery (deadline pulse, reconnect
// reclaim defer, tiebreak) is **byte-unchanged** — `canvas-presence.ts` is not
// modified."
//
// This is the tripwire for the main risk of the WP: over-deleting. The removal
// targets the *write authority* the lock carried, and every line of that lives
// in `canvas-sync.ts` and `main.ts`. `canvas-presence.ts` is a hard invariant of
// the whole initiative (BUILD_SPEC §5, "if a WP believes it must modify it, that
// is an ESCALATE"), so the strongest oracle available is the literal one.
//
//   ├── BYTES  — a digest of `canvas-presence.ts`, taken over the LF-normalised
//   │      text so a CRLF checkout cannot fail it for a reason that has nothing
//   │      to do with the file's content. A digest alone is an unhelpful failure
//   │      message, so it is paired with the three behavioural pins below; a
//   │      digest mismatch with the behaviour still green means "an edit that
//   │      happens not to have broken anything YET", which the invariant still
//   │      forbids.
//   ├── DEADLINE PULSE — the absolute-time keep-alive in `sync/sync.ts`. Its
//   │      constants ARE the contract (T + D = 12 000 ms must stay under
//   │      y-protocols' 30 s prune window, and the canvas LOCKS live inside the
//   │      awareness state that window prunes), and `tickAwarenessKeepAlive` is
//   │      conditional, never a bare re-emit.
//   ├── RECLAIM DEFER — a returning holder withholds every claim immediately and
//   │      re-acquires only what is still free, after the defer window.
//   └── TIEBREAK — the lowest-clientID rule, over THREE holders.
//
// The reclaim defer is driven with fake timers and an injected `reclaimDeferMs`
// (the option exists for exactly this); no wall-clock sleep and no new timing
// constant.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AwarenessLike,
  CanvasPresence,
  computeCanDeleteNode,
  computeCanWriteNode,
  holdersOf,
  resolveHolder,
} from "../../../canvas/canvas-presence";
import {
  AWARENESS_GAP_WARN_MS,
  AWARENESS_HEARTBEAT_INTERVAL_MS,
  AWARENESS_PULSE_DEADLINE_MS,
  AWARENESS_TICK_INTERVAL_MS,
  SyncManager,
} from "../../../sync/sync";

const PATH = "ops/runbook.canvas";

/**
 * `canvas-presence.ts`, LF-normalised. Regenerate ONLY by ESCALATING the
 * `canvas-presence.ts` invariant — never by pasting the new hash.
 *
 * ── AMENDMENT LEDGER ─────────────────────────────────────────────────────────
 * | when | digest | authority |
 * |---|---|---|
 * | WP21 charter | `40528ad8…db29dd9`, 22 551 B | the original pin |
 * | **WP120**, 2026-08-08 | `2cefc9a8…f07ff16c9`, 29 831 B | **owner decision**, on
 * |   historical dispatcher record: *"`canvas-
 * |   presence.ts`'s byte-unchanged pin is LIFTED for the lock-lifetime repair
 * |   only. The pin must be re-established with a new digest, not deleted."* |
 *
 * THE PIN IS NOT WEAKENED AND MUST NEVER BE DELETED. It is re-established at the
 * new content, so the very next unauthorised byte still reddens this row. A pin
 * removed to let a change through is a guard that silently stops guarding, which
 * is `S162`'s shape; the lift was for ONE repair (the diff-inferred claim's
 * lifetime) and nothing else in that file is authorised.
 *
 * The three behavioural pins below are the reason a digest is worth having, and
 * WP120 changed none of them: the deadline pulse, the reconnect reclaim defer and
 * the lowest-clientID tiebreak are all still asserted against the real object.
 */
const PRESENCE_SHA256_LF = "2cefc9a88bb407bfd4a28b432ad901c20be6cc1f8a6e0c936e61b86f07ff16c9";
const PRESENCE_BYTES_LF = 29831;

function makeAwarenessNetwork() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners: Array<() => void> = [];
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    states,
    client(clientID: number): AwarenessLike {
      return {
        clientID,
        getLocalState: () => states.get(clientID) ?? null,
        setLocalState: (s: Record<string, unknown> | null) => {
          if (s === null) states.delete(clientID);
          else states.set(clientID, s);
          notify();
        },
        getStates: () => states,
        on: (_e, cb) => {
          listeners.push(cb);
        },
        off: (_e, cb) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };
}

const lockState = (over: Record<string, unknown>) => ({
  canvasPath: PATH,
  nodeId: null,
  x: 0,
  y: 0,
  lockedNodes: {},
  ...over,
});

describe("WP21 AC2 — the awareness liveness machinery survives the removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canvas-presence.ts is byte-unchanged", () => {
    const source = readFileSync(
      new URL("../../../canvas/canvas-presence.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(
      Buffer.byteLength(source, "utf8"),
      "canvas-presence.ts changed size — this WP must not modify it (BUILD_SPEC §5: ESCALATE)",
    ).toBe(PRESENCE_BYTES_LF);
    expect(
      createHash("sha256").update(source, "utf8").digest("hex"),
      "canvas-presence.ts was edited — locks are UX and this file is an initiative-wide invariant",
    ).toBe(PRESENCE_SHA256_LF);
  });

  it("the deadline-driven awareness pulse keeps its contract and its constants", () => {
    expect(AWARENESS_TICK_INTERVAL_MS, "the keep-alive tick period changed").toBe(4_000);
    expect(AWARENESS_PULSE_DEADLINE_MS, "the absolute pulse deadline changed").toBe(8_000);
    expect(
      AWARENESS_HEARTBEAT_INTERVAL_MS,
      "the worst-case pulse bound is no longer T + D",
    ).toBe(AWARENESS_TICK_INTERVAL_MS + AWARENESS_PULSE_DEADLINE_MS);
    // The bound must stay under y-protocols' 30 s prune window: the canvas LOCKS
    // live inside the awareness state that window prunes.
    expect(
      AWARENESS_HEARTBEAT_INTERVAL_MS,
      "the worst-case pulse gap no longer fits inside the 30 s awareness prune window",
    ).toBeLessThan(30_000);
    expect(
      AWARENESS_GAP_WARN_MS,
      "the gap warn threshold no longer sits between the healthy bound and the prune window",
    ).toBeGreaterThan(AWARENESS_HEARTBEAT_INTERVAL_MS);

    const sm = new SyncManager({ relayUrl: "ws://127.0.0.1:1", roomId: "r", role: "host" } as never);
    // CONDITIONAL by contract: with no open socket there is nothing to pulse, and
    // the tick must answer false rather than throw or emit.
    expect(() => sm.tickAwarenessKeepAlive("tick")).not.toThrow();
    expect(sm.tickAwarenessKeepAlive("tick"), "a closed socket must not pulse").toBe(false);
    expect(sm.tickAwarenessKeepAlive("message"), "a closed socket must not pulse").toBe(false);
    sm.destroy();
  });

  it("the tiebreak stays a minimum over ALL holders, for writes and for deletes", () => {
    const states = new Map<number, Record<string, unknown>>([
      [4, lockState({ lockedNodes: { card: { color: "#4", name: "D" } } })],
      [9, lockState({ lockedNodes: { card: { color: "#9", name: "I" } } })],
      [6, lockState({ lockedNodes: { card: { color: "#6", name: "F" } } })],
      [2, { ...lockState({ lockedNodes: { card: { color: "#2", name: "B" } } }), canvasPath: "elsewhere.canvas" }],
    ]);

    expect(
      holdersOf(PATH, "card", states).sort((a, b) => a - b),
      "a holder on ANOTHER canvas leaked into this canvas's holder set",
    ).toEqual([4, 6, 9]);
    expect(resolveHolder(PATH, "card", states), "the winner is not the lowest clientID").toBe(4);

    expect(computeCanWriteNode(4, PATH, "card", states), "the lowest holder cannot write").toBe(
      true,
    );
    for (const loser of [6, 9]) {
      expect(
        computeCanWriteNode(loser, PATH, "card", states),
        `client ${loser} won a tiebreak it must lose`,
      ).toBe(false);
    }
    // A non-holder is not a winner just because it has the lowest id in the room.
    expect(
      computeCanWriteNode(1, PATH, "card", states),
      "a peer that never claimed the card may write it",
    ).toBe(false);
    expect(computeCanWriteNode(4, PATH, "untouched", states), "a free node is not writable").toBe(
      true,
    );

    // Delete is stricter: ANY other holder blocks it, even for the winner.
    expect(
      computeCanDeleteNode(4, PATH, "card", states),
      "the tiebreak winner may delete a card two other peers are holding",
    ).toBe(false);
    expect(
      computeCanDeleteNode(4, PATH, "untouched", states),
      "a free node cannot be deleted",
    ).toBe(true);
  });

  describe("reconnect reclaim defer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("a returning holder withholds every claim, then re-claims only what is still free", () => {
      const net = makeAwarenessNetwork();
      const RETURNING = new CanvasPresence({
        path: PATH,
        awareness: net.client(5),
        identity: { clientId: 5, name: "back", color: "#5" },
        reclaimDeferMs: 100,
      });
      const PEER = new CanvasPresence({
        path: PATH,
        awareness: net.client(8),
        identity: { clientId: 8, name: "peer", color: "#8" },
      });
      RETURNING.start();
      PEER.start();
      RETURNING.acquireLock("kept");
      RETURNING.acquireLock("taken");

      RETURNING.onReconnect();

      // (1) WITHHOLD is immediate — before any peer awareness has re-synced.
      expect(
        RETURNING.isLockedByMe("kept"),
        "the returning client blind-reasserted a lock on reconnect",
      ).toBe(false);
      expect(RETURNING.isLockedByMe("taken"), "the withhold missed a held node").toBe(false);
      expect(
        holdersOf(PATH, "kept", net.states),
        "the withhold did not reach the broadcast state",
      ).toEqual([]);

      // During the outage a peer grabbed one of them.
      PEER.acquireLock("taken");

      // (2) DEFER — nothing is re-claimed before the settle window elapses.
      vi.advanceTimersByTime(99);
      expect(
        RETURNING.isLockedByMe("kept"),
        "the re-claim ran before the settle window — the defer is gone",
      ).toBe(false);

      vi.advanceTimersByTime(1);
      expect(
        RETURNING.isLockedByMe("kept"),
        "the still-free node was never re-claimed after the defer",
      ).toBe(true);
      expect(
        RETURNING.isLockedByMe("taken"),
        "the returning client stole back a node a peer took during the outage",
      ).toBe(false);
      expect(PEER.isLockedByMe("taken"), "the peer lost the node it acquired").toBe(true);

      RETURNING.destroy();
      PEER.destroy();
    });
  });
});
