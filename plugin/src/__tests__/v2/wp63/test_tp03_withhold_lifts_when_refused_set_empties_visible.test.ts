// WP63 / AC3 — the withhold LIFTS the moment the refused set empties.
//
// AC3 is as load-bearing as AC1. A canvas stuck in the withheld state stops
// persisting the user's real edits, which is the same data loss arriving from
// the other direction — so "never lift" is a bug, not a safe default.
//
// Two properties, and the second is the one that makes the first honest:
//
//   ├── the lift is checked on the SAME TRIGGER as the write (never a timer), so
//   │   it cannot be later than the next write attempt, and
//   └── it does not fire early: while the refused record is still absent or still
//       invalid, every further write attempt stays withheld.
//
// FILE BYTES are the oracle again. The lift is proven by the record reaching the
// file through the ordinary canonical projection, not by a flag or a log line.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { serializeCanvas } from "../../../files/canvas-sync";
import {
  TYPELESS_NODE,
  VALID_NODE,
  applyRemoteDelta,
  canvasJson,
  createIO,
  createRecordingLogger,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

/** The repair: a peer (or the user's own fixed file) supplies a VALID `n-bad`. */
function repairRefusedRecord(doc: Y.Doc, fields: Record<string, unknown>): void {
  applyRemoteDelta(doc, (peer) => {
    const record = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) record.set(k, v);
    peer.getMap<Y.Map<unknown>>("nodes").set("n-bad", record);
  });
}

describe("WP63 AC3 — the withhold is temporary and lifts on the write trigger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("once the refused record is valid, the very next write is the ordinary projection", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const logger = createRecordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    expect(await p.coldOpen()).toBe("seeded-from-file");

    // Still broken → still withheld. Without this leg the lift below could be
    // "it never armed".
    await p.flush();
    expect(io.files.get(DISK), "the file was written while the refusal stood").toBe(before);
    expect(p.isWriteWithheld()).toBe(true);

    // The repair: `n-bad` arrives complete.
    repairRefusedRecord(doc, {
      id: "n-bad",
      type: "text",
      x: 300,
      y: 0,
      width: 120,
      height: 60,
      text: "the user's card",
    });

    // Same trigger as the write — nothing else happened in between.
    await p.flush();

    const after = io.files.get(DISK) as string;
    expect(after, "the withhold never lifted: the canvas stopped persisting for good").not.toBe(
      before,
    );
    expect(
      after,
      "the first write after the lift is not the ordinary canonical projection",
    ).toBe(
      serializeCanvas(
        doc.getMap<Y.Map<unknown>>("nodes"),
        doc.getMap<Y.Map<unknown>>("edges"),
        doc.getMap<unknown>("deleted"),
      ),
    );
    expect(nodeIdsIn(after).sort(), "the repaired record is not in the file").toEqual([
      "n-bad",
      "n-ok",
    ]);
    expect(p.isWriteWithheld(), "the withhold is still armed after the refused set emptied").toBe(
      false,
    );

    const restored = logger.lines.find((line) => line.startsWith("SEED RESTORED:"));
    expect(restored, "no distinct lift signature was emitted").toBeDefined();
    expect(restored ?? "", "the lift signature does not name the path").toContain(DISK);

    p.destroy();
    doc.destroy();
  });

  it("a record that comes back STILL invalid does not lift the withhold", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");

    // A peer restates the record — still with no `type`. Nothing is repaired.
    repairRefusedRecord(doc, { id: "n-bad", x: 300, y: 0, width: 120, height: 60, text: "still bad" });

    await p.flush();
    await p.flush();

    expect(io.files.get(DISK), "the withhold lifted on a record that is still invalid").toBe(before);
    expect(p.isWriteWithheld()).toBe(true);
    expect(io.write).not.toHaveBeenCalled();

    p.destroy();
    doc.destroy();
  });

  it("a re-seed of the path resets the refused set — a stale verdict never outlives its file", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    expect(p.isWriteWithheld()).toBe(true);
    expect(p.seedRefusals().map((r) => r.id)).toEqual(["n-bad"]);

    // The user fixes the file offline and the path is seeded again into a fresh
    // doc — the previous verdict is about a file that no longer exists.
    const reseeded = new Y.Doc();
    io.files.set(DISK, canvasJson([VALID_NODE, { ...TYPELESS_NODE, type: "text" }]));
    const rebuilt = new CanvasPersistence(reseeded, io, DISK);
    expect(await rebuilt.coldOpen()).toBe("seeded-from-file");

    expect(rebuilt.seedRefusals(), "a rebuilt writer inherited a stale refusal").toEqual([]);
    expect(rebuilt.isWriteWithheld()).toBe(false);
    await rebuilt.flush();
    expect(nodeIdsIn(io.files.get(DISK) as string).sort()).toEqual(["n-bad", "n-ok"]);

    p.destroy();
    rebuilt.destroy();
    doc.destroy();
    reseeded.destroy();
  });
});
