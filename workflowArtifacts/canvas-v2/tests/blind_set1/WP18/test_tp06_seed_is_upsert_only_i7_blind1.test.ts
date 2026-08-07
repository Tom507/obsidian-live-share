// WP18 AC3 blind1 — I7 at the seed, with the emphasis moved from "which keys
// are protected" to "membership is not what decides".
//
// Three doc keys the incoming file record does not mention:
//   ├── `color`           — a normal content key, never guarded
//   ├── `backgroundStyle` — a V2 field key, never guarded
//   └── `pluginMeta`      — a key no schema in this project knows about at all
//
// All three must survive, and so must the edge's `label`. A boundary that
// merely widened its guard list would still drop `pluginMeta`, because no list
// can enumerate a key a future peer invents. Upsert-only is the only shape that
// survives an unknown key, which is exactly why I7 is stated as a property and
// not as a set.
//
// The mirror assertion — the file's own values LAND — keeps a boundary that
// simply stopped writing from passing.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "notes.canvas";

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

function putRecord(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  container.set(id, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

/** What THIS client's file says — valid, but poorer than the doc. */
const FILE_S1 = { id: "s1", type: "file", x: 40, y: 40, width: 300, height: 200, file: "a.md" };
const FILE_S2 = { id: "s2", type: "file", x: 500, y: 40, width: 300, height: 200, file: "b.md" };
const FILE_LINK = {
  id: "link",
  fromNode: "s1",
  fromSide: "right",
  toNode: "s2",
  toSide: "left",
  color: "2",
};

describe("WP18 AC3 blind1 — an unknown key survives the seed exactly as a known one does", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys the file omits are kept — guarded, unguarded and entirely unrecognised alike", async () => {
    const vault = createVault({ [PATH]: canvasJson([FILE_S1, FILE_S2], [FILE_LINK]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      putRecord(nodes, "s1", {
        id: "s1",
        type: "file",
        x: 40,
        y: 40,
        width: 300,
        height: 200,
        file: "a.md",
        color: "6",
        backgroundStyle: "cover",
        pluginMeta: { author: "peer", revision: 3 },
      });
      putRecord(nodes, "s2", {
        id: "s2",
        type: "file",
        x: 500,
        y: 40,
        width: 300,
        height: 200,
        file: "b.md",
      });
      putRecord(edges, "link", {
        id: "link",
        fromNode: "s1",
        fromSide: "right",
        toNode: "s2",
        toSide: "left",
        label: "depends on",
      });
    });

    await cs.subscribe(PATH, "host");

    const s1 = doc.getMap<Y.Map<unknown>>("nodes").get("s1");
    const link = doc.getMap<Y.Map<unknown>>("edges").get("link");
    expect(s1, "the seed removed the node record entirely").toBeDefined();
    expect(link, "the seed removed the edge record entirely").toBeDefined();

    expect(s1?.get("color"), "the seed deleted an unguarded key the file omitted (I7)").toBe("6");
    expect(s1?.get("backgroundStyle"), "the seed deleted a V2 field the file omitted (I7)").toBe(
      "cover",
    );
    expect(
      s1?.get("pluginMeta"),
      "the seed deleted a key no schema knows about — no guard list can ever cover this case",
    ).toEqual({ author: "peer", revision: 3 });
    expect(link?.get("label"), "the seed deleted an edge key the file omitted (I7)").toBe(
      "depends on",
    );

    // The merge really ran: the file's own edge colour landed.
    expect(link?.get("color"), "the file's own value never reached the doc").toBe("2");

    cs.destroy();
  });
});
