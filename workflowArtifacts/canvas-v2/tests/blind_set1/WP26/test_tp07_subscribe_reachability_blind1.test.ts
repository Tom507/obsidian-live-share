// WP26 / AC1 blind 1 — reachability of the deliberate NON-consumer, attacked by
// instrumenting the method itself rather than by spying on the instance.
//
// Different angle: the visible test replaces `subscribe` with a mock, which also
// suppresses everything downstream of it. Here the real method is left in place
// and WRAPPED on the prototype, so the recorded arguments are the ones the real
// control flow produced and the real downstream work still happens. That matters:
// an implementation that guards inside `subscribe` instead of at the entry points
// would satisfy a mock-based reachability test while leaving the entry points
// themselves unguarded — which is the shape AC1 explicitly rejects ("asserted at
// each of the exclusion consumers, not only at one").
//
// The three guarded entry points are driven in a single interleaved sequence, and
// the oracle is the complete argument log.
//
// Deliberately NOT asserted: what `subscribe` does when a caller hands it a
// replica path directly. That door belongs to the R10 text fallback and closing
// it is WP33's charter, not WP26's; pinning it either way here would either
// forbid defence in depth or mandate an out-of-scope change.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const REPLICA_A = sidecarIndexPath();
const REPLICA_B = `${SIDECAR_DIR}/one/two/three.md`;
const REPLICA_C = `${SIDECAR_DIR}/rename-target.json`;

function build() {
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
    releaseDoc(path: string) {
      docs.get(path)?.doc.destroy();
      docs.delete(path);
    },
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const entries = new Map<string, any>([
    [REPLICA_A, { hash: "1", size: 1, mtime: 1 }],
    ["notes/replay-a.md", { hash: "2", size: 1, mtime: 1 }],
    [REPLICA_B, { hash: "3", size: 1, mtime: 1 }],
    ["notes/replay-b.md", { hash: "4", size: 1, mtime: 1 }],
  ]);
  const manifestManager = {
    getEntries: vi.fn(() => entries),
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

describe("WP26 blind1 — subscribe() is unreachable with a replica path", () => {
  let ctx: ReturnType<typeof build>;
  let seen: string[];
  let original: BackgroundSync["subscribe"];

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = build();
    seen = [];
    original = BackgroundSync.prototype.subscribe;
    BackgroundSync.prototype.subscribe = function patched(this: BackgroundSync, path: string) {
      seen.push(path);
      return original.call(this, path);
    } as BackgroundSync["subscribe"];
  });

  afterEach(() => {
    BackgroundSync.prototype.subscribe = original;
    ctx.bg.destroy();
    vi.useRealTimers();
  });

  async function driveEveryEntryPoint() {
    await ctx.bg.startAll("host");
    await ctx.bg.onFileAdded(REPLICA_A);
    await ctx.bg.onFileAdded("notes/created.md");
    await ctx.bg.onFileRenamed("notes/replay-a.md", REPLICA_C);
    await ctx.bg.onFileAdded(REPLICA_B);
    await ctx.bg.handleLocalTextModify(REPLICA_A);
    await vi.advanceTimersByTimeAsync(600);
  }

  it("the real (unmocked) subscribe is never handed a replica path", async () => {
    await driveEveryEntryPoint();

    expect(seen.filter((path) => isSidecarPath(path))).toEqual([]);
  });

  it("...while it WAS handed every ordinary path in the same run", async () => {
    await driveEveryEntryPoint();

    expect(seen).toContain("notes/replay-a.md");
    expect(seen).toContain("notes/replay-b.md");
    expect(seen).toContain("notes/created.md");
  });

  it("and no replica document exists at the end of the sequence", async () => {
    await driveEveryEntryPoint();

    expect([...ctx.docs.keys()].filter((path) => isSidecarPath(path))).toEqual([]);
  });
});
