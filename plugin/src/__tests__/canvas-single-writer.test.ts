// WP6 — US5: a `.canvas` file is written by exactly one authority.
//
// COMPOSITION REGRESSION (US5 AC11/AC12). At HEAD every shared `.canvas` is
// synced through TWO unrelated CRDT documents at once — `__canvas__:<path>` as
// structured nodes/edges (CanvasSync) and `<path>` as one raw Y.Text of the whole
// JSON (BackgroundSync, because "canvas" ∈ TEXT_EXTENSIONS) — and the vault
// `modify` handler feeds BOTH on every local edit, with no `else`. No test at
// HEAD instantiates both subsystems against the same `.canvas` path, which is
// exactly why 526 passing tests never caught it.
//
// This file wires the REAL `registerVaultEvents` dispatcher over a REAL
// `BackgroundSync` + a REAL `CanvasSync` per peer, so the routing decision under
// test is production code, not a re-implementation of it. Cross-peer propagation
// reuses the WP2 harness `waitQuiescent` (state vectors of BOTH peers snapshotted
// BEFORE either update is applied → genuine concurrency, no wall-clock waits).

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { readFileSync } from "node:fs";

import { BackgroundSync } from "../files/background-sync";
import {
  type CanvasPersistence,
  attachCanvasPersistence,
  createVaultPersistenceIO,
} from "../files/canvas-persistence";
import { CanvasSync } from "../files/canvas-sync";
import {
  canvasOwned,
  registerVaultEvents,
  resetCanvasTextFallbackWarnings,
  subscribeCanvasWithHandover,
} from "../files/vault-events";
import { type Peer, makeTwoPeer, waitQuiescent } from "./harness/two-peer";

const PATH = "board.canvas";
const CANVAS_DOC = `__canvas__:${PATH}`;

type Rec = Record<string, unknown>;
type CanvasJson = { nodes: Rec[]; edges: Rec[] };

