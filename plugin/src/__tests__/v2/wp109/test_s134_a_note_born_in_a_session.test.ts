// S134 — A NOTE BORN DURING A SESSION IS PUBLISHED AND NEVER SEEDED.
//
// THE MECHANISM, and it is not the one the charter guessed at.
// ------------------------------------------------------------------------
// `BackgroundSync.subscribe()`'s host arm was guarded by
// `path !== this.activeFile`. That guard exists for the SINGLE-WRITER
// invariant, which is about the DISK — the active file's copy on disk belongs
// to the editor and yCollab. But the guard sat in front of the whole arm, and
// the arm's FIRST branch runs in the other direction entirely: it seeds the
// `Y.Text` FROM disk. So the guard silently also disabled seeding.
//
// A note created during a session is, in Obsidian, the ACTIVE FILE the instant
// it exists. So for every mid-session file the host reached `subscribe()`,
// attached its observer, marked the doc synced — and left the document EMPTY
// while the file had bytes on disk.
//
// THE CONTROL IS IN THE CODE, not in the file's birth time. `startAll` runs at
// `main.ts:1545/:1564`, BEFORE `onActiveFileChange()` at `:1571`, so
// `activeFile` is `null` for the whole session-start pass and every
// session-start file IS seeded. That is exactly why a Leave/Start/Join cycle
// "repairs" the same file with the same peers on the same build.
//
// The downstream damage is not a slow sync, it is NO sync, and it is silent:
//   ├── the guest's `subscribe()` waits 2 s for a host seed that never comes,
//   ├── reads `""`, tries to write it over its own bytes, and
//   └── the S119/S126 empty-write floor CORRECTLY refuses — so the file keeps
//       its bytes, the document stays empty on every peer, and nothing any peer
//       types is ever merged with anything. Three unlinked copies.
//
// DEMONSTRATED vs ARGUED, stated up front:
//   ├── Part A runs the REAL relay (`server/src`, in-process), REAL
//   │     `SyncManager`s, REAL `BackgroundSync`es and a REAL `Y.Doc` on both
//   │     peers. The vault is a double; every other participant is production
//   │     code. What the vault double does NOT exercise: Obsidian's own file
//   │     watcher and its `TFile` metadata refresh — neither is reachable from
//   │     `subscribe()`, which takes only `read`, `getAbstractFileByPath` and
//   │     `adapter.write` from it.
//   └── Part B drives the REAL `CollabManager.activateForFile` against a REAL
//         `SyncManager` whose doc never syncs, with a CodeMirror `EditorView`
//         double (the same one S129's suite uses, for the same reason: yCollab's
//         internal reconciliation is upstream library behaviour). The bind-state
//         sink and the flag it clears are both production objects.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import {
  getEmptyWriteRefusals,
  resetEmptyWriteRefusals,
} from "../../../files/empty-write-guard";
import {
  getCollabBindFailures,
  getCollabBindRefusals,
  makeBindStateSink,
  resetCollabBindFailures,
  resetCollabBindRefusals,
} from "../../../editor/collab-bind-decision";
import { CollabManager } from "../../../editor/collab";
import { SyncManager } from "../../../sync/sync";
import { DEFAULT_SETTINGS } from "../../../types";
import { createRoom, newClient, sleep, startRelay, waitUntil } from "../../wp5/harness";

const SHARE = "_liveshare-test";
const BORN = `${SHARE}/born-mid-session.md`;
const BORN_BYTES = "a note the user made while the session was live\n";
const START = `${SHARE}/present-at-start.md`;
const START_BYTES = "a note that was already there\n";

// ---------------------------------------------------------------------------
// The vault double — content only. Every predicate that decides anything in
// `subscribe()` is production code reading these three methods.
// ---------------------------------------------------------------------------

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { size: 0, mtime: 1, ctime: 1 } as TFile["stat"];
  return f;
}

