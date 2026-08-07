// WP91 / C91 AC2 — our own echo is still suppressed, BY IDENTITY, at every delta
// including ones no timer covers.
//
// WHAT THIS FILE IS FOR. AC1 took three timers off the capture path. The price of
// that is an extra `vault.read` per echo, and the claim that the price is the only
// thing it costs is exactly what `canvas-persistence.ts` has been asserting without
// evidence since it was written ("Purely mechanical echo suppression — NOT a
// correctness mechanism"). This file evaluates that sentence.
//
// THE VACUITY RISKS THE CHARTER ATTACHED, AND HOW EACH IS DISCHARGED:
//
//   (a) "Zero writes because the doc handle, the subscription or `canWrite`
//       declined first — every one of `subscribedPaths`, `canWrite`, the doc
//       handle and the schema-major gate must be asserted PASSING before the echo
//       assertion is read; otherwise this AC is satisfied by four unrelated early
//       returns." T1 asserts all four, and it asserts them the only way that
//       cannot lie: by driving a DIFFERING save through the same fixture in the
//       same test and watching it capture. Four early returns cannot produce a
//       capture.
//   (b) "The delta-10 s row run on a real clock." One virtual clock governs the
//       whole file; there is no wall-clock sleep anywhere in it.
//   (c) "'Byte-identical' produced by RE-SERIALISING rather than by replaying the
//       exact bytes `onWritten` reported." The echo rows replay
//       `rig.written.at(-1)` verbatim — the exact string the writer handed the
//       sync layer — so a serialisation drift that disarmed the breaker would
//       redden this file instead of hiding in it.
//
// THE DISCRIMINATION PAIR IS MANDATORY AND IS IN THE SAME RUN: a "no writes"
// assertion that is not paired with a "writes" assertion over the same harness
// proves only that the harness is inert.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { isSchemaMajorMismatch } from "../../../canvas/canvas-schema";
import {
  PATH,
  type Rig,
  advance,
  applyRemoteDelta,
  canvasJson,
  createRig,
  declineLines,
  node,
  nodeIdsIn,
  remoteNode,
  settle,
} from "./harness";

const SEED = canvasJson([node("seed", "seed card")]);

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

/** Every field the Surface-Shadow holds for the path, as a comparable string.
 * "no shadow mutation" is a claim about this state, not about a missing log
 * line — read through WP4's own accessor, the one its AC2 row uses. */
function shadowPrint(rig: Rig): string {
  const shadow = rig.canvasSync.getSurfaceShadow();
  const state = shadow.paths.get(PATH);
  if (state === undefined) return "absent";
  const dump = (kind: "node" | "edge"): unknown =>
    [...state[kind].entries()]
      .map(([id, record]) => [id, record.state, [...record.fields.entries()].sort()] as const)
      .sort();
  return JSON.stringify({ node: dump("node"), edge: dump("edge") });
}

