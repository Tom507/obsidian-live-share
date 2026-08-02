// WP18 AC2 blind2 — create-once ACROSS the two seed boundaries.
//
// A record created by `CanvasPersistence.coldOpen()` is then met by
// `CanvasSync.subscribe(path, "host")` on the same doc. That is the real
// sequence on a rejoin, and it is the one place where two different writers
// reach the same id — so it is where `set(id, new Y.Map())` over an existing
// container would actually happen.
//
//   ├── A: the FIRST time the seed's records are observable, none of them is a
//   │      husk — each already carries more than its bare id. The observation
//   │      COUNT is deliberately not pinned: the migration call site runs after
//   │      the seed, so a second write to the same container is expected and is
//   │      not evidence of a half-built record.
//   └── B: after the host seed has run over the same doc, every container is
//          the SAME object, and a peer's field written in between is still
//          there. Copying the fields across cannot forge object identity.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "rejoin.canvas";

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createIO(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const io = {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string> };
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

/** A sync manager that hands out ONE pre-built doc, so both writers share it. */
function createSyncManagerFor(docId: string, doc: Y.Doc) {
  return {
    getDoc(requested: string) {
      if (requested !== docId) return null;
      return { doc, text: doc.getText("content"), awareness: {} };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

const CARDS = [
  { id: "c1", type: "text", x: 0, y: 0, width: 180, height: 90, text: "one" },
  { id: "c2", type: "text", x: 200, y: 0, width: 180, height: 90, text: "two" },
  { id: "c3", type: "text", x: 400, y: 0, width: 180, height: 90, text: "three" },
];

describe("WP18 AC2 blind2 — a seeded container is created whole and never replaced afterwards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold open creates whole records, and the host seed that follows keeps every container", async () => {
    const doc = new Y.Doc();
    const content = canvasJson(CARDS);
    const io = createIO({ [PATH]: content });
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    // ── A: nothing is ever observed as a husk ─────────────────────────────
    let observations = 0;
    const sizesAtFirstSight: Record<string, number> = {};
    const idsAtFirstSight: Record<string, unknown> = {};
    const observer = () => {
      observations++;
      if (observations > 1) return;
      for (const [id, record] of nodes) {
        sizesAtFirstSight[id] = record.size;
        idsAtFirstSight[id] = record.get("id");
      }
    };
    nodes.observeDeep(observer);

    const persistence = new CanvasPersistence(doc, io, PATH, {
      logger: { debug: () => {}, warn: () => {} },
    });
    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    nodes.unobserveDeep(observer);
    persistence.destroy();

    expect(observations, "the seed produced no observable write at all").toBeGreaterThan(0);
    expect(
      Object.keys(sizesAtFirstSight).sort(),
      "the three records did not become visible in the same transaction",
    ).toEqual(["c1", "c2", "c3"]);
    for (const [id, size] of Object.entries(sizesAtFirstSight)) {
      expect(size, `record ${id} was attached to the doc before it carried its payload`).toBeGreaterThan(
        1,
      );
      expect(idsAtFirstSight[id], `record ${id} was observable before it carried its own id`).toBe(
        id,
      );
    }

    const containers = new Map<string, Y.Map<unknown>>();
    for (const [id, record] of nodes) containers.set(id, record);

    // A peer decorates one of them before we re-seed.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap<Y.Map<unknown>>("nodes").get("c2")?.set("color", "1");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    peer.destroy();

    // ── B: the host seed meets records that already exist ─────────────────
    const vault = createVault({ [PATH]: content });
    const syncManager = createSyncManagerFor(`__canvas__:${PATH}`, doc);
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    await cs.subscribe(PATH, "host");

    for (const [id, container] of containers) {
      expect(
        nodes.get(id),
        `the host seed replaced the container for ${id}: \`set(id, new Y.Map())\` over an existing id`,
      ).toBe(container);
    }
    expect(
      nodes.get("c2")?.get("color"),
      "the peer's concurrent field was discarded by the re-seed",
    ).toBe("1");

    cs.destroy();
    doc.destroy();
  });
});
