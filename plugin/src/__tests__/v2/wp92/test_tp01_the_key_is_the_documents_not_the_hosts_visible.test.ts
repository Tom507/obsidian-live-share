// WP92 / C92 AC1 — THE STORE'S KEY IS A PROPERTY OF THE DOCUMENT.
//
// ⚠ READ BEFORE CHANGING ANYTHING HERE: S63's STATED REPRODUCTION IS FALSIFIED
// and no assertion in this file is written against it. `toLocalPath(
// toCanonicalPath(x))` is the IDENTITY for every name Windows can hold — the
// mismatch needs a raw ASCII `? * < > " | :` in the on-disk filename, which is
// exactly the class NTFS refuses. A test that asserted "a Windows key and a
// macOS key differ and the fix makes them agree" over a name Windows CAN hold
// would be green before and after the fix, on both arms, forever. That is this
// run's dominant defect class and the register handed one out.
//
// So the two platform arms below use the two names from the FALSIFIED table's
// MISMATCHING rows (`Q3:plan.canvas`, `meeting|notes.canvas`) — the only inputs
// where the old key actually differed — and the REACHABLE arm is the rename,
// which has no platform in it at all.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// Revert `hydrateDurableRefusals` to key by `this.diskPath` (three sites). The
// structural census reports two write-key expressions instead of one and names
// `this.diskPath`; the rename case finds no withhold under the new name and the
// projection lands on the user's file; the two-platform case disagrees again.
// VERIFIED RED on each named assertion, then restored.

import { Platform } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import { toCanonicalPath, toLocalPath } from "../../../utils";
import { PRE_REPAIR_HYDRATE, deriveStoreKeyCensus, readProductionSources } from "./census";
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

/** The two names from §3.2's MISMATCHING rows — the only inputs that ever differed. */
const ASCII_COLON = "Q3:plan.canvas";
const ASCII_PIPE = "meeting|notes.canvas";

/**
 * AC1(c): the platform arm is produced by FIXTURING `Platform.isWin` and letting
 * the REAL `toLocalPath` run — never by stubbing `toLocalPath`, which would test
 * the stub. `utils.test.ts` already fixtures the same flag the same way.
 */
function diskPathOn(host: "win" | "posix", name: string): string {
  const saved = Platform.isWin;
  try {
    (Platform as { isWin: boolean }).isWin = host === "win";
    // Exactly `main.ts`'s composition: `toLocalPath(toCanonicalPath(raw))`.
    return toLocalPath(toCanonicalPath(name));
  } finally {
    (Platform as { isWin: boolean }).isWin = saved;
  }
}

