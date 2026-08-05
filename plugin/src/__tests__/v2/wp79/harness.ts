// WP79 — the mirror-pass world, in memory.
//
// The point of this harness is that NOTHING in it re-implements the thing under
// test. `materialise` is the REAL `attachCanvasPersistence`, so a file that
// appears is produced by `CanvasPersistence` through `serializeCanvas` — the one
// definer — and not by a helper written for the test. A byte comparison against
// a second serialiser would reproduce, inside the oracle, exactly the failure
// C28's archive argument names.
//
// The relay is modelled as a map of `guid -> Y.Doc` that BOTH sides address.
// "The guest resolves the identity and finds the host's doc" is therefore a real
// state transfer between two `Y.Doc`s, not a shared object reference.

import { vi } from "vitest";
import * as Y from "yjs";

import type { CanvasMirrorDeps, CanvasMirrorDoc } from "../../../files/canvas-mirror";
import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import { createManualScheduler, createPersistenceIO } from "../wp29/harness";

export { canvasJson, edge, textNode } from "../wp29/harness";

export const SHARED = "_liveshare-test";

export function canvasPath(name: string): string {
  return `${SHARED}/${name}.canvas`;
}

/** Put a legal JSON Canvas record set into a doc, the way `CanvasSync` does. */
export function seedDoc(
  doc: Y.Doc,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): void {
  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const node of nodes) {
      const record = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(node)) record.set(k, v);
      nodesMap.set(String(node.id), record);
    }
    for (const e of edges) {
      const record = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(e)) record.set(k, v);
      edgesMap.set(String(e.id), record);
    }
  });
}

export interface MirrorWorld {
  /** The vault's disk. The only oracle for "the user has the file". */
  files: Map<string, string>;
  /** path -> published guid, i.e. the manifest's identity column. */
  guids: Map<string, string>;
  /** The paths the manifest lists. */
  manifestPaths: string[];
  /** guid -> the doc the peers share. */
  peerDocs: Map<string, Y.Doc>;
  /** path -> THIS client's local replica. Never the same object as the peer's. */
  localDocs: Map<string, Y.Doc>;
  subscribed: Set<string>;
  /** Every `subscribe(path, role)` this pass issued, in order. */
  subscribeCalls: string[];
  /** Every guid this client minted. MUST stay empty for a guest (C27). */
  mintCalls: string[];
  /** Paths whose subscribe should reject, to exercise the degrade-alone rule. */
  failingSubscribes: Set<string>;
  /** Cold-open outcomes recorded per path, so "never re-seeded" is checkable. */
  coldOpens: Array<{ path: string; outcome: string }>;
  /** Writes that reached the disk, by path, in order. */
  writes: string[];
  deps: CanvasMirrorDeps;
  /** Byte-for-byte disk read. */
  disk(path: string): string | undefined;
}

export interface MirrorWorldOptions {
  role: "host" | "guest";
  /** Files already on this client's disk. */
  files?: Record<string, string>;
  /** Paths in the manifest. Defaults to the union of files and peer docs. */
  manifestPaths?: string[];
  /** path -> guid the manifest publishes. A path missing here does not resolve. */
  guids?: Record<string, string>;
  /** path -> what the peers hold for it. */
  peerContent?: Record<string, { nodes: Record<string, unknown>[]; edges?: Record<string, unknown>[] }>;
  /** Paths already subscribed when the pass starts (the mid-session case). */
  preSubscribed?: string[];
  /** Paths whose subscribe rejects. */
  failingSubscribes?: string[];
  /** Replace `materialise` entirely — the seam AC5 injection (i) disables. */
  materialiseOverride?: (path: string) => Promise<void>;
}

