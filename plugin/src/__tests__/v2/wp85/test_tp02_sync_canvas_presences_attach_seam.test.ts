// WP85 / AC2 (second half) — THE SEAM. The pure verdict is worth nothing if
// nothing consults it, so this file drives the REAL `syncCanvasPresences` from
// `plugin/src/main.ts` over a fake workspace and counts `attachCanvasWriter`
// calls PER PATH.
//
// HOW THE PRODUCTION CODE IS REACHED. `syncCanvasPresences` is a private method
// on `LiveSharePlugin`; constructing the plugin would drag in Obsidian's whole
// runtime. So the method is invoked off the prototype with a fake `this` —
// `LiveSharePlugin.prototype["syncCanvasPresences"].call(fake)`. The loop body
// under test is therefore the shipped code, byte for byte; only its
// collaborators are doubles. Replacing it with a re-implementation of the loop
// would make every row here vacuous, which is the exact failure this project has
// found ten times.
//
// THE ROW THAT WAS RED BEFORE THE REPAIR: `an ALREADY-SUBSCRIBED shared canvas
// leaf attaches a writer`. On the pre-WP85 tree the only leaf-driven attach sat
// inside the lazy-subscribe branch, gated on `!isSubscribed`, so this row
// measured ZERO calls. Measured, not assumed — see ImplementationReport_WP85.md.
//
// VACUITY GUARDS BUILT IN, because AC2 names all three by hand:
//   ├── every attach assertion names the PATH, never just a count
//   ├── the not-subscribed row proves the OLD route still runs, exactly once
//   └── a second pass over the same leaf must add nothing
//
// PRODUCTION LINE <-> ASSERTION: the WP85 consultation block in
// `syncCanvasPresences`. Deleting it reddens the already-subscribed row;
// moving the `wasSubscribed` read below the lazy branch reddens the
// "exactly once" half of the not-subscribed row; dropping `hasWriter` from
// the observation reddens the second-pass row.

import { describe, expect, it, vi } from "vitest";

// `main.ts` pulls in `Menu`, `requestUrl` and (via `session/commands` ->
// `ui/modals`) `FuzzySuggestModal`, none of which the shared Obsidian double
// exports — and `UserPickerModal` extends the last one AT MODULE SCOPE, so the
// import fails to LOAD before a single assertion runs. This supplement is
// additive and local to this file, on the `v2/wp30` precedent; the shared mock
// at `plugin/src/__mocks__/obsidian.ts` is deliberately not touched.
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

import LiveSharePlugin from "../../../main";

const SHARED = "_liveshare-test/board.canvas";
const OTHER = "_liveshare-test/second.canvas";
const UNSHARED = "private/notes.canvas";

interface Harness {
  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  fake: any;
  attachCalls: string[];
  subscribeCalls: string[];
  unsubscribeCalls: string[];
  run: () => void;
  setLeaves: (paths: Array<string | undefined>) => void;
  markWriterAttached: (path: string) => void;
}

/**
 * A fake `this` carrying only what the loop body reads. Everything the loop
 * calls on itself that is NOT under test (`mountCanvasPresence`,
 * `drainCanvasDeferrals`, `attachCanvasWriter`) is an own-property double, so
 * the prototype's version is never reached; `hasCanvasWriter` is deliberately
 * NOT doubled, because the read it performs is part of what WP85 wires.
 */
function makeHarness(options: {
  subscribed?: string[];
  shared?: string[];
  /** `subscribe()` adds synchronously in production; the double does the same. */
  subscribeSucceeds?: boolean;
}): Harness {
  const subscribed = new Set(options.subscribed ?? []);
  const shared = new Set(options.shared ?? [SHARED, OTHER]);
  const attachCalls: string[] = [];
  const subscribeCalls: string[] = [];
  const unsubscribeCalls: string[] = [];
  let leaves: Array<{ view?: unknown }> = [];

  const canvasWriters = new Map<string, unknown>();
  const canvasWriterAttaching = new Set<string>();

  // Object.create(prototype), NOT a bare object literal: `syncCanvasPresences`
  // calls `this.hasCanvasWriter(...)`, which is the production read WP85 wires
  // and must NOT be doubled. Own properties below shadow the prototype for the
  // three members that are genuinely out of scope here.
  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  const fake = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
    canvasSync: {
      isSubscribed: (p: string) => subscribed.has(p),
      subscribe: (p: string, _role: string) => {
        subscribeCalls.push(p);
        // Production `CanvasSync.subscribe` adds to `subscribedPaths` BEFORE its
        // first await; the double reproduces that, because the whole point of
        // the `wasSubscribed` hoist is that it does.
        if (options.subscribeSucceeds !== false) subscribed.add(p);
        return Promise.resolve();
      },
      getCanvasDocHandle: () => null,
    },
    backgroundSync: {
      unsubscribe: (p: string) => {
        unsubscribeCalls.push(p);
      },
      subscribe: async () => {},
    },
    manifestManager: { isSharedPath: (p: string) => shared.has(p) },
    settings: { role: "host" },
    app: { workspace: { getLeavesOfType: () => leaves } },
    logger: { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} },
    canvasPresences: new Map<string, unknown>(),
    canvasPresenceViews: new Map<string, unknown>(),
    canvasAdapters: new Map<string, unknown>(),
    canvasBindings: new Map<string, unknown>(),
    canvasModelBridges: new Map<string, unknown>(),
    canvasWriters,
    canvasWriterAttaching,
    surfaceState: { clearPath: () => {} },
    mountCanvasPresence: () => null,
    drainCanvasDeferrals: () => {},
    attachCanvasWriter: (p: string) => {
      attachCalls.push(p);
      // Production marks the path in-flight synchronously; without that the
      // "second pass adds nothing" row would pass for the wrong reason.
      canvasWriterAttaching.add(p);
      return Promise.resolve();
    },
  });

  return {
    fake,
    attachCalls,
    subscribeCalls,
    unsubscribeCalls,
    run: () => {
      // biome-ignore lint/complexity/useLiteralKeys: reaching a `private` member on purpose
      // biome-ignore lint/suspicious/noExplicitAny: ditto
      (LiveSharePlugin.prototype as any)["syncCanvasPresences"].call(fake);
    },
    setLeaves: (paths) => {
      leaves = paths.map((p) => ({
        view: { file: p === undefined ? undefined : { path: p }, getViewType: () => "canvas" },
      }));
    },
    markWriterAttached: (p: string) => {
      canvasWriters.set(p, {});
    },
  };
}

