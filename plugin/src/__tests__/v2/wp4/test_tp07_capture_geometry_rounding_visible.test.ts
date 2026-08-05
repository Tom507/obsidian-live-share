// WP4 — capture-side geometry rounding is wired into the intent path.
//
// BUILD_SPEC §4.4: "Geometry is rounded to whole pixels **before** the register
// write, so rounding can never appear as intent." WP3 shipped the pure helper
// (`roundCanvasGeometry`, C3 AC3 — "a canonical-rounding helper usable by the
// capture path") and left it without a caller; the capture path is WP4's, so the
// call site is WP4's.
//
// The ordering is what makes it correct, and it is what these tests pin: the
// parsed save is rounded BEFORE it is classified against the shadow. Rounding
// after the diff would leave every sub-pixel jitter of a dragged card looking
// like intent — the exact opposite of the rule.
//
//   ├── T1 a fractional drag reaches the CRDT as whole pixels.
//   ├── T2 a sub-pixel difference from the shadow value is NOT intent: it is
//   │      discarded, so a peer's newer value survives it.
//   ├── T3 only the four geometry keys are touched, and `-0` becomes `0`.
//   └── T4 rounding is idempotent at the boundary: whole pixels round-trip with
//          zero CRDT writes.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";
import { collabText } from "../../harness/collab-text";

const PATH = "board.canvas";

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

const CARD = { id: "g1", type: "text", x: 100, y: 100, width: 240, height: 120, text: "note" };

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();
  return { vault, cs, doc };
}

describe("WP4 — geometry is rounded on the capture side, before the intent diff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a fractional drag reaches the CRDT as whole pixels", async () => {
    const p = await makePeer(canvasJson([CARD]));

    p.vault.files.set(
      PATH,
      canvasJson([{ ...CARD, x: 250.7, y: 39.2, width: 240.5, height: 119.49 }]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "g1", "x")).toBe(251);
    expect(nodeField(p.doc, "g1", "y")).toBe(39);
    expect(nodeField(p.doc, "g1", "width")).toBe(241);
    expect(nodeField(p.doc, "g1", "height")).toBe(119);
    for (const key of ["x", "y", "width", "height"]) {
      expect(Number.isInteger(nodeField(p.doc, "g1", key) as number), `${key} is fractional`).toBe(
        true,
      );
    }
    // The shadow advances to the ROUNDED value, or the next save re-opens the
    // same sub-pixel argument for ever.
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "g1", "x")).toBe(251);
  });

  it("T2 a sub-pixel difference from the shadow is not intent", async () => {
    const p = await makePeer(canvasJson([CARD]));

    // A peer moves the card; this client's offscreen surface still holds x=100.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("g1")?.set("x", 700);
    });

    // Obsidian re-serialises its own stale layout with sub-pixel noise.
    p.vault.files.set(PATH, canvasJson([{ ...CARD, x: 100.4, y: 99.5, text: "edited" }]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "g1", "x"), "rounding noise was pushed as a revert").toBe(700);
    expect(nodeField(p.doc, "g1", "y"), "99.5 rounds to 100, which equals the shadow").toBe(100);
    // WP36 follow-up (B32) — RE-ORACLED. `text` is a nested `Y.Text` now, so
    // `.toBe("edited")` compared a `Y.Text` to a string and could only ever
    // fail. The value half is kept verbatim; the shape half replaces the
    // superseded "it is a plain string" with the post-WP36 invariant "the
    // capture did NOT flatten the collaborative text". See the paired
    // PRE-WP36 CONTROL below for the red proof.
    expect(collabText(nodeField(p.doc, "g1", "text")), "the genuine edit was swallowed").toEqual({
      shape: "ytext",
      text: "edited",
    });
  });

  it("T2 PRE-WP36 CONTROL: the re-oracled assertion is RED on the whole-string LWW register", async () => {
    const p = await makePeer(canvasJson([CARD]));
    // The seam reproduces the behaviour WP36 replaced: `text` never becomes a
    // `Y.Text`, the save's string overwrites the register, no merge is planned.
    p.cs.setCollabTextEnabled(false);

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("g1")?.set("x", 700);
    });
    p.vault.files.set(PATH, canvasJson([{ ...CARD, x: 100.4, y: 99.5, text: "edited" }]));
    await p.cs.handleLocalModify(PATH);

    const observed = collabText(nodeField(p.doc, "g1", "text"));
    // The MIGRATED oracle, run verbatim against the old behaviour, must throw.
    expect(() =>
      expect(observed).toEqual({ shape: "ytext", text: "edited" }),
    ).toThrow();
    // And what it saw instead: the value is right, the representation is the
    // whole-string LWW register — which is precisely the property WP36 removed.
    expect(observed).toEqual({ shape: "string", text: "edited" });
  });

  it("T3 only the four geometry keys are rounded, and -0 becomes 0", async () => {
    const p = await makePeer(canvasJson([{ ...CARD, zoom: 1.5 }]));

    p.vault.files.set(PATH, canvasJson([{ ...CARD, x: -0.2, y: 4.5, zoom: 2.25 }]));
    await p.cs.handleLocalModify(PATH);

    expect(Object.is(nodeField(p.doc, "g1", "x"), 0), "-0 must normalise to 0").toBe(true);
    expect(nodeField(p.doc, "g1", "y")).toBe(5);
    expect(nodeField(p.doc, "g1", "zoom"), "a non-geometry number must pass through").toBe(2.25);
  });

  it("T4 whole pixels round-trip with zero CRDT writes", async () => {
    const p = await makePeer(canvasJson([CARD]));

    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([{ text: "note", height: 120, width: 240, y: 100, x: 100, type: "text", id: "g1" }]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc)).toBe(before);
  });
});
