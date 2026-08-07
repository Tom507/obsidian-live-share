// S119 AC3/AC4/AC5 — THE FLOOR.
//
// The companion file `test_s119_empty_text_write_truncates_a_note.test.ts`
// REPRODUCES the truncation. This file pins the rule that stops it:
//
//   replacing non-empty file content with empty content, from a remote source,
//   requires positive evidence that the emptiness is intended.
//
// The two writers hold DIFFERENT evidence, and each passes the strongest fact
// it actually has to one shared predicate:
//
//   ├── `syncFromManifest` -> the HOST'S OWN published hash for the path. The
//   │     manifest entry is the host's attestation of what the file should
//   │     contain, so a hash match is the host saying "empty is correct".
//   └── `BackgroundSync`   -> whether this document has held content in this
//         session. Content-then-nothing is a deletion somebody performed;
//         never-any-content is an absence.
//
// AC4 IS THE POINT OF HALF THESE ROWS. A floor that refuses every empty write
// would be trivially "safe" and would also break select-all-and-delete, which
// is a thing users do and expect to propagate. Every refusal row below is
// paired with the corresponding ALLOW row.

import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../files/background-sync";
import {
  EMPTY_WRITE_DECISION,
  decideEmptyWrite,
  getEmptyWriteRefusals,
  resetEmptyWriteRefusals,
} from "../../files/empty-write-guard";
import { ManifestManager } from "../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../types";

const NOTE = "notes/hello.md";
const BODY = "the user's forty-nine bytes, more or less, right here.\n";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function vaultDouble(contents: Record<string, string>) {
  const files = new Map(Object.entries(contents));
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
    modify: vi.fn(async (f: { path: string }, c: string) => void files.set(f.path, c)),
    create: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    createFolder: vi.fn(async () => {}),
    adapter: {
      exists: vi.fn(async () => true),
      write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    },
  };
}

describe("S119 AC3 — the pure decision", () => {
  const base = { evidenceLabel: "test evidence" };

  it("refuses empty over non-empty when nothing vouches for it", () => {
    const v = decideEmptyWrite({ ...base, incoming: "", existing: BODY, intentional: false });
    expect(v.decision).toBe(EMPTY_WRITE_DECISION.REFUSE_NO_EVIDENCE);
    // The reason states the size at risk, so a log line is diagnostic.
    expect(v.reason).toContain(String(BODY.length));
  });

  it("AC4 — ALLOWS empty over non-empty when the emptiness is vouched for", () => {
    const v = decideEmptyWrite({ ...base, incoming: "", existing: BODY, intentional: true });
    expect(v.decision).toBe(EMPTY_WRITE_DECISION.ALLOW);
  });

  it("never blocks a non-empty write, whatever the evidence says", () => {
    // The floor is about emptiness only. A rule that could refuse real content
    // would be a sync bug of its own.
    for (const intentional of [true, false]) {
      const v = decideEmptyWrite({ ...base, incoming: "new text", existing: BODY, intentional });
      expect(v.decision).toBe(EMPTY_WRITE_DECISION.ALLOW);
    }
  });

  it("creating a new empty file, or re-emptying an empty one, destroys nothing", () => {
    expect(
      decideEmptyWrite({ ...base, incoming: "", existing: null, intentional: false }).decision,
    ).toBe(EMPTY_WRITE_DECISION.ALLOW);
    expect(
      decideEmptyWrite({ ...base, incoming: "", existing: "", intentional: false }).decision,
    ).toBe(EMPTY_WRITE_DECISION.ALLOW);
  });
});

