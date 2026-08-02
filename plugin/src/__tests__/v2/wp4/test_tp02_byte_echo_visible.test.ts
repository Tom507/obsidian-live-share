// WP4 / AC2 — a byte-identical save is an echo and produces zero CRDT writes.
//
// AC2: "A save that is byte-identical to the last written content is recognised
// as an echo and produces zero CRDT writes."
//
// V2's echo breaker is BYTE equality (BUILD_SPEC D9), which is only sound because
// WP3 made our serialisation canonical. It replaces the semantic record compare
// at `:526-538`; nothing here may depend on a timer, a debounce or a wall-clock
// window — the settle window that already exists is flushed deterministically.
//
//   ├── T1 the echo produces zero CRDT writes and narrates one no-op line.
//   ├── T2 the echo does NOT advance the shadow: the bytes prove what the DISK
//   │      holds, never what an open view holds (that receipt is WP5's).
//   ├── T3 control — one differing field is not an echo, so the breaker cannot
//   │      be a blanket "return early".
//   └── T4 the same VALUES in another key order are NOT byte-equal, so the
//          breaker must not fire; the intent diff still yields zero writes. The
//          two mechanisms are separate and both hold.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField } from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "board.canvas";
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

function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "peer");
  remote.destroy();
}

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

function nodeField(doc: Y.Doc, id: string, field: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(field);
}

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  cs.setLogger({ debug: (_c: string, m: string) => debugs.push(m), warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, debugs, surface, updates: () => fingerprint(doc) };
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const CARD = { id: "c1", type: "text", x: 12, y: 34, width: 250, height: 60, text: "agenda" };

describe("WP4 AC2 — byte equality is the echo breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a byte-identical save produces zero CRDT writes", async () => {
    const initial = canvasJson([CARD]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();

    p.debugs.length = 0;
    const before = p.updates();
    await p.cs.handleLocalModify(PATH); // the file is untouched: same bytes

    expect(p.updates(), "an echo authored a CRDT update").toBe(before);
    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(true);
  });

  it("T2 the echo does not advance the shadow", async () => {
    const initial = canvasJson([CARD]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("c1");

    // A peer moves the card; the single writer puts the new bytes on disk. The
    // OPEN view has not applied it, so the shadow must stay at x=12.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("c1")?.set("x", 900);
    });
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
      p.doc.getMap<unknown>("deleted"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await settle();

    // Obsidian re-emits exactly those bytes → echo.
    await p.cs.handleLocalModify(PATH);

    expect(
      getField(p.cs.getSurfaceShadow(), PATH, "node", "c1", "x"),
      "a byte echo advanced the shadow — bytes on disk are not a surface receipt",
    ).toBe(12);
  });

  it("T3 one differing field is not an echo", async () => {
    const initial = canvasJson([CARD]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();

    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson([{ ...CARD, y: 35 }]));
    await p.cs.handleLocalModify(PATH);

    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(false);
    expect(nodeField(p.doc, "c1", "y"), "a one-pixel move was swallowed as an echo").toBe(35);
    expect(nodeField(p.doc, "c1", "x")).toBe(12);
  });

  it("T4 same values in another key order: not a byte echo, still zero writes", async () => {
    const initial = canvasJson([CARD]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();

    p.debugs.length = 0;
    const before = p.updates();
    p.vault.files.set(
      PATH,
      canvasJson([
        { text: "agenda", height: 60, width: 250, y: 34, x: 12, type: "text", id: "c1" },
      ]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(
      p.debugs.some((m) => m.includes(ECHO_LINE)),
      "byte equality must be byte equality — reordered keys are different bytes",
    ).toBe(false);
    expect(p.updates(), "the intent diff must still find nothing to write").toBe(before);
  });
});
