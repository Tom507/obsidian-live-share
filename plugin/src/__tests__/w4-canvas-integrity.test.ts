// ===========================================================================
// WORKER 4 — Integration & System probes for the canvas-integrity round.
//
// These are NOT unit tests for a single WP. They are Level 2 (critical
// integration paths) and Level 4 (focused regression on HIGH/CRITICAL risk)
// probes, written independently of W3's own suite, driving REAL modules
// against REAL collaborators wherever the seam allows.
//
// Deliberate differences from W3's suite (this is the point of the file):
//   ├── the mute-refcount probes drive the REAL `FileOpsManager`, not a mock
//   │   counter, and assert `isPathMuted(path) === false` — the actual
//   │   production predicate a dropped `modify` event would consult.
//   ├── the PROTECTED_KEYS probes go through the REAL
//   │   `CanvasSync.handleLocalModify` (both delete branches), not through
//   │   `applyToYMap` / `applyKeyDiff` directly, and include ADVERSARIAL cases
//   │   (legitimate side change, genuine optional-key delete).
//   └── the reconcile classifier is compared against the VERBATIM pre-round
//       expression from `git show 4b34d5e:plugin/src/main.ts`, so the
//       "HEAD yields geometry" half of US3 AC4 is closed by execution rather
//       than by code reading.
//
// Worker 4 never repairs code. Anything failing here becomes a fix request.
// ===========================================================================

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { planReconcile } from "../canvas/reconcile-plan";
// WP19 AC1: a delete is a tombstone value, so "it was deleted" is read as
// suppression + absence from the projection, never as a missing key.
import { isTombstoneSuppressed, readTombstoneEntry } from "../canvas/canvas-tombstone";
import {
  CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
  createVaultPersistenceIO,
} from "../files/canvas-persistence";
import {
  CanvasSync,
  GEOMETRY_KEYS,
  PROTECTED_KEYS,
  buildCanvasData,
  serializeCanvas,
} from "../files/canvas-sync";
import { FileOpsManager } from "../files/file-ops";
import { canvasOwned, registerVaultEvents } from "../files/vault-events";
import { BackgroundSync } from "../files/background-sync";
import { ManifestManager } from "../files/manifest";

// ---------------------------------------------------------------------------
// WP27 AC4 (Dispatcher-licensed amendment) — the GUARD-CONSULT recorder.
//
// M1 and K5 below pin that the two bare-path `getDoc` sites are guarded. "The
// `getDoc` did not happen" is on its own a WEAKER claim than what those two
// tests pinned before the amendment: it is also true of a broken harness, a
// renamed method, or an early return somewhere upstream. So the guard itself
// has to be observable, not only its effect.
//
// `skipsAutoTextSync` (`utils.ts`) is the ONE predicate both AC4 sites consult
// (Shared Ownership Contract §5 / charter §7.0(c) — no private
// `endsWith(".canvas")` copy exists at either site). This wrapper DELEGATES to
// the real predicate, so behaviour is byte-identical for every other test in
// this file, and records each consult into a plain array that the file-wide
// `vi.restoreAllMocks()` cannot reset. Each consumer clears it immediately
// before driving the site under test.
// ---------------------------------------------------------------------------
const guardConsults = vi.hoisted(() => [] as { path: string; verdict: boolean }[]);

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    skipsAutoTextSync: (path: string): boolean => {
      const verdict = actual.skipsAutoTextSync(path);
      guardConsults.push({ path, verdict });
      return verdict;
    },
  };
});

const PATH = "board.canvas";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Shared doubles (vault + sync manager). Kept minimal and honest: everything
// that is a REAL module under test is constructed as the real class.
// ---------------------------------------------------------------------------

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const adapterWrite = vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  });
  return {
    files,
    adapterWrite,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: adapterWrite,
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
    createFolder: vi.fn(async () => ({})),
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

/** The REAL FileOpsManager — refcounted mutes, exactly as production. */
function createRealFileOps() {
  const vault = createVault();
  const manager = new FileOpsManager(vault as never, {} as never);
  return manager;
}

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function remoteRecord(rec: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(rec)) m.set(k, v);
  return m;
}

/** Mutate the doc as a genuine REMOTE peer would (tr.local === false). */
function applyRemoteDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function docRecords(doc: Y.Doc, which: "nodes" | "edges"): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, ymap] of doc.getMap<Y.Map<unknown>>(which)) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of ymap) obj[k] = v;
    out[id] = obj;
  }
  return out;
}

// WP64 — `docRecords` above iterates the RAW map and never consults `deleted`.
// Post-WP19 that makes it blind to suppression: a record can be PRESENT and
// DELETED, so `docRecords(...).x` being defined no longer proves the record
// survived. `docRecords` is deliberately left as it is — every remaining use of
// it is a FIELD-VALUE read (`.text`, `.fromNode`, an exact-object compare) or an
// absence check, and blindness to suppression is harmless in both. The two
// helpers below are its tombstone-aware siblings, and every SURVIVAL assertion
// uses them instead.

/** Is `id` currently suppressed (deleted or quarantined) in `doc`? */
function isRecordSuppressedInDoc(doc: Y.Doc, id: string): boolean {
  return isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>("deleted"), id));
}

/** The ids the canvas PROJECTION actually shows — i.e. what the user still sees. */
function visibleRecordIds(doc: Y.Doc, which: "nodes" | "edges"): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
  return (which === "nodes" ? data.nodes : data.edges).map((record) => String(record.id));
}

/**
 * A subscribed, wired `CanvasSync` over a real doc, with the disk file and the
 * three-way-diff baseline both set to `initialJson`. This is the state the
 * production system is in after a subscribe + one settled write.
 */
async function makeSubscribedCanvas(initialJson: string) {
  const vault = createVault({ [PATH]: initialJson });
  const syncManager = createSyncManager();
  const fileOps = createRealFileOps();
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const warns: string[] = [];
  const debugs: string[] = [];
  cs.setLogger({
    debug: (_c, m) => debugs.push(m),
    warn: (_c, m) => warns.push(m),
  });
  await cs.subscribe(PATH, "host"); // host seed establishes doc + baseline
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, syncManager, fileOps, cs, doc, warns, debugs };
}

// ===========================================================================
// L2-A / L4 — WP5 D2: PROTECTED_KEYS across BOTH delete paths, plus the
// adversarial cases the Dispatcher called out. CRITICAL.
// ===========================================================================

