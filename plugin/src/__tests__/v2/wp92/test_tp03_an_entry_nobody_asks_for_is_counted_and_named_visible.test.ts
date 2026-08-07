// WP92 / C92 AC3 — A STORED ENTRY NOBODY EVER ASKS FOR IS DETECTABLE.
//
// THIS IS THE CRITERION, AND THE SILENCE IS THE DEFECT. A store entry that no
// lookup ever asks for produced, before this file, NO SIGNAL OF ANY KIND — not a
// warning, not a counter, not a health value. That is true of the rename orphan,
// of a platform mismatch, of a typo in a hand-edited file, and of every future
// key defect nobody has thought of yet. The key repair closes two instances;
// this closes the class. It is also the only criterion here that keeps its full
// value if S73 resolves badly.
//
// THE TRAP THIS AC SETS FOR ITSELF (AC3(a)) — after the key repair the orphan is
// no longer reachable, so "zero unmatched entries" is true FOR FREE. So the
// primary observable below is a POSITIVE NON-ZERO, asserted as exactly 1, and NO
// zero anywhere is offered as evidence that the fix works.
//
// THE COUNTERS ARE THE EVIDENCE; THE SIGNATURE IS CORROBORATION (AC3(c)). Under
// S65 a zero-line read of the debug log is not an absence, and this AC's entire
// subject is a thing that produces no line.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// 1. Make `unmatchedEntries()` return `[]` unconditionally → the count cases red
//    on "exactly one entry was never looked up".
// 2. Restore WP90's key by passing `refusalIdentity: <diskPath>` — which is what
//    the LAST case in this file does DELIBERATELY, as the negative control. It
//    is the pre-repair build, driven through the production `handleRename`, and
//    it shows the user's record being destroyed. If it ever goes green the
//    orphan is back and the case above it is decoration.
// VERIFIED RED on each named assertion, then restored.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { createSidecarStore, seedRefusalStorePath } from "../../../files/canvas-sidecar";
import { CanvasSync, createCanvasIdentityStore } from "../../../files/canvas-sync";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import {
  CANVAS_PATH,
  FIXED_GUID,
  RENAMED_PATH,
  createFileOps,
  createManifest,
  createMemoryIO,
  createSyncManager as createIdentitySyncManager,
  createVault as createIdentityVault,
} from "../wp27/harness";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  docAsTheRelayWouldHandItBack,
  legacyEntry,
  legacyStoreFile,
  nodeIdsIn,
} from "./harness";

const A = "boards/a.canvas";
const B = "boards/b.canvas";
const C = "boards/c.canvas";

describe("WP92 AC3 — the entry nobody asked for is counted", () => {
  it("three stored entries, two asked for → EXACTLY ONE unmatched, and the two DECREMENTED it", async () => {
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: legacyStoreFile({
        [A]: legacyEntry("n-a"),
        [B]: legacyEntry("n-b"),
        [C]: legacyEntry("n-c"),
      }),
    });
    const log = createRecordingLogger();
    // AC3(b): driven by a store ACTUALLY LOADED FROM BYTES, never by a hand-set
    // field — a counter incremented on a branch no test reaches proves nothing.
    const store = new SeedRefusalStore(storeIO, { logger: log });

    // Before any lookup the census is the whole file. That is the correct
    // reading of "not asked in this process" and it is why the number is a
    // prompt and never a verdict.
    expect(await store.load(A)).toHaveLength(1);
    expect([...store.unmatchedEntries()].sort()).toEqual([B, C]);
    expect(await store.load(B)).toHaveLength(1);

    // THE PRIMARY OBSERVABLE, and it is a positive non-zero.
    expect(store.unmatchedEntries(), "exactly one entry was never looked up").toEqual([C]);
    expect(store.unmatchedEntries().length).toBe(1);
    // The two matched entries DECREMENTED it — a count that only ever goes up is
    // a count of the file, not of the mismatch.
    expect([...store.askedEntries()].sort()).toEqual([A, B]);

    // AC3(d): the OTHER sense, kept separate and named.
    expect(store.askedButAbsent(), "an asked-and-found key was filed as missing").toEqual([]);
    await store.load("boards/never-stored.canvas");
    expect(store.askedButAbsent(), "the two senses were conflated").toEqual([
      "boards/never-stored.canvas",
    ]);
    expect(store.unmatchedEntries(), "an absent key leaked into the stored-entry census").toEqual([
      C,
    ]);

    // The signature corroborates the state; it is never the oracle.
    expect(store.reportUnmatched()).toBe(1);
    const line = log.lines.find((l) => l.startsWith("SEED REFUSAL UNMATCHED:"));
    expect(line, "the one signature never fired").toBeDefined();
    expect(line as string).toContain(C);
    expect(line as string).toContain("1 stored entry never looked up");
    // Path and count ONLY — never a reason string, never a node id.
    expect(line as string, "the signature leaked a refusal's contents").not.toContain("n-c");
  });

  it("a store with NOTHING unmatched emits no signature, and that is not evidence of anything", async () => {
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: legacyStoreFile({ [A]: legacyEntry("n-a") }),
    });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    await store.load(A);
    expect(store.reportUnmatched()).toBe(0);
    expect(log.lines.some((l) => l.startsWith("SEED REFUSAL UNMATCHED:"))).toBe(false);
  });

  it("a QUARANTINED store reports no census rather than inventing a clean one", async () => {
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: "{ not json" });
    const store = new SeedRefusalStore(storeIO, {});
    await store.load(A);
    expect(store.isQuarantined()).toBe(true);
    // "[] because there is no root" is NOT "[] because the file is clean", and
    // the lookup still counts as having been asked.
    expect(store.unmatchedEntries()).toEqual([]);
    expect(store.askedEntries()).toEqual([A]);
  });
});

