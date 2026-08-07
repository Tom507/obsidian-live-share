// WP92 / C92 AC4 (S64) — THE STORE'S WRITES ARE AWAITED BEFORE THE PROCESS ENDS.
//
// WP90 built the mechanism and left it unwired. `save()` extends its queue
// SYNCHRONOUSLY before the first await, with a comment saying in as many words
// that this is so "a caller which then awaits `idle()` is guaranteed to be
// waiting for THIS save" — and then `grep -rn "\.idle()" plugin/src` over
// production returned ZERO, while `onunload` destroyed eleven subsystems without
// mentioning the store.
//
// IT IS A PRECONDITION OF AC2 RATHER THAN A NEIGHBOUR OF IT. WP92's migration is
// itself a write, issued at exactly the moments S64 says a write can be lost,
// and a HALF-MIGRATED store — entries under two vocabularies, nothing saying
// which is authoritative — is strictly worse than an unmigrated one.
//
// AC4(a): a fresh store's `queue` starts as `Promise.resolve()`, so `await
// idle()` on one resolves immediately and proves NOTHING. Every case below holds
// `io.write` on an unresolved promise first, and the ordering is asserted from
// two RECORDED EVENTS — never from a sleep, which is S85's shape exactly.
// AC4(c): the bound is MEASURED by driving the sequence with an injected timer,
// never read off its constant.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// Replace `await this.flushSeedRefusals()` in `onunload` with `void ...` — the
// wiring case reddens on "unload resolved before the write landed". Remove the
// `Promise.race` bound — the never-settling case hangs and reddens on timeout.
// Remove `flushSeedRefusalStore`'s `.catch` — the rejecting case reddens on
// "unload rejected". VERIFIED RED on each, then restored.

import { describe, expect, it } from "vitest";

import { seedRefusalStorePath } from "../../../files/canvas-sidecar";
import {
  SEED_REFUSAL_FLUSH_TIMEOUT_MS,
  SeedRefusalStore,
  flushSeedRefusalStore,
} from "../../../files/seed-refusal-store";
import {
  createRecordingLogger,
  createStoreIO,
  deferred,
  refusal,
  settleMicrotasks,
  until,
} from "./harness";
import { readProductionSources } from "./census";

const KEY = "guid-teardown";

