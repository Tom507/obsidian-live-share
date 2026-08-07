// WP28 / AC2 blind2 — the notification, attacked as an INFORMATION CHANNEL: can
// the message alone distinguish two conflicts that happened minutes apart?
//
// Different angle: blind1 parses the path out of one message. This file asks
// whether a SET of messages, produced by a run of conflicts on different boards
// on different days, is injective — because that is what a user actually faces.
// Two boards, two conflicts, two toasts; if both toasts read "Live Share: this
// canvas was replaced, your version was saved as a conflict copy", the user has
// two files to find and no way to match either one to what they just lost.
//
// It also pins the message's floor: it names the copy, it is not the bare path,
// it is not empty, and it does not leak an `undefined` or a `[object Object]`
// into the user's face — which is what a template string over an optional field
// produces the first time the optional field is absent.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  conflictCopyPath,
  epochConflictNotice,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARDS = [
  "projects/alpha.canvas",
  "projects/beta.canvas",
  "projects/alpha copy.canvas",
  "archive/alpha.canvas",
];
const DAYS = ["2026-02-01", "2026-02-02"];

function doc(epoch: number): Y.Doc {
  const d = new Y.Doc();
  d.transact(() => {
    d.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const record = new Y.Map<unknown>();
    d.getMap<Y.Map<unknown>>("nodes").set("card", record);
    record.set("id", "card");
  });
  return d;
}

async function conflictOn(board: string, day: string): Promise<{ message: string; path: string }> {
  const loser = doc(1);
  const winner = doc(2);
  let path = "";
  let message = "";
  await resolveEpochConflict({
    doc: loser,
    winner,
    canvasPath: board,
    env: {
      serializeDoc: () => "{}",
      writeConflictCopy: async (written: string) => {
        path = written;
      },
      notify: (text: string) => {
        message = text;
      },
      today: () => day,
      logger: { debug: () => {}, warn: () => {} },
    },
  });
  loser.destroy();
  winner.destroy();
  return { message, path };
}

describe("WP28 AC2 blind2 — the messages of a run are individually actionable", () => {
  it("eight conflicts across four boards and two days produce eight DISTINCT messages", async () => {
    const messages = new Map<string, string>();
    for (const board of BOARDS) {
      for (const day of DAYS) {
        const { message } = await conflictOn(board, day);
        const previous = messages.get(message);
        expect(
          previous,
          `\`${board}\` on ${day} produces the same toast as \`${previous}\` — the user has ` +
            "two files to find and no way to tell which is which",
        ).toBeUndefined();
        messages.set(message, `${board} @ ${day}`);
      }
    }
    expect(messages.size).toBe(BOARDS.length * DAYS.length);
  });

  it("each message names the copy that its own conflict actually wrote", async () => {
    for (const board of BOARDS) {
      const { message, path } = await conflictOn(board, "2026-02-01");
      expect(path).toBe(conflictCopyPath(board, "2026-02-01"));
      expect(message, `message for ${board}`).toContain(path);
    }
  });

  it("a message never leaks `undefined`, `null` or `[object Object]`", async () => {
    for (const board of BOARDS) {
      const { message } = await conflictOn(board, "2026-02-02");
      for (const leak of ["undefined", "null", "[object Object]", "NaN"]) {
        expect(message, `${board} leaked \`${leak}\``).not.toContain(leak);
      }
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("`epochConflictNotice` is a sentence about the copy, not the copy's name", () => {
    const path = conflictCopyPath("projects/alpha.canvas", "2026-02-01");
    const message = epochConflictNotice(path);
    expect(message).toContain(path);
    expect(message).not.toBe(path);
    expect(message.split(/\s+/).length).toBeGreaterThan(4);
  });

  it("the notice is the same whichever way it is reached", async () => {
    const { message, path } = await conflictOn("projects/beta.canvas", "2026-02-02");
    expect(message).toBe(epochConflictNotice(path));
  });

  it("no message at all is produced by a merge that is not a conflict", async () => {
    const loser = doc(3);
    const winner = doc(3);
    const raised: string[] = [];

    await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: "projects/alpha.canvas",
      env: {
        serializeDoc: () => "{}",
        writeConflictCopy: async () => {},
        notify: (text: string) => raised.push(text),
        today: () => "2026-02-01",
        logger: { debug: () => {}, warn: () => {} },
      },
    });

    expect(raised).toEqual([]);
    loser.destroy();
    winner.destroy();
  });
});
