// WP30 / AC4, first condition — "The command is unavailable for a path the
// client does not own".
//
// AC4 names TWO independent unavailability conditions and this file tests only
// the first; the second (degraded) has its own file, because a guard spelled
// with the wrong connective satisfies a test that only ever varies one of them.
//
// THE OBSERVABLE IS `checkCallback(true) === false`, and it is asserted at BOTH
// levels the guard exists at:
//
//   ├── the PURE predicate `importUnavailableReason` / `canImportFromFile`,
//   │   where the answer can be varied exhaustively and where the fail-closed
//   │   rule (an unanswered probe is NOT ownership) is assertable at all; and
//   └── the REGISTERED command, because a correct predicate that the command
//       never consults is a predicate nobody is protected by.
//
// The fail-closed direction matters more here than the happy path. Ownership is
// the permission to DESTROY a living shared board from a local file. A probe
// that answers `undefined` because a wiring step was skipped is an UNANSWERED
// QUESTION, not a yes — so anything that is not exactly `true` must read as
// unowned. This mirrors WP29's `decideSeed`, which resolves every non-`false`
// value towards the safe branch for exactly the same reason.
//
// PRODUCTION LINE <-> ASSERTION: `importUnavailableReason` in
// `plugin/src/canvas/canvas-import-command.ts` and the
// `canImportFromFile(...)` guard line in the WP30 block of
// `plugin/src/session/commands.ts`. Replacing `owned !== true` with `!owned`
// leaves the boolean rows green and reddens the fail-closed block; deleting the
// guard line from `commands.ts` reddens `the registered command refuses ...`.

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

/** Everything a probe can answer that is not the literal `true`. */
const NOT_OWNED: unknown[] = [false, undefined, null, 0, 1, "", "true", "yes", {}, []];

describe("WP30 tp02 — unavailable for a path the client does not own", () => {
  it("names UNOWNED as the reason a plainly unowned path is refused", () => {
    expect(importUnavailableReason({ owned: false, degraded: false })).toBe(
      IMPORT_UNAVAILABLE.UNOWNED,
    );
    expect(canImportFromFile({ owned: false, degraded: false })).toBe(false);
  });

  it("still names UNOWNED when the path is BOTH unowned and degraded", () => {
    // Ownership is asked first, so the reported reason is deterministic. An
    // implementation that reports "degraded" here would tell the user their
    // board is broken when in fact this client simply does not hold it.
    expect(importUnavailableReason({ owned: false, degraded: true })).toBe(
      IMPORT_UNAVAILABLE.UNOWNED,
    );
  });

  it("treats every non-`true` ownership answer as unowned (fail closed)", () => {
    for (const owned of NOT_OWNED) {
      const availability = { owned, degraded: false } as unknown as ImportAvailability;
      expect(importUnavailableReason(availability), `owned=${String(owned)}`).toBe(
        IMPORT_UNAVAILABLE.UNOWNED,
      );
      expect(canImportFromFile(availability), `owned=${String(owned)}`).toBe(false);
    }
  });

  it("treats a missing or malformed availability report as unowned", () => {
    for (const availability of [null, undefined, {}, "owned", 7]) {
      expect(
        importUnavailableReason(availability as unknown as ImportAvailability),
        JSON.stringify(availability) ?? String(availability),
      ).toBe(IMPORT_UNAVAILABLE.UNOWNED);
    }
  });

  it("is available for an owned, undegraded path — the positive control", () => {
    expect(importUnavailableReason(AVAILABLE)).toBeNull();
    expect(canImportFromFile(AVAILABLE)).toBe(true);
  });

  it("the registered command refuses an unowned path while merely checking", () => {
    expect(guardOf({ owned: false, degraded: false })(true)).toBe(false);
  });

  it("the registered command refuses an unowned path when actually invoked", () => {
    expect(guardOf({ owned: false, degraded: false })(false)).toBe(false);
  });

  it("the registered command accepts an owned, undegraded path — positive control", () => {
    expect(guardOf(AVAILABLE)(true)).toBe(true);
  });
});
