// WP63 / I11 — shared fixtures for the non-destructive seed boundary probes.
//
// Deliberately tiny: an in-memory `PersistenceIO` whose `files` map IS the disk,
// so every probe in this folder can use FILE BYTES as its oracle rather than a
// signature, a doc assertion or a spy on the writer. That choice is the charter's
// (§7 note on AC4) and it is the reason this harness exposes the raw string map
// instead of a parsed view.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import type { PersistenceIO } from "../../../files/canvas-persistence";

/** A node that satisfies WP14 on every conjunct — it must survive untouched. */
export const VALID_NODE = {
  id: "n-ok",
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  text: "survivor",
};

/**
 * No `type` — WP14 diagnoses `MISSING_TYPE` and WP18 AC1 refuses it locally.
 * This is the record the composition used to DELETE from the user's own file.
 */
export const TYPELESS_NODE = {
  id: "n-bad",
  x: 300,
  y: 0,
  width: 120,
  height: 60,
  text: "the user's card",
};

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

export interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

/** The disk, as bytes. */
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

/** Collects every logger line, so a signature can be checked as the SECONDARY oracle. */
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

/** Ids present in a serialized `.canvas` payload. */
export function nodeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id));
}

/**
 * Apply a delta the way a PEER would: through a second doc and a real update, so
 * the receiving doc sees a non-local transaction rather than a local write.
 */
export function applyRemoteDelta(doc: Y.Doc, build: (peer: Y.Doc) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

// --- the HOST-seed half of AC1: a real `CanvasSync` over a fake vault ---------

export function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
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

export function createSyncManager() {
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

/** An IO view over the SAME file map the vault double serves — one disk, two doors. */
export function ioOverVault(vault: { files: Map<string, string> }): FakeIO {
  const { files } = vault;
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
