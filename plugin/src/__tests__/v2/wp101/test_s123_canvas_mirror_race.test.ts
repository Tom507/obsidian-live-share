// S123 — A HOST-CREATED `.canvas` REACHED ONE GUEST AND NOT THE OTHER.
//
// Live: two `.canvas` tripwires created on the host materialised on one guest
// and timed out at 45 s on another. The winner took 23.44 s with
// `useCanvasBinding` OFF and 0.62 s with it ON. A `.md` control from the same
// client in the same second arrived in <=0.11 s, so the transport was fine. And
// a guest's doc snapshot showed the canvas NODE while no file existed on its
// disk — the CRDT arrived; the file did not.
//
// THE TWO ORDERINGS, both on the host and both in `CanvasSync.subscribe`:
//
//   1. `resolveGuidForSubscribe` MINTS and BINDS the guid, which writes the
//      manifest — this is what notifies every guest.
//   2. ...only afterwards does the host `getDoc`, `await waitForSync`, and
//      `applyCanvasToYMaps` — this is what the guest actually needs.
//
// The guest's mirror pass is armed ONLY by manifest key changes, so it is woken
// by (1) and requires (2). Its `docHasRecords` probe is a ONE-SHOT read of a
// value still in flight. A guest whose probe lands between (1) and (2) returns
// SKIP_NO_SOURCE — and since the host performs no further manifest write for
// that path, NOTHING re-arms and the file never arrives for the whole session.
// That is the entire defect: not a missing path, a probe racing a write.
//
// AND IT IS LITERALLY THE S119 SIGNAL, one layer over. `CanvasSync.subscribe`
// awaits `SyncManager.waitForSync(docId)` for a BRAND-NEW `__canvas__:<guid>`
// doc id. `handleSubscribed` sets `synced = true` the moment the relay reports
// `peerCount === 0` — which is the common case for a doc id no peer has ever
// subscribed to — so the await returns instantly on an EMPTY doc and the window
// is as wide as the network. Verified against the real `SyncManager` below.
//
// THE FIX replaces the probe with the event it was approximating: a one-shot
// watcher on the doc's record maps re-runs the pass when records actually land.
//
// AC4 — DETERMINISM IS ASSERTED OVER REPEATED RUNS, NOT ONE. A race closed by
// luck and a race closed by design are indistinguishable at n=1. Every ordering
// row below runs ITERATIONS times and asserts every single run materialised.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// `main.ts` pulls in Obsidian classes the shared double does not export, and
// `UserPickerModal` extends one at MODULE SCOPE. WP85/S116 precedent.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    addItem(_cb: any) {
      return this;
    }
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    showAtMouseEvent(_e: any) {}
  }
  return {
    ...actual,
    Menu: Stub,
    FuzzySuggestModal: Stub,
    SuggestModal: Stub,
    requestUrl: async () => ({ status: 200, json: {}, text: "" }),
    setIcon: () => {},
    addIcon: () => {},
  };
});

import {
  CANVAS_RECORD_MAPS,
  type CanvasMirrorDeps,
  docHasRecords,
  mirrorSharedCanvases,
} from "../../../files/canvas-mirror";
import { MIRROR_VERDICT } from "../../../files/canvas-mirror-decision";
import { DEFAULT_SETTINGS } from "../../../types";

/** AC4 — stated, not implied. Every race row runs this many times. */
const ITERATIONS = 60;

const CANVAS = "_liveshare-test/board.canvas";
const GUID = "0123456789abcdef0123456789abcdef";

/**
 * A guest whose mirror pass runs while the host's seed is still in flight.
 *
 * `seedAfterPass` reproduces the losing ordering: the host's records are
 * applied to the doc only AFTER the guest's pass has already probed. Under the
 * old code that guest skipped permanently.
 */
function makeRig(options: { seedDelayTicks: number }) {
  const doc = new Y.Doc();
  const files = new Set<string>();
  const materialised: string[] = [];
  const watched: string[] = [];
  let rearm: (() => void) | null = null;

  const deps: CanvasMirrorDeps = {
    role: "guest",
    listManifestPaths: () => [CANVAS],
    localFileExists: async (path) => files.has(path),
    // The host published the guid — that is the event that woke this pass.
    guidForPath: () => GUID,
    canvasSync: {
      isSubscribed: () => true,
      subscribe: async () => {},
      getCanvasDocHandle: () => ({ doc }) as never,
    } as never,
    materialise: async (path) => {
      materialised.push(path);
      files.add(path); // the writer's cold open creates the file
    },
    watchForRecords: (path) => {
      watched.push(path);
      // The production watcher: observe the record maps, re-run once on arrival.
      const maps = CANVAS_RECORD_MAPS.map((name) => doc.getMap(name));
      let fired = false;
      const onChange = () => {
        if (fired) return;
        if (!maps.some((m) => m.size > 0)) return;
        fired = true;
        for (const m of maps) m.unobserve(onChange);
        rearm?.();
      };
      for (const m of maps) m.observe(onChange);
      onChange();
    },
    logger: { log: () => {}, warn: () => {} },
  };

  /** The host's seed, landing `seedDelayTicks` microtasks after the pass starts. */
  async function seedLater() {
    for (let i = 0; i < options.seedDelayTicks; i++) await Promise.resolve();
    doc.getMap("nodes").set("n1", { id: "n1", type: "text" } as never);
  }

  async function run() {
    let passes = 0;
    const pass = async (): Promise<void> => {
      passes++;
      const report = await mirrorSharedCanvases(deps);
      return void report;
    };
    // `rearm` is what `armCanvasMirrorPass` does in production.
    let pending: Promise<void> = Promise.resolve();
    rearm = () => {
      pending = pending.then(pass);
    };
    const first = pass();
    const seed = seedLater();
    await Promise.all([first, seed]);
    await pending;
    // Let any re-arm chain settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await pending;
    return { passes, materialised, watched, files };
  }

  return { run, doc, files, materialised, watched };
}

