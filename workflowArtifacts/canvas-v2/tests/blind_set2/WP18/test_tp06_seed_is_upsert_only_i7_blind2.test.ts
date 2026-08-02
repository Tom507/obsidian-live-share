// WP18 AC3 blind2 — I7 at the seed, tested with the key that is ALWAYS absent
// from the incoming record: `ord`.
//
// `ord` is doc-only. It is never serialised to the `.canvas` file and is
// therefore missing from every observation a seed will ever make, by
// construction rather than by accident. A seed that deletes doc keys absent
// from the file does not merely risk stripping `ord` — it strips it on every
// single seed, from every record, which quietly destroys V2's order model. No
// widening of a guard list would have caught it either, because `ord` was
// invented after the list.
//
// The record is otherwise the shape a migrated doc really holds: registers,
// leftover flat keys, and content. All of it must survive an observation that
// mentions none of it.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { V2_FIELD, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "ordered.canvas";

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

/** The file's view: the same two cards, and of course no `ord` anywhere. */
const FILE_M1 = { id: "m1", type: "text", x: 10, y: 10, width: 240, height: 120, text: "m1 new" };
const FILE_M2 = { id: "m2", type: "text", x: 300, y: 10, width: 240, height: 120, text: "m2" };

describe("WP18 AC3 blind2 — the doc-only `ord` survives a seed that never mentions it", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("`ord`, the registers and the leftover flat keys all survive the host seed", async () => {
    const vault = createVault({ [PATH]: canvasJson([FILE_M1, FILE_M2]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    // The doc looks like a freshly migrated V2 doc: registers PLUS the flat V1
    // keys the additive migration deliberately left in place, plus `ord`.
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      for (const [id, ord, text] of [
        ["m1", "a0", "m1 old"],
        ["m2", "a1", "m2"],
      ] as const) {
        const record = new Y.Map<unknown>();
        nodes.set(id, record);
        record.set(V2_FIELD.id, id);
        record.set(V2_FIELD.type, "text");
        record.set(V2_FIELD.pos, encodePos(10, 10));
        record.set(V2_FIELD.size, encodeSize(240, 120));
        record.set(V2_FIELD.ord, ord);
        record.set(V2_FIELD.text, text);
        // Leftovers from the additive migration.
        record.set("x", 10);
        record.set("y", 10);
      }
    });

    await cs.subscribe(PATH, "host");

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    expect([...nodes.keys()].sort(), "a record was removed by the seed").toEqual(["m1", "m2"]);

    expect(
      nodes.get("m1")?.get(V2_FIELD.ord),
      "the seed stripped `ord` — a key the file can never contain (I7)",
    ).toBe("a0");
    expect(
      nodes.get("m2")?.get(V2_FIELD.ord),
      "the seed stripped `ord` — a key the file can never contain (I7)",
    ).toBe("a1");

    // The additive migration's leftovers are not swept either.
    expect(nodes.get("m1")?.get("x"), "the seed deleted a leftover flat key").toBe(10);

    // ... and the observation still landed.
    expect(nodes.get("m1")?.get(V2_FIELD.text), "the file's own value never reached the doc").toBe(
      "m1 new",
    );

    cs.destroy();
  });
});
