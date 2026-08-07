// WP90 / I11 — shared fixtures for "the withhold outlives the session".
//
// TWO DISKS, DELIBERATELY SEPARATE, because the whole work package is about the
// relationship between them:
//
//   ├── the USER's disk — WP63's `FakeIO`, whose `files` map IS the `.canvas`.
//   │   It stays the oracle here for exactly the reason WP63 made it one: a
//   │   probe that asserted on a log line would pass against an implementation
//   │   that logs and then writes.
//   └── the SIDECAR disk — `createStoreIO()` below, a `SidecarIO` double whose
//       `bytes` map is what the durable refused set actually lands in. Its
//       contents are asserted as BYTES, never through the store's own reader,
//       so "no user text is persisted" is a claim about the file and not about
//       an accessor that might be filtering.
//
// WP63's fixtures (`VALID_NODE`, `TYPELESS_NODE`, `canvasJson`, `createIO`, …)
// are IMPORTED, never copied and never modified — WP63 is DONE, its four test
// files must pass byte-unmodified (AC5), and duplicating its node shapes would
// let the two work packages drift about what "the record the gate refuses"
// means.

import { vi } from "vitest";
import * as Y from "yjs";

import type { SidecarIO } from "../../../files/canvas-sidecar";
import { seedRefusalStorePath } from "../../../files/canvas-sidecar";

export {
  TYPELESS_NODE,
  VALID_NODE,
  applyRemoteDelta,
  canvasJson,
  createIO,
  createRecordingLogger,
  createSyncManager,
  createVault,
  ioOverVault,
  nodeIdsIn,
} from "../wp63/harness";
export type { FakeIO } from "../wp63/harness";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FakeStoreIO extends SidecarIO {
  /** The sidecar disk, as bytes. Asserted directly — never through the store. */
  bytes: Map<string, Uint8Array>;
  /** Every path this IO was ever asked to write. AC5's reachability evidence. */
  written: string[];
  /** The store file as text, or `undefined` if it was never created. */
  text(): string | undefined;
}

/**
 * The sidecar disk.
 *
 * `read` REJECTS on a missing path, exactly as WP24's contract says the real one
 * does — a double that answered `""` would hide a store that forgot to call
 * `exists` first, and that is a difference the degradation rows depend on.
 */
export function createStoreIO(initial: Record<string, string> = {}): FakeStoreIO {
  const bytes = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(initial)) bytes.set(path, encoder.encode(content));
  const written: string[] = [];
  const dirs = new Set<string>();
  return {
    bytes,
    written,
    text: () => {
      const raw = bytes.get(seedRefusalStorePath());
      return raw === undefined ? undefined : decoder.decode(raw);
    },
    ensureDir: vi.fn(async (dirPath: string) => {
      dirs.add(dirPath);
    }),
    exists: vi.fn(async (filePath: string) => bytes.has(filePath)),
    read: vi.fn(async (filePath: string) => {
      const found = bytes.get(filePath);
      if (found === undefined) throw new Error(`ENOENT: ${filePath}`);
      return found;
    }),
    write: vi.fn(async (filePath: string, data: Uint8Array) => {
      written.push(filePath);
      bytes.set(filePath, data);
    }),
    append: vi.fn(async () => {
      throw new Error("the seed-refusal store never appends");
    }),
    truncate: vi.fn(async () => {
      throw new Error("the seed-refusal store never truncates");
    }),
    remove: vi.fn(async () => {
      throw new Error("the seed-refusal store never removes");
    }),
  };
}

/**
 * The relay's half of a restart: a NEW doc holding what the shared session
 * already holds.
 *
 * This is how session 2 arrives non-empty without any file being read, which is
 * the precondition for the `doc-wins` branch — the branch that deletes. Built
 * from a real `Y.encodeStateAsUpdate` of session 1's doc rather than by hand,
 * so the "the doc has never contained the refused record" property is a
 * consequence of the refusal rather than an arrangement of the fixture.
 */
export function docAsTheRelayWouldHandItBack(previous: Y.Doc): Y.Doc {
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(previous));
  return next;
}

/** A node the ingest gate ADMITS, carrying the id a previous seed refused. */
export function repairedNode(id: string, text: string): Record<string, unknown> {
  return { id, type: "text", x: 300, y: 0, width: 120, height: 60, text };
}
