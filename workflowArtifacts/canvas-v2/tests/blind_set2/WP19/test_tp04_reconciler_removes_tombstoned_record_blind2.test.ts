// WP19 AC2 blind2 — the view-removal rule at the GUEST JOIN, not at a delta.
//
// `CanvasSync.subscribe(path, "guest")` drives one authoritative reconcile of
// its own, straight after `waitForSync`, because the observer fires on
// SUBSEQUENT deltas and never on the state that was already there when the
// client joined. That is a separate `buildCanvasData` call site from the one the
// observer uses, and it is the one a joining client's whole first impression of
// the board depends on.
//
// It is also the call site where a tombstone is oldest: nobody deletes anything
// during this test at all. The `deleted` container is simply part of the state
// the room hands the newcomer, exactly as a relay would deliver it. A guest that
// ignores it opens the canvas showing cards every other participant deleted
// hours ago — and then saves that view.
//
// The doc is populated BEFORE `subscribe`, through the same doc instance the
// sync manager will hand to `CanvasSync`, so the join sees pre-existing shared
// truth rather than anything this client authored.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "shared/onboarding.canvas";

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

function seedNode(
  nodes: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries({ id, ...fields })) record.set(key, value);
  nodes.set(id, record);
}

function seedEdge(
  edges: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries({ id, ...fields })) record.set(key, value);
  edges.set(id, record);
}

function ids(records: Record<string, unknown>[]): string[] {
  return records.map((record) => String(record.id)).sort();
}

describe("WP19 AC2 blind2 — a joining guest is never shown a record the room already deleted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the guest's authoritative first reconcile omits the tombstoned card and its arrow", async () => {
    const syncManager = createSyncManager();
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    // Shared truth as the relay hands it over: three cards, two arrows, and one
    // card that was deleted before this client ever connected.
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    doc.transact(() => {
      seedNode(nodes, "intro", { type: "text", x: 0, y: 0, width: 200, height: 100, text: "intro" });
      seedNode(nodes, "retired", {
        type: "text",
        x: 400,
        y: 0,
        width: 200,
        height: 100,
        text: "deleted before we joined",
      });
      seedNode(nodes, "next", { type: "text", x: 0, y: 400, width: 200, height: 100, text: "next" });
      seedEdge(edges, "to-retired", {
        fromNode: "intro",
        fromSide: "right",
        toNode: "retired",
        toSide: "left",
      });
      seedEdge(edges, "to-next", {
        fromNode: "intro",
        fromSide: "bottom",
        toNode: "next",
        toSide: "top",
      });
      applyTombstoneOp(doc.getMap<unknown>("deleted"), "retired", {
        t: 21,
        by: "peer-host",
        on: true,
      });
    });

    const vault = createVault();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    const handed: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] = [];
    cs.setOnRemoteCanvasUpdate((_path, data) => {
      handed.push(data);
    });

    await cs.subscribe(PATH, "guest");

    expect(
      handed.length,
      "the guest join drove no authoritative reconcile at all",
    ).toBeGreaterThan(0);
    const first = handed[0];
    expect(
      ids(first.nodes),
      "the guest was shown a card the room had already deleted",
    ).toEqual(["intro", "next"]);
    expect(
      ids(first.edges),
      "the arrow into the deleted card was drawn for the guest",
    ).toEqual(["to-next"]);

    expect(
      ids(cs.getCanvasSnapshot(PATH)?.nodes ?? []),
      "`getCanvasSnapshot` reports the deleted card as shared truth",
    ).toEqual(["intro", "next"]);

    // Nothing was destroyed to achieve it — the record is still recoverable.
    expect([...nodes.keys()].sort()).toEqual(["intro", "next", "retired"]);
    expect(nodes.get("retired")?.get("text")).toBe("deleted before we joined");

    cs.destroy();
  });
});