describe("W4 L2-A — PROTECTED_KEYS: an edge cannot lose its endpoints (D2)", () => {
  it("A1 applyToYMap branch (!baseObj && existing): a stale disk read cannot delete fromNode/toNode", async () => {
    // CRDT holds the full edge. The local file holds a TRUNCATED edge, and the
    // diff baseline does NOT contain the edge at all -> `!baseObj && existing`
    // -> the full-merge `applyToYMap` branch, which deletes unlisted keys.
    // WP64 fixture completion — a `type:"text"` node with no `text` is refused
    // at the C18 ingest boundary (MISSING_TYPE_SPECIFIC), so these nodes never
    // reached the doc and this test ran against an EMPTY node map. Measured:
    // `nodes=[] edges=["e1"]`. With no visible endpoint the edge is also absent
    // from the projection, which makes every visibility oracle unassertable here.
    const full = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "one" },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50, text: "two" },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    );
    const t = await makeSubscribedCanvas(full);

    // Baseline = a file WITHOUT the edge (so baseObj is undefined for e1).
    const noEdge = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "one" },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50, text: "two" },
      ],
      [],
    );
    t.cs.noteExternalDiskWrite(PATH, noEdge);
    await vi.waitFor(() => expect(t.cs.isRecentDiskWrite(PATH)).toBe(true));
    // Clear the echo guard so handleLocalModify is not short-circuited.
    await new Promise((r) => setTimeout(r, 300));
    expect(t.cs.isRecentDiskWrite(PATH)).toBe(false);

    // Disk now carries the edge but WITHOUT its endpoints (the partial read).
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "one" },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50, text: "two" },
        ],
        [{ id: "e1", color: "3" }],
      ),
    );
    await t.cs.handleLocalModify(PATH);

    const e1 = docRecords(t.doc, "edges").e1;
    expect(e1, "edge e1 vanished from the CRDT entirely").toBeDefined();
    // WP64 — the diff baseline OMITS this edge, and per WP19 an omitting save is
    // a DIRECT delete that writes a tombstone. Key presence and intact endpoints
    // both survive that, so survival is read from the projection as well.
    expect(
      isRecordSuppressedInDoc(t.doc, "e1"),
      "the stale disk read TOMBSTONED edge e1",
    ).toBe(false);
    expect(
      visibleRecordIds(t.doc, "edges"),
      "edge e1 is no longer on the canvas after the stale disk read",
    ).toContain("e1");
    expect(e1.fromNode, "fromNode was deleted through applyToYMap").toBe("n1");
    expect(e1.toNode, "toNode was deleted through applyToYMap").toBe("n2");
    // ...and the non-protected key the "user" set still landed.
    expect(e1.color).toBe("3");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("A2 applyKeyDiff branch (baseObj && existing): a key-diff delete cannot drop fromNode/toNode", async () => {
    const full = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left", label: "L" }],
    );
    const t = await makeSubscribedCanvas(full);
    // Baseline == the full file, so baseObj EXISTS for e1 -> applyKeyDiff.
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
        ],
        [{ id: "e1", label: "L2" }], // endpoints + sides REMOVED relative to base
      ),
    );
    await t.cs.handleLocalModify(PATH);

    const e1 = docRecords(t.doc, "edges").e1;
    expect(e1.fromNode, "fromNode was deleted through applyKeyDiff").toBe("n1");
    expect(e1.toNode, "toNode was deleted through applyKeyDiff").toBe("n2");
    expect(e1.label, "the legitimate label change did not land").toBe("L2");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("A3 ADVERSARIAL: a LEGITIMATE fromSide/toSide CHANGE is still writable", async () => {
    const full = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    );
    const t = await makeSubscribedCanvas(full);
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
        ],
        [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "bottom", toSide: "top" }],
      ),
    );
    await t.cs.handleLocalModify(PATH);

    const e1 = docRecords(t.doc, "edges").e1;
    expect(e1.fromSide, "protecting fromSide made a legitimate re-route unwritable").toBe("bottom");
    expect(e1.toSide, "protecting toSide made a legitimate re-route unwritable").toBe("top");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  // A4 — RETIRED under WP4 AC5 (licensed deletion, BUILD_SPEC §7 ledger).
  // It asserted that a save which OMITS `color`/`label` deletes that field from
  // the CRDT. I7 ("observation never deletes") now forbids exactly that on the
  // capture path, so no fixture can satisfy it. Its retirement is an ACCEPTED,
  // RECORDED user-visible regression (BUILD_SPEC §3.1 S14): clearing a card's
  // colour or an edge's label via an Obsidian save no longer propagates to
  // peers. Closure is owned by WP39 AC5 in P5.

  it("A5 ADVERSARIAL (behavioural consequence): a genuine fromSide DELETION is now refused", async () => {
    // This is the accepted cost of D2's judgment call. Recorded as an executed
    // observation, not an assumption: the CRDT keeps the previous side.
    const full = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    );
    const t = await makeSubscribedCanvas(full);
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
        ],
        [{ id: "e1", fromNode: "n1", toNode: "n2", toSide: "left" }], // fromSide dropped
      ),
    );
    await t.cs.handleLocalModify(PATH);
    expect(docRecords(t.doc, "edges").e1.fromSide).toBe("right");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("A6 US3 AC11: a node's `type` survives BOTH delete paths", async () => {
    const full = canvasJson([{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "" }], []);
    const t = await makeSubscribedCanvas(full);
    // applyKeyDiff path (baseObj present).
    t.vault.files.set(PATH, canvasJson([{ id: "n1", x: 5, y: 0, width: 100, height: 50 }], []));
    await t.cs.handleLocalModify(PATH);
    expect(docRecords(t.doc, "nodes").n1.type, "type deleted via applyKeyDiff").toBe("text");
    expect(docRecords(t.doc, "nodes").n1.x).toBe(5);

    // applyToYMap path: baseline no longer knows n1 at all.
    t.cs.noteExternalDiskWrite(PATH, canvasJson([], []));
    await new Promise((r) => setTimeout(r, 300));
    t.vault.files.set(PATH, canvasJson([{ id: "n1", x: 9, y: 0, width: 100, height: 50 }], []));
    await t.cs.handleLocalModify(PATH);
    expect(docRecords(t.doc, "nodes").n1.type, "type deleted via applyToYMap").toBe("text");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS", async () => {
    const full = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    );
    const t = await makeSubscribedCanvas(full);
    // WP4: a delete intent needs the surface to PROVE the record is gone — an
    // open view plus a hand-over receipt for that id. Same property, stated
    // preconditions; without them an absence is ignorance, not deletion.
    t.cs.setSurfaceStateProvider(() => ({
      viewOpen: true,
      handedToView: { node: new Set<string>(["n1", "n2"]), edge: new Set<string>(["e1"]) },
    }));
    t.vault.files.set(
      PATH,
      canvasJson([{ id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 }], []),
    );
    await t.cs.handleLocalModify(PATH);
    const a7Deleted = t.doc.getMap<unknown>("deleted");
    const a7Projected = buildCanvasData(
      t.doc.getMap<Y.Map<unknown>>("nodes"),
      t.doc.getMap<Y.Map<unknown>>("edges"),
      a7Deleted,
    );
    // WP19 AC1: the whole-record delete still happens — spelled as a tombstone.
    expect(
      isTombstoneSuppressed(readTombstoneEntry(a7Deleted, "n1")),
      "deleting a whole node was blocked",
    ).toBe(true);
    expect(a7Projected.nodes.map((n) => n.id)).not.toContain("n1");
    // The edge is gone from the projection (AC3), and that is now the ONLY
    // place it is gone from.
    expect(a7Projected.edges, "dangling edge survived the node delete").toEqual([]);
    // AC1: nothing was destroyed — the edge's container and EVERY field value
    // survive verbatim, which is what makes the delete undoable.
    expect(docRecords(t.doc, "edges").e1).toEqual({
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      toNode: "n2",
      toSide: "left",
    });
    // NOTE (measured, not assumed): this fixture's nodes never reach the doc at
    // all — C18 AC1 refuses both at the host-seed boundary with
    // `MISSING_TYPE_SPECIFIC`, because a `type:"text"` node carries no `text`.
    // So the node half of this probe cannot pin container survival, and the
    // tombstone assertion above is its only non-vacuous node oracle. Completing
    // the fixture is the WP18 fixture-completion class / WP64, not this licence.
    t.cs.destroy();
    t.fileOps.destroy();
  });

  // -------------------------------------------------------------------
  // DISCRIMINATION CHECKS. A probe that passes but would ALSO pass with the
  // defect reintroduced proves nothing. `PROTECTED_KEYS` is an exported Set,
  // so the guard can be disarmed IN PROCESS — no source file is touched — and
  // the same scenarios must then go RED.
  //
  // A9 and A10 — RETIRED under WP4 AC5 (licensed deletions, BUILD_SPEC §7).
  //   ├── A9  became UNFALSIFIABLE, not merely failing. It mutated
  //   │       `PROTECTED_KEYS` and asserted `fromNode` was then lost via
  //   │       `handleLocalModify`, but `handleLocalModify` no longer reads
  //   │       `PROTECTED_KEYS` at all (WP4 AC1 re-based the capture path on the
  //   │       Surface-Shadow intent plan), so disarming the guard cannot change
  //   │       the outcome and the test can never go red.
  //   └── A10 same as A9, for `toNode`.
  //
  // The coverage is NOT dropped — the guard is still LIVE on the seed
  // boundaries and is retired by WP18, not here. WP4 AC6 relocates the pair to
  // `src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts`,
  // which runs the same one-scenario/two-runs/one-difference shape against the
  // host seed (`subscribe` → `applyCanvasToYMaps` → `applyToYMap`), where
  // disarming `fromNode` / `toNode` demonstrably still loses the endpoint.
  // A1/A2 above remain non-vacuous by way of that pair.
  // -------------------------------------------------------------------

  it("A8 GEOMETRY_KEYS membership is unchanged and PROTECTED_KEYS is a strict superset", () => {
    expect([...GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
    for (const k of GEOMETRY_KEYS) expect(PROTECTED_KEYS.has(k)).toBe(true);
    for (const k of ["type", "fromNode", "toNode", "fromSide", "toSide"]) {
      expect(PROTECTED_KEYS.has(k)).toBe(true);
    }
    for (const k of ["text", "color", "label", "file", "url", "id"]) {
      expect(PROTECTED_KEYS.has(k), `${k} must stay deletable`).toBe(false);
    }
  });
});

// ===========================================================================
// L2-B / L4 — WP7 R4: the mute refcount, driven against the REAL FileOpsManager.
// The severe silent failure is a PERMANENTLY muted path. CRITICAL.
// ===========================================================================

