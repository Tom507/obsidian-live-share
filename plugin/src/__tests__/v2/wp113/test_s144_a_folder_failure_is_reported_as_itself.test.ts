// ===========================================================================
// WP113 / PACKAGE B — S144: `ensureFolder` swallowed every `createFolder` error,
// so a FOLDER failure was reported to the user as a RENAME failure.
//
// The `catch` was written for ONE case — a concurrent create, where the folder
// exists a moment later and the throw means nothing — and it absorbed every
// other case with it. The caller then failed at whatever it wanted the folder
// for and told the user about THAT: `APPLY FAILED: rename a -> b/c: …`, with the
// folder mentioned nowhere. That is the `S112`/`S138` misattribution family, in
// the product rather than the rig, sitting directly on the path WP110 repaired.
//
// B3 IS THE CONSTRAINT AND IT IS HONOURED: `ensureFolder` still returns `void`,
// still never throws, and every one of its call sites is unchanged. The caller's
// behaviour is byte-identical. Making the failure LEGIBLE is the package.
//
// REAL: `ensureFolder` itself, the real `path-outcome.ts` emitter, and the real
// `FileOpsManager.applyRemoteOp` for the integration row. DOUBLE: the vault —
// see `harness.ts`, and note that a failing `createFolder` is the SUBJECT here,
// so it is parameterised rather than mocked away.
// ===========================================================================

import { beforeEach, describe, expect, it } from "vitest";

import { FileOpsManager } from "../../../files/file-ops";
import {
  ENSURE_FOLDER_OUTCOMES,
  PATH_DISPOSITION,
  PATH_OUTCOME_FACTS,
  getPathOutcomes,
  resetPathOutcomes,
} from "../../../files/path-outcome";
import { ensureFolder } from "../../../utils";
import { SHARE, loggerDouble, makeVault } from "./harness";

const DEEP = `${SHARE}/notes/2026/august`;

/** `FileOpsManager` reaches `trashFile` only on a branch no row here takes. */
function fileManagerDouble() {
  return { trashFile: async () => {} } as never;
}

function cell(outcome: string): number {
  return getPathOutcomes().byArm[`ensure-folder/${outcome}`] ?? 0;
}

beforeEach(() => resetPathOutcomes());

describe("S144 B1 — a folder that could not be created says so, and names the folder", () => {
  it("a REAL create failure is counted, classified and logged with the folder path", async () => {
    const vault = makeVault();
    const logger = loggerDouble();
    vault.folderErrors.set(`${SHARE}/notes`, { mode: "fail", message: "EACCES: permission denied" });

    await ensureFolder(vault.asVault, DEEP, logger);

    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_FAILED), "the failure was not counted").toBe(1);
    expect(
      getPathOutcomes().byDisposition[PATH_DISPOSITION.RETRYABLE],
      "the failure was not classified",
    ).toBe(1);
    const lines = logger.outcomes();
    expect(lines.length, "the failure reached no log").toBe(1);
    // THE FOLDER, which is the fact the caller's own message does not contain.
    expect(lines[0]).toContain(`path=${SHARE}/notes`);
    expect(lines[0]).toContain("outcome=create-failed");
    // The requested path AND the adapter's own message, so the line is
    // diagnosable without a second one.
    expect(lines[0]).toContain(`requested=${DEEP}`);
    expect(lines[0]).toContain("EACCES: permission denied");
  });

  it("B3 — the CALLER is unchanged: it still does not throw and still returns void", async () => {
    const vault = makeVault();
    vault.folderErrors.set(SHARE, { mode: "fail", message: "ENOSPC" });
    // If this rejected, every one of the twelve call sites would change
    // behaviour at once. It does not, and that is the package's boundary.
    await expect(ensureFolder(vault.asVault, DEEP, loggerDouble())).resolves.toBeUndefined();
    // …and with NO logger at all, which is what a call site that passes none
    // does. A fresh vault, because the first call left the deeper segments
    // behind and this assertion is about the FAILING branch.
    resetPathOutcomes();
    const bare = makeVault();
    bare.folderErrors.set(SHARE, { mode: "fail", message: "ENOSPC" });
    await expect(ensureFolder(bare.asVault, DEEP)).resolves.toBeUndefined();
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_FAILED), "the ledger needs a logger to count").toBe(
      1,
    );
  });

  it("the benign concurrent create is told apart from the real failure — by EVIDENCE, not by the message", async () => {
    // POSITIVE CONTROL for the classification. Both throw, with the SAME error
    // text; only one of them leaves the folder absent, and that is the whole
    // test the repair performs.
    const raced = makeVault();
    const racedLog = loggerDouble();
    raced.folderErrors.set(`${SHARE}/notes`, { mode: "race", message: "Folder already exists." });
    await ensureFolder(raced.asVault, DEEP, racedLog);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_RACED), "the benign race was not recognised").toBe(1);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_FAILED), "a benign race was reported as a failure").
      toBe(0);
    expect(racedLog.outcomes()[0]).toContain("disposition=completed");

    resetPathOutcomes();
    const failed = makeVault();
    const failedLog = loggerDouble();
    failed.folderErrors.set(`${SHARE}/notes`, { mode: "fail", message: "Folder already exists." });
    await ensureFolder(failed.asVault, DEEP, failedLog);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_FAILED), "the real failure was read as a race").toBe(
      1,
    );
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_RACED)).toBe(0);
    expect(failedLog.outcomes()[0]).toContain("disposition=retryable");
  });

  it("S155 — the two branches that did nothing wrong are counted too, and stay silent", async () => {
    // Without these, a row of zeros in the ledger is equally consistent with
    // "no folder ever failed" and "`ensureFolder` was never called".
    const vault = makeVault();
    const logger = loggerDouble();

    await ensureFolder(vault.asVault, DEEP, logger);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATED), "a successful create was not counted").toBe(1);

    await ensureFolder(vault.asVault, DEEP, logger);
    expect(
      cell(ENSURE_FOLDER_OUTCOMES.ALREADY_A_FOLDER),
      "the do-nothing branch is invisible — 'declined' and 'never reached' are the same reading",
    ).toBe(1);

    // Neither is audible: counted, not shouted.
    expect(logger.outcomes(), "an ordinary success was logged").toEqual([]);
    expect(PATH_OUTCOME_FACTS["ensure-folder"][ENSURE_FOLDER_OUTCOMES.CREATED].logged).toBe(false);
    expect(
      PATH_OUTCOME_FACTS["ensure-folder"][ENSURE_FOLDER_OUTCOMES.ALREADY_A_FOLDER].logged,
    ).toBe(false);

    // POSITIVE CONTROL for the zero: a path this function was never called for
    // has no cell at all.
    expect(getPathOutcomes().byArm["ensure-folder/create-failed"]).toBeUndefined();
  });

  it("one outcome per CALL, and it reports the WORST — a call that failed anywhere is a failed call", async () => {
    const vault = makeVault();
    const logger = loggerDouble();
    // The first segment is created, the third fails. The caller asked for one
    // folder; the answer is "no".
    vault.folderErrors.set(DEEP, { mode: "fail", message: "EIO" });
    await ensureFolder(vault.asVault, DEEP, logger);
    expect(vault.folderCreates.length, "not every segment was attempted").toBe(4);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATE_FAILED)).toBe(1);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATED), "a partially failed call reported success").toBe(
      0,
    );
    expect(logger.outcomes().length, "more than one outcome for one call").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B2 — THE INTEGRATION ROW. The failure is reported AS ITSELF, next to the