function makeVault(initial: Record<string, string>) {
  const bytes = new Map<string, string>(Object.entries(initial));
  const files = new Map<string, TFile>();
  for (const p of Object.keys(initial)) files.set(p, tfile(p));
  return {
    bytes,
    put(path: string, content: string) {
      bytes.set(path, content);
      files.set(path, tfile(path));
    },
    getAbstractFileByPath: (p: string) => files.get(p) ?? null,
    getFiles: () => [...files.values()],
    getAllLoadedFiles: () => [...files.values()],
    read: async (f: { path: string }) => bytes.get(f.path) ?? "",
    readBinary: async () => new ArrayBuffer(0),
    modify: async (f: { path: string }, c: string) => void bytes.set(f.path, c),
    create: async (p: string, c: string) => {
      bytes.set(p, c);
      const f = tfile(p);
      files.set(p, f);
      return f;
    },
    createFolder: async () => ({}),
    adapter: {
      write: async (p: string, c: string) => void bytes.set(p, c),
      writeBinary: async () => {},
      exists: async (p: string) => bytes.has(p),
    },
    // biome-ignore lint/suspicious/noExplicitAny: content-only vault double
  } as any;
}

function manifestDouble(entries: Map<string, { hash: string; size: number; mtime: number }>) {
  return {
    getEntries: () => entries,
    isSharedPath: (p: string) => p.startsWith(`${SHARE}/`),
    updateFile: async () => {},
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these three
  } as any;
}

function fileOpsDouble() {
  return {
    mutePathEvents: () => {},
    unmutePathEvents: () => {},
    isPathMuted: () => false,
    isPathMutedFor: () => false,
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these
  } as any;
}

const observedPaths = (bg: BackgroundSync) =>
  [...(bg as unknown as { observers: Map<string, unknown> }).observers.keys()];

// ---------------------------------------------------------------------------
// PART A — the mechanism and its repair, over the real relay.
// ---------------------------------------------------------------------------

