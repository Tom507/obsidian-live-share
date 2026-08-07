// WP4 / AC3 — with the view closed, the last persistence write advances the
// shadow.
//
// AC3: "When the view is closed, the content of the last persistence write
// advances the shadow, so a subsequent Obsidian save of that path yields no
// intent."
//
// The rule behind the gate: the shadow holds the last version of each field that
// provably reached THE SURFACE Obsidian's save comes from. With the view closed
// that surface IS the file, so a `CanvasPersistence` write is a receipt. With the
// view OPEN the surface is the in-memory canvas model, which ignores external
// file writes — the receipt then only exists after a confirmed apply, and that is
// WP5's mechanism, not this one.
//
//   ├── T1 closed view: every field of the written content lands in the shadow,
//   │      and a later save of those values (different bytes, so the byte echo
//   │      breaker cannot be what silences it) yields zero CRDT writes.
//   ├── T2 open view: the same call must NOT advance the shadow.
//   ├── T3 the host seed is the same class of receipt — the file this client
//   │      just pushed into the doc is what the surface holds.
//   └── T4 the advance is scoped to its own path; a second canvas is untouched.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField, getRecordState } from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const A_PATH = "boards/alpha.canvas";
const B_PATH = "boards/beta.canvas";

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

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const CARD = { id: "k1", type: "text", x: 10, y: 20, width: 300, height: 80, text: "sprint" };

async function makeSync(files: Record<string, string>) {
  const vault = createVault(files);
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  return { vault, syncManager, cs, surface };
}

describe("WP4 AC3 — the closed-view persistence write is a surface receipt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 closed view: the written content advances the shadow field by field", async () => {
    const initial = canvasJson([CARD]);
    const t = await makeSync({ [A_PATH]: initial });
    await t.cs.subscribe(A_PATH, "host");
    const doc = t.syncManager.getDoc(`__canvas__:${A_PATH}`).doc;

    // A peer moves the card; the single writer flushes the doc to disk and
    // reports the exact bytes it wrote.
    applyRemoteDelta(doc, (nodes) => {
      nodes.get("k1")?.set("x", 640);
    });
    const persisted = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    t.vault.files.set(A_PATH, persisted);
    t.cs.noteExternalDiskWrite(A_PATH, persisted);
    await settle();

    const shadow = t.cs.getSurfaceShadow();
    expect(getRecordState(shadow, A_PATH, "node", "k1")).toBe("present");
    expect(getField(shadow, A_PATH, "node", "k1", "x")).toBe(640);
    expect(getField(shadow, A_PATH, "node", "k1", "y")).toBe(20);
    expect(getField(shadow, A_PATH, "node", "k1", "text")).toBe("sprint");

    // Obsidian opens and saves the file it found. Same values, its own byte
    // shape — so only the shadow can make this intent-free.
    const before = fingerprint(doc);
    t.vault.files.set(
      A_PATH,
      canvasJson([
        { text: "sprint", height: 80, width: 300, y: 20, x: 640, type: "text", id: "k1" },
      ]),
    );
    await t.cs.handleLocalModify(A_PATH);

    expect(fingerprint(doc), "a re-observation of the shadow produced intent").toBe(before);
  });

  it("T2 open view: the persistence write does not advance the shadow", async () => {
    const initial = canvasJson([CARD]);
    const t = await makeSync({ [A_PATH]: initial });
    await t.cs.subscribe(A_PATH, "host");
    const doc = t.syncManager.getDoc(`__canvas__:${A_PATH}`).doc;
    t.cs.noteExternalDiskWrite(A_PATH, initial);
    await settle();

    t.surface.viewOpen = true;
    t.surface.handedToView.node.add("k1");

    applyRemoteDelta(doc, (nodes) => {
      nodes.get("k1")?.set("x", 640);
    });
    const persisted = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    t.vault.files.set(A_PATH, persisted);
    t.cs.noteExternalDiskWrite(A_PATH, persisted);
    await settle();

    expect(
      getField(t.cs.getSurfaceShadow(), A_PATH, "node", "k1", "x"),
      "an open view never sees an external file write — this is not a receipt",
    ).toBe(10);
  });

  it("T3 the host seed is a receipt too: the seeded file is what the surface holds", async () => {
    const initial = canvasJson([CARD]);
    const t = await makeSync({ [A_PATH]: initial });
    await t.cs.subscribe(A_PATH, "host");
    const doc = t.syncManager.getDoc(`__canvas__:${A_PATH}`).doc;

    const shadow = t.cs.getSurfaceShadow();
    expect(getField(shadow, A_PATH, "node", "k1", "x")).toBe(10);
    expect(getField(shadow, A_PATH, "node", "k1", "text")).toBe("sprint");

    // The very first Obsidian save after a subscribe must not replay the whole
    // file as intent — that is the window the cascade could start in.
    const before = fingerprint(doc);
    t.vault.files.set(
      A_PATH,
      canvasJson([{ id: "k1", text: "sprint", type: "text", height: 80, width: 300, y: 20, x: 10 }]),
    );
    await t.cs.handleLocalModify(A_PATH);
    expect(fingerprint(doc)).toBe(before);
  });

  it("T4 the advance is scoped to its own path", async () => {
    const t = await makeSync({
      [A_PATH]: canvasJson([CARD]),
      [B_PATH]: canvasJson([{ ...CARD, id: "k9", x: 77 }]),
    });
    await t.cs.subscribe(A_PATH, "host");
    await t.cs.subscribe(B_PATH, "host");

    t.cs.noteExternalDiskWrite(A_PATH, canvasJson([{ ...CARD, x: 555 }]));
    await settle();

    const shadow = t.cs.getSurfaceShadow();
    expect(getField(shadow, A_PATH, "node", "k1", "x")).toBe(555);
    expect(getRecordState(shadow, B_PATH, "node", "k1")).toBe("unknown");
    expect(getField(shadow, B_PATH, "node", "k9", "x")).toBe(77);
  });
});
