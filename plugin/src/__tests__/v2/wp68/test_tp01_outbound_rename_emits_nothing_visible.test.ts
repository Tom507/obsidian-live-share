// WP68 / C68 AC1 — `FileOpsManager.onFileRename` emits NO `rename` file-op when
// either endpoint is a sidecar path, in either direction, on BOTH exits of
// `emitOp`.
//
// ── WHY THIS IS ASSERTED AT THE SEAM AND NOT AT THE VAULT EVENT ───────────────
// The charter is explicit: the outbound arm depends on Obsidian emitting a vault
// `rename` whose destination lies under `.obsidian/`, and that has NOT been
// observed in a real Obsidian instance and cannot be until the T3 gate runs. So
// AC1 is written against `onFileRename` DIRECTLY, at the seam it actually
// guards, where it is falsifiable today. Nothing in this file depends on
// Obsidian's event behaviour, and nothing in it should be read as evidence that
// the outbound direction was observed end-to-end.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ───────────────────────────────────────────
// Delete the `isSidecarPath(...)` guard block from `FileOpsManager.onFileRename`
// (`files/file-ops.ts`). Every REFUSAL case below reddens; the positive controls
// stay green, which is what stops a guard that refuses EVERYTHING from passing.
// VERIFIED RED — see the report's break table for the exact messages.
//
// ── THE TWO EXITS ────────────────────────────────────────────────────────────
// `emitOp` has two: the online `sendOp` and, when offline, `offlineQueue`. A
// guard on the first alone turns the defect into a DELAYED delivery of the same
// op on reconnect, which is why the charter names the queue by name. Both are
// asserted for every refusal here, in the same case.
//
// ── THE DISCRIMINATING INPUT ─────────────────────────────────────────────────
// NOT `.yhistory`. `isTextFile` already stops a `.yhistory` one line early at
// several seams, and this run has already shipped a suite that was green against
// an untouched tree for exactly that reason. Every case uses `index.json` or a
// `.md` UNDER the sidecar directory, so the guard added by this WP is the only
// thing in the tree that can produce the refusal.

import { beforeEach, describe, expect, it } from "vitest";

import { SIDECAR_DIR } from "../../../files/canvas-sidecar";
import {
  DEEP_NOTE,
  type OutboundRig,
  SHARED_CANVAS,
  SHARED_NOTE,
  SIDECAR_INDEX,
  SIDECAR_NOTE,
  SIDECAR_STORE,
  createOutboundRig,
} from "./harness";

describe("WP68 AC1 — the outbound rename is refused at both endpoints, in both directions", () => {
  let rig: OutboundRig;

  beforeEach(() => {
    rig = createOutboundRig();
  });

  it("POSITIVE CONTROL — an ordinary rename still emits, so 'nothing emitted' means something", async () => {
    rig.rename(SHARED_NOTE, DEEP_NOTE);
    // The emit is chained behind the per-path send queue, so it lands on a
    // microtask. Drained here — no wall clock, no timing constant.
    await Promise.resolve();
    await Promise.resolve();

    expect(
      rig.sent,
      "the fixture emits nothing at all — every refusal case below is vacuous",
    ).toHaveLength(1);
    expect(rig.sent[0]).toEqual({
      type: "rename",
      oldPath: SHARED_NOTE,
      newPath: DEEP_NOTE,
    });
    expect(rig.manager.getSidecarRenameRefusals()).toBe(0);
  });

  const refusals: Array<[string, string, string]> = [
    ["shared -> sidecar index.json", SHARED_NOTE, SIDECAR_INDEX],
    ["sidecar index.json -> shared", SIDECAR_INDEX, SHARED_NOTE],
    ["shared -> a .md under the sidecar directory", SHARED_NOTE, SIDECAR_NOTE],
    ["a .md under the sidecar directory -> shared", SIDECAR_NOTE, SHARED_NOTE],
    ["a shared .canvas -> the sidecar directory", SHARED_CANVAS, SIDECAR_STORE],
    ["the sidecar directory -> a shared .canvas", SIDECAR_STORE, SHARED_CANVAS],
  ];

  for (const [label, oldPath, newPath] of refusals) {
    it(`REFUSED (${label}) — nothing on the sink, and the manager says it refused`, async () => {
      rig.rename(oldPath, newPath);
      await Promise.resolve();
      await Promise.resolve();

      expect(rig.sent, `a rename op reached the wire for ${oldPath} -> ${newPath}`).toEqual([]);
      // The refusal is NAMED, not a silent drop. This is state, not a log
      // string, so it is a legitimate oracle rather than a signature for humans.
      expect(rig.manager.getSidecarRenameRefusals()).toBe(1);
    });

    it(`REFUSED (${label}) — and nothing on the OFFLINE QUEUE either`, async () => {
      // The second exit of `emitOp`. A guard on the online send alone would let
      // this op sit here and be delivered verbatim on reconnect.
      rig.manager.setOnline(false);
      rig.rename(oldPath, newPath);
      await Promise.resolve();
      await Promise.resolve();

      expect(
        rig.manager.getOfflineState().queueDepth,
        "the op is queued for delivery on reconnect",
      ).toBe(0);
      expect(rig.sent).toEqual([]);

      // …and it is still not delivered when the link comes back.
      rig.manager.setOnline(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(rig.sent, "the queued op was delivered on reconnect").toEqual([]);
    });
  }

  it("POSITIVE CONTROL for the queue — an ordinary rename DOES queue while offline, and drains", async () => {
    // Without this, `queueDepth === 0` above proves nothing: it is also what an
    // offline queue that never accepts anything would report.
    rig.manager.setOnline(false);
    rig.rename(SHARED_NOTE, DEEP_NOTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(rig.manager.getOfflineState().queueDepth).toBe(1);
    expect(rig.sent).toEqual([]);

    rig.manager.setOnline(true);
    expect(rig.sent).toEqual([{ type: "rename", oldPath: SHARED_NOTE, newPath: DEEP_NOTE }]);
  });

  it("the refusal is COUNTED once per refused rename and never for an admitted one", async () => {
    rig.rename(SHARED_NOTE, SIDECAR_INDEX);
    rig.rename(SIDECAR_NOTE, SHARED_CANVAS);
    rig.rename(SHARED_NOTE, DEEP_NOTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(rig.manager.getSidecarRenameRefusals()).toBe(2);
    expect(rig.sent).toHaveLength(1);
  });

  it("the guard does not depend on the sidecar file's EXTENSION", async () => {
    // A directory test, not an extension test (WP24's contract). An unknown or
    // future sidecar file type has to be covered without touching the guard.
    rig.rename(SHARED_NOTE, `${SIDECAR_DIR}/whatever.future-ext`);
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.sent).toEqual([]);
    expect(rig.manager.getSidecarRenameRefusals()).toBe(1);
  });
});
