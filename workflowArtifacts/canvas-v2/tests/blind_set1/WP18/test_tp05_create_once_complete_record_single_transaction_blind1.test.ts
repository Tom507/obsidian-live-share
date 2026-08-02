// WP18 AC2 blind1 — create-once, approached through the HOST SEED and through
// a repeated CAPTURE pass rather than through cold open.
//
//   ├── A: the host seed's EDGE container is observed exactly once, and the key
//   │      set each edge has at that single observation is ALREADY its final
//   │      key set. That oracle is vocabulary-free on purpose — it does not care
//   │      whether the seed writes flat endpoint keys or composite registers,
//   │      only that nothing arrives late. The migration call site lives in
//   │      `CanvasPersistence.coldOpen()` and does not run on this path, so a
//   │      second write here could only be a half-built record.
//   └── B: a later save that edits an existing record MERGES into the record's
//          existing container. Identity is the oracle — it is the only property
//          that separates a per-field merge from `set(id, new Y.Map())`, and
//          copying the fields across cannot forge it.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "assembly.canvas";

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
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

const K = { id: "k", type: "text", x: 0, y: 0, width: 120, height: 60, text: "k" };
const L = { id: "l", type: "text", x: 400, y: 0, width: 120, height: 60, text: "l" };
const E_A = { id: "ea", fromNode: "k", fromSide: "right", toNode: "l", toSide: "left" };
const E_B = { id: "eb", fromNode: "l", fromSide: "bottom", toNode: "k", toSide: "top" };

describe("WP18 AC2 blind1 — a record becomes visible whole, and its container is never replaced", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A the host seed's edges appear in one observation, already carrying their final key set", async () => {
    const vault = createVault({ [PATH]: canvasJson([K, L], [E_A, E_B]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    let observations = 0;
    const keysAtFirstSight = new Map<string, string[]>();
    const observer = () => {
      observations++;
      if (observations > 1) return;
      for (const [id, record] of edges) keysAtFirstSight.set(id, [...record.keys()].sort());
    };
    edges.observeDeep(observer);

    await cs.subscribe(PATH, "host");
    edges.unobserveDeep(observer);

    expect(
      observations,
      "the seed built its edges over more than one transaction — a half-built edge was observable",
    ).toBe(1);
    expect(
      [...keysAtFirstSight.keys()].sort(),
      "the two edges did not become visible in the same transaction",
    ).toEqual(["ea", "eb"]);

    for (const [id, record] of edges) {
      const finalKeys = [...record.keys()].sort();
      expect(finalKeys.length, `edge ${id} ended up with nothing but an id`).toBeGreaterThan(1);
      expect(
        keysAtFirstSight.get(id),
        `edge ${id} gained fields after it was already visible in the doc`,
      ).toEqual(finalKeys);
    }

    cs.destroy();
  });

  it("B a later save merges into the existing container rather than replacing it", async () => {
    const vault = createVault({ [PATH]: canvasJson([K, L], [E_A]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const containerBefore = nodes.get("k");
    expect(containerBefore, "the seed created nothing to compare against").toBeDefined();

    vault.files.set(PATH, canvasJson([{ ...K, text: "k edited" }, L], [E_A]));
    await cs.handleLocalModify(PATH);

    expect(
      nodes.get("k"),
      "the capture pass replaced the record container: `set(id, new Y.Map())` over an existing id",
    ).toBe(containerBefore);
    expect(nodes.get("k")?.get("text"), "the edit never landed — this probe is vacuous").toBe(
      "k edited",
    );

    cs.destroy();
  });
});
