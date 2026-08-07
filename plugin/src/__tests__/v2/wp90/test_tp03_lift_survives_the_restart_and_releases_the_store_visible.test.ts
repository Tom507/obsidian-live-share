// WP90 / AC3 — THE LIFT STILL LIFTS, ACROSS A RESTART, AND RELEASES THE STORE.
//
// This is the criterion that decides whether the repair is worse than the
// defect. `writeIsWithheld`'s own doc comment says it: "a withhold that outlives
// its cause is its own data-loss class — a canvas stuck withheld stops
// persisting the user's real edits". Making the withhold DURABLE makes that risk
// durable too, and unlike WP63's version, restarting no longer clears it.
//
// So two things have to be shown, and the second is the one WP63 never had to:
//
//   ├── the lift fires on the WRITE TRIGGER, on a refusal that came out of the
//   │   store rather than out of a seed, and
//   └── the lift REACHES THE STORE. A lift that only emptied the in-memory set
//       would be undone by the next cold open, and the withhold would be
//       PERMANENT — the exact failure this criterion exists to prevent.
//
// It also carries the Ä3 distinction on the WRITE side: the bytes the file
// receives after the lift are `serializeCanvas`'s output, computed independently
// here. Nothing is re-injected, which is why C17 AC3 is not exercised rather
// than merely not violated.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ────────────────────────────────────────────
// BREAK A (case 1, the durability of the lift). Remove `if (lifted > 0)
//   this.reportDurable();` from `SeedRefusalLedger.prune` (`canvas-sync.ts`).
//   The withhold lifts in session 2 and the file is written, but the store still
//   holds `n-bad`; session 3 restores it and withholds again — a permanent
//   withhold, one restart wide. VERIFIED RED, then restored.
// BREAK B (case 1, the Ä3 clause). Re-inject the refused id into the write in
//   `CanvasPersistence.flushToDisk`, which is what pass-through would have done.
//   The written bytes stop equalling `serializeCanvas`'s output. VERIFIED RED,
//   then restored.
// Case 2 is the anti-early-lift control, inherited in shape from WP63 tp03: a
//   record that comes back STILL invalid must not lift a restored refusal. It
//   reddens if the lift is made unconditional.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { serializeCanvas } from "../../../files/canvas-sync";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import {
  TYPELESS_NODE,
  VALID_NODE,
  applyRemoteDelta,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  docAsTheRelayWouldHandItBack,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";

/** A peer creates `n-bad` PROPERLY — the repair, arriving as a real delta. */
function repairFromAPeer(doc: Y.Doc, fields: Record<string, unknown>): void {
  applyRemoteDelta(doc, (peer) => {
    const record = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) record.set(k, v);
    peer.getMap<Y.Map<unknown>>("nodes").set("n-bad", record);
  });
}

/** Session 1: refuse `n-bad` and get the verdict into the durable store. */
async function recordARefusal(storeIO: ReturnType<typeof createStoreIO>): Promise<{
  doc: Y.Doc;
  before: string;
}> {
  const doc = new Y.Doc();
  const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
  const io = createIO({ [DISK]: before });
  const store = new SeedRefusalStore(storeIO, {});
  const p = new CanvasPersistence(doc, io, DISK, { durableRefusals: store });
  if ((await p.coldOpen()) !== "seeded-from-file") throw new Error("session 1 did not seed");
  await p.flush();
  await store.idle();
  if (!(storeIO.text() ?? "").includes("n-bad")) throw new Error("session 1 recorded nothing");
  p.destroy();
  return { doc, before };
}