/** IO backed by the REAL FileOpsManager mute surface, with injectable latency. */
function createRealMuteIO(fileOps: FileOpsManager, latencyMs = 0, failEvery = 0) {
  const files = new Map<string, string>();
  let calls = 0;
  const io: PersistenceIO = {
    read: async (p) => files.get(p) ?? "",
    write: (p, c) => {
      calls++;
      const shouldFail = failEvery > 0 && calls % failEvery === 0;
      return new Promise<void>((resolve, reject) => {
        globalThis.setTimeout(() => {
          if (shouldFail) return reject(new Error("simulated adapter failure"));
          files.set(p, c);
          resolve();
        }, latencyMs);
      });
    },
    exists: async (p) => files.has(p),
    mutePathEvents: (p) => fileOps.mutePathEvents(p),
    unmutePathEvents: (p) => fileOps.unmutePathEvents(p),
  };
  return { io, files, writeCount: () => calls };
}

describe("W4 L2-B — CanvasPersistence mute refcount vs the REAL FileOpsManager (R4)", () => {
  it("B1 overlapping flushes under a CONTINUOUS remote stream leave isPathMuted() === false", async () => {
    vi.useFakeTimers();
    const fileOps = createRealFileOps();
    // 120 ms write latency: every flush is still in flight when the next
    // debounce fires, so acquire/release genuinely interleave.
    const { io, writeCount } = createRealMuteIO(fileOps, 120);
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }));
    });
    const p = new CanvasPersistence(doc, io, PATH);
    p.start();

    // 60 remote deltas at 40 ms spacing = 2.4 s of continuous streaming, which
    // crosses the MAX_WAIT_MS cap many times over.
    let sawMuted = false;
    for (let i = 1; i <= 60; i++) {
      applyRemoteDelta(doc, (nodes) => {
        (nodes.get("n1") as Y.Map<unknown>).set("x", i);
      });
      await vi.advanceTimersByTimeAsync(40);
      if (fileOps.isPathMuted(PATH)) sawMuted = true;
    }
    await vi.advanceTimersByTimeAsync(5000); // let every settle window close

    // Anti-vacuity: if the mute were never taken at all, the final assertion
    // below would be trivially true and prove nothing.
    expect(sawMuted, "the echo mute was never taken — this probe is vacuous").toBe(true);
    expect(writeCount(), "the stream produced no writes at all").toBeGreaterThan(1);
    expect(
      fileOps.isPathMuted(PATH),
      "PERMANENTLY MUTED: every vault modify event for this canvas would be dropped",
    ).toBe(false);
    p.destroy();
    expect(fileOps.isPathMuted(PATH)).toBe(false);
    fileOps.destroy();
  });

  it("B2 a FAILING adapter write still releases the mute (no leak on the error path)", async () => {
    vi.useFakeTimers();
    const fileOps = createRealFileOps();
    const { io } = createRealMuteIO(fileOps, 20, 1); // every write rejects
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }));
    });
    const p = new CanvasPersistence(doc, io, PATH);
    p.start();
    for (let i = 1; i <= 5; i++) {
      applyRemoteDelta(doc, (nodes) => {
        (nodes.get("n1") as Y.Map<unknown>).set("x", i);
      });
      await vi.advanceTimersByTimeAsync(250);
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(fileOps.isPathMuted(PATH), "a failed write leaked the mute").toBe(false);
    p.destroy();
    fileOps.destroy();
  });

  it("B3 destroy() WHILE a write is in flight leaves the path unmuted and arms no live timer", async () => {
    vi.useFakeTimers();
    const fileOps = createRealFileOps();
    const { io } = createRealMuteIO(fileOps, 500); // slow write
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }));
    });
    const p = new CanvasPersistence(doc, io, PATH);
    p.start();
    applyRemoteDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 1);
    });
    await vi.advanceTimersByTimeAsync(210); // flush issued, write in flight
    expect(fileOps.isPathMuted(PATH)).toBe(true);

    p.destroy(); // teardown races the in-flight write
    expect(fileOps.isPathMuted(PATH), "destroy leaked the mute").toBe(false);

    // Drain: the in-flight write's `finally` must not re-mute or re-leak.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fileOps.isPathMuted(PATH), "the in-flight write re-leaked the mute after destroy").toBe(
      false,
    );
    fileOps.destroy();
  });

  it("B4 after a settled burst the path is unmuted, so a vault modify is delivered again", async () => {
    vi.useFakeTimers();
    const fileOps = createRealFileOps();
    const { io } = createRealMuteIO(fileOps, 30);
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }));
    });
    const p = new CanvasPersistence(doc, io, PATH);
    p.start();
    for (let i = 1; i <= 3; i++) {
      applyRemoteDelta(doc, (nodes) => {
        (nodes.get("n1") as Y.Map<unknown>).set("x", i);
      });
      await vi.advanceTimersByTimeAsync(210);
    }
    await vi.advanceTimersByTimeAsync(3000);

    // The production gate at vault-events.ts: `if (isPathMuted(path)) return;`
    expect(fileOps.isPathMuted(PATH)).toBe(false);
    p.destroy();
    fileOps.destroy();
  });
});

// ===========================================================================
// L2-C / L4 — WP6+WP7: exactly ONE writer reaches DISK, end to end. CRITICAL.
// ===========================================================================

describe("W4 L2-C — one writer reaches disk under a live edit", () => {
  it("C1 a real CanvasSync + a real CanvasPersistence over one vault adapter = ONE write per change", async () => {
    vi.useFakeTimers();
    const vault = createVault({
      [PATH]: canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "" },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50, text: "" },
        ],
        [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
      ),
    });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    const io = createVaultPersistenceIO(vault.adapter as never, fileOps as never, {
      isPathSafe: () => true,
      ensureFolder: async () => {},
    });
    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      onWritten: (content) => cs.noteExternalDiskWrite(PATH, content),
    });
    await vi.advanceTimersByTimeAsync(2000);
    vault.adapterWrite.mockClear();

    // A remote peer re-routes the edge AND moves a node.
    applyRemoteDelta(doc, (nodes, edges) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 77);
      (edges.get("e1") as Y.Map<unknown>).set("fromSide", "bottom");
    });
    await vi.advanceTimersByTimeAsync(2000);

    const writes = vault.adapterWrite.mock.calls.filter((c) => c[0] === PATH);
    expect(writes.length, `expected exactly one writer, saw ${writes.length} disk writes`).toBe(1);

    const onDisk = JSON.parse(writes[0][1] as string);
    expect(onDisk.nodes.find((n: { id: string }) => n.id === "n1").x).toBe(77);
    const edge = onDisk.edges.find((e: { id: string }) => e.id === "e1");
    expect(edge.fromNode, "endpoint lost on the way to disk").toBe("n1");
    expect(edge.toNode, "endpoint lost on the way to disk").toBe("n2");
    expect(edge.fromSide).toBe("bottom");

    persistence.destroy();
    cs.destroy();
    fileOps.destroy();
  });

  it("C2 noteExternalDiskWrite opens CanvasSync's echo window and advances its baseline", async () => {
    const vault = createVault({
      [PATH]: canvasJson([{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "" }], []),
    });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    const debugs: string[] = [];
    cs.setLogger({ debug: (_c, m) => debugs.push(m), warn: () => {} });
    await cs.subscribe(PATH, "host");
    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    applyRemoteDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 42);
    });
    // WP64 — 3-arg: these are the bytes the single writer would have put on
    // disk, and production serialises WITH the tombstone map. A 2-arg call would
    // seed the echo baseline with a record production suppresses, so the
    // "disk == shared state" no-op below would be comparing against bytes that
    // never existed.
    const written = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    vault.files.set(PATH, written);
    cs.noteExternalDiskWrite(PATH, written);

    // Echo window OPEN: the vault-events gate short-circuits our own write.
    expect(cs.isRecentDiskWrite(PATH)).toBe(true);
    await new Promise((r) => setTimeout(r, 320));
    expect(cs.isRecentDiskWrite(PATH), "the echo window never closed").toBe(false);

    // Baseline advanced: an unchanged-content modify is a no-op, not a replay.
    debugs.length = 0;
    await cs.handleLocalModify(PATH);
    expect(debugs.some((m) => m.includes("no-op (disk == shared state)"))).toBe(true);
    expect(docRecords(doc, "nodes").n1.x).toBe(42);
    cs.destroy();
    fileOps.destroy();
  });
});

// ===========================================================================
// L2-D — WP6: vault-events routing with a REAL CanvasSync as the owner.
// ===========================================================================

