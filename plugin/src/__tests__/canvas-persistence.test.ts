import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CANVAS_BINDING_ORIGIN,
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../canvas/canvas-binding";
import {
  CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
  createVaultPersistenceIO,
} from "../files/canvas-persistence";
import { CanvasSync, serializeCanvas } from "../files/canvas-sync";

// ===========================================================================
// SPEC_03 §8 — CanvasPersistence downstream-only writer contract (headless).
//
// The writer observes the SAME per-path Y.Doc as the binding but is strictly
// downstream: it produces ZERO CRDT writes and only writes disk on a debounce.
// All I/O + the clock are injected; timers are vitest fake timers.
// ===========================================================================

// --- injected file I/O fake (in-memory + mute/unmute spies) ---------------
//
// WP7: `muteDepth()` mirrors the REFCOUNTED mute of the real `FileOpsManager`
// (`file-ops.ts:112-125`), so a mute that is never released is observable as a
// nonzero residual depth rather than staying invisible behind a boolean.
function createFakeIO() {
  const files = new Map<string, string>();
  let depth = 0;
  const io = {
    files,
    muteDepth: () => depth,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {
      depth++;
    }),
    unmutePathEvents: vi.fn((_p: string) => {
      depth--;
    }),
  };
  return io satisfies PersistenceIO & {
    files: Map<string, string>;
    muteDepth: () => number;
  };
}

/**
 * WP7 (US5 AC16/AC18b): an IO whose bytes land when the write RESOLVES, not when
 * it is called, with a per-call latency. This is what a real vault adapter does
 * and it is the only way an out-of-order write is observable: two overlapping
 * flushes resolve in whatever order their latencies dictate, and the LAST
 * resolver wins the file.
 */