describe("WP92 AC1 — the key is the document's, derived and driven", () => {
  afterEach(() => {
    (Platform as { isWin: boolean }).isWin = false;
  });

  it("STRUCTURAL: exactly one expression reaches the store's write key, and it is not toLocalPath", () => {
    const census = deriveStoreKeyCensus();

    // Reachability first. A census that found no seam and no site would report
    // "one key expression" perfectly, on nothing.
    expect(census.seamNames.length, "the census bound no seam names — it went blind").toBeGreaterThan(
      0,
    );
    expect(census.sites.length, "the census found no store call sites at all").toBeGreaterThan(0);
    expect(
      census.excludedFiles.some((f) => f.startsWith("testing/")),
      "the E2E rig was not excluded — the census is counting the rig, not the product",
    ).toBe(true);

    // AC1's criterion: the SINK/SAVE key is a singleton.
    expect(census.writeKeys, "more than one expression is written under").toEqual(["key"]);

    // And no site anywhere hands the store a host-dependent spelling.
    for (const site of census.sites) {
      expect(
        site.key,
        `${site.file}:${site.line} passes a host-dependent key to .${site.method}`,
      ).not.toMatch(/toLocalPath|toCanonicalPath/);
    }
    // `this.diskPath` survives as the LEGACY READ only — AC2's migration probe —
    // and never as a write key. Pinned in both directions so a future edit that
    // re-broadened it reddens here.
    expect(census.readKeys, "the legacy read probe changed shape").toEqual(["key", "legacyKey"]);
    expect(
      census.sites.filter((s) => s.key === "this.diskPath"),
      "diskPath still reaches the store as a key",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL (half A) — the same deriver FINDS this.diskPath on the pre-repair source", () => {
    const found = deriveStoreKeyCensus(
      new Map([["files/canvas-persistence.ts", PRE_REPAIR_HYDRATE]]),
    );
    expect(
      found.sites.length,
      "the deriver cannot see WP90's own call sites — a green on the real tree means nothing",
    ).toBe(3);
    expect(found.writeKeys, "the deriver missed the platform-dependent write key").toEqual([
      "this.diskPath",
    ]);
    expect(found.readKeys).toEqual(["this.diskPath"]);
  });

  it("POSITIVE CONTROL (half B) — an empty input set THROWS instead of reporting a clean census", () => {
    expect(() => deriveStoreKeyCensus(new Map())).toThrow(/empty input set/);
  });

  it("MEASURED, and it agrees with the charter: toLocalPath(toCanonicalPath(x)) is the identity for real names", () => {
    // My own probe of §3.2, run here rather than quoted, because the charter
    // asked the implementor to say whether it agrees. It does, exactly.
    for (const name of ["plain.canvas", "Q3：plan.canvas", "meeting｜notes.canvas"]) {
      expect(diskPathOn("win", name), `${name} does not round-trip on Windows`).toBe(name);
      expect(diskPathOn("posix", name), `${name} does not round-trip on posix`).toBe(name);
    }
    // And the ONLY two that differ are the two whose on-disk form NTFS refuses.
    for (const name of [ASCII_COLON, ASCII_PIPE]) {
      expect(diskPathOn("win", name), `${name} unexpectedly round-tripped`).not.toBe(
        diskPathOn("posix", name),
      );
    }
    // §3.4 / S76, measured here and NOT repaired here: the canonical form is not
    // platform-stable, and on Windows two distinct files collapse onto one.
    expect(
      diskPathOn("win", "Q3：plan.canvas"),
      "the fullwidth name is no longer stable — re-measure S76 before quoting it",
    ).toBe("Q3：plan.canvas");
    const savedWin = Platform.isWin;
    (Platform as { isWin: boolean }).isWin = true;
    expect(
      toCanonicalPath("Q3：plan.canvas"),
      "S76's aliasing changed shape — the register's row needs re-measuring",
    ).toBe(toCanonicalPath("Q3:plan.canvas"));
    (Platform as { isWin: boolean }).isWin = savedWin;
  });

  it("BEHAVIOURAL: two instances over the SAME document identity hydrate the SAME set from the SAME bytes", async () => {
    // The two arms are the two host spellings of ONE document — a Windows build
    // and a macOS build of the same vault, reproduced by handing the two
    // instances the two `diskPath` spellings that host would produce. The
    // identity is the same because it is the DOCUMENT's.
    const identity = "guid-9f2c";
    const storeIO = createStoreIO();
    const log = createRecordingLogger();

    for (const name of [ASCII_COLON, ASCII_PIPE]) {
      const winDisk = diskPathOn("win", name);
      const macDisk = diskPathOn("posix", name);
      expect(winDisk, `${name} is not a mismatching row — this arm would be vacuous`).not.toBe(
        macDisk,
      );

      // Session 1, on the "Windows" spelling: refuse, and record.
      const doc1 = new Y.Doc();
      const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
      const io1 = createIO({ [winDisk]: before });
      const store1 = new SeedRefusalStore(storeIO, { logger: log });
      const p1 = new CanvasPersistence(doc1, io1, winDisk, {
        logger: log,
        durableRefusals: store1,
        refusalIdentity: identity,
      });
      expect(await p1.coldOpen()).toBe("seeded-from-file");
      await p1.flush();
      await store1.idle();
      expect(storeIO.text(), "session 1 recorded nothing").toContain("n-bad");
      p1.destroy();

      // Session 2, on the "macOS" spelling of the SAME document, over the SAME
      // sidecar bytes. Under WP90's key this found nothing.
      const doc2 = docAsTheRelayWouldHandItBack(doc1);
      const io2 = createIO({ [macDisk]: before });
      const p2 = new CanvasPersistence(doc2, io2, macDisk, {
        logger: log,
        durableRefusals: new SeedRefusalStore(storeIO, { logger: log }),
        refusalIdentity: identity,
      });
      expect(doc2.getMap<Y.Map<unknown>>("nodes").size, "the doc arrived empty").toBeGreaterThan(0);
      expect(await p2.coldOpen(), "this is not the doc-wins branch").toBe("doc-wins");
      expect(
        p2.seedRefusals().map((r) => r.id),
        `${name}: the other host's build did not find the standing withhold`,
      ).toEqual(["n-bad"]);

      p2.destroy();
      doc1.destroy();
      doc2.destroy();
      storeIO.bytes.clear();
      storeIO.written.length = 0;
    }
  });

  it("I11, THE SECOND ARM: with a standing withhold the doc-wins branch writes NOTHING", async () => {
    const identity = "guid-i11";
    const storeIO = createStoreIO();
    const log = createRecordingLogger();
    const disk = diskPathOn("win", ASCII_COLON);

    const doc1 = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io1 = createIO({ [disk]: before });
    const store1 = new SeedRefusalStore(storeIO, { logger: log });
    const p1 = new CanvasPersistence(doc1, io1, disk, {
      logger: log,
      durableRefusals: store1,
      refusalIdentity: identity,
    });
    expect(await p1.coldOpen()).toBe("seeded-from-file");
    await p1.flush();
    await store1.idle();
    p1.destroy();

    // The other host's spelling, same document.
    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [ASCII_COLON]: before });
    const p2 = new CanvasPersistence(doc2, io2, ASCII_COLON, {
      logger: log,
      durableRefusals: new SeedRefusalStore(storeIO, { logger: log }),
      refusalIdentity: identity,
    });

    // AC1(d): FOUR unrelated early returns can produce "no write". Each is
    // asserted PASSING before the "no write" assertion is allowed to mean
    // anything — the doc is non-empty, the branch is doc-wins, and the withhold
    // is the reason.
    expect(doc2.getMap<Y.Map<unknown>>("nodes").size, "the doc is empty").toBeGreaterThan(0);
    expect(await p2.coldOpen(), "not the doc-wins branch").toBe("doc-wins");
    expect(p2.isWriteWithheld(), "nothing is being withheld — 'no write' means nothing").toBe(true);
    expect(io2.write, "a write reached the disk while a withhold stood").not.toHaveBeenCalled();
    expect(nodeIdsIn(io2.files.get(ASCII_COLON) as string)).toContain("n-bad");
    expect(io2.files.get(ASCII_COLON), "the user's file changed").toBe(before);

    p2.destroy();
    doc1.destroy();
    doc2.destroy();
  });

  it("PRODUCTION never omits the identity — the compatibility default is unreachable by the product", () => {
    const main = readProductionSources().get("main.ts");
    expect(main, "main.ts was not read").toBeDefined();
    // One construction site, and it supplies the key. The default exists only so
    // WP90's own six test files keep passing byte-unmodified.
    expect(
      (main as string).includes("refusalIdentity:"),
      "the one production attach site stopped supplying a document identity",
    ).toBe(true);
    expect(
      (main as string).includes("durableRefusals: seedRefusalStore"),
      "the store injection moved — re-verify that its identity moved with it",
    ).toBe(true);
  });

  it("I5 DEGRADE: an explicit null identity uses the store for NOTHING, and says so", async () => {
    const storeIO = createStoreIO();
    const log = createRecordingLogger();
    const doc = new Y.Doc();
    const io = createIO({ "x.canvas": canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const store = new SeedRefusalStore(storeIO, { logger: log });
    const p = new CanvasPersistence(doc, io, "x.canvas", {
      logger: log,
      durableRefusals: store,
      refusalIdentity: null,
    });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await store.idle();

    // Degraded to exactly WP63: the withhold still stands IN MEMORY for this
    // session — never a silent full-trust "no refusals" — and the store was not
    // written under the path key, which is the fallback this WP refuses.
    expect(p.seedRefusals().map((r) => r.id), "the in-session withhold was lost too").toEqual([
      "n-bad",
    ]);
    expect(storeIO.written, "the path key was used as a fallback after all").toEqual([]);
    expect(
      log.lines.some((l) => l.includes("no stable document identity")),
      "the degradation was silent",
    ).toBe(true);

    p.destroy();
    doc.destroy();
  });
});
