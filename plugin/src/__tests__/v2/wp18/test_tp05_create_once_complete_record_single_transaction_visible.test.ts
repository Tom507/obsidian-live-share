// WP18 / AC2 — "Record creation happens in one transaction carrying a complete
// record; no code path calls `set(id, new Y.Map())` for an id that already
// exists."
//
// Two halves, one AC:
//
//   ├── CREATE-ONCE-AND-COMPLETE — the FIRST time the record container is
//   │   observable at all, every record already carries its whole payload.
//   │   The failing shape is `set(id, new Y.Map())` followed by field writes
//   │   the observers can see land one at a time; the passing shape is a
//   │   container that is never observable as a husk.
//   │
//   │   The oracle is the record's own content, NOT the ingest validator: the
//   │   migration call site runs AFTER the seed, so a record is legitimately
//   │   not yet in the V2 vocabulary at the moment the seed publishes it.
//   │   `coldOpen`'s post-condition is pinned separately (TP11).
//   └── NEVER-REPLACE — a second seed over an id the doc already holds merges
//       into the SAME container. Replacing it with a fresh `Y.Map` detaches
//       the record and silently discards a peer's concurrent edit to a
//       different field of it, which is the corruption AC2 forbids by name.
//
// Container identity is the oracle for the second half: it is the one property
// that distinguishes `get(id)` + merge from `set(id, new Y.Map())`, and it
// cannot be faked by copying the fields across.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "board.canvas";

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

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  build(peer.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  peer.destroy();
}

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "first" };
const N2 = { id: "n2", type: "file", x: 400, y: 0, width: 200, height: 100, file: "notes/a.md" };

describe("WP18 AC2 — creation is one transaction carrying a complete record", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every record the cold-open seed creates carries its whole payload the first time it is observable", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [PATH]: canvasJson([N1, N2]) });
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    let observations = 0;
    const firstSight = new Map<string, { size: number; id: unknown; type: unknown }>();
    const observer = () => {
      observations++;
      if (observations > 1) return;
      for (const [id, record] of nodes) {
        firstSight.set(id, { size: record.size, id: record.get("id"), type: record.get("type") });
      }
    };
    nodes.observeDeep(observer);

    const persistence = new CanvasPersistence(doc, io, PATH, {
      logger: { debug: () => {}, warn: () => {} },
    });
    const result = await persistence.coldOpen();
    nodes.unobserveDeep(observer);

    expect(result).toBe("seeded-from-file");
    expect(
      [...firstSight.keys()].sort(),
      "the records did not all become visible in the same transaction",
    ).toEqual(["n1", "n2"]);

    for (const [id, seen] of firstSight) {
      expect(
        seen.size,
        `record ${id} was attached to the doc as a husk and filled in afterwards`,
      ).toBeGreaterThan(1);
      expect(seen.id, `record ${id} was observable before it carried its own id`).toBe(id);
      expect(seen.type, `record ${id} was observable before it carried its type`).toBe(
        id === "n1" ? "text" : "file",
      );
    }

    persistence.destroy();
    doc.destroy();
  });

  it("a second host seed merges into the existing container instead of replacing it", async () => {
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const vault = createVault({ [PATH]: canvasJson([N1]) });

    const first = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    first.setLogger({ debug: () => {}, warn: () => {} });
    await first.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const containerAfterFirstSeed = nodes.get("n1");
    expect(containerAfterFirstSeed, "the first seed created nothing to compare against").toBeDefined();

    // A peer colours the same card while we are away.
    applyRemoteDelta(doc, (peerNodes) => {
      peerNodes.get("n1")?.set("color", "4");
    });

    // A second client re-seeds the very same path from the very same file.
    const second = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    second.setLogger({ debug: () => {}, warn: () => {} });
    await second.subscribe(PATH, "host");

    expect(
      nodes.get("n1"),
      "the re-seed replaced the record container: `set(id, new Y.Map())` over an existing id",
    ).toBe(containerAfterFirstSeed);
    expect(
      nodes.get("n1")?.get("color"),
      "the peer's concurrent field was discarded by the re-seed",
    ).toBe("4");

    first.destroy();
    second.destroy();
  });
});