describe("WP92 AC4 — the flush is awaited, bounded, and cannot reject the unload", () => {
  it("with a write IN FLIGHT, the flush does not resolve until the write has landed", async () => {
    const events: string[] = [];
    const held = deferred();
    const storeIO = createStoreIO();
    const realWrite = storeIO.write;
    storeIO.write = (async (path: string, data: Uint8Array) => {
      events.push("write:started");
      await held.promise;
      await realWrite(path, data);
      events.push("write:landed");
    }) as typeof storeIO.write;

    const store = new SeedRefusalStore(storeIO, {});
    store.save(KEY, [refusal("n-bad")]);
    // The vacuity guard AC4(a) names: the queue must actually be occupied. A
    // fresh store's `queue` is `Promise.resolve()`, so a flush over one resolves
    // immediately and would prove nothing at all.
    await until(
      () => events.includes("write:started"),
      "no write was ever in flight — an empty queue proves nothing",
    );
    expect(events).toEqual(["write:started"]);

    let settled = false;
    const flushing = flushSeedRefusalStore(store).then((outcome) => {
      events.push("flush:resolved");
      settled = true;
      return outcome;
    });

    // Give the flush every chance to resolve early. It must not.
    await settleMicrotasks();
    expect(settled, "the flush resolved while the write was still in flight").toBe(false);

    held.resolve();
    expect(await flushing).toBe("flushed");
    // THE ORDERING, from two recorded events rather than from a sleep.
    expect(events).toEqual(["write:started", "write:landed", "flush:resolved"]);
    expect(storeIO.text(), "the write never actually landed").toContain("n-bad");
  });

  it("the MIGRATION is awaited by the same flush — AC2's one-shot rewrite cannot be lost", async () => {
    const held = deferred();
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: `${JSON.stringify(
        { version: 1, paths: { "boards/old.canvas": [{ boundary: "host-seed", kind: "node", id: "n-bad", reason: "MISSING_TYPE" }] } },
        null,
        2,
      )}\n`,
    });
    const realWrite = storeIO.write;
    storeIO.write = (async (path: string, data: Uint8Array) => {
      await held.promise;
      await realWrite(path, data);
    }) as typeof storeIO.write;

    const store = new SeedRefusalStore(storeIO, {});
    await store.load("boards/old.canvas");
    store.migrate("boards/old.canvas", KEY);

    let settled = false;
    const flushing = flushSeedRefusalStore(store).then((o) => {
      settled = true;
      return o;
    });
    await settleMicrotasks();
    expect(settled, "the flush did not wait for the migration").toBe(false);

    held.resolve();
    expect(await flushing).toBe("flushed");
    expect(
      Object.keys(JSON.parse(storeIO.text() as string).paths),
      "the migration was lost at teardown — a half-migrated store",
    ).toEqual([KEY]);
  });

  it("a REJECTING write does not reject the unload, and is narrated", async () => {
    const storeIO = createStoreIO();
    storeIO.write = (async () => {
      throw new Error("disk full");
    }) as typeof storeIO.write;
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    store.save(KEY, [refusal("n-bad")]);

    await expect(flushSeedRefusalStore(store, { logger: log })).resolves.toBe("flushed");
    expect(
      log.lines.some((l) => l.includes("write FAILED")),
      "the failure was silent",
    ).toBe(true);
  });

  it("a write that NEVER SETTLES is bounded — unload proceeds and says so, measured not read", async () => {
    const storeIO = createStoreIO();
    // Never resolves. Without a bound this wedges the plugin forever.
    storeIO.write = (() => new Promise<void>(() => undefined)) as typeof storeIO.write;
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    store.save(KEY, [refusal("n-bad")]);

    // AC4(c): the bound is DRIVEN. The injected timer is fired by this test, so
    // the sequence is measured rather than the constant being read back.
    let fired: (() => void) | undefined;
    let requestedMs: number | undefined;
    let cleared = 0;
    const outcome = await flushSeedRefusalStore(store, {
      logger: log,
      setTimer: (fn, ms) => {
        requestedMs = ms;
        fired = fn;
        // Fire on the next microtask so the race is genuinely a race.
        queueMicrotask(() => fired?.());
        return "handle";
      },
      clearTimer: () => {
        cleared += 1;
      },
    });

    expect(outcome, "an unsettleable write did not time out — unload would wedge").toBe("timed-out");
    expect(requestedMs, "the default bound was not applied").toBe(SEED_REFUSAL_FLUSH_TIMEOUT_MS);
    expect(cleared, "the bound's timer was leaked").toBe(1);
    expect(
      log.lines.some((l) => l.includes("did not land within")),
      "the user is told nothing about a lost refusal write",
    ).toBe(true);
  });

  it("the winning race CLEARS its timer, so a normal unload leaves nothing pending", async () => {
    const store = new SeedRefusalStore(createStoreIO(), {});
    store.save(KEY, [refusal("n-bad")]);
    let cleared = 0;
    const outcome = await flushSeedRefusalStore(store, {
      setTimer: () => "handle",
      clearTimer: () => {
        cleared += 1;
      },
    });
    expect(outcome).toBe("flushed");
    expect(cleared).toBe(1);
  });

  it("WIRING: the production call sites are the unload AND the writer detach, and unload AWAITS", () => {
    // AC4(b) says not to assert the wiring by grepping for `idle()`. This does
    // not: the behaviour above is driven against the real function, and this case
    // only pins WHICH call sites carry it — the fact AC4(d) asks the report to
    // state explicitly, so that a future edit which drops one reddens here.
    const main = readProductionSources().get("main.ts") as string;
    expect(main, "main.ts was not read").toBeDefined();
    expect(
      /async onunload\(\)/.test(main),
      "onunload is synchronous again — nothing can be awaited in it",
    ).toBe(true);
    expect(
      /await this\.flushSeedRefusals\(\)/.test(main),
      "the unload no longer AWAITS the store's queue (S64 reopened)",
    ).toBe(true);
    expect(
      /void this\.flushSeedRefusals\(\)/.test(main),
      "the writer-detach flush was dropped",
    ).toBe(true);
    // The chain that joins them, so two destroy paths cannot race one queue.
    expect(/seedRefusalFlush/.test(main), "the flush chain was removed").toBe(true);
  });
});
