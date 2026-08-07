// WP91 / C91 AC1 — a local write that differs from our own last write is
// CAPTURED, at delta zero, with the mute provably held.
//
// THE DEFECT, restated as the thing this file has to reproduce: a user saves a
// shared `.canvas` while a remote change is being applied to it. The plugin has
// taken a per-path mute around its own write-back, so `vault-events.ts` returns
// before the file is ever read. The bytes stay on the writer's disk, the writer's
// OWN doc never learns about them, the peer never sees them, and there is no
// receipt of any kind. Measured live: LOST 11/12 at a 0.5-0.8 s delta.
//
// THE VACUITY RISKS THE CHARTER ATTACHED TO THIS AC, AND HOW EACH IS DISCHARGED:
//
//   (a) THE KILLER — "a test that calls `canvasSync.handleLocalModify(path)`
//       directly bypasses `vault-events.ts:232`, the gate that IS the defect, and
//       would be green against a completely untouched tree." Every row below
//       dispatches through `rig.emitModify`, which is the handler the REAL
//       `registerVaultEvents` registered on `vault.on("modify")`. The string
//       `handleLocalModify` does not appear in this file.
//   (b) "A test in which no mute was ever taken, so nothing was there to drop the
//       event." The mute is asserted `> 0` on the REAL `FileOpsManager` refcount
//       AT THE INSTANT OF THE WRITE, and T3 is the control that shows the
//       assertion is not free: the same fixture with no write-back taken reports
//       the refcount at zero, so a green T1 cannot be an accident of a mute that
//       was never held.
//   (c) is a live-rig risk (the marker write never landing on disk). Its headless
//       equivalent is asserted anyway: the differing bytes are read back off the
//       shared `files` map before the doc is inspected.
//
// THE MUTE IS NOT ARRANGED BY HAND. It is opened by a real remote delta reaching
// a real `CanvasPersistence`, which flushes, writes, and takes the refcount — the
// same sequence the live measurement drove. A test that called `mutePathEvents`
// itself would prove nothing about whether that sequence can produce the state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * Drive one remote change all the way to a landed disk write, leaving the mute
 * OPEN and both settle windows armed. Returns nothing: what matters is the state
 * afterwards, and every test asserts that state itself rather than trusting this.
 */
async function remoteChangeLands(rig: Rig, id: string, text: string): Promise<void> {
  applyRemoteDelta(rig.doc, (nodes) => nodes.set(id, remoteNode(id, text)));
  // DEBOUNCE_MS = 200: the flush this wakes is the write that takes the mute.
  await advance(200);
}

describe("WP91 AC1 — a real save survives the mute, at delta zero", () => {
  let rig: Rig;

  beforeEach(async () => {
    vi.useFakeTimers();
    rig = await createRig({ initial: { [PATH]: SEED } });
  });

  afterEach(() => {
    rig.destroy();
    vi.useRealTimers();
  });

  it("T1 — the user's save reaches the doc while the mute is held and both settle windows are armed", async () => {
    await remoteChangeLands(rig, "remote-1", "from the peer");

    // --- the preconditions, asserted, at the instant of the write -------------
    // If any of these is false the row proves nothing, so each is an assertion
    // and not a comment.
    expect(rig.written.length).toBeGreaterThan(0);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true); // the REAL refcount, > 0
    expect(rig.persistence.isRecentDiskWrite()).toBe(true); // settle window 1, armed
    expect(rig.canvasSync.isRecentDiskWrite(PATH)).toBe(true); // settle window 2 (S68)

    // --- the user saves, at delta ZERO ----------------------------------------
    const userSave = canvasJson([
      node("seed", "seed card"),
      node("user", "typed by the user", 999),
    ]);
    rig.files.set(PATH, userSave);
    expect(rig.files.get(PATH)).toBe(userSave); // the bytes really are on disk

    rig.emitModify(PATH);
    await settle();

    // --- the oracle is DOC STATE, never a log line ----------------------------
    expect(nodeIdsIn(rig.doc)).toContain("user");
    expect(rig.doc.getMap<never>("nodes").get("user")).toBeDefined();
    // and the mute was still held the whole way through, so the capture happened
    // DESPITE it rather than after it quietly expired.
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);
    // Nothing was declined: a capture and a decline are exclusive outcomes.
    expect(declineLines(rig.logs)).toHaveLength(0);
  });

  it("T2 — the remote node the mute was opened for is still there: the capture is a merge, not a clobber", async () => {
    await remoteChangeLands(rig, "remote-2", "peer text");
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

    // The user's save is written from a file that does NOT contain the remote
    // node yet — the ordinary shape of the race, and the one that would destroy
    // the peer's card if the capture were a whole-file replace.
    rig.files.set(PATH, canvasJson([node("seed", "seed card"), node("user", "user card", 900)]));
    rig.emitModify(PATH);
    await settle();

    expect(nodeIdsIn(rig.doc)).toContain("user");
    expect(nodeIdsIn(rig.doc)).toContain("remote-2");
  });

  it("T3 — CONTROL for vacuity (b): with no write-back taken, the refcount reads ZERO", async () => {
    // Same fixture, same path, no remote change — so `CanvasPersistence` never
    // flushed and never took the mute. If T1's `isPathMuted(PATH) === true` were
    // true for free, it would be true here too.
    expect(rig.written).toHaveLength(0);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(false);
    expect(rig.persistence.isRecentDiskWrite()).toBe(false);
    expect(rig.canvasSync.isRecentDiskWrite(PATH)).toBe(false);
  });

  it("T4 — the delta ladder: every rung inside the old 750 ms window captures", async () => {
    // B44 measured LOST at 0.0-0.8 s and OK from 0.9 s. The window is
    // MAX_WAIT_MS (500) + the 250 ms settle = 750 ms, so 0 / 100 / 300 / 500 /
    // 800 ms all sat inside it. Each rung gets its own remote change, so each is
    // measured against a freshly re-armed window rather than a decaying one.
    for (const [index, delta] of [0, 100, 300, 500, 800].entries()) {
      const id = `ladder-${index}`;
      await remoteChangeLands(rig, `peer-${index}`, `peer ${index}`);
      expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

      await advance(delta);

      rig.files.set(PATH, canvasJson([node("seed", "seed card"), node(id, `rung ${index}`, 500)]));
      rig.emitModify(PATH);
      await settle();

      expect(nodeIdsIn(rig.doc)).toContain(id);
    }
  });

  it("T5 — the flag still owns the branch: with useCanvasBinding ON nothing is captured off the file", async () => {
    // The single most tempting wrong answer in this charter is flipping this
    // flag, which would HIDE the defect by routing capture off the file path.
    // The flag is untouched, it is still `false` by default, and turning it on
    // still stops the file→CRDT read — asserted so a later reader can see the
    // fix did not smuggle the capture past it.
    expect(rig.settings.useCanvasBinding).toBe(false);
    await remoteChangeLands(rig, "remote-5", "peer text");
    rig.settings.useCanvasBinding = true;

    rig.files.set(PATH, canvasJson([node("seed", "seed card"), node("bound", "bound", 700)]));
    rig.emitModify(PATH);
    await settle();

    expect(nodeIdsIn(rig.doc)).not.toContain("bound");
    // and it was NOT redirected to the text path (US5's two-writer trap).
    expect(rig.handleLocalTextModify).not.toHaveBeenCalled();
  });
});
