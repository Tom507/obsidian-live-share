// WP30 — shared fixtures for the explicit "Import from file" command.
//
// FOUR DESIGN CHOICES CARRY THIS FILE, and each one exists because one of
// WP30's acceptance criteria is written in a way an ordinary end-state oracle
// cannot discriminate.
//
//   1. THE WRITE CHANNEL IS REAL, NOT A `vi.fn()` STANDING IN FOR ONE.
//      AC3 says "cancelling performs no write of any kind". A spy named
//      `adoptEpochWinner` that does nothing proves only that a function was not
//      called; it cannot tell "the import declined to write" from "the import
//      wrote somewhere else". So {@link createImportHarness} builds
//      `env.adoptEpochWinner` out of WP28's REAL `resolveEpochConflict` over a
//      fake disk (`writeConflictCopy`) and a REAL live `Y.Doc` with an update
//      observer attached. "No write" is then observed at TWO independent I/O
//      boundaries — zero bytes offered to the disk, zero transactions on the
//      live doc — and neither is inferrable from the other.
//
//   2. THE POSITIVE CONTROL IS PART OF THE HARNESS, NOT AN AFTERTHOUGHT.
//      Every "nothing happened" assertion in this suite is paired with the SAME
//      harness answering `true`, which must produce a byte on the fake disk and
//      a transaction on the live doc. A harness that can only ever observe
//      nothing is not an oracle.
//
//   3. THE PROBE CAPTURES THE LIVE DOC'S STATE AT THE INSTANT OF EACH CALL.
//      AC2 is an ordering claim ("increments `meta.epoch`, seeds the doc from
//      the file, and causes peers to adopt"). An oracle that reads the end state
//      cannot see an implementation that published the records first and the
//      epoch afterwards — the end state is identical, and the peers merged the
//      records as ordinary edits instead of routing them through the epoch rule.
//      So `adoptCalls` records what the WINNER already carried and what the LIVE
//      doc still held at the moment the publish was offered.
//
//   4. NO CONCURRENT SAME-KEY WRITES, ANYWHERE. Yjs tie-breaks concurrent
//      writes to one key on `clientID` (`random.uint32()`), so a test that
//      asserts a specific winner where both sides wrote concurrently passes
//      about half the time. Every value asserted in this suite has a single
//      author or a causal predecessor chain: `meta.epoch` is written by exactly
//      one replica, and where two replicas both hold records they hold
//      DIFFERENT ids.

import { vi } from "vitest";
import * as Y from "yjs";

import {
  type EpochConflictOutcome,
  readEpoch,
  resolveEpochConflict,
} from "../../../canvas/canvas-epoch";
import type {
  ImportAffectedPeer,
  ImportAvailability,
  ImportOverwriteSummary,
} from "../../../canvas/canvas-import-command";
import { EPOCH_KEY, GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
import type { ImportFromFileEnv, ImportFromFileResult } from "../../../files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../files/canvas-sync";

export const CANVAS_PATH = "boards/plan.canvas";
export const FIXED_GUID = "7b1e4d6a20c94f0f9a3e8c15d724be63";
/** Fixture-supplied. Nothing in this suite reads a clock. */
export const TODAY = "2026-08-02";
export const CONFLICT_COPY = "boards/plan.conflict-2026-08-02.canvas";

/** The one shape AC4 calls available: owned, and not degraded. */
export const AVAILABLE: ImportAvailability = { owned: true, degraded: false };

// --- record fixtures ---------------------------------------------------------
// Complete, LEGAL JSON Canvas records. A shorthand node (`{id, x, y}`) is
// refused by C18 AC1 at every seed boundary, and a test built on one fails on
// its scenery instead of on its subject (BUILD_SPEC §7, fixture completion).

export function textNode(id: string, x: number, text: string): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text };
}

export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

// --- the projection oracle ---------------------------------------------------
// Never raw key presence. Post-WP19 a removal instruction is a TOMBSTONE rather
// than a missing key, and `buildCanvasData` is what a peer, the `.canvas` file
// and the open view actually see. It also applies the node -> edge cascade, so
// an expected-id list hand-written from the raw containers would be wrong by the
// edge count.

export interface Projection {
  nodes: string[];
  edges: string[];
}

export function projection(doc: Y.Doc): Projection {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return {
    nodes: data.nodes.map((n) => String(n.id)).sort(),
    edges: data.edges.map((e) => String(e.id)).sort(),
  };
}

/** Build a live replica the way the relay would hand one over. */
export function makeLiveDoc(spec: {
  epoch?: unknown;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
  guid?: string;
  path?: string;
}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, spec.guid ?? FIXED_GUID);
    meta.set(PATH_KEY, spec.path ?? CANVAS_PATH);
    if (spec.epoch !== undefined) meta.set(EPOCH_KEY, spec.epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const record of spec.nodes ?? []) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(record)) map.set(key, value);
      nodes.set(String(record.id), map);
    }
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    for (const record of spec.edges ?? []) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(record)) map.set(key, value);
      edges.set(String(record.id), map);
    }
  });
  return doc;
}

// --- the harness -------------------------------------------------------------

/** One offer of bytes to the fake disk, with the live doc's state AT THAT INSTANT. */
export interface DiskWrite {
  path: string;
  content: string;
  /** What the live doc still held when the archive was offered — the AC2 ordering oracle. */
  liveProjectionAtWriteTime: Projection;
  liveEpochAtWriteTime: number;
}

/** One offer of a winner to the publish seam, with both sides' state AT THAT INSTANT. */
export interface AdoptCall {
  canvasPath: string;
  winnerProjection: Projection;
  winnerEpoch: number;
  liveProjectionAtCallTime: Projection;
  liveEpochAtCallTime: number;
}