describe("S134 AC1/AC2 — a note born during a session, over the REAL relay", () => {
  // Every peer here is a genuine client of a genuine relay; nothing is stubbed
  // between them.
  async function twoPeerRig() {
    const relay = await startRelay();
    const room = await createRoom(relay.port, `wp109-${Date.now()}-${Math.random()}`);
    const entries = new Map([[START, { hash: "x", size: 1, mtime: 0 }]]);

    const hostVault = makeVault({ [START]: START_BYTES });
    const guestVault = makeVault({ [START]: START_BYTES });
    const hostSync = newClient(relay.port, room, "host");
    const guestSync = newClient(relay.port, room, "guest");
    const hostBg = new BackgroundSync(hostVault, hostSync, manifestDouble(entries), fileOpsDouble());
    const guestBg = new BackgroundSync(
      guestVault,
      guestSync,
      manifestDouble(entries),
      fileOpsDouble(),
    );

    await waitUntil(() => (hostSync as unknown as { isConnected: boolean }).isConnected);
    await waitUntil(() => (guestSync as unknown as { isConnected: boolean }).isConnected);

    return {
      hostVault,
      guestVault,
      hostSync,
      guestSync,
      hostBg,
      guestBg,
      async close() {
        hostBg.destroy();
        guestBg.destroy();
        hostSync.destroy();
        guestSync.destroy();
        await relay.close();
      },
    };
  }

  it("🚨 THE MECHANISM: a host seeds the document of a file that is the ACTIVE file", async () => {
    const r = await twoPeerRig();
    try {
      // The session-start pass. `activeFile` is null here in production
      // (`startAll` runs before `onActiveFileChange`), and this reproduces that.
      await r.hostBg.startAll("host");

      // Now the user makes a note. In Obsidian it is created AND opened, so
      // `onActiveFileChange` has already set it active by the time the vault
      // `create` event's `onFileAdded` reaches `subscribe()`.
      r.hostVault.put(BORN, BORN_BYTES);
      r.hostBg.setActiveFile(BORN);
      r.hostBg.setCollabBoundFile(BORN);
      await r.hostBg.onFileAdded(BORN);

      // THE ASSERTION IS THE MECHANISM, not the outcome: the document holds the
      // file's bytes. Before the repair this was `""` — subscribed, synced,
      // observed, and empty.
      const doc = r.hostSync.getDoc(BORN);
      expect(doc).not.toBeNull();
      expect(doc?.text.toString()).toBe(BORN_BYTES);

      // ...and the file on disk is untouched by the seed. Seeding is disk→CRDT.
      expect(r.hostVault.bytes.get(BORN)).toBe(BORN_BYTES);
    } finally {
      await r.close();
    }
  }, 60_000);

  it("POSITIVE CONTROL — the discriminator is the ACTIVE-FILE identity and nothing else", async () => {
    // Same file, same bytes, same peer, same call. Only `activeFile` differs.
    // This is the pre-repair behaviour's other half: it always worked here, and
    // that is exactly what made the defect look like a property of the file's
    // birth time rather than of one predicate.
    const r = await twoPeerRig();
    try {
      await r.hostBg.startAll("host");
      r.hostVault.put(BORN, BORN_BYTES);
      r.hostBg.setActiveFile(null);
      await r.hostBg.onFileAdded(BORN);
      expect(r.hostSync.getDoc(BORN)?.text.toString()).toBe(BORN_BYTES);
      // and the session-start file was seeded by the same arm
      expect(r.hostSync.getDoc(START)?.text.toString()).toBe(START_BYTES);
    } finally {
      await r.close();
    }
  }, 60_000);

  it("AC2 — the note reaches a second real peer, exactly like a session-start file", async () => {
    const r = await twoPeerRig();
    try {
      await r.hostBg.startAll("host");
      await r.guestBg.startAll("guest");

      // Born on the host, open in the host's editor.
      r.hostVault.put(BORN, BORN_BYTES);
      r.hostBg.setActiveFile(BORN);
      r.hostBg.setCollabBoundFile(BORN);
      await r.hostBg.onFileAdded(BORN);

      // The guest's production route for a mid-session file
      // (`main.ts::processManifestChange` -> `onFileAdded`). Its bytes are
      // already on disk — they travel as a file-op, which is why the charter
      // measured propagation at 0.00-0.15 s while sync never completed.
      r.guestVault.put(BORN, BORN_BYTES);
      await r.guestBg.onFileAdded(BORN);

      expect(observedPaths(r.guestBg)).toContain(BORN);
      expect(r.guestSync.getDoc(BORN)?.text.toString()).toBe(BORN_BYTES);
      // The two peers hold the SAME document, so an edit on one is an edit on
      // the other — the property the charter's three unlinked copies violate.
      r.hostSync.getDoc(BORN)?.text.insert(0, "HOST TYPED: ");
      await waitUntil(() => r.guestSync.getDoc(BORN)?.text.toString().startsWith("HOST TYPED: "), {
        timeout: 5_000,
      });
      expect(r.guestSync.getDoc(BORN)?.text.toString()).toBe(`HOST TYPED: ${BORN_BYTES}`);
    } finally {
      await r.close();
    }
  }, 60_000);

  it("VACUITY CONTROL — the guest's empty-write refusal is real, and it fired pre-repair", async () => {
    // A guest that subscribes a document nothing ever seeded reads `""` and
    // tries to write it over its own bytes. The S119/S126 floor refuses. This
    // asserts the floor is genuinely in front of that write, so the pre-repair
    // "the file kept its bytes" observation is the floor working and not the
    // absence of an attempt.
    const r = await twoPeerRig();
    try {
      resetEmptyWriteRefusals();
      // `startAll` is what puts this peer in the GUEST role, exactly as
      // `main.ts` does on join; the guest arm is the one that writes.
      await r.guestBg.startAll("guest");
      r.guestVault.put(BORN, BORN_BYTES);
      // Nobody seeds: the host never subscribes this path at all.
      await r.guestBg.onFileAdded(BORN);

      expect(r.guestVault.bytes.get(BORN)).toBe(BORN_BYTES);
      // Read from the PRODUCT'S OWN ledger, not from a console spy: the arm is
      // named, so this cannot pass on some other refusal elsewhere in the run.
      expect(getEmptyWriteRefusals().byArm["doc-write"]).toBeGreaterThan(0);
    } finally {
      await r.close();
    }
  }, 60_000);

  it("AC2 — the newly reachable seed does NOT resurrect a note a peer emptied", async () => {
    // S129 AC3's evidence at the new site. The user has the note OPEN; a peer
    // select-all-and-deletes it. Re-seeding from disk would undo that under
    // their cursor — the inverse of S126.
    const r = await twoPeerRig();
    try {
      const handle = r.hostSync.getDoc(BORN);
      expect(handle).not.toBeNull();
      // A real deletion: content, then removed. Yjs keeps the tombstones.
      handle?.text.insert(0, "content a peer then deleted");
      handle?.text.delete(0, handle.text.length);

      r.hostVault.put(BORN, BORN_BYTES);
      r.hostBg.setActiveFile(BORN);
      await r.hostBg.onFileAdded(BORN);

      expect(r.hostSync.getDoc(BORN)?.text.toString()).toBe("");
    } finally {
      await r.close();
    }
  }, 60_000);

  it("the SINGLE-WRITER invariant is intact: the active file's DISK copy is never written here", async () => {
    // The branch the `path !== activeFile` guard was really protecting. A
    // document that already holds content and disagrees with disk must NOT be
    // flushed to disk by background-sync while the editor owns that file.
    const r = await twoPeerRig();
    try {
      const handle = r.hostSync.getDoc(BORN);
      handle?.text.insert(0, "what the shared document says");
      r.hostVault.put(BORN, BORN_BYTES);
      r.hostBg.setActiveFile(BORN);
      await r.hostBg.onFileAdded(BORN);
      expect(r.hostVault.bytes.get(BORN)).toBe(BORN_BYTES);

      // POSITIVE CONTROL for that assertion: the same disagreement on a
      // NON-active path does reach disk, so the row above is not passing
      // because nothing ever writes.
      const other = `${SHARE}/not-active.md`;
      r.hostSync.getDoc(other)?.text.insert(0, "what the shared document says");
      r.hostVault.put(other, "stale bytes on disk");
      await r.hostBg.onFileAdded(other);
      await waitUntil(() => r.hostVault.bytes.get(other) === "what the shared document says", {
        timeout: 5_000,
      });
    } finally {
      await r.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// PART B — AC3: the bind must not lie.
// ---------------------------------------------------------------------------

const NOTE = `${SHARE}/opened-before-it-arrived.md`;
const BUFFER = "the user's note, still on screen\n";

/** A `SyncManager` that hands out a real doc and never marks it synced. */
function neverSyncsRig(doc: Y.Doc) {
  const sync = new SyncManager({ ...DEFAULT_SETTINGS, roomId: "r" } as never);
  const text = doc.getText("content");
  (sync as unknown as { getDoc(p: string): unknown }).getDoc = () => ({
    doc,
    text,
    awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
  });
  return sync;
}

function viewDouble() {
  const reconfigures: unknown[] = [];
  return {
    reconfigures,
    view: {
      state: {
        doc: { length: BUFFER.length, toString: () => BUFFER },
        selection: { main: { anchor: 0, head: 0 } },
      },
      dispatch: vi.fn((spec: { effects?: unknown }) => reconfigures.push(spec.effects)),
      destroyed: false,
    },
  };
}

describe("S134 AC3 — a bind that failed must stop reporting itself as bound", () => {
  beforeEach(() => {
    resetCollabBindFailures();
    resetCollabBindRefusals();
  });
  afterEach(() => vi.useRealTimers());

  /** Drives `activateForFile` through the full 10 s `waitForSync` timeout. */
  async function activateThroughTimeout(
    manager: CollabManager,
    view: unknown,
    sync: SyncManager,
    role: "host" | "guest",
  ) {
    vi.useFakeTimers();
    try {
      const activation = manager.activateForFile(view as never, NOTE, sync, role);
      // TIME IS DRIVEN, NOT SLEPT THROUGH: `waitForSync`'s default is 10 s and
      // this is the only way to reach its rejection without a 10 s test.
      await vi.advanceTimersByTimeAsync(10_500);
      await activation;
    } finally {
      vi.useRealTimers();
    }
  }

  it("🚨 THE LIE: `collabBoundFile` still named the file after the bind timed out", async () => {
    const bg = new BackgroundSync(
      makeVault({}),
      neverSyncsRig(new Y.Doc()),
      manifestDouble(new Map()),
      fileOpsDouble(),
    );
    const sync = neverSyncsRig(new Y.Doc());
    const manager = new CollabManager();
    manager.setBindStateSink(makeBindStateSink(bg));
    const { view, reconfigures } = viewDouble();

    // Exactly what `main.ts::onActiveFileChange` does, synchronously, before
    // the activation it describes has started.
    bg.setActiveFile(NOTE);
    bg.setCollabBoundFile(NOTE);
    expect(bg.getCollabBoundFile()).toBe(NOTE);

    await activateThroughTimeout(manager, view, sync, "guest");

    // The damage the charter measured is unchanged and still happens — the
    // compartment IS reconfigured to empty.
    expect(reconfigures.length).toBeGreaterThan(0);
    // What is repaired: the flag no longer claims a binding that does not exist.
    expect(bg.getCollabBoundFile()).toBeNull();
  }, 30_000);

  it("AC3 — the failure is COUNTED and LOGGED, not only shown as a Notice", async () => {
    const sync = neverSyncsRig(new Y.Doc());
    const manager = new CollabManager();
    const logs: string[] = [];
    manager.setLogger({ log: (_c, m) => logs.push(m) });
    const { view } = viewDouble();

    await activateThroughTimeout(manager, view, sync, "guest");

    expect(getCollabBindFailures().total).toBe(1);
    expect(getCollabBindFailures().paths).toEqual([NOTE]);
    expect(logs.some((l) => l.includes("bind FAILED") && l.includes(NOTE))).toBe(true);
    // S132's rule: the two ledgers must stay separable. A TIMEOUT is not a
    // refusal, and a validator watching the refusal counter must not see this.
    expect(getCollabBindRefusals().total).toBe(0);
  }, 30_000);

  it("AC3 — the sink is IDENTITY-GUARDED: a late failure cannot clear a file the user moved to", async () => {
    const bg = new BackgroundSync(
      makeVault({}),
      neverSyncsRig(new Y.Doc()),
      manifestDouble(new Map()),
      fileOpsDouble(),
    );
    const sink = makeBindStateSink(bg);
    const other = `${SHARE}/the-user-moved-on.md`;
    bg.setCollabBoundFile(other);

    sink(NOTE, false);
    expect(bg.getCollabBoundFile()).toBe(other);

    // POSITIVE CONTROL: the same call for the path it DOES name clears it.
    sink(other, false);
    expect(bg.getCollabBoundFile()).toBeNull();
  });

  it("AC3 — a successful bind never RE-SETS the flag (a stale activation cannot re-claim)", async () => {
    const bg = new BackgroundSync(
      makeVault({}),
      neverSyncsRig(new Y.Doc()),
      manifestDouble(new Map()),
      fileOpsDouble(),
    );
    const sink = makeBindStateSink(bg);
    bg.setCollabBoundFile(null);
    sink(NOTE, true);
    expect(bg.getCollabBoundFile()).toBeNull();
  });

  it("AC3 — a failed bind RECOVERS on the event: the document arriving re-activates it", async () => {
    const doc = new Y.Doc();
    const sync = neverSyncsRig(doc);
    const manager = new CollabManager();
    const logs: string[] = [];
    manager.setLogger({ log: (_c, m) => logs.push(m) });
    const { view } = viewDouble();

    await activateThroughTimeout(manager, view, sync, "guest");
    expect(getCollabBindFailures().paths).toEqual([NOTE]);

    // The event, not a retry budget.
    doc.getText("content").insert(0, "the shared content arrives late");
    for (let i = 0; i < 40; i++) await Promise.resolve();

    expect(logs.some((l) => l.includes("content arrived"))).toBe(true);
    // The live set clears; the running total is monotonic, so the record that
    // it happened cannot be erased by the recovery.
    expect(getCollabBindFailures().paths).toEqual([]);
    expect(getCollabBindFailures().total).toBe(1);
  }, 30_000);

  it("VACUITY CONTROL — an activation that SUCCEEDS records no failure at all", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "the shared content, already here");
    const sync = neverSyncsRig(doc);
    // This one really syncs: mark it so `waitForSync` resolves immediately.
    (sync as unknown as { synced: Map<string, boolean> }).synced.set(NOTE, true);
    const manager = new CollabManager();
    const { view, reconfigures } = viewDouble();

    await manager.activateForFile(view as never, NOTE, sync, "guest");

    expect(getCollabBindFailures().total).toBe(0);
    expect(getCollabBindFailures().paths).toEqual([]);
    // and the binding was genuinely installed, so the rows above are not
    // passing because nothing in this file ever binds.
    expect(reconfigures.length).toBeGreaterThan(0);
  }, 30_000);
});