/** Three cards in a row wired n1 → n2 → n3. Serialized exactly like CanvasSync. */
function initialCanvas(): CanvasJson {
  return {
    nodes: [
      { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "alpha" },
      { id: "n2", type: "text", x: 400, y: 0, width: 200, height: 100, text: "beta" },
      { id: "n3", type: "text", x: 800, y: 0, width: 200, height: 100, text: "gamma" },
    ],
    edges: [
      { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
      { id: "e2", fromNode: "n2", fromSide: "right", toNode: "n3", toSide: "left" },
    ],
  };
}

function serialize(data: CanvasJson): string {
  return JSON.stringify(data, null, "\t");
}

function mockFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

// ---------------------------------------------------------------------------
// One peer = vault + syncManager + manifest + fileOps + BOTH sync subsystems,
// with the production vault-event dispatcher registered over them.
// ---------------------------------------------------------------------------

interface FakePeer {
  name: string;
  files: Map<string, string>;
  vault: any;
  syncManager: any;
  fileOps: any;
  manifestManager: any;
  settings: { role: "host" | "guest"; useCanvasBinding: boolean };
  bg: BackgroundSync;
  cs: CanvasSync;
  textDoc: Y.Doc;
  canvasDoc: Y.Doc;
  calls: string[];
  pending: Promise<unknown>[];
  emitModify: (path: string) => void;
  // WP7: the single CRDT→disk writer, attached exactly as main.ts does — after
  // the subscribe resolves (i.e. after waitForSync), coldOpen then start.
  attachWriter: () => Promise<void>;
  destroyWriter: () => void;
}

function makePeer(name: string, role: "host" | "guest", canvasDoc: Y.Doc): FakePeer {
  const files = new Map<string, string>([[PATH, serialize(initialCanvas())]]);

  const vault = {
    read: vi.fn(async (file: any) => files.get(file.path) ?? ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? mockFile(path) : null)),
    adapter: {
      write: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      writeBinary: vi.fn(async () => {}),
      read: vi.fn(async (path: string) => files.get(path) ?? ""),
    },
  };

  const textDoc = new Y.Doc();
  const docs = new Map<string, any>();
  const syncManager = {
    getDoc: vi.fn((docId: string) => {
      if (!docs.has(docId)) {
        const doc = docId === CANVAS_DOC ? canvasDoc : docId === PATH ? textDoc : new Y.Doc();
        docs.set(docId, {
          doc,
          text: doc.getText("content"),
          awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
        });
      }
      return docs.get(docId);
    }),
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  };

  const entries = new Map<string, any>([[PATH, { hash: "h", size: 1, mtime: 1 }]]);
  const manifestManager = {
    getEntries: vi.fn(() => entries),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
    removeFile: vi.fn(),
    addFolder: vi.fn(),
    renameFile: vi.fn(),
  };

  // Refcounted mutes, matching FileOpsManager semantics.
  const muted = new Map<string, number>();
  const fileOps = {
    mutePathEvents: vi.fn((p: string) => muted.set(p, (muted.get(p) ?? 0) + 1)),
    unmutePathEvents: vi.fn((p: string) => {
      const n = (muted.get(p) ?? 0) - 1;
      if (n <= 0) muted.delete(p);
      else muted.set(p, n);
    }),
    isPathMuted: vi.fn((p: string) => (muted.get(p) ?? 0) > 0),
    onFileCreate: vi.fn(),
    onFileDelete: vi.fn(),
    onFileRename: vi.fn(),
    onFileModify: vi.fn(),
  };

  const bg = new BackgroundSync(
    vault as any,
    syncManager as any,
    manifestManager as any,
    fileOps as any,
  );
  const cs = new CanvasSync(vault as any, syncManager as any, fileOps as any);

  const settings = { role, useCanvasBinding: false };
  const calls: string[] = [];
  const pending: Promise<unknown>[] = [];

  // Delegating façades: identical behaviour to the real objects, but they record
  // the dispatcher's call order and hand us the promises it fires with `void`.
  const bgFacade = {
    isRecentDiskWrite: (p: string) => bg.isRecentDiskWrite(p),
    handleLocalTextModify: vi.fn((p: string) => {
      calls.push("backgroundSync.handleLocalTextModify");
      const pr = bg.handleLocalTextModify(p);
      pending.push(pr);
      return pr;
    }),
    subscribe: vi.fn((p: string) => {
      calls.push("backgroundSync.subscribe");
      const pr = bg.subscribe(p);
      pending.push(pr);
      return pr;
    }),
    unsubscribe: vi.fn((p: string) => {
      calls.push("backgroundSync.unsubscribe");
      bg.unsubscribe(p);
    }),
    onFileAdded: vi.fn((p: string) => bg.onFileAdded(p)),
    onFileRemoved: vi.fn((p: string) => bg.onFileRemoved(p)),
    onFileRenamed: vi.fn((a: string, b: string) => bg.onFileRenamed(a, b)),
    cancelSubscribe: vi.fn((p: string) => bg.cancelSubscribe(p)),
  };
  const csFacade = {
    isSubscribed: (p: string) => cs.isSubscribed(p),
    isRecentDiskWrite: (p: string) => cs.isRecentDiskWrite(p),
    handleLocalModify: vi.fn((p: string) => {
      calls.push("canvasSync.handleLocalModify");
      const pr = cs.handleLocalModify(p);
      pending.push(pr);
      return pr;
    }),
    subscribe: vi.fn((p: string, r: "host" | "guest") => {
      calls.push("canvasSync.subscribe");
      const pr = cs.subscribe(p, r);
      pending.push(pr);
      return pr;
    }),
  };

  const handlers = new Map<string, (...args: any[]) => void>();
  const plugin = {
    registerEvent: vi.fn(),
    app: {
      vault: {
        on: vi.fn((event: string, cb: any) => {
          handlers.set(event, cb);
          return { event };
        }),
        read: vault.read,
        readBinary: vault.readBinary,
        getAbstractFileByPath: vault.getAbstractFileByPath,
      },
      workspace: {
        on: vi.fn(() => ({})),
        getActiveViewOfType: vi.fn(() => null),
      },
    },
    settings,
    manifestManager,
    fileOpsManager: fileOps,
    backgroundSync: bgFacade,
    canvasSync: csFacade,
    syncManager,
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as any);

  // WP7 (US5 AC13): production attaches ONE CanvasPersistence per subscribed
  // canvas path and it is the ONLY component that writes `.canvas` bytes from
  // the CRDT. Without it this composition test would still pass — the endpoints
  // it checks are already correct on disk from setup — but it would stop
  // exercising the post-edit disk write, which is the thing it exists to prove.
  let writer: CanvasPersistence | null = null;
  const attachWriter = async (): Promise<void> => {
    if (writer) return;
    const io = createVaultPersistenceIO(
      {
        read: async (p: string) => files.get(p) ?? "",
        write: (p: string, c: string) => vault.adapter.write(p, c),
        exists: async (p: string) => files.has(p),
      },
      fileOps as any,
      { isPathSafe: () => true, ensureFolder: async () => {} },
    );
    const attached = await attachCanvasPersistence(canvasDoc, io, PATH, {
      onWritten: (content) => cs.noteExternalDiskWrite(PATH, content),
    });
    writer = attached.persistence;
  };

  return {
    name,
    files,
    vault,
    syncManager,
    fileOps,
    manifestManager,
    settings,
    bg,
    cs,
    textDoc,
    canvasDoc,
    calls,
    pending,
    emitModify: (p: string) => handlers.get("modify")?.(mockFile(p)),
    attachWriter,
    destroyWriter: () => {
      writer?.destroy();
      writer = null;
    },
  };
}

