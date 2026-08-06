// WP90 / AC4 + AC5 — THE HOST ARM, IN BOTH DIRECTIONS.
//
// Today the host is only ACCIDENTALLY safe. On a restart a host runs
// `CanvasSync.subscribe`'s `role === "host"` arm, which re-reads the file,
// re-seeds, and re-derives the same refusal — so the ledger happens to be
// non-empty by the time the writer attaches, and the `doc-wins` flush happens to
// be withheld. Nothing pins that; it exists to seed a doc, not to protect a
// file, and the relay's host election is a coin flip. A guest gets a fresh empty
// ledger and writes.
//
// A durable withhold has to close the guest arm WITHOUT breaking the host arm,
// and the two failure modes are opposite:
//
//   ├── CASE 1 — the host seed produced a verdict BEFORE the store's sink
//   │   existed (it runs during `subscribe`, before `CanvasPersistence` is even
//   │   constructed). If that verdict is never adopted, the host's refusal never
//   │   becomes durable and the NEXT session — as a guest — destroys the record.
//   │   That is AC4: the accident is replaced by a mechanism.
//   └── CASE 2 — the user DELETED the offending card between sessions. The host
//       seed re-derives "nothing is refused" from the file it just read. If the
//       STORED verdict were restored over that, the withhold would resurrect for
//       a record the file no longer even proposes — and it could never lift,
//       because `isSeedRefusalResolved` answers `false` forever on a record that
//       is absent. A PERMANENT withhold, earned by fixing the problem. That is
//       WP63 `test_tp03`'s rule — a stale verdict never outlives its file —
//       carried across the restart instead of being abandoned at it, and it is
//       the exit WP63 recorded as a residual it could not resolve.
//
// AC4's other half, "a `doc-wins` cold open with NO seed of any kind still
// withholds", is `test_tp01` — that whole file is the guest arm.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ────────────────────────────────────────────
// BREAK A (case 1). Delete the `if (reseeded) { store.save(…) }` adoption at the
//   end of `CanvasPersistence.hydrateDurableRefusals`. The host's refusal never
//   reaches the store and session 2 deletes the record. VERIFIED RED, restored.
// BREAK B (both cases). Pin `reseeded` to `false` in the same method — always
//   restore, never discriminate. Case 2 goes red on "a stale stored verdict
//   outlived the file it was derived from"; case 1 goes red too, because the
//   adoption is on the same branch. VERIFIED RED, then restored.
// A NOTE ON WHY CASE 2 REMOVES RATHER THAN REPAIRS, because the first draft of
//   this file repaired and was NOT falsifiable by BREAK B: a repaired record is
//   in the doc and VALID, so the restored refusal is pruned by the lift on the
//   very next write and the case goes green either way. It would have been a
//   test that cannot fail. Removing the record is the state the lift provably
//   cannot rescue, so it is the only state that measures the discriminator.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  createSyncManager,
  createVault,
  docAsTheRelayWouldHandItBack,
  ioOverVault,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

/** A real `CanvasSync` host seed over a fake vault — the production wiring. */
function hostSeed(fileContent: string) {
  const vault = createVault({ [DISK]: fileContent });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  return { vault, syncManager, cs };
}

