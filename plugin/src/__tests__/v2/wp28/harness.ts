// WP28 — shared fixtures for the epoch rule + conflict archive probes.
//
// THE ONE DESIGN CHOICE THAT MATTERS HERE: the probe does not merely record
// THAT `writeConflictCopy` was called. It records, at the instant of the call,
// what the LOSER'S DOC STILL HELD — its node ids, its edge ids and its
// `meta.epoch`.
//
// AC2 is an ORDERING claim ("writes its state ... BEFORE adopting the winner"),
// and an oracle that only checks the archive exists at the end cannot see the
// failure the archive exists to prevent: an implementation that adopts first and
// archives afterwards writes a conflict copy that is a COPY OF THE WINNER. On
// disk that looks perfectly healthy — right name, right shape, right date — and
// the loser's work, the only thing the file was ever for, is gone. The state of
// the doc at write time is the discriminator, so the probe captures it.
//
// The serializer here is the HARNESS's own (`JSON.stringify` over plain
// objects), never production's. An archive oracle that borrowed the projection
// under test could agree with a broken projection.

import { vi } from "vitest";
import * as Y from "yjs";

import { EPOCH_KEY, GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";

export const CANVAS_PATH = "boards/plan.canvas";
export const FIXED_GUID = "0f2a9c6e1b4d47aa9d316c0e2f8b5a70";

/** Fixture-supplied. The module never reads a clock — `today()` is injected. */
export const TODAY = "2026-08-02";

/** The record containers WP28 replaces wholesale when the remote epoch wins. */
export const RECORD_SPACES = ["nodes", "edges"] as const;
export type RecordSpace = (typeof RECORD_SPACES)[number];

export interface DocSpec {
  /** Omit for a doc that has never been stamped — `meta.epoch` is then absent. */
  epoch?: unknown;
  guid?: string;
  path?: string;
  nodes?: Record<string, Record<string, unknown>>;
  edges?: Record<string, Record<string, unknown>>;
  deleted?: Record<string, unknown>;
}

/** A doc built the way the relay would hand one over: plain records, real `Y.Map`s. */
export function makeDoc(spec: DocSpec = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    if ("epoch" in spec) meta.set(EPOCH_KEY, spec.epoch);
    meta.set(GUID_KEY, spec.guid ?? FIXED_GUID);
    meta.set(PATH_KEY, spec.path ?? CANVAS_PATH);
    for (const space of RECORD_SPACES) {
      const container = doc.getMap<Y.Map<unknown>>(space);
      for (const [id, record] of Object.entries(spec[space] ?? {})) {
        const ymap = new Y.Map<unknown>();
        container.set(id, ymap);
        for (const [key, value] of Object.entries(record)) ymap.set(key, value);
      }
    }
    const deleted = doc.getMap<unknown>("deleted");
    for (const [id, entry] of Object.entries(spec.deleted ?? {})) deleted.set(id, entry);
  });
  return doc;
}

export function node(id: string, text: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 120, height: 60, text };
}

export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, toNode: to };
}

/** The ids one record space actually holds, sorted. Absence is absence, not suppression. */
export function recordIds(doc: Y.Doc, space: RecordSpace): string[] {
  return [...doc.getMap<Y.Map<unknown>>(space).keys()].sort();
}

export function fieldOf(doc: Y.Doc, space: RecordSpace, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(space).get(id)?.get(key);
}

/** `meta.epoch` exactly as it sits in the doc — NOT normalised. */
export function rawEpoch(doc: Y.Doc): unknown {
  return doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY);
}

export function metaSnapshot(doc: Y.Doc): Record<string, unknown> {
  return Object.fromEntries(doc.getMap<unknown>(META_MAP_NAME).entries());
}

/** The harness's OWN projection. Never production's — see the file header. */
export function plainRecords(
  doc: Y.Doc,
  space: RecordSpace,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, ymap] of doc.getMap<Y.Map<unknown>>(space)) {
    out[id] = Object.fromEntries(ymap.entries());
  }
  return out;
}