/** Reuse the harness state-vector-snapshot exchange for a bare Y.Doc pair. */
function asPeer(doc: Y.Doc): Peer {
  return {
    doc,
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
  } as unknown as Peer;
}

async function drain(peers: FakePeer[], ms = 0): Promise<void> {
  let advance = ms;
  for (let i = 0; i < 6; i++) {
    const all = peers.flatMap((p) => p.pending.splice(0));
    if (all.length > 0) await Promise.all(all);
    await vi.advanceTimersByTimeAsync(advance);
    advance = 0;
  }
}

function readDisk(peer: FakePeer): { raw: string; parsed: CanvasJson | null } {
  const raw = peer.files.get(PATH) ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { raw, parsed: null };
    }
    return { raw, parsed };
  } catch {
    return { raw, parsed: null };
  }
}

/** `id → "fromNode->toNode"` for every edge on disk; "(unparseable)" if the file died. */
function edgeReport(peer: FakePeer): string {
  const { raw, parsed } = readDisk(peer);
  if (!parsed) return `(unparseable JSON, ${raw.length} chars)`;
  return parsed.edges.map((e) => `${e.id}: ${e.fromNode}->${e.toNode}`).join(" | ") || "(no edges)";
}

describe("WP6 / US5 — single-writer precondition for .canvas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("US5 AC11/AC12: concurrent edits touching edges never break edge endpoints", async () => {
    // Two peers, ONE .canvas path, BOTH subsystems live on it.
    const tp = makeTwoPeer();
    const a = makePeer("A", "host", tp.a.doc);
    const b = makePeer("B", "guest", tp.b.doc);
    const peers = [a, b];

    // --- structured subsystem: host seeds from disk, guest adopts shared truth --
    // WP7: the writer is attached AFTER the subscribe resolves on each peer,
    // exactly as main.ts does. The guest's "adopt shared truth" disk write is now
    // `CanvasPersistence.coldOpen()` ("doc-wins"), not a CanvasSync seed write.
    await a.cs.subscribe(PATH, "host");
    await a.attachWriter();
    tp.waitQuiescent();
    await b.cs.subscribe(PATH, "guest");
    await b.attachWriter();
    await drain(peers);

    // --- text subsystem: exactly what BackgroundSync does with the manifest -----
    await a.bg.startAll("host");
    waitQuiescent(asPeer(a.textDoc), asPeer(b.textDoc));
    const bStart = b.bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await bStart;

    // Settle every debounced write, mute and recent-disk-write window from setup.
    await drain(peers, 1000);

    expect(readDisk(a).parsed, "peer A setup produced an unparseable canvas").not.toBeNull();
    expect(readDisk(b).parsed, "peer B setup produced an unparseable canvas").not.toBeNull();

    // --- the concurrent user edits (authored BEFORE any exchange) --------------
    // Peer A: drags card n1 and recolours arrow e1.
    const aFile = JSON.parse(a.files.get(PATH) as string) as CanvasJson;
    (aFile.nodes.find((n) => n.id === "n1") as Rec).x = 400;
    (aFile.edges.find((e) => e.id === "e1") as Rec).color = "1";
    a.files.set(PATH, serialize(aFile));
    a.emitModify(PATH);

    // Peer B: drags card n3 and recolours arrow e2 — at the same instant.
    const bFile = JSON.parse(b.files.get(PATH) as string) as CanvasJson;
    (bFile.nodes.find((n) => n.id === "n3") as Rec).x = 900;
    (bFile.edges.find((e) => e.id === "e2") as Rec).color = "6";
    b.files.set(PATH, serialize(bFile));
    b.emitModify(PATH);

    await drain(peers);

    // --- true concurrency: both state vectors snapshotted before either apply --
    tp.waitQuiescent();
    waitQuiescent(asPeer(a.textDoc), asPeer(b.textDoc));

    // Let every debounced disk writer of both subsystems land.
    await drain(peers, 1200);
    await drain(peers, 1200);

    // --- the property: no arrow may lose or cross an endpoint -----------------
    for (const peer of peers) {
      const { parsed } = readDisk(peer);
      expect(
        parsed,
        `peer ${peer.name} canvas on disk is not valid JSON: ${edgeReport(peer)}`,
      ).not.toBeNull();
      const data = parsed as CanvasJson;

      expect(
        data.nodes.map((n) => n.id).sort(),
        `peer ${peer.name} lost cards: ${JSON.stringify(data.nodes.map((n) => n.id))}`,
      ).toEqual(["n1", "n2", "n3"]);

      const edges = new Map(data.edges.map((e) => [e.id as string, e]));
      expect(
        [...edges.keys()].sort(),
        `peer ${peer.name} lost arrows: ${edgeReport(peer)}`,
      ).toEqual(["e1", "e2"]);

      expect(
        { from: edges.get("e1")?.fromNode, to: edges.get("e1")?.toNode },
        `peer ${peer.name} arrow e1 endpoints: ${edgeReport(peer)}`,
      ).toEqual({ from: "n1", to: "n2" });
      expect(
        { from: edges.get("e2")?.fromNode, to: edges.get("e2")?.toNode },
        `peer ${peer.name} arrow e2 endpoints: ${edgeReport(peer)}`,
      ).toEqual({ from: "n2", to: "n3" });
    }

    for (const peer of peers) peer.destroyWriter();
    tp.destroy();
  });
});

