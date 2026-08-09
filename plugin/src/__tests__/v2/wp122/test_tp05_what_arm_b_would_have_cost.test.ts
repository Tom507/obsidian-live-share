// WP122 — THE DESIGN FORK, DEMONSTRATED RATHER THAN ASSERTED.
//
// The owner delegated the choice between two arms and delegated it on one
// condition: the decision arrives ARGUED AND BROKEN, including what would have
// gone wrong had the other arm been built.
//
//   (a) attach, and let the cold open flush.        ← BUILT
//   (b) attach with the cold open suppressed.       ← this file
//
// (b)'s pitch is that WP79 AC4 then survives literally: the pass writes nothing.
// The three rows below measure what that would actually have cost. NOTHING HERE
// IS WIRED INTO THE PRODUCT — arm (b) is composed inside the test, out of the
// real `CanvasPersistence`, purely so its cost is a measurement instead of a
// paragraph.
//
// THE STRUCTURAL FACT THE ROWS TURN ON, and it is checkable by grep in the
// product: `coldOpen` is the ONLY caller of BOTH
//
//   ├── `hydrateDurableRefusals`            (`canvas-persistence.ts`, WP90) and
//   └── `preserveRecordsTheDocDoesNotKnow`  (`canvas-persistence.ts`, WP121)
//
// so an attach that suppresses the cold open does not merely decline to write —
// it removes the two guards that make writing safe, and then writes anyway at
// the first remote delta, because `start()` installs the observer regardless.
// (b) therefore does not avoid the overwrite. It postpones it and strips it.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../files/canvas-persistence";
import { createManualScheduler } from "../wp29/harness";
import { BOARD, SHARED, authorSpelling, node, recordIdsIn, seedDoc } from "./harness";

/** The host's disk plus the two seams, so both arms run over identical inputs. */
function rig() {
  const files = new Map<string, string>([
    // `f9` exists only on disk; the document has never heard of it.
    [BOARD, authorSpelling([node("h1"), node("f9")])],
  ]);
  const io: PersistenceIO = {
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };
  const doorRead = vi.fn(async (p: string) => (files.has(p) ? (files.get(p) as string) : null));
  const doorWrite = vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  });
  const doc = new Y.Doc();
  seedDoc(doc, [node("h1"), node("g1")]);
  return {
    files,
    io,
    doc,
    scheduler: createManualScheduler(),
    door: {
      sharedFolder: SHARED,
      read: doorRead,
      write: doorWrite,
      now: () => new Date(2026, 7, 8, 17, 42, 3),
    },
    doorRead,
    doorWrite,
    copies: () => [...files.keys()].filter((p) => p !== BOARD),
  };
}