describe("WP90 AC3 — a durable withhold can still be lifted, and the lift is durable too", () => {
  it("the repair lifts a RESTORED refusal, the file gets the canonical projection, and session 3 is free", async () => {
    const storeIO = createStoreIO();
    const { doc: doc1, before } = await recordARefusal(storeIO);

    // ── SESSION 2 — the restored withhold, then the repair ───────────────────
    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [DISK]: before });
    const log2 = createRecordingLogger();
    const store2 = new SeedRefusalStore(storeIO, { logger: log2 });
    const p2 = new CanvasPersistence(doc2, io2, DISK, { logger: log2, durableRefusals: store2 });

    expect(await p2.coldOpen(), "not the doc-wins branch — the row would be vacuous").toBe(
      "doc-wins",
    );
    // The withhold must be STANDING before the repair, or the lift below proves
    // nothing: an unarmed withhold "lifts" trivially.
    expect(p2.isWriteWithheld(), "the restored refusal never armed the withhold").toBe(true);
    expect(
      p2.seedRefusals().map((r) => r.id),
      "the refusal did not come from the store",
    ).toEqual(["n-bad"]);
    expect(io2.files.get(DISK), "session 2 wrote before the repair").toBe(before);

    // The repair: `n-bad` arrives complete, from a peer.
    repairFromAPeer(doc2, {
      id: "n-bad",
      type: "text",
      x: 300,
      y: 0,
      width: 120,
      height: 60,
      text: "the user's card",
    });

    // Same trigger as the write. No timer, no sleep, no startup prune — the
    // lift is asked because a write was attempted, and nothing else happened.
    await p2.flush();
    await store2.idle();

    const after = io2.files.get(DISK) as string;
    expect(after, "the durable withhold never lifted — the canvas is stuck").not.toBe(before);
    expect(
      after,
      "the first write after the lift is not the ordinary canonical projection — " +
        "something was re-injected, which is Ä3",
    ).toBe(
      serializeCanvas(
        doc2.getMap<Y.Map<unknown>>("nodes"),
        doc2.getMap<Y.Map<unknown>>("edges"),
        doc2.getMap<unknown>("deleted"),
      ),
    );
    expect(nodeIdsIn(after).sort()).toEqual(["n-bad", "n-ok"]);
    expect(p2.isWriteWithheld()).toBe(false);
    expect(
      log2.lines.some((line) => line.startsWith("SEED RESTORED:")),
      "the lift was not narrated",
    ).toBe(true);

    // THE HALF WP63 NEVER NEEDED: the lift reached the file.
    expect(
      storeIO.text() ?? "",
      "the lift never reached the durable store — the withhold is permanent",
    ).not.toContain("n-bad");

    p2.destroy();

    // ── SESSION 3 — a second restart, with nothing left to restore ───────────
    const doc3 = docAsTheRelayWouldHandItBack(doc2);
    const io3 = createIO({ [DISK]: after });
    const store3 = new SeedRefusalStore(storeIO, {});
    const p3 = new CanvasPersistence(doc3, io3, DISK, { durableRefusals: store3 });

    expect(await p3.coldOpen()).toBe("doc-wins");
    expect(p3.seedRefusals(), "a lifted refusal came back from the dead").toEqual([]);
    expect(p3.isWriteWithheld(), "the withhold became permanent across the restart").toBe(false);

    p3.destroy();
    doc1.destroy();
    doc2.destroy();
    doc3.destroy();
  });

  it("CONTROL — a record that comes back STILL invalid does not lift a restored refusal", async () => {
    const storeIO = createStoreIO();
    const { doc: doc1, before } = await recordARefusal(storeIO);

    const doc2 = docAsTheRelayWouldHandItBack(doc1);
    const io2 = createIO({ [DISK]: before });
    const store2 = new SeedRefusalStore(storeIO, {});
    const p2 = new CanvasPersistence(doc2, io2, DISK, { durableRefusals: store2 });

    expect(await p2.coldOpen()).toBe("doc-wins");
    expect(p2.isWriteWithheld()).toBe(true);

    // A peer restates the record — still with no `type`. Nothing is repaired.
    repairFromAPeer(doc2, { id: "n-bad", x: 300, y: 0, width: 120, height: 60, text: "still bad" });

    await p2.flush();
    await p2.flush();
    await store2.idle();

    expect(io2.files.get(DISK), "the withhold lifted on a record that is still invalid").toBe(
      before,
    );
    expect(p2.isWriteWithheld()).toBe(true);
    expect(io2.write).not.toHaveBeenCalled();
    expect(storeIO.text() ?? "", "the store dropped a refusal that never resolved").toContain(
      "n-bad",
    );

    p2.destroy();
    doc1.destroy();
    doc2.destroy();
  });
});