// ---------------------------------------------------------------------------
// Ownership predicate + the four-case dispatch matrix (US5 AC3, AC4, AC6).
//
// These drive the REAL `registerVaultEvents` modify handler over stub
// subsystems, so what is asserted is the production routing decision.
// ---------------------------------------------------------------------------

interface RouterFixture {
  emitModify: (path: string) => void;
  canvasSubscribed: Set<string>;
  canvasRecentDiskWrite: Set<string>;
  bgRecentDiskWrite: Set<string>;
  settings: { role: "host" | "guest"; useCanvasBinding: boolean };
  handleLocalModify: any;
  handleLocalTextModify: any;
  logger: { warn: any; debug: any; log: any; error: any };
}

function makeRouter(opts: { withCanvasSync?: boolean } = {}): RouterFixture {
  const canvasSubscribed = new Set<string>();
  const canvasRecentDiskWrite = new Set<string>();
  const bgRecentDiskWrite = new Set<string>();
  const settings = { role: "host" as const, useCanvasBinding: false };

  const handleLocalModify = vi.fn(async () => {});
  const handleLocalTextModify = vi.fn(async () => {});
  const logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() };

  const canvasSync =
    opts.withCanvasSync === false
      ? null
      : {
          isSubscribed: (p: string) => canvasSubscribed.has(p),
          isRecentDiskWrite: (p: string) => canvasRecentDiskWrite.has(p),
          handleLocalModify,
        };

  const handlers = new Map<string, (...args: any[]) => void>();
  const plugin = {
    registerEvent: vi.fn(),
    app: {
      vault: {
        on: vi.fn((event: string, cb: any) => {
          handlers.set(event, cb);
          return { event };
        }),
        read: vi.fn(async () => ""),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
      },
      workspace: { on: vi.fn(() => ({})), getActiveViewOfType: vi.fn(() => null) },
    },
    settings,
    logger,
    manifestManager: {
      isSharedPath: vi.fn(() => true),
      updateFile: vi.fn(async () => {}),
      removeFile: vi.fn(),
      addFolder: vi.fn(),
      renameFile: vi.fn(),
    },
    fileOpsManager: {
      isPathMuted: vi.fn(() => false),
      onFileModify: vi.fn(),
      onFileCreate: vi.fn(),
      onFileDelete: vi.fn(),
      onFileRename: vi.fn(),
    },
    backgroundSync: {
      isRecentDiskWrite: (p: string) => bgRecentDiskWrite.has(p),
      handleLocalTextModify,
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(),
      onFileAdded: vi.fn(async () => {}),
      onFileRemoved: vi.fn(),
      onFileRenamed: vi.fn(async () => {}),
      cancelSubscribe: vi.fn(),
    },
    canvasSync,
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as any);

  return {
    emitModify: (p: string) => handlers.get("modify")?.(mockFile(p)),
    canvasSubscribed,
    canvasRecentDiskWrite,
    bgRecentDiskWrite,
    settings,
    handleLocalModify,
    handleLocalTextModify,
    logger,
  };
}