async function drain(scheduler: ReturnType<typeof createManualScheduler>): Promise<void> {
  scheduler.runAll();
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("WP122 — arm (a), the one that was built", () => {
  it("tp05a: the cold open reads the preservation door, copies what the doc does not know, then flushes", async () => {
    const r = rig();
    const { persistence } = await attachCanvasPersistence(r.doc, r.io, BOARD, {
      scheduler: r.scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" },
      preserveDiscarded: r.door,
    });

    expect(r.doorRead).toHaveBeenCalledTimes(1);
    expect(r.copies()).toHaveLength(1);
    expect(recordIdsIn(r.files.get(r.copies()[0])).nodes).toStrictEqual(["f9", "h1"]);
    expect(recordIdsIn(r.files.get(BOARD)).nodes).toStrictEqual(["g1", "h1"]);
    persistence.destroy();
  });
});

describe("WP122 — arm (b), composed here only to price it", () => {
  it("tp05b: 🔴 suppressing the cold open does NOT stop the overwrite — it only delays it", async () => {
    const r = rig();
    // Arm (b): construct the writer and `start()` it, with no `coldOpen()`.
    // This is the whole of what "attach with the cold open suppressed" means.
    const persistence = new CanvasPersistence(r.doc, r.io, BOARD, {
      scheduler: r.scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" },
      preserveDiscarded: r.door,
    });
    persistence.start();

    // At this instant (b) is telling the truth: nothing has been written.
    expect(r.io.write).not.toHaveBeenCalled();
    expect(recordIdsIn(r.files.get(BOARD)).nodes).toStrictEqual(["f9", "h1"]);

    // …and then the first remote delta arrives, which is the event the whole
    // package exists to make converge.
    seedDoc(r.doc, [node("g2")]);
    await drain(r.scheduler);

    // The file is overwritten with the document's projection, exactly as under
    // arm (a) — `f9` is gone.
    expect(recordIdsIn(r.files.get(BOARD)).nodes).toStrictEqual(["g1", "g2", "h1"]);
    persistence.destroy();
  });

  it("tp05c: 🔴 …and it overwrites with WP121's copy NEVER TAKEN and WP90's refusals NEVER HYDRATED", async () => {
    const r = rig();
    const persistence = new CanvasPersistence(r.doc, r.io, BOARD, {
      scheduler: r.scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" },
      preserveDiscarded: r.door,
    });
    persistence.start();
    seedDoc(r.doc, [node("g2")]);
    await drain(r.scheduler);

    // THE COST, in one line: the same bytes landed, and the guard that would
    // have preserved `f9` beside the share was never consulted.
    expect(r.doorRead).not.toHaveBeenCalled();
    expect(r.doorWrite).not.toHaveBeenCalled();
    expect(r.copies()).toStrictEqual([]);
    // `f9` is gone from the only place it existed.
    expect(recordIdsIn(r.files.get(BOARD)).nodes).not.toContain("f9");
    persistence.destroy();
  });

  it("tp05d: and the writer would still hold no baseline, so its first flush is unconditional", async () => {
    // A second, quieter cost. `coldOpen`'s `doc-wins` flush is what establishes
    // `lastWrittenContent`; without it the redundant-write skip has nothing to
    // compare against, so arm (b)'s first flush writes whatever the doc holds
    // whether or not the file already agreed with it.
    const r = rig();
    // Make the file ALREADY agree with the document, so under arm (a) the
    // second cold open would have nothing left to write.
    const persistence = new CanvasPersistence(r.doc, r.io, BOARD, {
      scheduler: r.scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" },
    });
    persistence.start();
    seedDoc(r.doc, [node("g2")]);
    await drain(r.scheduler);
    expect(r.io.write).toHaveBeenCalledTimes(1);
    persistence.destroy();
  });
});

describe("WP122 — the structural fact both arms turn on", () => {
  it("tp05e: `coldOpen` is the only caller of the two guards, read from the product source", async () => {
    // A grep-shaped assertion, and workflow §3.4 is explicit that grep cannot
    // support an exhaustiveness claim about CALLBACKS. These two are not
    // callbacks: they are private methods of one class, called by name, so the
    // set of call sites IS the set of textual occurrences inside this one file.
    // That is the narrow case where the method is sound, and it is stated here
    // rather than assumed.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "..", "..", "files", "canvas-persistence.ts"),
      "utf8",
    );
    for (const guard of ["hydrateDurableRefusals", "preserveRecordsTheDocDoesNotKnow"]) {
      const calls = [...src.matchAll(new RegExp(`this\\.${guard}\\(`, "g"))];
      expect(calls).toHaveLength(1);
      // …and that one call sits inside `coldOpen`, i.e. after its declaration
      // and before the next method's.
      const coldOpenAt = src.indexOf("async coldOpen(");
      const callAt = src.indexOf(`this.${guard}(`);
      expect(coldOpenAt).toBeGreaterThan(0);
      expect(callAt).toBeGreaterThan(coldOpenAt);
      expect(src.slice(coldOpenAt, callAt)).not.toMatch(/\n  (private|public|async) \w+\(/);
    }
  });
});
