// WP121 A1 — DEMONSTRATE THE LOSS BEFORE YOU REPAIR IT.
//
// The project did NOT have a demonstrated instance of this loss. The charter's
// §0 withdraws the one it was written from (the "318 nodes" figure is our own
// test spam, `DISPATCHER_STATE.md` §6), and §4 files the path under "traced in
// code, NOT measured". This file is the measurement.
//
// It drives the REAL `CanvasPersistence` over a REAL `Y.Doc` through the REAL
// `attachCanvasPersistence` entry point. There is no double for `flush` and none
// for the serializer — a double standing in for either would hide the defect
// perfectly, because the defect IS what `flush` writes.
//
// ORACLE: parsed record ids, never bytes (`S174`).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../files/canvas-persistence";
import {
  NODE,
  authorSpelling,
  conflictCopiesIn,
  createIO,
  preservationOver,
  recordIdsIn,
  seedDoc,
} from "./harness";

const PATH = "share/board.canvas";

describe("WP121 A1 — the doc-wins cold open discards records only the file holds", () => {
  it("DEMONSTRATION: named ids present in the file before are absent from disk after", async () => {
    // The user's file holds three cards. Two of them are also in the shared
    // document; `n-local` is not — it is the card this peer drew while the
    // relay had never heard of it, or the card a peer's delta never carried.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared-a"), NODE("n-shared-b"), NODE("n-local")]),
    });
    const before = recordIdsIn(io.files.get(PATH));
    expect(before.nodes).toEqual(["n-local", "n-shared-a", "n-shared-b"]);

    // The document, as the relay hands it over: non-empty, and it has never
    // heard of `n-local`.
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared-a"), NODE("n-shared-b")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);

    // The branch under test, named by the product itself.
    expect(coldOpen).toBe("doc-wins");

    const after = recordIdsIn(io.files.get(PATH));
    // THE LOSS, in named ids. Not a byte count, not a file size.
    expect(after.nodes).toEqual(["n-shared-a", "n-shared-b"]);
    expect(after.nodes).not.toContain("n-local");

    // And it is gone from the vault entirely: nothing anywhere else holds it.
    const everywhere = [...io.files.values()].join("\n");
    expect(everywhere).not.toContain("n-local");

    persistence.destroy();
  });

  it("DEMONSTRATION: the same happens to an edge the document does not hold", async () => {
    // An edge is nothing but two references, so a file-only edge is the record
    // most likely to exist locally and nowhere else.
    const io = createIO({
      [PATH]: authorSpelling(
        [NODE("n1"), NODE("n2")],
        [{ id: "e-local", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }],
      ),
    });
    expect(recordIdsIn(io.files.get(PATH)).edges).toEqual(["e-local"]);

    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n1"), NODE("n2")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);
    expect(coldOpen).toBe("doc-wins");

    expect(recordIdsIn(io.files.get(PATH)).edges).toEqual([]);
    persistence.destroy();
  });

  it("POSITIVE CONTROL: with the record IN the document, nothing is discarded", async () => {
    // The control that makes the two rows above mean something. Same fixture,
    // same branch, same flush — the only difference is that the document holds
    // the third card. If this row ever went red the two above would be scoring
    // "the flush happened", not "records were discarded".
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared-a"), NODE("n-shared-b"), NODE("n-local")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared-a"), NODE("n-shared-b"), NODE("n-local")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH);
    expect(coldOpen).toBe("doc-wins");
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual([
      "n-local",
      "n-shared-a",
      "n-shared-b",
    ]);
    persistence.destroy();
  });

  it("THE DISCRIMINATOR: the same ids are recoverable once the guard is wired", async () => {
    // The charter's discriminator question — "what does the demonstration do on
    // the REPAIRED build?" — asked directly, on the SAME fixture as the first
    // row of this file. The only difference is the preservation door.
    //
    // It goes green because THE GUARD RAN: the assertion is that `n-local` is
    // findable, by name, in a file the guard created. A no-op refactor of
    // `flush` cannot produce that file, so this row cannot be satisfied by the
    // flush changing shape.
    const io = createIO({
      [PATH]: authorSpelling([NODE("n-shared-a"), NODE("n-shared-b"), NODE("n-local")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared-a"), NODE("n-shared-b")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: "share" }),
    });
    expect(coldOpen).toBe("doc-wins");

    // Who wins is unchanged — the projection still landed on the live file.
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared-a", "n-shared-b"]);

    // And the discarded card is recoverable by NAME.
    const copies = conflictCopiesIn(io, "share (conflicts)");
    expect(copies).toHaveLength(1);
    expect(recordIdsIn(io.files.get(copies[0])).nodes).toContain("n-local");

    persistence.destroy();
  });
});
