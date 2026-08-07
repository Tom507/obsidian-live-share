// WP92 / C92 AC2 — AN ENTRY UNDER THE OLD KEY IS NOT SILENTLY LOST.
//
// DISPOSITION: **MIGRATE**. The cheap answer — "start fresh, the old entries
// just stop matching" — is PRECISELY the defect this work package exists to
// close, and shipping it deliberately would be worse than the bug.
//
// THE FIXTURE'S BYTES ARE A LITERAL (AC2(a)). A migration test whose input file
// is produced by the NEW code migrates nothing and would keep passing after the
// writer changed again; `legacyStoreFile()` spells out WP90's landed version-1
// shape by hand, so this file still means something in a year.
//
// IDEMPOTENCE IS ASSERTED ON THE FILE, NOT ON AN OBJECT (AC2(b)). The dedup at
// `seed-refusal-store.ts` compares SERIALISED BYTES, so the round trip through
// `SidecarIO` is the only place the property actually lives.
//
// THE FIXTURE CARRIES THREE PATHS, ONE OF THEM DELIBERATELY UNPARSEABLE (AC2(c)).
// WP90's rewrite property is that even an entry it CANNOT READ survives another
// path's rewrite, and a one-path fixture cannot see that.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// Delete the legacy-key fallback in `hydrateDurableRefusals` (the
// `if (stored.length === 0 && legacyKey !== key)` block): the version-1 entry is
// no longer found, `restore` never runs, and the first case reddens on "the
// WP90-era entry stopped matching". Delete the `store.migrate?.()` call instead
// and the re-key case reddens on the file's keys. VERIFIED RED on each, then
// restored.

import { describe, expect, it } from "vitest";

import {
  SEED_REFUSAL_STORE_VERSION,
  SeedRefusalStore,
} from "../../../files/seed-refusal-store";
import { seedRefusalStorePath } from "../../../files/canvas-sidecar";
import { createRecordingLogger, createStoreIO, legacyEntry, legacyStoreFile } from "./harness";

const LEGACY_KEY = "boards/Q3：plan.canvas";
const IDENTITY = "guid-3af1";
const OTHER_KEY = "boards/other.canvas";
const UNREADABLE_KEY = "boards/corrupt.canvas";

/** WP90's landed shape, by hand: three paths, one of which cannot be parsed. */
function threePathLegacyFile(): string {
  return legacyStoreFile({
    [LEGACY_KEY]: legacyEntry("n-bad"),
    [OTHER_KEY]: legacyEntry("n-other"),
    // Not a list. `load` refuses it, `partial` is reported, and WP90's property
    // is that a rewrite for ANOTHER key still leaves these bytes alone.
    [UNREADABLE_KEY]: { not: "a list" },
  });
}

function keysOf(text: string): string[] {
  return Object.keys((JSON.parse(text) as { paths: Record<string, unknown> }).paths).sort();
}