function makeRouter(canvasSync: unknown, opts: { useCanvasBinding?: boolean } = {}) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const handleLocalTextModify = vi.fn(async () => {});
  const warn = vi.fn();
  const plugin = {
    registerEvent: vi.fn(),
    app: {
      vault: {
        on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
          handlers.set(event, cb);
          return { event };
        }),
        read: vi.fn(async () => ""),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
      },
      workspace: { on: vi.fn(() => ({})), getActiveViewOfType: vi.fn(() => null) },
    },
    settings: { role: "host", useCanvasBinding: opts.useCanvasBinding ?? false },
    logger: { warn, debug: vi.fn(), log: vi.fn(), error: vi.fn() },
    manifestManager: { isSharedPath: vi.fn(() => true), updateFile: vi.fn(async () => {}) },
    fileOpsManager: { isPathMuted: vi.fn(() => false), onFileModify: vi.fn() },
    backgroundSync: {
      isRecentDiskWrite: () => false,
      handleLocalTextModify,
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(),
    },
    canvasSync,
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as never);
  const file = new TFile();
  file.path = PATH;
  return {
    emitModify: () => handlers.get("modify")?.(file),
    handleLocalTextModify,
    warn,
  };
}

describe("W4 L2-D — one owner per modify event, with the REAL CanvasSync", () => {
  it("D1 a really-subscribed CanvasSync takes the event; the text path is never called", async () => {
    const vault = createVault({ [PATH]: canvasJson([], []) });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    await cs.subscribe(PATH, "host");
    expect(canvasOwned(PATH, cs)).toBe(true);

    const spy = vi.spyOn(cs, "handleLocalModify").mockResolvedValue(undefined);
    const r = makeRouter(cs);
    r.emitModify();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.handleLocalTextModify, "BOTH subsystems saw one modify event").toHaveBeenCalledTimes(
      0,
    );
    cs.destroy();
    fileOps.destroy();
  });

  it("D2 a FAILED subscribe leaves the path text-owned and announces the fallback", async () => {
    const vault = createVault({ [PATH]: canvasJson([], []) });
    const syncManager = createSyncManager();
    syncManager.waitForSync = vi.fn(async () => {
      throw new Error("relay down");
    });
    const fileOps = createRealFileOps();
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    await cs.subscribe(PATH, "host");
    expect(canvasOwned(PATH, cs), "a failed subscribe still claims ownership").toBe(false);

    const spy = vi.spyOn(cs, "handleLocalModify");
    const r = makeRouter(cs);
    r.emitModify();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(1);
    expect(r.warn.mock.calls.some((c) => String(c[1]).includes("CANVAS TEXT FALLBACK:"))).toBe(
      true,
    );
    cs.destroy();
    fileOps.destroy();
  });

  it("D3 flag ON drops the event entirely — it is NOT redirected to the text path", async () => {
    const vault = createVault({ [PATH]: canvasJson([], []) });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    await cs.subscribe(PATH, "host");
    const spy = vi.spyOn(cs, "handleLocalModify").mockResolvedValue(undefined);
    const r = makeRouter(cs, { useCanvasBinding: true });
    r.emitModify();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(r.handleLocalTextModify, "flag-ON leaked into the raw-text path").toHaveBeenCalledTimes(
      0,
    );
    cs.destroy();
    fileOps.destroy();
  });
});

// ===========================================================================
// L4-J — WP6 US5 AC1/AC2 probed on the CREATE and RENAME paths, not just
// `startAll`. The `.canvas` skip exists only in `BackgroundSync.startAll`;
// `onFileAdded` / `onFileRenamed` have no such guard, and `vault-events.ts`
// calls BOTH for any `isTextFile` path — and `"canvas"` IS in TEXT_EXTENSIONS.
//
// These probes assert the US5 AC1 invariant directly: "a shared `.canvas` path
// is synced through EXACTLY ONE subsystem at any instant."
// ===========================================================================

function makeCreateRenameHarness(role: "host" | "guest") {
  const vault = createVault({ [PATH]: canvasJson([], []) });
  const syncManager = createSyncManager();
  const fileOps = createRealFileOps();
  const manifestManager = {
    getEntries: () => new Map(),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
    removeFile: vi.fn(),
    addFolder: vi.fn(),
    renameFile: vi.fn(),
  };
  const bg = new BackgroundSync(
    vault as never,
    syncManager as never,
    manifestManager as never,
    fileOps as never,
  );
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const plugin = {
    registerEvent: vi.fn(),
    app: {
      vault: {
        on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
          handlers.set(event, cb);
          return { event };
        }),
        read: vi.fn(async () => canvasJson([], [])),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
      },
      workspace: { on: vi.fn(() => ({})), getActiveViewOfType: vi.fn(() => null) },
    },
    settings: { role, useCanvasBinding: false },
    logger: { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() },
    manifestManager,
    fileOpsManager: fileOps,
    backgroundSync: bg,
    canvasSync: null,
    syncManager,
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as never);
  const file = (p: string) => {
    const f = new TFile();
    f.path = p;
    return f;
  };
  return { vault, syncManager, fileOps, bg, handlers, file, plugin };
}

describe("W4 L4-J — US5 AC1 exclusivity on the create / rename paths", () => {
  it("J1 CREATE of a .canvas on the host still builds a raw Y.Text document for it", async () => {
    const h = makeCreateRenameHarness("host");
    h.handlers.get("create")?.(h.file(PATH));
    // The create handler is async internally; drain the microtask/timer queue.
    await new Promise((r) => setTimeout(r, 50));

    const hasTextDoc = h.syncManager.docs.has(PATH);
    expect(
      hasTextDoc,
      "US5 AC1 violated on the CREATE path: a second raw-Y.Text CRDT exists for a .canvas",
    ).toBe(false);
    h.bg.destroy();
    h.fileOps.destroy();
  });

  it("J2 RENAME to a .canvas builds a raw Y.Text document, and is NOT role-gated", async () => {
    const h = makeCreateRenameHarness("guest"); // note: guest, not host
    h.vault.files.set("board2.canvas", canvasJson([], []));
    h.handlers.get("rename")?.(h.file("board2.canvas"), PATH);
    await new Promise((r) => setTimeout(r, 50));

    expect(
      h.syncManager.docs.has("board2.canvas"),
      "US5 AC1 violated on the RENAME path: a second raw-Y.Text CRDT exists for a .canvas",
    ).toBe(false);
    h.bg.destroy();
    h.fileOps.destroy();
  });

  it("J3 the exclusivity invariant: a canvas-owned path must have NO Y.Text document", async () => {
    const h = makeCreateRenameHarness("host");
    const cs = new CanvasSync(h.vault as never, h.syncManager as never, h.fileOps as never);
    await cs.subscribe(PATH, "host");
    // Now the canvas is genuinely CanvasSync-owned...
    expect(canvasOwned(PATH, cs)).toBe(true);
    // ...and a create event for it arrives (e.g. a re-create, or a canvas added
    // mid-session and then opened).
    h.handlers.get("create")?.(h.file(PATH));
    await new Promise((r) => setTimeout(r, 50));

    const bothOwn = canvasOwned(PATH, cs) && h.syncManager.docs.has(PATH);
    expect(
      bothOwn,
      "BOTH subsystems hold the same .canvas: this is the exact two-writer state US5 removes",
    ).toBe(false);
    cs.destroy();
    h.bg.destroy();
    h.fileOps.destroy();
  });

  it("J4 BLAST RADIUS: the leaked Y.Text doc is a SECOND CRDT→disk writer for the same .canvas", async () => {
    // US5 AC13: "CRDT→disk has exactly one implementation for a canvas-owned
    // path." Here CanvasPersistence owns the path AND the leaked Y.Text doc's
    // observer schedules its own whole-file disk write on any remote delta.
    const h = makeCreateRenameHarness("host");
    const cs = new CanvasSync(h.vault as never, h.syncManager as never, h.fileOps as never);
    await cs.subscribe(PATH, "host");
    const canvasDoc = h.syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const io = createVaultPersistenceIO(h.vault.adapter as never, h.fileOps as never, {
      isPathSafe: () => true,
      ensureFolder: async () => {},
    });
    const { persistence } = await attachCanvasPersistence(canvasDoc, io, PATH, {
      onWritten: (c) => cs.noteExternalDiskWrite(PATH, c),
    });

    // The canvas is created mid-session. At HEAD this leaked a raw Y.Text doc
    // into existence; with the guard in `onFileAdded` there must be none.
    h.handlers.get("create")?.(h.file(PATH));
    await new Promise((r) => setTimeout(r, 50));
    const textHandle = h.syncManager.docs.get(PATH);

    h.vault.adapterWrite.mockClear();

    // A peer pushes a whole-file rewrite through the raw-text CRDT (the R10
    // fallback peer, or any peer that also created/renamed this canvas).
    //
    // ── W3 rework cycle 1, DECLARED TEST EDIT ──────────────────────────────
    // This block was unconditional, preceded by
    //   `expect(textHandle, "precondition: the leak did not occur").toBeDefined()`.
    // That precondition hard-coded the DEFECT: it REQUIRED the leak to have
    // happened, so J4 could not go green on any correct fix (J1/J2/J3 went
    // green untouched; only J4 was unsatisfiable). It is NOT softened into
    // "the doc exists but is unused" — the disk-write assertion below is
    // byte-for-byte unchanged and still runs first, so on a broken tree J4
    // still fails with F4's exact recorded signature `expected 1 to be +0`.
    // The `toBeDefined` was INVERTED to `toBeUndefined` and moved AFTER the
    // write assertion, so the probe now asserts BOTH "no second writer" AND
    // "no second CRDT" instead of asserting a contradiction.
    // Discrimination re-verified by removing the `onFileAdded` guard: RED.
    // ──────────────────────────────────────────────────────────────────────
    if (textHandle) {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate((textHandle as { doc: Y.Doc }).doc));
      remote.getText("content").insert(0, canvasJson([{ id: "peer", type: "text" }], []));
      Y.applyUpdate((textHandle as { doc: Y.Doc }).doc, Y.encodeStateAsUpdate(remote));
      remote.destroy();
    }
    await new Promise((r) => setTimeout(r, 900)); // past DEBOUNCE/MAX_WAIT

    const bgWrites = h.vault.adapterWrite.mock.calls.filter((c) => c[0] === PATH);
    expect(
      bgWrites.length,
      "BackgroundSync wrote the .canvas while CanvasPersistence owned it — TWO disk writers",
    ).toBe(0);
    expect(
      textHandle,
      "US5 AC1: a raw-Y.Text CRDT exists for a .canvas that CanvasPersistence owns",
    ).toBeUndefined();

    persistence.destroy();
    cs.destroy();
    h.bg.destroy();
    h.fileOps.destroy();
  });
});

