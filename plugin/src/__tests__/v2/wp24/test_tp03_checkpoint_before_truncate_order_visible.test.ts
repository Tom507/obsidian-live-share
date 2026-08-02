// WP24 / AC1 (ordering half) — "truncates the history only after the checkpoint
// is durably written — never the reverse order".
//
// THE POINT OF THIS FILE: the end state is IDENTICAL under both orders. After
// `checkpoint()` returns, the checkpoint file holds the full state and the
// history is empty — whether the truncate happened first, last, or concurrently.
// A test that inspects the resulting files therefore cannot fail, and this WP's
// most important durability property would be pinned by nothing.
//
// So the oracle is the ordering itself, observed at the injected seam:
//
//   1. hold `write` open, start `checkpoint()`, and assert that while the
//      checkpoint write is still IN FLIGHT the history has not been truncated;
//   2. release, and assert `write:end` precedes `truncate:start` in the log.
//
// (1) is what kills `Promise.all([write, truncate])` and a fire-and-forget
// write — both of which satisfy (2)'s weaker cousin "truncate is last in the
// array" only by luck of scheduling. (2) is what kills truncate-then-write.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createFakeIO, recordUpdates } from "./harness";

const GUID = "guid-order";

function docWithHistory(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  doc.getMap("nodes").set("card", { x: 1, y: 2, width: 100, height: 50 });
  doc.getMap("nodes").set("card2", { x: 5, y: 6, width: 80, height: 40 });
  return { doc, updates };
}

describe("WP24 AC1 — checkpoint is durable before the history is truncated", () => {
  it("does not truncate while the checkpoint write is still in flight", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = docWithHistory();
    for (const update of updates) await store.append(GUID, update);

    const historyBefore = Uint8Array.from(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(historyBefore.length).toBeGreaterThan(0);

    const release = io.block("write");
    const pending = store.checkpoint(GUID, doc);

    // Let every microtask that is NOT gated on the write run to completion.
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(io.calls.some((c) => c.op === "truncate")).toBe(false);
    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(historyBefore);

    release();
    await pending;

    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(new Uint8Array(0));
  });

  it("records write:end before truncate:start, on the two expected paths", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = docWithHistory();
    for (const update of updates) await store.append(GUID, update);

    io.calls.length = 0;
    await store.checkpoint(GUID, doc);

    const trace = io.trace();
    const writeEnd = trace.indexOf(`write:end:${sidecarCheckpointPath(GUID)}`);
    const truncateStart = trace.indexOf(`truncate:start:${sidecarHistoryPath(GUID)}`);

    expect(writeEnd).toBeGreaterThanOrEqual(0);
    expect(truncateStart).toBeGreaterThanOrEqual(0);
    expect(writeEnd).toBeLessThan(truncateStart);
  });

  it("the mutating sequence is exactly write then truncate, never interleaved", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = docWithHistory();
    for (const update of updates) await store.append(GUID, update);

    io.calls.length = 0;
    await store.checkpoint(GUID, doc);

    // Non-interleaved is the strong form: `write:start, write:end,
    // truncate:start, truncate:end`. Concurrent issue reads
    // `write:start, truncate:start, …` and fails here even if it happens to
    // finish in the right order on this run.
    expect(io.mutationTrace()).toEqual([
      "write:start",
      "write:end",
      "truncate:start",
      "truncate:end",
    ]);
  });

  it("if the checkpoint write fails, the history is left intact", async () => {
    // The ordering rule exists so a crash between the two steps costs nothing.
    // A failed write is the observable form of that crash.
    const io = createFakeIO();
    const failing = {
      ...io,
      write: async (path: string, data: Uint8Array): Promise<void> => {
        await io.write(path, data).then(() => {
          io.files.delete(path);
        });
        throw new Error("disk full");
      },
    };
    const store = createSidecarStore(failing);
    const { doc, updates } = docWithHistory();
    for (const update of updates) await store.append(GUID, update);
    const historyBefore = Uint8Array.from(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array);

    await expect(store.checkpoint(GUID, doc)).rejects.toThrow();

    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(historyBefore);
    expect(io.calls.some((c) => c.op === "truncate")).toBe(false);
  });
});
