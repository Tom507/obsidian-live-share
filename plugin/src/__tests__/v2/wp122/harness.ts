// WP122 (`S146`) — "a file with no writer cannot converge": the HOST's world.
//
// 🔴 THE ORACLE IS PARSED RECORDS, NEVER BYTES — `S174`, and it is not a style
// note. A `.canvas` has THREE stable byte forms on this build for identical
// records: the author's `JSON.stringify`, the plugin's canonical tab-indented
// `serializeCanvas`, and Obsidian's own one-record-per-line form (measured live
// at 235 / 296 / 218 B with ZERO field differences). A byte or `sha256` oracle
// gives red for boards that are perfectly in sync and green for boards that are
// not. Every helper here answers in record ids and field values.
//
// WHAT IS REAL IN THIS HARNESS, and it is the part that matters:
//
//   ├── `bindHostWriter` calls the REAL `attachCanvasPersistence`, so the cold
//   │   open, the `doc-wins` branch, WP90's durable-refusal hydration, WP121's
//   │   conflict copy and the flush are the PRODUCTION ones. Charter §5: a
//   │   double for the writer attach would hide the cold-open flush that the
//   │   whole design decision is about.
//   ├── the preservation door is WP121's real seam shape, over the same disk.
//   └── the writer is KEPT ALIVE in a registry, because `hasWriter` — B1's
//       oracle — is a statement about the writer's current existence, not about
//       what a pass once reported (`S138`).
//
// WHAT IS MODELLED, stated exactly (charter §5, "no partial test doubles"):
//
//   `subscribe(path, "host")` models `CanvasSync.subscribe`'s host arm as: apply
//   the peers' update to this client's replica, THEN merge the records the local
//   file names into the same maps. The MERGE SEMANTICS are the real ones and
//   they are the ones that matter here — `applyCanvasToYMaps`' own docstring
//   (`canvas-sync.ts:4494-4499`): *"the host's local file is no longer the host's
//   picture of the WHOLE board — it is a set of proposals about the records it
//   names, and a rejoin is an ordinary related-replica merge"*, i.e. no
//   delete-by-omission. The file is read through the REAL `parseCanvas` /
//   `decodeCanvasDataToFlat`, the one definer.
//
//   NOT exercised by this model, and no test here claims otherwise:
//     ├── `seedFlatSpace`'s per-record REFUSALS (WP63/WP94). A refused record is
//     │   a record the doc never receives; the refusal ledger and the withhold
//     │   it arms are WP63/WP90/WP121's subject and have their own suites. What
//     │   this harness asserts is what the bind does with a doc, whatever put
//     │   the records in it.
//     ├── `waitForSync`, the relay, and `S123`'s probe race (WP101's subject).
//     └── the undo registry, the echo baseline and the surface shadow.
//
//   The doc state at bind time is therefore ASSERTED EXPLICITLY in every test
//   before the bind, so the merge is scenery and the bind is the subject.

import { vi } from "vitest";
import * as Y from "yjs";

import { CanvasCreateCoordinator, type CanvasCreateEnv } from "../../../files/canvas-create";
import {
  type CanvasMirrorDeps,
  type CanvasMirrorDoc,
  mirrorSharedCanvases,
} from "../../../files/canvas-mirror";
import {
  type CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../files/canvas-persistence";
import { decodeCanvasDataToFlat, parseCanvas } from "../../../files/canvas-sync";
import { conflictsRootFor } from "../../../files/conflict-copy";
import { createManualScheduler } from "../wp29/harness";

export const SHARED = "share";
export const BOARD = `${SHARED}/plan.canvas`;
export const GUID = "0123456789abcdef0123456789abcdef";

/** A complete, legal JSON Canvas node. A shorthand one is refused at both seed
 * boundaries (C18 AC1) and would fail a test on its scenery. */
export function node(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type: "text", x: 0, y: 0, width: 120, height: 60, text: `card ${id}`, ...extra };
}

export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

