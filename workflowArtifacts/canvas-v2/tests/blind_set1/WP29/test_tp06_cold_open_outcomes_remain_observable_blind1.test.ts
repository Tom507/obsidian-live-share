// WP29 / AC4 blind1, outcomes — driven ONLY through `attachCanvasPersistence`,
// and stated as a COVERAGE claim rather than as one assertion per branch.
//
// "The outcomes remain observable" has two failure directions and the visible
// test's per-branch assertions cover one of them. The other is COVERAGE: an
// outcome that no reachable scenario produces any more is not observable, it is
// dead vocabulary. So the whole scenario matrix is run and the observed set is
// compared with the declared vocabulary in BOTH directions —
//
//   observed \ declared  != {}  ->  WP29 invented a fourth outcome
//   declared \ observed  != {}  ->  WP29 made an outcome unreachable
//
// The wiring-layer view is used deliberately: `attachCanvasPersistence` is what
// production actually calls, and an outcome that `coldOpen` returns but the
// attach wrapper swallows is not observable to anything that matters.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type ColdOpenResult,
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../../../plugin/src/files/canvas-persistence";
import type { SeedKnowledge } from "../../../../../plugin/src/files/canvas-seed-decision";

const DISK = "atlas/index.canvas";
const DECLARED: ColdOpenResult[] = ["seeded-from-file", "doc-wins", "empty"];

const FILE = JSON.stringify({
  nodes: [{ id: "on-disk", type: "text", x: 0, y: 0, width: 120, height: 60, text: "disk" }],
  edges: [],
});

const inert = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

function io(files: Map<string, string>): PersistenceIO & { reads: number; writes: number } {
  const counters = { reads: 0, writes: 0 };
  return {
    get reads() {
      return counters.reads;
    },
    get writes() {
      return counters.writes;
    },
    async read(p: string) {
      counters.reads += 1;
      return files.get(p) ?? "";
    },
    async write(p: string, c: string) {
      counters.writes += 1;
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  } as PersistenceIO & { reads: number; writes: number };
}

function docWith(records: Record<string, unknown>[]): Y.Doc {
  const doc = new Y.Doc();
  if (records.length > 0) {
    doc.transact(() => {
      for (const source of records) {
        const record = new Y.Map<unknown>();
        doc.getMap<Y.Map<unknown>>("nodes").set(String(source.id), record);
        for (const [k, v] of Object.entries(source)) record.set(k, v);
      }
    });
  }
  return doc;
}

interface Scenario {
  name: string;
  file: string | null;
  docRecords: Record<string, unknown>[];
  knowledge: SeedKnowledge;
  expected: ColdOpenResult;
  /**
   * How many times this scenario is allowed to open the file. Note that it is
   * NOT simply "1 when it seeds": a file that exists but holds no records is
   * read and then found empty, which is a legitimate read that seeds nothing.
   * The reads that WP29 forbids are the ones over a doc somebody already knows.
   */
  reads: number;
}

const NOTHING: SeedKnowledge = { sidecarKnowsDoc: false, peerKnowsDoc: false };

const RESIDENT = { id: "in-doc", type: "text", x: 0, y: 0, width: 120, height: 60, text: "doc" };

const SCENARIOS: Scenario[] = [
  {
    name: "unknown board, file present",
    file: FILE,
    docRecords: [],
    knowledge: NOTHING,
    expected: "seeded-from-file",
    reads: 1,
  },
  {
    name: "records already in the doc",
    file: FILE,
    docRecords: [RESIDENT],
    knowledge: NOTHING,
    expected: "doc-wins",
    reads: 0,
  },
  {
    name: "unknown board, no file",
    file: null,
    docRecords: [],
    knowledge: NOTHING,
    expected: "empty",
    reads: 0,
  },
  {
    name: "unknown board, file with no records",
    file: JSON.stringify({ nodes: [], edges: [] }),
    docRecords: [],
    knowledge: NOTHING,
    expected: "empty",
    reads: 1,
  },
  {
    name: "WP29 — the sidecar knows it",
    file: FILE,
    docRecords: [],
    knowledge: { sidecarKnowsDoc: true, peerKnowsDoc: false },
    expected: "empty",
    reads: 0,
  },
  {
    name: "WP29 — a peer knows it",
    file: FILE,
    docRecords: [],
    knowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
    expected: "empty",
    reads: 0,
  },
  {
    name: "WP29 — both know it",
    file: FILE,
    docRecords: [],
    knowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    expected: "empty",
    reads: 0,
  },
  {
    name: "known AND non-empty — doc-wins still takes precedence",
    file: FILE,
    docRecords: [RESIDENT],
    knowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    expected: "doc-wins",
    reads: 0,
  },
];

async function run(scenario: Scenario) {
  const files = new Map<string, string>();
  if (scenario.file !== null) files.set(DISK, scenario.file);
  const disk = io(files);
  const doc = docWith(scenario.docRecords);
  const attached = await attachCanvasPersistence(doc, disk, DISK, {
    scheduler: inert,
    seedKnowledge: scenario.knowledge,
  });
  const outcome = attached.coldOpen;
  attached.persistence.destroy();
  return { outcome, reads: disk.reads, writes: disk.writes, files, doc };
}

describe("WP29 AC4 blind1 — outcome coverage through the wiring layer", () => {
  it.each(SCENARIOS)("$name -> $expected", async (scenario) => {
    const { outcome } = await run(scenario);
    expect(outcome).toBe(scenario.expected);
  });

  it("the observed outcomes are exactly the declared vocabulary — no more, no fewer", async () => {
    const observed = new Set<string>();
    for (const scenario of SCENARIOS) observed.add((await run(scenario)).outcome);

    const invented = [...observed].filter((o) => !DECLARED.includes(o as ColdOpenResult));
    const unreachable = DECLARED.filter((o) => !observed.has(o));
    expect(invented, "coldOpen grew an outcome the callers do not know").toEqual([]);
    expect(unreachable, "an outcome is no longer produced by any scenario").toEqual([]);
  });

  it("`empty` is reached from THREE different causes, and none of them writes", async () => {
    // Distinct causes, one outcome — which is what makes the outcome a summary
    // rather than a cause code, and is why WP29 needs no fourth value.
    const emptyScenarios = SCENARIOS.filter((s) => s.expected === "empty");
    expect(emptyScenarios.length).toBeGreaterThanOrEqual(3);
    for (const scenario of emptyScenarios) {
      const { writes, files } = await run(scenario);
      expect(writes, `${scenario.name} wrote to disk on the empty branch`).toBe(0);
      if (scenario.file !== null) {
        expect(files.get(DISK), `${scenario.name} modified the user's file`).toBe(scenario.file);
      }
    }
  });

  it("no scenario over a doc somebody already knows opens the file", async () => {
    for (const scenario of SCENARIOS) {
      const { reads } = await run(scenario);
      expect(reads, `${scenario.name} opened the file the wrong number of times`).toBe(
        scenario.reads,
      );
    }
    // ...and the reads that DO happen are the two ignorant ones, so this is not
    // satisfied by a coldOpen that never reads at all.
    expect(SCENARIOS.reduce((total, s) => total + s.reads, 0)).toBe(2);
  });

  it("the attach wrapper still returns the instance alongside the outcome", async () => {
    const files = new Map<string, string>([[DISK, FILE]]);
    const attached = await attachCanvasPersistence(new Y.Doc(), io(files), DISK, {
      scheduler: inert,
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: false },
    });
    expect(attached.coldOpen).toBe("empty");
    expect(typeof attached.persistence.isWriteWithheld).toBe("function");
    attached.persistence.destroy();
  });
});
