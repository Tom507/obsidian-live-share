// WP5 — DISCRIMINATION (BUILD_SPEC §8), attacked through the HAND-OVER half.
//
// Seam: `advanceFromReceipt(shadow, receipt, { perFieldReceipt: false })`.
//
// Angle: the visible discrimination case loses a peer's value; this one loses the
// LOCAL user's deletion. With the per-field receipt, a pass in which one card is
// held still hands the other cards to the view, so deleting one of them is a
// proven user action. Without it the whole pass hands over nothing and the delete
// is silently discarded as ignorance. One scenario, two runs, compared directly.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "seam/handover.canvas";

const NODES = [
  { id: "held", type: "text", x: 0, y: 0, width: 80, height: 80, text: "held" },
  { id: "free", type: "text", x: 120, y: 0, width: 80, height: 80, text: "free" },
  { id: "keep", type: "text", x: 240, y: 0, width: 80, height: 80, text: "keep" },
];

function canvasJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
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

function docRecords(doc: Y.Doc) {
  const out: Record<string, unknown>[] = [];
  for (const [, record] of doc.getMap<Y.Map<unknown>>("nodes")) {
    out.push(Object.fromEntries(record.entries()));
  }
  return { nodes: out, edges: [] as Record<string, unknown>[] };
}

/** ONE scenario, parameterised by the seam only. Returns what survived. */
async function run(perFieldReceipt: boolean): Promise<string[]> {
  const vault = createVault({ [PATH]: canvasJson(NODES) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const store = createSurfaceStateStore(() => true);
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;

  // One reconcile pass while the user holds a card.
  const summary = advanceFromReceipt(
    cs.getSurfaceShadow(),
    buildApplyReceipt({
      path: PATH,
      desired: docRecords(doc),
      plan: "geometry",
      nodeOutcomes: new Map<string, ApplyOutcome>([
        ["held", "interacting"],
        ["free", "applied"],
        ["keep", "applied"],
      ]),
    }),
    { perFieldReceipt },
  );
  store.noteHandover(PATH, summary.handed);

  // The user deletes the card they were NOT holding.
  vault.files.set(PATH, canvasJson([NODES[0], NODES[2]]));
  await cs.handleLocalModify(PATH);

  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

describe("WP5 §8 (blind1) — without the receipt the user's deletion is lost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the two modes disagree about the deletion", async () => {
    const withReceipt = await run(true);
    const withoutReceipt = await run(false);

    expect(withReceipt, "a proven user deletion was swallowed").toEqual(["held", "keep"]);
    expect(withoutReceipt, "the disabled seam must lose the deletion").toEqual([
      "free",
      "held",
      "keep",
    ]);
    expect(withReceipt).not.toEqual(withoutReceipt);
  });

  it("the card the user was holding is never deleted in either mode", async () => {
    for (const mode of [true, false]) {
      expect(await run(mode)).toContain("held");
    }
  });
});
