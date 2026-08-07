// WP63 / AC4 — DISCRIMINATION (BUILD_SPEC §8), and the reason this WP exists.
//
// This is not an ordinary "the mechanism does something" probe. It is the
// REGRESSION PIN for a silent data-loss defect that reached a live path, so it
// is built to the charter's §7 rule and to nothing else:
//
//   ├── the oracle is FILE BYTES BEFORE vs. AFTER A REAL FLUSH — never a
//   │   signature, never a doc assertion, never "the write was not called";
//   ├── the armed run and the disarmed run differ in EXACTLY ONE thing, the
//   │   seam (`withholdOnSeedRefusal`); everything else is one shared function;
//   └── the disarmed run is SHOWN TO ACTUALLY LOSE THE RECORD. A discrimination
//       test that passes because the flush never happened proves nothing, so the
//       disarmed leg asserts the loss positively — the record is gone from the
//       file, and the write really landed.
//
// The seam is test-only; there is no production caller, and T4 pins that the
// default is the ARMED mode so it cannot ship switched off.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createSyncManager,
  createVault,
  ioOverVault,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

interface Run {
  before: string;
  after: string;
  wrote: boolean;
}

/**
 * ONE scenario, parameterised by the seam only.
 *
 * A guest opens a canvas whose file holds a record the ingest gate refuses. The
 * doc is empty, so cold open seeds from the file (and refuses `n-bad`), and then
 * a real flush is driven — the exact composition that used to delete the record.
 */
async function runColdOpenSeed(withholdOnSeedRefusal: boolean): Promise<Run> {
  const doc = new Y.Doc();
  const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
  const io = createIO({ [DISK]: before });
  const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal });

  const result = await p.coldOpen();
  if (result !== "seeded-from-file") throw new Error(`seed branch not taken: ${result}`);
  await p.flush();

  const after = io.files.get(DISK) as string;
  const wrote = (io.write as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0;
  p.destroy();
  doc.destroy();
  return { before, after, wrote };
}

/**
 * The same single difference, on the HOST path — the production composition, and
 * the one where the file being overwritten is the user's only copy.
 */
async function runHostSeed(withholdOnSeedRefusal: boolean): Promise<Run> {
  const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
  const vault = createVault({ [DISK]: before });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  await cs.subscribe(DISK, "host");

  const doc = syncManager.getDoc(`__canvas__:${DISK}`).doc;
  const io = ioOverVault(vault);
  const p = new CanvasPersistence(doc, io, DISK, {
    seedRefusals: cs.seedRefusalLedger(DISK),
    withholdOnSeedRefusal,
  });

  const result = await p.coldOpen();
  if (result !== "doc-wins") throw new Error(`doc-wins branch not taken: ${result}`);
  await p.flush();

  const after = vault.files.get(DISK) as string;
  const wrote = (io.write as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0;
  p.destroy();
  cs.destroy();
  doc.destroy();
  return { before, after, wrote };
}

describe("WP63 AC4 — the withhold seam is what keeps the record in the file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T1 COLD-OPEN seed: armed → byte-identical; disarmed → the record is deleted", async () => {
    const armed = await runColdOpenSeed(true);
    const disarmed = await runColdOpenSeed(false);

    // The disarmed leg must reproduce the defect, or the armed leg proves nothing.
    expect(disarmed.wrote, "the disarmed flush never wrote — the probe would be vacuous").toBe(true);
    expect(disarmed.after, "the disarmed run did not rewrite the file").not.toBe(disarmed.before);
    expect(
      nodeIdsIn(disarmed.after),
      "the disarmed seam must reproduce the loss: `n-bad` should be gone",
    ).not.toContain("n-bad");

    expect(armed.after, "the armed seam did not keep the file byte-identical").toBe(armed.before);
    expect(nodeIdsIn(armed.after)).toContain("n-bad");
    expect(armed.after).not.toBe(disarmed.after);
  });

  it("T2 HOST seed: armed → byte-identical; disarmed → the record is deleted", async () => {
    const armed = await runHostSeed(true);
    const disarmed = await runHostSeed(false);

    expect(disarmed.wrote, "the disarmed flush never wrote — the probe would be vacuous").toBe(true);
    expect(
      nodeIdsIn(disarmed.after),
      "the disarmed seam must reproduce the loss on the host path",
    ).not.toContain("n-bad");

    expect(armed.after, "the armed seam did not keep the host's file byte-identical").toBe(
      armed.before,
    );
    expect(nodeIdsIn(armed.after)).toContain("n-bad");
    expect(armed.after).not.toBe(disarmed.after);
  });

  it("T3 the armed mode is the DEFAULT — the seam cannot ship switched off", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    // No `withholdOnSeedRefusal` at all.
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();

    expect(io.files.get(DISK), "the default configuration deletes the user's record").toBe(before);

    p.destroy();
    doc.destroy();
  });

  it("T4 the seam only suppresses the REFUSAL case — a clean canvas writes under both settings", async () => {
    const results: Record<string, string> = {};
    for (const withholdOnSeedRefusal of [true, false]) {
      const doc = new Y.Doc();
      const io = createIO({ [DISK]: canvasJson([VALID_NODE]) });
      const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal });
      expect(await p.coldOpen()).toBe("seeded-from-file");
      await p.flush();
      results[String(withholdOnSeedRefusal)] = io.files.get(DISK) as string;
      p.destroy();
      doc.destroy();
    }

    expect(
      results.true,
      "the armed seam suppressed a write that had nothing to do with a refusal",
    ).toBe(results.false);
    expect(nodeIdsIn(results.true)).toEqual(["n-ok"]);
  });
});
