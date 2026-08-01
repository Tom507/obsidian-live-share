// WP5 — DISCRIMINATION (BUILD_SPEC §8: "every new mechanism ships at least one
// test that fails when the mechanism is disabled through its injected seam").
//
// The seam is `advanceFromReceipt(shadow, receipt, { perFieldReceipt: false })`.
// `false` restores V1 record-snapshot semantics exactly: the pass advances every
// record of the receipt or none of them, and "none" is decided by the single
// question V1 asked — `interacting === 0`. No outcome other than `interacting` is
// consulted, which is why V1 marked unapplied data as applied. Test-only; there is
// no production caller.
//
// One scenario, two runs, one difference. The two outcomes are compared DIRECTLY,
// so a change that quietly neutralises the seam breaks a test instead of leaving
// two independently-green cases.
//
//   ├── T1 a reload that never landed: with the receipt the peer's value survives;
//   │      without it the stale view reverts the peer — the Symptom-2 cascade.
//   ├── T2 an interacting skip: with the receipt every other record still
//   │      advances; without it the whole pass is discarded.
//   ├── T3 the default is the ENABLED mode, so the seam cannot ship switched off.
//   └── T4 the disabled mode really is the V1 defect: unapplied data is marked
//          applied.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  type ShadowFieldValue,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
} from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "risk/cascade.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "held" };
const N2 = { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 100, text: "free" };

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
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function docRecords(doc: Y.Doc): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} {
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [, record] of doc.getMap<Y.Map<unknown>>(name)) {
      out.push(Object.fromEntries(record.entries()));
    }
    return out;
  };
  return { nodes: read("nodes"), edges: read("edges") };
}

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(() => ({
    viewOpen: true,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  }));
  await cs.subscribe(PATH, "host");
  return { vault, cs, doc: syncManager.getDoc(`__canvas__:${PATH}`).doc };
}

/**
 * ONE scenario, parameterised by the seam only.
 *
 * A peer moves n1 to x=500. The open view cannot be reloaded (the private canvas
 * API is unavailable this pass), so nothing reached the surface. Obsidian then
 * saves what the view really shows — x=0.
 */
async function runFailedReload(perFieldReceipt: boolean): Promise<number> {
  const p = await makePeer(canvasJson([N1, N2]));
  applyRemoteDelta(p.doc, (nodes) => {
    nodes.get("n1")?.set("x", 500);
  });

  // The single writer persists the peer's move even though the view could not be
  // reloaded, which moves `lastWrittenContent` off the seed content. Without this
  // the save below would be BYTE-IDENTICAL to the file the host seed stored and
  // WP4's echo breaker would return before the shadow is ever consulted.
  // (The view is open, so this write advances no field — that is the point here.)
  const persisted = serializeCanvas(
    p.doc.getMap<Y.Map<unknown>>("nodes"),
    p.doc.getMap<Y.Map<unknown>>("edges"),
  );
  p.vault.files.set(PATH, persisted);
  p.cs.noteExternalDiskWrite(PATH, persisted);
  await vi.runOnlyPendingTimersAsync();

  advanceFromReceipt(
    p.cs.getSurfaceShadow(),
    buildApplyReceipt({
      path: PATH,
      desired: docRecords(p.doc),
      plan: "structural",
      reloaded: false,
    }),
    { perFieldReceipt },
  );

  p.vault.files.set(PATH, canvasJson([{ ...N1, x: 0 }, N2]));
  await p.cs.handleLocalModify(PATH);

  return p.doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x") as number;
}

/** The same interacting pass, run through both modes. */
function runInteractingPass(perFieldReceipt: boolean) {
  const shadow = createSurfaceShadow();
  for (const record of [N1, N2]) {
    advanceRecord(shadow, PATH, "node", record.id, record as Record<string, ShadowFieldValue>);
  }
  const desired = {
    nodes: [
      { ...N1, x: 40 },
      { ...N2, x: 340, text: "moved" },
    ],
    edges: [] as Record<string, unknown>[],
  };
  const summary = advanceFromReceipt(
    shadow,
    buildApplyReceipt({
      path: PATH,
      desired,
      plan: "geometry",
      nodeOutcomes: new Map<string, ApplyOutcome>([
        ["n1", "interacting"],
        ["n2", "applied"],
      ]),
    }),
    { perFieldReceipt },
  );
  return { shadow, summary };
}

describe("WP5 §8 — the per-field receipt is what does the work", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 without the receipt a failed reload reverts the peer; with it, it does not", async () => {
    const withReceipt = await runFailedReload(true);
    const withoutReceipt = await runFailedReload(false);

    expect(withReceipt, "the peer's value was reverted by a view that never applied it").toBe(500);
    expect(withoutReceipt, "the disabled seam must reproduce the cascade").toBe(0);
    expect(withReceipt).not.toBe(withoutReceipt);
  });

  it("T2 without the receipt an interacting skip discards the whole pass", () => {
    const on = runInteractingPass(true);
    const off = runInteractingPass(false);

    expect(getField(on.shadow, PATH, "node", "n2", "x")).toBe(340);
    expect(getField(on.shadow, PATH, "node", "n2", "text")).toBe("moved");
    expect(getField(on.shadow, PATH, "node", "n1", "x")).toBe(0);

    expect(getField(off.shadow, PATH, "node", "n2", "x")).toBe(300);
    expect(getField(off.shadow, PATH, "node", "n2", "text")).toBe("free");

    expect(on.summary.advanced.length).toBeGreaterThan(0);
    expect(off.summary.advanced.length).toBe(0);
    expect(on.summary.handed.node.has("n2")).toBe(true);
    expect(off.summary.handed.node.has("n2")).toBe(false);
  });

  it("T3 the enabled mode is the default", () => {
    const explicit = runInteractingPass(true);
    const shadow = createSurfaceShadow();
    for (const record of [N1, N2]) {
      advanceRecord(shadow, PATH, "node", record.id, record as Record<string, ShadowFieldValue>);
    }
    const implicitSummary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: {
          nodes: [
            { ...N1, x: 40 },
            { ...N2, x: 340, text: "moved" },
          ],
          edges: [],
        },
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([
          ["n1", "interacting"],
          ["n2", "applied"],
        ]),
      }),
    );

    expect(implicitSummary.advanced.length).toBe(explicit.summary.advanced.length);
    expect(getField(shadow, PATH, "node", "n2", "x")).toBe(340);
    expect(getField(shadow, PATH, "node", "n1", "x")).toBe(0);
  });

  it("T4 the disabled mode marks unapplied data as applied", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", N1 as Record<string, ShadowFieldValue>);

    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: { nodes: [{ ...N1, x: 512 }], edges: [] },
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([["n1", "missing"]]),
      }),
      { perFieldReceipt: false },
    );

    expect(
      getField(shadow, PATH, "node", "n1", "x"),
      "the disabled seam must reproduce V1: a record the view never got is recorded as applied",
    ).toBe(512);
  });
});
