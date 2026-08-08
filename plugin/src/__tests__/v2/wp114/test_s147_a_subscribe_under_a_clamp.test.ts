// S147 — SYNC THAT DEPENDS ON A TIMER BEING PUNCTUAL DOES NOT WORK IN A
// BACKGROUNDED WINDOW.
//
// THE MECHANISM, and it is not inside `subscribe()`'s exits.
// ---------------------------------------------------------------------------
// The live orphans read `docExists: false` — no `Y.Doc` was created for those
// paths at all — so `subscribe()` never reached `getDoc` for them. It did not
// give up late (`S143`); it never ran. Two lines produce that, together:
//
//   1. `background-sync.ts` — the GUEST arm waited for the host's seed with a
//      FIXED COUNT of timer hops: `for (let i = 0; i < 20; i++) await
//      setTimeout(…, 100)`. Its nominal cost is 2 s. Its real cost is
//      20 x THE CLAMP: ~18 s after a minute hidden, ~180 s after ten minutes,
//      and it grows without bound. The loop is a POLL for a fact that arrives
//      as a MESSAGE, and messages are never throttled.
//
//   2. Every caller iterates paths SERIALLY and awaits each one —
//      `BackgroundSync.startAll` and `main.ts::processManifestChange`'s
//      `for (const path of actuallyAdded) await onFileAdded(path)`, itself on
//      the single `manifestHandlerQueue`. So the cost of one path is paid
//      BEFORE the next path's document is created, and one path that never
//      seeds stalls every later path FOREVER.
//
// (1) x (2) is the measured signature exactly: the file that is stuck has a
// document; every file announced behind it has NONE. And the file that stalls
// is not exotic — a note that is EMPTY on the host seeds nothing
// (`applyMinimalYTextUpdate` returns early when the content is unchanged), so
// the guest polls all twenty hops every single time. `S119` left eighteen
// zero-byte `.md` files in one live vault.
//
// WHAT IS DEMONSTRATED HERE vs ARGUED
// ---------------------------------------------------------------------------
// REAL relay (`server/src`, in process), REAL `SyncManager`s on both peers,
// REAL `BackgroundSync`es, REAL `Y.Doc`s, and the REAL clamp facility. The
// vault is a content-only double: `subscribe()` takes `read`,
// `getAbstractFileByPath` and `adapter.write` from it and nothing else, so
// Obsidian's file watcher and `TFile` metadata refresh are the only things not
// exercised — neither is reachable from this path.
//
// The one thing read from source rather than driven is `main.ts`'s call to
// `registerAnnounced`: booting the whole plugin is out of reach here, and
// `S99`'s warning about censuses over text applies — it is a wiring check, not
// evidence of behaviour, and it is labelled as such where it appears.

import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";

import { BackgroundSync } from "../../../files/background-sync";
import type { SyncManager } from "../../../sync/sync";
import { createRoom, newClient, startRelay, waitUntil } from "../../wp5/harness";
import { type TimerClamp, underTimerClamp } from "../../support/timer-clamp";

const SHARE = "_liveshare-test";
/** The stalling path: present on the host, and EMPTY, so nothing ever seeds it. */
const EMPTY = `${SHARE}/a-note-with-no-bytes.md`;
/** Announced behind it. In the live rig these are the ones that read `docExists: false`. */
const BEHIND_1 = `${SHARE}/announced-second.md`;
const BEHIND_2 = `${SHARE}/announced-third.md`;
const BEHIND_BYTES = "bytes that reached the guest over the file-op path\n";

// Deliberately small. The defect is a RATIO — hop count x clamp — and asserting
// on the ratio keeps this test off `S74`'s wall-clock-band rake.
const FLOOR_MS = 150;
/**
 * `SEED_WAIT_BUDGET_MS` in `background-sync.ts`. Restated rather than imported
 * because it is not exported, and because a test that reads the constant it is
 * checking cannot catch the constant being changed.
 */
const SEED_BUDGET_MS = 2_000;

// The clamp's default scope is the plugin's production source. This file is
// added so `proveClampIsLive` below can arm a probe of its own.
const SCOPE = /[\\/]src[\\/](files|sync|editor|session|canvas)[\\/]|test_s147_a_subscribe_under_a_clamp/;
/** Where the twenty-hop poll lived. */
const SUBJECT = /background-sync\.ts/;

