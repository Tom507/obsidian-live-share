// WP90 / AC5 — THE DURABLE RECORD IS LOCAL-ONLY AND UNREACHABLE BY ANY PEER.
//
// This is a security row, not a tidiness row. WP68 is `SPEC_COMPLETE` and
// UNBUILT, and its subject is that a peer-reachable write into `.obsidian/**` of
// an Electron process is a code-execution surface — already ruled to block
// release. WP90 puts a new file under `.obsidian/liveshare/state`, so it has to
// show it opens no second one.
//
// THE CLAIM IS DERIVED, NOT INSPECTED. The charter names "unreachable by any
// peer, asserted by inspection" as this criterion's vacuity risk by hand, so
// this file does not read the source and reason about it. It DRIVES the real
// gates — `ManifestManager.isSharedPath`, `skipsAutoTextSync`, `isSidecarPath` —
// with the store's real path, in the configurations WP26 identified as the ones
// where the exclusion is NOT a coincidence.
//
// And the derivation has a second half that matters more than the first: the
// exclusion holds BY CONSTRUCTION rather than by a rule somebody remembered to
// add. `SEED_REFUSAL_STORE_FILENAME` and `seedRefusalStorePath()` are spelled in
// `canvas-sidecar.ts` beside the other sidecar names, and `isSidecarPath` is a
// DIRECTORY-prefix test — so the store is covered by the same predicate that
// covers `index.json`, with no second rule and nothing to keep in sync. A path
// invented at the call site would have had to argue this separately.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ────────────────────────────────────────────
// Change `seedRefusalStorePath()` (`canvas-sidecar.ts`) to return a path outside
// `SIDECAR_DIR` — e.g. `"liveshare-state/seed-refusals.json"`, which is exactly
// the shape somebody would reach for if they wrote the path at the call site.
// Every case in this file goes RED: the store becomes a shared path, it is
// published into the manifest and it is text-synced. VERIFIED RED, then
// restored.
// The positive controls in each case redden the other way and are what stop a
// gate that refuses EVERYTHING from passing this file.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  isSidecarPath,
  seedRefusalStorePath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";
import { ExclusionManager } from "../../../files/exclusion";
import { ManifestManager } from "../../../files/manifest";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import type { LiveShareSettings } from "../../../types";
import { skipsAutoTextSync } from "../../../utils";
import { createStoreIO } from "./harness";

const STORE = seedRefusalStorePath();

function createSettings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "test-room",
    token: "",
    jwt: "",
    githubUserId: "",
    avatarUrl: "",
    displayName: "Test User",
    cursorColor: "#ff0000",
    sharedFolder: "",
    allowWholeVaultReconcile: false,
    lastSessionEndedAt: 0,
    role: "host",
    encryptionPassphrase: "",
    encryptionSalt: "",
    permission: "read-write",
    requireApproval: false,
    serverPassword: "",
    clientId: "test-client-id",
    notificationsEnabled: true,
    debugLogging: false,
    debugLogPath: "live-share-debug.md",
    autoReconnect: true,
    excludePatterns: [],
    readOnlyPatterns: [],
    approvalTimeoutSeconds: 60,
    showCanvasCursors: true,
    showCanvasPresence: true,
    useCanvasBinding: false,
    ...overrides,
  };
}

function mockFile(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 3, mtime: 7 };
  return file;
}

function createVault(files: string[] = []) {
  return {
    getFiles: vi.fn(() => files.map(mockFile)),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => "content"),
    readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  };
}

