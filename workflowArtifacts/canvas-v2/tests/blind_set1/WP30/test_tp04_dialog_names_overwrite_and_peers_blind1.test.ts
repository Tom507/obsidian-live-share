// WP30 / AC3 (the text) blind1 — attacked as INJECTIVITY over a generated
// corpus, with adversarial names, instead of as containment of one fixture.
//
// Containment can be satisfied by an implementation that concatenates the
// summary's fields into a bag of words with no sentence around them, and it can
// be defeated by an accident: a peer whose display name happens to be a
// substring of the board path is "contained" even if the peer clause was never
// rendered. This file therefore asks two harder questions.
//
//   INJECTIVITY — build 27 summaries that differ pairwise in at least one field
//   and assert all 27 messages are pairwise DISTINCT. A constant sentence
//   collapses all 27 into one and fails 351 pairs at once; a message that omits
//   any single field collapses the pairs that vary only in that field, and the
//   failure names which field was dropped.
//
//   ADVERSARIAL NAMES — a peer called `plan.canvas`, a peer whose name is a
//   prefix of another's, a peer name containing the record count, and a
//   two-peer set whose names differ only in case. A "contains" implementation
//   that renders one peer and drops the rest survives the visible test's
//   two-name fixture and dies on the prefix pair, because dropping "Al" from
//   {"Al", "Alice"} still leaves "Al" inside "Alice".

import { describe, expect, it } from "vitest";

import {
  type ImportOverwriteSummary,
  importConfirmationMessage,
} from "../../../../../plugin/src/canvas/canvas-import-command";

const PATHS = ["atlas/roadmap.canvas", "atlas/roadmap.copy.canvas", "notes/board.canvas"];
const LIVE_COUNTS = [0, 1, 17];
const PEER_SETS: { displayName: string }[][] = [
  [],
  [{ displayName: "Zed" }],
  [{ displayName: "Zed" }, { displayName: "Nia" }],
];

function corpus(): ImportOverwriteSummary[] {
  const out: ImportOverwriteSummary[] = [];
  for (const canvasPath of PATHS) {
    for (const liveRecordCount of LIVE_COUNTS) {
      for (const peers of PEER_SETS) {
        out.push({ canvasPath, liveRecordCount, fileRecordCount: 4, peers });
      }
    }
  }
  return out;
}

describe("WP30 tp04 blind1 — the confirmation text is injective in its summary", () => {
  it("produces 27 pairwise distinct messages for 27 distinct summaries", () => {
    const summaries = corpus();
    const messages = summaries.map(importConfirmationMessage);
    expect(summaries).toHaveLength(27);

    const collisions: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[i] === messages[j]) {
          collisions.push(
            `${JSON.stringify(summaries[i])} == ${JSON.stringify(summaries[j])}`,
          );
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("is deterministic — the same summary always renders the same message", () => {
    for (const summary of corpus()) {
      expect(importConfirmationMessage(summary)).toBe(importConfirmationMessage(summary));
    }
  });

  it("names EVERY peer even when one name is a prefix of another", () => {
    // The pair that defeats a lazy "contains" oracle: rendering only "Alice"
    // still contains "Al". So the discriminator is the message, not the
    // containment — dropping a peer must change the text.
    const both = importConfirmationMessage({
      canvasPath: "atlas/roadmap.canvas",
      liveRecordCount: 3,
      fileRecordCount: 1,
      peers: [{ displayName: "Al" }, { displayName: "Alice" }],
    });
    const onlyAlice = importConfirmationMessage({
      canvasPath: "atlas/roadmap.canvas",
      liveRecordCount: 3,
      fileRecordCount: 1,
      peers: [{ displayName: "Alice" }],
    });
    expect(both).toContain("Alice");
    expect(both).not.toBe(onlyAlice);
  });

  it("names peers whose display names collide with the board path or the count", () => {
    const message = importConfirmationMessage({
      canvasPath: "atlas/roadmap.canvas",
      liveRecordCount: 17,
      fileRecordCount: 1,
      peers: [{ displayName: "atlas/roadmap.canvas" }, { displayName: "17" }],
    });
    const withoutThem = importConfirmationMessage({
      canvasPath: "atlas/roadmap.canvas",
      liveRecordCount: 17,
      fileRecordCount: 1,
      peers: [],
    });
    expect(message).not.toBe(withoutThem);
  });

  it("names peers whose display names differ only in case", () => {
    const mixed = importConfirmationMessage({
      canvasPath: "notes/board.canvas",
      liveRecordCount: 2,
      fileRecordCount: 2,
      peers: [{ displayName: "nia" }, { displayName: "NIA" }],
    });
    const single = importConfirmationMessage({
      canvasPath: "notes/board.canvas",
      liveRecordCount: 2,
      fileRecordCount: 2,
      peers: [{ displayName: "nia" }],
    });
    expect(mixed).not.toBe(single);
    expect(mixed).toContain("NIA");
  });

  it("survives a name with punctuation and non-ASCII without mangling it", () => {
    const name = "Zoë O'Brien-Müller";
    const message = importConfirmationMessage({
      canvasPath: "notes/board.canvas",
      liveRecordCount: 5,
      fileRecordCount: 2,
      peers: [{ displayName: name }],
    });
    expect(message).toContain(name);
  });

  it("keeps growing with the peer list up to five collaborators", () => {
    const names = ["A1", "B2", "C3", "D4", "E5"];
    const seen = new Set<string>();
    for (let n = 0; n <= names.length; n++) {
      const message = importConfirmationMessage({
        canvasPath: "notes/board.canvas",
        liveRecordCount: 9,
        fileRecordCount: 1,
        peers: names.slice(0, n).map((displayName) => ({ displayName })),
      });
      for (const named of names.slice(0, n)) expect(message, `n=${n}`).toContain(named);
      seen.add(message);
    }
    expect(seen.size).toBe(names.length + 1);
  });
});
