// WP19 AC1 blind2 — the delete REPEATED, and the record read back out of a doc
// rebuilt from scratch.
//
// Two things this angle catches that a single delete does not:
//
//   ├── IDEMPOTENCE. Obsidian saves a canvas more than once, and every save
//   │      after a delete still lacks the record. Each of those passes re-states
//   │      the same delete. Under WP12's merge that has to converge: the
//   │      suppression stays on and the record stays whole. An implementation
//   │      that re-writes the record or re-stamps `by` on every pass looks fine
//   │      after one delete and drifts after three.
//   └── DOC REBUILD. `Y.applyUpdate` into a virgin doc reconstructs state from
//          the operation log, so a record that was removed and re-added would
//          come back as a different container with a different history. Reading
//          the rebuilt doc, rather than the live one, removes any chance that a
//          local object reference is flattering the result.
//
// The card carries a `file` reference and a group with a `label`, i.e. fields
// that no geometry or text path touches, so a partial restore is visible.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "library.canvas";

const SHELF = {
  id: "shelf",
  type: "group",
  x: -100,
  y: -100,
  width: 900,
  height: 700,
  label: "shelf",
  color: "3",
};
const VOLUME = {
  id: "volume",
  type: "file",
  x: 40,
  y: 60,
  width: 320,
  height: 240,
  file: "library/volume-ii.md",
  color: "#2f6f4f",
};

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

function rebuild(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc), "peer");
  return copy;
}

describe("WP19 AC1 blind2 — three saves of the same delete converge and destroy nothing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the rebuilt doc still holds the whole record, suppressed once, after the delete is re-stated repeatedly", async () => {
    const vault = createVault({ [PATH]: canvasJson([SHELF, VOLUME]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["shelf", "volume"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const volumeBefore = doc.getMap<Y.Map<unknown>>("nodes").get("volume")?.toJSON();
    expect(volumeBefore, "the host seed never created the record under test").toBeDefined();

    // The delete, then two more saves that still lack the record. The bytes have
    // to differ each time or the byte echo breaker swallows the pass, so the
    // surviving group is nudged instead — the deleted record is untouched.
    for (const width of [900, 901, 902]) {
      vault.files.set(PATH, canvasJson([{ ...SHELF, width }]));
      await cs.handleLocalModify(PATH);
    }

    const mirror = rebuild(doc);
    const nodes = mirror.getMap<Y.Map<unknown>>("nodes");
    const deleted = mirror.getMap<unknown>("deleted");

    expect(
      [...nodes.keys()].sort(),
      "the record is missing from a doc rebuilt out of the operation log: it was removed, not tombstoned",
    ).toEqual(["shelf", "volume"]);

    const entry = readTombstoneEntry(deleted, "volume");
    expect(entry, "no well-formed tombstone survived the repeated deletes").toBeDefined();
    expect(isTombstoneSuppressed(entry), "the repeated deletes cancelled each other out").toBe(
      true,
    );

    const volumeAfter = nodes.get("volume")?.toJSON();
    for (const [key, value] of Object.entries(volumeBefore ?? {})) {
      expect(volumeAfter?.[key], `field \`${key}\` did not survive the repeated deletes`).toEqual(
        value,
      );
    }
    expect(
      Object.keys(volumeAfter ?? {}).sort(),
      "the tombstoned record gained or lost keys across the repeated deletes",
    ).toEqual(Object.keys(volumeBefore ?? {}).sort());

    // The survivor took the edits, so the passes were not no-ops.
    expect(nodes.get("shelf")?.get("width"), "none of the three saves did anything").toBe(902);
    expect(
      buildCanvasData(nodes, mirror.getMap<Y.Map<unknown>>("edges"), deleted).nodes.map(
        (node) => node.id,
      ),
    ).toEqual(["shelf"]);

    cs.destroy();
  });
});
