// ===========================================================================
// WP113 / PACKAGE A — S143: `subscribe()` gives up permanently and silently.
//
// ## WHAT S143 IS NOW, AND IT IS NOT WHAT THE CHARTER DESCRIBES
//
// The charter's premise — "`attachObserver(path, docHandle.text)` is the LAST
// statement in `BackgroundSync.subscribe()`, and six early returns ahead of it
// each leave `observers: false`" — WAS TRUE AND IS NO LONGER. WP114 moved
// `attachObserver` to BEFORE `waitForSync` in both arms, on the principle that
// subscription IS observation. The consequence is measured in
// `the shape of S143 on this HEAD` below, from the source, exit by exit:
//
//   ONE exit still returns with the path genuinely unobserved: `!docHandle`.
//   FIVE now return with the observer already installed, so what they cost is
//   the one-off RECONCILIATION, not the observation.
//
// That is a different and smaller defect than the one the register describes,
// and it is a legitimate finding rather than a repair of something absent: a
// give-up that leaves no counter, no log and no retry is still a give-up.
//
// ## WHAT IS DEMONSTRATED HERE RATHER THAN ARGUED
//
// The REAL relay, REAL `SyncManager`s, REAL `Y.Doc`s and the REAL
// `BackgroundSync`. `no-doc` is produced by a real `SyncManager` that has not
// been told to connect — the state `getDoc` answers `null` in — and
// `sync-failed` by the REAL 10 s `waitForSync` timeout over a REAL silenced
// link, not by a stubbed rejection. See `harness.ts` for what the vault double
// does not exercise.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BackgroundSync } from "../../../files/background-sync";
import {
  PATH_DISPOSITION,
  PATH_OUTCOME_FACTS,
  SUBSCRIBE_OUTCOMES,
  getPathOutcomes,
  notePathOutcome,
  resetPathOutcomes,
} from "../../../files/path-outcome";
import { waitUntil } from "../../wp5/harness";
import { findPluginSrc, stripComments } from "../wp83/wp83-source-derivation";
import {
  type Rig,
  SHARE,
  fileOpsDouble,
  loggerDouble,
  makeVault,
  manifestDouble,
  offlineSync,
  sleep,
  startRig,
} from "./harness";

const A = `${SHARE}/alpha.md`;
const B = `${SHARE}/beta.md`;

function subscribeCell(outcome: string): number {
  return getPathOutcomes().byArm[`subscribe/${outcome}`] ?? 0;
}

beforeEach(() => resetPathOutcomes());

// ---------------------------------------------------------------------------
// 1. THE SHAPE, DERIVED FROM SOURCE. Not a comment — the enumeration itself.
// ---------------------------------------------------------------------------

