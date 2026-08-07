// WP20 AC1 blind2 — FOUR faults of four different reason codes in ONE doc, so a
// pass that quarantines the first thing it finds and falls through cannot pass.
//
// WP14 distinguishes MISSING_X from INVALID_X on purpose ("missing is not the
// same as broken"), and each conjunct is a separate branch of the validator.
// A single-victim test exercises exactly one of those branches; an auditor that
// only handles the branch that test picked looks completely healthy. So the
// doc here carries, at once:
//
//   ├── MISSING_TYPE          — a node with no `type` at all,
//   ├── INVALID_POS           — a `pos` that is present but is not a register,
//   ├── INVALID_TYPE_SPECIFIC — a `file` node whose `file` is the empty string
//   │                            (an empty path addresses nothing; the empty
//   │                            TEXT of a text node is a different matter and
//   │                            is legal — see the control below), and
//   └── MISSING_ID            — a record whose `id` key never arrived.
//
// Two controls carry the other half of the statement: a plain healthy card, and
// an EMPTY text card, which is a legal JSON Canvas node (E1-b ruling) and whose
// quarantine would delete every not-yet-typed card on the board.
//
// The oracle is set-shaped throughout — the exact quarantined set, the exact
// surviving key sets, and every field container compared whole — because the
// failure this catches is a MISSING quarantine among several, which any
// "expect(x).toBe(true)" on one id would sail straight past.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "kitchen-sink.canvas";

const ALL_IDS = ["healthy", "blank", "typeless", "scrambled", "emptypath", "nameless"] as const;

function createVault() {
  const files = new Map<string, string>();
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

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

describe("WP20 AC1 blind2 — four different schema failures are all quarantined in one pass", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("quarantines exactly the four broken records and keeps every field container of all six", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "healthy",
        record({
          id: "healthy",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
          text: "a card",
        }),
      );
      // LEGAL: an empty card the user has not typed into yet (E1-b ruling).
      space.set(
        "blank",
        record({
          id: "blank",
          type: "text",
          pos: encodePos(300, 0),
          size: encodeSize(200, 100),
          text: "",
        }),
      );
      space.set(
        "typeless",
        record({ id: "typeless", pos: encodePos(600, 0), size: encodeSize(200, 100), text: "x" }),
      );
      space.set(
        "scrambled",
        record({
          id: "scrambled",
          type: "text",
          pos: { x: 900, y: 0 },
          size: encodeSize(200, 100),
          text: "y",
        }),
      );
      space.set(
        "emptypath",
        record({
          id: "emptypath",
          type: "file",
          pos: encodePos(1200, 0),
          size: encodeSize(200, 100),
          file: "",
        }),
      );
      space.set(
        "nameless",
        record({ type: "text", pos: encodePos(1500, 0), size: encodeSize(200, 100), text: "z" }),
      );
    });

    const keysBefore = [...nodes.keys()].sort();
    const containersBefore = new Map(ALL_IDS.map((id) => [id, nodes.get(id)]));
    const fieldsBefore = new Map(ALL_IDS.map((id) => [id, nodes.get(id)?.toJSON()]));
    for (const id of ALL_IDS) {
      expect(containersBefore.get(id), `the fault injection never created ${id}`).toBeDefined();
    }

    audit();
    audit();

    expect(
      ALL_IDS.filter((id) => isTombstoneQuarantined(readTombstoneEntry(deleted, id))).sort(),
      "the quarantine set is wrong — a schema failure was missed, or a legal record was taken",
    ).toEqual(["emptypath", "nameless", "scrambled", "typeless"]);

    // NEVER DESTROYED — every one of the six, broken or not.
    expect(
      [...nodes.keys()].sort(),
      "the audit removed a record key: quarantine destroyed instead of suppressing",
    ).toEqual(keysBefore);
    for (const id of ALL_IDS) {
      expect(nodes.get(id), `the container for ${id} was replaced`).toBe(containersBefore.get(id));
      expect(nodes.get(id)?.toJSON(), `${id} lost field values`).toEqual(fieldsBefore.get(id));
    }

    // Only the two legal cards are rendered.
    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id).sort(),
      "the rendered set is wrong: exactly the healthy card and the empty card may show",
    ).toEqual(["blank", "healthy"]);

    client.cs.destroy();
  });
});
