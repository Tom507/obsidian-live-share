// WP24 / AC1 — `append` must SNAPSHOT its input synchronously, before its first
// `await`.
//
// This is not a hypothetical. This project already shipped and diagnosed the
// bug in the relay's blob store: "a store whose append awaits before copying
// its input can store corrupt bytes — ws socket buffers are pooled and recycled
// mid-write, so copy before the first await." The sidecar sits on exactly the
// same input: the `Uint8Array` handed to `doc.on("update", …)` is a view Yjs
// owns, and WP25 will forward it straight through from a socket frame.
//
// The bug is invisible to every other test in this suite, because in every one
// of them the caller politely awaits and never touches the buffer again. It is
// visible only if the caller mutates the array in the window between the call
// and the promise resolving — which is precisely what a recycled socket buffer
// does.
//
// Note the shape of the assertion: what is persisted must equal the bytes AT
// CALL TIME. Asserting "the file is not empty" or "the frame length is right"
// would pass against the broken store, since only the CONTENTS change.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createSidecarStore, sidecarHistoryPath } from "../../../files/canvas-sidecar";
import { createFakeIO, frame, readFrames, recordUpdates } from "./harness";

const GUID = "guid-snapshot";

function realUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  doc.getMap("nodes").set("payload", { label: "the user's card", x: 12, y: 34 });
  return updates[0];
}

describe("WP24 AC1 — append copies its input before the first await", () => {
  it("a caller buffer recycled after the call does not corrupt the stored frame", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const update = realUpdate();
    const atCallTime = Uint8Array.from(update);

    const pending = store.append(GUID, update);
    // The socket layer hands the pooled buffer to the next frame — synchronously,
    // before our promise has had a chance to resolve.
    update.fill(0xaa);
    await pending;

    const frames = readFrames(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(atCallTime);
    expect(frames[0]).not.toEqual(update);
  });

  it("the recycled bytes really would have been different — the fixture is not degenerate", () => {
    const update = realUpdate();
    const recycled = Uint8Array.from(update).fill(0xaa);
    expect(recycled).not.toEqual(update);
    expect(update.some((b) => b !== 0xaa)).toBe(true);
  });

  it("the stored frame still decodes to the original update", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const update = realUpdate();
    const expected = Uint8Array.from(update);
    const pending = store.append(GUID, update);
    update.fill(0x00);
    await pending;

    const stored = readFrames(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array)[0];
    expect(stored).toEqual(expected);

    const revived = new Y.Doc();
    Y.applyUpdate(revived, stored);
    expect(revived.getMap("nodes").toJSON()).toEqual({
      payload: { label: "the user's card", x: 12, y: 34 },
    });
  });

  it("two appends issued back-to-back on the SAME reused buffer keep their own bytes", async () => {
    // The pooled-buffer case in full: one array, two logical updates, both in
    // flight. A store that keeps a reference rather than a copy writes the same
    // (last) content twice.
    const io = createFakeIO();
    const store = createSidecarStore(io);

    const docA = new Y.Doc();
    const updatesA = recordUpdates(docA);
    docA.getMap("nodes").set("first", { v: 1 });
    docA.getMap("nodes").set("second", { v: 2 });
    const [one, two] = updatesA;
    const width = Math.max(one.length, two.length);

    const pool = new Uint8Array(width);
    pool.set(one, 0);
    const firstBytes = one;
    const p1 = store.append(GUID, pool.subarray(0, one.length));

    pool.fill(0);
    pool.set(two, 0);
    const p2 = store.append(GUID, pool.subarray(0, two.length));

    await Promise.all([p1, p2]);

    const frames = readFrames(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(firstBytes);
    expect(frames[1]).toEqual(two);
    expect(frames[0]).not.toEqual(frames[1]);
  });

  it("the frame the store writes matches the framing this suite decodes with", async () => {
    // Anchors the previous assertions to the pinned format rather than to the
    // store's self-consistency.
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const update = realUpdate();

    await store.append(GUID, update);

    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(frame(update));
  });
});
