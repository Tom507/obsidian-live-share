// WP27 / AC1 — the doc id is a function of the GUID, and there is exactly one
// function that builds it.
//
// This is the narrow, pure half of AC1: no doc, no vault, no sync manager. It
// pins the two things every other WP in this batch imports rather than
// re-spells (Shared Ownership Contract §1): `CANVAS_DOC_PREFIX` and
// `canvasDocId(guid)`.
//
// The assertion that carries the WP is the LAST one: `canvasDocId` must REFUSE
// an unresolved guid. R5 is the class where a doc id is built from something
// that is not an identity; a constructor that happily returns `"__canvas__:"`
// for an empty guid re-creates exactly one shared doc for every canvas whose
// guid could not be resolved — a worse collision than the path-keyed one this
// WP removes.
//
// `EPOCH_KEY` is declared here and its SEMANTICS are deliberately not touched:
// monotonicity, comparison, host-increment and conflict handling are WP28's
// (Shared Ownership Contract §2). Nothing below reads or compares an epoch.

import { describe, expect, it } from "vitest";

import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
  SCHEMA_VERSION_KEY,
} from "../../../canvas/canvas-schema";
import { CANVAS_DOC_PREFIX, canvasDocId } from "../../../files/canvas-sync";

const GUIDS = ["0f2a9c6e1b4d47aa9d316c0e2f8b5a70", "a", "guid-with-dashes", "9F2A-UPPER-CASE"];

const PATHS = ["boards/board.canvas", "board.canvas", "a b/c d.canvas", "notes/journal.md"];

describe("WP27 AC1 — CANVAS_DOC_PREFIX and canvasDocId are the doc-id surface", () => {
  it("CANVAS_DOC_PREFIX is exported and is exactly the announced namespace", () => {
    expect(CANVAS_DOC_PREFIX).toBe("__canvas__:");
  });

  it("canvasDocId is prefix + guid, for every guid shape, and adds nothing else", () => {
    for (const guid of GUIDS) {
      expect(canvasDocId(guid)).toBe(`${CANVAS_DOC_PREFIX}${guid}`);
      expect(canvasDocId(guid).slice(CANVAS_DOC_PREFIX.length)).toBe(guid);
    }
  });

  it("canvasDocId is a pure function of the guid — same guid, same id, always", () => {
    for (const guid of GUIDS) {
      expect(canvasDocId(guid)).toBe(canvasDocId(guid));
    }
    // and DIFFERENT guids never collide
    const ids = GUIDS.map((g) => canvasDocId(g));
    expect(new Set(ids).size).toBe(GUIDS.length);
  });

  it("no vault path is a canvas doc id, and no canvas doc id carries a path", () => {
    for (const path of PATHS) {
      expect(path.startsWith(CANVAS_DOC_PREFIX)).toBe(false);
      // The R5 shape: `${prefix}${path}`. It is what the code used to build and
      // it is NOT what the constructor produces for any guid in the corpus.
      for (const guid of GUIDS) {
        expect(canvasDocId(guid)).not.toBe(`${CANVAS_DOC_PREFIX}${path}`);
      }
    }
    for (const guid of GUIDS) {
      expect(canvasDocId(guid)).not.toContain(".canvas");
      expect(canvasDocId(guid)).not.toContain("/");
    }
  });

  it("canvasDocId REFUSES an unresolved guid instead of minting a colliding id", () => {
    // Stated first so this test cannot pass merely because the export is absent
    // and every call throws `TypeError` — the vacuity trap on a `toThrow` pin.
    expect(typeof canvasDocId).toBe("function");
    const unresolved: unknown[] = ["", "   ", "\t", undefined, null, 7, {}, []];
    for (const bad of unresolved) {
      expect(
        () => canvasDocId(bad as string),
        `canvasDocId(${JSON.stringify(bad)}) returned an id instead of refusing`,
      ).toThrow();
    }
  });

  it("the three meta keys are declared beside the existing ones and are all distinct", () => {
    expect(GUID_KEY).toBe("guid");
    expect(PATH_KEY).toBe("path");
    expect(EPOCH_KEY).toBe("epoch");
    // One namespace, five names, no accidental aliasing of an existing key.
    expect(new Set([GUID_KEY, PATH_KEY, EPOCH_KEY, META_MAP_NAME, SCHEMA_VERSION_KEY]).size).toBe(
      5,
    );
  });
});