function createSlowIO(latencies: number[]) {
  const files = new Map<string, string>();
  const inFlight: string[] = [];
  let call = 0;
  const io = {
    files,
    inFlight,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn((p: string, c: string) => {
      const latency = latencies[Math.min(call, latencies.length - 1)];
      call++;
      inFlight.push(c);
      return new Promise<void>((resolve) => {
        globalThis.setTimeout(() => {
          files.set(p, c);
          resolve();
        }, latency);
      });
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string>; inFlight: string[] };
}

// --- minimal vault / sync-manager doubles for the composition test ---------
function createMockVault() {
  const files = new Map<string, string>();
  return {
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
    createFolder: vi.fn(async () => ({})),
    _files: files,
  };
}

function createMockSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
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

/** Refcounted mute surface, matching `FileOpsManager` semantics exactly. */
function createMockFileOps() {
  const muted = new Map<string, number>();
  return {
    mutePathEvents: vi.fn((p: string) => muted.set(p, (muted.get(p) ?? 0) + 1)),
    unmutePathEvents: vi.fn((p: string) => {
      const n = muted.get(p) ?? 0;
      if (n <= 1) muted.delete(p);
      else muted.set(p, n - 1);
    }),
    isPathMuted: (p: string) => (muted.get(p) ?? 0) > 0,
  };
}

// --- two-peer harness (mirrors canvas-sync.test.ts / canvas-binding.test.ts) --
function applyRemoteCanvasDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function remoteNode(fields: CanvasRecord): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
}

function seedDoc(
  doc: Y.Doc,
  nodes: Record<string, CanvasRecord>,
  edges: Record<string, CanvasRecord> = {},
): void {
  doc.transact(() => {
    const nm = doc.getMap<Y.Map<unknown>>("nodes");
    const em = doc.getMap<Y.Map<unknown>>("edges");
    for (const [id, rec] of Object.entries(nodes)) nm.set(id, remoteNode(rec));
    for (const [id, rec] of Object.entries(edges)) em.set(id, remoteNode(rec));
  });
}

/** Count ALL transactions applied to `doc` after attach — used to prove the
 * writer originates none (only intentional deltas/captures should ever appear). */
function countTransactions(doc: Y.Doc): { count: () => number; stop: () => void } {
  let n = 0;
  const handler = (): void => {
    n++;
  };
  doc.on("afterTransaction", handler);
  return { count: () => n, stop: () => doc.off("afterTransaction", handler) };
}

/** Count only CANVAS_BINDING_ORIGIN updates — a nonzero count is an echo/re-push. */
function countOriginUpdates(doc: Y.Doc): { count: () => number; stop: () => void } {
  let n = 0;
  const handler = (_u: Uint8Array, origin: unknown): void => {
    if (origin === CANVAS_BINDING_ORIGIN) n++;
  };
  doc.on("update", handler);
  return { count: () => n, stop: () => doc.off("update", handler) };
}

// --- adversarial fake model bridge (mirrors canvas-binding.test.ts) ---------
class FakeCanvasModel implements CanvasModelBridge {
  readonly nodes = new Map<string, CanvasRecord>();
  readonly edges = new Map<string, CanvasRecord>();
  private readonly listeners = new Set<(c: LocalChange) => void>();

  getNodeIds(): Iterable<string> {
    return [...this.nodes.keys()];
  }
  getEdgeIds(): Iterable<string> {
    return [...this.edges.keys()];
  }
  getNode(id: string): CanvasRecord | null {
    const r = this.nodes.get(id);
    return r ? { ...r } : null;
  }
  getEdge(id: string): CanvasRecord | null {
    const r = this.edges.get(id);
    return r ? { ...r } : null;
  }
  applyNodeUpsert(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
    this.emit({ kind: "node", id, record: { ...record } });
  }
  applyNodeRemove(id: string): void {
    if (this.nodes.delete(id)) this.emit({ kind: "node", id, record: null });
  }
  applyEdgeUpsert(id: string, record: CanvasRecord): void {
    this.edges.set(id, { ...record });
    this.emit({ kind: "edge", id, record: { ...record } });
  }
  applyEdgeRemove(id: string): void {
    if (this.edges.delete(id)) this.emit({ kind: "edge", id, record: null });
  }
  onLocalChange(cb: (change: LocalChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  userSetNode(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
    this.emit({ kind: "node", id, record: { ...record } });
  }
  private emit(change: LocalChange): void {
    for (const l of [...this.listeners]) l(change);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// P1 — debounced write + pruned serialization + ZERO CRDT writes.
// ===========================================================================

describe("CanvasPersistence — debounced writer + zero CRDT writes (SPEC_03 §8)", () => {
  it("P1 writes the pruned, tab-serialized snapshot on a debounce", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    // n1→n2 valid edge e1; e_bad references a missing node → must be pruned.
    seedDoc(
      doc,
      {
        n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 },
        n2: { id: "n2", type: "text", x: 200, y: 0, width: 100, height: 50 },
      },
      {
        e1: { id: "e1", fromNode: "n1", toNode: "n2" },
        e_bad: { id: "e_bad", fromNode: "n1", toNode: "missing" },
      },
    );
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "board.canvas");
    p.start();

    // A change fires the observer → schedules a debounced write.
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 40);
    });
    expect(io.write).not.toHaveBeenCalled(); // still within debounce
    await vi.advanceTimersByTimeAsync(250);

    expect(io.write).toHaveBeenCalledTimes(1);
    const written = io.files.get("board.canvas") ?? "";
    // Exact reuse of the canvas-sync serializer (pruned + tabs).
    expect(written).toBe(
      serializeCanvas(doc.getMap<Y.Map<unknown>>("nodes"), doc.getMap<Y.Map<unknown>>("edges")),
    );
    const parsed = JSON.parse(written) as { nodes: { id: string }[]; edges: { id: string }[] };
    expect(written).toContain("\n\t"); // tab-indented
    expect(parsed.edges.map((e) => e.id)).toEqual(["e1"]); // e_bad pruned
    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    // Echo suppression wrapped the write.
    expect(io.mutePathEvents).toHaveBeenCalledWith("board.canvas");

    p.destroy();
  });

  it("P1 originates ZERO CRDT transactions (writer is strictly downstream)", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0 } });
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "z.canvas");
    p.start();

    // Attach the transaction spy AFTER seeding so it sees only post-start txns.
    const tx = countTransactions(doc);
    const origin = countOriginUpdates(doc);

    // Exactly ONE intentional remote delta.
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 9);
    });
    await vi.advanceTimersByTimeAsync(600); // flush the disk write

    expect(io.write).toHaveBeenCalledTimes(1); // disk write DID happen
    expect(tx.count()).toBe(1); // ...but only the delta's txn — writer added none
    expect(origin.count()).toBe(0); // and no binding-origin echo

    tx.stop();
    origin.stop();
    p.destroy();
  });

  it("P1 both a remote delta AND a local capture trigger a write, neither loops", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0, width: 100, height: 50 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "c.canvas");
    p.start();
    const origin = countOriginUpdates(doc);

    // (a) local capture (binding-authored, CANVAS_BINDING_ORIGIN) → write.
    model.userSetNode("n1", { id: "n1", x: 15, y: 0, width: 100, height: 50 });
    await vi.advanceTimersByTimeAsync(250);
    expect(io.write).toHaveBeenCalledTimes(1);

    // (b) remote delta → write.
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 77);
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(io.write).toHaveBeenCalledTimes(2);

    // The remote delta's follower apply produced zero re-push, and the writer
    // never loops back into the CRDT: only the one intended local capture update.
    expect(origin.count()).toBe(1);
    expect(model.getNode("n1")).toMatchObject({ x: 77 }); // follower converged

    origin.stop();
    binding.destroy();
    p.destroy();
  });
});