describe("WP92 AC2 — MIGRATE: the version-1 entry is carried forward, once", () => {
  it("a WP90-shaped file is FOUND under the legacy key and re-keyed onto the document identity", async () => {
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: threePathLegacyFile() });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });

    // The lookup the new code performs: identity first, legacy second.
    expect(await store.load(IDENTITY), "the identity key already had an entry — vacuous").toEqual(
      [],
    );
    const legacy = await store.load(LEGACY_KEY);
    expect(legacy.map((r) => r.id), "the WP90-era entry stopped matching").toEqual(["n-bad"]);

    // The version stamp on the file that was read is still 1 — this IS a
    // version-1 file — while the constant the writer stamps has moved to 2.
    expect(store.storedVersion(), "the fixture is not a version-1 file").toBe(1);
    expect(SEED_REFUSAL_STORE_VERSION, "the key vocabulary changed without a stamp").toBe(2);

    store.migrate(LEGACY_KEY, IDENTITY);
    await store.idle();

    const after = storeIO.text() as string;
    expect(keysOf(after), "the entry was not re-keyed onto the document identity").toEqual(
      [IDENTITY, OTHER_KEY, UNREADABLE_KEY].sort(),
    );
    // AC2(c): the other path's entry AND the unparseable one both survived.
    const parsed = JSON.parse(after) as { paths: Record<string, unknown> };
    expect(parsed.paths[OTHER_KEY], "another path's entry was dropped by the rewrite").toEqual(
      legacyEntry("n-other"),
    );
    expect(
      parsed.paths[UNREADABLE_KEY],
      "an entry the store could NOT read was destroyed by the rewrite",
    ).toEqual({ not: "a list" });

    // And the refusal is now reachable under the new key, from fresh bytes.
    const reread = new SeedRefusalStore(createStoreIO({ [seedRefusalStorePath()]: after }), {
      logger: log,
    });
    expect((await reread.load(IDENTITY)).map((r) => r.id)).toEqual(["n-bad"]);
    expect(await reread.load(LEGACY_KEY), "the legacy key still answers — it was copied, not moved").toEqual(
      [],
    );
  });

  it("IDEMPOTENT ON THE FILE — the second migration writes ZERO bytes and leaves them identical", async () => {
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: threePathLegacyFile() });
    const store = new SeedRefusalStore(storeIO, { logger: createRecordingLogger() });

    await store.load(LEGACY_KEY);
    store.migrate(LEGACY_KEY, IDENTITY);
    await store.idle();
    const afterFirst = storeIO.text() as string;
    const writesAfterFirst = storeIO.written.length;
    expect(writesAfterFirst, "the first migration wrote nothing — nothing to be idempotent about").toBe(
      1,
    );

    store.migrate(LEGACY_KEY, IDENTITY);
    await store.idle();

    expect(storeIO.written.length, "the second migration wrote again").toBe(writesAfterFirst);
    expect(storeIO.text(), "the bytes changed on the second migration").toBe(afterFirst);
  });

  it("a QUARANTINED store migrates NOTHING and the unreadable bytes are left intact", async () => {
    const corrupt = "{ this is not json";
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: corrupt });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });

    await store.load(LEGACY_KEY);
    expect(store.isQuarantined(), "the fixture did not quarantine — this case is vacuous").toBe(true);

    store.migrate(LEGACY_KEY, IDENTITY);
    await store.idle();

    expect(storeIO.written, "a migration laundered a FAILED READ into the file").toEqual([]);
    expect(storeIO.text(), "the forensic bytes were destroyed").toBe(corrupt);
  });

  it("a same-key migration is a no-op, so the posix arm never rewrites the file for nothing", async () => {
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: threePathLegacyFile() });
    const store = new SeedRefusalStore(storeIO, {});
    await store.load(LEGACY_KEY);
    store.migrate(LEGACY_KEY, LEGACY_KEY);
    await store.idle();
    expect(storeIO.written).toEqual([]);
  });

  it("a migration onto an OCCUPIED identity key keeps the CURRENT entry and drops the legacy one", async () => {
    // Both vocabularies named the same document. The current key is
    // authoritative — the legacy entry is the older statement of the same fact.
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: legacyStoreFile({
        [LEGACY_KEY]: legacyEntry("n-stale"),
        [IDENTITY]: legacyEntry("n-current"),
      }),
    });
    const store = new SeedRefusalStore(storeIO, {});
    await store.load(IDENTITY);
    store.migrate(LEGACY_KEY, IDENTITY);
    await store.idle();

    const parsed = JSON.parse(storeIO.text() as string) as { paths: Record<string, unknown> };
    expect(Object.keys(parsed.paths)).toEqual([IDENTITY]);
    expect(parsed.paths[IDENTITY], "the stale legacy entry overwrote the current one").toEqual(
      legacyEntry("n-current"),
    );
  });
});