// ---------------------------------------------------------------------------
// THE RENAME ORPHAN, END TO END, HEADLESS — through the PRODUCTION handleRename.
// ---------------------------------------------------------------------------

/** A real `CanvasSync` with a real identity store, subscribed as host. */
async function subscribedHost() {
  const vault = createIdentityVault({ [CANVAS_PATH]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
  const sync = createIdentitySyncManager();
  const manifest = await createManifest(vault, sync);
  const sidecar = createSidecarStore(createMemoryIO());
  manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }));
  await canvasSync.subscribe(CANVAS_PATH, "host");
  return { vault, sync, canvasSync };
}

/**
 * One run of "refuse under the old name, rename, cold-open under the new one".
 *
 * `keyOf` is the ONLY difference between the repaired build and WP90's: it
 * decides what the store is keyed by. Everything else — the vault, the identity
 * store, the rename, the two cold opens — is identical, so a difference in the
 * outcome can only come from the key.
 */
async function refuseThenRename(keyOf: (path: string, guid: string | null) => string | null) {
  const { vault, canvasSync } = await subscribedHost();
  const storeIO = createStoreIO();
  const log = createRecordingLogger();
  const before = canvasJson([VALID_NODE, TYPELESS_NODE]);

  // ── SESSION 1: the seed refuses under the OLD name, and it is recorded ─────
  const doc1 = new Y.Doc();
  const io1 = createIO({ [CANVAS_PATH]: before });
  const store1 = new SeedRefusalStore(storeIO, { logger: log });
  const p1 = new CanvasPersistence(doc1, io1, CANVAS_PATH, {
    logger: log,
    durableRefusals: store1,
    refusalIdentity: keyOf(CANVAS_PATH, canvasSync.getCanvasGuid(CANVAS_PATH)),
  });
  const cold1 = await p1.coldOpen();
  await p1.flush();
  await store1.idle();
  p1.destroy();

  // ── THE GESTURE: Obsidian's own rename, through the production path ────────
  vault.files.set(RENAMED_PATH, vault.files.get(CANVAS_PATH) as string);
  vault.files.delete(CANVAS_PATH);
  await canvasSync.handleRename(CANVAS_PATH, RENAMED_PATH);

  // ── SESSION 2: the NEW path cold-opens with a doc the relay already holds ──
  const doc2 = docAsTheRelayWouldHandItBack(doc1);
  const io2 = createIO({ [RENAMED_PATH]: before });
  const store2 = new SeedRefusalStore(storeIO, { logger: log });
  const p2 = new CanvasPersistence(doc2, io2, RENAMED_PATH, {
    logger: log,
    durableRefusals: store2,
    refusalIdentity: keyOf(RENAMED_PATH, canvasSync.getCanvasGuid(RENAMED_PATH)),
  });
  const cold2 = await p2.coldOpen();
  await p2.flush();
  await store2.idle();

  return { before, cold1, cold2, io2, p2, store2, storeIO, log, canvasSync, doc1, doc2 };
}