// ===========================================================================
// P2 — cold-open load path (SPEC_03 §4).
// ===========================================================================

describe("CanvasPersistence.coldOpen — load path (SPEC_03 §4/§8)", () => {
  it("empty doc + non-empty file → file seeds the doc → model reconciles", async () => {
    const doc = new Y.Doc();
    const io = createFakeIO();
    io.files.set(
      "cold.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", type: "text", x: 5, y: 6, width: 100, height: 50, text: "hi" }],
        edges: [],
      }),
    );
    const p = new CanvasPersistence(doc, io, "cold.canvas");

    const result = await p.coldOpen();
    expect(result).toBe("seeded-from-file");
    expect(io.read).toHaveBeenCalledTimes(1); // file read exactly once
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBe(1); // doc seeded

    // Bind AFTER the seed → the model reconciles to the seeded doc truth.
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    expect(model.getNode("n1")).toMatchObject({ x: 5, y: 6, text: "hi" });

    binding.destroy();
    p.destroy();
  });

  it("non-empty doc + stale file → doc wins, file overwritten, NO file→CRDT read", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", type: "text", x: 100, y: 100, width: 100, height: 50 } });
    const io = createFakeIO();
    // A stale on-disk file that must NOT be read back into the CRDT.
    io.files.set(
      "stale.canvas",
      JSON.stringify({ nodes: [{ id: "STALE", x: -1, y: -1 }], edges: [] }),
    );
    const p = new CanvasPersistence(doc, io, "stale.canvas");
    const tx = countTransactions(doc);

    const result = await p.coldOpen();

    expect(result).toBe("doc-wins");
    expect(io.read).not.toHaveBeenCalled(); // NO file→CRDT read
    expect(tx.count()).toBe(0); // doc-wins path opens no transaction on the doc
    // Stale file overwritten with the canonical doc serialization.
    const written = io.files.get("stale.canvas") ?? "";
    expect(written).toBe(
      serializeCanvas(doc.getMap<Y.Map<unknown>>("nodes"), doc.getMap<Y.Map<unknown>>("edges")),
    );
    expect(written).not.toContain("STALE");

    tx.stop();
    p.destroy();
  });

  it("empty doc + missing file → empty (nothing to seed)", async () => {
    const doc = new Y.Doc();
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "none.canvas");
    expect(await p.coldOpen()).toBe("empty");
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBe(0);
    p.destroy();
  });
});

// ===========================================================================
// P3 — no-feedback regression: streamed drag with the writer attached
//      (mirrors SPEC_01 T6) cannot resurrect the two-writer race.
// ===========================================================================

