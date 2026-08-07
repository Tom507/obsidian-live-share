// S119 — EVERY `.md` IN THE SHARE WENT TO 0 BYTES; EVERY `.canvas` DID NOT.
//
// Live incident: `_liveshare-test/hello.md` (49 B) and `Properties.md` (459 B)
// — the only two pre-existing `.md` files in the share — became 0 bytes on all
// three clients inside 21 s. sha256 `e3b0c442…`, the empty-file hash. All seven
// `.canvas` files in the same folder were byte-unchanged. `useCanvasBinding` was
// OFF. The files still EXIST, so this was an empty-content WRITE, not a delete.
//
// THIS FILE REPRODUCED THE TRUNCATION, AND NOW PINS ITS ABSENCE.
//
// ⚠ READ THIS BEFORE EDITING. On the pre-fix tree these exact rows asserted the
// OPPOSITE — `expect(vault.files.get(NOTE)).toBe("")` — and passed, 4/4, which
// is how the mechanism was established rather than argued. The floor then made
// them fail, because the truncation stopped happening. Rather than keep a test
// that pins the defect as the specification (the worst of Rule 9's sibling
// classes: it would actively defend the bug against a correct fix), the
// assertions were inverted and the standing proof moved to the break table:
// `s115_break_table.py` B15/B16 re-plant the removal of each floor and redden
// exactly these rows on demand. The reproduction is therefore reproducible,
// not merely remembered.
//
// THE MECHANISM, in three verified facts:
//
//   1. `SyncManager.handleSubscribed` (sync/sync.ts) flips a doc to SYNCED the
//      moment the relay reports `peerCount === 0` — BEFORE any replay batch has
//      landed. `waitForSync` therefore resolves on a doc whose `Y.Text` is
//      still empty.
//   2. `ManifestManager.syncFromManifest` awaits exactly that `waitForSync`,
//      reads `tempHandle.text.toString()`, and hands the result straight to
//      `vault.modify(localFile, content)` with NO emptiness check of any kind.
//   3. One line earlier, at the `skipsAutoTextSync` guard, `.canvas` is
//      skipped and `.md` is not. That is the discriminator the incident showed:
//      100 % of `.md`, 0 % of `.canvas`.
//
// WHAT EACH TEST BELOW ESTABLISHES IS LABELLED. In particular the difference
// between "an empty doc truncates the file" (reproduced here directly against
// the real `syncFromManifest`) and "the doc can BE empty at that moment in
// production" (established separately against the real `SyncManager`).
//
// VACUITY GUARDS:
//   ├── the `.canvas` row runs the SAME manifest and the SAME empty doc and
//   │     shows the file is untouched — so the `.md` row cannot be passing
//   │     because of some unrelated property of the fixture
//   └── the non-empty row shows the same path DOES write real content, so
//         "nothing is ever written" can never be mistaken for the fix

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { ManifestManager } from "../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../types";

const NOTE = "_liveshare-test/hello.md";
const CANVAS = "_liveshare-test/board.canvas";
const NOTE_BODY = "# hello\n\nthis is the user's note, forty-nine bytes or so.\n";

function settings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return { ...DEFAULT_SETTINGS, clientId: "me", role: "guest", ...overrides };
}

/** A vault whose files carry real bytes, so a truncation is observable as bytes. */
function vaultDouble(contents: Record<string, string>) {
  const files = new Map(Object.entries(contents));
  // REAL `TFile` instances: `getFileByPath` (utils.ts) is an `instanceof TFile`
  // test, so a plain object would send every path down the `vault.create` arm
  // instead of the `vault.modify` arm. The live incident truncated files that
  // ALREADY EXISTED, so the fixture has to reach `modify`.
  const handles = new Map<string, TFile>();
  const handle = (path: string) => {
    let file = handles.get(path);
    if (!file) {
      file = new TFile();
      file.path = path;
      handles.set(path, file);
    }
    return file;
  };
  return {
    files,
    getFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAllLoadedFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? handle(p) : null)),
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async (f: { path: string }, content: string) => {
      files.set(f.path, content);
    }),
    create: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
    }),
    createFolder: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => false) },
  };
}

/**
 * A `SyncManager` double whose `waitForSync` RESOLVES while the doc's `Y.Text`
 * is still empty. That is not an invented state: it is exactly what
 * `handleSubscribed` produces on `peerCount === 0`, established against the
 * real `SyncManager` in the last describe block of this file.
 */
function syncDoubleWithEmptyDocs(seed?: Record<string, string>) {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text }>();
  return {
    docs,
    getDoc: vi.fn((path: string) => {
      let entry = docs.get(path);
      if (!entry) {
        const doc = new Y.Doc();
        const text = doc.getText("content");
        const preset = seed?.[path];
        if (preset) text.insert(0, preset);
        entry = { doc, text };
        docs.set(path, entry);
      }
      return { ...entry, awareness: {} };
    }),
    // Resolves immediately — the `peerCount === 0` case.
    waitForSync: vi.fn(async () => {}),
    releaseDoc: vi.fn(),
  };
}

