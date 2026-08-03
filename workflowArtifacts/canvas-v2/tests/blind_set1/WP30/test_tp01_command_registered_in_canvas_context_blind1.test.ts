// WP30 / AC1 blind1 — the registration attacked as a SET property over the whole
// command table, not as a lookup of one entry.
//
// The visible test asks "is there a command with this id, and does it have a
// checkCallback?". This one never looks the command up until the very end: it
// registers the whole table under several plugin states and asserts invariants
// that hold across it — exactly one entry may carry WP30's id, no id may be
// duplicated, every conditional entry must answer with a real boolean while
// checking, and the WP30 entry must belong to the conditional class rather than
// the unconditional one. An implementation that registered the import twice, or
// that reused an existing id, or that returned `undefined` from its guard (which
// Obsidian reads as "not available" only by accident of falsiness) passes the
// lookup and fails these.
//
// The second attack is PURITY WHILE CHECKING. Obsidian calls `checkCallback(true)`
// every time the palette is opened. A guard with a side effect there would fire
// an import on a keystroke, so the guard is called repeatedly and the run
// channel must stay silent.

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
  editorCallback?: unknown;
}

const CANVAS = "atlas/roadmap.canvas";

function table(overrides: Record<string, unknown> = {}): {
  commands: Registered[];
  runImport: ReturnType<typeof vi.fn>;
} {
  const commands: Registered[] = [];
  const runImport = vi.fn(async () => ({ status: "imported" }));
  const plugin: Record<string, unknown> = {
    addCommand: (command: Registered) => commands.push(command),
    settings: { role: "guest", clientId: "g9", displayName: "Guest", githubUserId: "" },
    sessionManager: { isActive: false, copyInvite: () => {} },
    remoteUsers: new Map([["u1", { displayName: "Someone" }]]),
    app: {},
    activeCanvasPathForImport: () => CANVAS,
    canvasImportAvailability: () => ({ owned: true, degraded: false }),
    runCanvasImportFromFile: runImport,
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
  registerCommands(plugin as any);
  return { commands, runImport };
}

describe("WP30 tp01 blind1 — the command table as a whole", () => {
  it("carries exactly one entry with WP30's id", () => {
    const { commands } = table();
    expect(commands.filter((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID)).toHaveLength(1);
  });

  it("carries no duplicated id anywhere", () => {
    const { commands } = table();
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries no duplicated name anywhere", () => {
    const { commands } = table();
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(IMPORT_FROM_FILE_COMMAND_NAME);
  });

  it("puts WP30's entry in the CONDITIONAL class, never the unconditional one", () => {
    const { commands } = table();
    const conditional = commands.filter((c) => typeof c.checkCallback === "function");
    const unconditional = commands.filter((c) => typeof c.callback === "function");
    expect(conditional.map((c) => c.id)).toContain(IMPORT_FROM_FILE_COMMAND_ID);
    expect(unconditional.map((c) => c.id)).not.toContain(IMPORT_FROM_FILE_COMMAND_ID);
  });

  it("answers the availability question with a real boolean, never undefined", () => {
    const { commands } = table();
    const entry = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
    expect(typeof entry?.checkCallback?.(true)).toBe("boolean");
  });

  it("is inert while checking, however many times the palette is opened", () => {
    const { commands, runImport } = table();
    const entry = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
    const answers = new Set<unknown>();
    for (let i = 0; i < 50; i++) answers.add(entry?.checkCallback?.(true));
    expect(answers).toEqual(new Set([true]));
    expect(runImport).not.toHaveBeenCalled();
  });

  it("targets whatever canvas is in context at the moment of invocation", () => {
    let current: string | null = "one/a.canvas";
    const { commands, runImport } = table({ activeCanvasPathForImport: () => current });
    const entry = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);

    entry?.checkCallback?.(false);
    current = "two/b.canvas";
    entry?.checkCallback?.(false);
    current = null;
    entry?.checkCallback?.(false);

    expect(runImport.mock.calls.map((call) => call[0])).toEqual(["one/a.canvas", "two/b.canvas"]);
  });
});