/** The AUTHOR's spelling — plain `JSON.stringify`. One of `S174`'s three forms. */
export function authorSpelling(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

/** OBSIDIAN's own spelling — one record per line. `S174`'s third form, and the
 * reason `contains` cannot judge geometry either. */
export function obsidianSpelling(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  const line = (r: Record<string, unknown>) => `\t\t${JSON.stringify(r)}`;
  return (
    '{\n\t"nodes":[\n' +
    nodes.map(line).join(",\n") +
    '\n\t],\n\t"edges":[\n' +
    edges.map(line).join(",\n") +
    "\n\t]\n}"
  );
}

/** Record ids in a `.canvas` payload. THE oracle in this folder. */
export function recordIdsIn(content: string | undefined): { nodes: string[]; edges: string[] } {
  if (content === undefined) return { nodes: [], edges: [] };
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[]; edges?: { id?: string }[] };
  return {
    nodes: (parsed.nodes ?? []).map((n) => String(n.id)).sort(),
    edges: (parsed.edges ?? []).map((e) => String(e.id)).sort(),
  };
}

/** One node's field, read out of a `.canvas` payload. Geometry, scored on the
 * PARSE and never on a substring — `"x": 111` and `"x":111` are the same value
 * and different substrings. */
export function fieldOf(
  content: string | undefined,
  id: string,
  key: string,
): unknown {
  if (content === undefined) return undefined;
  const parsed = JSON.parse(content) as { nodes?: Record<string, unknown>[] };
  return (parsed.nodes ?? []).find((n) => n.id === id)?.[key];
}

/** Record ids a doc's maps hold, so "the document has it" and "the file has it"
 * are separately observable — the distinction the whole package is about. */
export function docIds(doc: Y.Doc): { nodes: string[]; edges: string[] } {
  return {
    nodes: [...doc.getMap("nodes").keys()].sort(),
    edges: [...doc.getMap("edges").keys()].sort(),
  };
}

/** Put records into a doc the way a synced peer's state arrives. */
export function seedDoc(
  doc: Y.Doc,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): void {
  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const n of nodes) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(n)) m.set(k, v);
      nodesMap.set(String(n.id), m);
    }
    for (const e of edges) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(e)) m.set(k, v);
      edgesMap.set(String(e.id), m);
    }
  });
}

export interface HostWorld {
  /** The host's disk. The ONLY oracle for "the user has the file". */
  files: Map<string, string>;
  /** What the peers hold — a separate `Y.Doc`, never the same object. */
  peerDoc: Y.Doc;
  /** This host's own replica, or `undefined` until it subscribes. */
  localDoc(): Y.Doc | undefined;
  /** THE B1 ORACLE: the writer registry, read directly. Never `canvas.mirror`. */
  hasWriter(path: string): boolean;
  writerFor(path: string): CanvasPersistence | undefined;
  /** Ordered trace of the two statements whose ORDER is the safety argument. */
  trace: string[];
  /** Paths under the conflicts root — WP121's copy, if it fired. */
  conflictCopies(): string[];
  /** Every write that reached the disk, in order. */
  writes: string[];
  deps: CanvasMirrorDeps;
  disk(path: string): string | undefined;
  /**
   * Fire the writer's own trailing debounce and drain the microtasks the flush
   * queues. NOT a substitute for the flush: it drives the REAL
   * observer → `scheduleWrite` → `flushToDisk` chain the production writer runs
   * on every remote delta, which is the chain a test that called `flush()`
   * directly would step over.
   */
  settleWriter(): Promise<void>;
  destroy(): void;
}

export interface HostWorldOptions {
  /** The host's file at {@link BOARD}, in whatever spelling. */
  file?: string;
  /** What the peers hold for the board. */
  peer?: { nodes: Record<string, unknown>[]; edges?: Record<string, unknown>[] };
  /** Omit the guid so the subscribe has to mint one (the create case). */
  guid?: string | null;
  /** Drop `bindHostWriter` entirely — the pre-WP122 deps object. */
  withoutBindSeam?: boolean;
  /** Wire WP121's preservation door. Defaults to ON, as production does. */
  preservation?: boolean;
  /** THE PLANT of charter §5: bind BEFORE the subscribe merges the host's file. */
  hoistBindAboveSubscribe?: boolean;
  /**
   * THE MID-SESSION CASE, and it is production-reachable rather than contrived:
   * `mirrorOne` skips the subscribe when `canvasSync.isSubscribed(path)` is
   * already true (`canvas-mirror.ts`, `if (!deps.canvasSync.isSubscribed(path))`).
   * On such a pass NO host seed runs, so the document is whatever the relay
   * holds and the file on disk may name records it has never heard of — which is
   * exactly the population WP121's conflict copy exists for.
   */
  preSubscribed?: boolean;
  /** Extra paths in the manifest, so "no other manifest activity" is checkable. */
  manifestPaths?: string[];
}

