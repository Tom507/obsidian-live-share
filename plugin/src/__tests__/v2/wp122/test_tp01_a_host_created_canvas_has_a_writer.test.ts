// WP122 B1 — A HOST-CREATED CANVAS HAS A WRITER, WITHOUT A HUMAN.
//
// THE PLANTS THIS ROW IS FALSIFIED BY (charter §5, workflow §3.1):
//
//   1. Delete the `PUBLISH_AND_BIND_WRITER` row from `admitsCanvasMirror`
//      (`canvas-mirror-decision.ts`). The path is skipped BEFORE
//      `decideCanvasMirror` is ever asked — WP117 hit this exact wall — and
//      `hasWriter` stays false.
//   2. Return the new verdict and never execute the bind (delete the
//      `await deps.bindHostWriter(path)` statement in `canvas-mirror.ts`'s host
//      arm). This is `S160`'s shape: publication unconditional while the write
//      that would make it true is conditional, and it is easy to ship by
//      accident because the verdict and the effect live in different files. The
//      receipt still says `bound`; `hasWriter` says false.
//
// THE ORACLE IS THE WRITER REGISTRY, NEVER `canvas.mirror` — charter B1, and the
// reason is `S138`: throughout the 240-second stall the host's mirror read
// `role=host considered=14 published=14 failed=0`, a completely healthy-looking
// pass on a peer whose file was 176 bytes and two records behind its own
// document. `published` means "the guid is bound" and nothing more.

import { afterEach, describe, expect, it } from "vitest";

import { mirrorSharedCanvases } from "../../../files/canvas-mirror";
import { MIRROR_VERDICT, decideCanvasMirror } from "../../../files/canvas-mirror-decision";
import { BOARD, authorSpelling, createHostWorld, node } from "./harness";

let world: ReturnType<typeof createHostWorld> | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

describe("WP122 B1 — the host's own board is bound to the single writer", () => {
  it("tp01a: a board the host holds and nobody opened has a writer after one pass", async () => {
    world = createHostWorld({ file: authorSpelling([node("h1")]) });
    // The precondition, stated rather than assumed: nothing is attached yet.
    expect(world.hasWriter(BOARD)).toBe(false);

    const report = await mirrorSharedCanvases(world.deps);

    // THE CRITERION, read off the writer's own state.
    expect(world.hasWriter(BOARD)).toBe(true);
    // And the receipt agrees — but it is corroboration, not the oracle.
    expect(report.entries[0].verdict).toBe(MIRROR_VERDICT.PUBLISH_AND_BIND_WRITER);
    expect(report.entries[0].outcome).toBe("bound");
    expect(report.bound).toBe(1);
    // `bound` is counted APART from `published`: collapsing them is exactly the
    // reading that made S138's healthy-looking pass unfalsifiable.
    expect(report.published).toBe(0);
  });

  it("tp01b: no human opened anything — the bind is not a leaf event", async () => {
    // The live measurement this package exists for converged in 0.00 s "the
    // instant a human opened the board". Nothing in this test opens a view,
    // mounts an adapter or fires a layout change; the only input is the pass.
    world = createHostWorld({ file: authorSpelling([node("h1")]) });
    await mirrorSharedCanvases(world.deps);
    expect(world.hasWriter(BOARD)).toBe(true);
    expect(world.trace).toStrictEqual([
      `subscribe:host:${BOARD}`,
      `host-seed-merged:${BOARD}`,
      `bind:${BOARD}`,
    ]);
  });

  it("tp01c: a second pass does not attach a second writer", async () => {
    // Re-entrancy is real: the attach awaits the cold open while
    // `syncCanvasPresences` fires on `layout-change` and `active-leaf-change`.
    // `hasCanvasWriter` is the single definition of "already attached" and the
    // harness models exactly that guard.
    world = createHostWorld({ file: authorSpelling([node("h1")]) });
    await mirrorSharedCanvases(world.deps);
    const first = world.writerFor(BOARD);
    await mirrorSharedCanvases(world.deps);
    expect(world.writerFor(BOARD)).toBe(first);
  });

  it("tp01d: POSITIVE CONTROL — a deps object with no bind seam behaves exactly as it did before WP122", async () => {
    // Not a vacuity check bolted on: this IS the degradation contract. Every
    // pre-WP122 caller and every pre-WP122 test double is such an object, which
    // is why this package changed no existing verdict.
    world = createHostWorld({ file: authorSpelling([node("h1")]), withoutBindSeam: true });
    const report = await mirrorSharedCanvases(world.deps);
    expect(report.entries[0].verdict).toBe(MIRROR_VERDICT.PUBLISH);
    expect(report.entries[0].outcome).toBe("published");
    expect(report.published).toBe(1);
    expect(report.bound).toBe(0);
    expect(world.hasWriter(BOARD)).toBe(false);
    // …and the file was never touched. AC4 survives literally on this arm.
    expect(world.writes).toStrictEqual([]);
  });

  it("tp01e: a host that does NOT hold the file still skips, bind seam or not", async () => {
    // B6 — the fail-closed `localFileExists === true` clause is untouched by
    // this package. An unanswered probe must not make the host subscribe, and
    // therefore seed, a path it may not hold.
    world = createHostWorld({ file: undefined });
    const report = await mirrorSharedCanvases(world.deps);
    expect(report.entries[0].verdict).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    expect(report.entries[0].outcome).toBe("skipped");
    expect(world.hasWriter(BOARD)).toBe(false);

    for (const value of [undefined, null, "true", 1]) {
      expect(
        decideCanvasMirror({
          role: "host",
          localFileExists: value as never,
          identityResolves: true,
          docHasRecords: true,
          bindsHostWriter: true,
        }),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    }
  });

  it("tp01f: the capability is read `=== true`, so an unanswered probe never binds", async () => {
    for (const value of [undefined, null, "true", 1, 0, false]) {
      expect(
        decideCanvasMirror({
          role: "host",
          localFileExists: true,
          identityResolves: true,
          docHasRecords: true,
          bindsHostWriter: value as never,
        }),
      ).toBe(MIRROR_VERDICT.PUBLISH);
    }
    expect(
      decideCanvasMirror({
        role: "host",
        localFileExists: true,
        identityResolves: true,
        docHasRecords: true,
        bindsHostWriter: true,
      }),
    ).toBe(MIRROR_VERDICT.PUBLISH_AND_BIND_WRITER);
  });
});
