// WP63 / AC2 — the withhold is PER PATH and NON-FATAL (I5 DEGRADE).
//
// A withheld write is a degraded persistence state for ONE canvas. It is not an
// exception, not a session-wide condition, and not a reason to stop syncing:
// the affected canvas keeps receiving remote deltas and keeps rendering, only
// its write-back is suspended. Every other canvas persists exactly as before.
//
// The failure this rules out is the "safe" over-reaction — a refusal that trips
// a global flag, throws out of `flush`, or tears the session down. Any of those
// would trade one data-loss class for a bigger one.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasPersistence } from "../../../files/canvas-persistence";
import { buildCanvasData } from "../../../files/canvas-sync";
import {
  TYPELESS_NODE,
  VALID_NODE,
  applyRemoteDelta,
  canvasJson,
  createIO,
  createRecordingLogger,
  nodeIdsIn,
} from "./harness";

const REFUSED_PATH = "risk/refused.canvas";
const CLEAN_PATH = "risk/clean.canvas";

describe("WP63 AC2 — one canvas degrades, the rest of the session does not", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a refusal on one path never suspends the write-back of another", async () => {
    const refusedBefore = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const cleanBefore = canvasJson([VALID_NODE]);
    const io = createIO({ [REFUSED_PATH]: refusedBefore, [CLEAN_PATH]: cleanBefore });

    const refusedDoc = new Y.Doc();
    const cleanDoc = new Y.Doc();
    const refused = new CanvasPersistence(refusedDoc, io, REFUSED_PATH);
    const clean = new CanvasPersistence(cleanDoc, io, CLEAN_PATH);

    expect(await refused.coldOpen()).toBe("seeded-from-file");
    expect(await clean.coldOpen()).toBe("seeded-from-file");

    await refused.flush();
    await clean.flush();

    expect(refused.isWriteWithheld(), "the refused path is not withheld").toBe(true);
    expect(clean.isWriteWithheld(), "the withhold leaked to an unrelated canvas").toBe(false);
    expect(io.files.get(REFUSED_PATH), "the refused path's file was rewritten").toBe(refusedBefore);
    expect(
      io.files.get(CLEAN_PATH),
      "an unrelated canvas stopped persisting because a DIFFERENT canvas had a refusal",
    ).not.toBe(cleanBefore);
    expect(nodeIdsIn(io.files.get(CLEAN_PATH) as string)).toEqual(["n-ok"]);

    refused.destroy();
    clean.destroy();
    refusedDoc.destroy();
    cleanDoc.destroy();
  });

  it("the withheld canvas keeps syncing: remote deltas still land, and no flush ever throws", async () => {
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [REFUSED_PATH]: before });
    const logger = createRecordingLogger();
    const doc = new Y.Doc();
    const p = new CanvasPersistence(doc, io, REFUSED_PATH, { logger });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    p.start();

    // A peer moves the surviving card and adds one of its own. Both must reach
    // the doc: the write-back is suspended, the CRDT is not.
    applyRemoteDelta(doc, (peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      (nodes.get("n-ok") as Y.Map<unknown>).set("x", 512);
      const fresh = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({
        id: "n-peer",
        type: "text",
        x: 900,
        y: 0,
        width: 100,
        height: 50,
        text: "from a peer",
      })) {
        fresh.set(k, v);
      }
      nodes.set("n-peer", fresh);
    });

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.get("n-ok")?.get("x"), "a remote delta was dropped by the withheld canvas").toBe(
      512,
    );
    expect(nodes.has("n-peer"), "the withheld canvas stopped accepting remote records").toBe(true);
    // WP64 — key presence was this record's ONLY oracle, and post-WP19 it
    // survives a withhold that accepted the record and then tombstoned it.
    // Its field values are pinned here too: `has` alone would also accept an
    // emptied container.
    const deletedMap = doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deletedMap, "n-peer")),
      "the withheld canvas TOMBSTONED the remote record it had just accepted",
    ).toBe(false);
    expect(
      buildCanvasData(nodes, doc.getMap<Y.Map<unknown>>("edges"), deletedMap).nodes.map(
        (n) => n.id,
      ),
      "the remote record never reached the canvas of the withheld path",
    ).toContain("n-peer");
    expect(
      nodes.get("n-peer")?.get("text"),
      "the remote record arrived as an empty container",
    ).toBe("from a peer");

    // Repeated real write attempts: still withheld, still no throw, file still
    // byte-identical. A withhold is a degrade, never a failure.
    await expect(p.flush()).resolves.toBeUndefined();
    await expect(p.flush()).resolves.toBeUndefined();
    expect(io.files.get(REFUSED_PATH)).toBe(before);
    expect(io.write).not.toHaveBeenCalled();

    // ...and it is never a SILENT no-op.
    expect(
      logger.lines.filter((line) => line.startsWith("SEED REFUSED:")).length,
      "a withheld write went unnarrated",
    ).toBeGreaterThanOrEqual(1);

    p.destroy();
    doc.destroy();
  });
});
