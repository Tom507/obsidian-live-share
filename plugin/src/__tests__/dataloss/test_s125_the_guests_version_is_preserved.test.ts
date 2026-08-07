// S125 — THE GUEST'S VERSION IS PRESERVED BEFORE THE HOST'S OVERWRITES IT.
//
// `syncFromManifest` hashes the guest's local file against the host's manifest
// entry and, on any difference, writes the host's content over it. No merge, no
// conflict copy, no warning — and the notice read "synced N file(s)", which
// looks like success. Reachable by the most ordinary sequence the product
// supports: close Obsidian, edit a shared note, reopen with `autoReconnect`.
//
// THE COVERAGE GAP IS AS MUCH THE FINDING AS THE FIX. Before this file, every
// `syncFromManifest` test in the suite was about sidecar exclusion or manifest
// bookkeeping. NOTHING anywhere asserted what became of divergent local
// content — the defect was not missed by a weak assertion, it was missed
// because no test ever put a locally-edited file in front of that write.
//
// HOST AUTHORITY IS UNCHANGED. The overwrite still happens and the session
// still proceeds; a copy is placed beside the share first. Every row below
// asserts BOTH halves, because a "fix" that stopped the overwrite would be a
// different product, not a safer one.

import { readFileSync } from "node:fs";
import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CONFLICT_PRESERVATION,
  conflictCopyPath,
  conflictsRootFor,
  getConflictCopies,
  decideConflictPreservation,
  isConflictsPath,
  resetConflictCopies,
} from "../../files/conflict-copy";
import { ManifestManager } from "../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../types";

const SHARE = "_liveshare-test";
const NOTE = `${SHARE}/hello.md`;
const NESTED = `${SHARE}/sub/deep.md`;
const GUEST_TEXT = "the guest's own edits, made while offline\n";
const HOST_TEXT = "the host's version\n";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function vaultDouble(contents: Record<string, string>, mtime = 2_000) {
  const files = new Map(Object.entries(contents));
  const folders = new Set<string>();
  const handles = new Map<string, TFile>();
  const handle = (path: string) => {
    let f = handles.get(path);
    if (!f) {
      f = new TFile();
      f.path = path;
      // S125 — the gate compares this against `lastSessionEndedAt`.
      f.stat = { size: 1, mtime, ctime: 1 };
      handles.set(path, f);
    }
    return f;
  };
  return {
    files,
    folders,
    getFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAllLoadedFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? handle(p) : null)),
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    readBinary: vi.fn(async () => new TextEncoder().encode("BINARY").buffer),
    modify: vi.fn(async (f: { path: string }, c: string) => void files.set(f.path, c)),
    create: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    createBinary: vi.fn(async (p: string) => void files.set(p, "<binary>")),
    createFolder: vi.fn(async (p: string) => void folders.add(p)),
    adapter: { exists: vi.fn(async () => false) },
  };
}

async function runSync(options: {
  files: Record<string, string>;
  manifest: Record<string, { hash: string; size: number; mtime: number; binary?: boolean }>;
  docContent?: Record<string, string>;
  sharedFolder?: string;
  /** Default: the file was edited AFTER the last session ended (the guest's edit). */
  mtime?: number;
  lastSessionEndedAt?: number;
}) {
  const vault = vaultDouble(options.files, options.mtime ?? 2_000);
  const settings: LiveShareSettings = {
    ...DEFAULT_SETTINGS,
    clientId: "guest",
    role: "guest",
    sharedFolder: options.sharedFolder ?? SHARE,
    lastSessionEndedAt: options.lastSessionEndedAt ?? 1_000,
  };
  const manager = new ManifestManager(vault as never, settings as never);
  const doc = new Y.Doc();
  const map = doc.getMap("files");
  for (const [p, e] of Object.entries(options.manifest)) map.set(p, e);
  (manager as unknown as { manifest: unknown }).manifest = map;
  (manager as unknown as { syncManager: unknown }).syncManager = {
    getDoc: vi.fn((p: string) => {
      const d = new Y.Doc();
      const text = d.getText("content");
      const c = options.docContent?.[p];
      if (c) text.insert(0, c);
      return { doc: d, text, awareness: {} };
    }),
    waitForSync: vi.fn(async () => {}),
    releaseDoc: vi.fn(),
  };
  const synced = await manager.syncFromManifest();
  return { vault, manager, synced };
}

