// WP29 / AC4, first half — "The `ColdOpenResult` outcomes remain observable."
//
// This is a PRESERVATION criterion attached to a work package whose whole job is
// to add a branch to the function that produces those outcomes. The failure it
// guards against is not that the outcomes stop working; it is that WP29 quietly
// grows a FOURTH one ("known-elsewhere", "skipped", "merged") to describe its
// new branch. A fourth outcome is a breaking change to every caller —
// `attachCanvasPersistence` returns it, and the wiring layer switches on it —
// and it would be invisible to any test that only checks the branch it cares
// about.
//
// So all three outcomes are produced HERE, in one file, from three scenarios,
// and the set of values `coldOpen` can return is asserted as a SET rather than
// one membership at a time. WP29's new branch is required to reuse `"empty"`,
// and the reason it must be `"empty"` and not `"doc-wins"` is asserted as
// behaviour, not as a string: `"doc-wins"` flushes, and flushing an empty
// projection over a `.canvas` file that still holds the user's cards is a
// second, worse data-loss class than the one WP29 exists to remove.
//
// PRODUCTION LINE <-> ASSERTION: `ColdOpenResult` (`canvas-persistence.ts`) and
// the three `return` statements in `coldOpen`. Adding a fourth literal reddens
// `the outcome vocabulary is exactly three values`; making the WP29 branch
// return `"doc-wins"` reddens the no-flush assertion.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, attachCanvasPersistence } from "../../../files/canvas-persistence";
import type { ColdOpenResult } from "../../../files/canvas-persistence";
import {
  CANVAS_PATH,
  canvasJson,
  createManualScheduler,
  createPersistenceIO,
  createTrace,
  surviving,
  textNode,
} from "./harness";

const FILE = canvasJson([textNode("f-1", 0, "on disk")]);

function build(fileContent: string | null) {
  const files = new Map<string, string>();
  if (fileContent !== null) files.set(CANVAS_PATH, fileContent);
  const io = createPersistenceIO(files, createTrace());
  return { files, io, doc: new Y.Doc() };
}

function putRecord(doc: Y.Doc, source: Record<string, unknown>): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(String(source.id), record);
    for (const [k, v] of Object.entries(source)) record.set(k, v);
  });
}

describe("WP29 AC4 — the three ColdOpenResult outcomes stay observable", () => {
  it("`seeded-from-file`: an unknown, empty doc with a file on disk", async () => {
    const { doc, io } = build(FILE);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    expect(surviving(doc).nodes).toEqual(["f-1"]);
    persistence.destroy();
  });

  it("`doc-wins`: a non-empty doc, and the file is never read", async () => {
    const { doc, io, files } = build(FILE);
    putRecord(doc, textNode("d-1", 0, "in the doc"));
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    expect(await persistence.coldOpen()).toBe("doc-wins");
    expect(io.reads, "the doc-wins branch took file input").toEqual([]);
    expect(files.get(CANVAS_PATH)).toContain("d-1");
    persistence.destroy();
  });

  it("`empty`: an unknown, empty doc with no file on disk", async () => {
    const { doc, io } = build(null);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    expect(await persistence.coldOpen()).toBe("empty");
    persistence.destroy();
  });

  it("`empty`: an unknown, empty doc whose file holds no records", async () => {
    const { doc, io } = build(canvasJson([], []));
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    expect(await persistence.coldOpen()).toBe("empty");
    persistence.destroy();
  });

  it("the outcome vocabulary is exactly three values, and WP29 added none", async () => {
    // Every branch `coldOpen` has, driven once each, and the observed values
    // collected into a set. WP29's own branch is in this list and must land on
    // one of the three that already existed.
    const scenarios: { name: string; run: () => Promise<ColdOpenResult> }[] = [
      {
        name: "unknown + file",
        run: async () => {
          const { doc, io } = build(FILE);
          const p = new CanvasPersistence(doc, io, CANVAS_PATH, {
            scheduler: createManualScheduler(),
            seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
          });
          const out = await p.coldOpen();
          p.destroy();
          return out;
        },
      },
      {
        name: "non-empty doc",
        run: async () => {
          const { doc, io } = build(FILE);
          putRecord(doc, textNode("d-1", 0, "in the doc"));
          const p = new CanvasPersistence(doc, io, CANVAS_PATH, {
            scheduler: createManualScheduler(),
            seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
          });
          const out = await p.coldOpen();
          p.destroy();
          return out;
        },
      },
      {
        name: "no file",
        run: async () => {
          const { doc, io } = build(null);
          const p = new CanvasPersistence(doc, io, CANVAS_PATH, {
            scheduler: createManualScheduler(),
            seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
          });
          const out = await p.coldOpen();
          p.destroy();
          return out;
        },
      },
      {
        name: "WP29: empty doc the sidecar knows",
        run: async () => {
          const { doc, io } = build(FILE);
          const p = new CanvasPersistence(doc, io, CANVAS_PATH, {
            scheduler: createManualScheduler(),
            seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: false },
          });
          const out = await p.coldOpen();
          p.destroy();
          return out;
        },
      },
      {
        name: "WP29: empty doc a peer knows",
        run: async () => {
          const { doc, io } = build(FILE);
          const p = new CanvasPersistence(doc, io, CANVAS_PATH, {
            scheduler: createManualScheduler(),
            seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
          });
          const out = await p.coldOpen();
          p.destroy();
          return out;
        },
      },
    ];

    const observed = new Set<string>();
    for (const scenario of scenarios) {
      const out = await scenario.run();
      expect(typeof out, `${scenario.name} did not return a string outcome`).toBe("string");
      observed.add(out);
    }

    expect(
      [...observed].sort(),
      "coldOpen produced an outcome outside the pinned vocabulary",
    ).toEqual(["doc-wins", "empty", "seeded-from-file"]);
  });

  it("the WP29 branch is `empty` and NOT `doc-wins` — it must not flush", async () => {
    // The behavioural reason for the choice. `doc-wins` calls `flush()`, and on
    // an empty doc that writes `{"nodes":[],"edges":[]}` over a file that still
    // holds the user's cards. The `empty` outcome writes nothing at all.
    const { doc, io, files } = build(FILE);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    });
    expect(await persistence.coldOpen()).toBe("empty");
    expect(io.writes, "the no-seed branch flushed an empty board onto the user's file").toEqual([]);
    expect(files.get(CANVAS_PATH)).toBe(FILE);
    persistence.destroy();
  });

  it("`attachCanvasPersistence` still hands the outcome back with the instance", async () => {
    // The outcome is only "observable" if the wiring layer can still see it.
    const { doc, io } = build(FILE);
    const attached = await attachCanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
    });
    expect(Object.keys(attached).sort()).toEqual(["coldOpen", "persistence"]);
    expect(attached.coldOpen).toBe("empty");
    expect(attached.persistence).toBeInstanceOf(CanvasPersistence);
    attached.persistence.destroy();
  });

  it("a destroyed writer still answers `empty`, as it always did", async () => {
    const { doc, io } = build(FILE);
    const persistence = new CanvasPersistence(doc, io, CANVAS_PATH, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    persistence.destroy();
    expect(await persistence.coldOpen()).toBe("empty");
    expect(io.reads).toEqual([]);
  });
});
