// WP63 / AC1 — a seed refusal WITHHOLDS the file write; the file stays byte-identical.
//
// The defect this pins is a COMPOSITION, and every step of it was individually
// correct: WP18 AC1 refuses an invalid local record at the seed → the record
// never enters `nodesMap`/`edgesMap` → `serializeCanvas` is a pure projection of
// those containers → `CanvasPersistence` writes that projection over the file.
// Composed: the user's record is silently and permanently deleted from a file
// this plugin did not create.
//
// FILE BYTES ARE THE ORACLE. The `SEED REFUSED:` signature is checked too, but
// only as the secondary requirement AC1 names by hand — a probe that asserted on
// the log alone would pass against an implementation that logs and then writes.
//
// Both seed boundaries are covered, because AC1 names both and they are separate
// code paths: the COLD-OPEN seed (`CanvasPersistence.coldOpen`, the guest case)
// and the HOST seed (`CanvasSync.subscribe(path, "host")`, whose refusals reach
// the writer through the shared ledger — that is the real production wiring).

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createSyncManager,
  createVault,
  ioOverVault,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

describe("WP63 AC1 — a refused seed record withholds the write instead of deleting the record", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("COLD-OPEN seed: a real flush leaves the file byte-identical", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const logger = createRecordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    const result = await p.coldOpen();
    expect(result, "the seed branch was not taken — this probe would be vacuous").toBe(
      "seeded-from-file",
    );
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-bad"),
      "WP18 AC1 was weakened: the invalid local record entered the doc",
    ).toBe(false);

    // Drive an ACTUAL write, not a scheduled one.
    await p.flush();

    expect(io.files.get(DISK), "the user's file was rewritten after a seed refusal").toBe(before);
    expect(
      nodeIdsIn(io.files.get(DISK) as string),
      "the refused record was deleted from the user's own file",
    ).toContain("n-bad");
    expect(io.write, "a write reached the disk while a refusal was outstanding").not.toHaveBeenCalled();
    expect(p.isWriteWithheld(), "the withhold is not observable state").toBe(true);

    // Secondary, exactly as AC1 words it: the signature names the path, the id
    // and the reason.
    const signature = logger.lines.find((line) => line.startsWith("SEED REFUSED:"));
    expect(signature, "no SEED REFUSED: signature was emitted").toBeDefined();
    expect(signature ?? "", "the signature does not name the path").toContain(DISK);
    expect(signature ?? "", "the signature does not name the refused id").toContain("n-bad");
    expect(signature ?? "", "the signature does not name the reason").toContain("MISSING_TYPE");

    p.destroy();
    doc.destroy();
  });

  it("HOST seed: the refusal reaches the writer through the shared ledger and the file survives", async () => {
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const vault = createVault({ [DISK]: before });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    await cs.subscribe(DISK, "host");
    const doc = syncManager.getDoc(`__canvas__:${DISK}`).doc;
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-ok"),
      "the host seed never ran — this probe would be vacuous",
    ).toBe(true);
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-bad"),
      "WP18 AC1 was weakened at the host seed",
    ).toBe(false);

    const io = ioOverVault(vault);
    const logger = createRecordingLogger();
    // Exactly the production wiring (`main.ts` → `attachCanvasPersistence`).
    const p = new CanvasPersistence(doc, io, DISK, {
      logger,
      seedRefusals: cs.seedRefusalLedger(DISK),
    });

    // The doc holds records, so cold open takes the DOC-WINS branch and flushes
    // immediately — this is the exact live moment the record used to disappear.
    const result = await p.coldOpen();
    expect(result, "the doc-wins branch was not taken — this probe would be vacuous").toBe(
      "doc-wins",
    );

    expect(vault.files.get(DISK), "the host's own file was rewritten after a seed refusal").toBe(
      before,
    );
    expect(nodeIdsIn(vault.files.get(DISK) as string)).toContain("n-bad");
    expect(
      logger.lines.some((line) => line.startsWith("SEED REFUSED:")),
      "no SEED REFUSED: signature was emitted at the host boundary",
    ).toBe(true);

    p.destroy();
    cs.destroy();
    doc.destroy();
  });

  it("no refusal, no withhold: a clean file still persists normally", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();

    expect(p.isWriteWithheld(), "a canvas with nothing refused must not be withheld").toBe(false);
    expect(io.write, "the writer stopped writing for a canvas with no refusals").toHaveBeenCalled();
    expect(nodeIdsIn(io.files.get(DISK) as string)).toEqual(["n-ok"]);

    p.destroy();
    doc.destroy();
  });
});