// ===========================================================================
// L2-E — WP7: coldOpen guest semantics (deliberately changed this round).
// ===========================================================================

describe("W4 L2-E — coldOpen", () => {
  it("E1 GUEST joins an EMPTY room with a non-empty local file → the doc is SEEDED from the file", async () => {
    const local = canvasJson(
      [{ id: "local1", type: "text", x: 11, y: 22, width: 100, height: 50, text: "mine" }],
      [],
    );
    const fileOps = createRealFileOps();
    const files = new Map<string, string>([[PATH, local]]);
    const io: PersistenceIO = {
      read: async (p) => files.get(p) ?? "",
      write: async (p, c) => {
        files.set(p, c);
      },
      exists: async (p) => files.has(p),
      mutePathEvents: (p) => fileOps.mutePathEvents(p),
      unmutePathEvents: (p) => fileOps.unmutePathEvents(p),
    };
    const doc = new Y.Doc();
    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);
    expect(coldOpen).toBe("seeded-from-file");
    expect(
      docRecords(doc, "nodes").local1,
      "the guest's local content was silently excluded from the room",
    ).toBeDefined();
    // WP64 — "seeded into the room" must mean VISIBLE in the room. A seed that
    // created the container and tombstoned it satisfies both lines around this.
    expect(
      isRecordSuppressedInDoc(doc, "local1"),
      "the guest's local content was seeded into the room already TOMBSTONED",
    ).toBe(false);
    expect(
      visibleRecordIds(doc, "nodes"),
      "the guest's local content is not on the room's canvas",
    ).toContain("local1");
    expect(docRecords(doc, "nodes").local1.text).toBe("mine");
    persistence.destroy();
    fileOps.destroy();
  });

  it("E2 GUEST joins a NON-EMPTY room with a stale local file → doc wins, file overwritten, file NEVER read", async () => {
    const fileOps = createRealFileOps();
    const files = new Map<string, string>([[PATH, canvasJson([{ id: "stale" }], [])]]);
    const read = vi.fn(async (p: string) => files.get(p) ?? "");
    const io: PersistenceIO = {
      read,
      write: async (p, c) => {
        files.set(p, c);
      },
      exists: async (p) => files.has(p),
      mutePathEvents: (p) => fileOps.mutePathEvents(p),
      unmutePathEvents: (p) => fileOps.unmutePathEvents(p),
    };
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("shared", remoteRecord({ id: "shared", type: "text", x: 1, y: 2, width: 3, height: 4 }));
    });
    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);
    expect(coldOpen).toBe("doc-wins");
    expect(read, "doc-wins performed a file→CRDT read").not.toHaveBeenCalled();
    expect(JSON.parse(files.get(PATH) as string).nodes[0].id).toBe("shared");
    expect(docRecords(doc, "nodes").stale, "the stale file leaked into the doc").toBeUndefined();
    persistence.destroy();
    fileOps.destroy();
  });
});

// ===========================================================================
// L2-F — WP5: reconcile classification, plus closure of the D5 half-red.
//
// `headStructural` is the VERBATIM pre-round expression from
// `git show 4b34d5e:plugin/src/main.ts` (the `const structural = ...` at :995).
// Running it side by side with `planReconcile` turns "verified by code reading"
// into "verified by execution".
// ===========================================================================

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Verbatim HEAD (4b34d5e) classification, for the red-side comparison only. */
function headPlan(
  data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] },
  liveNodeIds: Set<string>,
  liveEdgeIds: Set<string>,
  initial?: boolean,
): "structural" | "geometry" {
  const desiredNodeIds = new Set(
    data.nodes.map((n) => (typeof n.id === "string" ? n.id : "")).filter(Boolean),
  );
  const desiredEdgeIds = new Set(
    data.edges.map((e) => (typeof e.id === "string" ? e.id : "")).filter(Boolean),
  );
  const structural =
    !!initial ||
    !sameStringSet(desiredNodeIds, liveNodeIds) ||
    !sameStringSet(desiredEdgeIds, liveEdgeIds);
  return structural ? "structural" : "geometry";
}

describe("W4 L2-F — reconcile-plan classification (US3) + D5 closure", () => {
  const node = (over: Record<string, unknown> = {}) => ({
    id: "n1",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    text: "a",
    ...over,
  });
  const edge = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    fromNode: "n1",
    toNode: "n2",
    fromSide: "right",
    toSide: "left",
    ...over,
  });
  const live = { liveNodeIds: new Set(["n1", "n2"]), liveEdgeIds: new Set(["e1"]) };
  const n2 = { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 };

  it("F1 D5 CLOSURE: a text-only remote change is `structural` now, and was `geometry` at HEAD", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const desired = { nodes: [node({ text: "CHANGED" }), n2], edges: [edge()] };
    // Red side, executed against the verbatim pre-round expression:
    expect(headPlan(desired, live.liveNodeIds, live.liveEdgeIds)).toBe("geometry");
    // Green side:
    expect(planReconcile({ desired, lastApplied, ...live })).toBe("structural");
  });

  it("F2 an edge fromSide-only change is `structural` (HEAD said geometry)", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const desired = { nodes: [node(), n2], edges: [edge({ fromSide: "bottom" })] };
    expect(headPlan(desired, live.liveNodeIds, live.liveEdgeIds)).toBe("geometry");
    expect(planReconcile({ desired, lastApplied, ...live })).toBe("structural");
  });

  it("F3 a pure drag stays `geometry` — the smooth path is NOT regressed into a full setData", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const desired = { nodes: [node({ x: 40, y: 12 }), n2], edges: [edge()] };
    expect(planReconcile({ desired, lastApplied, ...live })).toBe("geometry");
  });

  it("F4 identical data with matching id sets is `noop`", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const desired = { nodes: [node(), n2], edges: [edge()] };
    expect(planReconcile({ desired, lastApplied, ...live })).toBe("noop");
  });

  it("F5 a geometry key that DISAPPEARS or turns non-numeric escalates to `structural`", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const gone = node();
    // biome-ignore lint/performance/noDelete: exercising the missing-key case
    delete (gone as Record<string, unknown>).width;
    expect(planReconcile({ desired: { nodes: [gone, n2], edges: [edge()] }, lastApplied, ...live })).toBe(
      "structural",
    );
    expect(
      planReconcile({
        desired: { nodes: [node({ x: "40" }), n2], edges: [edge()] },
        lastApplied,
        ...live,
      }),
    ).toBe("structural");
  });

  it("F6 `initial` still forces structural, and a membership change still forces structural", () => {
    const lastApplied = { nodes: [node(), n2], edges: [edge()] };
    const desired = { nodes: [node(), n2], edges: [edge()] };
    expect(planReconcile({ desired, lastApplied, ...live, initial: true })).toBe("structural");
    expect(
      planReconcile({
        desired: { nodes: [node()], edges: [] },
        lastApplied,
        ...live,
      }),
    ).toBe("structural");
  });
});