describe("S119 AC3/AC4 — syncFromManifest, scoped by the host's own hash", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  async function run(options: { entryHash: string; docContent: string; onDisk: string }) {
    const vault = vaultDouble({ [NOTE]: options.onDisk });
    const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, clientId: "me", role: "guest" };
    const manager = new ManifestManager(vault as never, settings as never);
    const doc = new Y.Doc();
    const map = doc.getMap("files");
    map.set(NOTE, { hash: options.entryHash, size: 10, mtime: 1 });
    (manager as unknown as { manifest: unknown }).manifest = map;
    (manager as unknown as { syncManager: unknown }).syncManager = {
      getDoc: vi.fn(() => {
        const d = new Y.Doc();
        const text = d.getText("content");
        if (options.docContent) text.insert(0, options.docContent);
        return { doc: d, text, awareness: {} };
      }),
      waitForSync: vi.fn(async () => {}),
      releaseDoc: vi.fn(),
    };
    await manager.syncFromManifest();
    return vault;
  }

  it("🚨 THE INCIDENT IS NOW REFUSED — an empty doc no longer truncates the note", async () => {
    // The host says this file hashes to something real; the doc is empty. That
    // is this peer holding an absence, and it must not overwrite bytes.
    const vault = await run({
      entryHash: await sha256Hex("some real host content"),
      docContent: "",
      onDisk: BODY,
    });
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(vault.modify).not.toHaveBeenCalled();
    // AC5 — the refusal is counted, by arm.
    expect(getEmptyWriteRefusals().total).toBe(1);
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBe(1);
  });

  it("AC4 — a host that genuinely holds an EMPTY file still empties the guest's copy", async () => {
    // The legitimate case, and the one a naive "never write empty" floor breaks.
    // The host's published hash IS the hash of "", so emptiness is attested.
    const vault = await run({
      entryHash: await sha256Hex(""),
      docContent: "",
      onDisk: BODY,
    });
    expect(vault.files.get(NOTE)).toBe("");
    expect(getEmptyWriteRefusals().total).toBe(0);
  });

  it("VACUITY CONTROL — real content still syncs down the same path", async () => {
    const vault = await run({
      entryHash: await sha256Hex("the real content"),
      docContent: "the real content",
      onDisk: BODY,
    });
    expect(vault.files.get(NOTE)).toBe("the real content");
    expect(getEmptyWriteRefusals().total).toBe(0);
  });

  it("a HALF-REPLAYED doc is refused too — the hash is stronger than an emptiness test", async () => {
    // Content that is not empty but is also not what the host published. A bare
    // `content === ""` floor would wave this through; this one does not, and
    // that is why the evidence is a hash rather than a length.
    const vault = await run({
      entryHash: await sha256Hex("the whole note, all of it"),
      docContent: "",
      onDisk: BODY,
    });
    expect(vault.files.get(NOTE)).toBe(BODY);
  });
});

describe("S119 AC3/AC4 — the background-sync writer, scoped by session history", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  function makeSync(vault: ReturnType<typeof vaultDouble>) {
    const sync = new BackgroundSync(
      vault as never,
      { getDoc: vi.fn(() => null), waitForSync: vi.fn(async () => {}), releaseDoc: vi.fn() } as never,
      // constructor order: vault, syncManager, manifestManager, fileOpsManager
      { updateFile: vi.fn() } as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
    );
    return sync;
  }

  it("🚨 refuses to flush an empty doc over a note it has never seen content for", async () => {
    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = makeSync(vault);
    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "",
    );
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(vault.adapter.write).not.toHaveBeenCalled();
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);
  });

  it("AC4 — once the document HAS held content, emptying it reaches disk", async () => {
    // Select-all-and-delete. The peer saw the note's text, then saw it removed;
    // that transition is the evidence, and the deletion must propagate.
    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = makeSync(vault);
    (sync as unknown as { noteIfNonEmpty(p: string, c: string): void }).noteIfNonEmpty(NOTE, BODY);

    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "",
    );
    expect(vault.files.get(NOTE)).toBe("");
    expect(getEmptyWriteRefusals().total).toBe(0);
  });

  it("VACUITY CONTROL — a non-empty flush writes, with no evidence needed", async () => {
    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = makeSync(vault);
    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "replacement text",
    );
    expect(vault.files.get(NOTE)).toBe("replacement text");
  });

  it("the evidence does not survive the session", async () => {
    // `destroy()` ends the session. A document that held content then must not
    // vouch for an empty write in the next session, before anything has arrived.
    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = makeSync(vault);
    (sync as unknown as { noteIfNonEmpty(p: string, c: string): void }).noteIfNonEmpty(NOTE, BODY);
    sync.destroy();

    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "",
    );
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);
  });
});

describe("S119 AC5 — the ledger is readable and attributes the arm", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  it("counts by arm, so a validator can tell the two writers apart", async () => {
    expect(getEmptyWriteRefusals()).toEqual({ total: 0, byArm: {} });

    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = new BackgroundSync(
      vault as never,
      { getDoc: vi.fn(() => null), waitForSync: vi.fn(async () => {}), releaseDoc: vi.fn() } as never,
      // constructor order: vault, syncManager, manifestManager, fileOpsManager
      { updateFile: vi.fn() } as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
    );
    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "",
    );

    const ledger = getEmptyWriteRefusals();
    expect(ledger.total).toBe(1);
    expect(ledger.byArm).toEqual({ "doc-write": 1 });
    // The ledger records the ARM only — never a path, never content.
    expect(JSON.stringify(ledger)).not.toContain(NOTE);
    expect(JSON.stringify(ledger)).not.toContain("user's");
  });
});
