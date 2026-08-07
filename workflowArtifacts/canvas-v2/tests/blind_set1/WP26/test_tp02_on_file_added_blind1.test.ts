// WP26 / AC1 + AC2 blind 1 — the CREATE door, attacked with a generated corpus
// and a single partition oracle.
//
// Different angle: instead of naming three sidecar paths, the corpus is BUILT —
// every combination of {depth 1, 2, 3} x {json, md, ts, no extension} under the
// sidecar directory, plus the same grid rebuilt one directory ABOVE it and under
// a prefix-sharing sibling. Every path is fed through `onFileAdded` in a shuffled
// but deterministic order, and the oracle is the partition: no generated path
// inside the directory acquired a document, every generated path outside it did.
//
// This shape kills two implementations a hand-written triple cannot: one that
// tests only the three extensions WP24 happens to write, and one that tests the
// directory with `includes` or with a depth-1 assumption.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import { SIDECAR_DIR } from "../../../../../plugin/src/files/canvas-sidecar";

const TAILS = ["notes.json", "notes.md", "helper.ts", "no-extension"];
const DEPTHS = ["", "one/", "one/two/"];
const PARENT = SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"));

function grid(root: string): string[] {
  const out: string[] = [];
  for (const depth of DEPTHS) for (const tail of TAILS) out.push(`${root}/${depth}${tail}`);
  return out;
}

const INSIDE = grid(SIDECAR_DIR);
const OUTSIDE = [...grid(PARENT), ...grid(`${SIDECAR_DIR}ful`), ...grid("vault")];

/** Deterministic interleave — no clock, no RNG, but not authored order either. */
function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < b.length) out.push(b[i]);
    if (i < a.length) out.push(a[i]);
  }
  return out;
}

function buildHarness() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const vault = {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as any;
  const syncManager = {
    getDoc(path: string) {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        docs.set(path, {
          doc,
          text: doc.getText("content"),
          awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
        });
      }
      return docs.get(path)!;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  return {
    docs,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind1 — creates partition cleanly on the directory boundary", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = buildHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("no generated path inside the sidecar directory acquires a document", async () => {
    for (const path of interleave(INSIDE, OUTSIDE)) {
      await harness.bg.onFileAdded(path);
    }

    const leaked = INSIDE.filter((path) => harness.docs.has(path));
    expect(leaked).toEqual([]);
  });

  it("every generated TEXT path outside it still acquires one", async () => {
    for (const path of interleave(INSIDE, OUTSIDE)) {
      await harness.bg.onFileAdded(path);
    }

    // `no-extension` has no text extension and is excluded for an older reason.
    const expected = OUTSIDE.filter((path) => !path.endsWith("no-extension")).sort();
    const missing = expected.filter((path) => !harness.docs.has(path));
    expect(missing).toEqual([]);
    expect(expected.length).toBeGreaterThan(20);
  });

  it("the document registry contains nothing but the outside corpus", async () => {
    for (const path of interleave(INSIDE, OUTSIDE)) {
      await harness.bg.onFileAdded(path);
    }

    const expected = OUTSIDE.filter((path) => !path.endsWith("no-extension")).sort();
    expect([...harness.docs.keys()].sort()).toEqual(expected);
  });
});