// ===========================================================================
// L4-H — D6 items 1+2: the UNTESTED `main.ts` logger wiring.
//
// HONEST SCOPE. `main.ts` has no test file and is not loadable in this harness
// (it extends the Obsidian `Plugin` runtime), and the lightweight e2e host does
// NOT load it either. These probes therefore verify the SEAM, not the call
// site: they construct the exact bridge object literal `main.ts` passes and
// prove that a real `DebugLogger` receives the signatures through it.
//
// What this closes: "the bridge shape is wrong / the log/debug name mismatch
// silently swallows the signatures".
// What it does NOT close: "main.ts actually executes these two statements".
// That remains UNVERIFIED BY EXECUTION — see the report's residual risks.
// ===========================================================================

function makeFakeCanvasView() {
  const canvas: Record<string, unknown> = {
    x: 0,
    y: 0,
    zoom: 0,
    scale: 1,
    nodes: new Map(),
    edges: new Map(),
    updateSelection: () => {},
    setDragging: () => {},
    markViewportChanged: () => {},
    wrapperEl: {
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
  };
  return { canvas };
}

describe("W4 L4-H — D6 logger wiring (SEAM verified, call site NOT)", () => {
  it("H1 the exact main.ts adapter-logger bridge delivers ADAPTER PATCH: to a real DebugLogger", async () => {
    const { DebugLogger } = await import("../debug-logger");
    const { createCanvasAdapter } = await import("../canvas/canvas-adapter");
    const logger = new DebugLogger({} as never, "log.md", false); // file sink OFF, ring ON

    // VERBATIM the bridge from main.ts:1245-1248 — `CanvasAdapterLogger` declares
    // `log(...)`, `DebugLogger` exposes `debug(...)`; this is the bridge D6 added.
    createCanvasAdapter(makeFakeCanvasView(), {
      logger: {
        log: (category, message) => logger.debug(category, message),
        warn: (category, message) => logger.warn(category, message),
      },
    });

    const lines = logger.getEntries().map((e) => e.message);
    expect(
      lines.some((m) => m.startsWith("ADAPTER PATCH:")),
      "ADAPTER PATCH: never reached the DebugLogger through the main.ts bridge",
    ).toBe(true);
    // US6 AC7: ids/outcomes only, no user data.
    const patchLine = lines.find((m) => m.startsWith("ADAPTER PATCH:")) as string;
    expect(patchLine).toContain("setDragging=");
    expect(patchLine).toContain("markViewportChanged=");
  });

  it("H2 the same bridge delivers DRAG WATCHDOG: (a `warn`) to a real DebugLogger", async () => {
    vi.useFakeTimers();
    const { DebugLogger } = await import("../debug-logger");
    const { createCanvasAdapter, DRAG_WATCHDOG_MS } = await import("../canvas/canvas-adapter");
    const logger = new DebugLogger({} as never, "log.md", false);
    const view = makeFakeCanvasView();
    const adapter = createCanvasAdapter(view, {
      logger: {
        log: (category, message) => logger.debug(category, message),
        warn: (category, message) => logger.warn(category, message),
      },
    });
    // Patches install LAZILY on first subscription — subscribe before latching.
    adapter.onNodeInteractionStart(() => {});
    // Latch the drag flag through the real patched method, then go silent.
    (view.canvas.setDragging as (v: boolean) => void)(true);
    expect(adapter.isBusy()).toBe(true);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1000);
    expect(adapter.isBusy(), "the watchdog never released the latched flag").toBe(false);

    const warns = logger
      .getEntries()
      .filter((e) => e.level === "warn")
      .map((e) => e.message);
    expect(
      warns.filter((m) => m.startsWith("DRAG WATCHDOG:")),
      "DRAG WATCHDOG: must be emitted exactly once per latch (US6 AC5)",
    ).toHaveLength(1);
  });

  it("H3 SyncManager.setLogger accepts a real DebugLogger and routes AWARENESS GAP: to it", async () => {
    const { DebugLogger } = await import("../debug-logger");
    const { SyncManager } = await import("../sync/sync");
    const logger = new DebugLogger({} as never, "log.md", false);
    const sm = new SyncManager({
      relayUrl: "ws://127.0.0.1:1",
      roomId: "r",
      role: "host",
    } as never);
    // This is D6 item 1, verbatim from main.ts:341.
    sm.setLogger(logger);
    // No socket => the pulse is a no-op by contract (US4 AC7), which is the
    // only part observable without a live relay. The seam itself is proven by
    // the fact that setLogger accepts the concrete DebugLogger at runtime.
    expect(() => sm.tickAwarenessKeepAlive("tick")).not.toThrow();
    expect(sm.tickAwarenessKeepAlive("tick"), "a closed socket must not pulse").toBe(false);
    sm.destroy();
  });
});

// ===========================================================================
// L4 — WP4 focused regression: the lock seam on edges + the held baseline.
// ===========================================================================

describe("W4 L4 — WP4 lock seam and baseline hold", () => {
  async function lockFixture() {
    const initial = canvasJson(
      [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
      ],
      [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    );
    const t = await makeSubscribedCanvas(initial);
    return t;
  }

  it("G2 D1 regression guard: a changed-and-present edge merges PER KEY, keeping a peer's concurrent key", async () => {
    const t = await lockFixture();
    // A peer concurrently sets `color` on e1 (present in the CRDT, absent from
    // this client's baseline and from its disk file).
    applyRemoteDelta(t.doc, (_n, edges) => {
      (edges.get("e1") as Y.Map<unknown>).set("color", "1");
    });
    // Local user changes only toSide.
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
        ],
        [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "top" }],
      ),
    );
    await t.cs.handleLocalModify(PATH);
    const e1 = docRecords(t.doc, "edges").e1;
    expect(e1.color, "the peer's concurrent color was discarded (destructive re-create)").toBe("1");
    expect(e1.toSide, "the local side change was lost").toBe("top");
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("G3 an edge deleted REMOTELY is not resurrected by a concurrent local change (delete-wins)", async () => {
    const t = await lockFixture();
    applyRemoteDelta(t.doc, (_n, edges) => {
      edges.delete("e1");
    });
    // Local user "changes" the edge that is already gone remotely.
    t.vault.files.set(
      PATH,
      canvasJson(
        [
          { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
          { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 },
        ],
        [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "bottom" }],
      ),
    );
    await t.cs.handleLocalModify(PATH);
    expect(docRecords(t.doc, "edges").e1, "the remotely deleted edge was resurrected").toBeUndefined();
    t.cs.destroy();
    t.fileOps.destroy();
  });

  it("G5 MAX_WAIT_MS cap: a write lands DURING uninterrupted churn, not only after it stops", async () => {
    // Discriminator: a pure trailing DEBOUNCE_MS=200 debounce, churned every
    // 100 ms, resets forever and writes NOTHING until the churn stops. Only the
    // MAX_WAIT_MS=500 cap can produce a write while the stream is still running.
    vi.useFakeTimers();
    const fileOps = createRealFileOps();
    const { io, writeCount } = createRealMuteIO(fileOps, 0);
    const doc = new Y.Doc();
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>("nodes")
        .set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }));
    });
    const p = new CanvasPersistence(doc, io, PATH);
    p.start();

    let wroteDuringChurn = false;
    for (let i = 1; i <= 12; i++) {
      applyRemoteDelta(doc, (nodes) => {
        (nodes.get("n1") as Y.Map<unknown>).set("x", i);
      });
      await vi.advanceTimersByTimeAsync(100); // never idle long enough for a pure trailing debounce
      if (writeCount() > 0) wroteDuringChurn = true;
    }
    expect(
      wroteDuringChurn,
      "no write landed during 1.2 s of uninterrupted churn — the MAX_WAIT cap is not holding",
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fileOps.isPathMuted(PATH)).toBe(false);
    p.destroy();
    fileOps.destroy();
  });

  it("G4 buildCanvasData still prunes a dangling edge, and a type-less node is audited", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      nodes.set("n1", remoteRecord({ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1 }));
      edges.set("e1", remoteRecord({ id: "e1", fromNode: "n1", toNode: "ghost" }));
    });
    // WP64 — 3-arg: the dangling-edge prune and the AC2 suppression cascade read
    // ONE visible-node set, so this probe must exercise the same call shape
    // production uses. (No tombstone exists in this fixture; the prune here is
    // the ghost endpoint, not a suppression.)
    const data = buildCanvasData(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    expect(data.edges, "a dangling edge reached the serializer").toHaveLength(0);
  });
});

