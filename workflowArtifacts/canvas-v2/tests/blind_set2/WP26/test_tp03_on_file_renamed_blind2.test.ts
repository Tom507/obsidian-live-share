// WP26 / AC1 + AC2 blind 2 — rename, attacked through the CONTENT that the
// rename handler would otherwise move.
//
// Different angle: `onFileRenamed` does not merely acquire a document for the new
// path, it also SEEDS it. As host it reads the file at the new path and pushes the
// bytes into Y.Text; as guest it takes the remote content and writes it to disk.
// A test that only checks "no document exists" misses an implementation that
// creates no lasting registry entry but still performed one of those two
// transfers along the way. The oracle here is therefore the BYTES on both sides:
// nothing from a replica file may appear in any CRDT, and nothing from a CRDT may
// appear at a replica path on disk.
//
// The reverse leg is checked the same way — the bytes of a rescued file MUST make
// it into shared state — so an implementation that simply refuses every rename
// fails here rather than passing by inaction.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const SECRET = "LOCAL-REPLICA-ONLY-2f8b5a70";
const REPLICA_TARGET = `${SIDECAR_DIR}/imported/notes.md`;
const REPLICA_SOURCE = sidecarHistoryPath("j7").replace(/\.[^.]+$/, ".md");

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 1, mtime: 1, ctime: 1 };
  return file;
}

function buildHarness(disk: Map<string, string>, role: "host" | "guest") {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => (disk.has(path) ? fileFor(path) : null)),
    read: vi.fn(async (file: any) => disk.get(file.path) ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: {
      write: vi.fn(async (path: string, content: string) => {
        disk.set(path, content);
      }),
      writeBinary: vi.fn(async () => {}),
    },
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
  const bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
  (bg as any).role = role;
  return { docs, vault, syncManager, bg };
}

describe("WP26 blind2 — a rename into the replica directory moves no bytes into shared state", () => {
  let disk: Map<string, string>;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    disk = new Map<string, string>([[REPLICA_TARGET, SECRET]]);
    harness = buildHarness(disk, "host");
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("the host seed never reads the replica file into a Y.Text", async () => {
    await harness.bg.onFileRenamed("inbox/notes.md", REPLICA_TARGET);
    await vi.advanceTimersByTimeAsync(3000);

    for (const [path, handle] of harness.docs) {
      expect(isSidecarPath(path), `document created for ${path}`).toBe(false);
      expect(handle.text.toString()).not.toContain(SECRET);
    }
  });

  it("POSITIVE CONTROL — the same host seed DOES lift an ordinary rename target", async () => {
    disk.set("inbox/kept.md", SECRET);

    await harness.bg.onFileRenamed("inbox/old.md", "inbox/kept.md");

    expect(harness.docs.get("inbox/kept.md")?.text.toString()).toBe(SECRET);
  });
});

describe("WP26 blind2 — a rename out of the replica directory resumes sharing", () => {
  let disk: Map<string, string>;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    disk = new Map<string, string>([["rescued/notes.md", "recovered content"]]);
    harness = buildHarness(disk, "host");
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("the rescued file's bytes DO reach shared state", async () => {
    await harness.bg.onFileRenamed(REPLICA_SOURCE, "rescued/notes.md");

    expect(harness.docs.get("rescued/notes.md")?.text.toString()).toBe("recovered content");
  });

  it("and the replica source is left with no document of its own", async () => {
    await harness.bg.onFileRenamed(REPLICA_SOURCE, "rescued/notes.md");

    expect(harness.docs.has(REPLICA_SOURCE)).toBe(false);
  });
});

describe("WP26 blind2 — the guest branch cannot write a CRDT onto a replica path", () => {
  let disk: Map<string, string>;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    disk = new Map<string, string>();
    harness = buildHarness(disk, "guest");
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("remote content is not materialised at the renamed-to replica path", async () => {
    harness.syncManager.getDoc(REPLICA_TARGET).text.insert(0, "remote payload");

    await harness.bg.onFileRenamed("inbox/notes.md", REPLICA_TARGET);
    await vi.advanceTimersByTimeAsync(3000);

    expect(disk.has(REPLICA_TARGET)).toBe(false);
    for (const path of disk.keys()) {
      expect(isSidecarPath(path), `disk gained ${path}`).toBe(false);
    }
  });
});
