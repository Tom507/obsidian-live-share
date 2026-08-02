// WP5 / AC1 — `canvasApplied` is replaced by the C1 shadow as the SINGLE
// structure serving both reconcile classification and capture basis.
//
// AC1: "`canvasApplied` is replaced by the shadow from C1 as the single structure
// serving both reconcile classification and capture basis; there is no second,
// parallel shadow."
//
// The oracle is state, never a source scan: the two roles are exercised through
// the two REAL consumers and each one must observe what the other wrote.
//
//   ├── T1 a confirmed reconcile apply advances the very instance
//   │      `CanvasSync.getSurfaceShadow()` returns, so the capture path
//   │      immediately treats those values as staleness (zero CRDT writes) …
//   ├── T2 … and immediately treats the value the view NO LONGER shows as intent,
//   │      which is the two-sided proof that the receipt moved the capture basis
//   │      rather than merely muting the path.
//   ├── T3 the reverse direction: a captured local edit is visible to the
//   │      reconcile classifier through the same structure.
//   ├── T4 `setSurfaceShadow(...)` re-points BOTH roles at once — there is no
//   │      second, cached structure anywhere.
//   └── T5 the reconcile classifier reads the projection of that instance, so a
//          confirmed apply makes the next identical delta a `noop`.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant. The only real
// timer in the path (the settle window `noteExternalDiskWrite` opens) is flushed
// with `vi.runOnlyPendingTimersAsync()`, which names no duration.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SurfaceState,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { planReconcile } from "../../../canvas/reconcile-plan";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "team/board.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "alpha" };
const N2 = { id: "n2", type: "text", x: 400, y: 0, width: 200, height: 100, text: "beta" };

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

/** A genuine REMOTE transaction on `doc` (never a local edit). */
function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

/**
 * What `buildCanvasData()` hands `reconcileLiveCanvas` — read from the doc.
 *
 * WP64 — that claim is only true if suppression is honoured: post-WP19
 * `buildCanvasData` omits tombstoned records, so this helper must too, or it
 * would hand the view a deleted record as if it were live.
 */
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

function nodeField(doc: Y.Doc, id: string, field: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(field);
}

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

/** Flush the settle window `noteExternalDiskWrite` opens — no constant named. */
async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  // The open canvas: only a CONFIRMED apply may advance the shadow from here.
  const surface = {
    viewOpen: true,
    handedToView: { node: new Set<string>(["n1", "n2"]), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, surface };
}

/** Exactly what `main.ts` is specified to do after a landed structural reload. */
function confirmReload(cs: CanvasSync, data: ReturnType<typeof docRecords>) {
  const receipt = buildApplyReceipt({ path: PATH, desired: data, plan: "structural", reloaded: true });
  return advanceFromReceipt(cs.getSurfaceShadow(), receipt);
}

