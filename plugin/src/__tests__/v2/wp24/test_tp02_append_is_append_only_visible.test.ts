// WP24 / AC1 (append-only half) — "appends encoded updates to <guid>.yhistory".
//
// Two claims live in that sentence and they need different oracles:
//
//   (a) every appended update is recoverable, in order  → file bytes
//   (b) the history is APPEND-ONLY                       → the IO call log
//
// (b) is the one that cannot be seen in the end state. A store that does
// read-modify-write (`read(history)` → concat → `write(history)`) produces a
// byte-identical file and passes (a) forever, while being O(n²), non-atomic and
// capable of losing the whole log on a torn write. The only way to see the
// difference is to look at WHICH operation the store used, so this test asserts
// that the history path is never the target of `write`, `read` or `remove`.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createFakeIO, readFrames, recordUpdates } from "./harness";

const GUID = "guid-append-only";

/** Three genuinely distinct updates, produced by a real doc. */
function threeUpdates(): { updates: Uint8Array[]; source: Y.Doc } {
  const source = new Y.Doc();
  const updates = recordUpdates(source);
  source.getMap("nodes").set("n1", { x: 10, y: 20 });
  source.getMap("nodes").set("n2", { x: 30, y: 40 });
  source.getMap("edges").set("e1", { from: "n1", to: "n2" });
  return { updates, source };
}

describe("WP24 AC1 — the history file is append-only", () => {
  it("stores each update as one frame, in call order, byte-for-byte", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { updates } = threeUpdates();
    expect(updates).toHaveLength(3);

    for (const update of updates) await store.append(GUID, update);

    const history = io.files.get(sidecarHistoryPath(GUID));
    expect(history).toBeDefined();
    const frames = readFrames(history as Uint8Array);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual(updates[0]);
    expect(frames[1]).toEqual(updates[1]);
    expect(frames[2]).toEqual(updates[2]);
  });

  it("a later append never rewrites the bytes an earlier append produced", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { updates } = threeUpdates();

    await store.append(GUID, updates[0]);
    await store.append(GUID, updates[1]);
    const prefix = Uint8Array.from(io.files.get(sidecarHistoryPath(GUID)) as Uint8Array);

    await store.append(GUID, updates[2]);
    const after = io.files.get(sidecarHistoryPath(GUID)) as Uint8Array;

    expect(after.length).toBeGreaterThan(prefix.length);
    expect(after.slice(0, prefix.length)).toEqual(prefix);
  });

  it("reaches the history path through `append` only — never write/read/remove", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { updates } = threeUpdates();

    for (const update of updates) await store.append(GUID, update);

    const historyPath = sidecarHistoryPath(GUID);
    const touched = io.calls.filter((c) => c.path === historyPath && c.phase === "start");
    expect(touched.map((c) => c.op)).toEqual(["append", "append", "append"]);
  });

  it("ensures the sidecar directory exists before the first append lands", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { updates } = threeUpdates();

    await store.append(GUID, updates[0]);

    expect(io.dirs.has(SIDECAR_DIR)).toBe(true);
    const trace = io.trace();
    const dirDone = trace.indexOf(`ensureDir:end:${SIDECAR_DIR}`);
    const firstAppend = trace.indexOf(`append:start:${sidecarHistoryPath(GUID)}`);
    expect(dirDone).toBeGreaterThanOrEqual(0);
    expect(dirDone).toBeLessThan(firstAppend);
  });

  it("keeps two guids in two separate histories", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { updates } = threeUpdates();

    await store.append("guid-a", updates[0]);
    await store.append("guid-b", updates[1]);

    expect(readFrames(io.files.get(sidecarHistoryPath("guid-a")) as Uint8Array)).toEqual([
      updates[0],
    ]);
    expect(readFrames(io.files.get(sidecarHistoryPath("guid-b")) as Uint8Array)).toEqual([
      updates[1],
    ]);
  });
});