async function runSync(options: {
  files: Record<string, string>;
  manifest: Record<string, { hash: string; size: number; mtime: number }>;
  docSeed?: Record<string, string>;
}) {
  const vault = vaultDouble(options.files);
  const manager = new ManifestManager(vault as never, settings());
  const doc = new Y.Doc();
  const map = doc.getMap("files");
  for (const [path, entry] of Object.entries(options.manifest)) map.set(path, entry);
  // Inject the manifest and the sync manager the way the existing
  // `manifest.test.ts` fixtures do — the method under test is the real one.
  (manager as unknown as { manifest: Y.Map<unknown> }).manifest = map as never;
  const sync = syncDoubleWithEmptyDocs(options.docSeed);
  (manager as unknown as { syncManager: unknown }).syncManager = sync;
  const synced = await manager.syncFromManifest();
  return { vault, synced, sync };
}

/** The manifest entry always disagrees with disk, so `needsSync` is true. */
const STALE_ENTRY = { hash: "a-hash-that-does-not-match-disk", size: 10, mtime: 1000 };

describe("S119 — an empty Y.Text must never be written over a user's note", () => {
  it("🚨 THE INCIDENT: the note keeps its bytes when the doc arrives empty", async () => {
    const { vault } = await runSync({
      files: { [NOTE]: NOTE_BODY },
      manifest: { [NOTE]: STALE_ENTRY },
    });

    // The live incident left these files existing and 0 bytes. Both halves are
    // asserted: still present, and still holding every byte.
    expect(vault.files.has(NOTE)).toBe(true);
    expect(vault.files.get(NOTE)).toBe(NOTE_BODY);
    expect(vault.files.get(NOTE)?.length).toBe(NOTE_BODY.length);
    // Not merely "restored afterwards" — the write never happened.
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it("the `.md` and the `.canvas` beside it now survive alike", async () => {
    // PRE-FIX this row was the discriminator: same manifest, same empty docs,
    // same call, and the `.md` went to 0 bytes while the `.canvas` did not —
    // because `.canvas` is skipped by an extension test one line before the
    // unguarded write, and the canvas writer has an empty-doc floor of its own.
    // The asymmetry is what identified the sink. It is now gone in the safe
    // direction: the text path has the floor the canvas path always had.
    const { vault } = await runSync({
      files: { [NOTE]: NOTE_BODY, [CANVAS]: '{"nodes":[],"edges":[]}' },
      manifest: { [NOTE]: STALE_ENTRY, [CANVAS]: STALE_ENTRY },
    });

    expect(vault.files.get(NOTE)).toBe(NOTE_BODY);
    expect(vault.files.get(CANVAS)).toBe('{"nodes":[],"edges":[]}');
  });

  it("VACUITY CONTROL — a populated doc writes real content down the same path", async () => {
    // Without this row the two above could be passing because this path never
    // writes anything at all.
    const { vault } = await runSync({
      files: { [NOTE]: NOTE_BODY },
      manifest: { [NOTE]: STALE_ENTRY },
      docSeed: { [NOTE]: "the real remote content" },
    });
    expect(vault.files.get(NOTE)).toBe("the real remote content");
  });
});

describe("S119 — the precondition is reachable: waitForSync resolves on an empty doc", () => {
  it("peerCount === 0 marks a doc SYNCED while its Y.Text is still empty", async () => {
    // This is fact (1) of the mechanism, against the REAL SyncManager, so the
    // double used above is not an invention. `handleSubscribed` is driven
    // directly with the payload the relay sends when it knows of no other peer.
    const { SyncManager } = await import("../../sync/sync");
    const manager = new SyncManager({ ...DEFAULT_SETTINGS, roomId: "r" } as never);

    // Give the manager a doc for the path without going near a socket.
    const doc = new Y.Doc();
    (manager as unknown as { docs: Map<string, Y.Doc> }).docs.set(NOTE, doc);

    // The relay's MUX_SUBSCRIBED payload carries a varint peer count. Zero
    // means "nobody else is here", and the empty payload decodes the same way.
    (
      manager as unknown as { handleSubscribed(id: string, payload: Uint8Array): void }
    ).handleSubscribed(NOTE, new Uint8Array());

    const synced = (manager as unknown as { synced: Map<string, boolean> }).synced;
    expect(synced.get(NOTE)).toBe(true);
    // …and the document it just declared synced is empty.
    expect(doc.getText("content").toString()).toBe("");
    // So the consumer's `await waitForSync(path)` returns immediately — and
    // since S128 it says WHY: there was nobody to ask. That is the fact this
    // consumer needed and could not obtain when the truncation shipped.
    await expect(manager.waitForSync(NOTE)).resolves.toBe("no-peers");
  });
});
