// WP28 / AC4 blind2 — the signature's DISTINCTNESS, checked against the three
// signature families this codebase already emits.
//
// Different angle: blind1 attacks the pair-encoding; the visible probe checks the
// prefix. This file asks the question an operator actually asks — *can I grep the
// console for epoch conflicts and get epoch conflicts?* — by generating every
// other signature this module family produces and demanding that no epoch line
// can be mistaken for one of them, and that no filter written for one of them
// catches an epoch line.
//
// AC4's word is "DISTINCT". A signature that reuses an existing family's opening
// (`INGEST REJECTED signature:`, `QUARANTINE RAISED signature:`) makes the epoch
// class invisible in exactly the situation it was created for: a support session
// where somebody is scrolling a log looking for the moment a board changed under
// them.
//
// Both epoch values are re-checked here as a floor, because a distinct-but-
// uninformative line satisfies the first half of the AC and none of its purpose.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  epochConflictSignature,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";
import {
  ingestRejectionSignature,
  quarantineReleaseSignature,
  quarantineSignature,
} from "../../../../../plugin/src/files/canvas-sync";

const BOARD = "ops/alerts.canvas";
const COPY = "ops/alerts.conflict-2026-05-05.canvas";

function otherSignatures(): string[] {
  const out: string[] = [];
  for (const kind of ["node", "edge"] as const) {
    for (const id of ["n-1", "e-1"]) {
      out.push(quarantineSignature(kind, id, "MISSING_ID" as never));
      out.push(quarantineReleaseSignature(kind, id));
      for (const boundary of ["host-seed", "remote-ingest", "file-read"]) {
        out.push(ingestRejectionSignature(boundary as never, kind, id, "MISSING_ID" as never));
      }
    }
  }
  return out;
}

/** The first token up to and including `signature:` — what an operator greps on. */
function family(line: string): string {
  const marker = line.indexOf("signature:");
  return marker === -1 ? line : line.slice(0, marker + "signature:".length);
}

function docAt(epoch: number): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set("card", record);
    record.set("id", "card");
  });
  return doc;
}

describe("WP28 AC4 blind2 — the epoch line is its own family", () => {
  it("its family marker matches none of the existing ones", () => {
    const epochLine = epochConflictSignature(BOARD, 1, 4, COPY);
    const epochFamily = family(epochLine);
    expect(epochFamily).not.toBe(epochLine);

    for (const other of otherSignatures()) {
      expect(
        family(other),
        `the epoch line shares its grep marker with \`${other}\``,
      ).not.toBe(epochFamily);
    }
  });

  it("no existing family's marker matches an epoch line, and vice versa", () => {
    const epochLine = epochConflictSignature(BOARD, 1, 4, COPY);
    for (const other of otherSignatures()) {
      expect(epochLine.startsWith(family(other))).toBe(false);
      expect(other.startsWith(family(epochLine))).toBe(false);
    }
  });

  it("the epoch family marker is stable across every conflict it describes", () => {
    const markers = new Set<string>();
    for (const [local, remote] of [
      [0, 1],
      [3, 9],
      [12, 400],
      [0, Number.MAX_SAFE_INTEGER],
    ] as const) {
      markers.add(family(epochConflictSignature(BOARD, local, remote, COPY)));
      markers.add(family(epochConflictSignature(BOARD, remote, local, null)));
    }
    expect(markers.size, "the marker varies with the conflict — it is not greppable").toBe(1);
  });

  it("both epoch values survive into the line, in labelled slots", () => {
    for (const [local, remote] of [
      [0, 1],
      [3, 9],
      [12, 400],
    ] as const) {
      const line = epochConflictSignature(BOARD, local, remote, COPY);
      expect(line, `(${local},${remote})`).toContain(`local=${local}`);
      expect(line).toContain(`remote=${remote}`);
    }
  });

  it("the line an actual resolution emits belongs to the same family", async () => {
    const loser = docAt(2);
    const winner = docAt(6);
    const lines: { category: string; message: string }[] = [];

    await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: {
        serializeDoc: () => "{}",
        writeConflictCopy: async () => {},
        notify: () => {},
        today: () => "2026-05-05",
        logger: {
          debug: () => {},
          warn: (category: string, message: string) => lines.push({ category, message }),
        },
      },
    });

    expect(lines).toHaveLength(1);
    expect(family(lines[0].message)).toBe(family(epochConflictSignature(BOARD, 2, 6, COPY)));
    expect(lines[0].message).toContain("local=2");
    expect(lines[0].message).toContain("remote=6");
    loser.destroy();
    winner.destroy();
  });

  it("an equal-epoch merge contributes nothing to the log at all", async () => {
    const loser = docAt(6);
    const winner = docAt(6);
    const lines: string[] = [];

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: {
        serializeDoc: () => "{}",
        writeConflictCopy: async () => {},
        notify: () => {},
        today: () => "2026-05-05",
        logger: { debug: () => {}, warn: (_c: string, message: string) => lines.push(message) },
      },
    });

    expect(outcome.signature).toBeNull();
    expect(
      lines,
      "a related-replica merge wrote an epoch-conflict line — the log can no longer be " +
        "used to find the real ones",
    ).toEqual([]);
    loser.destroy();
    winner.destroy();
  });

  it("the constructor refuses an equal pair outright", () => {
    for (const epoch of [0, 3, 400]) {
      expect(() => epochConflictSignature(BOARD, epoch, epoch, COPY)).toThrow();
    }
  });
});