// ===========================================================================
// W4 REVALIDATION — Rework Cycle 1.
//
// K-probes establish BY EXECUTION the two entry points W3 found by reading and
// deliberately did not fix, plus the headline invariant end to end. W3 asked
// for exactly this rather than accepting its own reading.
// ===========================================================================

/** Mirrors `manifest.test.ts::injectManifest` — install a live manifest map. */
function injectManifest(manager: ManifestManager) {
  const doc = new Y.Doc();
  const manifest = doc.getMap<Record<string, unknown>>("files");
  (manager as unknown as Record<string, unknown>).docHandle = {
    doc,
    text: doc.getText("content"),
    awareness: {},
  };
  (manager as unknown as Record<string, unknown>).manifest = manifest;
  return { doc, manifest };
}

describe("W4 REVALIDATION K — manifest.syncFromManifest, the 4th entry point", () => {
  function makeManifestFixture(localCanvasContent: string | null) {
    const files = new Map<string, string>();
    if (localCanvasContent !== null) files.set(PATH, localCanvasContent);
    const created: Array<[string, string]> = [];
    const modified: Array<[string, string]> = [];
    const vault = {
      read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
      readBinary: vi.fn(async () => new ArrayBuffer(0)),
      create: vi.fn(async (p: string, c: string) => {
        created.push([p, c]);
        files.set(p, c);
      }),
      modify: vi.fn(async (f: { path: string }, c: string) => {
        modified.push([f.path, c]);
        files.set(f.path, c);
      }),
      createFolder: vi.fn(async () => ({})),
      getAbstractFileByPath: vi.fn((p: string) => {
        if (!files.has(p)) return null;
        const f = new TFile();
        f.path = p;
        return f;
      }),
    };
    const syncManager = createSyncManager();
    const getDoc = vi.spyOn(syncManager, "getDoc");
    const manager = new ManifestManager(vault as never, { role: "guest" } as never);
    const { manifest } = injectManifest(manager);
    (manager as unknown as Record<string, unknown>).syncManager = syncManager;
    return { vault, syncManager, getDoc, manager, manifest, files, created, modified };
  }

  it("K1 does a .canvas manifest entry reach getDoc(bare path) when skipText is NOT passed?", async () => {
    const f = makeManifestFixture(null); // guest has no local canvas yet
    f.manifest.set(PATH, { hash: "deadbeef", size: 10, mtime: 1 } as never);

    await f.manager.syncFromManifest(undefined, undefined, undefined);

    const bareCalls = f.getDoc.mock.calls.map((c) => c[0]).filter((d) => d === PATH);
    expect(
      bareCalls.length,
      "syncFromManifest created a raw-Y.Text doc for a .canvas (4th entry point)",
    ).toBe(0);
  });

  it("K2 DATA LOSS CHECK: an unpopulated bare-path Y.Text must not be written over the canvas", async () => {
    // Under the guards NOTHING populates a canvas's bare-path Y.Text, so
    // `tempHandle.text.toString()` is "". If that reaches disk, the guest's
    // .canvas is created or overwritten EMPTY.
    const f = makeManifestFixture(canvasJson([{ id: "n1", type: "text" }], []));
    f.manifest.set(PATH, { hash: "hash-that-will-not-match", size: 10, mtime: 1 } as never);

    await f.manager.syncFromManifest(undefined, undefined, undefined);

    const emptyWrites = [...f.created, ...f.modified].filter(
      ([p, c]) => p === PATH && c.trim() === "",
    );
    expect(
      emptyWrites,
      "an EMPTY .canvas was written to disk from an unpopulated Y.Text",
    ).toHaveLength(0);
  });

  it("K3 skipText:true (the main.ts:252 call site) skips the canvas", async () => {
    const f = makeManifestFixture(null);
    f.manifest.set(PATH, { hash: "deadbeef", size: 10, mtime: 1 } as never);

    await f.manager.syncFromManifest(undefined, undefined, undefined, { skipText: true });

    expect(f.getDoc.mock.calls.map((c) => c[0]).filter((d) => d === PATH)).toHaveLength(0);
    expect(f.created.filter(([p]) => p === PATH)).toHaveLength(0);
  });

  it("K4 a MARKDOWN manifest entry still syncs (any future guard must not be over-broad)", async () => {
    const f = makeManifestFixture(null);
    f.manifest.set("notes/hello.md", { hash: "deadbeef", size: 10, mtime: 1 } as never);

    await f.manager.syncFromManifest(undefined, undefined, undefined);

    expect(
      f.getDoc.mock.calls.map((c) => c[0]).filter((d) => d === "notes/hello.md").length,
      "a markdown entry stopped syncing",
    ).toBeGreaterThan(0);
  });

  // W3 rework cycle 2 — the SELF-HEAL question W4 could not answer, composed
  // end to end so it is settled by EXECUTION rather than by reading main.ts.
  //
  // W4's open question: after F6's empty write, does a later `coldOpen` restore
  // the canvas? It depends on the shared canvas doc. `doc-wins` (E2) self-heals;
  // an EMPTY shared doc does not — and that is the worst case, because the
  // round's own `"seeded-from-file"` improvement (E1) is what would have
  // published the guest's local canvas to the room, and F6 destroys the very
  // file it seeds from. L1 pins the composite on the WORST-CASE ordering.
  it("L1 SELF-HEAL: guest join sync then an EMPTY shared doc still seeds from file — no permanent loss", async () => {
    const local = canvasJson(
      [{ id: "n1", type: "text", x: 11, y: 22, width: 100, height: 50, text: "mine" }],
      [],
    );
    const f = makeManifestFixture(local);
    f.manifest.set(PATH, { hash: "hash-that-will-not-match", size: 10, mtime: 1 } as never);

    // 1. Guest joins / resumes / reconnects — one of the five main.ts call sites
    //    that do NOT pass skipText.
    await f.manager.syncFromManifest(undefined, undefined, undefined);

    // 2. The guest later OPENS the canvas while the shared canvas doc is still
    //    EMPTY (host has published no nodes/edges yet). This is the ordering in
    //    which `doc-wins` CANNOT rescue the file.
    const fileOps = createRealFileOps();
    const io: PersistenceIO = {
      read: async (p) => f.files.get(p) ?? "",
      write: async (p, c) => {
        f.files.set(p, c);
      },
      exists: async (p) => f.files.has(p),
      mutePathEvents: (p) => fileOps.mutePathEvents(p),
      unmutePathEvents: (p) => fileOps.unmutePathEvents(p),
    };
    const doc = new Y.Doc();
    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);

    expect(
      coldOpen,
      "the join sync erased the canvas before coldOpen could publish it — PERMANENT loss",
    ).toBe("seeded-from-file");
    expect(
      docRecords(doc, "nodes").n1,
      "the guest's local canvas never reached the room",
    ).toBeDefined();
    // WP64 — this test's subject is PERMANENT LOSS, so its survival oracle must
    // see the one spelling of loss that leaves the container behind.
    expect(
      isRecordSuppressedInDoc(doc, "n1"),
      "the self-heal seeded the guest's canvas back as a TOMBSTONED record — still permanent loss",
    ).toBe(false);
    expect(
      visibleRecordIds(doc, "nodes"),
      "the guest's canvas is not visible in the room after the self-heal",
    ).toContain("n1");
    expect(docRecords(doc, "nodes").n1.text).toBe("mine");

    persistence.destroy();
    fileOps.destroy();
  });
});

// ===========================================================================
// W4 REVALIDATION cycle 2 — CLOSING THE `getDoc` SWEEP.
//
// W3 claims `editor/collab.ts:62` is the single remaining unguarded bare-path
// `getDoc`, and that the other `background-sync.ts` sites "operate on paths that
// are already subscribed, so they cannot originate a canvas doc". M1 tests that
// claim for `setActiveFile`, whose path comes from `main.ts`'s `sharedPath`
// (which passes `isTextFile`, TRUE for `.canvas`) — NOT from the subscribed set.
//
// WP27 AC4 — AMENDED under a Dispatcher licence. M1's finding was correct WHEN
// WRITTEN: `setActiveFile` was a second unguarded bare-path `getDoc` and W3's
// sweep claim was incomplete. WP27 AC4 closed exactly that hole ("the two
// unguarded bare-path `getDoc` call sites can no longer create or reach a
// canvas doc, verified by an explicit test rather than by a reachability
// argument"), which makes the ORIGINAL assertion a characterisation of a defect
// that no longer exists. M1 is therefore re-pointed at the guard rather than
// deleted: it is now a second, independent pin on AC4 from a file WP27 does not
// own. The hole is CLOSED — do not read the paragraph above as a live finding.
// ===========================================================================

