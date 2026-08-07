// WP30 / AC4, second condition — "The command is unavailable for a path the
// client ... is degraded on".
//
// This is a SEPARATE test point from ownership on purpose. The two conditions
// are independent, and a guard that checks only one of them passes three of the
// four rows of the combined truth table. tp02 varies ownership with `degraded`
// held at `false`; this file varies degradation with `owned` held at `true`, so
// the row that discriminates a one-condition guard — owned AND degraded — is
// exercised here and nowhere else.
//
// WHY DEGRADATION BLOCKS AN IMPORT AT ALL, since a coder may be tempted to
// treat it as a warning rather than a bar: a degraded client is one whose view
// of this board is known to be incomplete (a refused seed boundary withholding
// the write-back, a canvas adapter that is unavailable, a sidecar that came back
// corrupt). The import publishes a WHOLESALE replacement of the shared board
// computed from a local file, and the confirmation dialog quotes what is about
// to be lost. Both are wrong if this client cannot see the board properly: the
// user would be told the wrong thing and would then destroy state they were
// never shown. Degradation is therefore a bar, not a caveat.
//
// The same fail-closed rule applies as for ownership, in the mirror direction:
// only the literal `false` means "not degraded".
//
// PRODUCTION LINE <-> ASSERTION: the `degraded !== false` branch of
// `importUnavailableReason` in `plugin/src/canvas/canvas-import-command.ts`.
// Deleting that branch reddens every row below except the positive control;
// weakening it to `degraded === true` reddens the fail-closed block only.

import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_FROM_FILE_COMMAND_ID,
  IMPORT_UNAVAILABLE,
  type ImportAvailability,
  canImportFromFile,
  importUnavailableReason,
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

function guardOf(availability: unknown): (checking: boolean) => boolean | undefined {
  const commands: { id: string; checkCallback?: (checking: boolean) => boolean | undefined }[] = [];
  const plugin = {
    addCommand: (command: { id: string }) => commands.push(command),
    settings: { role: "host", clientId: "c1", displayName: "Host", githubUserId: "" },
    sessionManager: { isActive: true, copyInvite: () => {} },
    remoteUsers: new Map(),
    app: {},
    activeCanvasPathForImport: () => CANVAS_PATH,
    canvasImportAvailability: () => availability,
    runCanvasImportFromFile: vi.fn(async () => ({ status: "imported" })),
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  registerCommands(plugin as any);
  const command = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
  if (!command?.checkCallback)
    throw new Error("WP30 command is not registered with a checkCallback");
  return command.checkCallback;
}

/** Everything a degradation probe can answer that is not the literal `false`. */
const DEGRADED_OR_UNKNOWN: unknown[] = [true, undefined, null, 0, 1, "", "false", "no", {}, []];

describe("WP30 tp03 — unavailable for a path the client is degraded on", () => {
  it("refuses an OWNED path that is degraded — the row a one-condition guard misses", () => {
    expect(importUnavailableReason({ owned: true, degraded: true })).toBe(
      IMPORT_UNAVAILABLE.DEGRADED,
    );
    expect(canImportFromFile({ owned: true, degraded: true })).toBe(false);
  });

  it("treats every non-`false` degradation answer as degraded (fail closed)", () => {
    for (const degraded of DEGRADED_OR_UNKNOWN) {
      const availability = { owned: true, degraded } as unknown as ImportAvailability;
      expect(importUnavailableReason(availability), `degraded=${String(degraded)}`).toBe(
        IMPORT_UNAVAILABLE.DEGRADED,
      );
      expect(canImportFromFile(availability), `degraded=${String(degraded)}`).toBe(false);
    }
  });

  it("both conditions are load-bearing: each field alone flips the verdict", () => {
    // Sensitivity, stated over the 2x2 lattice. An implementation that ignores
    // `degraded` satisfies three rows of the table and ZERO of these pairs.
    expect(canImportFromFile({ owned: true, degraded: false })).toBe(true);
    expect(canImportFromFile({ owned: true, degraded: true })).toBe(false);
    expect(canImportFromFile({ owned: false, degraded: false })).toBe(false);
    expect(canImportFromFile({ owned: false, degraded: true })).toBe(false);
    // Exactly one of the four rows may be available.
    const rows: ImportAvailability[] = [
      { owned: true, degraded: false },
      { owned: true, degraded: true },
      { owned: false, degraded: false },
      { owned: false, degraded: true },
    ];
    expect(rows.filter((row) => canImportFromFile(row))).toHaveLength(1);
  });

  it("the registered command refuses a degraded path while merely checking", () => {
    expect(guardOf({ owned: true, degraded: true })(true)).toBe(false);
  });

  it("the registered command refuses a degraded path when actually invoked", () => {
    expect(guardOf({ owned: true, degraded: true })(false)).toBe(false);
  });

  it("the registered command never starts an import for a degraded path", () => {
    const runImport = vi.fn(async () => ({ status: "imported" }));
    const commands: { id: string; checkCallback?: (checking: boolean) => boolean | undefined }[] =
      [];
    const plugin = {
      addCommand: (command: { id: string }) => commands.push(command),
      settings: { role: "host", clientId: "c1", displayName: "Host", githubUserId: "" },
      sessionManager: { isActive: true, copyInvite: () => {} },
      remoteUsers: new Map(),
      app: {},
      activeCanvasPathForImport: () => CANVAS_PATH,
      canvasImportAvailability: () => ({ owned: true, degraded: true }),
      runCanvasImportFromFile: runImport,
    };
    // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
    registerCommands(plugin as any);
    commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID)?.checkCallback?.(false);
    expect(runImport).not.toHaveBeenCalled();
  });

  it("the registered command accepts an owned, undegraded path — positive control", () => {
    expect(guardOf(AVAILABLE)(true)).toBe(true);
  });
});
