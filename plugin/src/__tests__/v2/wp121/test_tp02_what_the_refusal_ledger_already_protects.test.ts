// WP121 A6 — ESTABLISH, DO NOT ASSUME, what the refusal ledger already protects.
//
// The charter carries this as an open question and Worker 2 deliberately refused
// to assert it either way. It is settled here BY MEASUREMENT against unmodified
// product code, before any WP121 change: the answer decides whether the new
// predicate has to exclude refused ids (or it emits a spurious conflict copy on
// every cold open of every board that ever refused a record).
//
// ORACLE: parsed record ids, never bytes (`S174`).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import { SeedRefusalLedger } from "../../../files/canvas-sync";
import type { SeedRefusal } from "../../../files/canvas-sync";
import type { DurableSeedRefusals } from "../../../files/seed-refusal-store";
import {
  NODE,
  authorSpelling,
  conflictCopiesIn,
  createIO,
  preservationOver,
  recordIdsIn,
  seedDoc,
} from "./harness";

const PATH = "share/board.canvas";
const GUID = "guid-board-1";

/** A store double that IS a map — the real store's degrade paths are WP90's. */
function storeHolding(entries: Record<string, readonly SeedRefusal[]>): DurableSeedRefusals & {
  saved: Map<string, readonly SeedRefusal[]>;
} {
  const saved = new Map<string, readonly SeedRefusal[]>(Object.entries(entries));
  return {
    saved,
    load: async (key: string) => saved.get(key) ?? [],
    save: (key: string, refusals: readonly SeedRefusal[]) => {
      saved.set(key, refusals);
    },
  };
}

const REFUSAL_FOR = (id: string): SeedRefusal => ({
  boundary: "cold-open-seed",
  kind: "node",
  id,
  reason: "MISSING_TYPE",
});

describe("WP121 A6 — the standing refusal and the doc-wins flush", () => {
  it("MEASURED: a standing durable refusal withholds the ENTIRE doc-wins flush", async () => {
    // Session N refused `n-bad` (a typeless card the user hand-wrote). Session
    // N+1 opens the board with a non-empty doc, so `coldOpen` takes doc-wins.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 300, y: 0, text: "the user's" }]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      durableRefusals: storeHolding({ [GUID]: [REFUSAL_FOR("n-bad")] }),
      refusalIdentity: GUID,
    });

    expect(coldOpen).toBe("doc-wins");
    // The answer: the file is UNTOUCHED. `writeIsWithheld` returns before the
    // serializer, so the whole projection is withheld — not the refused record
    // alone. `n-bad` survives, and so does every other record in the file.
    expect(persistence.isWriteWithheld()).toBe(true);
    expect(io.write).not.toHaveBeenCalled();
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-bad", "n-shared"]);

    persistence.destroy();
  });

  it("POSITIVE CONTROL: the SAME fixture with no standing refusal loses the card", async () => {
    // Without this row the one above would be scoring "a cold open leaves files
    // alone", which is false — this is the same fixture, same branch, and the
    // ONLY difference is the empty store.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 300, y: 0, text: "the user's" }]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      durableRefusals: storeHolding({}),
      refusalIdentity: GUID,
    });

    expect(coldOpen).toBe("doc-wins");
    expect(persistence.isWriteWithheld()).toBe(false);
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared"]);

    persistence.destroy();
  });

  it("MEASURED: the protection is WHOLE-FILE, so it also spares an unrelated file-only card", async () => {
    // The scope of the existing protection, stated as a measurement rather than
    // as a reading of the code: a single standing refusal suspends the write for
    // the WHOLE path, so `n-other` — a record nothing ever refused and the exact
    // subject of WP121 — is spared too, incidentally.
    //
    // This is why A6 had to be settled before the predicate was written: on a
    // path with a standing refusal the doc-wins flush does not happen at all, so
    // there is nothing for a conflict copy to preserve and firing one there
    // would be pure noise.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 1, y: 1 }, NODE("n-other")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      durableRefusals: storeHolding({ [GUID]: [REFUSAL_FOR("n-bad")] }),
      refusalIdentity: GUID,
    });

    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-bad", "n-other", "n-shared"]);
    persistence.destroy();
  });

  it("CONSEQUENCE: a withheld path emits NO conflict copy — there is nothing to preserve against", async () => {
    // The row A6 exists to produce. Because the withhold suspends the WHOLE
    // flush, the file is not overwritten, so a conflict copy here would preserve
    // a file nothing threatened — noise beside every board that ever refused a
    // record, which is exactly the "trains the user to ignore the folder"
    // failure A2's silent direction is built to avoid.
    //
    // It also settles the charter's A6 worry the other way: the predicate does
    // NOT need to exclude refused ids, because a standing refusal means the
    // predicate is never reached. Excluding them would be a second, redundant
    // rule that could drift from the first.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 1, y: 1 }, NODE("n-other")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      durableRefusals: storeHolding({ [GUID]: [REFUSAL_FOR("n-bad")] }),
      refusalIdentity: GUID,
      preserveDiscarded: preservationOver(io, { sharedFolder: "share" }),
    });

    expect(conflictCopiesIn(io, "share (conflicts)")).toEqual([]);
    // ...and the file is still intact, which is what made the copy unnecessary.
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-bad", "n-other", "n-shared"]);
    persistence.destroy();
  });

  it("POSITIVE CONTROL: the SAME wiring without the standing refusal DOES copy", async () => {
    // Without this row the one above would be scoring "the door was never
    // wired". Identical call, empty store.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 1, y: 1 }, NODE("n-other")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      durableRefusals: storeHolding({}),
      refusalIdentity: GUID,
      preserveDiscarded: preservationOver(io, { sharedFolder: "share" }),
    });

    expect(conflictCopiesIn(io, "share (conflicts)")).toHaveLength(1);
    persistence.destroy();
  });

  it("MEASURED: with NO durable store the protection does not exist at all", async () => {
    // The boundary of the answer, and the reason "yes, refused records are
    // protected" would have been an over-claim. WP90's store is what carries a
    // refusal across the restart; a caller that wires none arrives at session
    // N+1 with an empty in-memory ledger, and the doc-wins flush proceeds.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared"), { id: "n-bad", x: 1, y: 1 }]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      seedRefusals: new SeedRefusalLedger(),
      // no durableRefusals, no refusalIdentity — WP63's session-scoped ledger
    });

    expect(persistence.isWriteWithheld()).toBe(false);
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared"]);
    persistence.destroy();
  });
});
