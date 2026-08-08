// S137 — A FLOOR WHOSE FIRINGS COULD NOT BE ATTRIBUTED.
//
// The empty-write floor fired TWICE during an ordinary rejoin, arm
// `manifest-sync`, with no gesture involved. The guard held and those bytes
// survived because of it. THE PATHS COULD NOT BE IDENTIFIED: the refusal went to
// `console.warn`, no console capture was attached, and the debug log — the one
// sink a validator reads after the fact — never heard about it. The live
// validator hit exactly that wall and could not say which files were nearly
// destroyed.
//
// The ledger was not the gap. `getEmptyWriteRefusals()` already reported
// `{ total: 2, byArm: { "manifest-sync": 2 } }` and that is what made the
// firings VISIBLE. What it cannot do, by construction and on purpose, is say
// WHICH FILE — a counter that stored paths would be a different and worse
// object. The missing thing was a log line.
//
// So: every refusal in this family now reaches the debug log with the PATH, the
// ARM and the REASON, from one shared emitter rather than a private idiom per
// call site. Six arms, one wording, one category.
//
// THIS PACKAGE DOES NOT EXPLAIN THE TWO FIRINGS, deliberately. Root-causing them
// needs a live rerun with a console listener and is another worker's scope. What
// is delivered is that the NEXT occurrence is diagnosable.
//
// EVERY ROW HERE HAS A POSITIVE CONTROL, because the absence of exactly this
// evidence is what made S137 unresolvable, and a green that could not have gone
// red would repeat that failure precisely.

import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import {
  EMPTY_WRITE_ARMS,
  EMPTY_WRITE_LOG_CATEGORY,
  emptyWriteRefusalMessage,
  getEmptyWriteRefusals,
  noteEmptyWriteRefusal,
  resetEmptyWriteRefusals,
} from "../../../files/empty-write-guard";
import { ManifestManager } from "../../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";