describe("WP6 / US5 AC3+AC4+AC6 — canvas ownership predicate and dispatch matrix", () => {
  beforeEach(() => {
    resetCanvasTextFallbackWarnings();
  });

  it("AC3: canvasOwned is `.canvas` AND canvasSync exists AND isSubscribed", () => {
    const owner = { isSubscribed: (p: string) => p === PATH };
    expect(canvasOwned(PATH, owner)).toBe(true);
    expect(canvasOwned("other.canvas", owner)).toBe(false);
    expect(canvasOwned("note.md", { isSubscribed: () => true })).toBe(false);
    expect(canvasOwned(PATH, null)).toBe(false);
    expect(canvasOwned(PATH, undefined)).toBe(false);
  });

  it("AC7/§6.1: a PENDING subscribe already reports owned (no unowned window)", () => {
    const vault = {
      read: vi.fn(async () => "{}"),
      getAbstractFileByPath: vi.fn(() => null),
      adapter: { write: vi.fn(async () => {}) },
    };
    const syncManager = {
      getDoc: vi.fn(() => ({ doc: new Y.Doc(), text: null, awareness: {} })),
      releaseDoc: vi.fn(),
      // never settles → the subscribe stays pending for the whole test
      waitForSync: vi.fn(() => new Promise<void>(() => {})),
    };
    const cs = new CanvasSync(
      vault as any,
      syncManager as any,
      {
        mutePathEvents: vi.fn(),
        unmutePathEvents: vi.fn(),
      } as any,
    );

    expect(canvasOwned(PATH, cs)).toBe(false);
    void cs.subscribe(PATH, "host"); // deliberately NOT awaited
    expect(canvasOwned(PATH, cs)).toBe(true);
  });

  it("AC6 case 1 — subscribed, no disk-write echo, flag OFF → canvas x1, text x0", () => {
    const r = makeRouter();
    r.canvasSubscribed.add(PATH);

    r.emitModify(PATH);

    expect(r.handleLocalModify).toHaveBeenCalledTimes(1);
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(0);
  });

  it("AC6 case 2 — subscribed, CanvasSync's own disk-write echo → NEITHER", () => {
    const r = makeRouter();
    r.canvasSubscribed.add(PATH);
    r.canvasRecentDiskWrite.add(PATH);

    r.emitModify(PATH);

    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
    // The trap this AC exists for: a naive `else` would send the echo here.
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(0);
  });

  it("AC6 case 3 — subscribed, useCanvasBinding ON → NEITHER", () => {
    const r = makeRouter();
    r.canvasSubscribed.add(PATH);
    r.settings.useCanvasBinding = true; // set locally; the default stays false

    r.emitModify(PATH);

    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
    // The second half of the trap: the binding-owned capture must be DROPPED,
    // not redirected to the text path.
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(0);
  });

  it("AC6 case 4 — NOT subscribed, shared path → text x1, canvas x0", () => {
    const r = makeRouter();

    r.emitModify(PATH);

    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(1);
    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
  });

  it("AC3: no canvasSync at all → not canvas-owned → text path", () => {
    const r = makeRouter({ withCanvasSync: false });

    r.emitModify(PATH);

    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(1);
  });

  it("BackgroundSync's own disk-write echo still short-circuits first", () => {
    const r = makeRouter();
    r.canvasSubscribed.add(PATH);
    r.bgRecentDiskWrite.add(PATH);

    r.emitModify(PATH);

    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(0);
  });

  it("a plain markdown modify is unchanged by the canvas restructure", () => {
    const r = makeRouter();

    r.emitModify("notes/hello.md");

    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(1);
    expect(r.handleLocalTextModify).toHaveBeenCalledWith("notes/hello.md");
    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
  });

  it("US5 AC5 / US6: the unowned-canvas text path warns CANVAS TEXT FALLBACK: once per path", () => {
    const r = makeRouter();

    r.emitModify(PATH);
    r.emitModify(PATH);
    r.emitModify("second.canvas");

    const warned = r.logger.warn.mock.calls.filter((c: unknown[]) =>
      String(c[1]).startsWith("CANVAS TEXT FALLBACK:"),
    );
    expect(warned).toHaveLength(2);
    expect(String(warned[0][1])).toContain(PATH);
    expect(String(warned[1][1])).toContain("second.canvas");
    expect(r.handleLocalTextModify).toHaveBeenCalledTimes(3);
  });

  it("a canvas-owned path never emits CANVAS TEXT FALLBACK:", () => {
    const r = makeRouter();
    r.canvasSubscribed.add(PATH);

    r.emitModify(PATH);

    expect(
      r.logger.warn.mock.calls.filter((c: unknown[]) =>
        String(c[1]).startsWith("CANVAS TEXT FALLBACK:"),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Handover ordering + the announced fallback (US5 AC8, AC9, AC10).
// ---------------------------------------------------------------------------

function makeHandover(subscribeImpl: (path: string) => Promise<void> | void) {
  const order: string[] = [];
  const subscribedPaths = new Set<string>();
  const logger = { warn: vi.fn() };

  const backgroundSync = {
    subscribe: vi.fn(async (p: string) => {
      order.push(`backgroundSync.subscribe(${p})`);
    }),
    unsubscribe: vi.fn((p: string) => {
      order.push(`backgroundSync.unsubscribe(${p})`);
    }),
  };
  const canvasSync = {
    subscribe: vi.fn(async (p: string, role: string) => {
      order.push(`canvasSync.subscribe(${p},${role})`);
      await subscribeImpl(p);
    }),
    isSubscribed: (p: string) => subscribedPaths.has(p),
  };

  return { order, subscribedPaths, backgroundSync, canvasSync, logger };
}

describe("WP6 / US5 AC8+AC9+AC10 — handover ordering and the text fallback", () => {
  beforeEach(() => {
    resetCanvasTextFallbackWarnings();
  });

  it("AC8: backgroundSync.unsubscribe is the statement immediately preceding canvasSync.subscribe", async () => {
    const h = makeHandover((p) => {
      h.subscribedPaths.add(p); // a successful subscribe claims the path
    });

    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "host",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });

    expect(owned).toBe(true);
    expect(h.order).toEqual([
      `backgroundSync.unsubscribe(${PATH})`,
      `canvasSync.subscribe(${PATH},host)`,
    ]);
    expect(h.backgroundSync.subscribe).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("AC8: the subscribe is issued SYNCHRONOUSLY, so isSubscribed reads true in the same pass", () => {
    const h = makeHandover((p) => {
      h.subscribedPaths.add(p);
    });

    // Deliberately not awaited — this is how syncCanvasPresences calls it, and the
    // presence mount below it depends on isSubscribed() already being true.
    void subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });

    expect(h.canvasSync.subscribe).toHaveBeenCalledTimes(1);
    expect(h.backgroundSync.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("AC9: a subscribe that settles WITHOUT claiming the path installs the text fallback + warns", async () => {
    const h = makeHandover(() => {
      /* getDoc returned null → subscribedPaths untouched */
    });

    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "host",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });

    expect(owned).toBe(false);
    expect(h.order).toEqual([
      `backgroundSync.unsubscribe(${PATH})`,
      `canvasSync.subscribe(${PATH},host)`,
      `backgroundSync.subscribe(${PATH})`,
    ]);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(h.logger.warn.mock.calls[0][1])).toContain(`CANVAS TEXT FALLBACK: ${PATH}`);
  });

  it("AC9: a REJECTED subscribe also installs the text fallback (never leaves the canvas unsynced)", async () => {
    const h = makeHandover(() => Promise.reject(new Error("waitForSync failed")));

    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "guest",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });

    expect(owned).toBe(false);
    expect(h.backgroundSync.subscribe).toHaveBeenCalledWith(PATH);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("AC10: after a failed subscribe, a later successful one hands the path back in order", async () => {
    let claim = false;
    const h = makeHandover((p) => {
      if (claim) h.subscribedPaths.add(p);
    });

    await subscribeCanvasWithHandover({
      path: PATH,
      role: "host",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });
    claim = true;
    const owned = await subscribeCanvasWithHandover({
      path: PATH,
      role: "host",
      backgroundSync: h.backgroundSync,
      canvasSync: h.canvasSync,
      logger: h.logger,
    });

    expect(owned).toBe(true);
    expect(h.order).toEqual([
      `backgroundSync.unsubscribe(${PATH})`,
      `canvasSync.subscribe(${PATH},host)`,
      `backgroundSync.subscribe(${PATH})`,
      // the hand-back: unsubscribe immediately before the subscribe again
      `backgroundSync.unsubscribe(${PATH})`,
      `canvasSync.subscribe(${PATH},host)`,
    ]);
    // US6 AC5: still exactly one warn for this path in this session.
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("US6 AC5: CANVAS TEXT FALLBACK: is once per path per session and resets with the session", async () => {
    const h = makeHandover(() => {});
    const call = () =>
      subscribeCanvasWithHandover({
        path: PATH,
        role: "host",
        backgroundSync: h.backgroundSync,
        canvasSync: h.canvasSync,
        logger: h.logger,
      });

    await call();
    await call();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);

    resetCanvasTextFallbackWarnings(); // session teardown
    await call();
    expect(h.logger.warn).toHaveBeenCalledTimes(2);
  });

  it("AC8: BOTH main.ts canvasSync.subscribe call sites route through the handover helper", () => {
    const source = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

    // No direct subscribe left anywhere in main.ts...
    // UNCHANGED, and it is the load-bearing half: `main.ts` still states no
    // canvas subscribe of its own. WP79's mirror pass subscribes from
    // `files/canvas-mirror.ts`, which takes `CanvasSync` as one injected object
    // precisely so this assertion stays true and stays meaningful.
    expect(source).not.toMatch(/canvasSync\??\.subscribe\(/);
    // ...and the surviving call site (lazy mid-session) uses the helper.
    //
    // ── WP79 AMENDMENT, 2026-08-05: 2 -> 1. Read the reason before restoring it.
    //
    // The count was 2 because of the manifest-replay loop in `connectSync()`.
    // That loop was STRUCTURALLY DEAD and had never run once, for either role,
    // in any session: `connectSync()` is awaited BEFORE
    // `manifestManager.connect(...)` at all four session entry points, and
    // `getEntries()` returns an empty map while `this.manifest` is null (S22,
    // measured against this tree). WP79 removed it — it is not merely dead, it
    // is a landmine, because the helper it drove installs the R10 raw-text
    // fallback and running that over a whole shared folder is exactly the
    // second-CRDT-over-a-canvas-path failure WP6's own predicate exists to
    // prevent.
    //
    // So this number was never counting two live handovers; it was counting one
    // live handover and one dead one. WP6 AC8's actual claim — every canvas
    // subscribe WRITTEN IN `main.ts` routes through the helper — is unchanged
    // and is still asserted, by the line above and by this one together.
    expect(source.match(/subscribeCanvasWithHandover\(\{/g)).toHaveLength(1);
  });
});
