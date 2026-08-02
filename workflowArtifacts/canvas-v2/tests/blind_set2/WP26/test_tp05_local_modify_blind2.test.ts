// WP26 / AC2 + AC4 blind 2 — the MODIFY verb, attacked from the AC4 side.
//
// Different angle: blind 1 asks whether the replica file is kept out. This one
// asks the harder question — whether the guard that keeps it out was written with
// the right predicate. `handleLocalTextModify` is the local-edit half of the
// announced R10 raw-text fallback: `vault-events.ts` deliberately routes a
// `.canvas` that `CanvasSync` does not own into this method, immediately after
// logging the fallback warning. Guarding this method with the canvas text-sync
// skip — the obvious copy of the line used at the other four consumers — silently
// turns that fallback read-only, and no assertion about replica files can see it.
//
// So the oracle is a three-way discrimination on ONE instance, in one run:
//
//   replica path  → nothing at all
//   `.canvas`     → full text sync, exactly as before WP26
//   `.md`         → full text sync, exactly as before WP26
//
// A guard using the canvas predicate fails the middle row. A guard using no
// predicate fails the first. Only the sidecar predicate passes all three.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import { SIDECAR_DIR, sidecarIndexPath } from "../../../../../plugin/src/files/canvas-sidecar";

const REPLICA = sidecarIndexPath();
const REPLICA_CANVAS = `${SIDECAR_DIR}/shadow/board.canvas`;
const FALLBACK_CANVAS = "boards/fallback.canvas";
const ORDINARY = "team/agenda.md";

const PAYLOAD: Record<string, string> = {
  [REPLICA]: '{"replica":"index"}',
  [REPLICA_CANVAS]: '{"replica":"canvas-shaped"}',
  [FALLBACK_CANVAS]: '{"nodes":[{"id":"n1"}],"edges":[]}',
  [ORDINARY]: "# Agenda\n- item",
};

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 1, mtime: 1, ctime: 1 };
  return file;
}

function build() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => (PAYLOAD[path] ? fileFor(path) : null)),
    read: vi.fn(async (file: any) => PAYLOAD[file.path] ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as any;
  const syncManager = {
    getDoc(path: string) {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        docs.set(path, {
          doc,
          text: doc.getText("content"),
          awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
        });
      }
      return docs.get(path)!;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  return {
    docs,
    manifestManager,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind2 — the modify guard discriminates three path classes at once", () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(async () => {
    vi.useFakeTimers();
    ctx = build();
    for (const path of [REPLICA, REPLICA_CANVAS, FALLBACK_CANVAS, ORDINARY]) {
      await ctx.bg.handleLocalTextModify(path);
    }
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    ctx.bg.destroy();
    vi.useRealTimers();
  });

  it("row 1 — the replica index gets no document and no shared bytes", () => {
    expect(ctx.docs.has(REPLICA)).toBe(false);
  });

  it("row 1b — a canvas-NAMED file inside the replica directory is replica state, not a canvas", () => {
    // The directory wins over the extension. An implementation that decided this
    // row by the extension alone would sync the shadow copy.
    expect(ctx.docs.has(REPLICA_CANVAS)).toBe(false);
  });

  it("row 2 — AC4: the `.canvas` text fallback is still WRITABLE from a local edit", () => {
    expect(ctx.docs.get(FALLBACK_CANVAS)?.text.toString()).toBe(PAYLOAD[FALLBACK_CANVAS]);
  });

  it("row 3 — an ordinary note is untouched by WP26", () => {
    expect(ctx.docs.get(ORDINARY)?.text.toString()).toBe(PAYLOAD[ORDINARY]);
  });

  it("the manifest heard about the two shared rows and about neither replica row", () => {
    const paths = ctx.manifestManager.updateFile.mock.calls.map((call: any[]) => call[0].path);
    expect([...paths].sort()).toEqual([FALLBACK_CANVAS, ORDINARY].sort());
  });
});
