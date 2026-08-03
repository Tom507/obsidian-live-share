// WP30 / AC1 (first clause) — "The command exists, is reachable from the canvas
// context".
//
// TWO THINGS ARE PINNED HERE AND THE SECOND IS THE ONE THAT MATTERS.
//
//   1. The command is registered at all, under the id and name WP30 owns.
//   2. It is registered with a `checkCallback`, NOT a `callback`.
//
// `plugin/src/session/commands.ts` has exactly two registration shapes:
// `callback` for always-available commands and `checkCallback: (checking) =>
// {...}` for conditional ones, where the guard returns `false` when the command
// is unavailable. AC4 ("unavailable for a path the client does not own or is
// degraded on") is ONLY expressible in the second shape — a command registered
// with `callback` is in the palette unconditionally and there is no place for
// the guard to live. So a `callback` registration does not merely fail AC4 in
// spirit, it makes AC4 structurally unimplementable, and that is worth its own
// assertion rather than being left to the AC4 tests to notice indirectly.
//
// "Reachable from the canvas context" is asserted as the third pin: with no
// active `.canvas` path (`activeCanvasPathForImport()` returns `null`) the guard
// is `false`, and with one it consults that path and no other.
//
// PRODUCTION LINE <-> ASSERTION: the new `plugin.addCommand({...})` block in
// `plugin/src/session/commands.ts`. Changing `checkCallback` to `callback`
// reddens `registers a checkCallback, never a bare callback`; deleting the block
// reddens every test in this file; dropping the
// `activeCanvasPathForImport() === null` early return reddens
// `is unreachable when no canvas is in context`.

import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_FROM_FILE_COMMAND_ID,
  IMPORT_FROM_FILE_COMMAND_NAME,
} from "../../../canvas/canvas-import-command";
import { registerCommands } from "../../../session/commands";

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

import { AVAILABLE, CANVAS_PATH } from "./harness";

interface RegisteredCommand {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | undefined;
  editorCallback?: unknown;
}

function registerAll(overrides: Record<string, unknown> = {}): {
  commands: RegisteredCommand[];
  plugin: Record<string, unknown>;
  importCommand: RegisteredCommand;
  runImport: ReturnType<typeof vi.fn>;
} {
  const commands: RegisteredCommand[] = [];
  const runImport = vi.fn(async () => ({ status: "imported" }));
  const plugin: Record<string, unknown> = {
    addCommand: (command: RegisteredCommand) => commands.push(command),
    settings: { role: "host", clientId: "c1", displayName: "Host", githubUserId: "" },
    sessionManager: { isActive: true, copyInvite: () => {} },
    remoteUsers: new Map(),
    app: {},
    activeCanvasPathForImport: vi.fn(() => CANVAS_PATH),
    canvasImportAvailability: vi.fn(() => AVAILABLE),
    runCanvasImportFromFile: runImport,
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  registerCommands(plugin as any);
  const importCommand = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID) as
    | RegisteredCommand
    | undefined;
  if (!importCommand)
    throw new Error(`no command registered with id ${IMPORT_FROM_FILE_COMMAND_ID}`);
  return { commands, plugin, importCommand, runImport };
}

describe("WP30 tp01 — the import command exists and is reachable from the canvas context", () => {
  it("registers exactly one command under WP30's owned id", () => {
    const { commands } = registerAll();
    const matches = commands.filter((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
    expect(matches).toHaveLength(1);
  });

  it("registers it under WP30's owned name, and the name is not empty scaffolding", () => {
    const { importCommand } = registerAll();
    expect(importCommand.name).toBe(IMPORT_FROM_FILE_COMMAND_NAME);
    expect(importCommand.name.trim().length).toBeGreaterThan(0);
  });

  it("does not disturb the commands that were already registered", () => {
    const { commands } = registerAll();
    // The pre-WP30 set, by id. WP30 adds; it never renames or removes.
    for (const id of [
      "start-session",
      "join-session",
      "end-session",
      "leave-session",
      "copy-invite",
      "show-collaborators",
      "transfer-host",
      "show-audit-log",
    ]) {
      expect(commands.map((c) => c.id)).toContain(id);
    }
  });

  it("registers a checkCallback, never a bare callback (AC4 needs somewhere to live)", () => {
    const { importCommand } = registerAll();
    expect(typeof importCommand.checkCallback).toBe("function");
    expect(importCommand.callback).toBeUndefined();
    expect(importCommand.editorCallback).toBeUndefined();
  });

  it("is available, and runs nothing, while Obsidian is merely CHECKING", () => {
    const { importCommand, runImport } = registerAll();
    expect(importCommand.checkCallback?.(true)).toBe(true);
    expect(runImport).not.toHaveBeenCalled();
  });

  it("runs the import against the canvas in context when actually invoked", () => {
    const { importCommand, runImport } = registerAll();
    importCommand.checkCallback?.(false);
    expect(runImport).toHaveBeenCalledTimes(1);
    expect(runImport).toHaveBeenCalledWith(CANVAS_PATH);
  });

  it("is unreachable when no canvas is in context", () => {
    const { importCommand, runImport } = registerAll({
      activeCanvasPathForImport: vi.fn(() => null),
    });
    expect(importCommand.checkCallback?.(true)).toBe(false);
    expect(importCommand.checkCallback?.(false)).toBe(false);
    expect(runImport).not.toHaveBeenCalled();
  });

  it("asks availability about the canvas in context, not about some other path", () => {
    const availability = vi.fn(() => AVAILABLE);
    const { importCommand } = registerAll({
      activeCanvasPathForImport: vi.fn(() => "decks/other.canvas"),
      canvasImportAvailability: availability,
    });
    importCommand.checkCallback?.(true);
    expect(availability).toHaveBeenCalledWith("decks/other.canvas");
  });
});
