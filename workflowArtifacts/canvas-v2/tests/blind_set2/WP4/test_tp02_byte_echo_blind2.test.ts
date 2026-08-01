// WP4 / AC2 — byte equality (unicode and normalisation angle).
//
// "Byte-identical" must mean the string the vault handed us, compared as it is.
// Two traps live here: a canvas full of non-ASCII text, where a length- or
// code-point-based shortcut behaves differently from a plain comparison; and a
// re-serialisation that a HUMAN would call identical (`0` vs `0.0`, reordered
// keys, added indentation) but that is a different file and must therefore go
// through the intent diff instead of being waved through.
//
//   ├── T1 unicode content echoes itself exactly, with zero CRDT writes.
//   ├── T2 the echo survives a persistence write of the same unicode bytes.
//   ├── T3 `0.0` is a different file than `0` — not an echo, and (after
//   │      rounding) still not intent.
//   └── T4 a re-indented file is not an echo either, and one real change inside
//          it is still captured.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Zettel/Übersicht.canvas";
const ECHO_LINE = "no-op (disk == shared state)";

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

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const NODES = [
  { id: "üb", type: "text", x: 0, y: 0, width: 200, height: 100, text: "Überblick — 概要 🗺️" },
  { id: "zw", type: "text", x: 260, y: 0, width: 200, height: 100, text: "Zweitens ✨" },
];
const COMPACT = JSON.stringify({ nodes: NODES, edges: [] });

async function makePeer(diskJson: string) {
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
  return { vault, cs, doc, debugs };
}

const echoed = (lines: string[]): boolean => lines.some((m) => m.includes(ECHO_LINE));

describe("WP4 AC2 (unicode) — the bytes are compared, nothing else", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 unicode content echoes itself with zero CRDT writes", async () => {
    const p = await makePeer(COMPACT);
    const before = fingerprint(p.doc);

    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH);

    expect(echoed(p.debugs)).toBe(true);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T2 the echo also holds against a reported persistence write", async () => {
    const p = await makePeer(COMPACT);
    const rewritten = JSON.stringify({
      nodes: [{ ...NODES[0], text: "Überblick — 概要 🗺️ v2" }, NODES[1]],
      edges: [],
    });
    p.vault.files.set(PATH, rewritten);
    p.cs.noteExternalDiskWrite(PATH, rewritten);
    await settle();

    const before = fingerprint(p.doc);
    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH);

    expect(echoed(p.debugs)).toBe(true);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T3 `0.0` is a different file, and after rounding still not intent", async () => {
    const p = await makePeer(COMPACT);
    const before = fingerprint(p.doc);

    p.debugs.length = 0;
    // A writer that emits a decimal tail produces different bytes for the same
    // whole-pixel layout.
    p.vault.files.set(PATH, COMPACT.replace('"x":0,', '"x":0.0,'));
    await p.cs.handleLocalModify(PATH);

    expect(echoed(p.debugs), "0.0 and 0 are different bytes").toBe(false);
    expect(fingerprint(p.doc), "a decimal tail is not a move").toBe(before);
  });

  it("T4 a re-indented file is not an echo, and a real change inside it lands", async () => {
    const p = await makePeer(COMPACT);

    p.debugs.length = 0;
    p.vault.files.set(
      PATH,
      JSON.stringify(
        { nodes: [NODES[0], { ...NODES[1], text: "Zweitens ✨✨" }], edges: [] },
        null,
        "\t",
      ),
    );
    await p.cs.handleLocalModify(PATH);

    expect(echoed(p.debugs)).toBe(false);
    expect(nodeField(p.doc, "zw", "text")).toBe("Zweitens ✨✨");
    expect(nodeField(p.doc, "üb", "text")).toBe("Überblick — 概要 🗺️");
  });
});
