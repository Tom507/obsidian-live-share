// WP90 / AC2 — a refusal recorded in session N still WITHHOLDS in session N+1.
//
// THE DEFECT, IN ONE SENTENCE. WP63's withhold is per-session and in-memory. The
// next cold open arrives with a doc the relay already holds, takes `doc-wins`,
// never reads the file, and flushes a projection that has never contained the
// refused record over the user's `.canvas`. The record is gone — deleted as a
// consequence of a refusal, which is I11 verbatim, one restart later.
//
// FILE BYTES ARE THE ORACLE, inherited from WP63 for the same reason: a probe
// that asserted on a `SEED REFUSED:` line would pass against an implementation
// that narrates and then writes.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ────────────────────────────────────────────
// Delete the `await this.hydrateDurableRefusals()` statement at the top of
// `CanvasPersistence.coldOpen` (`canvas-persistence.ts`). Session 2's ledger is
// then empty, `writeIsWithheld()` answers false, the `doc-wins` flush writes,
// and `n-bad` disappears from the file. VERIFIED RED, then restored.
// The second case is the positive control for the first and reddens the other
// way: it OMITS the store and asserts the record is destroyed, so an
// implementation that withheld unconditionally — for instance because
// `withholdOnSeedRefusal` had been forced on, or because the doc-wins flush had
// been removed — would fail it. The pair can only both be green if the store is
// what makes the difference.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  docAsTheRelayWouldHandItBack,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

describe("WP90 AC2 — the withhold outlives the session that recorded it", () => {
  it("session 2 takes doc-wins, no seed runs, and the user's record is STILL in the file", async () => {
    const storeIO = createStoreIO();

    // ── SESSION 1 — the refusal happens and is recorded ──────────────────────
    const doc1 = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io1 = createIO({ [DISK]: before });
    const log1 = createRecordingLogger();
    const store1 = new SeedRefusalStore(storeIO, { logger: log1 });
    const p1 = new CanvasPersistence(doc1, io1, DISK, {
      logger: log1,
      durableRefusals: store1,
    });

    expect(await p1.coldOpen(), "the seed branch was not taken — session 1 is vacuous").toBe(
      "seeded-from-file",
    );
    expect(
      doc1.getMap<Y.Map<unknown>>("nodes").has("n-bad"),
      "WP18 AC1 was weakened: the invalid record entered the doc",
    ).toBe(false);
    await p1.flush();
    expect(io1.files.get(DISK), "session 1's own withhold did not hold").toBe(before);

    // The three preconditions AC1 asserts rather than assumes, checked here
    // because everything after the restart is meaningless without them.
    expect(
      log1.lines.some((line) => line.startsWith("SEED REFUSED:")),
      "no refusal was signed — session 1 refused nothing",
    ).toBe(true);
    expect(nodeIdsIn(io1.files.get(DISK) as string)).toContain("n-bad");
    expect(p1.seedRefusals().map((r) => r.id)).toEqual(["n-bad"]);

    // The store's writes are queued, exactly as the canvas writer's are. Waiting
    // for the queue is what the process's own shutdown does not do — recorded as
    // a real residue in the report — and here it is what makes the restart a
    // restart rather than a race.
    await store1.idle();
    expect(
      storeIO.text(),
      "nothing reached the durable store in session 1 — the restart would prove nothing",
    ).toContain("n-bad");

    p1.destroy();

    // ── THE RESTART — only bytes survive ─────────────────────────────────────
    // A new doc built from a real update of session 1's, which is what the relay
    // (or the sidecar) hands back; a new disk carrying only the file's bytes; a
    // new store instance over the same sidecar bytes; a NEW, EMPTY ledger,
    // because `CanvasPersistence` builds one when none is injected.
    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [DISK]: io1.files.get(DISK) as string });
    const log2 = createRecordingLogger();
    const p2 = new CanvasPersistence(doc2, io2, DISK, {
      logger: log2,
      durableRefusals: new SeedRefusalStore(storeIO, { logger: log2 }),
    });

    // Vacuity guard 3 from the charter: the doc must arrive NON-EMPTY, or cold
    // open takes `seeded-from-file` and re-derives the refusal for an entirely
    // different reason.
    expect(
      doc2.getMap<Y.Map<unknown>>("nodes").size > 0,
      "the doc arrived empty — this is not the doc-wins branch",
    ).toBe(true);
    expect(
      doc2.getMap<Y.Map<unknown>>("nodes").has("n-bad"),
      "the doc holds the refused record, so there is nothing to protect",
    ).toBe(false);

    const result = await p2.coldOpen();

    expect(result, "the doc-wins branch was not taken — this probe would be vacuous").toBe(
      "doc-wins",
    );
    expect(io2.files.get(DISK), "the user's file was rewritten one restart later").toBe(before);
    expect(
      nodeIdsIn(io2.files.get(DISK) as string),
      "the refused record was deleted from the user's own file by session 2",
    ).toContain("n-bad");
    expect(
      io2.write,
      "a write reached the disk while a restored refusal was standing",
    ).not.toHaveBeenCalled();
    expect(p2.isWriteWithheld(), "the restored withhold is not observable state").toBe(true);

    // AC2's narration: the withhold is announced in session 2 although NO seed
    // ran to produce it — "observable state, never a silent no-op".
    expect(
      log2.lines.some((line) => line.startsWith("SEED REFUSAL STORE:") && line.includes("n-bad")),
      "the restore was silent",
    ).toBe(true);
    expect(
      log2.lines.some((line) => line.startsWith("SEED REFUSED:") && line.includes("n-bad")),
      "the withhold itself was a silent no-op in session 2",
    ).toBe(true);

    p2.destroy();
    doc1.destroy();
    doc2.destroy();
  });

  it("POSITIVE CONTROL — the same session 2 WITHOUT the store destroys the record", async () => {
    // This is the pre-WP90 build, reproduced by omitting exactly one option.
    // It is what makes the case above evidence rather than decoration: if this
    // one went green too, the file would be surviving for some reason other
    // than the durable withhold.
    const doc1 = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io1 = createIO({ [DISK]: before });
    const p1 = new CanvasPersistence(doc1, io1, DISK, {});
    expect(await p1.coldOpen()).toBe("seeded-from-file");
    await p1.flush();
    expect(io1.files.get(DISK), "session 1 is not the session that loses it").toBe(before);
    p1.destroy();

    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [DISK]: io1.files.get(DISK) as string });
    const p2 = new CanvasPersistence(doc2, io2, DISK, {});

    expect(await p2.coldOpen()).toBe("doc-wins");

    expect(
      io2.write,
      "nothing was written at all — the file would 'survive' for the wrong reason",
    ).toHaveBeenCalled();
    expect(
      nodeIdsIn(io2.files.get(DISK) as string),
      "WP63 alone was already durable, so WP90 measures nothing",
    ).not.toContain("n-bad");

    p2.destroy();
    doc1.destroy();
    doc2.destroy();
  });
});
