// WP29 / AC2 blind1 — the retention claim attacked as a SET-DIFFERENCE over the
// serialized projection, on an edge-dominated board.
//
// The visible test compares two seed boundaries and reads id lists. This one
// never mentions the second boundary: it takes the board's canonical `.canvas`
// projection before the host seed and after it, and asserts that the id set only
// ever GREW. "Removed nothing" is then a property of the diff rather than a list
// of ids someone had to remember to name — a fixture that later gains a record
// is covered without the test being edited.
//
// The board is chosen so that a record-level deletion CASCADES: `hub` is the
// endpoint of three peer edges, and `buildCanvasData` prunes an edge whose
// endpoint node is gone. So a seed that deletes one node the file omits loses
// four records from the projection, and a test that only counted nodes would
// under-report the damage by three.
//
// The host's file mentions exactly ONE of the six records on the board.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasSync,
  buildCanvasData,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";

const PATH = "ops/runbook.canvas";

function node(id: string, x: number, text: string) {
  return { id, type: "text", x, y: 0, width: 180, height: 90, text };
}
function link(id: string, from: string, to: string) {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

// On the shared board: one card the host's file also knows, one hub, and three
// spokes hanging off the hub.
const DOC_RECORDS = {
  nodes: [
    node("known", 0, "shared step"),
    node("hub", 300, "escalation"),
    node("spoke-a", 600, "page oncall"),
    node("spoke-b", 900, "open incident"),
  ],
  edges: [link("hub-a", "hub", "spoke-a"), link("hub-b", "hub", "spoke-b")],
};

// The host has been offline. Its file knows `known` only — and knows it with an
// older body.
const HOST_FILE = JSON.stringify({
  nodes: [{ ...node("known", 0, "shared step (host's copy)") }],
  edges: [],
});

function vaultDouble(content: string) {
  const files = new Map<string, string>([[PATH, content]]);
  return {
    files,
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    adapter: {
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
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

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

function populate(doc: Y.Doc): void {
  doc.transact(() => {
    for (const source of DOC_RECORDS.nodes) {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set(source.id, record);
      for (const [k, v] of Object.entries(source)) record.set(k, v);
    }
    for (const source of DOC_RECORDS.edges) {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("edges").set(source.id, record);
      for (const [k, v] of Object.entries(source)) record.set(k, v);
    }
  });
}

/** Every id the board projects, nodes and edges together, as one sorted list. */
function projectedIds(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
  return [...data.nodes.map((n) => String(n.id)), ...data.edges.map((e) => String(e.id))].sort();
}

async function seedFromHostFile(fileContent: string) {
  const vault = vaultDouble(fileContent);
  const sync = syncDouble();
  const doc = sync.getDoc(canvasDocId(PATH)).doc;
  populate(doc);
  const before = projectedIds(doc);

  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never,
  );
  canvasSync.setLogger({ debug: () => {}, warn: () => {} });
  await canvasSync.subscribe(PATH, "host");

  return { doc, before, after: projectedIds(doc), vault, close: () => canvasSync.destroy() };
}

describe("WP29 AC2 blind1 — the host seed's set difference is empty in the losing direction", () => {
  it("nothing that was on the board before the seed is missing after it", async () => {
    const { before, after, close } = await seedFromHostFile(HOST_FILE);
    const lost = before.filter((id) => !after.includes(id));
    expect(lost, "the host seed removed records the file did not mention (R4)").toEqual([]);
    close();
  });

  it("the cascade is measured, not assumed: the hub's edges are still projected", async () => {
    // If `hub` were deleted, `buildCanvasData` would prune `hub-a` and `hub-b`
    // as dangling and the node-only oracle above would under-report by two.
    const { after, close } = await seedFromHostFile(HOST_FILE);
    expect(after).toEqual(["hub", "hub-a", "hub-b", "known", "spoke-a", "spoke-b"]);
    close();
  });

  it("the seed did run — the file's older body reached the shared record", async () => {
    const { doc, close } = await seedFromHostFile(HOST_FILE);
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").get("known")?.get("text"),
      "nothing from the host's file reached the doc; the seed is simply gone",
    ).toBe("shared step (host's copy)");
    close();
  });

  it("a file that mentions NOTHING on the board removes nothing", async () => {
    const { before, after, close } = await seedFromHostFile(
      JSON.stringify({ nodes: [node("stranger", 0, "a card nobody else has")], edges: [] }),
    );
    expect(before.every((id) => after.includes(id))).toBe(true);
    expect(after, "the file's own record was not created").toContain("stranger");
    close();
  });

  it("no tombstone is written, so nothing is 'kept' by being suppressed instead", async () => {
    const { doc, close } = await seedFromHostFile(HOST_FILE);
    expect(doc.getMap<unknown>("deleted").size).toBe(0);
    close();
  });

  it("three consecutive rejoins are idempotent on the record set", async () => {
    // A destruction that only bites on a later pass — the shape a
    // "delete once the baseline exists" implementation has — is invisible to a
    // single-seed test.
    const vault = vaultDouble(HOST_FILE);
    const sync = syncDouble();
    const doc = sync.getDoc(canvasDocId(PATH)).doc;
    populate(doc);
    const before = projectedIds(doc);

    for (let attempt = 0; attempt < 3; attempt++) {
      const canvasSync = new CanvasSync(
        vault as never,
        sync as never,
        {
          mutePathEvents: vi.fn(),
          unmutePathEvents: vi.fn(),
        } as never,
      );
      canvasSync.setLogger({ debug: () => {}, warn: () => {} });
      await canvasSync.subscribe(PATH, "host");
      expect(projectedIds(doc), `rejoin ${attempt + 1} removed a record`).toEqual(before);
      canvasSync.destroy();
    }
  });
});
