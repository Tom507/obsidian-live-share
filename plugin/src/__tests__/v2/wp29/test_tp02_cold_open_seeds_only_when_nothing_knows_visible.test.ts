// WP29 / AC1 at the COLD-OPEN boundary — "in every other case the client
// loads/merges instead of seeding."
//
// tp01 pins the decision; this pins that `coldOpen` OBEYS it. The two are
// deliberately separate: a `decideSeed` that is perfectly correct and is never
// consulted satisfies tp01 in full and changes nothing about the product.
//
// THE SCENARIO IS THE ONE THAT MATTERS, and it is not the obvious one. When the
// doc arrives NON-EMPTY the pre-WP29 emptiness test already refuses to seed, so
// nothing about that case can discriminate. The discriminating case — and the
// R4-resurrection case in the field — is a doc that is EMPTY *and known*:
//
//   ├── a peer holds this board and its cards are all deleted, or it has only
//   │   just been stamped with `meta` and carries no records yet, or
//   └── this client's own sidecar replays to an empty board because the user
//       cleared it last session.
//
// In both, the doc is empty, the local `.canvas` file still holds last week's
// cards, and the pre-WP29 `coldOpen` reads "doc empty" as "nobody has ever seen
// this board" and pushes those cards back into a board every replica had
// already emptied. That is R4, wearing `coldOpen`'s clothes rather than the host
// seed's.
//
// WHAT IS ASSERTED ON THE NON-SEEDING ROWS is deliberately stronger than the
// return value: the file is NEVER READ (no file->CRDT input at all), NO write is
// issued (an "empty doc wins" implementation would flush an empty canvas over
// the user's file, which is a second, worse data-loss class), and the doc sees
// ZERO transactions.
//
// PRODUCTION LINE <-> ASSERTION: the WP29 guard in `CanvasPersistence.coldOpen`
// (`canvas-persistence.ts`), sitting AFTER the `docNonEmpty` branch and BEFORE
// `io.exists`. Removing it reddens all three non-seeding rows; moving it ahead
// of the `docNonEmpty` branch reddens the precedence test at the end.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { SEED_DECISION, decideSeed } from "../../../files/canvas-seed-decision";
import {
  CANVAS_PATH,
  canvasJson,
  countTransactions,
  createManualScheduler,
  createPersistenceIO,
  createTrace,
  surviving,
  textNode,
} from "./harness";

const FILE = canvasJson([textNode("f-1", 0, "last week"), textNode("f-2", 300, "also stale")]);

function makePersistence(fileContent: string | null) {
  const files = new Map<string, string>();
  if (fileContent !== null) files.set(CANVAS_PATH, fileContent);
  const trace = createTrace();
  const io = createPersistenceIO(files, trace);
  const doc = new Y.Doc();
  return { files, trace, io, doc };
}

const ROWS: { sidecarKnowsDoc: boolean; peerKnowsDoc: boolean; label: string }[] = [
  { sidecarKnowsDoc: true, peerKnowsDoc: false, label: "the sidecar knows it" },
  { sidecarKnowsDoc: false, peerKnowsDoc: true, label: "a peer knows it" },
  { sidecarKnowsDoc: true, peerKnowsDoc: true, label: "both know it" },
];