export function createMirrorWorld(options: MirrorWorldOptions): MirrorWorld {
  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const guids = new Map<string, string>(Object.entries(options.guids ?? {}));
  const peerDocs = new Map<string, Y.Doc>();
  const localDocs = new Map<string, Y.Doc>();
  const subscribed = new Set<string>(options.preSubscribed ?? []);
  const subscribeCalls: string[] = [];
  const mintCalls: string[] = [];
  const failingSubscribes = new Set<string>(options.failingSubscribes ?? []);
  const coldOpens: Array<{ path: string; outcome: string }> = [];
  const writes: string[] = [];

  // The peers' side: one doc per guid, holding what the host published.
  for (const [path, content] of Object.entries(options.peerContent ?? {})) {
    const guid = guids.get(path);
    if (guid === undefined) continue;
    const doc = new Y.Doc();
    seedDoc(doc, content.nodes, content.edges ?? []);
    peerDocs.set(guid, doc);
  }

  const manifestPaths =
    options.manifestPaths ??
    [...new Set([...files.keys(), ...Object.keys(options.peerContent ?? {})])];

  // Pre-subscribed paths already have a local replica that has met the peer's.
  for (const path of subscribed) {
    const guid = guids.get(path);
    const local = new Y.Doc();
    const peer = guid !== undefined ? peerDocs.get(guid) : undefined;
    if (peer) Y.applyUpdate(local, Y.encodeStateAsUpdate(peer));
    localDocs.set(path, local);
  }

  const io = createPersistenceIO(files);
  const originalWrite = io.write.bind(io);
  io.write = async (path: string, content: string) => {
    writes.push(path);
    await originalWrite(path, content);
  };

  async function defaultMaterialise(path: string): Promise<void> {
    const doc = localDocs.get(path);
    if (!doc) return;
    // THE ONE EXISTING WRITER, unmodified. Its cold open takes the doc-wins
    // branch and flushes `serializeCanvas(...)` to disk — the same call
    // `CanvasPersistence` makes at `canvas-persistence.ts:324`.
    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, path, {
      scheduler: createManualScheduler(),
      // The guest's board is one a peer already holds, so seeding from a file is
      // refused — which is the point: a materialisation is never a seed.
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
    });
    coldOpens.push({ path, outcome: coldOpen });
    persistence.destroy();
  }

  const deps: CanvasMirrorDeps = {
    role: options.role,
    listManifestPaths: () => manifestPaths,
    localFileExists: vi.fn(async (path: string) => files.has(path)),
    guidForPath: (path: string) => guids.get(path) ?? null,
    canvasSync: {
      isSubscribed: (path: string) => subscribed.has(path),
      subscribe: vi.fn(async (path: string, role: "host" | "guest") => {
        subscribeCalls.push(`${role}:${path}`);
        if (failingSubscribes.has(path)) throw new Error(`subscribe refused: ${path}`);
        let guid = guids.get(path) ?? null;
        if (guid === null) {
          // C27: only a HOST may mint. A guest that cannot resolve opens nothing.
          if (role !== "host") return;
          guid = `minted-${mintCalls.length + 1}`;
          mintCalls.push(guid);
          guids.set(path, guid);
        }
        subscribed.add(path);
        const local = new Y.Doc();
        const peer = peerDocs.get(guid);
        if (peer) Y.applyUpdate(local, Y.encodeStateAsUpdate(peer));
        localDocs.set(path, local);
      }),
      getCanvasDocHandle: (path: string) => {
        const doc = localDocs.get(path);
        return doc ? { doc: doc as CanvasMirrorDoc } : null;
      },
    },
    materialise: options.materialiseOverride ?? defaultMaterialise,
  };

  return {
    files,
    guids,
    manifestPaths,
    peerDocs,
    localDocs,
    subscribed,
    subscribeCalls,
    mintCalls,
    failingSubscribes,
    coldOpens,
    writes,
    deps,
    disk: (path: string) => files.get(path),
  };
}

/**
 * What the HOST's own writer would produce from the same doc state — obtained
 * by running the SAME `CanvasPersistence`, never by re-serialising in the test.
 */
export async function hostProjectionOf(doc: Y.Doc, path: string): Promise<string> {
  const files = new Map<string, string>();
  const io = createPersistenceIO(files);
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(doc));
  const { persistence } = await attachCanvasPersistence(mirror, io, path, {
    scheduler: createManualScheduler(),
    seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: true },
  });
  persistence.destroy();
  const out = files.get(path);
  if (out === undefined) throw new Error("the host's own writer produced no file");
  return out;
}
