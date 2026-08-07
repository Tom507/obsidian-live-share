// WP21 AC2 blind1 — the liveness machinery judged by its EXPORT SURFACE and by
// a three-way reclaim, not by a single kept/taken pair.
//
// "Byte-unchanged" is checked here too — the invariant is literal and a digest
// is the only literal oracle — but the digest is deliberately the LAST word, not
// the first: a digest failure with everything else green says "someone edited an
// invariant file and got lucky", and a digest failure WITH a behavioural failure
// says "someone edited it and broke it". Reporting both is what makes the
// failure diagnosable.
//
// The export surface is pinned as a SET, so an over-deletion that removed a pure
// decision function while leaving the class intact is caught by name.
//
// The reclaim is driven over THREE nodes and TWO peers, which separates the
// three outcomes a returning holder must distinguish and which a kept/taken pair
// cannot:
//
//   ├── `solo`    — free the whole time            → re-claimed,
//   ├── `stolen`  — taken by a peer during the outage → left with that peer, and
//   └── `shared`  — taken by a HIGHER-id peer          → still left with it; the
//          reclaim rule is "is anyone else holding it", never "would I win".
//
// A non-default `reclaimDeferMs` is injected, so the assertion is on the DEFER
// as a mechanism rather than on the constant (the constant is blind2's subject).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as presenceModule from "../../../canvas/canvas-presence";
import { type AwarenessLike, CanvasPresence, holdersOf } from "../../../canvas/canvas-presence";
import {
  AWARENESS_HEARTBEAT_INTERVAL_MS,
  AWARENESS_PULSE_DEADLINE_MS,
  AWARENESS_TICK_INTERVAL_MS,
  SyncManager,
} from "../../../sync/sync";

const PATH = "ops/oncall.canvas";

const PRESENCE_SHA256_LF = "40528ad8083a0f706dc045e64d0039887cbbaacc4d0db2e7246ccba22db29dd9";

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

describe("WP21 AC2 blind1 — canvas-presence keeps its whole surface and its reclaim rule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every pure decision function and the controller are still exported", () => {
    expect(
      Object.keys(presenceModule).sort(),
      "canvas-presence.ts lost (or gained) an export — it must not be modified at all",
    ).toEqual(
      [
        "CanvasPresence",
        "computeCanDeleteNode",
        "computeCanWriteNode",
        "computeRingDelta",
        "holdersOf",
        "resolveCursors",
        "resolveHighlights",
        "resolveHolder",
      ].sort(),
    );
  });

  it("the keep-alive deadline still bounds the worst-case gap below the prune window", () => {
    expect(AWARENESS_TICK_INTERVAL_MS + AWARENESS_PULSE_DEADLINE_MS).toBe(
      AWARENESS_HEARTBEAT_INTERVAL_MS,
    );
    expect(
      AWARENESS_HEARTBEAT_INTERVAL_MS,
      "the worst-case awareness pulse gap no longer fits under the 30 s prune window — locks would be pruned",
    ).toBeLessThan(30_000);

    const sm = new SyncManager({ relayUrl: "ws://127.0.0.1:1", roomId: "r", role: "guest" } as never);
    // Called twice in a row on a socketless manager: still false, still no throw
    // — the tick is safe to call on EVERY opportunity, which is its contract.
    expect(sm.tickAwarenessKeepAlive("message")).toBe(false);
    expect(sm.tickAwarenessKeepAlive("tick")).toBe(false);
    sm.destroy();
  });

  describe("reconnect reclaim over three nodes", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-claims only what no peer holds, whoever that peer is", () => {
      const net = makeAwarenessNetwork();
      const RETURNING = new CanvasPresence({
        path: PATH,
        awareness: net.client(6),
        identity: { clientId: 6, name: "returning", color: "#6" },
        reclaimDeferMs: 40,
      });
      const LOWER = new CanvasPresence({
        path: PATH,
        awareness: net.client(3),
        identity: { clientId: 3, name: "lower", color: "#3" },
      });
      const HIGHER = new CanvasPresence({
        path: PATH,
        awareness: net.client(12),
        identity: { clientId: 12, name: "higher", color: "#c" },
      });
      RETURNING.start();
      for (const nodeId of ["solo", "stolen", "shared"]) RETURNING.acquireLock(nodeId);

      RETURNING.onReconnect();
      for (const nodeId of ["solo", "stolen", "shared"]) {
        expect(
          holdersOf(PATH, nodeId, net.states),
          `the withhold left \`${nodeId}\` claimed on the wire`,
        ).toEqual([]);
      }

      // During the outage: a lower-id peer takes one, a higher-id peer takes
      // another. Neither may be stolen back.
      LOWER.acquireLock("stolen");
      HIGHER.acquireLock("shared");

      vi.advanceTimersByTime(39);
      expect(
        RETURNING.isLockedByMe("solo"),
        "the re-claim fired before the defer window elapsed",
      ).toBe(false);

      vi.advanceTimersByTime(1);
      expect(RETURNING.isLockedByMe("solo"), "the still-free node was not re-claimed").toBe(true);
      expect(
        RETURNING.isLockedByMe("stolen"),
        "a node a LOWER-id peer took during the outage was stolen back",
      ).toBe(false);
      expect(
        RETURNING.isLockedByMe("shared"),
        "a node a HIGHER-id peer took during the outage was stolen back — the rule became 'would I win'",
      ).toBe(false);
      expect(holdersOf(PATH, "stolen", net.states)).toEqual([3]);
      expect(holdersOf(PATH, "shared", net.states)).toEqual([12]);

      RETURNING.destroy();
      LOWER.destroy();
      HIGHER.destroy();
    });

    it("a returning client with no claims schedules no reclaim at all", () => {
      const net = makeAwarenessNetwork();
      const IDLE = new CanvasPresence({
        path: PATH,
        awareness: net.client(2),
        identity: { clientId: 2, name: "idle", color: "#2" },
        reclaimDeferMs: 40,
      });
      IDLE.start();

      IDLE.onReconnect();
      expect(
        vi.getTimerCount(),
        "a client holding nothing still armed a reclaim timer on reconnect",
      ).toBe(0);

      IDLE.destroy();
    });
  });

  it("and, last: canvas-presence.ts is byte-identical to the charter's copy", () => {
    const source = readFileSync(
      new URL("../../../canvas/canvas-presence.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(
      createHash("sha256").update(source, "utf8").digest("hex"),
      "canvas-presence.ts was edited by this WP — that is an ESCALATE, not a fix",
    ).toBe(PRESENCE_SHA256_LF);
  });
});