describe("WP91 AC2 — the echo is suppressed because it is an echo, never because it arrived early", () => {
  let rig: Rig;

  beforeEach(async () => {
    vi.useFakeTimers();
    rig = await createRig({ initial: { [PATH]: SEED } });
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer text")));
    await advance(200);
  });

  afterEach(() => {
    rig.destroy();
    vi.useRealTimers();
  });

  it("T1 — at delta 0 ms the exact written bytes produce ZERO CRDT writes, and a one-byte change produces writes", async () => {
    // --- vacuity (a): the four gates in front of the breaker are all PASSING ---
    expect(rig.canvasSync.isSubscribed(PATH)).toBe(true);
    expect(rig.doc).toBeDefined();
    expect(isSchemaMajorMismatch(rig.doc)).toBe(false);
    // `canWrite` defaults to `() => true` and is never narrowed by this fixture;
    // the assertion that it is not declining is the capture in the second half.

    // --- vacuity (c): the baseline is the EXACT bytes `onWritten` reported ------
    const exactBytes = rig.written.at(-1) as string;
    expect(typeof exactBytes).toBe("string");
    expect(rig.files.get(PATH)).toBe(exactBytes);

    const before = fingerprint(rig.doc);
    const shadowBefore = shadowPrint(rig);

    rig.emitModify(PATH);
    await settle();

    expect(fingerprint(rig.doc)).toBe(before);
    expect(shadowPrint(rig)).toBe(shadowBefore);
    expect(declineLines(rig.logs).at(-1)).toContain("reason=echo");

    // --- THE DISCRIMINATION PAIR, same harness, same run ----------------------
    // One field, moved. Geometry rather than text on purpose: a `text` field may
    // be stored as a `Y.Text` (WP36), and a raw `!==` against one is the
    // representation-blindness trap that broke the `SHADOW STALE:` diagnostic.
    const oneByteChanged = canvasJson([
      node("seed", "seed card", 111),
      { id: "remote", type: "text", x: 400, y: 20, width: 240, height: 60, text: "peer text" },
    ]);
    rig.files.set(PATH, oneByteChanged);
    rig.emitModify(PATH);
    await settle();

    expect(fingerprint(rig.doc)).not.toBe(before);
    expect(rig.doc.getMap<Y.Map<unknown>>("nodes").get("seed")?.get("x")).toBe(111);
  });

  it("T2 — at delta 10 s, OUTSIDE every timer, the same bytes are still suppressed", async () => {
    const exactBytes = rig.written.at(-1) as string;
    // 10 s of simulated time: both 250 ms settle windows have long expired and
    // the mute has been released. Under the pre-WP91 design the suppression at
    // this delta came from nothing at all — the echo was captured as a user edit.
    await advance(10_000);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(false);
    expect(rig.canvasSync.isRecentDiskWrite(PATH)).toBe(false);
    expect(rig.persistence.isRecentDiskWrite()).toBe(false);

    const before = fingerprint(rig.doc);
    const idsBefore = nodeIdsIn(rig.doc);

    rig.emitModify(PATH);
    await settle();

    expect(fingerprint(rig.doc)).toBe(before);
    expect(nodeIdsIn(rig.doc)).toEqual(idsBefore);
    expect(declineLines(rig.logs).at(-1)).toContain("reason=echo");
  });

  it("T4 — the baseline is armed SYNCHRONOUSLY with the write: no clock moves between the write landing and the echo being recognised", async () => {
    // The charter names this as the ordering that becomes load-bearing under
    // WP91: with the timers gone, the byte breaker is the only thing covering the
    // instant after a write lands. If a producer ever advanced the baseline
    // asynchronously, the echo would be captured as a user edit and every peer
    // would get a spurious delta. So: flush, and WITHOUT advancing the clock or
    // running a single timer, deliver the echo.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("sync", remoteNode("sync", "sync")));
    const before = fingerprint(rig.doc);
    await rig.persistence.flush();
    const landed = rig.written.at(-1) as string;
    expect(rig.files.get(PATH)).toBe(landed);

    rig.emitModify(PATH);
    await settle(); // microtasks only — `advance` is deliberately not called

    expect(fingerprint(rig.doc)).toBe(before);
    expect(declineLines(rig.logs).at(-1)).toContain("reason=echo");
  });

  it("T3 — an echo repeated ten times over 10 s of clock never accumulates a single write", async () => {
    const exactBytes = rig.written.at(-1) as string;
    expect(rig.files.get(PATH)).toBe(exactBytes);
    const before = fingerprint(rig.doc);

    for (let i = 0; i < 10; i++) {
      rig.emitModify(PATH);
      await settle();
      await advance(1_000);
    }

    expect(fingerprint(rig.doc)).toBe(before);
    expect(declineLines(rig.logs).filter((l) => l.includes("reason=echo"))).toHaveLength(10);
    expect(rig.canvasSync.captureDeclineCounts().echo).toBe(10);
  });
});
