// WP30 / AC4 (degradation) blind1 — attacked as MONOTONICITY in the safe
// direction, and measured through the REGISTERED guard rather than the predicate.
//
// A truth table says "these inputs give these answers". Monotonicity says
// something a table does not: that the guard can only ever move TOWARDS refusal
// as the situation gets worse. Over the 2x2 lattice, adding degradation or
// removing ownership must never turn a refusal into a permission. An
// implementation with an `||` where an `&&` belongs, or with a dropped negation,
// can still satisfy three table rows and satisfies zero of the lattice edges.
//
// The measurement point is deliberately the COMMAND, not the pure predicate: a
// correct predicate the command never consults protects nobody, and the visible
// suite's predicate-level lattice cannot see that. Here every lattice point is
// pushed through `registerCommands` and read back off `checkCallback`, and the
// run channel is watched at the same time so "returned false" and "did not start
// an import" are two separate observations rather than one.

import { describe, expect, it, vi } from "vitest";

import { IMPORT_FROM_FILE_COMMAND_ID } from "../../../../../plugin/src/canvas/canvas-import-command";
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


const CANVAS = "atlas/roadmap.canvas";

function guard(availability: unknown): {
  check: (checking: boolean) => boolean | void;
  runImport: ReturnType<typeof vi.fn>;
} {
  const commands: { id: string; checkCallback?: (checking: boolean) => boolean | void }[] = [];
  const runImport = vi.fn(async () => ({ status: "imported" }));
  const plugin = {
    addCommand: (command: { id: string }) => commands.push(command),
    settings: { role: "host", clientId: "h1", displayName: "Host", githubUserId: "" },
    sessionManager: { isActive: true, copyInvite: () => {} },
    remoteUsers: new Map(),
    app: {},
    activeCanvasPathForImport: () => CANVAS,
    canvasImportAvailability: () => availability,
    runCanvasImportFromFile: runImport,
  };
  // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
  registerCommands(plugin as any);
  const entry = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID);
  if (!entry?.checkCallback) throw new Error("WP30 command has no checkCallback");
  return { check: entry.checkCallback, runImport };
}

/** Worse in this order: fewer permissions, more damage. */
const LATTICE = [
  { owned: true, degraded: false, rank: 0 },
  { owned: true, degraded: true, rank: 1 },
  { owned: false, degraded: false, rank: 1 },
  { owned: false, degraded: true, rank: 2 },
];

describe("WP30 tp03 blind1 — degradation, through the registered guard", () => {
  it("is monotone: nothing worse than the ideal situation is ever permitted", () => {
    for (const point of LATTICE) {
      const permitted = guard({ owned: point.owned, degraded: point.degraded }).check(true);
      expect(permitted, JSON.stringify(point)).toBe(point.rank === 0);
    }
  });

  it("degradation alone is enough to refuse an owned board", () => {
    expect(guard({ owned: true, degraded: true }).check(true)).toBe(false);
    expect(guard({ owned: true, degraded: false }).check(true)).toBe(true);
  });

  it("refusing and not-running are two observations, and both hold", () => {
    for (const point of LATTICE.filter((p) => p.rank > 0)) {
      const { check, runImport } = guard({ owned: point.owned, degraded: point.degraded });
      expect(check(false), JSON.stringify(point)).toBe(false);
      expect(runImport, JSON.stringify(point)).not.toHaveBeenCalled();
    }
  });

  it("re-asks availability on every check — a stale yes cannot outlive the degradation", () => {
    let degraded = false;
    const asked: number[] = [];
    const commands: { id: string; checkCallback?: (checking: boolean) => boolean | void }[] = [];
    const runImport = vi.fn(async () => ({ status: "imported" }));
    const plugin = {
      addCommand: (command: { id: string }) => commands.push(command),
      settings: { role: "host", clientId: "h1", displayName: "Host", githubUserId: "" },
      sessionManager: { isActive: true, copyInvite: () => {} },
      remoteUsers: new Map(),
      app: {},
      activeCanvasPathForImport: () => CANVAS,
      canvasImportAvailability: () => {
        asked.push(asked.length);
        return { owned: true, degraded };
      },
      runCanvasImportFromFile: runImport,
    };
    // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
    registerCommands(plugin as any);
    const check = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID)?.checkCallback;

    expect(check?.(true)).toBe(true);
    degraded = true;
    expect(check?.(true)).toBe(false);
    degraded = false;
    expect(check?.(true)).toBe(true);
    expect(asked.length).toBeGreaterThanOrEqual(3);
  });

  it("a degradation that appears between the check and the invocation still refuses", () => {
    // Obsidian checks, then invokes. The two calls are separate, so the guard
    // must hold on the second one too rather than trusting the first.
    let degraded = false;
    const commands: { id: string; checkCallback?: (checking: boolean) => boolean | void }[] = [];
    const runImport = vi.fn(async () => ({ status: "imported" }));
    const plugin = {
      addCommand: (command: { id: string }) => commands.push(command),
      settings: { role: "host", clientId: "h1", displayName: "Host", githubUserId: "" },
      sessionManager: { isActive: true, copyInvite: () => {} },
      remoteUsers: new Map(),
      app: {},
      activeCanvasPathForImport: () => CANVAS,
      canvasImportAvailability: () => ({ owned: true, degraded }),
      runCanvasImportFromFile: runImport,
    };
    // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
    registerCommands(plugin as any);
    const check = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID)?.checkCallback;

    expect(check?.(true)).toBe(true);
    degraded = true;
    expect(check?.(false)).toBe(false);
    expect(runImport).not.toHaveBeenCalled();
  });
});