/**
 * RULE 15 / `S113` — PROVE THE CLAMP WAS LIVE OVER THIS WINDOW.
 *
 * The obvious proof — "the subject's own timer was clamped" — is not available
 * after the repair, and that is the repair: on the healthy path the plugin no
 * longer arms a single sub-floor timer, so there is nothing to clamp. Demanding
 * one would pin the defect as the specification (`S84`'s trap, from the other
 * side). So the probe is armed HERE instead, from a call site the clamp also
 * covers, and it asserts both that the clamp fired and that it really delayed.
 */
async function proveClampIsLive(clamp: TimerClamp): Promise<void> {
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 1));
  const elapsed = Date.now() - started;
  clamp.assertClamped(1, /test_s147_a_subscribe_under_a_clamp/);
  if (elapsed < FLOOR_MS - 20) {
    throw new Error(
      `timer-clamp: DEAD INSTRUMENT — a 1 ms probe returned in ${elapsed} ms under a ` +
        `${FLOOR_MS} ms floor, so nothing in this window was throttled.`,
    );
  }
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { size: 0, mtime: 1, ctime: 1 } as TFile["stat"];
  return f;
}

function makeVault(initial: Record<string, string>) {
  const bytes = new Map<string, string>(Object.entries(initial));
  const files = new Map<string, TFile>();
  for (const p of Object.keys(initial)) files.set(p, tfile(p));
  return {
    bytes,
    put(path: string, content: string) {
      bytes.set(path, content);
      files.set(path, tfile(path));
    },
    getAbstractFileByPath: (p: string) => files.get(p) ?? null,
    getFiles: () => [...files.values()],
    getAllLoadedFiles: () => [...files.values()],
    read: async (f: { path: string }) => bytes.get(f.path) ?? "",
    readBinary: async () => new ArrayBuffer(0),
    modify: async (f: { path: string }, c: string) => void bytes.set(f.path, c),
    create: async (p: string, c: string) => {
      bytes.set(p, c);
      const f = tfile(p);
      files.set(p, f);
      return f;
    },
    createFolder: async () => ({}),
    adapter: {
      write: async (p: string, c: string) => void bytes.set(p, c),
      writeBinary: async () => {},
      exists: async (p: string) => bytes.has(p),
    },
    // biome-ignore lint/suspicious/noExplicitAny: content-only vault double
  } as any;
}

function manifestDouble(paths: string[]) {
  const entries = new Map(paths.map((p) => [p, { hash: "x", size: 1, mtime: 0 }]));
  return {
    getEntries: () => entries,
    isSharedPath: (p: string) => p.startsWith(`${SHARE}/`),
    updateFile: async () => {},
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these three
  } as any;
}

function fileOpsDouble() {
  return {
    mutePathEvents: () => {},
    unmutePathEvents: () => {},
    isPathMuted: () => false,
    isPathMutedFor: () => false,
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these
  } as any;
}

/**
 * THE LIVE PROBE'S `docExists`, read the same way: does the manager hold a
 * `Y.Doc` for this path? Never `getDoc`, which would CREATE one and answer its
 * own question — `S112`'s family.
 */
function docExists(sync: SyncManager, path: string): boolean {
  return (sync as unknown as { docs: Map<string, unknown> }).docs.has(path);
}

const observedPaths = (bg: BackgroundSync) =>
  [...(bg as unknown as { observers: Map<string, unknown> }).observers.keys()];

async function twoPeerRig(
  hostFiles: Record<string, string>,
  guestFiles: Record<string, string>,
  /**
   * What the HOST's manifest names. Defaults to the same set as the guest's.
   * Passing a SUBSET is how a path is made genuinely unheld by any peer, which
   * is `S131`'s cliff and the only case in which the guest has something real
   * to wait for.
   */
  hostShared?: string[],
  /** What the GUEST's manifest names, i.e. which paths its bring-up pass walks. */
  guestShared?: string[],
) {
  const relay = await startRelay();
  const room = await createRoom(relay.port, `wp114-${Date.now()}-${Math.random()}`);
  const hostVault = makeVault(hostFiles);
  const guestVault = makeVault(guestFiles);
  const hostSync = newClient(relay.port, room, "host");
  const guestSync = newClient(relay.port, room, "guest");
  const shared = [EMPTY, BEHIND_1, BEHIND_2];
  const hostBg = new BackgroundSync(
    hostVault,
    hostSync,
    manifestDouble(hostShared ?? shared),
    fileOpsDouble(),
  );
  const guestBg = new BackgroundSync(
    guestVault,
    guestSync,
    manifestDouble(guestShared ?? shared),
    fileOpsDouble(),
  );
  await waitUntil(() => (hostSync as unknown as { isConnected: boolean }).isConnected);
  await waitUntil(() => (guestSync as unknown as { isConnected: boolean }).isConnected);
  return {
    hostVault,
    guestVault,
    hostSync,
    guestSync,
    hostBg,
    guestBg,
    async close() {
      hostBg.destroy();
      guestBg.destroy();
      hostSync.destroy();
      guestSync.destroy();
      await relay.close();
    },
  };
}