describe("WP90 AC4/AC5 — the host arm stops being an accident, and a seed still re-derives", () => {
  it("CASE 1 — a HOST refusal signed before the sink existed still becomes durable", async () => {
    const storeIO = createStoreIO();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);

    // ── SESSION 1, as a HOST ────────────────────────────────────────────────
    // `subscribe` runs producer A, which fills the ledger. The store's sink does
    // not exist yet and cannot: `CanvasPersistence` is constructed afterwards.
    const { vault, syncManager, cs } = hostSeed(before);
    await cs.subscribe(DISK, "host");
    const doc1 = syncManager.getDoc(`__canvas__:${DISK}`).doc;
    expect(
      doc1.getMap<Y.Map<unknown>>("nodes").has("n-ok"),
      "the host seed never ran — this row is vacuous",
    ).toBe(true);
    expect(
      cs.seedRefusalLedger(DISK).hasRefusals(),
      "the host seed refused nothing — there is no withhold to make durable",
    ).toBe(true);

    const store1 = new SeedRefusalStore(storeIO, {});
    const p1 = new CanvasPersistence(doc1, ioOverVault(vault), DISK, {
      seedRefusals: cs.seedRefusalLedger(DISK),
      durableRefusals: store1,
    });
    expect(await p1.coldOpen(), "not the doc-wins branch").toBe("doc-wins");
    await store1.idle();

    expect(vault.files.get(DISK), "session 1 lost it — that is WP63, not WP90").toBe(before);
    expect(
      storeIO.text() ?? "",
      "the HOST's verdict never reached the store — the accident is still the only protection",
    ).toContain("n-bad");
    p1.destroy();

    // ── SESSION 2, as a GUEST — no seed of any kind runs ─────────────────────
    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [DISK]: vault.files.get(DISK) as string });
    const store2 = new SeedRefusalStore(storeIO, {});
    const p2 = new CanvasPersistence(doc2, io2, DISK, { durableRefusals: store2 });

    expect(await p2.coldOpen()).toBe("doc-wins");
    expect(io2.files.get(DISK), "the guest arm destroyed the host's protected record").toBe(before);
    expect(nodeIdsIn(io2.files.get(DISK) as string)).toContain("n-bad");
    expect(io2.write).not.toHaveBeenCalled();

    p2.destroy();
    doc1.destroy();
    doc2.destroy();
  });

  it("CASE 2 — the user REMOVES the record; a re-seed retracts the stored verdict, so the withhold cannot become permanent", async () => {
    const storeIO = createStoreIO();

    // ── SESSION 1 — the refusal is recorded ─────────────────────────────────
    {
      const doc = new Y.Doc();
      const io = createIO({ [DISK]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
      const store = new SeedRefusalStore(storeIO, {});
      const p = new CanvasPersistence(doc, io, DISK, { durableRefusals: store });
      expect(await p.coldOpen()).toBe("seeded-from-file");
      await p.flush();
      await store.idle();
      expect(storeIO.text() ?? "", "session 1 recorded nothing").toContain("n-bad");
      p.destroy();
      doc.destroy();
    }

    // ── BETWEEN SESSIONS — the user DELETES the offending card ──────────────
    //
    // This is the exit WP63 could not resolve and recorded as a residual: the
    // record is gone from the file, so no seed will ever propose it again and no
    // delta will ever make it valid — `isSeedRefusalResolved` answers `false`
    // FOREVER, because absence is exactly the state the refusal describes. Under
    // a per-session withhold that only cost the rest of one session. Under a
    // DURABLE one it would be permanent, which is precisely "the repair is worse
    // than the defect". The re-seed's retraction is what closes it.
    //
    // (The other repair — fixing the record instead of deleting it — is closed
    // twice over: the re-seed retracts here, AND the lift fires on the next
    // write because the doc now holds a valid `n-bad`. That is `test_tp03`.)
    const cleaned = canvasJson([VALID_NODE]);

    // ── SESSION 2, as a HOST over the cleaned file ─────────────────────────
    const { vault, syncManager, cs } = hostSeed(cleaned);
    await cs.subscribe(DISK, "host");
    const doc2 = syncManager.getDoc(`__canvas__:${DISK}`).doc;
    expect(
      doc2.getMap<Y.Map<unknown>>("nodes").has("n-bad"),
      "the record is still in the doc — then this is the LIFT's case, not the re-seed's",
    ).toBe(false);
    expect(
      cs.seedRefusalLedger(DISK).hasRefusals(),
      "the host seed still refuses something — the fixture did not remove anything",
    ).toBe(false);

    const log = createRecordingLogger();
    const store2 = new SeedRefusalStore(storeIO, { logger: log });
    const io2 = ioOverVault(vault);
    const p2 = new CanvasPersistence(doc2, io2, DISK, {
      logger: log,
      seedRefusals: cs.seedRefusalLedger(DISK),
      durableRefusals: store2,
    });

    expect(await p2.coldOpen()).toBe("doc-wins");
    await store2.idle();

    expect(
      p2.seedRefusals(),
      "a stale stored verdict outlived the file it was derived from",
    ).toEqual([]);
    expect(
      p2.isWriteWithheld(),
      "the withhold became PERMANENT — the user removed the record and the canvas " +
        "will never persist their edits again",
    ).toBe(false);
    // The doc-wins flush went through, over a file that no longer proposes the
    // refused record. Nothing of the user's is lost by writing it.
    expect(nodeIdsIn(vault.files.get(DISK) as string)).toEqual(["n-ok"]);
    expect(
      io2.write,
      "no write was attempted at all — the file 'survived' vacuously",
    ).toHaveBeenCalled();
    // And the store no longer claims a refusal for this path.
    expect(
      storeIO.text() ?? "",
      "the store kept a refusal the re-seed had already retracted",
    ).not.toContain("n-bad");

    p2.destroy();
    doc2.destroy();
  });
});