describe("WP29 AC1 — coldOpen seeds from file only when nothing knows the doc", () => {
  it("nothing knows the doc: the file is read once and seeds it", () => {
    // The control row. Without it every assertion below is satisfied by a
    // `coldOpen` that never seeds at all.
    const { doc, io } = makePersistence(FILE);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });

    return persistence.coldOpen().then((result) => {
      expect(result).toBe("seeded-from-file");
      expect(io.reads, "the only file->CRDT read did not happen").toEqual([CANVAS_PATH]);
      expect(surviving(doc).nodes.sort()).toEqual(["f-1", "f-2"]);
      persistence.destroy();
    });
  });

  for (const row of ROWS) {
    it(`${row.label}: an EMPTY doc is not re-seeded from the stale file`, async () => {
      const { doc, io, files } = makePersistence(FILE);
      const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
        scheduler: createManualScheduler(),
        seedKnowledge: { sidecarKnowsDoc: row.sidecarKnowsDoc, peerKnowsDoc: row.peerKnowsDoc },
      });

      let result: string | undefined;
      const transactions = await countTransactions(doc, async () => {
        result = await persistence.coldOpen();
      });

      // AC4: no fourth outcome was invented for this branch.
      expect(["seeded-from-file", "doc-wins", "empty"]).toContain(result);
      expect(
        result,
        "a doc somebody already knows was seeded from this client's local file (R4)",
      ).toBe("empty");
      expect(io.reads, "the stale file was read as CRDT input on a known doc").toEqual([]);
      expect(io.writes, "an empty board was flushed over the user's file").toEqual([]);
      expect(surviving(doc).nodes, "records from the stale file reached a known doc").toEqual([]);
      expect(transactions, "coldOpen wrote to a doc it must not have touched").toBe(0);
      // The file on disk is untouched, byte for byte.
      expect(files.get(CANVAS_PATH)).toBe(FILE);

      persistence.destroy();
    });
  }

  it("the outcome tracks `decideSeed` on every row, not just on the one that seeds", async () => {
    // Ties the boundary to the decision explicitly: the same four knowledge
    // shapes are pushed through both, and the answers must agree. An
    // implementation that re-derives the condition inline instead of consulting
    // the core can still pass this — which is why it is stated as an agreement
    // rather than as a spy — but it cannot pass it while checking only one of
    // the two conditions.
    for (const sidecarKnowsDoc of [false, true]) {
      for (const peerKnowsDoc of [false, true]) {
        const { doc, io } = makePersistence(FILE);
        const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
          scheduler: createManualScheduler(),
          seedKnowledge: { sidecarKnowsDoc, peerKnowsDoc },
        });
        const result = await persistence.coldOpen();
        const decision = decideSeed({ sidecarKnowsDoc, peerKnowsDoc });
        expect(
          result === "seeded-from-file",
          `coldOpen disagreed with decideSeed for sidecar=${sidecarKnowsDoc} peer=${peerKnowsDoc}`,
        ).toBe(decision === SEED_DECISION.SEED_FROM_FILE);
        persistence.destroy();
      }
    }
  });

  it("the doc-wins branch still comes FIRST — a known, NON-empty doc still overwrites the stale file", async () => {
    // Precedence, and it is load-bearing in the other direction: WP25's
    // returning client resumes its sidecar replica, arrives with a NON-empty
    // doc, and must still see its stale local file overwritten from the doc. If
    // WP29's guard were placed ahead of the emptiness test, that client would
    // get "empty" and keep a stale file forever.
    const { doc, io, files } = makePersistence(FILE);
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("d-1", record);
      for (const [k, v] of Object.entries(textNode("d-1", 0, "from the doc"))) record.set(k, v);
    });

    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    });
    const result = await persistence.coldOpen();

    expect(result).toBe("doc-wins");
    expect(io.reads, "the doc-wins branch read the file").toEqual([]);
    expect(files.get(CANVAS_PATH)).toContain("d-1");
    expect(files.get(CANVAS_PATH), "the stale record came back from the file").not.toContain("f-1");

    persistence.destroy();
  });

  it("omitting `seedKnowledge` keeps the pre-WP29 behaviour exactly", async () => {
    // Every caller that predates WP29 — and every pre-existing test — supplies
    // no knowledge. The default must therefore be NOTHING_KNOWS_DOC, so an
    // un-wired call site behaves as it always did rather than silently
    // refusing to seed a genuinely new board.
    const { doc, io } = makePersistence(FILE);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
    });
    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    expect(surviving(doc).nodes.sort()).toEqual(["f-1", "f-2"]);
    persistence.destroy();
  });

  it("a known doc with NO file on disk is still `empty`, and still reads nothing", async () => {
    const { doc, io } = makePersistence(null);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: false },
    });
    expect(await persistence.coldOpen()).toBe("empty");
    expect(io.reads).toEqual([]);
    persistence.destroy();
  });
});
