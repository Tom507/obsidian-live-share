// WP4 / AC1 — the intent plan is the write basis (value-boundary angle).
//
// The classifier's verdict is a strict `===` against the shadow, so the values
// that decide it are exactly the ones a sloppy implementation gets wrong:
// `null` (a value, not an absence), `0` and `-0` (the same observed value),
// `"0"` versus `0` (not the same), and a field the shadow holds that the save
// simply does not mention (a partial observation, never a removal).
//
//   ├── T1 `null` equal to the shadow is staleness; a peer's colour survives it.
//   ├── T2 `-0` on disk equals a shadow `0` — no revert, no write.
//   ├── T3 a string that looks like the number is a real change.
//   └── T4 a field missing from the save is neither deleted nor reverted.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField } from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "0/boards/9.canvas";

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

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

// Numeric-string ids and unicode text: ordinary data, ordinary keys.
const ZERO = { id: "0", type: "text", x: 0, y: 0, width: 120, height: 60, text: "Nullpunkt", color: null };
const TEN = { id: "10", type: "text", x: 300, y: 0, width: 120, height: 60, text: "Zehn ✅" };

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();
  return { vault, cs, doc, surface };
}

describe("WP4 AC1 (value boundaries) — strict equality against the shadow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a null equal to the shadow is staleness, not a colour reset", async () => {
    const p = await makePeer(canvasJson([ZERO, TEN]));
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "0", "color")).toBe(null);

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("0")?.set("color", "5");
    });

    p.vault.files.set(PATH, canvasJson([{ ...ZERO, text: "Nullpunkt b" }, TEN]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "0", "color"), "a stale null wiped a peer's colour").toBe("5");
    expect(nodeField(p.doc, "0", "text")).toBe("Nullpunkt b");
  });

  it("T2 -0 on disk equals a shadow 0", async () => {
    const p = await makePeer(canvasJson([ZERO, TEN]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("0")?.set("x", 640);
    });

    // A genuine resize rides along, so the byte echo breaker cannot be what
    // silences the x field.
    p.vault.files.set(PATH, canvasJson([{ ...ZERO, x: -0, height: 61 }, TEN]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "0", "x"), "-0 vs 0 is not a move").toBe(640);
    expect(nodeField(p.doc, "0", "height")).toBe(61);
  });

  it("T3 a numeric string is not the number it looks like", async () => {
    const p = await makePeer(canvasJson([ZERO, TEN]));

    const before = fingerprint(p.doc);
    p.vault.files.set(PATH, canvasJson([{ ...ZERO, x: "0" }, TEN]));
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc), "a type change is a change").not.toBe(before);
    expect(nodeField(p.doc, "0", "x")).toBe("0");
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "0", "x")).toBe("0");
  });

  it("T4 a field missing from the save is neither deleted nor reverted", async () => {
    const p = await makePeer(canvasJson([ZERO, TEN]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("10")?.set("color", "2");
    });

    // Obsidian writes a record without the `text` key at all.
    p.vault.files.set(
      PATH,
      canvasJson([ZERO, { id: "10", type: "text", x: 300, y: 55, width: 120, height: 60 }]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "10", "text"), "a partial observation removed a field").toBe("Zehn ✅");
    expect(nodeField(p.doc, "10", "color"), "a partial observation removed a peer's field").toBe("2");
    expect(nodeField(p.doc, "10", "y"), "the change in the same record was dropped").toBe(55);
  });

  it("T5 the surviving state is what a peer replicating this client sees", async () => {
    const p = await makePeer(canvasJson([ZERO, TEN]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("0")?.set("y", 480);
    });

    p.vault.files.set(PATH, canvasJson([{ ...ZERO, width: 121 }, TEN]));
    await p.cs.handleLocalModify(PATH);

    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(p.doc), "peer");
    expect(nodeField(replica, "0", "y")).toBe(480);
    expect(nodeField(replica, "0", "width")).toBe(121);
    expect(
      JSON.parse(
        serializeCanvas(
          replica.getMap<Y.Map<unknown>>("nodes"),
          replica.getMap<Y.Map<unknown>>("edges"),
        ),
      ).nodes.length,
    ).toBe(2);
  });
});