describe("WP85 AC2 — the syncCanvasPresences attach seam", () => {
  it("PRODUCTION CODE IS UNDER TEST: the method exists on the prototype", () => {
    // The positive control for the whole file. If `syncCanvasPresences` were
    // renamed or inlined, every row below would silently pass a fake.
    // biome-ignore lint/suspicious/noExplicitAny: reaching a `private` member on purpose
    expect(typeof (LiveSharePlugin.prototype as any).syncCanvasPresences).toBe("function");
    // biome-ignore lint/suspicious/noExplicitAny: reaching a `private` member on purpose
    expect(typeof (LiveSharePlugin.prototype as any).hasCanvasWriter).toBe("function");
  });

  it("an ALREADY-SUBSCRIBED shared canvas leaf attaches a writer — RED before WP85", () => {
    const h = makeHarness({ subscribed: [SHARED] });
    h.setLeaves([SHARED]);
    h.run();
    // Named by PATH, not counted: a test that only counts cannot tell the
    // writer was attached for the canvas the user is looking at.
    expect(h.attachCalls).toEqual([SHARED]);
    // And nothing re-subscribed it — the repair is at the writer seam, not a
    // second subscribe.
    expect(h.subscribeCalls).toEqual([]);
    expect(h.unsubscribeCalls).toEqual([]);
  });

  it("a NOT-subscribed shared leaf still takes the old lazy route, exactly once", () => {
    const h = makeHarness({ subscribed: [] });
    h.setLeaves([SHARED]);
    h.run();
    // The handover helper ran: unsubscribe from the raw-text path, then
    // subscribe through CanvasSync. Unchanged by WP85.
    expect(h.unsubscribeCalls).toEqual([SHARED]);
    expect(h.subscribeCalls).toEqual([SHARED]);
    // And the WP85 consultation did NOT also fire for it in this same pass,
    // even though `subscribe()` made `isSubscribed` read true synchronously.
    // That is what the `wasSubscribed` hoist buys.
    expect(h.attachCalls).toEqual([]);
  });

  it("...and the old route's attach then lands, once, for that path", async () => {
    const h = makeHarness({ subscribed: [] });
    h.setLeaves([SHARED]);
    h.run();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.attachCalls).toEqual([SHARED]);
  });

  it("a second pass over the same leaf attaches NOTHING further", () => {
    const h = makeHarness({ subscribed: [SHARED] });
    h.setLeaves([SHARED]);
    h.run();
    expect(h.attachCalls).toEqual([SHARED]);
    h.run();
    h.run();
    expect(h.attachCalls).toEqual([SHARED]);
  });

  it("a leaf whose writer is already attached attaches nothing", () => {
    const h = makeHarness({ subscribed: [SHARED] });
    h.markWriterAttached(SHARED);
    h.setLeaves([SHARED]);
    h.run();
    expect(h.attachCalls).toEqual([]);
  });

  it("an UNSHARED but subscribed leaf is refused — no writer for a private canvas", () => {
    const h = makeHarness({ subscribed: [UNSHARED], shared: [SHARED] });
    h.setLeaves([UNSHARED]);
    h.run();
    expect(h.attachCalls).toEqual([]);
    expect(h.subscribeCalls).toEqual([]);
  });

  it("a leaf with no path is refused and does not throw", () => {
    const h = makeHarness({ subscribed: [SHARED] });
    h.setLeaves([undefined]);
    expect(() => h.run()).not.toThrow();
    expect(h.attachCalls).toEqual([]);
  });

  it("two open shared canvases each get their own writer, and only their own", () => {
    const h = makeHarness({ subscribed: [SHARED, OTHER] });
    h.setLeaves([SHARED, OTHER, UNSHARED]);
    h.run();
    expect(h.attachCalls).toEqual([SHARED, OTHER]);
  });
});