const NOTE = "_liveshare-test/hello.md";
const SECOND = "_liveshare-test/Properties.md";
const BODY = "the user's forty-nine bytes, more or less, right here.\n";

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A recording debug logger. THE ORACLE for every row in this file. */
function recordingLogger() {
  const lines: { category: string; message: string }[] = [];
  return {
    lines,
    warn(category: string, message: string) {
      lines.push({ category, message });
    },
    /** Just the empty-write refusals, in order. */
    refusals() {
      return lines.filter((l) => l.message.startsWith("EMPTY WRITE REFUSED:"));
    },
  };
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
    getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? handle(path) : null)),
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      files.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    createFolder: vi.fn(async () => {}),
    adapter: {
      exists: vi.fn(async () => true),
      write: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// B1 — the arm the live firings came from, driven for real.
// ---------------------------------------------------------------------------

describe("S137 B1 — the manifest-sync arm names the file it refused", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  /** The REAL `ManifestManager.syncFromManifest`, with a real `Y.Doc` per path. */
  async function run(
    entries: Record<string, { entryHash: string; docContent: string }>,
    onDisk: Record<string, string>,
    logger: ReturnType<typeof recordingLogger> | null,
  ) {
    const vault = vaultDouble(onDisk);
    const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, clientId: "me", role: "guest" };
    const manager = new ManifestManager(vault as never, settings as never);
    if (logger) manager.setLogger(logger);
    const doc = new Y.Doc();
    const map = doc.getMap("files");
    for (const [path, spec] of Object.entries(entries)) {
      map.set(path, { hash: spec.entryHash, size: 10, mtime: 1 });
    }
    (manager as unknown as { manifest: unknown }).manifest = map;
    (manager as unknown as { syncManager: unknown }).syncManager = {
      getDoc: vi.fn((path: string) => {
        const perPath = new Y.Doc();
        const text = perPath.getText("content");
        const content = entries[path]?.docContent ?? "";
        if (content) text.insert(0, content);
        return { doc: perPath, text, awareness: {} };
      }),
      waitForSync: vi.fn(async () => {}),
      releaseDoc: vi.fn(),
    };
    await manager.syncFromManifest();
    return vault;
  }

  it("🚨 THE LIVE SHAPE — a refusal on a plain rejoin reaches the debug log WITH the path", async () => {
    // Two files, both non-empty on disk, both arriving as empty documents whose
    // host hash says otherwise. That is S137's report, reproduced at the arm it
    // names: the floor fires twice and the validator must be able to say which
    // two files were nearly destroyed.
    const logger = recordingLogger();
    const vault = await run(
      {
        [NOTE]: { entryHash: await sha256Hex("real host content"), docContent: "" },
        [SECOND]: { entryHash: await sha256Hex("more real content"), docContent: "" },
      },
      { [NOTE]: BODY, [SECOND]: BODY },
      logger,
    );

    // The bytes survived — the floor is doing its job, which is the premise.
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(vault.files.get(SECOND)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBe(2);

    // …AND THE FIRINGS ARE NOW ATTRIBUTABLE. This is the whole package.
    const refusals = logger.refusals();
    expect(refusals).toHaveLength(2);
    const paths = refusals.map((line) => line.message);
    expect(paths.some((message) => message.includes(NOTE))).toBe(true);
    expect(paths.some((message) => message.includes(SECOND))).toBe(true);
    for (const line of refusals) {
      expect(line.category).toBe(EMPTY_WRITE_LOG_CATEGORY);
      expect(line.message).toContain("arm=manifest-sync");
      expect(line.message).toContain("reason=");
      // The reason states BYTE COUNTS and never bytes. A log line that carried
      // the file's content would be a different defect.
      expect(line.message).not.toContain(BODY);
    }
  });

  it("POSITIVE CONTROL — a sync with nothing to refuse logs NOTHING", async () => {
    // Without this row, the assertions above could pass against an emitter that
    // fires on every file, which would drown the signal it exists to carry.
    const logger = recordingLogger();
    const vault = await run(
      { [NOTE]: { entryHash: await sha256Hex("the real content"), docContent: "the real content" } },
      { [NOTE]: BODY },
      logger,
    );
    expect(vault.files.get(NOTE)).toBe("the real content");
    expect(getEmptyWriteRefusals().total).toBe(0);
    expect(logger.refusals()).toEqual([]);
  });

  it("POSITIVE CONTROL — the LEGITIMATE empty write still happens, and is not logged", async () => {
    // AC4's companion: a host that genuinely holds an empty file still empties
    // this peer's copy. A floor that logged here would be reporting correct
    // behaviour as a near-miss.
    const logger = recordingLogger();
    const vault = await run(
      { [NOTE]: { entryHash: await sha256Hex(""), docContent: "" } },
      { [NOTE]: BODY },
      logger,
    );
    expect(vault.files.get(NOTE)).toBe("");
    expect(logger.refusals()).toEqual([]);
  });

  it("an UNWIRED manager still refuses — the log is additive, never load-bearing", async () => {
    // S104's inverse hazard. If the sink were ever absent (an older wiring, a
    // harness, a future refactor that moves the `setLogger` call), the FLOOR
    // must still hold. Same run, no logger at all.
    const vault = await run(
      { [NOTE]: { entryHash: await sha256Hex("real host content"), docContent: "" } },
      { [NOTE]: BODY },
      null,
    );
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B2 — the sibling arm, same shape.
// ---------------------------------------------------------------------------

describe("S137 B2 — the doc-write arm uses the SAME emitter, not its own idiom", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  function makeSync(
    vault: ReturnType<typeof vaultDouble>,
    logger: ReturnType<typeof recordingLogger> | null,
  ) {
    const sync = new BackgroundSync(
      vault as never,
      {
        getDoc: vi.fn(() => null),
        waitForSync: vi.fn(async () => {}),
        releaseDoc: vi.fn(),
      } as never,
      { updateFile: vi.fn() } as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
    );
    if (logger) sync.setLogger(logger);
    return sync;
  }

  const flush = (sync: BackgroundSync, path: string, content: string) =>
    (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      path,
      content,
    );

  it("🚨 refusing to flush an empty doc names the path, the arm and the reason", async () => {
    const logger = recordingLogger();
    const vault = vaultDouble({ [NOTE]: BODY });
    await flush(makeSync(vault, logger), NOTE, "");

    expect(vault.files.get(NOTE)).toBe(BODY);
    const refusals = logger.refusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0].category).toBe(EMPTY_WRITE_LOG_CATEGORY);
    expect(refusals[0].message).toContain("arm=doc-write");
    expect(refusals[0].message).toContain(`path=${NOTE}`);
    expect(refusals[0].message).toContain("reason=");
  });

  it("the two arms produce the SAME line shape, differing only in the arm", async () => {
    // B2's actual requirement: one consistent shape, not a private logging idiom
    // per call site. Compared structurally rather than by eye — the two messages
    // must be identical once the arm token is normalised away.
    const logger = recordingLogger();
    const vault = vaultDouble({ [NOTE]: BODY });
    await flush(makeSync(vault, logger), NOTE, "");
    const docWrite = logger.refusals()[0].message;

    const shape = (message: string) => message.replace(/arm=[a-z-]+/, "arm=<ARM>");
    const built = emptyWriteRefusalMessage(
      "manifest-sync",
      NOTE,
      docWrite.slice(docWrite.indexOf("reason=") + "reason=".length),
    );
    expect(shape(built)).toBe(shape(docWrite));
  });

  it("POSITIVE CONTROL — an ALLOWED empty write (the real delete) logs nothing", async () => {
    // Select-all-and-delete, with the document's own history as evidence. The
    // write reaches disk and no refusal is reported. Without this the row above
    // could be satisfied by refusing everything.
    const logger = recordingLogger();
    const vault = vaultDouble({ [NOTE]: BODY });
    const sync = makeSync(vault, logger);
    (sync as unknown as { noteIfNonEmpty(p: string, c: string): void }).noteIfNonEmpty(NOTE, BODY);
    await flush(sync, NOTE, "");

    expect(vault.files.get(NOTE)).toBe("");
    expect(logger.refusals()).toEqual([]);
    expect(getEmptyWriteRefusals().total).toBe(0);
  });

  it("POSITIVE CONTROL — an ordinary non-empty flush logs nothing", async () => {
    const logger = recordingLogger();
    const vault = vaultDouble({ [NOTE]: BODY });
    await flush(makeSync(vault, logger), NOTE, "replacement text");
    expect(vault.files.get(NOTE)).toBe("replacement text");
    expect(logger.refusals()).toEqual([]);
  });

  it("an UNWIRED BackgroundSync still refuses — the log is additive", async () => {
    const vault = vaultDouble({ [NOTE]: BODY });
    await flush(makeSync(vault, null), NOTE, "");
    expect(vault.files.get(NOTE)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B3 — the emitter itself, and the closure of the arm set.
// ---------------------------------------------------------------------------

describe("S137 B3 — one emitter, one wording, a closed arm set", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  it("the emitter counts, logs and returns the same string it logged", () => {
    const logger = recordingLogger();
    const returned = noteEmptyWriteRefusal("manifest-sync", NOTE, "because reasons", logger);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0].message).toBe(returned);
    expect(returned).toBe(emptyWriteRefusalMessage("manifest-sync", NOTE, "because reasons"));
    expect(getEmptyWriteRefusals()).toEqual({ total: 1, byArm: { "manifest-sync": 1 } });
  });

  it("the LEDGER still stores no path — the path belongs in the line, not the counter", () => {
    // The two observables answer different questions and must keep doing so. A
    // counter that accumulated paths would grow without bound and would put user
    // filenames into every diagnostic that renders it.
    noteEmptyWriteRefusal("doc-write", NOTE, "because reasons", null);
    expect(JSON.stringify(getEmptyWriteRefusals())).not.toContain(NOTE);
  });

  it("every named arm produces a well-formed, greppable line", () => {
    // Derived over `EMPTY_WRITE_ARMS` rather than hand-listed, so a third arm
    // added tomorrow is covered on the day it is added.
    for (const arm of EMPTY_WRITE_ARMS) {
      const message = emptyWriteRefusalMessage(arm, NOTE, "r");
      expect(message.startsWith("EMPTY WRITE REFUSED: ")).toBe(true);
      expect(message).toContain(`arm=${arm}`);
      expect(message).toContain(`path=${NOTE}`);
    }
  });

  it("the arm set is exactly the set of production call sites", async () => {
    // S89's lesson, at the smallest scale that still bites: a named set that
    // nothing compares against the code is a comment. Read from the two modules
    // that hold the callers.
    const { readFileSync } = await import("node:fs");
    const read = (relative: string) =>
      readFileSync(
        new URL(relative, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
        "utf8",
      );
    const sources = read("../../../files/manifest.ts") + read("../../../files/background-sync.ts");
    const called = new Set(
      [...sources.matchAll(/noteEmptyWriteRefusal\(\s*"([a-z-]+)"/g)].map((m) => m[1]),
    );
    expect([...called].sort()).toEqual([...EMPTY_WRITE_ARMS].sort());
    // POSITIVE CONTROL: the regex really did match something.
    expect(called.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B1 — THE WIRING, and this row is the one S104 says has to exist.
// ---------------------------------------------------------------------------

describe("S137 B1 — the sinks are wired AFTER the logger exists", () => {
  /**
   * Every row above hands the logger in by hand, so all of them would stay green
   * against a `main.ts` that never wires it — which is EXACTLY the shape of
   * S104: `fileOpsManager.setLogger(this.logger)` sat fifteen lines above
   * `this.logger = new DebugLogger(...)`, the `!` on the field silenced `tsc`,
   * the `?.` at the emitters silenced the crash, and two signatures were
   * unreachable for the plugin's entire history.
   *
   * An INDEX COMPARISON rather than a byte pin (S88): this file is shared and a
   * whole-file or line-number assertion reds on anybody else's edit. What is
   * asserted is the only thing that matters — the order.
   */
  const source = (() => {
    // Imported here rather than at module scope so the rest of the file loads
    // without touching the filesystem.
    // biome-ignore lint/correctness/noNodejsModules: a derived source check
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return readFileSync(
      new URL("../../../main.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    );
  })();

  const sinkExists = source.indexOf("this.logger = new DebugLogger(");

  it("POSITIVE CONTROL — the two managers are CONSTRUCTED before the sink exists", () => {
    // This is why the naive placement is wrong and why the order has to be
    // asserted rather than assumed. If this ever goes false the hazard is gone
    // and the rows below become trivially true — so it is stated, not implied.
    expect(sinkExists).toBeGreaterThan(0);
    expect(source.indexOf("new ManifestManager(")).toBeLessThan(sinkExists);
    expect(source.indexOf("this.backgroundSync = new BackgroundSync(")).toBeLessThan(sinkExists);
  });

  for (const call of [
    "this.manifestManager.setLogger(this.logger)",
    "this.backgroundSync.setLogger(this.logger)",
  ]) {
    it(`\`${call}\` is wired, and BELOW the DebugLogger assignment`, () => {
      const at = source.indexOf(call);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeGreaterThan(sinkExists);
    });
  }
});

// ---------------------------------------------------------------------------
// B2 — the sibling FAMILY: the protected-path arms that counted and never said.
// ---------------------------------------------------------------------------

describe("S137 B2 — the protected-path arms in these modules now say so too", () => {
  it("the doc-write protected refusal reaches the log", async () => {
    const logger = recordingLogger();
    const vault = vaultDouble({});
    const sync = new BackgroundSync(
      vault as never,
      {
        getDoc: vi.fn(() => null),
        waitForSync: vi.fn(async () => {}),
        releaseDoc: vi.fn(),
      } as never,
      { updateFile: vi.fn() } as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
    );
    sync.setLogger(logger);

    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      ".obsidian/plugins/live-share/main.js",
      "anything",
    );

    // Nothing was written — the guard is unchanged — and it is now audible.
    expect(vault.adapter.write).not.toHaveBeenCalled();
    expect(
      logger.lines.some((line) => line.message.startsWith("PROTECTED PATH REFUSED:")),
    ).toBe(true);
    expect(
      logger.lines.some((line) => line.message.includes("arm=doc-write")),
    ).toBe(true);
  });

  it("POSITIVE CONTROL — an ordinary path writes and logs no refusal", async () => {
    const logger = recordingLogger();
    const vault = vaultDouble({});
    const sync = new BackgroundSync(
      vault as never,
      {
        getDoc: vi.fn(() => null),
        waitForSync: vi.fn(async () => {}),
        releaseDoc: vi.fn(),
      } as never,
      { updateFile: vi.fn() } as never,
      { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
    );
    sync.setLogger(logger);

    await (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      "ordinary content",
    );
    expect(vault.adapter.write).toHaveBeenCalled();
    expect(
      logger.lines.some((line) => line.message.startsWith("PROTECTED PATH REFUSED:")),
    ).toBe(false);
  });
});
