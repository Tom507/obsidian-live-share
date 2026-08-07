// WP28 / AC2 blind1 — the archive-BEFORE-adopt ordering, attacked through a
// DEEP OBSERVER on the loser's doc rather than through a transaction hook.
//
// Different angle, same defect class. `doc.observeDeep` on the record containers
// fires on the first structural change of any depth, so the oracle here is
// "which happened first: the observer, or the write?" — completely independent of
// how the implementation frames its transactions. An implementation that adopts
// inside several small transactions, or outside a transaction entirely, is
// caught by this one and would slip past an oracle counting `afterTransaction`.
//
// The wrong implementation this exists to catch, stated plainly: adopt the
// winner, then serialise, then write the conflict copy. It produces a file with
// the correct name, the correct date, a valid `.canvas` body and a notification —
// and the body is the WINNER's. Every end-state assertion is green. The user's
// work is gone, and the file that was supposed to hold it is the proof that it
// was handled correctly.
//
// The second half asserts the archived TEXT by fingerprint: the loser's content
// is captured before the call and compared byte-for-byte with what reached the
// write channel.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "sprints/sprint-14.canvas";

function board(epoch: number, cards: Record<string, string>): Y.Doc {
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

function project(doc: Y.Doc): string {
  const out: Record<string, unknown> = {};
  for (const [id, record] of doc.getMap<Y.Map<unknown>>("nodes")) out[id] = record.toJSON();
  return JSON.stringify(out);
}

interface Tap {
  env: Parameters<typeof resolveEpochConflict>[0]["env"];
  events: string[];
  archived: string[];
}

/**
 * One event tape. Both the observer and the write channel append to it, so the
 * ordering claim reduces to `indexOf`.
 */
function tap(doc: Y.Doc, opts: { rejectWith?: Error } = {}): Tap {
  const events: string[] = [];
  const archived: string[] = [];
  doc.getMap<Y.Map<unknown>>("nodes").observeDeep(() => events.push("doc-mutated"));
  doc.getMap<Y.Map<unknown>>("edges").observeDeep(() => events.push("doc-mutated"));
  doc.getMap<unknown>(META_MAP_NAME).observe(() => events.push("doc-mutated"));
  return {
    events,
    archived,
    env: {
      serializeDoc: (subject: Y.Doc) => {
        events.push("serialize");
        return project(subject);
      },
      writeConflictCopy: async (_path: string, content: string) => {
        events.push("archive-write");
        archived.push(content);
        if (opts.rejectWith) throw opts.rejectWith;
      },
      notify: () => events.push("notify"),
      today: () => "2026-03-17",
      logger: { debug: () => {}, warn: () => events.push("log") },
    },
  };
}

describe("WP28 AC2 blind1 — the archive lands before the doc is touched", () => {
  it("the first doc mutation comes AFTER the archive write, on the event tape", async () => {
    const loser = board(1, { keep: "the user's own sketch", shared: "loser side" });
    const winner = board(6, { shared: "winner side", fresh: "imported" });
    const probe = tap(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    const writeAt = probe.events.indexOf("archive-write");
    const mutationAt = probe.events.indexOf("doc-mutated");
    expect(writeAt, "no archive was written at all").toBeGreaterThanOrEqual(0);
    expect(mutationAt, "the winner was never adopted").toBeGreaterThanOrEqual(0);
    expect(
      writeAt,
      `event tape was ${probe.events.join(" -> ")} — the doc was mutated before the ` +
        "conflict copy existed, so the copy on disk is a copy of the WINNER",
    ).toBeLessThan(mutationAt);
    loser.destroy();
    winner.destroy();
  });

  it("the tape order is serialize -> archive-write -> notify -> doc-mutated", async () => {
    const loser = board(1, { keep: "own work" });
    const winner = board(2, { fresh: "imported" });
    const probe = tap(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    const firstOf = (name: string) => probe.events.indexOf(name);
    expect(firstOf("serialize")).toBeLessThan(firstOf("archive-write"));
    expect(firstOf("archive-write")).toBeLessThan(firstOf("notify"));
    expect(firstOf("notify")).toBeLessThan(firstOf("doc-mutated"));
    loser.destroy();
    winner.destroy();
  });

  it("the archived bytes are the loser's projection, captured before the call", async () => {
    const loser = board(1, { keep: "the user's own sketch", shared: "loser side" });
    const winner = board(6, { shared: "winner side", fresh: "imported" });
    const fingerprint = project(loser);
    const probe = tap(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(probe.archived).toHaveLength(1);
    expect(probe.archived[0]).toBe(fingerprint);
    expect(probe.archived[0]).toContain("the user's own sketch");
    expect(probe.archived[0]).not.toContain("imported");
    loser.destroy();
    winner.destroy();
  });

  it("the doc is serialised exactly once — no second read after the adoption", async () => {
    const loser = board(1, { keep: "own work" });
    const winner = board(9, { fresh: "imported" });
    const probe = tap(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(probe.events.filter((e) => e === "serialize")).toHaveLength(1);
    expect(probe.events.filter((e) => e === "archive-write")).toHaveLength(1);
    loser.destroy();
    winner.destroy();
  });

  it("FAIL-CLOSED: a rejected write leaves the tape with no mutation on it", async () => {
    const loser = board(1, { keep: "own work", other: "more own work" });
    const winner = board(9, { fresh: "imported" });
    const probe = tap(loser, { rejectWith: new Error("ENOSPC: no space left on device") });

    await expect(
      resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env }),
    ).rejects.toThrow(/ENOSPC/);

    expect(
      probe.events,
      "the winner was adopted even though the archive could not be written — that is a " +
        "delete with a log line",
    ).not.toContain("doc-mutated");
    expect(probe.events).not.toContain("notify");
    expect([...loser.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(["keep", "other"]);
    loser.destroy();
    winner.destroy();
  });

  it("a rejected write leaves the epoch where it was, so the conflict is retried later", async () => {
    const loser = board(3, { keep: "own work" });
    const winner = board(9, { fresh: "imported" });
    const probe = tap(loser, { rejectWith: new Error("EROFS") });

    await expect(
      resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env }),
    ).rejects.toThrow();

    expect(
      loser.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY),
      "the epoch moved without the adoption — the replica now believes it is current " +
        "and will never resolve this conflict again",
    ).toBe(3);
    loser.destroy();
    winner.destroy();
  });
});
