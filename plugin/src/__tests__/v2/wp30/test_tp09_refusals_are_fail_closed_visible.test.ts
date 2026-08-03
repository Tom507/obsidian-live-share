// WP30 / AC3 + invariant I11 — every refusal is fail-closed, and none of them is
// a silent no-op.
//
// AC3's "no write of any kind" is tested on the CANCEL path in tp05. This file
// covers the other four ways an import can decline, and adds the half that
// "wrote nothing" does not cover on its own: THE USER MUST BE ABLE TO TELL.
// A destruction the user asked for and that did not happen is not a success, and
// a mechanism that swallows its own refusal leaves them believing the board was
// replaced when it was not.
//
// THE FOURTH ARM IS THE INTERESTING ONE. WP28's `conflictCopyPath` is
// day-granular, so two conflicts on the same board on the same day resolve to
// the SAME filename — and `CanvasSync.writeConflictCopy` therefore NEVER
// CLOBBERS: an identical body is an idempotent re-run and succeeds, anything
// else throws. Because the mechanism is fail-closed, that refusal also CANCELS
// THE ADOPTION. So a perfectly ordinary second import on a busy day can end with
// the board unchanged, and the only acceptable outcome is: nothing written,
// nothing half-written, the previous archive intact, and the user told. A
// refusal that returned a cheerful "imported" here would be worse than a crash,
// because the user would close the dialog believing their file had landed.
//
// PRODUCTION LINE <-> ASSERTION: the source guard before `env.confirm` and the
// `try`/`catch` around `await env.adoptEpochWinner(...)` in
// `plugin/src/files/canvas-import.ts`. Letting the rejection escape reddens
// `a refused archive is reported, not thrown`; swallowing it into
// `status: IMPORTED` reddens `a refused archive is not reported as a success`;
// dropping the JSON guard reddens `an unparseable file is refused`.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readEpoch } from "../../../canvas/canvas-epoch";
import { IMPORT_UNAVAILABLE } from "../../../canvas/canvas-import-command";
import { IMPORT_STATUS, runImportFromFile } from "../../../files/canvas-import";
import {
  CANVAS_PATH,
  canvasJson,
  createImportHarness,
  projection,
  textNode,
  totalWrites,
} from "./harness";

const LIVE_NODES = [textNode("live-1", 0, "one"), textNode("live-2", 40, "two")];
const FILE_TEXT = canvasJson([textNode("file-a", 0, "alpha")]);

describe("WP30 tp09 — every refusal is fail-closed and legible", () => {
  it("an unavailable path is refused before anything is even read", async () => {
    const harness = createImportHarness({
      availability: { owned: false, degraded: false },
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.UNAVAILABLE);
    expect(result.unavailableReason).toBe(IMPORT_UNAVAILABLE.UNOWNED);
    expect(harness.reads).toEqual([]);
    expect(harness.confirmCalls).toEqual([]);
    expect(totalWrites(harness)).toBe(0);
  });

  it("a missing or unreadable file is refused without a dialog", async () => {
    const harness = createImportHarness({
      liveNodes: LIVE_NODES,
      fileText: null,
      answer: true,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.NO_SOURCE);
    expect(harness.confirmCalls).toEqual([]);
    expect(totalWrites(harness)).toBe(0);
  });

  it("an unparseable file is refused rather than read as an empty board", async () => {
    // The dangerous coercion. `parseCanvas` swallows a JSON error and returns
    // EMPTY records, so an import that trusted it would read a truncated or
    // corrupt file as "the user wants an empty board" and publish a wholesale
    // replacement that deletes everything.
    for (const text of ["{ not json", "", "null", "[]", '{"nodes":"a"}']) {
      const harness = createImportHarness({
        liveNodes: LIVE_NODES,
        fileText: text,
        answer: true,
      });

      const result = await runImportFromFile(CANVAS_PATH, harness.env);

      expect(result.status, JSON.stringify(text)).toBe(IMPORT_STATUS.NO_SOURCE);
      expect(harness.confirmCalls, JSON.stringify(text)).toEqual([]);
      expect(totalWrites(harness), JSON.stringify(text)).toBe(0);
      expect(projection(harness.liveDoc as Y.Doc).nodes, JSON.stringify(text)).toEqual([
        "live-1",
        "live-2",
      ]);
    }
  });

  it("a legitimately EMPTY canvas file is not a refusal — it empties the board", async () => {
    // The control for the arm above. `{"nodes":[],"edges":[]}` is a valid board
    // with nothing on it, and emptying a board is a thing a user may ask for.
    // Refusing it would make the two cases indistinguishable and would let an
    // implementation pass the corruption arm by refusing everything small.
    const harness = createImportHarness({
      liveEpoch: 2,
      liveNodes: LIVE_NODES,
      fileText: canvasJson([]),
      answer: true,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(projection(harness.liveDoc as Y.Doc)).toEqual({ nodes: [], edges: [] });
  });

  it("a refused archive is reported, not thrown", async () => {
    const attempts: string[] = [];
    const harness = createImportHarness({
      liveEpoch: 5,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
      writeConflictCopy: async (path: string) => {
        attempts.push(path);
        throw new Error(
          `canvas-epoch: ${path} already exists with different content - refusing to overwrite an existing conflict copy`,
        );
      },
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(attempts).toHaveLength(1);
    expect(result.status).toBe(IMPORT_STATUS.ADOPTION_REFUSED);
  });

  it("a refused archive leaves the live board exactly as it was", async () => {
    const harness = createImportHarness({
      liveEpoch: 5,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
      writeConflictCopy: async () => {
        throw new Error("refusing to overwrite an existing conflict copy");
      },
    });
    const live = harness.liveDoc as Y.Doc;
    const stateBefore = Y.encodeStateVector(live);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.liveUpdateOrigins).toEqual([]);
    expect(projection(live)).toEqual({ nodes: ["live-1", "live-2"], edges: [] });
    expect(readEpoch(live)).toBe(5);
    expect(Array.from(Y.encodeStateVector(live))).toEqual(Array.from(stateBefore));
  });

  it("a refused archive is not a silent no-op: the user is told (I11)", async () => {
    const harness = createImportHarness({
      liveEpoch: 5,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
      writeConflictCopy: async () => {
        throw new Error("refusing to overwrite an existing conflict copy");
      },
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.env.notify).toHaveBeenCalled();
    expect(harness.notices.length).toBeGreaterThan(0);
    expect(harness.notices.join(" ")).toContain(CANVAS_PATH);
    expect(result.detail).toBeTruthy();
    expect(String(result.detail)).toContain("conflict copy");
  });

  it("a refused archive is not reported as a success", async () => {
    const harness = createImportHarness({
      liveEpoch: 5,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
      writeConflictCopy: async () => {
        throw new Error("refusing to overwrite an existing conflict copy");
      },
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).not.toBe(IMPORT_STATUS.IMPORTED);
    expect(result.archivedTo).toBeNull();
  });

  it("a path this client holds no doc for is refused, never silently 'imported'", async () => {
    const harness = createImportHarness({
      noLiveDoc: true,
      fileText: FILE_TEXT,
      answer: true,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.ADOPTION_REFUSED);
    expect(result.archivedTo).toBeNull();
    expect(totalWrites(harness)).toBe(0);
    expect(harness.env.notify).toHaveBeenCalled();
  });
});