export function harnessSerialize(doc: Y.Doc): string {
  return JSON.stringify({ nodes: plainRecords(doc, "nodes"), edges: plainRecords(doc, "edges") });
}

// --- the probe ---------------------------------------------------------------

export interface RecordedWrite {
  readonly path: string;
  readonly content: string;
  /** Monotonic call order across EVERY channel the probe watches. */
  readonly at: number;
  /** What the loser's doc still held at the instant of the write. */
  readonly docNodeIds: readonly string[];
  readonly docEdgeIds: readonly string[];
  readonly docEpoch: unknown;
}

export interface RecordedEvent {
  readonly at: number;
  readonly message: string;
}

export interface RecordedTransaction {
  readonly at: number;
  readonly origin: unknown;
  readonly touchedTypes: readonly string[];
}

export interface Probe {
  env: {
    serializeDoc(doc: Y.Doc): string;
    writeConflictCopy(path: string, content: string): Promise<void>;
    notify(message: string): void;
    today(): string;
    logger: {
      debug(category: string, message: string): void;
      warn(category: string, message: string): void;
    };
  };
  readonly writes: RecordedWrite[];
  readonly notices: RecordedEvent[];
  readonly logs: (RecordedEvent & { category: string })[];
  readonly serializations: { at: number; nodeIds: readonly string[] }[];
  readonly transactions: RecordedTransaction[];
  /** Watch a doc so every transaction on it is ordered against the IO channels. */
  watch(doc: Y.Doc): void;
  /** The order stamp of the FIRST mutation of any watched doc, or `null`. */
  firstMutationAt(): number | null;
  now(): number;
}

export function createProbe(opts: { today?: string; failWriteWith?: Error } = {}): Probe {
  let seq = 0;
  const next = () => ++seq;
  const writes: RecordedWrite[] = [];
  const notices: RecordedEvent[] = [];
  const logs: (RecordedEvent & { category: string })[] = [];
  const serializations: { at: number; nodeIds: readonly string[] }[] = [];
  const transactions: RecordedTransaction[] = [];
  /** The doc the archive is ABOUT. Set by the first `watch`. */
  let subject: Y.Doc | null = null;

  const probe: Probe = {
    env: {
      serializeDoc: vi.fn((doc: Y.Doc) => {
        serializations.push({ at: next(), nodeIds: recordIds(doc, "nodes") });
        return harnessSerialize(doc);
      }),
      writeConflictCopy: vi.fn(async (path: string, content: string) => {
        writes.push({
          path,
          content,
          at: next(),
          docNodeIds: subject ? recordIds(subject, "nodes") : [],
          docEdgeIds: subject ? recordIds(subject, "edges") : [],
          docEpoch: subject ? rawEpoch(subject) : undefined,
        });
        if (opts.failWriteWith) throw opts.failWriteWith;
      }),
      notify: vi.fn((message: string) => {
        notices.push({ at: next(), message });
      }),
      today: vi.fn(() => opts.today ?? TODAY),
      logger: {
        debug: vi.fn((category: string, message: string) => {
          logs.push({ at: next(), category, message });
        }),
        warn: vi.fn((category: string, message: string) => {
          logs.push({ at: next(), category, message });
        }),
      },
    },
    writes,
    notices,
    logs,
    serializations,
    transactions,
    watch(doc: Y.Doc) {
      subject ??= doc;
      doc.on("afterTransaction", (tr: Y.Transaction) => {
        transactions.push({
          at: next(),
          origin: tr.origin,
          touchedTypes: [...tr.changed.keys()].map((type) => {
            const found = [...RECORD_SPACES, "meta", "deleted"].find(
              (name) => doc.share.get(name) === type,
            );
            return found ?? "?";
          }),
        });
      });
    },
    firstMutationAt() {
      return transactions.length > 0 ? transactions[0].at : null;
    },
    now: () => seq,
  };
  return probe;
}

/**
 * Apply a delta the way a PEER would, so the receiving doc sees a NON-local
 * transaction. Used only where a genuine merge is the subject.
 */
export function mergeDocs(into: Y.Doc, from: Y.Doc): void {
  Y.applyUpdate(into, Y.encodeStateAsUpdate(from));
}
