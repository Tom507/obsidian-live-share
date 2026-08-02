// WP21 AC3 blind1 — authorisation judged on the DELETE path and on a deep glob,
// the two places the visible test does not go.
//
// The visible test refuses a move. A move that fails to reach the doc is
// invisible to the user and harmless; a DELETE that a read-only client is
// allowed to push is the destructive shape of the same bug, and it travels
// through a different branch of `applyIntentPlan` (the tombstone branch, whose
// neighbouring lock check WP21 removes). If the authorisation guard were taken
// out with the lock gate, this is where it would hurt.
//
// The glob is `**/*.private.canvas` rather than a directory prefix, so the
// pattern has to be matched against the whole path with a suffix constraint —
// a guard reduced to `path.startsWith(pattern)` while "simplifying" would pass
// the visible test and fail this one.
//
// Discrimination, as always: a sibling path one character away from the pattern
// must still be writable by the same client in the same pass, or the test is
// satisfied by a guard that refuses everything.

import { minimatch } from "minimatch";
import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const SECRET = "vault/deep/plans.private.canvas";
const PUBLIC = "vault/deep/plans.public.canvas";

const KEEP = { id: "keep", type: "text", x: 0, y: 0, width: 200, height: 100, text: "keep" };
const DROP = { id: "drop", type: "text", x: 300, y: 0, width: 200, height: 100, text: "drop" };

const canvasJson = (nodes: Record<string, unknown>[]) => JSON.stringify({ nodes, edges: [] });

interface Permissions {
  permission: "read-write" | "read-only";
  role: "host" | "guest";
  remoteReadOnlyPatterns: string[];
}

/** `main.ts::canWriteCanvasPath`, written out as the predicate it injects. */
function canWriteCanvasPath(settings: Permissions, path: string): boolean {
  if (settings.permission === "read-only") return false;
  if (settings.role === "guest" && settings.remoteReadOnlyPatterns.some((p) => minimatch(path, p))) {
    return false;
  }
  return true;
}

function createVault(initial: Record<string, string>) {
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

describe("WP21 AC3 blind1 — a read-only path still refuses a DELETE, not just a move", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a guest inside a deep read-only glob cannot tombstone a record, but can on its sibling", async () => {
    const settings: Permissions = {
      permission: "read-write",
      role: "guest",
      remoteReadOnlyPatterns: ["**/*.private.canvas"],
    };
    const vault = createVault({
      [SECRET]: canvasJson([KEEP, DROP]),
      [PUBLIC]: canvasJson([KEEP, DROP]),
    });
    const syncManager = createSyncManager();
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setCanWrite((path) => canWriteCanvasPath(settings, path));
    // Deletes need an open view with a hand-over receipt, on BOTH paths.
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["keep", "drop"]), edge: new Set<string>() },
      }),
    );
    // Seeded as host so both docs start from a known shared state; the role under
    // test reaches the capture path only through the injected predicate.
    await cs.subscribe(SECRET, "host");
    await cs.subscribe(PUBLIC, "host");

    const deletedOf = (path: string) =>
      syncManager.getDoc(`__canvas__:${path}`).doc.getMap<unknown>("deleted");
    const nodesOf = (path: string) =>
      syncManager.getDoc(`__canvas__:${path}`).doc.getMap<Y.Map<unknown>>("nodes");

    // The user removes `drop` from BOTH files in the same session.
    vault.files.set(SECRET, canvasJson([KEEP]));
    vault.files.set(PUBLIC, canvasJson([KEEP]));
    await cs.handleLocalModify(SECRET);
    await cs.handleLocalModify(PUBLIC);

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deletedOf(SECRET), "drop")),
      "a read-only guest pushed a DELETE — the authorisation guard is gone from the tombstone branch",
    ).toBe(false);
    expect(
      nodesOf(SECRET).has("drop"),
      "the record disappeared from a read-only client's shared doc",
    ).toBe(true);

    // Discrimination: the same client, the same pass shape, a path the glob does
    // not cover.
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deletedOf(PUBLIC), "drop")),
      "the guard refused a path no read-only pattern covers",
    ).toBe(true);

    cs.destroy();
  });

  it("a globally read-only client is refused on both paths at once", async () => {
    const settings: Permissions = {
      permission: "read-only",
      role: "host",
      remoteReadOnlyPatterns: [],
    };
    const vault = createVault({
      [SECRET]: canvasJson([KEEP, DROP]),
      [PUBLIC]: canvasJson([KEEP, DROP]),
    });
    const syncManager = createSyncManager();
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setCanWrite((path) => canWriteCanvasPath(settings, path));
    await cs.subscribe(SECRET, "host");
    await cs.subscribe(PUBLIC, "host");

    for (const path of [SECRET, PUBLIC]) {
      vault.files.set(path, canvasJson([{ ...KEEP, x: 999 }, DROP]));
      await cs.handleLocalModify(path);
      const nodes = syncManager.getDoc(`__canvas__:${path}`).doc.getMap<Y.Map<unknown>>("nodes");
      expect(
        (nodes.get("keep") as Y.Map<unknown>).get("x"),
        `a globally read-only client wrote to ${path}`,
      ).toBe(0);
    }

    cs.destroy();
  });
});