describe("CanvasPersistence — no-feedback regression (SPEC_03 §8 / SPEC_01 T6)", () => {
  it("50-delta streamed drag WITH the writer attached produces zero extra CRDT updates", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0, width: 100, height: 50 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "drag.canvas");
    p.start();

    const origin = countOriginUpdates(doc); // any nonzero = a re-push / two-writer race
    let finalX = 0;
    for (let i = 1; i <= 50; i++) {
      finalX = i * 3;
      applyRemoteCanvasDelta(doc, (nodes) => {
        nodes.get("n1")?.set("x", finalX);
      });
    }
    await vi.advanceTimersByTimeAsync(600); // flush any pending debounced writes

    expect(model.getNode("n1")).toMatchObject({ x: finalX }); // follower converged
    expect(origin.count()).toBe(0); // writer's disk writes caused NO CRDT update
    expect(io.write).toHaveBeenCalled(); // and disk was actually written

    origin.stop();
    binding.destroy();
    p.destroy();
  });
});

// ===========================================================================
// WP7 — US5 AC13-AC18: CanvasPersistence is the SOLE CRDT→disk writer.
//
// These three cases were written and observed RED before any production change.
// ===========================================================================

describe("WP7 / US5 AC13 — single writer per canvas path", () => {
  it("AC13: with CanvasPersistence attached, ONE remote delta = exactly ONE disk write", async () => {
    vi.useFakeTimers();
    const vault = createMockVault();
    vault._files.set(
      "board.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 }],
        edges: [],
      }),
    );
    const syncManager = createMockSyncManager();
    const fileOps = createMockFileOps();

    // The REAL CanvasSync, subscribed to the path exactly as production does.
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    await cs.subscribe("board.canvas", "host");
    const doc = syncManager.getDoc("__canvas__:board.canvas").doc;

    // The persistence writer over the SAME doc and the SAME vault adapter, so
    // both writers' bytes land on one spy — this is a single-WRITER assertion,
    // not a content assertion.
    const io: PersistenceIO = {
      read: (p) => vault.adapter.read(p),
      write: (p, c) => vault.adapter.write(p, c),
      exists: (p) => vault.adapter.exists(p),
      mutePathEvents: (p) => fileOps.mutePathEvents(p),
      unmutePathEvents: (p) => fileOps.unmutePathEvents(p),
    };
    const p = new CanvasPersistence(doc, io, "board.canvas");
    await p.coldOpen();
    p.start();
    await vi.advanceTimersByTimeAsync(2000); // drain the cold-open write + settle
    vault.adapter.write.mockClear();

    // ONE remote delta.
    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 42);
    });
    await vi.advanceTimersByTimeAsync(2000);

    const writes = vault.adapter.write.mock.calls.filter((c) => c[0] === "board.canvas");
    expect(
      writes.length,
      `expected exactly one writer for board.canvas, saw ${writes.length} disk writes`,
    ).toBe(1);
    expect(JSON.parse(writes[0][1] as string).nodes[0].x).toBe(42);

    p.destroy();
    cs.destroy();
  });

  it("AC14: an in-flight write can never leave PRE-delta bytes on disk", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 } });
    // Write #1 is slow (300 ms); every later write is fast (10 ms). Unserialized,
    // the slow first write resolves LAST and clobbers the newer bytes.
    const io = createSlowIO([300, 10]);
    const p = new CanvasPersistence(doc, io, "race.canvas");
    p.start();

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 1);
    });
    await vi.advanceTimersByTimeAsync(200); // flush #1 issued, write in flight
    expect(io.write).toHaveBeenCalledTimes(1);

    // The remote delta is integrated BEFORE write #1 resolves.
    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 999);
    });
    const postDelta = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
    );

    await vi.advanceTimersByTimeAsync(3000); // let everything drain

    expect(io.files.get("race.canvas")).toBe(postDelta);
    p.destroy();
  });

  it("AC18a: two flushes inside one settle window leave the mute count at ZERO", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 } });
    const io = createFakeIO(); // settleMs defaults to 250; DEBOUNCE_MS is 200
    const p = new CanvasPersistence(doc, io, "leak.canvas");
    p.start();

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 1);
    });
    await vi.advanceTimersByTimeAsync(200); // flush #1 → settle window open until t+250
    expect(io.write).toHaveBeenCalledTimes(1);

    // Flush #2 lands 200 ms later — strictly INSIDE flush #1's 250 ms settle window.
    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 2);
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(io.write).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000); // every settle window has closed

    expect(io.muteDepth(), "mute refcount never returned to zero").toBe(0);
    expect(io.unmutePathEvents.mock.calls.length).toBe(io.mutePathEvents.mock.calls.length);
    p.destroy();
  });

  it("AC18a: destroy() mid-settle also releases the mute (teardown leak)", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 } });
    const io = createFakeIO();
    const p = new CanvasPersistence(doc, io, "teardown.canvas");
    p.start();

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 1);
    });
    await vi.advanceTimersByTimeAsync(200); // write done, settle window still OPEN
    expect(io.muteDepth()).toBe(1);

    p.destroy(); // cancels the settle timer that would have released the mute
    expect(io.muteDepth(), "destroy leaked the mute for the rest of the session").toBe(0);
  });
});

