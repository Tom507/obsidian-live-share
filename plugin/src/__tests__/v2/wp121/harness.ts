// WP121 — shared fixtures for "winning is not a licence to discard".
//
// 🔴 THE ORACLE IS PARSED RECORDS, NEVER BYTES. `S174` / Investigation §2.2: a
// `.canvas` has THREE stable byte forms on this build for identical records —
// the author's `JSON.stringify`, the plugin's canonical tab-indented
// `serializeCanvas`, and Obsidian's own one-record-per-line form (measured live
// at 235 / 296 / 218 B for zero field differences). A byte or `sha256` oracle
// is red for boards that are perfectly in sync and green for boards that are
// not. Every helper below therefore answers in RECORD IDS.

import { vi } from "vitest";
import * as Y from "yjs";

import type { PersistenceIO } from "../../../files/canvas-persistence";

export interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

/** The disk, as bytes — read back only through the parsing helpers below. */
export function createIO(initial: Record<string, string> = {}): FakeIO {
  const files = new Map<string, string>(Object.entries(initial));
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

/**
 * The preservation seam, over the SAME file map — one disk, a second door.
 *
 * Deliberately separate from {@link FakeIO}: the canvas writer's `PersistenceIO`
 * is decorated in production (WP87's editing-aware hold) and its `write` is
 * wrapped in the echo mute. A one-shot additive copy to a different path must
 * not travel through either.
 */
export function preservationOver(
  io: FakeIO,
  opts: { sharedFolder?: string; when?: Date; failWrite?: boolean } = {},
) {
  const { files } = io;
  return {
    sharedFolder: opts.sharedFolder ?? "share",
    read: vi.fn(async (p: string) => (files.has(p) ? (files.get(p) as string) : null)),
    write: vi.fn(async (p: string, c: string) => {
      if (opts.failWrite) throw new Error("preservation write refused");
      files.set(p, c);
    }),
    now: () => opts.when ?? new Date(2026, 7, 8, 17, 42, 3),
  };
}

/** A `.canvas` in the AUTHOR's spelling — plain `JSON.stringify`, no indent. */
export function authorSpelling(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

/**
 * A `.canvas` in OBSIDIAN's own spelling — one record per line inside the two
 * arrays. This is the third of the three real byte forms `S174` measured; it is
 * NOT a whitespace tweak invented for the test.
 */
export function obsidianSpelling(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  const line = (r: Record<string, unknown>) => `\t\t${JSON.stringify(r)}`;
  return (
    "{\n\t\"nodes\":[\n" +
    nodes.map(line).join(",\n") +
    "\n\t],\n\t\"edges\":[\n" +
    edges.map(line).join(",\n") +
    "\n\t]\n}"
  );
}

export const NODE = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  text: `card ${id}`,
  ...extra,
});

export const EDGE = (id: string, from: string, to: string) => ({
  id,
  fromNode: from,
  fromSide: "right",
  toNode: to,
  toSide: "left",
});

/** Record ids in a serialized `.canvas` payload — the ONLY oracle in this folder. */
export function recordIdsIn(content: string | undefined): { nodes: string[]; edges: string[] } {
  if (content === undefined) return { nodes: [], edges: [] };
  const parsed = JSON.parse(content) as {
    nodes?: { id?: string }[];
    edges?: { id?: string }[];
  };
  return {
    nodes: (parsed.nodes ?? []).map((n) => String(n.id)).sort(),
    edges: (parsed.edges ?? []).map((e) => String(e.id)).sort(),
  };
}

/** Seed records straight into the doc's maps, as a synced peer's state would. */
export function seedDoc(
  doc: Y.Doc,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): void {
  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const node of nodes) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(node)) m.set(k, v);
      nodesMap.set(String(node.id), m);
    }
    for (const edge of edges) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(edge)) m.set(k, v);
      edgesMap.set(String(edge.id), m);
    }
  });
}

/** Tombstone a record id the way WP19's delete path does — a value, not an absence. */
export function tombstone(doc: Y.Doc, id: string): void {
  const deleted = doc.getMap<unknown>("deleted");
  doc.transact(() => {
    deleted.set(id, { t: 1, by: "test", on: true });
  });
}

export function createRecordingLogger(): {
  lines: string[];
  debug(category: string, message: string): void;
  warn(category: string, message: string): void;
} {
  const lines: string[] = [];
  return {
    lines,
    debug: (_c: string, m: string) => {
      lines.push(m);
    },
    warn: (_c: string, m: string) => {
      lines.push(m);
    },
  };
}

/** Paths under a conflicts root, so a copy can be located without knowing its stamp. */
export function conflictCopiesIn(io: FakeIO, root: string): string[] {
  return [...io.files.keys()].filter((p) => p.startsWith(`${root}/`));
}
