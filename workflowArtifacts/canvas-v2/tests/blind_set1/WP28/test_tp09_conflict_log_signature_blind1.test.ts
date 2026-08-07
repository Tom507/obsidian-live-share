// WP28 / AC4 blind1 — the signature attacked as an INJECTIVE ENCODING of the
// pair, over a generated corpus.
//
// Different angle: AC4 says the line records "both epoch values". The strongest
// machine-checkable reading of that is that the pair can be RECOVERED from the
// line — so this file generates 100+ distinct (local, remote) conflicts and
// asserts the produced sentences are all distinct, and that parsing the two
// labelled numbers back out returns exactly the pair that went in.
//
// A signature that records only the winner collapses whole families of distinct
// conflicts onto one string: `(0,9)`, `(3,9)` and `(8,9)` all become "adopted
// epoch 9". They are three completely different incidents — a replica that never
// synced, a replica one import behind, and a replica that was nearly current —
// and the log is the only place that distinction survives, because the doc has
// already been overwritten by the time anyone reads it.
//
// The signature is a HUMAN channel, never the mechanism's oracle (charter §5).
// Everything about state is pinned elsewhere in this set.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  epochConflictSignature,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "incidents/postmortem.canvas";
const ARCHIVE = "incidents/postmortem.conflict-2026-04-01.canvas";

/** Read the labelled pair back out of the sentence, the way an operator would. */
function parsePair(signature: string): { local: number; remote: number } | null {
  const local = signature.match(/local=(\d+)/);
  const remote = signature.match(/remote=(\d+)/);
  if (!local || !remote) return null;
  return { local: Number(local[1]), remote: Number(remote[1]) };
}

function conflictPairs(): [number, number][] {
  const out: [number, number][] = [];
  for (const local of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]) {
    for (const remote of [1, 2, 4, 7, 12, 20, 33, 54, 89, 144, 1000]) {
      if (local < remote) out.push([local, remote]);
    }
  }
  return out;
}

function docAt(epoch: number, id: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    record.set("id", id);
  });
  return doc;
}

describe("WP28 AC4 blind1 — the pair survives the trip through the log line", () => {
  it("every generated conflict produces a DISTINCT sentence", () => {
    const pairs = conflictPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(70);
    const seen = new Map<string, string>();
    for (const [local, remote] of pairs) {
      const signature = epochConflictSignature(BOARD, local, remote, ARCHIVE);
      const collision = seen.get(signature);
      expect(
        collision,
        `(${local},${remote}) produces the same line as ${collision} — a log that cannot ` +
          "tell a never-synced replica from a nearly-current one",
      ).toBeUndefined();
      seen.set(signature, `(${local},${remote})`);
    }
    expect(seen.size).toBe(pairs.length);
  });

  it("both numbers are recoverable, labelled, and in the right slots", () => {
    for (const [local, remote] of conflictPairs()) {
      const parsed = parsePair(epochConflictSignature(BOARD, local, remote, ARCHIVE));
      expect(parsed, `no labelled pair in the line for (${local},${remote})`).not.toBeNull();
      expect(parsed).toEqual({ local, remote });
    }
  });

  it("the line names the board and the archive it points at", () => {
    const signature = epochConflictSignature(BOARD, 2, 5, ARCHIVE);
    expect(signature).toContain(BOARD);
    expect(signature).toContain(ARCHIVE);
    expect(signature).toContain("EPOCH CONFLICT signature:");
  });

  it("the emitted line matches the constructor's, for a real resolution", async () => {
    const conflicts: [number, number][] = [
      [0, 1],
      [2, 30],
      [7, 8],
      [0, 1000],
    ];
    for (const [local, remote] of conflicts) {
      const loser = docAt(local, "mine");
      const winner = docAt(remote, "theirs");
      const lines: string[] = [];
      let archivedTo = "";

      const outcome = await resolveEpochConflict({
        doc: loser,
        winner,
        canvasPath: BOARD,
        env: {
          serializeDoc: () => "{}",
          writeConflictCopy: async (path: string) => {
            archivedTo = path;
          },
          notify: () => {},
          today: () => "2026-04-01",
          logger: { debug: () => {}, warn: (_c: string, message: string) => lines.push(message) },
        },
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(epochConflictSignature(BOARD, local, remote, archivedTo));
      expect(outcome.signature).toBe(lines[0]);
      expect(parsePair(lines[0])).toEqual({ local, remote });
      loser.destroy();
      winner.destroy();
    }
  });

  it("across a run of 30 merges the line count equals the conflict count", async () => {
    const lines: string[] = [];
    const env = {
      serializeDoc: () => "{}",
      writeConflictCopy: async () => {},
      notify: () => {},
      today: () => "2026-04-01",
      logger: { debug: () => {}, warn: (_c: string, message: string) => lines.push(message) },
    };
    let conflicts = 0;
    for (let i = 0; i < 30; i++) {
      const local = i % 7;
      const remote = (i * 3) % 7;
      if (local < remote) conflicts += 1;
      const a = docAt(local, "mine");
      const b = docAt(remote, "theirs");
      await resolveEpochConflict({ doc: a, winner: b, canvasPath: BOARD, env });
      a.destroy();
      b.destroy();
    }

    expect(conflicts).toBeGreaterThan(0);
    expect(lines).toHaveLength(conflicts);
    expect(new Set(lines.map((line) => parsePair(line)?.remote)).size).toBeGreaterThan(1);
  });

  it("refuses to describe an equal pair, at every value in the range", () => {
    for (let epoch = 0; epoch < 20; epoch++) {
      expect(
        () => epochConflictSignature(BOARD, epoch, epoch, null),
        `equal epochs (${epoch}) produced a conflict line`,
      ).toThrow();
    }
  });
});
