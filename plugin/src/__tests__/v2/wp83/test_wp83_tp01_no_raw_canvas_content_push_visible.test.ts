// WP83 / C83 AC1 — "a shared `.canvas` never leaves this peer as raw content on
// the file-op channel."
//
// WHAT THIS FILE IS AND IS NOT. The AC's primary evidence is LIVE, on two real
// Obsidian instances (`H:\tmp\liveshare_wp83_e2e.py`), because the defect is a
// wire behaviour between peers and a headless double cannot observe a wire. What
// a live instance CANNOT honestly produce is a deterministic, per-path, per-op
// enumeration of what the emitter does — the rig can tell you a file arrived,
// not which of the four op shapes carried it. That is the row this file carries,
// and it carries no other.
//
// THE DEFECT, precisely, because the run has already propagated a wrong version
// of it: `onFileCreate` pushes `{type:"create", path, content}` — the whole file
// — and the receiver applies it with `vault.modify` / `vault.create` under a
// path mute. It is a RAW, UNMERGED, LAST-WRITER-WINS OVERWRITE of a file
// `CanvasSync` owns, invisible to the doc. It is NOT a second `Y.Text`; no CRDT
// is created by this path at all.
//
// ANTI-VACUITY. "No `create` op was emitted" is on its own also true of a broken
// double, a renamed method, or an early return upstream. Every negative row here
// is therefore paired, in the same test, with a POSITIVE row driven through the
// same manager and the same sender: an ordinary `.md` created in the same folder
// still emits its `create`. A guard that refused everything would fail these.

import { TFile } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { SIDECAR_DIR } from "../../../files/canvas-sidecar";
import { FileOpsManager } from "../../../files/file-ops";
import type { FileOp } from "../../../types";

function tfile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  (file as unknown as { extension: string }).extension = path.split(".").pop() ?? "";
  return file;
}

const CANVAS_BYTES = JSON.stringify({
  nodes: [{ id: "n1", type: "text", text: "board", x: 0, y: 0, width: 200, height: 100 }],
  edges: [],
});

function harness() {
  const reads: string[] = [];
  const vault = {
    getAbstractFileByPath: () => null,
    create: async () => ({}),
    createBinary: async () => ({}),
    modify: async () => {},
    modifyBinary: async () => {},
    rename: async () => {},
    createFolder: async () => ({}),
    read: async (file: { path: string }) => {
      reads.push(file.path);
      return CANVAS_BYTES;
    },
    readBinary: async (file: { path: string }) => {
      reads.push(file.path);
      return new ArrayBuffer(8);
    },
  };
  const fileManager = { trashFile: async () => {} };
  const manager = new FileOpsManager(vault as never, fileManager as never);
  const sent: FileOp[] = [];
  manager.setSender((op) => sent.push(op));
  return { manager, sent, reads };
}

describe("WP83 AC1 — the create-content push is refused for a path CanvasSync owns", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it("a shared `.canvas` emits NO op at all — and an ordinary `.md` in the same folder still does", async () => {
    await h.manager.onFileCreate(tfile("_liveshare-test/board.canvas"));

    // The row that is RED on the unrepaired tree.
    expect(
      h.sent,
      "onFileCreate emitted an op for a `.canvas`. The `create` op carries the " +
        "whole file, and the receiver applies it with vault.modify/vault.create " +
        "under a path mute — a raw, unmerged, last-writer-wins overwrite of a " +
        "path CanvasSync owns that the doc is never told about.",
    ).toEqual([]);

    // POSITIVE CONTROL, same manager, same sender: the channel is not closed.
    await h.manager.onFileCreate(tfile("_liveshare-test/note.md"));
    expect(
      h.sent.map((op) => op.type),
      "an ordinary markdown create stopped propagating — the guard is a " +
        "lobotomy, not a fix",
    ).toEqual(["create"]);
    expect(h.sent[0]).toMatchObject({
      type: "create",
      path: "_liveshare-test/note.md",
      content: CANVAS_BYTES,
    });
  });

  it("the refusal happens BEFORE the file is read — no content is even assembled", async () => {
    await h.manager.onFileCreate(tfile("_liveshare-test/board.canvas"));
    expect(
      h.reads,
      "the canvas was read off disk before the refusal. The refusal must be of " +
        "the content push, taken before the read, not a discarded payload.",
    ).toEqual([]);

    await h.manager.onFileCreate(tfile("_liveshare-test/note.md"));
    expect(h.reads, "the positive control was not read either — the double is broken").toEqual([
      "_liveshare-test/note.md",
    ]);
  });

  it("a sidecar path emits nothing either — the guard is the WHOLE shared predicate, not a `.canvas` test", async () => {
    // The predicate has two disjoint clauses. A private `endsWith(".canvas")` at
    // this seam would satisfy every other row in this file and fail this one.
    await h.manager.onFileCreate(tfile(`${SIDECAR_DIR}/index.json`));
    expect(
      h.sent,
      "a sidecar file was pushed as shared content. The guard at this seam is " +
        "not the shared predicate — it is a private `.canvas` test, which is " +
        "exactly the propagation pattern the predicate exists to stop.",
    ).toEqual([]);

    await h.manager.onFileCreate(tfile("_liveshare-test/note.md"));
    expect(h.sent.map((op) => op.type)).toEqual(["create"]);
  });

  it("FOLDER creates are untouched — the refusal is of the content push and nothing else", async () => {
    // Not a TFile: `onFileCreate`'s folder branch runs above the guard and must
    // keep running. A blanket early return on the method would break this.
    await h.manager.onFileCreate({ path: "_liveshare-test/sub" } as never);
    expect(h.sent).toEqual([{ type: "folder-create", path: "_liveshare-test/sub" }]);
  });

  it("a folder whose NAME ends in `.canvas` still emits its folder-create", async () => {
    // The guard sits after the folder branch on purpose. If it were moved above
    // it, a folder named `x.canvas` would silently stop propagating — a
    // behaviour change for a path this WP has no business touching.
    await h.manager.onFileCreate({ path: "_liveshare-test/weird.canvas" } as never);
    expect(h.sent).toEqual([{ type: "folder-create", path: "_liveshare-test/weird.canvas" }]);
  });

  it("delete and rename of a `.canvas` are BYTE-UNCHANGED — they carry no content and are out of scope", async () => {
    // Named out of scope by the charter (S43). This row exists so that widening
    // into them later is a deliberate act with a failing test, not a drift.
    h.manager.onFileDelete(tfile("_liveshare-test/board.canvas"));
    h.manager.onFileRename(tfile("_liveshare-test/new.canvas"), "_liveshare-test/old.canvas");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.sent).toEqual([
      { type: "delete", path: "_liveshare-test/board.canvas" },
      {
        type: "rename",
        oldPath: "_liveshare-test/old.canvas",
        newPath: "_liveshare-test/new.canvas",
      },
    ]);
  });
});
