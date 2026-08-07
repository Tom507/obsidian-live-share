// ===========================================================================
// WP80 AC2 — the branches of the REAL `ManifestManager.publishManifest`.
//
// The pure core's table lives in `manifest-purge-decision.test.ts`. This file
// asserts that the METHOD actually consults it and reports what it did — in
// particular the one branch the live rig cannot reach on demand: the
// `manifest === null` early return, which before WP80 was a bare `return` and
// therefore indistinguishable from a successful publication. `promoteToHost`
// can reach it, because a `join-response` can land while `connect()` is still
// awaiting `waitForSync`.
// ===========================================================================

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { ManifestManager } from "../files/manifest";
import type { LiveShareSettings } from "../types";

function createSettings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "test-room",
    token: "test-token",
    jwt: "",
    githubUserId: "",
    avatarUrl: "",
    displayName: "Test User",
    cursorColor: "#ff0000",
    sharedFolder: "",
    allowWholeVaultReconcile: false,
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

function createVault() {
  return {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text }>();
  return {
    getDoc: vi.fn((path: string) => {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        docs.set(path, { doc, text: doc.getText("content") });
      }
      const entry = docs.get(path)!;
      return { doc: entry.doc, text: entry.text, awareness: { setLocalStateField: vi.fn() } };
    }),
    waitForSync: vi.fn(async () => {}),
    releaseDoc: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
    updateSettings: vi.fn(),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: the mocks above are structural stand-ins.
const asAny = (value: unknown) => value as any;

describe("WP80 AC2 — publishManifest returns a decision, and no branch is silent", () => {
  it("THE SILENT NO-OP IS GONE: no manifest connected -> a NAMED refusal, not a bare return", async () => {
    const manager = new ManifestManager(asAny(createVault()), createSettings());
    // `connect()` deliberately not called — the `promoteToHost`-during-connect
    // shape, where the peer is host and believes it published.
    const decision = await manager.publishManifest({ purge: true });
    expect(decision.verdict).toBe("nothing-to-publish");
    expect(decision.published).toBe(false);
    expect(decision.purged).toBe(false);
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.deleted).toEqual([]);
    // And it is REPORTABLE afterwards, which is what the E2E instrument reads.
    expect(manager.getLastPublishDecision()).toEqual(decision);
  });

  it("a host that entered the session as host purges, and names what it deleted", async () => {
    const sync = createSyncManager();
    const manager = new ManifestManager(asAny(createVault()), createSettings({ role: "host" }));
    await manager.connect(asAny(sync));
    // An entry no local file accounts for — an offline deletion's shape.
    const doc = sync.getDoc("__manifest__").doc;
    doc.getMap("files").set("orphan.md", { hash: "x", size: 1, mtime: 0 });

    const decision = await manager.publishManifest({ purge: true });
    expect(decision.verdict).toBe("purge");
    expect(decision.purged).toBe(true);
    expect(decision.deleted).toEqual(["orphan.md"]);
    expect(doc.getMap("files").has("orphan.md")).toBe(false);
  });

  it("a peer that entered as GUEST refuses the purge and leaves the entry alone", async () => {
    const sync = createSyncManager();
    const settings = createSettings({ role: "guest" });
    const manager = new ManifestManager(asAny(createVault()), settings);
    await manager.connect(asAny(sync));
    const doc = sync.getDoc("__manifest__").doc;
    doc.getMap("files").set("not-yet-here.md", { hash: "x", size: 1, mtime: 0 });

    // The promotion: role flips AFTER the manifest was connected. This is the
    // whole defect, expressed in three lines.
    settings.role = "host";
    manager.updateSettings(settings);

    const decision = await manager.publishManifest({ purge: true });
    expect(decision.verdict).toBe("additive");
    expect(decision.purged).toBe(false);
    expect(decision.deleted).toEqual([]);
    expect(decision.unaccounted).toEqual(["not-yet-here.md"]);
    expect(decision.reason.length).toBeGreaterThan(0);
    // I11 — the refusal is of the DELETION, never of the publication.
    expect(decision.published).toBe(true);
    expect(doc.getMap("files").has("not-yet-here.md")).toBe(true);
    // And the attestation still rode the same transaction.
    expect(manager.getPublication()?.hostId).toBe("test-client-id");
  });

  it("the attestation still rides the entries' transaction on an ADDITIVE publication", async () => {
    const sync = createSyncManager();
    const settings = createSettings({ role: "guest" });
    const manager = new ManifestManager(asAny(createVault()), settings);
    await manager.connect(asAny(sync));
    const doc = sync.getDoc("__manifest__").doc;
    doc.getMap("files").set("not-yet-here.md", { hash: "x", size: 1, mtime: 0 });
    settings.role = "host";
    manager.updateSettings(settings);

    const transactions: number[] = [];
    doc.on("afterTransaction", () => transactions.push(1));
    await manager.publishManifest({ purge: true });
    expect(transactions.length).toBe(1);
  });
});