// rename that failed BECAUSE of it, and the two are distinguishable.
// ---------------------------------------------------------------------------

describe("S144 B2 — a `createFolder` failure is reported as itself, beside the rename it caused", () => {
  it("the log carries the folder failure AND the rename failure, and they name different things", async () => {
    const source = `${SHARE}/note.md`;
    const vault = makeVault({ [source]: "bytes\n" });
    const logger = loggerDouble();
    vault.folderErrors.set(`${SHARE}/notes`, { mode: "fail", message: "EACCES: permission denied" });
    // `vault.rename` is absent from the double on purpose: the rename FAILS,
    // which is the situation the user meets, and it fails for a reason that is
    // downstream of the folder.
    const ops = new FileOpsManager(vault.asVault, fileManagerDouble(), {
      releaseOnConsumingEvent: false,
    });
    ops.setLogger(logger);

    await ops.applyRemoteOp({
      type: "rename",
      oldPath: source,
      newPath: `${DEEP}/note.md`,
    } as never);

    const folderLines = logger.lines.filter((l) => l.includes("outcome=create-failed"));
    const renameLines = logger.lines.filter((l) => l.startsWith("APPLY FAILED:"));

    // BEFORE THIS PACKAGE THERE WAS ONLY THE SECOND LINE, and it says `rename`.
    expect(renameLines.length, "the rename did not fail — this row is vacuous").toBe(1);
    expect(renameLines[0]).toContain("rename");
    expect(
      renameLines[0].includes(`${SHARE}/notes`) && renameLines[0].includes("create"),
      "the rename line already blamed the folder — then S144 was never a defect",
    ).toBe(false);

    // AND NOW THE FIRST ONE EXISTS, names the FOLDER, and is not a rename line.
    expect(folderLines.length, "the folder failure is still swallowed").toBe(1);
    expect(folderLines[0]).toContain(`path=${SHARE}/notes`);
    expect(folderLines[0]).toContain("arm=ensure-folder");
    expect(folderLines[0].startsWith("APPLY FAILED:"), "the two lines are not distinguishable").toBe(
      false,
    );

    ops.destroy();
  });

  it("POSITIVE CONTROL — with the folder create healthy, no folder failure is reported at all", async () => {
    const source = `${SHARE}/note.md`;
    const vault = makeVault({ [source]: "bytes\n" });
    const logger = loggerDouble();
    // No `folderErrors`: the folder is created normally.
    const ops = new FileOpsManager(vault.asVault, fileManagerDouble(), {
      releaseOnConsumingEvent: false,
    });
    ops.setLogger(logger);

    await ops.applyRemoteOp({
      type: "rename",
      oldPath: source,
      newPath: `${DEEP}/note.md`,
    } as never);

    expect(
      logger.lines.filter((l) => l.includes("outcome=create-failed")),
      "a folder failure was reported where the folder succeeded — the instrument fires on nothing",
    ).toEqual([]);
    expect(cell(ENSURE_FOLDER_OUTCOMES.CREATED), "the folder was never created in the control").toBe(
      1,
    );
    ops.destroy();
  });
});
