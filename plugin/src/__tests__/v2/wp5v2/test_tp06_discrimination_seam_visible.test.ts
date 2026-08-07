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
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
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

// WP64 — the desired state handed to the receipt is the PROJECTION, and post-WP19
// the projection omits tombstoned records. Reading the raw map instead would feed
// this test's discrimination seam a record production would never have handed over.
function docRecords(doc: Y.Doc): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} {
  const deleted = doc.getMap<unknown>("deleted");
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [id, record] of doc.getMap<Y.Map<unknown>>(name)) {
      if (isTombstoneSuppressed(readTombstoneEntry(deleted, id))) continue;
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
  // WP64 — 3-arg: this stands in for the bytes PRODUCTION writes, and
  // `canvas-persistence.ts` serialises with the tombstone map.
  const persisted = serializeCanvas(
    p.doc.getMap<Y.Map<unknown>>("nodes"),
    p.doc.getMap<Y.Map<unknown>>("edges"),
    p.doc.getMap<unknown>("deleted"),
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

// ───────────────────────────────────────────────────────────────────────────
// WP67 — a falsifiability pin for the WP64 helper repair above.
//
// WP64 made this file's `docRecords()` suppression-aware, because what it
// returns is fed to `buildApplyReceipt({ desired })` and post-WP19 the
// projection production hands over omits tombstoned records. At `test_tp05`
// that class of repair was measured A/B — repaired helper RED, raw helper
// GREEN, identical injection. Here it could not be: THIS file's fixture holds
// no tombstone, so the repaired and the raw form return the same records and no
// injection into the scenario can tell them apart. The repair was therefore
// carried as a claim, not a fact, in §7's unfalsifiable-repair register. This
// block closes that gap.
//
// The tombstone deliberately does NOT go into the fixture above: that fixture's
// subject is the per-field receipt's discrimination seam, and a deleted record
// would change what T1–T4 are about — the seam would then be run against a
// different scenario than the one whose two modes are compared directly. The
// helper is the thing whose behaviour is unverified, so the helper is what gets
// pinned — directly, on its own doc, in isolation from the seam.

/**
 * The PRE-WP64 form of `docRecords()`, kept verbatim as the A/B CONTROL: a raw
 * key-presence reading with no suppression check. Nothing else calls it.
 *
 * It is what makes the pin below a measurement rather than an assertion — it
 * shows the injected record IS in the map, so the repaired helper's omission is
 * genuine suppression and not a record that was never there.
 */
function rawDocRecordsControl(doc: Y.Doc): {
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

/**
 * The injection: one suppressed node and one suppressed edge, each beside a
 * live sibling.
 *
 * V2 deletion is DATA (WP12) — the record STAYS in its map and only
 * `deleted[id].on` says it is gone, which is precisely why a raw key-presence
 * reading reports a deleted record as live.
 */
function docWithSuppressedRecords(): Y.Doc {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");

  for (const record of [N1, N2]) {
    const held = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(record)) held.set(key, value);
    nodes.set(record.id, held);
  }
  for (const id of ["e1", "e2"]) {
    const held = new Y.Map<unknown>();
    held.set("id", id);
    held.set("fromNode", "n1");
    held.set("toNode", "n2");
    edges.set(id, held);
  }

  const deleted = doc.getMap<unknown>("deleted");
  deleted.set("n1", { t: 7, by: "peerA", on: true });
  deleted.set("e1", { t: 7, by: "peerA", on: true });
  return doc;
}

describe("WP67 — this file's suppression-aware docRecords() is falsifiable", () => {
  it("P1 docRecords omits a tombstoned record the raw form hands over, and keeps the live one", () => {
    const doc = docWithSuppressedRecords();

    // A — the control. The raw pre-WP64 reading reports the deleted records as
    // present. If either of these ever fails, the injection stopped injecting
    // and the B half below would be passing vacuously.
    const raw = rawDocRecordsControl(doc);
    expect(
      raw.nodes.map((r) => r.id),
      "the suppressed node was not in the map to begin with",
    ).toContain("n1");
    expect(
      raw.edges.map((r) => r.id),
      "the suppressed edge was not in the map to begin with",
    ).toContain("e1");

    // B — the repaired helper, same doc, same injection.
    const projected = docRecords(doc);
    expect(
      projected.nodes.map((r) => r.id),
      "a deleted node was written into the receipt's desired state as live",
    ).not.toContain("n1");
    expect(
      projected.edges.map((r) => r.id),
      "a deleted edge was written into the receipt's desired state as live",
    ).not.toContain("e1");

    // …and suppression is not a blanket: the live records survive intact.
    expect(projected.nodes.map((r) => r.id), "suppression swallowed a live node").toContain("n2");
    expect(projected.edges.map((r) => r.id), "suppression swallowed a live edge").toContain("e2");
    expect(projected.nodes.find((r) => r.id === "n2")?.text).toBe(N2.text);

    doc.destroy();
  });
});