describe("S147 AC1 — what actually schedules the guest's subscribe, under a clamp", () => {
  it("🚨 THE SIGNATURE: a path announced BEHIND a stalled one has no document at all", async () => {
    // `startAll` is production code and it is the guest's session-bring-up pass.
    // `main.ts::processManifestChange` has the identical serial shape, which is
    // why the same reading appears for mid-session announcements.
    const r = await twoPeerRig(
      { [EMPTY]: "", [BEHIND_1]: BEHIND_BYTES, [BEHIND_2]: BEHIND_BYTES },
      { [EMPTY]: "", [BEHIND_1]: BEHIND_BYTES, [BEHIND_2]: BEHIND_BYTES },
      // The host has not subscribed `EMPTY` yet — `S131`'s cliff, and the
      // ordinary mid-session case: the guest hears about a path before the peer
      // that will seed it has taken its own document. So the guest's wait for
      // that ONE path is real and runs to its whole budget, and the question is
      // what that costs the paths announced behind it.
      [BEHIND_1, BEHIND_2],
    );
    try {
      await r.hostBg.startAll("host");
      expect(r.hostSync.getDoc(BEHIND_1)?.text.toString()).toBe(BEHIND_BYTES);

      await underTimerClamp({ floorMs: FLOOR_MS, scope: SCOPE }, async (clamp) => {
        // Not awaited: the question is what the guest's state looks like WHILE
        // the pass is running, which is exactly what the live probe asked.
        const pass = r.guestBg.startAll("guest");

        // One clamped hop is enough for the serial version to still be inside
        // the first path's poll and for the fixed version to have registered
        // every path already.
        await new Promise((resolve) => setTimeout(resolve, FLOOR_MS * 2));

        // THE ASSERTION IS THE LIVE READING. Pre-fix these are `false`, which
        // is `docExists: false` on 16 of 16 guest/file pairs.
        expect(docExists(r.guestSync, BEHIND_1)).toBe(true);
        expect(docExists(r.guestSync, BEHIND_2)).toBe(true);

        await proveClampIsLive(clamp);
        // ...and the repaired path armed NO clampable timer of its own: the
        // twenty-hop poll is gone, not merely shortened.
        expect(clamp.stats().sites.map((s) => s.site).filter((s) => SUBJECT.test(s))).toEqual([]);
        await pass;
      });

      // ...and the pass still finishes the job it always did.
      expect(observedPaths(r.guestBg)).toEqual(
        expect.arrayContaining([EMPTY, BEHIND_1, BEHIND_2]),
      );
    } finally {
      await r.close();
    }
  }, 120_000);

  it("CONTROL — the ARM SPLIT: punctual timers finish the same pass; the clamp does not", async () => {
    // The live run's other arm (`0 / 16` with throttling disabled) against the
    // real one (`16 / 16`). The quantity is the same in both: how long the
    // guest's whole bring-up pass takes.
    //
    // ⚠ AND THIS IS WHY THE DEFECT SURVIVED A SUITE OF 3 057 TESTS. Before the
    // repair the punctual arm ALSO paid the full poll — twenty 100 ms hops for
    // the empty note, ~2 s — and 2 s is invisible to every observer anyone has
    // ever pointed at this product. It is only the CLAMP that turns the same
    // two lines into minutes, and nothing in the suite could produce a clamp.
    const r = await twoPeerRig(
      { [EMPTY]: "", [BEHIND_1]: BEHIND_BYTES, [BEHIND_2]: BEHIND_BYTES },
      { [EMPTY]: "", [BEHIND_1]: BEHIND_BYTES, [BEHIND_2]: BEHIND_BYTES },
    );
    try {
      await r.hostBg.startAll("host");
      const started = Date.now();
      await r.guestBg.startAll("guest");
      const punctual = Date.now() - started;

      // The bring-up completed, every path is observed, and no path waited for
      // a neighbour.
      expect(observedPaths(r.guestBg)).toEqual(
        expect.arrayContaining([EMPTY, BEHIND_1, BEHIND_2]),
      );
      // A serial 20-hop poll would spend ~2 000 ms here even unthrottled. The
      // host holds all three paths in this row, so with the repair nothing waits
      // at all and the whole pass is settle-time only.
      expect(punctual).toBeLessThan(2_000);
    } finally {
      await r.close();
    }
  }, 120_000);

  it("AC3 — the seed wait ends on the EVENT, not after a fixed number of hops", async () => {
    // The host seeds AFTER the guest has already started waiting, and it seeds
    // over the mux — a message, which Chromium never throttles. The wait must
    // end on that arrival, so its cost is the network, not the clamp.
    // ONE path on both sides, so the path that parks is the path that is
    // measured. With three the guest would park on the first and the clock
    // would be reading a different file's wait — which is how a timing row
    // passes for the wrong reason.
    const r = await twoPeerRig({ [BEHIND_1]: BEHIND_BYTES }, {}, [BEHIND_1], [BEHIND_1]);
    try {
      await underTimerClamp({ floorMs: FLOOR_MS, scope: SCOPE }, async (clamp) => {
        const subscribing = r.guestBg.startAll("guest");
        // Wait until the guest is demonstrably PARKED: its document exists and
        // is empty. The clock starts here, so what is measured is the wait
        // itself and not the rig's own set-up.
        await waitUntil(
          () =>
            docExists(r.guestSync, BEHIND_1) &&
            r.guestSync.getDoc(BEHIND_1)?.text.length === 0,
          { timeout: 10_000 },
        );
        const parkedAt = Date.now();
        await r.hostBg.startAll("host");
        await subscribing;
        const waited = Date.now() - parkedAt;

        await proveClampIsLive(clamp);
        // The seed ARRIVED, so the wait must have ended on the arrival and not
        // on the 2 000 ms deadline — and certainly not on twenty clamped hops.
        // Asserted as a CEILING well under the budget, never as a band.
        expect(waited).toBeLessThan(SEED_BUDGET_MS / 2);
        expect(r.guestSync.getDoc(BEHIND_1)?.text.toString()).toBe(BEHIND_BYTES);
      });
    } finally {
      await r.close();
    }
  }, 120_000);

  it("AC3 — a note that is EMPTY on the host costs ONE bounded wait, not twenty", async () => {
    // The permanent case: nothing will ever arrive, so no event can end the
    // wait and only the deadline can. It must be a DEADLINE — one wall-clock
    // budget — and not a hop count multiplied by the clamp.
    const r = await twoPeerRig({ [EMPTY]: "" }, { [EMPTY]: "" }, [EMPTY], [EMPTY]);
    try {
      await r.hostBg.startAll("host");
      await underTimerClamp({ floorMs: FLOOR_MS, scope: SCOPE }, async (clamp) => {
        const started = Date.now();
        await r.guestBg.startAll("guest");
        const elapsed = Date.now() - started;
        await proveClampIsLive(clamp);
        // Twenty clamped hops would be 3 000 ms here, and lengthening the
        // budget would be the non-fix the charter rules out. The bound is the
        // BUDGET plus one clamped hop, and nothing else.
        expect(elapsed).toBeLessThan(SEED_BUDGET_MS + 4 * FLOOR_MS);
      });
      // I11 — refusing to wait must not have destroyed anything: the guest's
      // own bytes are untouched and the document is observed.
      expect(r.guestVault.bytes.get(EMPTY)).toBe("");
      expect(observedPaths(r.guestBg)).toContain(EMPTY);
    } finally {
      await r.close();
    }
  }, 120_000);

  it("AC4 — a clamped guest RECOVERS after a link break, with no session restart", async () => {
    // The live arm: silence the mux on a guest across a subscribe, restore it,
    // then have the host type. Under throttling the guests never recovered at
    // +10 s, +40 s or +90 s and the host's edit never arrived. The reason is on
    // the line above — `SyncManager.onopen` re-subscribes `this.docs.keys()`,
    // and if the document was never created there is nothing to re-subscribe.
    // ⚠ AND THE WINDOW IS THE WHOLE POINT. There IS a second recovery lever —
    // the pong watchdog force-closes a half-dead socket, the reconnect fires,
    // and `ws.onopen` re-subscribes every held document. That is what recovered
    // the live CLEAN arm at +10 s. It is a `setInterval(15 000)` followed by a
    // `setTimeout(10 000)`, i.e. ~25 s of pure timer, so under the clamp it is
    // the last thing that will help. Everything below is therefore asserted
    // INSIDE a window far shorter than the watchdog's, or the watchdog would
    // silently be the thing under test.
    const r = await twoPeerRig(
      { [BEHIND_1]: BEHIND_BYTES },
      { [BEHIND_1]: BEHIND_BYTES },
      [BEHIND_1],
      [BEHIND_1],
    );
    try {
      await r.hostBg.startAll("host");
      await underTimerClamp({ floorMs: FLOOR_MS, scope: SCOPE }, async (clamp) => {
        r.guestSync.breakLink("silence");
        // NOT awaited: the pass is stuck on `waitForSync`'s 10 s timeout, which
        // the clamp stretches further, and the recovery must not depend on it.
        const pass = r.guestBg.startAll("guest");

        // The document EXISTS and is OBSERVED even though the link carried
        // nothing at all. That is what makes the restore a recovery rather than
        // a restart, and it is what the live guests did not have.
        await waitUntil(() => docExists(r.guestSync, BEHIND_1), { timeout: 10_000 });
        expect(observedPaths(r.guestBg)).toContain(BEHIND_1);

        const restored = r.guestSync.restoreLink();
        // The subscribe this client sent while the link was down was dropped on
        // the floor, so the relay believes it subscribed to nothing. The restore
        // has to SAY it re-asserted, not leave it to be inferred from a later
        // arrival (`S152`'s lesson: read the response).
        expect(restored.resubscribed).toBeGreaterThan(0);

        r.hostSync.getDoc(BEHIND_1)?.text.insert(0, "HOST TYPED: ");
        await waitUntil(
          () => r.guestSync.getDoc(BEHIND_1)?.text.toString().startsWith("HOST TYPED: "),
          { timeout: 8_000 },
        );
        // ...and it reaches the guest's DISK, through the observer that was
        // attached before any wait could fail.
        await waitUntil(() => r.guestVault.bytes.get(BEHIND_1)?.startsWith("HOST TYPED: "), {
          timeout: 8_000,
        });
        await proveClampIsLive(clamp);
        await pass;
      });
    } finally {
      await r.close();
    }
  }, 120_000);

  it("AC5 — the repair does not seed over a document the editor owns, or resurrect an emptying", async () => {
    // The two shapes AC5 names, driven on the repaired path. `S134`'s seed now
    // runs for the active file; it must still refuse when the document HELD
    // content and no longer does (`yTextHeldContent`), and it must still never
    // write the active file's disk copy.
    const r = await twoPeerRig({ [BEHIND_1]: BEHIND_BYTES }, {}, [BEHIND_1], [BEHIND_1]);
    try {
      const handle = r.hostSync.getDoc(BEHIND_1);
      handle?.text.insert(0, "content somebody then deleted");
      handle?.text.delete(0, handle.text.length);

      r.hostBg.setActiveFile(BEHIND_1);
      await r.hostBg.onFileAdded(BEHIND_1);

      // Not re-seeded from disk: the tombstones say this was emptied on purpose.
      expect(r.hostSync.getDoc(BEHIND_1)?.text.toString()).toBe("");
      // And the file the editor owns still holds the user's bytes.
      expect(r.hostVault.bytes.get(BEHIND_1)).toBe(BEHIND_BYTES);
    } finally {
      await r.close();
    }
  }, 120_000);

  it("AC5 — a DELIBERATE cancellation is still a cancellation, and it is not retried", async () => {
    // `cancelSubscribe` must remain a refusal. The repair wakes a waiting
    // subscribe so a cancel is acted on promptly under a clamp; it must not
    // turn the cancel into a completion.
    const r = await twoPeerRig({ [EMPTY]: "" }, { [EMPTY]: "" }, [EMPTY], [EMPTY]);
    try {
      await underTimerClamp({ floorMs: FLOOR_MS, scope: SCOPE }, async () => {
        const pass = r.guestBg.startAll("guest");
        await waitUntil(() => docExists(r.guestSync, EMPTY), { timeout: 10_000 });
        r.guestBg.cancelSubscribe(EMPTY);
        await pass;
        expect(observedPaths(r.guestBg)).not.toContain(EMPTY);
      });
    } finally {
      await r.close();
    }
  }, 120_000);
});

describe("S147 AC1 — the second half of the mechanism is in main.ts", () => {
  it("WIRING CHECK (source, not behaviour): the announced batch is registered before it is settled", async () => {
    // `S99`: this is a census over TEXT and it proves wiring, not conduct. It is
    // here because booting `main.ts` is out of reach from a unit test, and
    // because the serial `for (const path of actuallyAdded) await
    // onFileAdded(path)` loop is half of the defect — a later worker removing
    // the registration call would otherwise reopen S147 with every behavioural
    // row in this file still green.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
    const registerAt = source.indexOf("registerAnnounced(actuallyAdded)");
    const loopAt = source.indexOf("for (const path of actuallyAdded)");
    expect(registerAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);
    expect(registerAt).toBeLessThan(loopAt);
  });
});
