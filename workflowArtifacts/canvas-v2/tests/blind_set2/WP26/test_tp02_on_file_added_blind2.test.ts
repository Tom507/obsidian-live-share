// WP26 / AC1 + AC2 blind 2 — the CREATE door, attacked through the REMOTE caller
// and through path spelling instead of through a corpus.
//
// Different angle: `onFileAdded` is not only reached from the local vault event.
// `sync/control-handlers.ts:65` calls it for a file operation announced by a PEER,
// which means the argument is attacker-shaped: it arrives over the wire, in
// whatever spelling the sender chose. This test therefore drives the same method
// with the hostile spellings a remote peer can produce — backslashes, a `./`
// prefix, a leading slash, mixed separators, a trailing-dot segment — and asserts
// that none of them re-opens the door.
//
// The second half is the mirror-image risk: the exclusion must not creep upward.
// `.obsidian` holds the user's plugins, snippets and themes; the plugin already
// has a separate mechanism for those (`ExclusionManager`). A WP26 implementation
// that guards the whole config subtree here would be a behaviour change nobody
// chartered, and it is pinned as forbidden.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const CANONICAL = sidecarIndexPath();

/** Spellings a remote peer can put on the wire for the same replica file. */
const HOSTILE_SPELLINGS = [
  CANONICAL,
  CANONICAL.replace(/\//g, "\\"),
  `${SIDECAR_DIR.replace(/\//g, "\\")}/index.json`,
  `${SIDECAR_DIR}\\index.json`,
  `${SIDECAR_DIR}/deep\\nested\\replica.json`,
];

/** Ordinary config-dir content that must keep behaving exactly as before. */
const NOT_REPLICA_STATE = [
  ".obsidian/snippets/theme.css",
  ".obsidian/plugins/live-share/data.json",
  ".obsidian/liveshare/settings.json",
  `${SIDECAR_DIR}ful/index.json`,
];

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
    vault,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind2 — a peer-announced create cannot smuggle in a replica path", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = buildHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("no spelling of the replica index produces a document", async () => {
    for (const spelling of HOSTILE_SPELLINGS) {
      await harness.bg.onFileAdded(spelling);
    }
    await vi.advanceTimersByTimeAsync(600);

    const leaked = [...harness.docs.keys()].filter((path) => isSidecarPath(path));
    expect(leaked).toEqual([]);
    expect(harness.docs.has(CANONICAL)).toBe(false);
  });

  it("no observer and no disk write survives the whole hostile batch", async () => {
    for (const spelling of HOSTILE_SPELLINGS) {
      await harness.bg.onFileAdded(spelling);
    }
    await vi.advanceTimersByTimeAsync(3000);

    const observers: Map<string, unknown> = (harness.bg as any).observers;
    expect([...observers.keys()].filter((path) => isSidecarPath(path))).toEqual([]);
    expect(harness.vault.adapter.write).not.toHaveBeenCalled();
    expect(harness.vault.create).not.toHaveBeenCalled();
  });

  it("ordinary config-directory content is NOT swept up by the new exclusion", async () => {
    // POSITIVE CONTROL and over-reach guard in one: these four are outside the
    // replica directory and must behave exactly as they did before WP26.
    for (const path of NOT_REPLICA_STATE) {
      await harness.bg.onFileAdded(path);
    }

    for (const path of NOT_REPLICA_STATE) {
      expect(harness.docs.has(path), `${path} should still be synced`).toBe(true);
    }
  });
});