describe("WP92 AC3 / AC1 — the rename orphan, driven through production handleRename", () => {
  it("THE REPAIR: the withhold follows the rename, the record survives, nothing is orphaned", async () => {
    const run = await refuseThenRename((_path, guid) => guid);

    // The preconditions, asserted PASSING before any negative is read.
    expect(run.cold1, "session 1 did not seed from the file").toBe("seeded-from-file");
    expect(run.canvasSync.getCanvasGuid(RENAMED_PATH), "the rename did not carry the guid").toBe(
      FIXED_GUID,
    );
    expect(run.canvasSync.getCanvasGuid(CANVAS_PATH), "the old path still resolves").toBe(null);
    expect(run.doc2.getMap<Y.Map<unknown>>("nodes").size, "the doc arrived empty").toBeGreaterThan(
      0,
    );
    expect(run.cold2, "this is not the doc-wins branch — the case would be vacuous").toBe(
      "doc-wins",
    );

    // THE CRITERION.
    expect(
      run.p2.seedRefusals().map((r) => r.id),
      "the standing withhold did not survive the rename",
    ).toEqual(["n-bad"]);
    expect(run.p2.isWriteWithheld(), "the withhold is not observable state").toBe(true);
    expect(run.io2.write, "a write reached the disk after the rename").not.toHaveBeenCalled();
    expect(
      nodeIdsIn(run.io2.files.get(RENAMED_PATH) as string),
      "the user's record was destroyed by renaming the file",
    ).toContain("n-bad");
    expect(run.io2.files.get(RENAMED_PATH)).toBe(run.before);

    // And nothing was left behind: the store holds ONE key, it was asked for.
    expect(run.store2.unmatchedEntries(), "the rename left an orphan behind").toEqual([]);
    expect(Object.keys(JSON.parse(run.storeIO.text() as string).paths)).toEqual([FIXED_GUID]);

    run.p2.destroy();
    run.canvasSync.destroy();
    run.doc1.destroy();
    run.doc2.destroy();
  });

  it("NEGATIVE CONTROL — WP90's path key, same gesture: the orphan appears and the record is DESTROYED", async () => {
    // This is the pre-repair build, reproduced by changing ONE expression: the
    // store is keyed by the path, exactly as `hydrateDurableRefusals` did before
    // WP92. It is the proof that the case above can fail.
    const run = await refuseThenRename((path) => path);

    expect(run.cold1).toBe("seeded-from-file");
    expect(run.cold2, "not the doc-wins branch — the control would prove nothing").toBe("doc-wins");

    // The withhold is GONE under the new name.
    expect(
      run.p2.seedRefusals(),
      "the path key survived a rename — the control is not reproducing the defect",
    ).toEqual([]);
    expect(run.p2.isWriteWithheld()).toBe(false);
    // …and WP90's cascade runs in full: the projection lands on the user's file.
    expect(run.io2.write, "nothing was written — the file would 'survive' for the wrong reason").
      toHaveBeenCalled();
    expect(
      nodeIdsIn(run.io2.files.get(RENAMED_PATH) as string),
      "the pre-repair build did NOT destroy the record — this control is broken",
    ).not.toContain("n-bad");

    // AC3's other half, and it is the whole point of the census: the old key
    // holds the only record that a record was ever refused, and BEFORE this WP
    // absolutely nothing said so.
    expect(
      run.store2.unmatchedEntries(),
      "the orphan is not reported — the census cannot see the defect it exists for",
    ).toEqual([CANVAS_PATH]);
    expect(run.store2.reportUnmatched()).toBe(1);
    expect(
      run.log.lines.some((l) => l.startsWith("SEED REFUSAL UNMATCHED:") && l.includes(CANVAS_PATH)),
      "the orphan was silent",
    ).toBe(true);

    run.p2.destroy();
    run.canvasSync.destroy();
    run.doc1.destroy();
    run.doc2.destroy();
  });
});
