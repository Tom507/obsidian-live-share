// WP121 A3 + A4 — COPY THEN FLUSH, and the ledger says what happened on EVERY
// branch.
//
// `S155`, which this module already learned the expensive way: a guard that RAN
// and decided "nothing to preserve" was indistinguishable from a guard that was
// NEVER CALLED — both read `{total: 0, byArm: {}, failed: 0}` — and a live round
// measured exactly that on three vaults, producing a report AND a charter that
// both concluded the wrong thing. Without a canvas arm the next live round
// cannot attribute a canvas loss even if it sees one.
//
// A3's shape, and why COPY-THEN-FLUSH rather than REFUSE: the copy is strictly
// additive, the document's records still land, so convergence is unaffected and
// `DISPATCHER_STATE.md` §5 ("divergence is never an acceptable steady state") is
// not traded against. A refusal would leave the board split — and a refusal that
// leaves it writerless re-creates exactly the defect WP122 exists to remove.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import { getConflictCopies, resetConflictCopies } from "../../../files/conflict-copy";
import {
  NODE,
  authorSpelling,
  conflictCopiesIn,
  createIO,
  createRecordingLogger,
  preservationOver,
  recordIdsIn,
  seedDoc,
} from "./harness";

const SHARE = "share";
const CONFLICTS = "share (conflicts)";
const PATH = "share/board.canvas";

beforeEach(() => {
  resetConflictCopies();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("WP121 A4 — the ledger, on every branch", () => {
  it("ACTED branch: `byArm.canvas` increments and the arm is distinguishable", async () => {
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared"), NODE("n-local")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    const ledger = getConflictCopies();
    expect(ledger.total).toBe(1);
    expect(ledger.byArm.canvas).toBe(1);
    // Not attributed to somebody else's arm.
    expect(ledger.byArm.text).toBeUndefined();
    expect(ledger.byArm.binary).toBeUndefined();
    expect(ledger.failed).toBe(0);
    expect(ledger.discarded).toBe(0);
    persistence.destroy();
  });

  it("DO-NOTHING branch: counted, attributed to the canvas arm, and said", async () => {
    // The whole of `S148`: "the guard ran and decided nothing to preserve" must
    // not read the same as "the guard was never called".
    const logger = createRecordingLogger();
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      logger,
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    const ledger = getConflictCopies();
    expect(ledger.total).toBe(0);
    expect(ledger.discarded).toBe(1);
    expect(ledger.discardedByArm.canvas).toBe(1);
    expect(logger.lines.some((l) => l.includes("CONFLICT COPY SKIPPED: arm=canvas"))).toBe(true);
    persistence.destroy();
  });

  it("NEVER-CALLED branch reads DIFFERENTLY from both — the discriminator itself", async () => {
    // The row that gives the two above their meaning. Same fixture as the
    // do-nothing row, no preservation door wired: every counter stays at zero,
    // so `{discarded: 0}` genuinely means "this guard did not run here".
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH);

    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0, discarded: 0 });
    expect(getConflictCopies().discardedByArm.canvas).toBeUndefined();
    persistence.destroy();
  });

  it("FAILED branch: `failed` increments AND the document's content still lands", async () => {
    // `preserveLocalVersion`'s contract, carried onto this arm verbatim: "NEVER
    // THROWS… a vault that refuses the copy must still receive the host's
    // content, because failing the sync would turn a best-effort safety net into
    // a new outage".
    const logger = createRecordingLogger();
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared"), NODE("n-local")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      logger,
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE, failWrite: true }),
    });

    // The cold open completed and answered normally — no throw escaped.
    expect(coldOpen).toBe("doc-wins");
    expect(getConflictCopies().failed).toBe(1);
    expect(getConflictCopies().total).toBe(0);
    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([]);
    // THE FLUSH STILL HAPPENED. This is the conjunct that separates a
    // best-effort net from a new outage.
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared"]);
    expect(logger.lines.some((l) => l.includes("CONFLICT COPY FAILED: arm=canvas"))).toBe(true);
    persistence.destroy();
  });

  it("FAILED branch: a read that throws is counted as failed, not as nothing-to-preserve", async () => {
    // The two must not read the same. A file we could not read is a file we
    // cannot reason about, and the flush is about to overwrite it.
    const io = createIO({ [PATH]: authorSpelling([NODE("n-local")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);
    const door = preservationOver(io, { sharedFolder: SHARE });
    door.read = vi.fn(async () => {
      throw new Error("adapter refused the read");
    });

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: door,
    });

    expect(coldOpen).toBe("doc-wins");
    expect(getConflictCopies().failed).toBe(1);
    expect(getConflictCopies().discarded).toBe(0);
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared"]);
    persistence.destroy();
  });
});

describe("WP121 A3/A5 — the copy is additive and who wins does not change", () => {
  it("the copy is written BEFORE the flush, so it carries the pre-flush bytes", async () => {
    // Ordering is the contract: a copy taken after the flush would preserve the
    // projection, i.e. exactly the thing that is not at risk.
    const order: string[] = [];
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared"), NODE("n-local")]) });
    const originalWrite = io.write;
    io.write = vi.fn(async (p: string, c: string) => {
      order.push(`flush:${p}`);
      await originalWrite(p, c);
    });
    const door = preservationOver(io, { sharedFolder: SHARE });
    const originalCopy = door.write;
    door.write = vi.fn(async (p: string, c: string) => {
      order.push(`copy:${p}`);
      await originalCopy(p, c);
    });

    const { persistence } = await attachCanvasPersistence(doc(), io, PATH, {
      preserveDiscarded: door,
    });

    expect(order[0]?.startsWith("copy:")).toBe(true);
    expect(order[1]).toBe(`flush:${PATH}`);
    persistence.destroy();
  });

  it("a canvas that already lives INSIDE the conflicts root never seeds another copy", async () => {
    // `isConflictsPath` is an OWNED exclusion (`conflict-copy.ts:46-58`): a
    // conflicts folder that ever counted as shared would be published,
    // re-conflicted on the next join, and multiply without bound. This is the
    // same property, one level in — a copy of a copy is the unbounded loop.
    const inside = `${CONFLICTS}/board (2026-08-08 17-42-03).canvas`;
    const io = createIO({ [inside]: authorSpelling([NODE("n-local")]) });
    const d = new Y.Doc();
    seedDoc(d, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(d, io, inside, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([inside]);
    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0, discarded: 0 });
    persistence.destroy();
  });

  it("the copy lands under the conflicts root, mirroring its path and stamped", async () => {
    const io = createIO({ ["share/sub/board.canvas"]: authorSpelling([NODE("n-local")]) });
    const d = new Y.Doc();
    seedDoc(d, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(d, io, "share/sub/board.canvas", {
      preserveDiscarded: preservationOver(io, {
        sharedFolder: SHARE,
        when: new Date(2026, 7, 8, 17, 42, 3),
      }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([
      "share (conflicts)/sub/board (2026-08-08 17-42-03).canvas",
    ]);
    persistence.destroy();
  });
});

function doc(): Y.Doc {
  const d = new Y.Doc();
  seedDoc(d, [NODE("n-shared")]);
  return d;
}