describe("S123 — the losing ordering now materialises, every time", () => {
  it(`AC4 — the seed lands AFTER the probe, ${ITERATIONS} runs, all materialise`, async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Vary where the seed lands relative to the pass, so the row is not
      // pinned to one interleaving. Under the old code every one of these
      // skipped permanently.
      const rig = makeRig({ seedDelayTicks: i % 7 });
      const out = await rig.run();
      outcomes.push(out.materialised.includes(CANVAS));
    }
    // EVERY run, not most. A single failure here is the defect back.
    expect(outcomes).toHaveLength(ITERATIONS);
    expect(outcomes.every(Boolean)).toBe(true);
    expect(outcomes.filter(Boolean)).toHaveLength(ITERATIONS);
  });

  it(`AC4 — the winning ordering still works, ${ITERATIONS} runs`, async () => {
    // The seed has already landed before the pass. This ordering worked before
    // the fix and must keep working: the watcher must not have replaced the
    // direct path.
    const outcomes: boolean[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const rig = makeRig({ seedDelayTicks: 0 });
      rig.doc.getMap("nodes").set("pre", { id: "pre" } as never);
      const out = await rig.run();
      outcomes.push(out.materialised.includes(CANVAS));
    }
    expect(outcomes.every(Boolean)).toBe(true);
  });

  it("the watcher is installed exactly for the premature skip, and only once", async () => {
    const rig = makeRig({ seedDelayTicks: 3 });
    const out = await rig.run();
    // One path, one watcher — repeated passes must not stack observers.
    expect(out.watched).toEqual([CANVAS]);
  });

  it("VACUITY CONTROL — without the watcher the losing ordering never materialises", async () => {
    // Proves the rows above measure the FIX and not some other property of the
    // harness: with `watchForRecords` absent — exactly the pre-fix deps object —
    // an empty doc yields SKIP_NO_SOURCE and `materialise` is never called.
    // That verdict is what stranded the losing guest for the whole session.
    const doc = new Y.Doc();
    expect(docHasRecords(doc)).toBe(false);
    const report = await mirrorSharedCanvases({
      role: "guest",
      listManifestPaths: () => [CANVAS],
      localFileExists: async () => false,
      guidForPath: () => GUID,
      canvasSync: {
        isSubscribed: () => true,
        subscribe: async () => {},
        getCanvasDocHandle: () => ({ doc }) as never,
      } as never,
      materialise: async () => {
        throw new Error("must not materialise with an empty doc");
      },
      // no watchForRecords — the pre-fix deps
      logger: { log: () => {}, warn: () => {} },
    });
    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    expect(report.entries[0]?.outcome).toBe("skipped");
  });

  it("a settled skip does NOT install a watcher", async () => {
    // The user already has the file, or no identity is published. Those are
    // final answers, not premature ones, and watching them would be a leak.
    for (const scenario of [
      { localFileExists: true, guid: GUID },
      { localFileExists: false, guid: null },
    ]) {
      const watched: string[] = [];
      const doc = new Y.Doc();
      await mirrorSharedCanvases({
        role: "guest",
        listManifestPaths: () => [CANVAS],
        localFileExists: async () => scenario.localFileExists,
        guidForPath: () => scenario.guid,
        canvasSync: {
          isSubscribed: () => true,
          subscribe: async () => {},
          getCanvasDocHandle: () => ({ doc }) as never,
        } as never,
        materialise: async () => {},
        watchForRecords: (p) => watched.push(p),
        logger: { log: () => {}, warn: () => {} },
      });
      expect(watched).toEqual([]);
    }
  });
});

describe("S123 — the readiness signal is literally the S119 one", () => {
  it("waitForSync resolves instantly on a brand-new canvas doc id (peerCount === 0)", async () => {
    // `CanvasSync.subscribe` awaits this for `__canvas__:<guid>`, a doc id no
    // relay has ever seen. `peerCount === 0` is therefore the COMMON case, not
    // an edge case, which is what makes the S123 window as wide as the network.
    const { SyncManager } = await import("../../../sync/sync");
    const manager = new SyncManager({ ...DEFAULT_SETTINGS, roomId: "r" } as never);
    const docId = `__canvas__:${GUID}`;
    const doc = new Y.Doc();
    (manager as unknown as { docs: Map<string, Y.Doc> }).docs.set(docId, doc);

    (
      manager as unknown as { handleSubscribed(id: string, payload: Uint8Array): void }
    ).handleSubscribed(docId, new Uint8Array());

    expect((manager as unknown as { synced: Map<string, boolean> }).synced.get(docId)).toBe(true);
    // Declared synced, and empty — the two facts that compose into S123.
    expect(docHasRecords(doc)).toBe(false);
    await expect(manager.waitForSync(docId)).resolves.toBeUndefined();
  });
});

