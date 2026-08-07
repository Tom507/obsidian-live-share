// WP8 AC4 — the boundary of the version-gate predicate itself, tested
// directly against `canvas-schema.ts` (no CanvasSync harness). This pins
// the easy-to-get-backwards edge: an UNMIGRATED V1 doc (no `meta` at all)
// must NOT be reported as a "major mismatch" — that is the migration case
// (AC2), a different condition from "this client is too old/new for a doc
// a peer already stamped". An implementation that conflates the two would
// permanently disable capture for every canvas that simply hasn't been
// opened by a V2 client yet.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { isSchemaMajorMismatch, SUPPORTED_SCHEMA_MAJOR } from "../../../canvas/canvas-schema";

describe("WP8 AC4 — isSchemaMajorMismatch boundary conditions", () => {
  it("a doc with no meta at all is NOT a mismatch (that is the migration case, not the disable-capture case)", () => {
    const doc = new Y.Doc();
    doc.getMap<Y.Map<unknown>>("nodes").set(
      "n1",
      (() => {
        const m = new Y.Map<unknown>();
        m.set("x", 0);
        return m;
      })(),
    );
    expect(isSchemaMajorMismatch(doc)).toBe(false);
    doc.destroy();
  });

  it("a doc stamped with exactly this client's supported major is NOT a mismatch", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>("meta").set("schemaVersion", SUPPORTED_SCHEMA_MAJOR);
    expect(isSchemaMajorMismatch(doc)).toBe(false);
    doc.destroy();
  });

  it("a doc stamped with a HIGHER major than supported IS a mismatch", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>("meta").set("schemaVersion", SUPPORTED_SCHEMA_MAJOR + 1);
    expect(isSchemaMajorMismatch(doc)).toBe(true);
    doc.destroy();
  });

  it("a doc stamped with a LOWER major than supported IS a mismatch", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>("meta").set("schemaVersion", SUPPORTED_SCHEMA_MAJOR - 1);
    expect(isSchemaMajorMismatch(doc)).toBe(true);
    doc.destroy();
  });
});