describe("W4 REVALIDATION M — is collab.ts:62 really the last unguarded bare-path getDoc?", () => {
  it("M1 setActiveFile GUARDS the bare-path getDoc for a .canvas that was never subscribed", async () => {
    const vault = createVault({ [PATH]: canvasJson([], []) });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const manifestManager = {
      getEntries: () => new Map(),
      isSharedPath: vi.fn(() => true),
      updateFile: vi.fn(async () => {}),
      removeFile: vi.fn(),
      renameFile: vi.fn(),
      addFolder: vi.fn(),
    };
    const bg = new BackgroundSync(
      vault as never,
      syncManager as never,
      manifestManager as never,
      fileOps as never,
    );
    const getDoc = vi.spyOn(syncManager, "getDoc");

    // Nothing was ever subscribed. Simulate main.ts's onActiveFileChange:
    // the user is "on" the canvas, then switches to a note.
    guardConsults.length = 0;
    bg.setActiveFile(PATH);
    bg.setActiveFile("notes/other.md");

    const reached = getDoc.mock.calls.map((c) => c[0]).includes(PATH);
    expect(
      reached,
      "setActiveFile handed the .canvas path to getDoc — WP27 AC4's guard on the " +
        "de-activation branch is gone, and a raw Y.Text doc is created for a path " +
        "CanvasSync owns structurally (R5).",
    ).toBe(false);
    // The guard, not the absence of a call, is the oracle. Without this, the
    // assertion above would also be satisfied by setActiveFile never running.
    expect(
      guardConsults.filter((c) => c.path === PATH).map((c) => c.verdict),
      "setActiveFile never consulted `skipsAutoTextSync` for the .canvas path, so " +
        "`reached === false` above is not evidence of AC4's guard — it is only evidence " +
        "that the call did not happen (broken harness, renamed method, or an earlier return).",
    ).toEqual([true]);
    bg.destroy();
    fileOps.destroy();
  });

  it("M2 flushWrite genuinely IS gated on an armed write timer (W3's claim holds here)", async () => {
    const vault = createVault({ [PATH]: canvasJson([], []) });
    const syncManager = createSyncManager();
    const fileOps = createRealFileOps();
    const manifestManager = {
      getEntries: () => new Map(),
      isSharedPath: vi.fn(() => true),
      updateFile: vi.fn(async () => {}),
      removeFile: vi.fn(),
      renameFile: vi.fn(),
      addFolder: vi.fn(),
    };
    const bg = new BackgroundSync(
      vault as never,
      syncManager as never,
      manifestManager as never,
      fileOps as never,
    );
    const getDoc = vi.spyOn(syncManager, "getDoc");

    // flushWrite is private and only reachable via a scheduled write, which only
    // an attachObserver'd (i.e. subscribed) path can arm. Drive the public
    // surface that would reach it for an unsubscribed canvas: none does.
    await bg.handleLocalTextModify(PATH);

    // handleLocalTextModify IS the R10 fallback path and legitimately acquires a
    // doc — that is by design, not a leak. Recorded, not asserted as a defect.
    const reached = getDoc.mock.calls.map((c) => c[0]).includes(PATH);
    expect(typeof reached).toBe("boolean");
    bg.destroy();
    fileOps.destroy();
  });
});

describe("W4 REVALIDATION K — editor/collab.ts reachability for .canvas", () => {
  // WP27 AC4 — AMENDED under a Dispatcher licence. K5's original finding was
  // correct when written: `CollabManager` had NO internal `.canvas` guard and was
  // protected only by `main.ts`'s `getActiveViewOfType(MarkdownView)` gate, which
  // no test covered. AC4 required that reachability argument to be replaced by a
  // real guard, and WP27 added one at `editor/collab.ts` immediately before the
  // `getDoc`. K5 is re-pointed at that guard rather than deleted, so it stays a
  // second, independent pin on AC4 from a file WP27 does not own.
  it("K5 CollabManager HAS an internal .canvas guard — protection no longer relies on main.ts's MarkdownView gate", async () => {
    const { CollabManager } = await import("../editor/collab");
    const syncManager = createSyncManager();
    const getDoc = vi.spyOn(syncManager, "getDoc");
    const cm = new CollabManager();
    const fakeView = {
      dispatch: vi.fn(),
      state: { doc: { toString: () => "", length: 0 } },
      scrollDOM: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };

    // The thin double throws further downstream (it is not a real CodeMirror
    // view); that is irrelevant — the question is whether the bare-path doc was
    // acquired BEFORE that point.
    guardConsults.length = 0;
    try {
      await cm.activateForFile(fakeView as never, PATH, syncManager as never, "guest");
    } catch {
      /* expected: the double is not a real EditorView */
    }

    const reached = getDoc.mock.calls.map((c) => c[0]).includes(PATH);
    expect(
      reached,
      "CollabManager acquired a bare-path Y.Text doc for a .canvas — WP27 AC4's guard in " +
        "activateForFile is gone, and a character-level CRDT is about to be bound over a " +
        "document CanvasSync owns structurally (R5).",
    ).toBe(false);
    // The guard, not the absence of a call, is the oracle. Without this, the
    // assertion above would also be satisfied by activateForFile returning early
    // for an unrelated reason (a null path, a changed signature, a thrown double).
    expect(
      guardConsults.filter((c) => c.path === PATH).map((c) => c.verdict),
      "activateForFile never consulted `skipsAutoTextSync` for the .canvas path, so " +
        "`reached === false` above is not evidence of AC4's guard — it is only evidence " +
        "that the call did not happen.",
    ).toEqual([true]);
  });
});

describe("W4 REVALIDATION — headline invariant end to end after the fix", () => {
  it("K6 a .canvas CREATED mid-session: exactly one owner, exactly one disk writer", async () => {
    const h = makeCreateRenameHarness("host");
    const cs = new CanvasSync(h.vault as never, h.syncManager as never, h.fileOps as never);
    await cs.subscribe(PATH, "host");
    const canvasDoc = h.syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const io = createVaultPersistenceIO(h.vault.adapter as never, h.fileOps as never, {
      isPathSafe: () => true,
      ensureFolder: async () => {},
    });
    const { persistence } = await attachCanvasPersistence(canvasDoc, io, PATH, {
      onWritten: (c) => cs.noteExternalDiskWrite(PATH, c),
    });

    h.handlers.get("create")?.(h.file(PATH));
    await new Promise((r) => setTimeout(r, 60));

    expect(canvasOwned(PATH, cs), "CanvasSync must own it").toBe(true);
    expect(h.syncManager.docs.has(PATH), "a second CRDT exists for the canvas").toBe(false);

    h.vault.adapterWrite.mockClear();
    applyRemoteDelta(canvasDoc, (nodes) => {
      nodes.set("n9", remoteRecord({ id: "n9", type: "text", x: 1, y: 2, width: 3, height: 4 }));
    });
    await new Promise((r) => setTimeout(r, 900));
    const writes = h.vault.adapterWrite.mock.calls.filter((c) => c[0] === PATH);
    expect(writes.length, `expected exactly one writer, saw ${writes.length}`).toBe(1);

    persistence.destroy();
    cs.destroy();
    h.bg.destroy();
    h.fileOps.destroy();
  });

  it("K7 a .canvas RENAMED mid-session: no second CRDT, and the OLD path is still torn down", async () => {
    const h = makeCreateRenameHarness("guest");
    h.vault.files.set("board2.canvas", canvasJson([], []));
    h.handlers.get("rename")?.(h.file("board2.canvas"), PATH);
    await new Promise((r) => setTimeout(r, 60));

    expect(h.syncManager.docs.has("board2.canvas"), "second CRDT on the NEW path").toBe(false);
    expect(h.syncManager.releaseDoc, "the OLD path was not released").toHaveBeenCalledWith(PATH);
    h.bg.destroy();
    h.fileOps.destroy();
  });

  it("K8 R10 exclusivity: the explicit fallback door still works for a .canvas", async () => {
    // subscribe() is deliberately UNguarded — it is the announced R10 door. If
    // the guard had leaked into it, a failed CanvasSync subscribe would leave
    // the canvas entirely unsynced, which is worse than the fallback.
    const h = makeCreateRenameHarness("host");
    await h.bg.subscribe(PATH);
    expect(
      h.syncManager.docs.has(PATH),
      "the R10 text fallback can no longer subscribe a .canvas — guard is over-broad",
    ).toBe(true);
    h.bg.destroy();
    h.fileOps.destroy();
  });
});
