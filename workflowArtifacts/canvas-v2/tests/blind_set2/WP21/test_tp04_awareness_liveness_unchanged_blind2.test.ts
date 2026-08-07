// WP21 AC2 blind2 — the liveness machinery judged on its DEFAULTS and on the
// arithmetic that makes the deadline safe.
//
// blind1 injects `reclaimDeferMs` and pins the mechanism. This file deliberately
// does NOT inject it: `RECONNECT_RECLAIM_DEFER_MS` is module-private, so the
// only way to observe the production default is to let an unconfigured presence
// use it and to bracket it with fake timers. A "simplification" that made the
// defer optional, or that collapsed it to a microtask, passes every injected-ms
// test and fails this one.
//
// The pulse is likewise attacked on its ARITHMETIC rather than on its literals:
// the property that matters is not "D is 8 000" but "T + D leaves headroom under
// the 30 s awareness prune window, and the warn threshold sits between the two".
// The canvas LOCKS live inside the awareness state that window prunes, so this
// arithmetic is the reason locks survive a throttled renderer at all — and it is
// the part of the liveness story a removal WP has no business touching.
//
// The byte pin is stated as a SIZE plus a digest, so an edit that preserved the
// length (a same-width rename) and one that changed it are both caught, and the
// failure says which.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AwarenessLike, CanvasPresence, holdersOf } from "../../../canvas/canvas-presence";
import {
  AWARENESS_GAP_WARN_MS,
  AWARENESS_HEARTBEAT_INTERVAL_MS,
  AWARENESS_PULSE_DEADLINE_MS,
  AWARENESS_TICK_INTERVAL_MS,
} from "../../../sync/sync";

const PATH = "release/train.canvas";

const PRESENCE_SHA256_LF = "40528ad8083a0f706dc045e64d0039887cbbaacc4d0db2e7246ccba22db29dd9";
const PRESENCE_BYTES_LF = 22551;

/** y-protocols' awareness outdated-timeout. Peers prune a state older than this. */
const AWARENESS_PRUNE_WINDOW_MS = 30_000;

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

describe("WP21 AC2 blind2 — the liveness defaults and arithmetic are untouched", () => {
  it("the pulse arithmetic still leaves headroom under the awareness prune window", () => {
    expect(
      AWARENESS_HEARTBEAT_INTERVAL_MS,
      "the worst-case pulse bound is no longer tick + deadline",
    ).toBe(AWARENESS_TICK_INTERVAL_MS + AWARENESS_PULSE_DEADLINE_MS);
    expect(
      AWARENESS_PRUNE_WINDOW_MS - AWARENESS_HEARTBEAT_INTERVAL_MS,
      "the headroom between the worst-case pulse gap and the prune window shrank — locks live in the state that gets pruned",
    ).toBeGreaterThanOrEqual(15_000);
    expect(
      AWARENESS_GAP_WARN_MS,
      "the gap warn no longer fires before peers could have pruned this client",
    ).toBeLessThan(AWARENESS_PRUNE_WINDOW_MS);
    expect(
      AWARENESS_GAP_WARN_MS,
      "the gap warn would fire on a HEALTHY worst case — it must sit above the bound",
    ).toBeGreaterThan(AWARENESS_HEARTBEAT_INTERVAL_MS);
    expect(
      AWARENESS_TICK_INTERVAL_MS,
      "the evaluation tick is no longer shorter than the deadline it evaluates",
    ).toBeLessThan(AWARENESS_PULSE_DEADLINE_MS);
  });

  describe("the production reclaim-defer default", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("an unconfigured presence still defers its re-claim by the module default", () => {
      const net = makeAwarenessNetwork();
      // No `reclaimDeferMs` — the production default is the subject.
      const RETURNING = new CanvasPresence({
        path: PATH,
        awareness: net.client(15),
        identity: { clientId: 15, name: "returning", color: "#f" },
      });
      RETURNING.start();
      RETURNING.acquireLock("train");

      RETURNING.onReconnect();
      expect(
        holdersOf(PATH, "train", net.states),
        "the withhold did not happen synchronously on reconnect",
      ).toEqual([]);
      expect(
        vi.getTimerCount(),
        "no reclaim timer was armed — the defer was collapsed away",
      ).toBeGreaterThan(0);

      // Not a microtask and not a zero-delay timer: still withheld after a tick.
      vi.advanceTimersByTime(1);
      expect(
        RETURNING.isLockedByMe("train"),
        "the re-claim ran on the next tick — the settle window is gone",
      ).toBe(false);

      // 249 ms is inside the default window, 250 ms is the boundary.
      vi.advanceTimersByTime(248);
      expect(
        RETURNING.isLockedByMe("train"),
        "the default settle window is shorter than the module default (250 ms)",
      ).toBe(false);

      vi.advanceTimersByTime(1);
      expect(
        RETURNING.isLockedByMe("train"),
        "the still-free node was not re-claimed at the default settle boundary",
      ).toBe(true);

      RETURNING.destroy();
    });

    it("destroying a presence mid-defer cancels the pending re-claim", () => {
      const net = makeAwarenessNetwork();
      const RETURNING = new CanvasPresence({
        path: PATH,
        awareness: net.client(15),
        identity: { clientId: 15, name: "returning", color: "#f" },
      });
      RETURNING.start();
      RETURNING.acquireLock("train");
      RETURNING.onReconnect();

      RETURNING.destroy();
      vi.advanceTimersByTime(1_000);

      expect(
        holdersOf(PATH, "train", net.states),
        "a destroyed presence re-claimed a lock after teardown — the defer timer leaked",
      ).toEqual([]);
      expect(vi.getTimerCount(), "the reclaim timer outlived the presence").toBe(0);
    });
  });

  it("canvas-presence.ts is byte-identical: same length, same digest", () => {
    const source = readFileSync(
      new URL("../../../canvas/canvas-presence.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(
      Buffer.byteLength(source, "utf8"),
      "canvas-presence.ts changed length — this WP must not modify it (ESCALATE instead)",
    ).toBe(PRESENCE_BYTES_LF);
    expect(
      createHash("sha256").update(source, "utf8").digest("hex"),
      "canvas-presence.ts kept its length but changed content — a same-width edit is still an edit",
    ).toBe(PRESENCE_SHA256_LF);
  });
});
