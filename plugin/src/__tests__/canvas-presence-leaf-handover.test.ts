import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    open() {}
    close() {}
    addItem(_cb: unknown) {
      return this;
    }
    showAtMouseEvent(_event: unknown) {}
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

import LiveSharePlugin from "../main";

const PATH = "_liveshare-test/board.canvas";

function makeView(id: string) {
  return { id, file: { path: PATH }, getViewType: () => "canvas" };
}

describe("Canvas presence same-path leaf handover", () => {
  it("keeps a live owner when a duplicate opens, then rebinds once when that owner closes", () => {
    const owner = makeView("owner");
    const survivor = makeView("survivor");
    let leaves = [{ view: owner }, { view: survivor }];
    const mountedViews: unknown[] = [];
    const destroyedPresences: string[] = [];
    const destroyedBindings: string[] = [];
    const destroyedBridges: string[] = [];
    const stoppedSweeps: string[] = [];

    const fake = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
      canvasSync: {
        isSubscribed: (path: string) => path === PATH,
        getCanvasDocHandle: () => ({}),
      },
      backgroundSync: { unsubscribe: () => {}, subscribe: async () => {} },
      manifestManager: { isSharedPath: (path: string) => path === PATH },
      settings: { role: "host" },
      app: { workspace: { getLeavesOfType: () => leaves } },
      logger: { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} },
      canvasPresences: new Map<string, { destroy: () => void }>(),
      canvasPresenceViews: new Map<string, unknown>(),
      canvasAdapters: new Map<string, unknown>(),
      canvasBindings: new Map<string, { destroy: () => void }>(),
      canvasModelBridges: new Map<string, { destroy: () => void }>(),
      canvasWriters: new Map<string, unknown>([[PATH, {}]]),
      canvasWriterAttaching: new Set<string>(),
      surfaceState: { clearPath: () => {} },
      drainCanvasDeferrals: () => {},
      stopCanvasRepaintSweep: (path: string) => stoppedSweeps.push(path),
      mountCanvasPresence: (_path: string, view: { id: string }) => {
        mountedViews.push(view);
        fake.canvasAdapters.set(PATH, { view });
        fake.canvasBindings.set(PATH, {
          destroy: () => destroyedBindings.push(view.id),
        });
        fake.canvasModelBridges.set(PATH, {
          destroy: () => destroyedBridges.push(view.id),
        });
        return { destroy: () => destroyedPresences.push(view.id) };
      },
      attachCanvasWriter: async () => {},
    });

    const run = () => {
      // biome-ignore lint/complexity/useLiteralKeys: reaches the private production seam intentionally
      // biome-ignore lint/suspicious/noExplicitAny: reaches the private production seam intentionally
      (LiveSharePlugin.prototype as any)["syncCanvasPresences"].call(fake);
    };

    run();
    expect(mountedViews).toEqual([owner]);

    run();
    expect(mountedViews).toEqual([owner]);
    expect(destroyedPresences).toEqual([]);

    leaves = [{ view: survivor }];
    run();

    expect(mountedViews).toEqual([owner, survivor]);
    expect(destroyedPresences).toEqual(["owner"]);
    expect(destroyedBindings).toEqual(["owner"]);
    expect(destroyedBridges).toEqual(["owner"]);
    expect(stoppedSweeps).toEqual([PATH]);
    expect(fake.canvasPresenceViews.get(PATH)).toBe(survivor);
    expect(fake.canvasAdapters.get(PATH)).toEqual({ view: survivor });

    run();
    expect(mountedViews).toEqual([owner, survivor]);
  });
});
