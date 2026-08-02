// WP26 / AC1 + AC2 blind 1 — rename, attacked as a SEQUENCE rather than as a
// single call.
//
// Different angle: a file is walked through a four-step journey —
//
//   vault note  →  replica state  →  replica state (moved)  →  vault note again
//
// on ONE instance, and the invariant is checked after every step. This catches
// two implementations that a single INTO-direction call cannot:
//
//   * one that guards the new path but forgets that the OLD path's teardown has
//     to happen first — after step 1 the old document must be gone, not merely
//     the new one absent;
//   * one that latches (a `Set` of "excluded paths", a memoised verdict) and
//     therefore refuses to resume syncing at step 3, when the file has genuinely
//     become an ordinary note again.
//
// The last step is the direction an over-broad guard gets wrong and is the reason
// the journey ends where it does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import { SIDECAR_DIR, sidecarIndexPath } from "../../../../../plugin/src/files/canvas-sidecar";

const NOTE_A = "inbox/scratch.json";
const REPLICA_1 = sidecarIndexPath();
const REPLICA_2 = `${SIDECAR_DIR}/moved/scratch.json`;
const NOTE_B = "archive/scratch.json";

function buildHarness() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const released: string[] = [];
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
      released.push(path);
      docs.get(path)?.doc.destroy();
      docs.delete(path);
    },
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
    released,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind1 — a file's whole journey in and out of the replica directory", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = buildHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("each leg leaves exactly the right registry state", async () => {
    const { bg, docs, released } = harness;

    // Leg 0 — it starts life as an ordinary synced note.
    await bg.subscribe(NOTE_A);
    expect(docs.has(NOTE_A)).toBe(true);

    // Leg 1 — moved into the replica directory.
    await bg.onFileRenamed(NOTE_A, REPLICA_1);
    expect(docs.has(REPLICA_1)).toBe(false);
    expect(docs.has(NOTE_A)).toBe(false);
    expect(released).toContain(NOTE_A);
    expect((bg as any).observers.has(NOTE_A)).toBe(false);

    // Leg 2 — moved WITHIN the replica directory. Neither side is shared state.
    await bg.onFileRenamed(REPLICA_1, REPLICA_2);
    expect(docs.has(REPLICA_1)).toBe(false);
    expect(docs.has(REPLICA_2)).toBe(false);

    // Leg 3 — rescued back into the vault. It is an ordinary note again and the
    // exclusion must NOT have latched.
    await bg.onFileRenamed(REPLICA_2, NOTE_B);
    expect(docs.has(NOTE_B)).toBe(true);
    expect((bg as any).observers.has(NOTE_B)).toBe(true);
  });

  it("the journey never leaves a stray timer or sequence entry behind", async () => {
    const { bg, docs } = harness;

    await bg.subscribe(NOTE_A);
    await bg.onFileRenamed(NOTE_A, REPLICA_1);
    await bg.onFileRenamed(REPLICA_1, REPLICA_2);
    await vi.advanceTimersByTimeAsync(3000);

    expect((bg as any).writeTimers.has(REPLICA_1)).toBe(false);
    expect((bg as any).writeTimers.has(REPLICA_2)).toBe(false);
    expect((bg as any).remoteSeq.has(REPLICA_1)).toBe(false);
    expect([...docs.keys()]).toEqual([]);
  });

  it("the active-file pointer still follows a rename into the replica directory", async () => {
    // Teardown ordering again, from the other side: the guard must sit after the
    // bookkeeping, so a user who had the file open does not end up with an
    // active-file pointer at a path that no longer exists.
    const { bg } = harness;
    await bg.subscribe(NOTE_A);
    bg.setActiveFile(NOTE_A);

    await bg.onFileRenamed(NOTE_A, REPLICA_1);

    expect((bg as any).activeFile).toBe(REPLICA_1);
  });
});
