// WP30 / AC1, second clause — the command "is the **only** way a file overwrites
// an already-living doc".
//
// A UNIVERSAL NEGATIVE CANNOT BE PROVEN BY A TEST, and pretending otherwise is
// how this assertion normally ends up unable to fail. What CAN be pinned, and is
// pinned here, is the shape of the argument: NAME the other doors and show each
// one is shut, then show this one opens. If a later WP adds a door, this file
// does not automatically catch it — but the list is explicit, so the omission is
// visible in review rather than hidden in a green suite.
//
// THE DOORS, and what shuts each:
//
//   ├── COLD OPEN on a board the peers already hold — shut by WP29's
//   │   `decideSeed`, which answers LOAD_OR_MERGE the moment a peer knows it.
//   ├── SIDECAR RESUME on a board this client's own durable replica holds —
//   │   shut by the same guard's other conjunct.
//   ├── HOST REJOIN carrying an older local file — shut by both conjuncts at
//   │   once, and separately by WP29's removal of the record-level
//   │   delete-by-omission from `seedFlatSpace`.
//   └── THE SEED WRITER ITSELF, on the one path where seeding is still allowed
//       (nothing anywhere knows the board) — it is UPSERT-ONLY, so even when it
//       runs it cannot remove a record the file omits. A door that cannot
//       delete cannot overwrite a living board.
//
// AND THE ONE THAT OPENS: WP30's import, which does not seed the live doc at
// all. It stages the file into a winner, raises the epoch, and publishes a
// WHOLESALE replacement through WP28's seam — which is why it can remove a
// record the file omits when nothing else in the system can.
//
// THE DISCRIMINATOR IS DELETION-BY-OMISSION. Every scenario below uses the same
// pair: a live board holding `live-only`, and a file that does not mention it.
// Every shut door leaves `live-only` there. The import removes it. That single
// contrast is what "overwrites an already-living doc" means operationally, and
// no other mechanism in the tree can produce it.
//
// PRODUCTION LINE <-> ASSERTION: `runImportFromFile`'s use of
// `env.adoptEpochWinner` (a wholesale replacement) rather than a seed into the
// live doc. Implementing the import as `seedRecordsIntoYMaps(liveDoc, ...)`
// reddens `the import removes a record the file does not mention` while leaving
// every other test in this suite green — that is exactly the wrong
// implementation this test point exists for.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import { runImportFromFile } from "../../../files/canvas-import";
import { SEED_DECISION, decideSeed } from "../../../files/canvas-seed-decision";
import {
  decodeCanvasDataToFlat,
  parseCanvas,
  seedRecordsIntoYMaps,
} from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  canvasJson,
  createImportHarness,
  makeLiveDoc,
  projection,
  textNode,
} from "./harness";

/** The file every scenario imports. It does NOT mention `live-only`. */
const FILE_TEXT = canvasJson([textNode("file-a", 0, "alpha")]);
const LIVE_NODES = [
  textNode("live-only", 0, "work only the doc has"),
  textNode("file-a", 5, "doc's alpha"),
];

const TEST_SEED_ORIGIN = Symbol("wp30-tp08-seed");

/** The three ways a client can arrive at a board that is ALREADY LIVING. */
const SHUT_DOORS = [
  {
    door: "cold open on a board the peers already hold",
    knowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
  },
  {
    door: "sidecar resume of this client's own durable replica",
    knowledge: { sidecarKnowsDoc: true, peerKnowsDoc: false },
  },
  {
    door: "host rejoin carrying an older local file",
    knowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
  },
] as const;

describe("WP30 tp08 — the import is the only door that overwrites a living board", () => {
  it.each(SHUT_DOORS)("$door does not seed from the file", ({ knowledge }) => {
    expect(decideSeed(knowledge)).toBe(SEED_DECISION.LOAD_OR_MERGE);
  });

  it("exactly one knowledge shape still permits an automatic seed", () => {
    const lattice = [
      { sidecarKnowsDoc: false, peerKnowsDoc: false },
      { sidecarKnowsDoc: false, peerKnowsDoc: true },
      { sidecarKnowsDoc: true, peerKnowsDoc: false },
      { sidecarKnowsDoc: true, peerKnowsDoc: true },
    ];
    const seeding = lattice.filter((k) => decideSeed(k) === SEED_DECISION.SEED_FROM_FILE);
    expect(seeding).toEqual([{ sidecarKnowsDoc: false, peerKnowsDoc: false }]);
  });

  it("even the permitted seed cannot remove a record the file omits", () => {
    // The last door, and the one that is easy to forget: `decideSeed` says yes
    // only for a board nothing knows, but if the seed writer were destructive
    // that verdict would be the only thing standing between a stale file and a
    // living board. It is not — the writer is upsert-only (WP29 / I7).
    const doc = makeLiveDoc({ epoch: 0, nodes: LIVE_NODES });
    seedRecordsIntoYMaps(doc, decodeCanvasDataToFlat(parseCanvas(FILE_TEXT)), TEST_SEED_ORIGIN);

    expect(projection(doc).nodes).toContain("live-only");
    expect(projection(doc).nodes).toContain("file-a");
  });

  it("the import removes a record the file does not mention", async () => {
    const harness = createImportHarness({
      liveEpoch: 2,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
    });
    const live = harness.liveDoc as Y.Doc;
    expect(projection(live).nodes).toContain("live-only");

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(projection(live)).toEqual({ nodes: ["file-a"], edges: [] });
    expect(projection(live).nodes).not.toContain("live-only");
  });

  it("the import overwrites under EVERY knowledge shape, including the three shut ones", async () => {
    // The import is not a seed and does not ask `decideSeed` for permission —
    // that is the point of AC1. Whatever the automatic machinery would have
    // decided, the named user action still overwrites.
    for (const { door } of SHUT_DOORS) {
      const harness = createImportHarness({
        liveEpoch: 2,
        liveNodes: LIVE_NODES,
        fileText: FILE_TEXT,
        answer: true,
      });
      await runImportFromFile(CANVAS_PATH, harness.env);
      expect(projection(harness.liveDoc as Y.Doc), door).toEqual({
        nodes: ["file-a"],
        edges: [],
      });
    }
  });

  it("the import reports its decision using WP29's own vocabulary", async () => {
    // Shared Ownership Contract §1: `SEED_DECISION` is WP29's, imported and
    // never re-spelt. A WP30 that invents its own "seed-from-file" string
    // reddens here.
    const harness = createImportHarness({ liveEpoch: 2, fileText: FILE_TEXT, answer: true });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.decision).toBe(SEED_DECISION.SEED_FROM_FILE);
  });

  it("nothing else in the import touches the live doc — one transaction, the adoption", async () => {
    // If WP30 also seeded the live doc "to be safe", the record it was supposed
    // to remove would come back and there would be a second transaction. Both
    // halves are asserted, because either alone is survivable.
    const harness = createImportHarness({
      liveEpoch: 2,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
    });

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.liveUpdateOrigins).toHaveLength(1);
    expect(harness.adoptCalls).toHaveLength(1);
  });
});
