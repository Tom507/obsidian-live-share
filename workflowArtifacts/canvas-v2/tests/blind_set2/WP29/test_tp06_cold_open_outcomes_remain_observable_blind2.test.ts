// WP29 / AC4 blind2, outcomes — REPEATABILITY.
//
// The other angles enumerate the branches once each. This one asks what happens
// the SECOND time, which is the question a plugin actually faces: a canvas is
// closed and reopened, a client reconnects, a writer is rebuilt. The outcome
// vocabulary is only "observable" in a useful sense if a caller can act on it
// more than once and get a coherent answer.
//
// Three repeat properties, and each of them is a place WP29's new branch could
// leak state:
//
//   1. A cold open that REFUSED to seed must refuse again for the same
//      knowledge, and must still not have consumed the file. A one-shot guard
//      ("I have already decided about this doc") would seed on the second call.
//   2. A cold open that SEEDED must return `doc-wins` on the second call,
//      because the doc is no longer empty. That is the pre-WP29 behaviour and
//      the new branch must not shadow it.
//   3. Knowledge that arrives LATER must be honoured: a writer built with no
//      knowledge and one built with knowledge over the same doc must disagree,
//      which pins that the answer is read per cold open rather than captured at
//      construction and cached forever.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasPersistence,
  type ColdOpenResult,
  type PersistenceIO,
} from "../../../../../plugin/src/files/canvas-persistence";
import type { SeedKnowledge } from "../../../../../plugin/src/files/canvas-seed-decision";

const DISK = "journal/2026.canvas";
const FILE = JSON.stringify({
  nodes: [
    { id: "j-1", type: "text", x: 0, y: 0, width: 200, height: 90, text: "january" },
    { id: "j-2", type: "text", x: 240, y: 0, width: 200, height: 90, text: "february" },
  ],
  edges: [{ id: "j-e", fromNode: "j-1", fromSide: "right", toNode: "j-2", toSide: "left" }],
});

const inert = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

function tracked(files: Map<string, string>) {
  const log: string[] = [];
  const io: PersistenceIO = {
    async read(p: string) {
      log.push(`read:${p}`);
      return files.get(p) ?? "";
    },
    async write(p: string, c: string) {
      log.push(`write:${p}`);
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  };
  return { io, log };
}

function build(knowledge?: SeedKnowledge) {
  const files = new Map<string, string>([[DISK, FILE]]);
  const { io, log } = tracked(files);
  const doc = new Y.Doc();
  const persistence = new CanvasPersistence(doc, io, DISK, {
    scheduler: inert,
    ...(knowledge ? { seedKnowledge: knowledge } : {}),
  });
  return { files, log, doc, persistence };
}

function records(doc: Y.Doc): number {
  return doc.getMap<Y.Map<unknown>>("nodes").size + doc.getMap<Y.Map<unknown>>("edges").size;
}

describe("WP29 AC4 blind2 — the outcomes survive being asked twice", () => {
  it("a refusal repeats, and never consumes the file", async () => {
    const { persistence, log, files, doc } = build({ sidecarKnowsDoc: true, peerKnowsDoc: false });
    const outcomes: ColdOpenResult[] = [];
    for (let i = 0; i < 4; i++) outcomes.push(await persistence.coldOpen());

    expect(outcomes, "a repeated cold open changed its mind").toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(log, "a repeated cold open eventually touched the disk").toEqual([]);
    expect(records(doc)).toBe(0);
    expect(files.get(DISK)).toBe(FILE);
    persistence.destroy();
  });

  it("a seed happens once, and the second call is `doc-wins`", async () => {
    const { persistence, log, doc } = build({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    expect(records(doc)).toBe(3);

    expect(await persistence.coldOpen(), "the board was seeded from the file twice").toBe(
      "doc-wins",
    );
    expect(
      log.filter((entry) => entry.startsWith("read:")),
      "the file was read twice",
    ).toHaveLength(1);
    expect(records(doc), "the second cold open changed the board").toBe(3);
    persistence.destroy();
  });

  it("two writers over the SAME doc disagree exactly as their knowledge does", async () => {
    // Knowledge is per cold open, not captured once per document. The
    // uninformed writer runs first and seeds; the informed one then finds a
    // non-empty doc, which is `doc-wins` for the ordinary reason.
    const files = new Map<string, string>([[DISK, FILE]]);
    const doc = new Y.Doc();

    const first = new CanvasPersistence(doc, tracked(files).io, DISK, { scheduler: inert });
    expect(await first.coldOpen()).toBe("seeded-from-file");
    first.destroy();

    const second = new CanvasPersistence(doc, tracked(files).io, DISK, {
      scheduler: inert,
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    });
    expect(await second.coldOpen()).toBe("doc-wins");
    second.destroy();

    // ...and in the other order, the informed writer refuses and leaves the doc
    // for the uninformed one to seed — so neither answer is a constant.
    const fresh = new Y.Doc();
    const informed = new CanvasPersistence(fresh, tracked(files).io, DISK, {
      scheduler: inert,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
    });
    expect(await informed.coldOpen()).toBe("empty");
    informed.destroy();

    const uninformed = new CanvasPersistence(fresh, tracked(files).io, DISK, {
      scheduler: inert,
    });
    expect(await uninformed.coldOpen()).toBe("seeded-from-file");
    uninformed.destroy();
  });

  it("`empty` from a missing file and `empty` from a known doc are the same value", async () => {
    const missing = new CanvasPersistence(new Y.Doc(), tracked(new Map()).io, DISK, {
      scheduler: inert,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    const known = build({ sidecarKnowsDoc: false, peerKnowsDoc: true });

    const a = await missing.coldOpen();
    const b = await known.persistence.coldOpen();
    expect(a).toBe(b);
    expect(a).toBe("empty");

    missing.destroy();
    known.persistence.destroy();
  });

  it("the three outcomes are all produced by this file alone", async () => {
    const seen = new Set<string>();
    const refused = build({ sidecarKnowsDoc: true, peerKnowsDoc: true });
    seen.add(await refused.persistence.coldOpen());
    refused.persistence.destroy();

    const seeding = build();
    seen.add(await seeding.persistence.coldOpen());
    seen.add(await seeding.persistence.coldOpen());
    seeding.persistence.destroy();

    expect([...seen].sort()).toEqual(["doc-wins", "empty", "seeded-from-file"]);
  });
});
