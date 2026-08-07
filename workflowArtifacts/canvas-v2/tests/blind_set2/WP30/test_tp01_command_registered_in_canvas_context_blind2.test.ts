// WP30 / AC1 blind2 — the registration attacked from the OBSIDIAN CONTRACT side:
// what the host application is allowed to do to this command, and what must
// still hold afterwards.
//
// Obsidian owns the calling pattern, and it is not the one a test naturally
// writes. It calls `checkCallback(true)` on every palette keystroke, it may call
// it many times before ever calling `checkCallback(false)`, it may never call
// the second at all, and it discards the return value of the second call. Three
// consequences are pinned here and none of them is visible from a single
// happy-path invocation:
//
//   ├── the id must be a stable, palette-legal constant (no whitespace, no
//   │   uppercase, no colon — Obsidian namespaces commands as
//   │   `<plugin-id>:<command-id>` and a colon inside would split wrongly), and
//   │   it must be the SAME string on every call rather than something computed;
//   ├── the guard must be safe to call before the plugin is fully wired — an
//   │   exception thrown out of `checkCallback` breaks the whole palette, not
//   │   just this entry; and
//   └── invocation must not return a rejected promise into a caller that
//       discards it. The import is asynchronous and the command is not, so the
//       rejection has to be absorbed at the registration site.

import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_FROM_FILE_COMMAND_ID,
  IMPORT_FROM_FILE_COMMAND_NAME,
} from "../../../../../plugin/src/canvas/canvas-import-command";
import { registerCommands } from "../../../../../plugin/src/session/commands";

// The shared Obsidian test double (`plugin/src/__mocks__/obsidian.ts`) does not
// export `FuzzySuggestModal`, and `session/commands.ts` -> `ui/modals.ts`
// extends it AT MODULE SCOPE (`UserPickerModal`). So importing
// `registerCommands` into a unit test fails to LOAD - "Class extends value
// undefined" - before a single assertion runs. This supplement is additive and
// local to this file; the shared mock is deliberately not touched.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    FuzzySuggestModal: class FuzzySuggestModal {
      app: unknown;
      constructor(app: unknown) {
        this.app = app;
      }
      open() {}
      close() {}
    },
  };
});


interface Registered {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
}

function entry(overrides: Record<string, unknown> = {}): Registered {
  const commands: Registered[] = [];
  const plugin: Record<string, unknown> = {
    addCommand: (command: Registered) => commands.push(command),
    settings: { role: "host", clientId: "h", displayName: "H", githubUserId: "" },
    sessionManager: { isActive: true, copyInvite: () => {} },
    remoteUsers: new Map(),
    app: {},
    activeCanvasPathForImport: () => "vault/deck.canvas",
    canvasImportAvailability: () => ({ owned: true, degraded: false }),
    runCanvasImportFromFile: vi.fn(async () => ({ status: "imported" })),
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
  registerCommands(plugin as any);
  const found = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
  if (!found) throw new Error("WP30 command not registered");
  return found;
}

describe("WP30 tp01 blind2 — the command under Obsidian's calling contract", () => {
  it("uses a palette-legal, stable id", () => {
    expect(IMPORT_FROM_FILE_COMMAND_ID).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(IMPORT_FROM_FILE_COMMAND_ID).not.toContain(":");
    expect(IMPORT_FROM_FILE_COMMAND_ID).toBe(IMPORT_FROM_FILE_COMMAND_ID);
    expect(entry().id).toBe(IMPORT_FROM_FILE_COMMAND_ID);
  });

  it("uses a human-readable name that is not the id", () => {
    expect(IMPORT_FROM_FILE_COMMAND_NAME).not.toBe(IMPORT_FROM_FILE_COMMAND_ID);
    expect(IMPORT_FROM_FILE_COMMAND_NAME.trim()).toBe(IMPORT_FROM_FILE_COMMAND_NAME);
    expect(IMPORT_FROM_FILE_COMMAND_NAME.length).toBeGreaterThan(3);
  });

  it("registers the same id on every registration pass", () => {
    expect(entry().id).toBe(entry().id);
    expect(entry().name).toBe(entry().name);
  });

  it("does not break the palette when the canvas wiring is absent", () => {
    // A plugin still starting up, or one whose canvas subsystem failed to
    // attach. `checkCallback` must answer, not throw.
    const guard = entry({
      activeCanvasPathForImport: () => null,
      canvasImportAvailability: () => undefined,
    }).checkCallback;
    expect(() => guard?.(true)).not.toThrow();
    expect(guard?.(true)).toBe(false);
  });

  it("absorbs a failing import rather than returning a rejected promise", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const guard = entry({
        runCanvasImportFromFile: vi.fn(async () => {
          throw new Error("import blew up");
        }),
      }).checkCallback;

      expect(() => guard?.(false)).not.toThrow();
      // let any unhandled rejection surface
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("survives the palette's real call pattern: many checks, then one invocation", () => {
    const runImport = vi.fn(async () => ({ status: "imported" }));
    const guard = entry({ runCanvasImportFromFile: runImport }).checkCallback;

    for (let i = 0; i < 20; i++) expect(guard?.(true)).toBe(true);
    expect(runImport).not.toHaveBeenCalled();

    guard?.(false);
    expect(runImport).toHaveBeenCalledTimes(1);
  });
});