export function createHostWorld(options: HostWorldOptions = {}): HostWorld {
  const files = new Map<string, string>();
  if (options.file !== undefined) files.set(BOARD, options.file);
  const guids = new Map<string, string>();
  if (options.guid !== null) guids.set(BOARD, options.guid ?? GUID);

  const peerDoc = new Y.Doc();
  if (options.peer) seedDoc(peerDoc, options.peer.nodes, options.peer.edges ?? []);

  let local: Y.Doc | undefined;
  const subscribed = new Set<string>();
  const writers = new Map<string, CanvasPersistence>();
  const trace: string[] = [];
  const writes: string[] = [];
  const mintCalls: string[] = [];
  const scheduler = createManualScheduler();

  if (options.preSubscribed) {
    // The replica this client already holds: the peers' state and NOTHING from
    // the local file, because the seed that would have merged it ran in a
    // context this pass is not repeating.
    local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(peerDoc));
    subscribed.add(BOARD);
  }

  const io: PersistenceIO = {
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      writes.push(p);
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };

  // WP121's door, over the SAME disk and through a SEPARATE seam — production's
  // shape exactly (`main.ts`, `preserveDiscarded`): the copy travels `baseIo`,
  // not the WP87-decorated writer `io`.
  const preservationDoor = {
    sharedFolder: SHARED,
    read: async (p: string) => (files.has(p) ? (files.get(p) as string) : null),
    write: async (p: string, c: string) => {
      files.set(p, c);
    },
    now: () => new Date(2026, 7, 8, 17, 42, 3),
  };

  /**
   * `CanvasSync.subscribe`'s host arm, modelled. See the header for exactly
   * which paths this does and does not exercise.
   */
  async function subscribe(path: string, role: "host" | "guest"): Promise<void> {
    trace.push(`subscribe:${role}:${path}`);
    if (!guids.has(path)) {
      if (role !== "host") return; // C27: only a host may mint.
      const minted = `minted-${mintCalls.length + 1}`;
      mintCalls.push(minted);
      guids.set(path, minted);
    }
    const doc = local ?? new Y.Doc();
    local = doc;
    // 1. the peers' state arrives.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc));
    subscribed.add(path);
    if (role !== "host") return;
    // 2. the host's own file is MERGED in — proposals about the records it
    //    names, no delete-by-omission (`applyCanvasToYMaps`' docstring).
    const content = files.get(path);
    if (content === undefined) return;
    const data = decodeCanvasDataToFlat(parseCanvas(content));
    const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    doc.transact(() => {
      for (const [id, fields] of Object.entries(data.nodes)) {
        const existing = nodesMap.get(id);
        const target = existing ?? new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) target.set(k, v);
        if (!existing) nodesMap.set(id, target);
      }
      for (const [id, fields] of Object.entries(data.edges)) {
        const existing = edgesMap.get(id);
        const target = existing ?? new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) target.set(k, v);
        if (!existing) edgesMap.set(id, target);
      }
    });
    trace.push(`host-seed-merged:${path}`);
  }

  async function bindHostWriter(path: string): Promise<void> {
    trace.push(`bind:${path}`);
    if (writers.has(path)) return; // `hasCanvasWriter`'s guard, modelled.
    const doc = local;
    if (!doc) return;
    // THE REAL WRITER. Its cold open is the production one, and that is the
    // entire point of arm (a).
    const { persistence } = await attachCanvasPersistence(doc, io, path, {
      scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "host" },
      ...(options.preservation === false ? {} : { preserveDiscarded: preservationDoor }),
    });
    writers.set(path, persistence);
  }

  const deps: CanvasMirrorDeps = {
    role: "host",
    listManifestPaths: () => options.manifestPaths ?? [BOARD],
    localFileExists: vi.fn(async (p: string) => files.has(p)),
    guidForPath: (p: string) => guids.get(p) ?? null,
    canvasSync: {
      isSubscribed: (p: string) => subscribed.has(p),
      subscribe: vi.fn(async (p: string, role: "host" | "guest") => {
        // THE PLANT (charter §5): the bind hoisted ABOVE the merge. The doc is
        // then empty-or-peer-only and the flush writes a board missing
        // everything the host authored.
        if (options.hoistBindAboveSubscribe) {
          const doc = local ?? new Y.Doc();
          local = doc;
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc));
          subscribed.add(p);
          if (!guids.has(p)) {
            mintCalls.push("minted");
            guids.set(p, `minted-${mintCalls.length}`);
          }
          await bindHostWriter(p);
        }
        await subscribe(p, role);
      }),
      getCanvasDocHandle: (p: string) =>
        subscribed.has(p) && local ? { doc: local as unknown as CanvasMirrorDoc } : null,
    },
    materialise: async () => {
      throw new Error("the host arm must never reach `materialise` — that is the guest's seam");
    },
    logger: { log: () => {}, warn: () => {} },
  };
  if (!options.withoutBindSeam) deps.bindHostWriter = bindHostWriter;

  return {
    files,
    peerDoc,
    localDoc: () => local,
    hasWriter: (p: string) => writers.has(p),
    writerFor: (p: string) => writers.get(p),
    trace,
    // Located through the ONE definer of the conflicts root, never a re-spelt
    // literal: a test that invents the folder name would go green on a copy
    // production never wrote.
    conflictCopies: () =>
      [...files.keys()].filter((p) => p.startsWith(`${conflictsRootFor(SHARED)}/`)),
    writes,
    deps,
    disk: (p: string) => files.get(p),
    settleWriter: async () => {
      scheduler.runAll();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    destroy: () => {
      for (const w of writers.values()) w.destroy();
      writers.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// WP122 B5 (`S170`) — THE ADOPTION WORLD, for the guest that ORIGINATED a board.
//
// The subjects are all production objects: the real `CanvasCreateCoordinator`,
// the real `mirrorSharedCanvases`, the real `attachCanvasPersistence`. Every env
// member below is a MEASUREMENT or an ACTION taken from the object that owns it
// in production, which is exactly what `CanvasCreateEnv` is for.
//
// THE ONE THING THIS WORLD IS BUILT TO MAKE FALSIFIABLE: `manifestWrites` counts
// every mutation of the manifest, of any kind. B5's criterion is that the
// adoption happens with NO other manifest activity at all — because a test that
// permits any other manifest write cannot distinguish the fix from the accident
// that made WP118's third round converge in 0.22 s while rounds 1 and 2 waited
// for an unrelated write somewhere else in the share.
// ---------------------------------------------------------------------------

export interface AdoptionWorld {
  coordinator: CanvasCreateCoordinator;
  /** Every mutation of the manifest, whatever its cause. B5's real oracle. */
  manifestWrites: string[];
  /** Mirror passes that actually ran. */
  passes: number;
  hasWriter(path: string): boolean;
  disk(path: string): string | undefined;
  notices: string[];
  /** The guest asks the host to create the board it just authored. */
  request(): Promise<string>;
  /** The host's answer comes back over the control channel. */
  answer(accepted: boolean): boolean;
  settle(): Promise<void>;
  destroy(): void;
}

export interface AdoptionWorldOptions {
  /** Drop `armMirrorPass` — the pre-WP122 env, and B5's discriminator. */
  withoutArmSeam?: boolean;
}

export function createAdoptionWorld(options: AdoptionWorldOptions = {}): AdoptionWorld {
  // The guest's own disk: it authored this board a moment ago.
  const files = new Map<string, string>([[BOARD, authorSpelling([node("a1")])]]);
  const guids = new Map<string, string>();
  const manifestPaths = new Set<string>();
  const manifestWrites: string[] = [];
  const notices: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const writers = new Map<string, CanvasPersistence>();
  const scheduler = createManualScheduler();
  let passes = 0;
  let queue: Promise<void> = Promise.resolve();

  // What the host holds once it has accepted and seeded: the guest's records,
  // in the host's canonical spelling, plus a card the host added.
  const peerDoc = new Y.Doc();
  seedDoc(peerDoc, [node("a1"), node("h1")]);
  let local: Y.Doc | undefined;

  const io: PersistenceIO = {
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };

  async function attachWriter(path: string): Promise<void> {
    if (writers.has(path)) return;
    const doc = local;
    if (!doc) return;
    const { persistence } = await attachCanvasPersistence(doc, io, path, {
      scheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true, role: "guest" },
    });
    writers.set(path, persistence);
  }

  const deps: CanvasMirrorDeps = {
    role: "guest",
    listManifestPaths: () => [...manifestPaths],
    localFileExists: async (p: string) => files.has(p),
    guidForPath: (p: string) => guids.get(p) ?? null,
    canvasSync: {
      isSubscribed: (p: string) => local !== undefined && manifestPaths.has(p),
      subscribe: async () => {
        const doc = local ?? new Y.Doc();
        local = doc;
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc));
      },
      getCanvasDocHandle: () => (local ? { doc: local as unknown as CanvasMirrorDoc } : null),
    },
    materialise: attachWriter,
    originatedHere: (p: string) => coordinator.originatedHere(p),
    noteAdopted: (p: string) => coordinator.noteAdopted(p),
    logger: { log: () => {}, warn: () => {} },
  };

  async function runPass(): Promise<void> {
    passes += 1;
    await mirrorSharedCanvases(deps);
  }

  const env: CanvasCreateEnv = {
    role: () => "guest",
    send: (message) => {
      sent.push(message as Record<string, unknown>);
      return true;
    },
    isSharedPath: (p) => p.startsWith(`${SHARED}/`),
    manifestKnows: (p) => manifestPaths.has(p),
    isPathSafe: () => true,
    isProtectedPath: () => false,
    fileExists: async (p) => files.has(p),
    readFile: async (p) => files.get(p) ?? null,
    isCanvasDocument: () => true,
    createFile: async () => {
      throw new Error("the guest never creates — that is the host's arm");
    },
    publishManifestEntry: async () => {
      throw new Error("the guest never publishes — that is the host's arm");
    },
    canvasSync: () => ({ subscribe: async () => {} }),
    attachWriter,
    identityFor: (p) => guids.get(p) ?? null,
    notify: (message) => {
      notices.push(message);
    },
    newRequestId: () => `req-${sent.length + 1}`,
    scheduler: {
      setTimeout: (cb, ms) => scheduler.setTimeout(cb, ms),
      clearTimeout: (h) => scheduler.clearTimeout(h),
    },
    logger: { log: () => {}, warn: () => {} },
  };
  if (!options.withoutArmSeam) {
    env.armMirrorPass = () => {
      queue = queue.then(runPass);
    };
  }
  const coordinator = new CanvasCreateCoordinator(env);

  return {
    coordinator,
    manifestWrites,
    get passes() {
      return passes;
    },
    hasWriter: (p: string) => writers.has(p),
    disk: (p: string) => files.get(p),
    notices,
    async request() {
      const outcome = await coordinator.requestCreate(BOARD);
      // The host accepted, minted the guid and published the entry — one
      // manifest write, and it is the ONLY one this world ever performs. It
      // lands BEFORE the result frame, exactly as `handleRequest` orders it.
      if (outcome === "sent") {
        guids.set(BOARD, GUID);
        manifestPaths.add(BOARD);
        manifestWrites.push(`publish:${BOARD}`);
      }
      return outcome;
    },
    answer(accepted: boolean) {
      const requestId = String((sent.at(-1) as { requestId?: string })?.requestId ?? "");
      return coordinator.handleResult({
        requestId,
        path: BOARD,
        accepted,
        reason: accepted ? "materialise" : "already-exists",
        detail: accepted ? "" : "the host already holds that path",
      });
    },
    async settle() {
      await queue;
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await queue;
    },
    destroy() {
      for (const w of writers.values()) w.destroy();
      writers.clear();
    },
  };
}
