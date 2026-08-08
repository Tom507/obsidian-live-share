// WP122 B4 — THE BIND DOES NOT DESTROY, ON A BOARD THAT IS ALREADY DIVERGENT.
//
// This is the population WP122 newly touches and the entire reason WP121 goes
// first. WP122 fires the `doc-wins` path automatically, on every host-held
// canvas in the manifest, at the next mirror pass — on boards that are already
// divergent today, all of them at once.
//
// 🔴 THE ORDERING PLANT (charter §5), and it is the plant most likely to expose
// the failure mode THIS package can introduce:
//
//   > Hoist the bind ABOVE the subscribe. The document is then empty-or-peer-
//   > only at cold open, the host's own records have not been merged in, and the
//   > flush writes a board MISSING EVERYTHING THE HOST AUTHORED.
//
// `tp03d` runs that reordering as a STANDING row rather than as a one-off manual
// plant, because the ordering that prevents the destruction is not enforced by
// any type — only by the order of two statements inside one function. Nothing in
// the codebase catches a future refactor that reorders them except this row.
// (The same reordering was also planted in the product source and shown red; see
// the break table in `ImplementationReport_WP122.md`.)

import { afterEach, describe, expect, it } from "vitest";

import { mirrorSharedCanvases } from "../../../files/canvas-mirror";
import {
  BOARD,
  authorSpelling,
  createHostWorld,
  docIds,
  node,
  recordIdsIn,
} from "./harness";

let world: ReturnType<typeof createHostWorld> | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

describe("WP122 B4 — the union case: the fix, and nothing lost", () => {
  it("tp03a: the doc's peer card lands on disk AND every record the file uniquely held survives", async () => {
    // The host authored `h1` and `h2`; the peers added `g1`. The file knows
    // nothing of `g1`; the document knows nothing of `h1`/`h2` until the seed.
    world = createHostWorld({
      file: authorSpelling([node("h1"), node("h2")]),
      peer: { nodes: [node("g1")] },
    });
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["h1", "h2"]);

    await mirrorSharedCanvases(world.deps);

    // The union, on disk. Both halves asserted: the arrival AND the survival.
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1", "h2"]);
    expect(docIds(world.localDoc() as never).nodes).toStrictEqual(["g1", "h1", "h2"]);
    // Nothing was preserved beside the share, because nothing was discarded.
    expect(world.conflictCopies()).toStrictEqual([]);
  });

  it("tp03b: edges survive the same way — an edge is nothing but references", async () => {
    world = createHostWorld({
      file: authorSpelling(
        [node("h1"), node("h2")],
        [{ id: "e1", fromNode: "h1", fromSide: "right", toNode: "h2", toSide: "left" }],
      ),
      peer: { nodes: [node("g1")] },
    });

    await mirrorSharedCanvases(world.deps);

    const on = recordIdsIn(world.disk(BOARD));
    expect(on.nodes).toStrictEqual(["g1", "h1", "h2"]);
    expect(on.edges).toStrictEqual(["e1"]);
  });
});

describe("WP122 B4 — the dangerous case: WP121's guard must fire", () => {
  /**
   * THE PRODUCTION PATH, not a contrivance. `mirrorOne` skips the subscribe when
   * the path is ALREADY subscribed, so a mid-session pass runs no host seed: the
   * document is whatever the relay holds, and the file on disk may name records
   * it has never heard of. That is the `doc-wins` trapdoor, and it is the
   * population this package newly hands to the writer.
   */
  it("tp03c: the file's unknown records are copied beside the share BEFORE the projection replaces them", async () => {
    world = createHostWorld({
      // `f9` exists only on this host's disk. The document has never seen it.
      file: authorSpelling([node("h1"), node("f9")]),
      peer: { nodes: [node("h1"), node("g1")] },
      preSubscribed: true,
    });
    // The precondition of the dangerous case, stated: the doc does NOT know f9.
    expect(docIds(world.localDoc() as never).nodes).toStrictEqual(["g1", "h1"]);
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["f9", "h1"]);

    await mirrorSharedCanvases(world.deps);
    expect(world.hasWriter(BOARD)).toBe(true);

    // `doc-wins` did what `doc-wins` does — the canvas path now holds the
    // document's projection, and `f9` is not in it. Who wins is unchanged by
    // WP121 and unchanged by WP122.
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1"]);

    // 🔴 THE SAFETY DEMONSTRATION: WP121's guard covers the boards WP122's bind
    // newly attaches writers to. Measured on the copy, not assumed from wiring.
    const copies = world.conflictCopies();
    expect(copies).toHaveLength(1);
    expect(recordIdsIn(world.disk(copies[0])).nodes).toStrictEqual(["f9", "h1"]);
  });

  it("tp03c2: POSITIVE CONTROL — with the door unwired the same board loses `f9` with no copy at all", async () => {
    // Without this row tp03c cannot distinguish "the guard fired" from "the
    // harness happens to keep a second file around". The ONLY difference here
    // is `preservation: false`, i.e. the pre-WP121 composition.
    world = createHostWorld({
      file: authorSpelling([node("h1"), node("f9")]),
      peer: { nodes: [node("h1"), node("g1")] },
      preSubscribed: true,
      preservation: false,
    });

    await mirrorSharedCanvases(world.deps);

    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1"]);
    expect(world.conflictCopies()).toStrictEqual([]);
  });
});

describe("WP122 B4 — the ordering that is not enforced by any type", () => {
  it("tp03d: 🔴 the bind hoisted ABOVE the subscribe writes a board missing every host record", async () => {
    // THE STANDING REGRESSION ROW. Same inputs as tp03a; the single difference
    // is that the bind runs before the host's file is merged into the document.
    world = createHostWorld({
      file: authorSpelling([node("h1"), node("h2")]),
      peer: { nodes: [node("g1")] },
      hoistBindAboveSubscribe: true,
    });

    await mirrorSharedCanvases(world.deps);

    // The destruction, NAMED — not "the ids differ" but which ones are gone.
    const after = recordIdsIn(world.disk(BOARD)).nodes;
    expect(after).not.toContain("h1");
    expect(after).not.toContain("h2");
    expect(after).toStrictEqual(["g1"]);

    // And WP121 caught it — which is the point of the precondition, and the
    // reason this ordering bug would be survivable rather than fatal.
    const copies = world.conflictCopies();
    expect(copies).toHaveLength(1);
    expect(recordIdsIn(world.disk(copies[0])).nodes).toStrictEqual(["h1", "h2"]);
  });

  it("tp03e: the correct order is what tp03a runs, and the trace says so", async () => {
    // The discriminator for tp03d: the two rows differ in ONE observable, the
    // position of `bind` in the trace.
    world = createHostWorld({
      file: authorSpelling([node("h1"), node("h2")]),
      peer: { nodes: [node("g1")] },
    });
    await mirrorSharedCanvases(world.deps);
    expect(world.trace.indexOf(`host-seed-merged:${BOARD}`)).toBeLessThan(
      world.trace.indexOf(`bind:${BOARD}`),
    );

    world.destroy();
    world = createHostWorld({
      file: authorSpelling([node("h1"), node("h2")]),
      peer: { nodes: [node("g1")] },
      hoistBindAboveSubscribe: true,
    });
    await mirrorSharedCanvases(world.deps);
    expect(world.trace.indexOf(`bind:${BOARD}`)).toBeLessThan(
      world.trace.indexOf(`host-seed-merged:${BOARD}`),
    );
  });
});