/**
 * THE PRODUCTION WATCHER ITSELF.
 *
 * Everything above drives `mirrorSharedCanvases` (production) but supplies its
 * own `watchForRecords`. That proves the mirror ASKS for a re-arm; it proves
 * nothing about the thing that answers. If `watchCanvasForRecords` were deleted
 * from `main.ts`, every row above would still pass and the feature would be
 * inert — exactly the failure this run already found once (S116 B14), so it is
 * closed here rather than rediscovered.
 *
 * `LiveSharePlugin.prototype.watchCanvasForRecords` is invoked with a fake
 * `this`, the WP85 precedent, so the body under test is the shipped one.
 */
describe("S123 — the real watchCanvasForRecords re-arms the pass", () => {
  async function realWatcher() {
    const { default: LiveSharePlugin } = await import("../../../main");
    const doc = new Y.Doc();
    const rearms: number[] = [];
    const watchers = new Map<string, () => void>();
    // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
    const fake = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
      canvasRecordWatchers: watchers,
      canvasSync: { getCanvasDocHandle: () => ({ doc }) },
      logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      armCanvasMirrorPass: () => rearms.push(1),
    });
    const call = (path: string) =>
      (
        LiveSharePlugin as never as {
          prototype: { watchCanvasForRecords(p: string): void };
        }
      ).prototype.watchCanvasForRecords.call(fake, path);
    return { doc, rearms, watchers, call };
  }

  it(`re-arms exactly once when records arrive, over ${ITERATIONS} runs`, async () => {
    const counts: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const w = await realWatcher();
      w.call(CANVAS);
      expect(w.rearms).toHaveLength(0); // nothing yet — the doc is empty
      w.doc.getMap(i % 2 === 0 ? "nodes" : "edges").set("r", { id: "r" } as never);
      counts.push(w.rearms.length);
      // A second record must not re-arm again.
      w.doc.getMap("nodes").set("r2", { id: "r2" } as never);
      expect(w.rearms).toHaveLength(counts[counts.length - 1] as number);
    }
    expect(counts).toHaveLength(ITERATIONS);
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it("re-arms immediately when the records landed before the watcher was installed", async () => {
    // The window this closes is precisely between the mirror's probe and the
    // watcher's installation — a third ordering, and it must not strand either.
    const w = await realWatcher();
    w.doc.getMap("nodes").set("already", { id: "already" } as never);
    w.call(CANVAS);
    expect(w.rearms).toHaveLength(1);
  });

  it("installs one watcher per path and disposes it on fire", async () => {
    const w = await realWatcher();
    w.call(CANVAS);
    w.call(CANVAS);
    expect(w.watchers.size).toBe(1);
    w.doc.getMap("nodes").set("r", { id: "r" } as never);
    // Disposed, so a later session teardown has nothing stale to clean.
    expect(w.watchers.size).toBe(0);
  });

  it("a doc that cannot be resolved installs nothing rather than throwing", async () => {
    const { default: LiveSharePlugin } = await import("../../../main");
    const watchers = new Map<string, () => void>();
    // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
    const fake = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
      canvasRecordWatchers: watchers,
      canvasSync: { getCanvasDocHandle: () => null },
      logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      armCanvasMirrorPass: () => {},
    });
    expect(() =>
      (
        LiveSharePlugin as never as {
          prototype: { watchCanvasForRecords(p: string): void };
        }
      ).prototype.watchCanvasForRecords.call(fake, CANVAS),
    ).not.toThrow();
    expect(watchers.size).toBe(0);
  });
});

describe("S123 — why break B30 reddens nothing (the subsumption, pinned)", () => {
  it("the pre-gate already refuses a guest with no resolvable identity", async () => {
    // `mirrorOne` early-returns on `!admitsCanvasMirror(pre)`, so the watcher
    // condition's `identityResolves === true` conjunct is unreachable-when-false
    // and breaking it changes no observable behaviour. That is a LEGITIMATE
    // "break reddened nothing" — one conjunct subsumed by another — and this row
    // is what makes the claim falsifiable instead of an assertion in a comment.
    const { admitsCanvasMirror } = await import("../../../files/canvas-mirror-decision");
    expect(admitsCanvasMirror({ role: "guest", localFileExists: false, identityResolves: false }))
      .toBe(false);
    // …and the same probe WITH an identity is admitted, so the row above is not
    // passing because the gate refuses everything.
    expect(admitsCanvasMirror({ role: "guest", localFileExists: false, identityResolves: true }))
      .toBe(true);
  });
});