describe("S143 — the shape of `subscribe()` on this HEAD, enumerated from source", () => {
  const src = stripComments(
    readFileSync(join(findPluginSrc(), "files", "background-sync.ts"), "utf8"),
  );
  const body = (() => {
    const start = src.indexOf("async subscribe(rawPath: string)");
    expect(start, "`subscribe()` is not in this file — the derivation is looking at the wrong tree").
      toBeGreaterThan(-1);
    const end = src.indexOf("\n  unsubscribe(rawPath: string)", start);
    expect(end, "the end of `subscribe()` could not be located").toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it("`attachObserver` is NO LONGER the last statement — the charter's premise is refuted by the code", () => {
    const attach = body.indexOf("this.attachObserver(");
    const wait = body.indexOf("this.syncManager.waitForSync(");
    expect(attach, "`subscribe()` no longer attaches an observer at all").toBeGreaterThan(-1);
    expect(wait, "`subscribe()` no longer waits for sync at all").toBeGreaterThan(-1);
    // THE WHOLE CORRECTION, in one comparison: WP114 put observation first.
    expect(
      attach,
      "`attachObserver` is behind `waitForSync` again — S143's original six-exit shape is back",
    ).toBeLessThan(wait);
  });

  it("EVERY `return` in `subscribe()` reports an outcome — a new silent exit is RED", () => {
    // Each `return` inside the function must either BE an `endSubscribe` call or
    // stand on the line after one. There is no third form in this function, and
    // that is what makes the closed set closed.
    const returns = [...body.matchAll(/\breturn\b[^;]*;/g)].map((m) => m[0]);
    expect(returns.length, "no `return` found — the parse failed").toBeGreaterThan(4);
    const silent = returns.filter((r) => !r.includes("this.endSubscribe("));
    expect(
      silent,
      "a `return` in `subscribe()` leaves no record — that is S143 reopening",
    ).toEqual([]);
  });

  it("the closed set is PINNED to the exits: every declared outcome is used, and every used outcome is declared", () => {
    const used = new Set(
      [...body.matchAll(/SUBSCRIBE_OUTCOMES\.([A-Z_]+)/g)].map((m) => m[1]),
    );
    const declared = new Set(Object.keys(SUBSCRIBE_OUTCOMES));
    expect([...declared].filter((d) => !used.has(d)), "declared but never emitted").toEqual([]);
    expect([...used].filter((u) => !declared.has(u)), "emitted but not declared").toEqual([]);
    // And the facts table covers exactly the same set — the table is what
    // `retryAbandonedSubscribes` reads its safety rail off.
    expect(Object.keys(PATH_OUTCOME_FACTS.subscribe).sort()).toEqual(
      Object.values(SUBSCRIBE_OUTCOMES).sort(),
    );
  });

  it("the deliberate exits are TERMINAL and the temporary ones are RETRYABLE — I11", () => {
    const d = (o: string) => PATH_OUTCOME_FACTS.subscribe[o].disposition;
    // I11 — refusal never destroys. A cancellation and a released document are
    // somebody stopping this path on purpose; a retry would resurrect it.
    expect(d(SUBSCRIBE_OUTCOMES.CANCELLED)).toBe(PATH_DISPOSITION.TERMINAL);
    expect(d(SUBSCRIBE_OUTCOMES.DOC_DESTROYED)).toBe(PATH_DISPOSITION.TERMINAL);
    expect(d(SUBSCRIBE_OUTCOMES.UNSAFE_PATH)).toBe(PATH_DISPOSITION.TERMINAL);
    // These two are conditions that stop being true.
    expect(d(SUBSCRIBE_OUTCOMES.NO_DOC)).toBe(PATH_DISPOSITION.RETRYABLE);
    expect(d(SUBSCRIBE_OUTCOMES.SYNC_FAILED)).toBe(PATH_DISPOSITION.RETRYABLE);
  });

  it("`main.ts` re-drives the abandoned paths on the re-arm gesture — the wiring, read from source", () => {
    // A WIRING CHECK, not evidence of behaviour, and labelled as such (`S99`):
    // booting the whole plugin is out of reach here. The BEHAVIOUR of
    // `retryAbandonedSubscribes` is driven against the real objects below.
    const main = stripComments(readFileSync(join(findPluginSrc(), "main.ts"), "utf8"));
    const start = main.indexOf("async rearmSharing()");
    expect(start, "`rearmSharing` is gone — the recovery has no caller").toBeGreaterThan(-1);
    const region = main.slice(start, start + 4000);
    expect(
      region.includes("retryAbandonedSubscribes()"),
      "`rearmSharing` no longer re-drives the abandoned paths",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1b. THE SHARED EMITTER ITSELF — one spelling, one ledger, and a set that is
//     actually CLOSED rather than merely declared closed.
// ---------------------------------------------------------------------------

describe("the shared emitter — a set that cannot be widened by a typo", () => {
  it("an outcome that is not an exit of its arm is REFUSED, and nothing is counted for it", () => {
    // The positive control first: a legitimate pairing is accepted.
    expect(() =>
      notePathOutcome({ arm: "subscribe", outcome: SUBSCRIBE_OUTCOMES.NO_DOC, path: "p" }),
    ).not.toThrow();
    expect(getPathOutcomes().byArm["subscribe/no-doc"]).toBe(1);

    // A closed set that silently accepts an unknown member is not closed, and
    // the cell it invents is one nobody can interpret — which is the exact
    // failure mode `S155` describes from the other direction.
    expect(() =>
      notePathOutcome({
        arm: "ensure-folder",
        outcome: SUBSCRIBE_OUTCOMES.CANCELLED as never,
        path: "p",
      }),
    ).toThrow(/not an outcome of arm/);
    expect(
      getPathOutcomes().byArm["ensure-folder/cancelled"],
      "a typo invented a ledger cell",
    ).toBeUndefined();
    expect(getPathOutcomes().total, "the refused call still incremented the total").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. THE ONE EXIT THAT STILL LEAVES A PATH UNOBSERVED — `no-doc`.
// ---------------------------------------------------------------------------

describe("S143 A1/A2/A3 — `no-doc`: unobserved, permanent, and now counted", () => {
  it("gives up unobserved, says so, and remembers the path — with a control on a path it never touched", async () => {
    const vault = makeVault({ [A]: "alpha bytes\n", [B]: "beta bytes\n" });
    const logger = loggerDouble();
    const sync = offlineSync("room-s143");
    const bg = new BackgroundSync(vault.asVault, sync, manifestDouble([A, B]), fileOpsDouble());
    bg.setLogger(logger);

    // --- the give-up ------------------------------------------------------
    await bg.subscribe(A);

    expect(subscribeCell(SUBSCRIBE_OUTCOMES.NO_DOC), "the give-up was not counted").toBe(1);
    expect(
      getPathOutcomes().byDisposition[PATH_DISPOSITION.RETRYABLE],
      "the give-up was not classified",
    ).toBe(1);
    expect(bg.getAbandonedSubscribes(), "the path was not remembered").toEqual({
      [A]: SUBSCRIBE_OUTCOMES.NO_DOC,
    });
    const line = logger.forPath(A);
    expect(line.length, "the give-up reached no log").toBe(1);
    expect(line[0]).toContain("outcome=no-doc");
    expect(line[0]).toContain(`path=${A}`);
    expect(line[0]).toContain("disposition=retryable");

    // POSITIVE CONTROL, and it is S155's: a path this arm never ran for has NO
    // cell at all. Without this the ledger's zero would be as ambiguous as the
    // silence it replaces.
    expect(logger.forPath(B), "a path that was never subscribed produced a line").toEqual([]);
    expect(bg.getAbandonedSubscribes()[B]).toBeUndefined();

    bg.destroy();
    sync.destroy();
  });

  it("stays given-up while the session is healthy again, and recovers only when the re-arm re-drives it", async () => {
    const rig = await startRig("s143-no-doc-permanence");
    try {
      // A REAL `SyncManager` THAT HAS NOT BEEN TOLD TO CONNECT — the state in
      // which `getDoc` answers `null`, and the state a peer is in between a link
      // dropping and a reconnect starting. See `harness.ts` for why this is not
      // produced by `disconnect()` on a live socket.
      const peer = await rig.peer({
        clientId: "p1",
        role: "host",
        files: { [A]: "alpha bytes\n", [B]: "beta bytes\n" },
        connect: false,
      });
      await peer.bg.subscribe(A);
      expect(subscribeCell(SUBSCRIBE_OUTCOMES.NO_DOC), "the exit was not taken").toBe(1);
      expect(peer.bg.getAbandonedSubscribes()[A]).toBe(SUBSCRIBE_OUTCOMES.NO_DOC);
      expect(
        (peer.bg as unknown as { observers: Map<string, unknown> }).observers.has(A),
        "the path is observed — `no-doc` is supposed to be the one exit that leaves it unwatched",
      ).toBe(false);

      // …THE SESSION BECOMES HEALTHY AGAIN. This is the state the live round
      // measured: connected, everything reporting fine.
      peer.sync.connect();
      await waitUntil(
        () => (peer.sync as unknown as { isConnected: boolean }).isConnected === true,
        { timeout: 5_000 },
      );
      await peer.bg.subscribe(B);
      expect(
        subscribeCell(SUBSCRIBE_OUTCOMES.COMPLETED),
        "no path completed — the 'healthy session' claim would be vacuous",
      ).toBe(1);

      // …AND `A` IS STILL NOT WATCHED. Nothing re-drove it, nothing reported it
      // again, and the file is simply out of the session. THIS is S143.
      const frozen = { ...getPathOutcomes().byArm };
      await sleep(300);
      expect(
        getPathOutcomes().byArm,
        "something reported the abandoned path on its own — then permanence is not what is measured",
      ).toEqual(frozen);
      expect(
        (peer.bg as unknown as { observers: Map<string, unknown> }).observers.has(A),
        "the path recovered by itself — nothing in production does that",
      ).toBe(false);
      expect(peer.bg.getAbandonedSubscribes()[A]).toBe(SUBSCRIBE_OUTCOMES.NO_DOC);

      // …UNTIL THE RE-ARM. One gesture, and the path is in the session again.
      const report = await peer.bg.retryAbandonedSubscribes();
      expect(report).toMatchObject({ attempted: 1, recovered: 1, stillAbandoned: 0, paths: [A] });
      expect(
        (peer.bg as unknown as { observers: Map<string, unknown> }).observers.has(A),
        "the re-arm did not put the path back in the session",
      ).toBe(true);
      expect(subscribeCell(SUBSCRIBE_OUTCOMES.COMPLETED)).toBe(2);
      expect(peer.bg.getAbandonedSubscribes()).toEqual({});
    } finally {
      await rig.close();
    }
  }, 60_000);

  it("A3 — the re-arm re-drives a recorded give-up and the path ends OBSERVED", async () => {
    const rig = await startRig("s143-rearm");
    try {
      const peer = await rig.peer({ clientId: "h", role: "host", files: { [A]: "alpha bytes\n" } });
      // THE GIVE-UP, produced by the real exit: silence the link so the relay
      // never answers, and the REAL 10 s `waitForSync` timeout rejects.
      peer.sync.breakLink("silence");
      await peer.bg.subscribe(A);

      expect(subscribeCell(SUBSCRIBE_OUTCOMES.SYNC_FAILED), "the timeout was not counted").toBe(1);
      expect(peer.bg.getAbandonedSubscribes()[A]).toBe(SUBSCRIBE_OUTCOMES.SYNC_FAILED);
      const line = peer.logger.forPath(A);
      expect(line.length, "the timeout reached no log").toBe(1);
      expect(line[0]).toContain("outcome=sync-failed");
      expect(line[0]).toContain("disposition=retryable");
      // THE CORRECTION TO THE CHARTER, MEASURED: this exit does NOT leave the
      // path unobserved any more. WP114's move is why.
      expect(
        (peer.bg as unknown as { observers: Map<string, unknown> }).observers.has(A),
        "the observer is NOT attached — WP114's reordering has been undone",
      ).toBe(true);

      // THE RECOVERY, on the real gesture.
      peer.sync.restoreLink();
      const report = await peer.bg.retryAbandonedSubscribes();
      expect(report.attempted).toBe(1);
      expect(report.paths).toEqual([A]);
      expect(report.stillAbandoned, "the re-drive did not clear the give-up").toBe(0);
      expect(peer.bg.getAbandonedSubscribes()).toEqual({});
      // The reconciliation ACTUALLY RAN this time — the host's bytes reached the
      // document, which is what `sync-failed` had cost. Without the detach in
      // `retryAbandonedSubscribes` this is `already-observed` and the document
      // is still empty.
      expect(subscribeCell(SUBSCRIBE_OUTCOMES.COMPLETED), "the retry completed nothing").toBe(1);
      expect(
        subscribeCell(SUBSCRIBE_OUTCOMES.ALREADY_OBSERVED),
        "the retry was swallowed by subscribe()'s own idempotence guard",
      ).toBe(0);
      expect(peer.sync.getDoc(A)?.text.toString(), "the host's bytes never reached the doc").toBe(
        "alpha bytes\n",
      );
    } finally {
      await rig.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. THE SAFETY RAIL — A3's explicit constraint.
// ---------------------------------------------------------------------------

describe("S143 A3/A4 — a deliberate stop is never retried into a resurrection", () => {
  it("a CANCELLED subscribe is not remembered, so no re-arm can bring it back", async () => {
    const rig = await startRig("s143-cancel");
    try {
      const peer = await rig.peer({ clientId: "h", role: "host", files: { [A]: "alpha\n" } });
      peer.sync.breakLink("silence");
      const running = peer.bg.subscribe(A);
      // The real cancellation, through the real method, while the subscribe is
      // parked on the real `waitForSync`.
      await sleep(20);
      peer.bg.cancelSubscribe(A);
      peer.sync.restoreLink();
      await running;

      // It gave up — and it said so.
      const cancelled = subscribeCell(SUBSCRIBE_OUTCOMES.CANCELLED);
      const failed = subscribeCell(SUBSCRIBE_OUTCOMES.SYNC_FAILED);
      expect(cancelled + failed, "neither exit was taken — the cancellation did not land").toBe(1);

      if (cancelled === 1) {
        // THE RAIL: a deliberate stop leaves NOTHING for a retry to find.
        expect(
          peer.bg.getAbandonedSubscribes(),
          "a cancelled subscribe was queued for retry — I11 violated",
        ).toEqual({});
        const report = await peer.bg.retryAbandonedSubscribes();
        expect(report.attempted, "the re-arm resurrected a cancelled path").toBe(0);
      }
    } finally {
      await rig.close();
    }
  }, 60_000);

  it("a REMOVED file drops out of the retry set — a retry never recreates what was deleted", async () => {
    const vault = makeVault({ [A]: "alpha\n" });
    const logger = loggerDouble();
    const sync = offlineSync("room-removed");
    const bg = new BackgroundSync(vault.asVault, sync, manifestDouble([A]), fileOpsDouble());
    bg.setLogger(logger);

    await bg.subscribe(A);
    expect(bg.getAbandonedSubscribes()[A], "the give-up was not recorded").toBe(
      SUBSCRIBE_OUTCOMES.NO_DOC,
    );

    bg.onFileRemoved(A);
    expect(
      bg.getAbandonedSubscribes(),
      "a removed file is still queued for re-subscription",
    ).toEqual({});
    const report = await bg.retryAbandonedSubscribes();
    expect(report.attempted).toBe(0);

    // POSITIVE CONTROL: without the removal the very same set IS re-driven.
    await bg.subscribe(A);
    expect(bg.getAbandonedSubscribes()[A]).toBe(SUBSCRIBE_OUTCOMES.NO_DOC);
    expect((await bg.retryAbandonedSubscribes()).attempted).toBe(1);

    bg.destroy();
    sync.destroy();
  });

  it("a teardown clears the record — a give-up describes ONE session", async () => {
    const vault = makeVault({ [A]: "alpha\n" });
    const sync = offlineSync("room-teardown");
    const bg = new BackgroundSync(vault.asVault, sync, manifestDouble([A]), fileOpsDouble());
    bg.setLogger(loggerDouble());
    await bg.subscribe(A);
    expect(Object.keys(bg.getAbandonedSubscribes())).toEqual([A]);
    bg.destroy();
    expect(bg.getAbandonedSubscribes(), "the give-up survived the session it belongs to").toEqual(
      {},
    );
    sync.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. S155 — the do-nothing branches are counted, so a zero means one thing.
// ---------------------------------------------------------------------------

describe("S155 — every branch increments, including the ones that did nothing", () => {
  let rig: Rig;
  beforeEach(async () => {
    rig = await startRig("s143-s155");
  });
  afterEach(async () => {
    await rig.close();
  });

  it("a second subscribe of an observed path is COUNTED as a do-nothing, not left silent", async () => {
    const peer = await rig.peer({ clientId: "h", role: "host", files: { [A]: "alpha\n" } });
    await peer.bg.subscribe(A);
    expect(subscribeCell(SUBSCRIBE_OUTCOMES.COMPLETED)).toBe(1);
    expect(subscribeCell(SUBSCRIBE_OUTCOMES.ALREADY_OBSERVED)).toBe(0);

    await peer.bg.subscribe(A);
    expect(
      subscribeCell(SUBSCRIBE_OUTCOMES.ALREADY_OBSERVED),
      "the do-nothing branch is invisible — 'declined' is indistinguishable from 'never reached'",
    ).toBe(1);
    // …and it did NOT produce a log line: counted, not shouted.
    expect(peer.logger.forPath(A), "an ordinary do-nothing was logged").toEqual([]);
    expect(PATH_OUTCOME_FACTS.subscribe[SUBSCRIBE_OUTCOMES.ALREADY_OBSERVED].logged).toBe(false);
  });

  it("an UNSAFE path is refused, counted and logged — and never queued for retry", async () => {
    const peer = await rig.peer({ clientId: "h", role: "host" });
    await peer.bg.subscribe("../outside-the-vault.md");
    expect(subscribeCell(SUBSCRIBE_OUTCOMES.UNSAFE_PATH)).toBe(1);
    expect(peer.bg.getAbandonedSubscribes(), "a traversal was queued for retry").toEqual({});
    expect(peer.logger.outcomes().some((l) => l.includes("outcome=unsafe-path"))).toBe(true);
  });
});