describe("WP90 AC5 — no peer can read, write or even learn of the durable refused set", () => {
  it("BY CONSTRUCTION — the store's path is inside SIDECAR_DIR, so WP26's one predicate covers it", () => {
    expect(STORE.startsWith(`${SIDECAR_DIR}/`), "the store escaped the sidecar directory").toBe(
      true,
    );
    expect(isSidecarPath(STORE)).toBe(true);
    // …and it is the SAME predicate, on the SAME footing, as WP24's own index —
    // not a second rule that has to be kept in step with this one.
    expect(isSidecarPath(sidecarIndexPath())).toBe(true);
    // POSITIVE CONTROL: the predicate is a filter, not a wall.
    expect(isSidecarPath("board.canvas")).toBe(false);
    expect(isSidecarPath("_liveshare-test/board.canvas")).toBe(false);
  });

  it("MANIFEST MEMBERSHIP — never a shared path, in all three configurations WP26 found", () => {
    // 1. No ExclusionManager installed at all.
    const bare = new ManifestManager(createVault() as never, createSettings());
    expect(bare.isSharedPath(STORE), "the store would be published into the manifest").toBe(false);
    expect(bare.isSharedPath("notes/hello.md"), "positive control").toBe(true);

    // 2. A NON-default config dir, so `${configDir}/**` stops covering `.obsidian/…`.
    const other = new ManifestManager(createVault() as never, createSettings());
    const exclusion = new ExclusionManager();
    exclusion.setConfigDir(".obsidian-work");
    exclusion.setPatterns([]);
    other.setExclusionManager(exclusion);
    expect(other.isSharedPath(STORE)).toBe(false);
    expect(other.isSharedPath("notes/hello.md"), "positive control").toBe(true);

    // 3. `sharedFolder` pointing INTO the config directory — the configuration
    //    that re-admits the whole subtree, and the one the run's own confirmed
    //    data loss showed is not hypothetical.
    const inside = new ManifestManager(
      createVault() as never,
      createSettings({ sharedFolder: ".obsidian" }),
    );
    expect(inside.isSharedPath(STORE)).toBe(false);
    // ---------------------------------------------------------------- WP95 --
    // BEHAVIOURAL CHANGE, RULED. The positive control was
    // `.obsidian/notes/hello.md`, which asserted that configuration 3 re-admits
    // the config subtree's ordinary content. `.obsidian` is now protected in
    // full, so that is false — and this configuration therefore admits NOTHING,
    // which is the intended outcome and is stated here rather than left as a
    // deletion for the next reader to puzzle over.
    expect(inside.isSharedPath(".obsidian/notes/hello.md")).toBe(false);
    // The positive control still has to exist — without one, all three rows
    // above are satisfied by a predicate that always answers `false`, which is
    // exactly the vacuity this file was written to avoid. It moves to a manager
    // whose `sharedFolder` admits something outside the protected tree, because
    // configuration 3 by construction no longer can.
    const ordinary = new ManifestManager(createVault() as never, createSettings());
    expect(ordinary.isSharedPath("notes/hello.md"), "positive control").toBe(true);
  });

  it("TEXT SYNC — the store is never given a raw Y.Text document of its own", () => {
    expect(skipsAutoTextSync(STORE), "a peer would receive the store as text").toBe(true);
    // POSITIVE CONTROL: an ordinary note is still text-synced.
    expect(skipsAutoTextSync("notes/hello.md")).toBe(false);
  });

  it("THE STORE TOUCHES EXACTLY ONE PATH, and it is that one", async () => {
    // A reachability claim about a component also has to be a claim about what
    // the component actually does. The store's whole I/O surface is the injected
    // `SidecarIO`, and this drives it through a real save.
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    await store.saveNow("_liveshare-test/board.canvas", [
      { boundary: "cold-open-seed", kind: "node", id: "n-bad", reason: "MISSING_TYPE" },
    ]);
    await store.saveNow("another/board.canvas", [
      { boundary: "host-seed", kind: "edge", id: "e-1", reason: "MISSING_TO" },
    ]);

    expect(store.storePath()).toBe(STORE);
    expect(storeIO.written.length, "nothing was written — the case is vacuous").toBeGreaterThan(0);
    expect(new Set(storeIO.written), "the store wrote outside its one path").toEqual(
      new Set([STORE]),
    );
    expect([...storeIO.bytes.keys()], "a second file appeared on the sidecar disk").toEqual([
      STORE,
    ]);
    // The canvas paths are KEYS inside the one file, never filenames of their
    // own — a filename is the part of a path a directory listing exposes.
    expect(storeIO.text() ?? "").toContain("_liveshare-test/board.canvas");
  });

  it("NOTHING REMOTE CAN REACH IT — the store's only inputs are a path and a refusal list", async () => {
    // The derivation, stated as a property rather than as prose: the two public
    // mutating entry points take a canvas path and a `SeedRefusal[]`, and both
    // are reached ONLY from `SeedRefusalLedger`'s sink, which only two seed
    // boundaries and one write decision drive. A remote message has no route in
    // — there is no method that accepts one. What CAN be shown here is the
    // consequence: a value that is not a refusal cannot become one, so even a
    // caller that handed the store attacker-controlled data writes nothing.
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    await store.saveNow("board.canvas", [
      { boundary: "../../evil", kind: "node", id: "x", reason: "MISSING_TYPE" },
    ] as never);

    expect(storeIO.written, "a non-refusal produced a write").toEqual([]);
    expect(await store.load("board.canvas")).toEqual([]);
  });
});