describe("S125 — the path nothing in the suite exercised: divergent local content", () => {
  beforeEach(() => resetConflictCopies());

  it("🚨 the guest's version is copied aside, and the host still wins", async () => {
    const { vault, manager } = await runSync({
      files: { [NOTE]: GUEST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
    });

    // HOST AUTHORITY — unchanged. This half must never regress.
    expect(vault.files.get(NOTE)).toBe(HOST_TEXT);

    // PRESERVATION — the guest's bytes still exist, beside the share.
    const copies = [...vault.files.keys()].filter((p) => p.startsWith(`${SHARE} (conflicts)/`));
    expect(copies).toHaveLength(1);
    expect(vault.files.get(copies[0] as string)).toBe(GUEST_TEXT);

    // AC10 — counted, and reported for the join notice.
    expect(getConflictCopies().total).toBe(1);
    expect(getConflictCopies().byArm.text).toBe(1);
    expect(manager.getLastSyncConflictCopies()).toBe(1);
  });

  it("AC6 — a file being CREATED destroys nothing, so no copy is written", async () => {
    const { vault } = await runSync({
      files: {},
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
    });
    expect(vault.files.get(NOTE)).toBe(HOST_TEXT);
    expect([...vault.files.keys()].some((p) => p.includes("(conflicts)"))).toBe(false);
    expect(getConflictCopies().total).toBe(0);
  });

  it("AC6 — a file whose hash already MATCHES is never touched and never copied", async () => {
    const { vault } = await runSync({
      files: { [NOTE]: HOST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
    });
    expect(vault.modify).not.toHaveBeenCalled();
    expect(getConflictCopies().total).toBe(0);
  });

  it("AC6 — when the S119 floor REFUSES the write, no copy is littered either", async () => {
    // Order matters: refuse first, then copy, then write. Nothing is being
    // destroyed on a refusal, and writing a copy there would strew the vault
    // with duplicates on every empty-doc join.
    const { vault } = await runSync({
      files: { [NOTE]: GUEST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: {}, // the doc arrives EMPTY — S119's window
    });
    expect(vault.files.get(NOTE)).toBe(GUEST_TEXT); // S119 floor held
    expect([...vault.files.keys()].some((p) => p.includes("(conflicts)"))).toBe(false);
    expect(getConflictCopies().total).toBe(0);
  });

  it("AC9 — structure is mirrored and the name is stamped", async () => {
    const { vault } = await runSync({
      files: { [NESTED]: GUEST_TEXT },
      manifest: { [NESTED]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NESTED]: HOST_TEXT },
    });
    const copy = [...vault.files.keys()].find((p) => p.includes("(conflicts)")) as string;
    // Relative structure survives — a share with subfolders must not collapse.
    expect(copy.startsWith(`${SHARE} (conflicts)/sub/`)).toBe(true);
    expect(copy.endsWith(".md")).toBe(true);
    expect(copy).toMatch(/deep \(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.md$/);
  });

  it("AC11 — a BINARY's local version is preserved too", async () => {
    const { vault } = await runSync({
      files: { [`${SHARE}/photo.png`]: "the guest's photo" },
      manifest: {
        [`${SHARE}/photo.png`]: { hash: "different", size: 1, mtime: 1, binary: true },
      },
    });
    expect(vault.createBinary).toHaveBeenCalled();
    expect(getConflictCopies().byArm.binary).toBe(1);
  });
});

describe("S125 AC9 — a second conflict never overwrites the first", () => {
  it("two copies of the same path coexist", () => {
    // The stamp is what makes this true, and a preservation feature that
    // overwrote its own previous copy would be the defect it exists to fix.
    const a = conflictCopyPath(NOTE, SHARE, new Date(2026, 7, 7, 17, 42, 3));
    const b = conflictCopyPath(NOTE, SHARE, new Date(2026, 7, 7, 17, 42, 4));
    expect(a).not.toBe(b);
    expect(a).toBe(`${SHARE} (conflicts)/hello (2026-08-07 17-42-03).md`);
    expect(b).toBe(`${SHARE} (conflicts)/hello (2026-08-07 17-42-04).md`);
  });

  it("an extensionless file and a dotfile keep their names intact", () => {
    expect(conflictCopyPath(`${SHARE}/LICENSE`, SHARE, new Date(2026, 7, 7, 1, 2, 3))).toBe(
      `${SHARE} (conflicts)/LICENSE (2026-08-07 01-02-03)`,
    );
    // A leading dot is not an extension.
    expect(conflictCopyPath(`${SHARE}/.env`, SHARE, new Date(2026, 7, 7, 1, 2, 3))).toBe(
      `${SHARE} (conflicts)/.env (2026-08-07 01-02-03)`,
    );
  });
});

describe("S125 AC7/AC8 — the conflicts folder is excluded by an OWNED rule", () => {
  function managerFor(sharedFolder: string) {
    return new ManifestManager(vaultDouble({}) as never, {
      ...DEFAULT_SETTINGS,
      sharedFolder,
    } as never);
  }

  it("AC7 — a conflicts path is never shared, even sitting inside the share's parent", () => {
    const m = managerFor(SHARE);
    expect(m.isSharedPath(`${SHARE} (conflicts)/hello (2026-01-01 00-00-00).md`)).toBe(false);
    // …while the share itself still is, so the rule is not refusing everything.
    expect(m.isSharedPath(NOTE)).toBe(true);
  });

  it("AC8 — with a WHOLE-VAULT share the root folder is still excluded", () => {
    // This is the case a positional exclusion cannot express: everything is
    // inside the share, so "beside it" does not exist. The owned rule still
    // answers.
    const m = managerFor("");
    expect(conflictsRootFor("")).toBe("Live Share (conflicts)");
    expect(m.isSharedPath("Live Share (conflicts)/hello (2026-01-01 00-00-00).md")).toBe(false);
    expect(m.isSharedPath("anything/else.md")).toBe(true);
  });

  it("AC7 — the exclusion also holds for the S115 remote-root predicate", () => {
    // `isWithinSharedRoot` is what scopes the stale reconcile. A conflict copy
    // must not become a deletion candidate there either.
    const m = managerFor(SHARE);
    expect(m.isWithinSharedRoot(`${SHARE} (conflicts)/hello (2026-01-01 00-00-00).md`, "")).toBe(
      false,
    );
  });

  it("AC7 — a manifest that names the conflicts folder cannot pull it into the share", async () => {
    // Putting the folder in the manifest's way, as the charter asks. A hostile
    // or confused host publishing an entry under the conflicts root must not
    // make it shared.
    const m = managerFor(SHARE);
    expect(m.isSharedPath(`${SHARE} (conflicts)/anything.md`)).toBe(false);
    expect(isConflictsPath(`${SHARE} (conflicts)/anything.md`, SHARE)).toBe(true);
    // A folder merely NAMED similarly elsewhere is not caught — the rule is a
    // path test, not a substring test.
    expect(isConflictsPath("notes/my (conflicts) archive.md", SHARE)).toBe(false);
  });
});

describe("S125 AC6a — only what the GUEST changed offline is preserved", () => {
  beforeEach(() => resetConflictCopies());

  it("a file edited AFTER the last session ended is preserved", async () => {
    const { vault } = await runSync({
      files: { [NOTE]: GUEST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
      lastSessionEndedAt: 1_000,
      mtime: 2_000,
    });
    expect(vault.files.get(NOTE)).toBe(HOST_TEXT);
    expect(getConflictCopies().total).toBe(1);
  });

  it("a MERELY STALE file is overwritten silently, with no copy", async () => {
    // The host edited while we were away; the guest never touched this file.
    // Copying it would fill the folder with versions nobody wrote, which is what
    // makes such a folder go unread.
    const { vault } = await runSync({
      files: { [NOTE]: GUEST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
      lastSessionEndedAt: 5_000,
      mtime: 2_000,
    });
    // Host authority unchanged — the overwrite still happens.
    expect(vault.files.get(NOTE)).toBe(HOST_TEXT);
    expect([...vault.files.keys()].some((p) => p.includes("(conflicts)"))).toBe(false);
    expect(getConflictCopies().total).toBe(0);
  });
});

describe("S125 AC6b — EVERY uncertain input preserves (the fail-safe direction)", () => {
  // The criterion the charter cares most about: a bug here silently discards
  // the user's work. Each row is a DEMONSTRATED branch, not an argued one.
  const EDITED = 2_000;

  it.each([
    ["never recorded (first run)", 0],
    ["absent", undefined],
    ["null", null],
    ["NaN", Number.NaN],
    ["negative", -1],
    ["a string (corrupted settings)", "yesterday"],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("an unusable lastSessionEndedAt (%s) preserves", (_label, value) => {
    const v = decideConflictPreservation({ mtime: EDITED, lastSessionEndedAt: value });
    expect(v.decision).toBe(CONFLICT_PRESERVATION.PRESERVE);
  });

  it("a session end in the FUTURE preserves — the clock cannot be reasoned about", () => {
    const v = decideConflictPreservation({
      mtime: EDITED,
      lastSessionEndedAt: 9_000,
      now: 5_000,
    });
    expect(v.decision).toBe(CONFLICT_PRESERVATION.PRESERVE);
    expect(v.reason).toContain("future");
  });

  it.each([
    ["absent", undefined],
    ["zero", 0],
    ["NaN", Number.NaN],
  ])("an unusable file mtime (%s) preserves", (_label, value) => {
    const v = decideConflictPreservation({ mtime: value, lastSessionEndedAt: 1_000 });
    expect(v.decision).toBe(CONFLICT_PRESERVATION.PRESERVE);
  });

  it("VACUITY CONTROL — the discard branch is reachable, so the rows above mean something", () => {
    // Without this, every row could be passing because the function always
    // preserves, and the gate would be inert.
    const v = decideConflictPreservation({
      mtime: 1_000,
      lastSessionEndedAt: 5_000,
      now: 9_000,
    });
    expect(v.decision).toBe(CONFLICT_PRESERVATION.DISCARD);
  });

  it("an unknown stamp preserves END-TO-END, not only in the pure function", async () => {
    // The wiring, not just the decision. A file that predates the (unusable)
    // stamp must still be copied.
    const { vault } = await runSync({
      files: { [NOTE]: GUEST_TEXT },
      manifest: { [NOTE]: { hash: await sha256Hex(HOST_TEXT), size: 1, mtime: 1 } },
      docContent: { [NOTE]: HOST_TEXT },
      lastSessionEndedAt: 0,
      mtime: 1,
    });
    expect(vault.files.get(NOTE)).toBe(HOST_TEXT);
    expect(getConflictCopies().total).toBe(1);
  });
});

describe("S125 AC6c — every session-end path stamps, derived from the source", () => {
  // The S116 B14 lesson: the behaviour tests above all inject
  // `lastSessionEndedAt` directly, so none of them would notice if nothing ever
  // WROTE it. Then the gate would preserve everything forever — safe, and
  // inert. Derived from `main.ts` so it tracks the file.
  const source = readFileSync(
    new URL("../../main.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "utf8",
  );

  // NOTE the wording: this row deliberately does NOT spell the name of the
  // session-ending method that calls `cleanupSession`. `wp88`'s Rule 15 guard
  // asserts that no test outside itself contains that literal, using a fixed
  // substring match with a hardcoded one-file allow-list — a crude detector on
  // purpose. A passing mention here in prose would have reddened a guard that
  // has nothing to do with this package. Avoided rather than "fixed" by
  // widening someone else's absence claim.
  it("cleanupSession stamps, and it is the choke point for both of its callers", () => {
    const body = source.slice(source.indexOf("cleanupSession() {"));
    expect(body.slice(0, 600)).toContain("this.stampSessionEnd();");
    // Exactly two callers, both genuine session ends.
    expect([...source.matchAll(/this\.cleanupSession\(\);/g)]).toHaveLength(2);
  });

  it("onunload stamps too, because it does NOT call cleanupSession", () => {
    const body = source.slice(source.indexOf("async onunload() {"));
    const head = body.slice(0, 900);
    expect(head).toContain("stampSessionEnd()");
    // The reason this separate call is needed: if `onunload` ever starts
    // calling `cleanupSession`, this assertion should be revisited rather than
    // silently double-stamping.
    expect(head).not.toContain("this.cleanupSession();");
  });

  it("the stamp writes the settings field and persists it", () => {
    const body = source.slice(source.indexOf("private stampSessionEnd(): void {"));
    expect(body.slice(0, 300)).toContain("this.settings.lastSessionEndedAt = Date.now();");
    expect(body.slice(0, 300)).toContain("saveSettings()");
  });
});
