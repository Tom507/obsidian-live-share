// WP63 / AC2 — blind counterpart 2. Same claim, attacked from the ledger side
// rather than the path-count side:
//
//   ├── two writers are built over the SAME shared refusal ledger object but
//   │   DIFFERENT paths. A withhold keyed on "this ledger has any refusal"
//   │   instead of "this ledger has a refusal FOR MY PATH" passes every probe
//   │   that gives each path its own ledger instance, and this is exactly how
//   │   the host wiring hands the ledger out (`cs.seedRefusalLedger(path)`).
//   ├── the refused record is a `file`-type node that names no `file`, and the
//   │   same canvas carries a GROUP node — a type absent from the type-specific
//   │   table, which the WP14 amendment says carries NO further requirement, so
//   │   a validator that refuses the unknown type would be caught here, and
//   └── non-fatal is proven POSITIVELY: `flush()` RESOLVES (it is awaited, not
//       merely called), it stays resolved across repeated calls, and a remote
//       delta still lands on the withheld doc afterwards.
//
// I5 DEGRADE: a withheld write is a degraded state for ONE path — never an
// exception, never a silent no-op, never a reason to tear the session down.
// The failure this rules out is the "safe" over-reaction that trades one
// data-loss class for a bigger one.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { TFile } from "obsidian";

const DIRTY = "vault/planning.canvas";
const CLEAN = "vault/archive.canvas";

/** `file`-type node that names no `file` → MISSING_TYPE_SPECIFIC. */
const FILE_LESS = { id: "n-fileless", type: "file", x: 0, y: 0, width: 200, height: 100 };

/** `group` is absent from the type-specific table → nothing further demanded. */
const GROUP = { id: "n-group", type: "group", x: 0, y: 300, width: 800, height: 400 };

const CARD = { id: "n-card", type: "text", x: 400, y: 0, width: 200, height: 100, text: "keep me" };
const OTHER = { id: "n-other", type: "text", x: 0, y: 0, width: 200, height: 100, text: "archive" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

function ioOver(files: Map<string, string>): FakeIO {
  return {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
}

function createVault(files: Map<string, string>) {
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

const DIRTY_FILE = canvasJson([FILE_LESS, GROUP, CARD]);
const CLEAN_FILE = canvasJson([OTHER]);

describe("WP63 AC2 blind2 — one shared ledger, two paths, only one withheld", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a refusal on one path does not suspend a different path served by the SAME ledger", async () => {
    const files = new Map<string, string>([
      [DIRTY, DIRTY_FILE],
      [CLEAN, CLEAN_FILE],
    ]);
    const vault = createVault(files);
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    await cs.subscribe(DIRTY, "host");
    await cs.subscribe(CLEAN, "host");

    const dirtyDoc = syncManager.getDoc(`__canvas__:${DIRTY}`).doc;
    const cleanDoc = syncManager.getDoc(`__canvas__:${CLEAN}`).doc;

    // Guard against a vacuous probe: the seeds must actually have run.
    expect(
      dirtyDoc.getMap<Y.Map<unknown>>("nodes").has("n-card"),
      "the dirty seed never ran — the probe would be vacuous",
    ).toBe(true);
    expect(
      cleanDoc.getMap<Y.Map<unknown>>("nodes").has("n-other"),
      "the clean seed never ran — the probe would be vacuous",
    ).toBe(true);

    // The group carries no further requirement (WP14 amendment) and is admitted.
    expect(
      dirtyDoc.getMap<Y.Map<unknown>>("nodes").has("n-group"),
      "a `group` node was refused — absence from the type table means nothing more demanded",
    ).toBe(true);
    // ...while the genuinely invalid record stays out (WP18 AC1 untouched).
    expect(dirtyDoc.getMap<Y.Map<unknown>>("nodes").has("n-fileless")).toBe(false);

    const dirtyIO = ioOver(files);
    const cleanIO = ioOver(files);

    const dirtyP = new CanvasPersistence(dirtyDoc, dirtyIO, DIRTY, {
      seedRefusals: cs.seedRefusalLedger(DIRTY),
    });
    const cleanP = new CanvasPersistence(cleanDoc, cleanIO, CLEAN, {
      seedRefusals: cs.seedRefusalLedger(CLEAN),
    });

    await dirtyP.coldOpen();
    await cleanP.coldOpen();
    await dirtyP.flush();
    await cleanP.flush();

    // The refused path is withheld and byte-identical...
    expect(dirtyP.isWriteWithheld()).toBe(true);
    expect(files.get(DIRTY), "the refused path's file was rewritten").toBe(DIRTY_FILE);

    // ...and the OTHER path persists completely normally. This is the conjunct
    // a ledger-wide (rather than per-path) predicate gets wrong.
    expect(
      cleanP.isWriteWithheld(),
      "a clean path was withheld because a DIFFERENT path had a refusal",
    ).toBe(false);
    expect(cleanIO.write, "the clean path stopped writing").toHaveBeenCalled();

    dirtyP.destroy();
    cleanP.destroy();
    cs.destroy();
  });

  it("flush RESOLVES on a withheld path, stays resolved, and never throws", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DIRTY, DIRTY_FILE]]));
    const p = new CanvasPersistence(doc, io, DIRTY);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    expect(p.isWriteWithheld()).toBe(true);

    // Awaited, not merely called: a rejected promise fails the test here.
    await expect(p.flush()).resolves.not.toThrow();
    await expect(p.flush()).resolves.not.toThrow();
    await expect(p.flush()).resolves.not.toThrow();

    // Still degraded, still byte-identical, still not an exception.
    expect(p.isWriteWithheld()).toBe(true);
    expect(io.files.get(DIRTY)).toBe(DIRTY_FILE);
    expect(io.write, "a write escaped across repeated flushes").not.toHaveBeenCalled();

    p.destroy();
    doc.destroy();
  });

  it("the withheld canvas keeps receiving remote deltas — only the write-back is suspended", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DIRTY, DIRTY_FILE]]));
    const p = new CanvasPersistence(doc, io, DIRTY);

    await p.coldOpen();
    expect(p.isWriteWithheld()).toBe(true);

    // A remote peer moves a card and adds one. The CRDT must accept both.
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    doc.transact(() => {
      (nodes.get("n-card") as Y.Map<unknown>).set("x", 999);
      const fresh = new Y.Map<unknown>();
      fresh.set("id", "n-remote");
      fresh.set("type", "text");
      fresh.set("x", 10);
      fresh.set("y", 10);
      fresh.set("width", 100);
      fresh.set("height", 50);
      fresh.set("text", "from a peer");
      nodes.set("n-remote", fresh);
    });

    expect((nodes.get("n-card") as Y.Map<unknown>).get("x"), "a remote move was rejected").toBe(999);
    expect(nodes.has("n-remote"), "a remote create was rejected").toBe(true);

    await p.flush();

    // The doc moved on; the file did not. That is the degraded state, not a break.
    expect(io.files.get(DIRTY)).toBe(DIRTY_FILE);
    expect(p.isWriteWithheld()).toBe(true);

    p.destroy();
    doc.destroy();
  });
});