// ===========================================================================
// WP7 — US5 AC15/AC7: the diff baseline and the echo guard survive the handover.
// ===========================================================================

function makeCanvasFixture(initial: Record<string, unknown>) {
  const vault = createMockVault();
  vault._files.set("board.canvas", JSON.stringify(initial));
  const syncManager = createMockSyncManager();
  const fileOps = createMockFileOps();
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  const warns: string[] = [];
  cs.setLogger({
    debug: (_c: string, m: string) => debugs.push(m),
    warn: (_c: string, m: string) => warns.push(m),
  });
  const io = createVaultPersistenceIO(
    {
      read: (p: string) => vault.adapter.read(p),
      write: (p: string, c: string) => vault.adapter.write(p, c),
      exists: async (p: string) => vault._files.has(p),
    },
    fileOps,
    { isPathSafe: () => true, ensureFolder: async () => {} },
  );
  return { vault, syncManager, fileOps, cs, io, debugs, warns };
}

describe("WP7 / US5 AC15+AC7 — lastWrittenContent never goes stale", () => {
  it("AC7: the persistence write opens CanvasSync's echo window, then closes it", async () => {
    vi.useFakeTimers();
    const f = makeCanvasFixture({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    });
    await f.cs.subscribe("board.canvas", "host");
    const doc = f.syncManager.getDoc("__canvas__:board.canvas").doc;
    const { persistence } = await attachCanvasPersistence(doc, f.io, "board.canvas", {
      onWritten: (content) => f.cs.noteExternalDiskWrite("board.canvas", content),
    });

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 42);
    });
    await vi.advanceTimersByTimeAsync(220);

    // `vault-events.ts:121` calls exactly this, unchanged, to drop our own echo.
    expect(f.cs.isRecentDiskWrite("board.canvas")).toBe(true);
    await vi.advanceTimersByTimeAsync(400); // settle window closes
    expect(f.cs.isRecentDiskWrite("board.canvas")).toBe(false);

    persistence.destroy();
    f.cs.destroy();
  });

  it("AC15: after a persistence write, an unchanged-content modify is a no-op (echo-breaker)", async () => {
    vi.useFakeTimers();
    const f = makeCanvasFixture({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    });
    await f.cs.subscribe("board.canvas", "host");
    const doc = f.syncManager.getDoc("__canvas__:board.canvas").doc;
    const { persistence } = await attachCanvasPersistence(doc, f.io, "board.canvas", {
      onWritten: (content) => f.cs.noteExternalDiskWrite("board.canvas", content),
    });

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 42);
    });
    await vi.advanceTimersByTimeAsync(700); // write + settle window fully closed

    f.debugs.length = 0;
    await f.cs.handleLocalModify("board.canvas");

    expect(f.debugs.some((m) => m.includes("no-op (disk == shared state)"))).toBe(true);
    persistence.destroy();
    f.cs.destroy();
  });

  it("AC15: the fed-back baseline stops a stale diff clobbering an un-flushed remote delta", async () => {
    vi.useFakeTimers();
    const f = makeCanvasFixture({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "a" }],
      edges: [],
    });
    await f.cs.subscribe("board.canvas", "host");
    const doc = f.syncManager.getDoc("__canvas__:board.canvas").doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const { persistence } = await attachCanvasPersistence(doc, f.io, "board.canvas", {
      onWritten: (content) => f.cs.noteExternalDiskWrite("board.canvas", content),
    });

    // Remote delta #1 lands AND is persisted → the file now holds x=42.
    applyRemoteCanvasDelta(doc, (n) => {
      (n.get("n1") as Y.Map<unknown>).set("x", 42);
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(JSON.parse(f.vault._files.get("board.canvas") as string).nodes[0].x).toBe(42);

    // The local user edits ONE key of that same file (text), on top of x=42.
    const onDisk = JSON.parse(f.vault._files.get("board.canvas") as string);
    onDisk.nodes[0].text = "edited";
    f.vault._files.set("board.canvas", JSON.stringify(onDisk));

    // Remote delta #2 moves the card again but has NOT reached disk yet.
    applyRemoteCanvasDelta(doc, (n) => {
      (n.get("n1") as Y.Map<unknown>).set("x", 99);
    });

    await f.cs.handleLocalModify("board.canvas");

    // Only the genuinely-edited key was pushed. A STALE baseline (x=0) would have
    // seen x=42 as a local change and clobbered the un-flushed remote x=99.
    expect((nodes.get("n1") as Y.Map<unknown>).get("text")).toBe("edited");
    expect((nodes.get("n1") as Y.Map<unknown>).get("x")).toBe(99);

    persistence.destroy();
    f.cs.destroy();
  });
});

