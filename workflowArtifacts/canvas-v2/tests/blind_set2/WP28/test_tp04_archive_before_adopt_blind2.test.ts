// WP28 / AC2 blind2 — the ordering claim, attacked from INSIDE the write
// channel: the archive writer reads the live doc while it is being written.
//
// Different angle. Neither an event tape nor a transaction counter is used here.
// The `writeConflictCopy` double answers one question at the moment it is
// called: *does the document I am archiving still contain the work I am supposed
// to be preserving?* It reads the subject doc directly, and it compares what it
// finds against the content it was handed.
//
// That makes the assertion immune to every reordering of instrumentation. An
// adopt-then-archive implementation produces a doc that already holds the
// winner's ids at write time, and a content string that matches the doc — which
// is exactly the shape of the failure: internally consistent, externally
// correct-looking, and empty of the only thing that mattered.
//
// The second half pins the failure semantics one step further along than blind1:
// a `notify` that throws must not leave the board adopted-but-unannounced or
// half-replaced.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "research/threads.canvas";
const LOSER_MARK = "hand-drawn dependency map";
const WINNER_MARK = "regenerated from the export";

function make(epoch: number, cards: Record<string, string>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [id, text] of Object.entries(cards)) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("text", text);
    }
  });
  return doc;
}

function texts(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").values()]
    .map((record) => String(record.get("text")))
    .sort();
}

function serialise(doc: Y.Doc): string {
  return JSON.stringify(texts(doc));
}

interface Observation {
  contentHanded: string;
  docTextsAtWriteTime: string[];
  docEpochAtWriteTime: unknown;
}

function inspectingEnv(subject: Y.Doc, opts: { notifyThrows?: boolean } = {}) {
  const observations: Observation[] = [];
  let notified = 0;
  return {
    observations,
    notifiedCount: () => notified,
    env: {
      serializeDoc: (doc: Y.Doc) => serialise(doc),
      writeConflictCopy: async (_path: string, content: string) => {
        observations.push({
          contentHanded: content,
          docTextsAtWriteTime: texts(subject),
          docEpochAtWriteTime: subject.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY),
        });
      },
      notify: () => {
        notified += 1;
        if (opts.notifyThrows) throw new Error("Notice channel unavailable");
      },
      today: () => "2026-08-19",
      logger: { debug: () => {}, warn: () => {} },
    },
  };
}

describe("WP28 AC2 blind2 — the writer sees the loser's board, not the winner's", () => {
  it("at write time the doc still contains the loser's work", async () => {
    const loser = make(2, { a: LOSER_MARK, shared: "loser shared" });
    const winner = make(5, { z: WINNER_MARK, shared: "winner shared" });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(probe.observations).toHaveLength(1);
    const seen = probe.observations[0];
    expect(
      seen.docTextsAtWriteTime,
      "the doc had already been replaced when the archive was written, so the conflict " +
        "copy on disk is a copy of the WINNER and the loser's work is unrecoverable",
    ).toContain(LOSER_MARK);
    expect(seen.docTextsAtWriteTime).not.toContain(WINNER_MARK);
    expect(seen.docEpochAtWriteTime).toBe(2);
    loser.destroy();
    winner.destroy();
  });

  it("the content handed to the writer matches the doc it saw", async () => {
    const loser = make(2, { a: LOSER_MARK, shared: "loser shared" });
    const winner = make(5, { z: WINNER_MARK });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    const seen = probe.observations[0];
    expect(seen.contentHanded).toBe(JSON.stringify(seen.docTextsAtWriteTime));
    expect(seen.contentHanded).toContain(LOSER_MARK);
    expect(seen.contentHanded).not.toContain(WINNER_MARK);
    loser.destroy();
    winner.destroy();
  });

  it("after the call the doc IS the winner's — the adoption did happen", async () => {
    const loser = make(2, { a: LOSER_MARK });
    const winner = make(5, { z: WINNER_MARK });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(texts(loser)).toEqual([WINNER_MARK]);
    expect(probe.observations[0].docTextsAtWriteTime).toEqual([LOSER_MARK]);
    loser.destroy();
    winner.destroy();
  });

  it("a single-card loser is still archived before it is replaced", async () => {
    const loser = make(0, { only: LOSER_MARK });
    const winner = make(1, { only: WINNER_MARK });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(probe.observations[0].docTextsAtWriteTime).toEqual([LOSER_MARK]);
    expect(texts(loser)).toEqual([WINNER_MARK]);
    loser.destroy();
    winner.destroy();
  });

  it("a loser with NO records still writes an archive before adopting", async () => {
    const loser = make(1, {});
    const winner = make(4, { z: WINNER_MARK });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(
      probe.observations,
      "an empty loser was silently replaced with no archive — the emptiness may itself " +
        "be the state the user wanted preserved",
    ).toHaveLength(1);
    expect(probe.observations[0].docTextsAtWriteTime).toEqual([]);
    loser.destroy();
    winner.destroy();
  });

  it("a throwing NOTIFY does not leave the board half-replaced", async () => {
    const loser = make(2, { a: LOSER_MARK, b: "second card" });
    const winner = make(5, { z: WINNER_MARK });
    const probe = inspectingEnv(loser, { notifyThrows: true });

    const settled = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: probe.env,
    }).then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    expect(probe.notifiedCount()).toBe(1);
    const cards = texts(loser);
    expect(
      cards.length === 1 || cards.length === 2,
      `the board holds ${cards.length} cards after a failed notification — it is neither ` +
        "the loser's board nor the winner's",
    ).toBe(true);
    if (settled === "resolved") {
      expect(cards).toEqual([WINNER_MARK]);
    } else {
      expect(cards).toEqual([LOSER_MARK, "second card"].sort());
    }
    loser.destroy();
    winner.destroy();
  });

  it("the archive is written exactly once even when the same winner is offered twice", async () => {
    const loser = make(2, { a: LOSER_MARK });
    const winner = make(5, { z: WINNER_MARK });
    const probe = inspectingEnv(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });
    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(probe.observations).toHaveLength(1);
    loser.destroy();
    winner.destroy();
  });
});
