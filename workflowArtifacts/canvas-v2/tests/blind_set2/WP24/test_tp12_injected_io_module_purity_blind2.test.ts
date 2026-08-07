// WP24 / AC4 blind2 — "all file I/O is injected" checked as a BEHAVIOURAL
// property of every store method, plus single-source-of-truth for the directory
// literal.
//
// Different angle: the visible test and blind1 both read the source. A source
// scan proves the module does not import a filesystem; it does not prove that
// every operation actually goes through the injected seam. A store that cached
// a doc in a module-level map and served `load` from it would pass every token
// scan and silently return stale state to WP25. So the first block drives all
// six store operations against a counting IO and demands that each one touches
// the seam.
//
// The second block pins the directory literal to ONE occurrence. The Shared
// Ownership Contract forbids re-spelling `.obsidian/liveshare/state` anywhere;
// a second copy inside the owning module itself is where that drift starts.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";

const SOURCE = readFileSync(
  new URL("../../../../../plugin/src/files/canvas-sidecar.ts", import.meta.url),
  "utf8",
);

const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function countingIO() {
  const touched: string[] = [];
  const disk = new Map<string, Uint8Array>();
  return {
    touched,
    disk,
    ensureDir: async (): Promise<void> => {
      touched.push("ensureDir");
    },
    exists: async (p: string): Promise<boolean> => {
      touched.push("exists");
      return disk.has(p);
    },
    read: async (p: string): Promise<Uint8Array> => {
      touched.push("read");
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      touched.push("write");
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      touched.push("append");
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      touched.push("truncate");
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      touched.push("remove");
      disk.delete(p);
    },
  };
}

describe("WP24 AC4 blind2 — every store operation reaches the injected seam", () => {
  it.each([
    ["append", async (s: ReturnType<typeof createSidecarStore>) => s.append("g", firstUpdate())],
    ["checkpoint", async (s: ReturnType<typeof createSidecarStore>) => s.checkpoint("g", new Y.Doc())],
    ["load", async (s: ReturnType<typeof createSidecarStore>) => s.load("g", new Y.Doc())],
    ["truncate", async (s: ReturnType<typeof createSidecarStore>) => s.truncate("g")],
    ["readIndex", async (s: ReturnType<typeof createSidecarStore>) => s.readIndex()],
    ["writeIndex", async (s: ReturnType<typeof createSidecarStore>) => s.writeIndex({ g: "A.canvas" })],
  ])("%s touches the io", async (_label, run) => {
    const io = countingIO();
    const store = createSidecarStore(io);

    await run(store);

    expect(io.touched.length).toBeGreaterThan(0);
  });

  it("two stores over two different ios never see each other's data", async () => {
    // The module-level cache defect: same guid, two independent disks.
    const ioA = countingIO();
    const ioB = countingIO();
    const storeA = createSidecarStore(ioA);
    const storeB = createSidecarStore(ioB);

    const doc = new Y.Doc();
    doc.getMap("nodes").set("only-in-a", { v: 1 });
    await storeA.checkpoint("shared-guid", doc);

    const fromB = new Y.Doc();
    const result = await storeB.load("shared-guid", fromB);

    expect(fromB.getMap("nodes").toJSON()).toEqual({});
    expect(result.checkpointApplied).toBe(false);
    expect(ioB.disk.size).toBe(0);
  });

  it("a store built over a frozen, empty io object still behaves", async () => {
    const io = Object.freeze(countingIO());
    const store = createSidecarStore(io);

    const result = await store.load("frozen", new Y.Doc());

    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
  });
});

describe("WP24 AC4 blind2 — the directory literal exists exactly once", () => {
  it("`.obsidian/liveshare/state` is written out once in the code", () => {
    const occurrences = CODE.split(".obsidian/liveshare/state").length - 1;
    expect(occurrences).toBe(1);
    expect(SIDECAR_DIR).toBe(".obsidian/liveshare/state");
  });

  it("no second spelling of the directory sneaks in via segments", () => {
    expect(CODE.split('"liveshare"').length - 1).toBe(0);
    expect(CODE.split('"state"').length - 1).toBe(0);
    expect(CODE.split('".obsidian"').length - 1).toBe(0);
  });

  it("neither Obsidian nor a filesystem module is imported", () => {
    expect(CODE).not.toMatch(/from\s*["']obsidian["']/);
    expect(CODE).not.toMatch(/from\s*["'](?:node:)?fs/);
    expect(CODE).not.toMatch(/from\s*["'](?:node:)?path["']/);
  });
});

function firstUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const captured: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => captured.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("probe", { v: 1 });
  return captured[0];
}