// ===========================================================================
// WP7 — US5 AC16 path guards, AC17 cold-open ordering, US6 CANVAS WRITER:.
// ===========================================================================

describe("WP7 / US5 AC16+AC17 + US6 — write guards, ordering, log signature", () => {
  it("AC16: createVaultPersistenceIO gates on isPathSafe and ensures the parent folder", async () => {
    const written: Array<[string, string]> = [];
    const ensured: string[] = [];
    const io = createVaultPersistenceIO(
      {
        read: async () => "",
        write: async (p: string, c: string) => {
          written.push([p, c]);
        },
        exists: async () => true,
      },
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() },
      {
        isPathSafe: (p) => !p.split(/[\\/]/).includes(".."),
        ensureFolder: async (dir) => {
          ensured.push(dir);
        },
      },
    );

    await io.write("boards/nested/b.canvas", "{}");
    expect(ensured).toEqual(["boards/nested"]); // parity with the retired writer
    expect(written).toEqual([["boards/nested/b.canvas", "{}"]]);

    await expect(io.write("../escape.canvas", "{}")).rejects.toThrow(/unsafe canvas path/);
    expect(written).toHaveLength(1); // nothing escaped the vault
  });

  it("AC17: coldOpen runs BEFORE start — a file→CRDT seed is never written straight back out", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const io = createFakeIO();
    io.files.set(
      "cold.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", type: "text", x: 5, y: 6, width: 100, height: 50 }],
        edges: [],
      }),
    );

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, "cold.canvas");
    expect(coldOpen).toBe("seeded-from-file");
    await vi.advanceTimersByTimeAsync(2000);
    // If start() had preceded coldOpen, the seed transaction would have fired the
    // observer and persisted the freshly-read file straight back out.
    expect(io.write).not.toHaveBeenCalled();

    // ...and the writer IS live from here on.
    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 7);
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(io.write).toHaveBeenCalledTimes(1);

    persistence.destroy();
  });

  it("US6: every disk write emits ONE CANVAS WRITER: line, with no user data", async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, {
      n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "SECRET-NOTE" },
    });
    const io = createFakeIO();
    const lines: string[] = [];
    const p = new CanvasPersistence(doc, io, "log.canvas", {
      logger: { debug: (_c: string, m: string) => lines.push(m) },
    });
    p.start();

    applyRemoteCanvasDelta(doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 3);
    });
    await vi.advanceTimersByTimeAsync(600);

    const emitted = lines.filter((l) => l.startsWith("CANVAS WRITER:"));
    expect(emitted).toHaveLength(1); // once per write, not per delta
    expect(emitted[0]).toContain("log.canvas");
    expect(emitted[0]).toContain("owner=CanvasPersistence");
    expect(emitted[0]).toContain("nodes=1");
    expect(emitted[0]).not.toContain("SECRET-NOTE"); // US6 AC7: no user data

    p.destroy();
  });
});