describe("WP5 AC1 — one shadow serves reconcile classification and capture basis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a confirmed apply makes the capture path treat those values as staleness", async () => {
    const p = await makePeer(canvasJson([N1, N2]));

    // A peer moves n1; the open Obsidian view never saw the external write.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "n1", "x")).toBe(0);

    // The reconciler brings the view up and reports the receipt.
    confirmReload(p.cs, docRecords(p.doc));
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "n1", "x")).toBe(500);

    // Obsidian re-serialises the now-current view. Different key order → different
    // bytes, so the byte echo breaker cannot be what silences this save.
    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([
        { text: "alpha", height: 100, width: 200, y: 0, x: 500, type: "text", id: "n1" },
        { text: "beta", height: 100, width: 200, y: 0, x: 400, type: "text", id: "n2" },
      ]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc), "the confirmed apply did not reach the capture basis").toBe(before);
  });

  it("T2 the same receipt makes the value the view no longer shows real intent", async () => {
    const p = await makePeer(canvasJson([N1, N2]));
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });

    // The single writer flushes the peer's move to disk, which moves
    // `lastWrittenContent` off the seed content. Without this the drag-back save
    // below would be BYTE-IDENTICAL to the file the host seed stored and WP4's
    // echo breaker would return before the shadow is ever consulted.
    // (The view is open, so this write advances no field — WP5 owns that receipt.)
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
      p.doc.getMap<unknown>("deleted"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await settle();

    confirmReload(p.cs, docRecords(p.doc));

    // The user now drags the card back to where it started. Against the OLD basis
    // this reads as staleness; against the advanced one it is a genuine edit.
    p.vault.files.set(PATH, canvasJson([{ ...N1, x: 0 }, N2]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "n1", "x"), "a real user edit was swallowed as staleness").toBe(0);
  });

  it("T3 a captured local edit is visible to the reconcile classifier", async () => {
    const p = await makePeer(canvasJson([N1, N2]));

    p.vault.files.set(PATH, canvasJson([{ ...N1, x: 96, text: "renamed" }, N2]));
    await p.cs.handleLocalModify(PATH);

    const projected = shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH);
    expect(projected, "the capture advance is invisible to the classifier").not.toBeNull();
    const n1 = (projected as { nodes: Record<string, unknown>[] }).nodes.find((r) => r.id === "n1");
    expect(n1?.x).toBe(96);
    expect(n1?.text).toBe("renamed");
  });

  it("T4 replacing the instance re-points both roles at once", async () => {
    const p = await makePeer(canvasJson([N1, N2]));
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    confirmReload(p.cs, docRecords(p.doc));

    const fresh = createSurfaceShadow();
    p.cs.setSurfaceShadow(fresh);

    expect(
      p.cs.getSurfaceShadow(),
      "getSurfaceShadow must hand out the replaced instance, not a cached one",
    ).toBe(fresh);
    expect(shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH)).toBeNull();

    // The capture path must follow the replacement: with an empty shadow the same
    // save is a full observation and lands, and once the receipt is re-applied to
    // the NEW instance it is silent again.
    p.vault.files.set(PATH, canvasJson([{ ...N1, x: 500 }, { ...N2, text: "gamma" }]));
    await p.cs.handleLocalModify(PATH);
    expect(nodeField(p.doc, "n2", "text")).toBe("gamma");

    confirmReload(p.cs, docRecords(p.doc));
    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([
        { y: 0, x: 500, id: "n1", type: "text", text: "alpha", width: 200, height: 100 },
        { y: 0, x: 400, id: "n2", type: "text", text: "gamma", width: 200, height: 100 },
      ]),
    );
    await p.cs.handleLocalModify(PATH);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T5 the classifier reads the projection of that same instance", async () => {
    const p = await makePeer(canvasJson([N1, N2]));
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    const data = docRecords(p.doc);

    const liveNodeIds = new Set(["n1", "n2"]);
    const liveEdgeIds = new Set<string>();

    confirmReload(p.cs, data);
    expect(
      planReconcile({
        desired: data,
        lastApplied: shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH),
        liveNodeIds,
        liveEdgeIds,
      }),
      "a re-delivered identical delta must be a noop once the apply is confirmed",
    ).toBe("noop");

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n2")?.set("y", 64);
    });
    expect(
      planReconcile({
        desired: docRecords(p.doc),
        lastApplied: shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH),
        liveNodeIds,
        liveEdgeIds,
      }),
    ).toBe("geometry");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// WP67 — a falsifiability pin for the WP64 helper repair above.
//
// WP64 made this file's `docRecords()` suppression-aware. At `test_tp05` that
// repair was measured A/B — repaired helper RED, raw helper GREEN, identical
// injection. Here it could not be: THIS file's fixture holds no tombstone, so
// the repaired and the raw form return the same records and no injection into
// the scenario can tell them apart. The repair was therefore carried as a
// claim, not a fact, in §7's unfalsifiable-repair register. This block closes
// that gap.
//
// The tombstone deliberately does NOT go into the fixture above: that fixture's
// subject is the single-shadow reload, and a deleted record would change what
// T1–T5 are about. The helper is the thing whose behaviour is unverified, so
// the helper is what gets pinned — directly, on its own doc, in isolation from
// the scenario.

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
      "a deleted node was handed to the reconcile classifier as live",
    ).not.toContain("n1");
    expect(
      projected.edges.map((r) => r.id),
      "a deleted edge was handed to the reconcile classifier as live",
    ).not.toContain("e1");

    // …and suppression is not a blanket: the live records survive intact.
    expect(projected.nodes.map((r) => r.id), "suppression swallowed a live node").toContain("n2");
    expect(projected.edges.map((r) => r.id), "suppression swallowed a live edge").toContain("e2");
    expect(projected.nodes.find((r) => r.id === "n2")?.text).toBe(N2.text);

    doc.destroy();
  });
});
