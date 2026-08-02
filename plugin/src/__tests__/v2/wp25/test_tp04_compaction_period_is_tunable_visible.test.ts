// WP25 / AC3 (period half) — "Compaction runs on a documented, tunable period".
//
// COMPACTION IS TIME-DRIVEN, WHICH IS EXACTLY WHY THIS FILE IS DANGEROUS. Every
// "it has not compacted yet" assertion in a fake-timer test is satisfied for
// free by an implementation that never arms a timer at all. So every negative
// assertion below is paired with a POSITIVE CONTROL in the same `it`: the clock
// is advanced past the period and the compaction is required to have happened.
// A "not yet" with no matching "and then it does" is not evidence.
//
// The tunables are WP25's to name (Shared Ownership Contract §1) and their UNIT
// must be unambiguous from the name alone:
//
//   ├── `SIDECAR_COMPACTION_PERIOD_MS`             — milliseconds
//   └── `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS` — Lamport ticks, NOT ms.
//         `TombstoneEntry.t` is a Lamport counter (`nextTombstoneTime`), never a
//         wall-clock reading, so a horizon expressed in milliseconds would be
//         comparing two different quantities and would converge differently on
//         every machine. The name is the documentation.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by the `setInterval(..., periodMs)` the
// lifecycle arms (remove it → the positive control fails) and by the
// `clearInterval` in `destroy()` (remove it → the "stops after destroy"
// assertion fails).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createSidecarStore, sidecarCheckpointPath } from "../../../files/canvas-sidecar";
import {
  SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS,
  SIDECAR_COMPACTION_PERIOD_MS,
  createSidecarLifecycle,
} from "../../../files/canvas-sidecar-lifecycle";
import {
  FIXED_GUID,
  NODE_A,
  NODE_B,
  createSidecarIO,
  createTrace,
  seedRecord,
} from "./harness";

/** Checkpoint writes are the observable signature of a compaction having run. */
function checkpointWrites(io: ReturnType<typeof createSidecarIO>): number {
  return io.ops.filter((op) => op === `write:${sidecarCheckpointPath(FIXED_GUID)}`).length;
}

describe("WP25 AC3 — compaction runs on a documented, tunable period", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the two tunables are exported, positive, finite, and name their unit", () => {
    expect(typeof SIDECAR_COMPACTION_PERIOD_MS).toBe("number");
    expect(Number.isFinite(SIDECAR_COMPACTION_PERIOD_MS)).toBe(true);
    expect(SIDECAR_COMPACTION_PERIOD_MS).toBeGreaterThan(0);

    expect(typeof SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS).toBe("number");
    expect(Number.isInteger(SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS)).toBe(true);
    expect(SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS).toBeGreaterThan(0);

    // A period below a second would make compaction a hot loop over the vault;
    // one above an hour would make the tunable decorative. Both bounds are
    // deliberately generous — this pins that a UNIT was chosen, not a value.
    expect(SIDECAR_COMPACTION_PERIOD_MS).toBeGreaterThanOrEqual(1_000);
    expect(SIDECAR_COMPACTION_PERIOD_MS).toBeLessThanOrEqual(3_600_000);
  });

  it("nothing is compacted before the period elapses — and IS compacted after it", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", NODE_A);
    await vi.advanceTimersByTimeAsync(0);

    // NEGATIVE — one millisecond short of the period.
    await vi.advanceTimersByTimeAsync(SIDECAR_COMPACTION_PERIOD_MS - 1);
    expect(checkpointWrites(io), "a compaction ran before the period elapsed").toBe(0);

    // POSITIVE CONTROL — without this the assertion above is satisfied by an
    // implementation that never arms a timer at all.
    await vi.advanceTimersByTimeAsync(1);
    expect(
      checkpointWrites(io),
      "no compaction ran after the period elapsed — the timer was never armed",
    ).toBe(1);

    await lifecycle.destroy();
  });

  it("it repeats — a second period produces a second compaction", async () => {
    // `setTimeout` once and `setInterval` are indistinguishable after one tick.
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", NODE_A);

    await vi.advanceTimersByTimeAsync(SIDECAR_COMPACTION_PERIOD_MS);
    expect(checkpointWrites(io)).toBe(1);

    seedRecord(doc, "nodes", NODE_B);
    await vi.advanceTimersByTimeAsync(SIDECAR_COMPACTION_PERIOD_MS);
    expect(checkpointWrites(io), "compaction ran once and never again").toBe(2);

    await lifecycle.destroy();
  });

  it("the period is TUNABLE — an injected value is honoured, the default is not", async () => {
    const io = createSidecarIO(createTrace());
    const periodMs = 25;
    expect(periodMs).toBeLessThan(SIDECAR_COMPACTION_PERIOD_MS);
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", NODE_A);

    await vi.advanceTimersByTimeAsync(periodMs - 1);
    expect(checkpointWrites(io), "the injected period was ignored and fired early").toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      checkpointWrites(io),
      "the injected period was ignored and the constant was used instead",
    ).toBe(1);

    await lifecycle.destroy();
  });

  it("`destroy()` stops the timer — a torn-down lifecycle compacts nothing", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 20 });
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    seedRecord(doc, "nodes", NODE_A);

    // POSITIVE CONTROL first, so "zero compactions after destroy" cannot pass
    // because the timer never worked in the first place.
    await vi.advanceTimersByTimeAsync(20);
    expect(checkpointWrites(io)).toBe(1);

    await lifecycle.destroy();
    const afterDestroy = checkpointWrites(io);
    await vi.advanceTimersByTimeAsync(20 * 10);
    expect(checkpointWrites(io), "the periodic timer outlived destroy()").toBe(afterDestroy);
  });

  it("a detached doc is not compacted; an attached sibling still is", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { periodMs: 20 });
    const first = new Y.Doc();
    const second = new Y.Doc();
    lifecycle.attach(FIXED_GUID, first);
    lifecycle.attach("guid-sibling", second);
    seedRecord(first, "nodes", NODE_A);
    seedRecord(second, "nodes", NODE_B);
    await vi.advanceTimersByTimeAsync(0);

    await lifecycle.detach(FIXED_GUID);
    const baseline = checkpointWrites(io);

    await vi.advanceTimersByTimeAsync(20);

    expect(checkpointWrites(io), "a detached doc was still compacted on the timer").toBe(baseline);
    expect(
      io.ops.filter((op) => op === `write:${sidecarCheckpointPath("guid-sibling")}`).length,
      "the attached sibling was not compacted — the timer covers only one doc",
    ).toBeGreaterThanOrEqual(1);

    await lifecycle.destroy();
  });
});
