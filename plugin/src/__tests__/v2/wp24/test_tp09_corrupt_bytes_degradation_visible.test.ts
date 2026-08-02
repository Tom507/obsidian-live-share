// WP24 / AC3 (corrupt) — bytes that are STRUCTURALLY complete but semantically
// garbage. Distinct from tp08: nothing is missing here, so a frame walker sees
// a well-formed file and hands the payload straight to Yjs.
//
// Every fixture below first asserts its own premise — that Yjs really does
// refuse these bytes. Without that the whole file could go green against a
// store that never validated anything, simply because the "garbage" happened to
// decode as a no-op. (It is easy to pick bytes that do: a run of zeros applies
// cleanly and changes nothing.)
//
// The corrupt-checkpoint leg matters on its own because the checkpoint is read
// on a different code path from the history and is the file whose loss is
// unrecoverable — the history behind it has already been truncated.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  isSidecarDegraded,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import {
  GARBAGE_UPDATE,
  concatBytes,
  createFakeIO,
  docSnapshot,
  frame,
  recordUpdates,
  utf8,
} from "./harness";

const GUID = "guid-corrupt";

function goodFrames(): Uint8Array[] {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  doc.getMap("nodes").set("k1", { x: 7 });
  doc.getMap("nodes").set("k2", { x: 8 });
  return updates.map(frame);
}

async function loadWith(files: Record<string, Uint8Array>) {
  const io = createFakeIO(files);
  const store = createSidecarStore(io);
  const doc = new Y.Doc();
  const events: unknown[] = [];
  doc.on("update", (u: Uint8Array) => events.push(u));
  const result = await store.load(GUID, doc);
  return { io, doc, events, result };
}

describe("WP24 AC3 — corrupt bytes are a defined degradation", () => {
  it("PREMISE: the fixtures really are bytes Yjs refuses", () => {
    expect(() => Y.applyUpdate(new Y.Doc(), GARBAGE_UPDATE)).toThrow();
    expect(() => Y.applyUpdate(new Y.Doc(), utf8("this is plain text, not CRDT"))).toThrow();
    expect(() => Y.applyUpdate(new Y.Doc(), new Uint8Array(0))).toThrow();
  });

  it("a complete frame with a garbage payload reports CORRUPT and applies nothing", async () => {
    const history = concatBytes(...goodFrames(), frame(GARBAGE_UPDATE));

    const { result, doc, events } = await loadWith({ [sidecarHistoryPath(GUID)]: history });

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(isSidecarDegraded(result)).toBe(true);
    expect(result.historyEntriesApplied).toBe(0);
    expect(result.checkpointApplied).toBe(false);
    expect(events).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(docSnapshot(new Y.Doc()));
  });

  it("a history that is plain text throughout reports CORRUPT, not TRUNCATED", async () => {
    const history = frame(utf8("this is plain text, not CRDT"));
    const { result } = await loadWith({ [sidecarHistoryPath(GUID)]: history });
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
  });

  it("a zero-length frame is CORRUPT — no valid Yjs update is zero bytes", async () => {
    const history = concatBytes(...goodFrames(), frame(new Uint8Array(0)));
    const { result } = await loadWith({ [sidecarHistoryPath(GUID)]: history });
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
  });

  it("a garbage CHECKPOINT reports CORRUPT and no history is applied either", async () => {
    const { result, doc, events } = await loadWith({
      [sidecarCheckpointPath(GUID)]: GARBAGE_UPDATE,
      [sidecarHistoryPath(GUID)]: concatBytes(...goodFrames()),
    });

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(docSnapshot(new Y.Doc()));
  });

  it("a zero-length CHECKPOINT file is CORRUPT, not an empty valid state", async () => {
    // Distinct from an empty HISTORY, which is legitimate (tp07). A checkpoint
    // that exists must contain a state; zero bytes means the write was lost.
    const { result } = await loadWith({ [sidecarCheckpointPath(GUID)]: new Uint8Array(0) });
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
  });

  it("the corrupt frames were the ONLY thing wrong — the good ones were applicable", async () => {
    // Positive control against a fixture that was vacuously empty.
    const clean = concatBytes(...goodFrames());
    const { result, doc } = await loadWith({ [sidecarHistoryPath(GUID)]: clean });
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(Object.keys(doc.getMap("nodes").toJSON()).sort()).toEqual(["k1", "k2"]);
  });

  it("never writes, never deletes, never 'repairs' the corrupt file", async () => {
    const history = concatBytes(...goodFrames(), frame(GARBAGE_UPDATE));
    const { io } = await loadWith({ [sidecarHistoryPath(GUID)]: history });

    expect(io.mutationTrace()).toEqual([]);
    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(history);
  });
});
