// WP4 / AC2 — byte equality as the echo breaker (empty-file and whitespace
// boundaries).
//
// Attacks the breaker from the two ends the node-move case never reaches: a
// canvas with NO records at all, and byte differences that carry no semantic
// difference whatsoever (a trailing newline, an indented re-serialisation).
// Byte equality must be exactly that — not "looks the same", not "trimmed".
//
//   ├── T1 the echo works when the baseline came from the host seed alone.
//   ├── T2 a trailing newline is a different file: the breaker must not fire,
//   │      and the intent diff must still find nothing.
//   ├── T3 an empty canvas echoes itself with zero writes.
//   └── T4 the record count does not matter: a large file echoes as a whole.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Archive/2026/big board.canvas";
const ECHO_LINE = "no-op (disk == shared state)";

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
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

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

function grid(count: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `cell-${i}`,
      type: "text",
      x: (i % 5) * 220,
      y: Math.floor(i / 5) * 140,
      width: 200,
      height: 120,
      text: `cell ${i}`,
    });
  }
  return out;
}

async function makePeer(diskJson: string, seedShadow = true) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  cs.setLogger({ debug: (_c: string, m: string) => debugs.push(m), warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  if (seedShadow) {
    cs.noteExternalDiskWrite(PATH, diskJson);
    await settle();
  }
  return { vault, cs, doc, debugs };
}

describe("WP4 AC2 (boundaries) — byte equality, nothing looser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the echo fires against the baseline the host seed established", async () => {
    const initial = canvasJson(grid(3));
    const p = await makePeer(initial, false); // no persistence write at all
    const before = fingerprint(p.doc);

    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH);

    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(true);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T2 a trailing newline is a different file, and still yields no intent", async () => {
    const initial = canvasJson(grid(3));
    const p = await makePeer(initial);
    const before = fingerprint(p.doc);

    p.debugs.length = 0;
    p.vault.files.set(PATH, `${initial}\n`);
    await p.cs.handleLocalModify(PATH);

    expect(
      p.debugs.some((m) => m.includes(ECHO_LINE)),
      "the breaker compared something other than the raw bytes",
    ).toBe(false);
    expect(fingerprint(p.doc), "the shadow should have classified every field as stale").toBe(
      before,
    );
  });

  it("T3 an empty canvas echoes itself", async () => {
    const empty = canvasJson([], []);
    const p = await makePeer(empty);
    const before = fingerprint(p.doc);

    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH);

    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(true);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T4 a large file echoes as a whole, and one changed cell still lands", async () => {
    const initial = canvasJson(grid(25));
    const p = await makePeer(initial);

    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH);
    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(true);

    const changed = grid(25);
    changed[17] = { ...changed[17], text: "changed" };
    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson(changed));
    await p.cs.handleLocalModify(PATH);

    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(false);
    expect(
      p.doc.getMap<Y.Map<unknown>>("nodes").get("cell-17")?.get("text"),
    ).toBe("changed");
    expect(p.doc.getMap<Y.Map<unknown>>("nodes").get("cell-16")?.get("text")).toBe("cell 16");
  });
});
