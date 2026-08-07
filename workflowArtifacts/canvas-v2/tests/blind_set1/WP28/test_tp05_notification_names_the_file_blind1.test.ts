// WP28 / AC2 blind1 — the notification, attacked by PARSING THE PATH BACK OUT of
// the message and re-feeding it to the vault.
//
// Different angle: a `toContain(path)` assertion proves the characters are
// somewhere in the string. It does not prove a human can act on them. Here the
// message is treated the way a user does — find the `.canvas` filename in it and
// go open that file — and the extracted path must be exactly the path that was
// written. That catches the message that mentions BOTH the board and its copy in
// a way no reader can separate, and the message that truncates or ellipsises a
// long path.
//
// The board names here are deliberately hostile: spaces, a regex-special
// character, a unicode dash and a nested folder. A formatter that builds its
// message with a regular expression, or that quotes with characters that appear
// in the name itself, breaks on exactly these.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  conflictCopyPath,
  epochConflictNotice,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const HOSTILE_PATHS = [
  "boards/plan.canvas",
  "team notes/Q3 planning (draft).canvas",
  "archive/2024–2025/Retro – Nov.canvas",
  "a/b/c/d/e/f/g/very-deeply-nested-board.canvas",
  "boards/re[gex]+special.canvas",
];

/**
 * Can a human tell where the path ENDS?
 *
 * A vault path may contain spaces, so "the characters are in the string
 * somewhere" is not enough — `saved as team notes/Q3 planning (draft).conflict-
 * 2026-05-04.canvas in your vault` leaves a reader guessing. The property is:
 * the path appears exactly once, and nothing follows it but a closing delimiter
 * or sentence punctuation, so the tail of the message IS the filename.
 */
function pathIsUnambiguous(message: string, path: string): boolean {
  const at = message.indexOf(path);
  if (at === -1) return false;
  if (message.indexOf(path, at + 1) !== -1) return false;
  return /^["'”’)\]}.!]?\s*$/.test(message.slice(at + path.length));
}

function docAt(epoch: number, cardId: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(cardId, record);
    record.set("id", cardId);
  });
  return doc;
}

function collector(today: string) {
  const notices: string[] = [];
  const written: string[] = [];
  return {
    notices,
    written,
    env: {
      serializeDoc: () => "{}",
      writeConflictCopy: async (path: string) => {
        written.push(path);
      },
      notify: (message: string) => notices.push(message),
      today: () => today,
      logger: { debug: () => {}, warn: () => {} },
    },
  };
}

describe("WP28 AC2 blind1 — the message points at a file a human can find", () => {
  it.each(HOSTILE_PATHS)(
    "%s: the path parsed out of the message is the path that was written",
    async (boardPath) => {
      const loser = docAt(0, "mine");
      const winner = docAt(3, "theirs");
      const probe = collector("2026-05-04");

      await resolveEpochConflict({
        doc: loser,
        winner,
        canvasPath: boardPath,
        env: probe.env,
      });

      expect(probe.written).toHaveLength(1);
      expect(probe.notices).toHaveLength(1);
      expect(probe.written[0]).toBe(conflictCopyPath(boardPath, "2026-05-04"));
      expect(
        pathIsUnambiguous(probe.notices[0], probe.written[0]),
        `no conflict-copy path can be read cleanly out of "${probe.notices[0]}" — the user ` +
          "has been told their board was replaced and not, unambiguously, where their " +
          "version went",
      ).toBe(true);
      loser.destroy();
      winner.destroy();
    },
  );

  it("the message is not truncated — the whole nested path survives", () => {
    const long = conflictCopyPath("a/b/c/d/e/f/g/very-deeply-nested-board.canvas", "2026-05-04");
    const message = epochConflictNotice(long);
    expect(message).toContain(long);
    expect(pathIsUnambiguous(message, long)).toBe(true);
    expect(message).not.toContain("…");
    expect(message).not.toContain("...");
  });

  it("a path carrying spaces is still readable out of the message", () => {
    const spaced = conflictCopyPath("team notes/Q3 planning (draft).canvas", "2026-05-04");
    const message = epochConflictNotice(spaced);
    expect(message).toContain(spaced);
    expect(
      pathIsUnambiguous(message, spaced),
      "a path with spaces was embedded mid-sentence — the reader cannot tell where the " +
        "filename stops",
    ).toBe(true);
  });

  it("`epochConflictNotice` is deterministic and pure", () => {
    const path = conflictCopyPath("boards/plan.canvas", "2026-05-04");
    expect(epochConflictNotice(path)).toBe(epochConflictNotice(path));
  });

  it("two different copies produce two different messages", () => {
    const first = epochConflictNotice(conflictCopyPath("boards/a.canvas", "2026-05-04"));
    const second = epochConflictNotice(conflictCopyPath("boards/b.canvas", "2026-05-04"));
    expect(first).not.toBe(second);
  });

  it("no notification is raised when there is no conflict", async () => {
    const loser = docAt(4, "mine");
    const winner = docAt(4, "theirs");
    const probe = collector("2026-05-04");

    await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: "boards/plan.canvas",
      env: probe.env,
    });

    expect(probe.notices).toEqual([]);
    expect(probe.written).toEqual([]);
    loser.destroy();
    winner.destroy();
  });
});