export interface ImportHarness {
  env: ImportFromFileEnv;
  liveDoc: Y.Doc | null;
  /** Every byte offered to the vault. Empty means NO WRITE happened. */
  diskWrites: DiskWrite[];
  /** Every transaction committed on the live doc, by origin. */
  liveUpdateOrigins: unknown[];
  /** Every `env.confirm` invocation. */
  confirmCalls: { summary: ImportOverwriteSummary; message: string }[];
  /** Every publish offered to WP28's complete-adoption seam. */
  adoptCalls: AdoptCall[];
  /** Paths handed to `readCanvasFile`. A read is not a write. */
  reads: string[];
  notices: string[];
  /** Append-only order of seams entered — the ordering oracle. */
  trace: string[];
}

export interface HarnessOptions {
  availability?: ImportAvailability | null;
  liveEpoch?: unknown;
  liveNodes?: Record<string, unknown>[];
  liveEdges?: Record<string, unknown>[];
  /** `true` builds no live doc at all — this client does not hold the board. */
  noLiveDoc?: boolean;
  /** `null` models a missing / unreadable file. */
  fileText?: string | null;
  peers?: ImportAffectedPeer[];
  /** `true` = confirm, `false` = cancel, or drive the answer yourself. */
  answer?: boolean | ((summary: ImportOverwriteSummary, message: string) => Promise<boolean>);
  /** Replace the fake disk to model a refusal (WP28's never-clobber rule). */
  writeConflictCopy?: (path: string, content: string) => Promise<void>;
  today?: string;
}

export function createImportHarness(options: HarnessOptions = {}): ImportHarness {
  const liveDoc = options.noLiveDoc
    ? null
    : makeLiveDoc({
        epoch: options.liveEpoch,
        nodes: options.liveNodes ?? [textNode("live-1", 0, "live one")],
        edges: options.liveEdges ?? [],
      });

  const diskWrites: DiskWrite[] = [];
  const liveUpdateOrigins: unknown[] = [];
  const confirmCalls: { summary: ImportOverwriteSummary; message: string }[] = [];
  const adoptCalls: AdoptCall[] = [];
  const reads: string[] = [];
  const notices: string[] = [];
  const trace: string[] = [];

  if (liveDoc) {
    liveDoc.on("update", (_update: Uint8Array, origin: unknown) => {
      liveUpdateOrigins.push(origin);
      trace.push("live-doc:transaction");
    });
  }

  const snapshot = (): { projection: Projection; epoch: number } =>
    liveDoc
      ? { projection: projection(liveDoc), epoch: readEpoch(liveDoc) }
      : { projection: { nodes: [], edges: [] }, epoch: 0 };

  const writeConflictCopy =
    options.writeConflictCopy ??
    (async (path: string, content: string) => {
      const at = snapshot();
      diskWrites.push({
        path,
        content,
        liveProjectionAtWriteTime: at.projection,
        liveEpochAtWriteTime: at.epoch,
      });
      trace.push("disk:write-conflict-copy");
    });

  const env: ImportFromFileEnv = {
    availability: vi.fn((_path: string) => {
      trace.push("env:availability");
      return (
        options.availability === undefined ? AVAILABLE : options.availability
      ) as ImportAvailability;
    }),
    liveDoc: vi.fn((_path: string) => {
      trace.push("env:live-doc");
      return liveDoc;
    }),
    peers: vi.fn((_path: string) => {
      trace.push("env:peers");
      return options.peers ?? [];
    }),
    readCanvasFile: vi.fn(async (path: string) => {
      reads.push(path);
      trace.push("env:read-canvas-file");
      return options.fileText === undefined
        ? canvasJson([textNode("file-1", 10, "from the file")])
        : options.fileText;
    }),
    confirm: vi.fn(async (summary: ImportOverwriteSummary, message: string) => {
      confirmCalls.push({ summary, message });
      trace.push("env:confirm");
      const answer = options.answer;
      if (typeof answer === "function") return answer(summary, message);
      if (answer === undefined) return true;
      return answer;
    }),
    adoptEpochWinner: vi.fn(
      async (canvasPath: string, winner: Y.Doc): Promise<EpochConflictOutcome | null> => {
        const at = snapshot();
        adoptCalls.push({
          canvasPath,
          winnerProjection: projection(winner),
          winnerEpoch: readEpoch(winner),
          liveProjectionAtCallTime: at.projection,
          liveEpochAtCallTime: at.epoch,
        });
        trace.push("env:adopt-epoch-winner");
        if (!liveDoc) return null;
        // WP28's REAL rule, over a fake disk. This is deliberately not a stub:
        // the archive-before-adopt ordering and the wholesale replacement are
        // production behaviour that WP30 must not be able to bypass.
        return resolveEpochConflict({
          doc: liveDoc,
          winner,
          canvasPath,
          env: {
            serializeDoc: (doc: Y.Doc) => JSON.stringify(projection(doc)),
            writeConflictCopy,
            notify: (message: string) => {
              notices.push(message);
              trace.push("disk:notify");
            },
            today: () => options.today ?? TODAY,
          },
        });
      },
    ),
    notify: vi.fn((message: string) => {
      notices.push(message);
      trace.push("env:notify");
    }),
  };

  return {
    env,
    liveDoc,
    diskWrites,
    liveUpdateOrigins,
    confirmCalls,
    adoptCalls,
    reads,
    notices,
    trace,
  };
}

/** Every observable write channel this suite knows about, as one number. */
export function totalWrites(harness: ImportHarness): number {
  return harness.diskWrites.length + harness.liveUpdateOrigins.length;
}

/** Index of the first trace entry equal to `seam`, or -1. */
export function firstAt(trace: string[], seam: string): number {
  return trace.indexOf(seam);
}

export type { ImportFromFileResult };
