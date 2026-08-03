// WP30 / AC4 (ownership) blind2 — attacked as DEFENCE IN DEPTH plus LIVENESS.
//
// Two failure modes sit on opposite sides of this AC and a test that only checks
// "unowned returns false" catches neither.
//
//   THE GUARD IS THE ONLY THING STOPPING IT. If ownership is checked only in
//   `commands.ts`, then any other caller of the import — a future ribbon icon, a
//   URI handler, an e2e control hook, a retry — destroys a board this client does
//   not own. So the refusal is measured HERE at the orchestrator
//   (`runImportFromFile`), which is the layer that actually performs the
//   destruction, and separately at the command. Both must refuse, independently.
//
//   THE GUARD REFUSES EVERYTHING. `checkCallback` returning `false` is trivially
//   achieved by returning `false` always, and every AC4 assertion in every suite
//   stays green while the command is simply broken. So each refusal below is
//   paired with a LIVENESS assertion on the identical rig: flip ownership back
//   on and the same command must become available and the same orchestrator must
//   perform the import.
//
// The ownership answer is also varied WITHIN one rig rather than across rigs, so
// what is measured is the guard reacting to the report, not two unrelated
// scenarios happening to differ.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import { IMPORT_FROM_FILE_COMMAND_ID } from "../../../../../plugin/src/canvas/canvas-import-command";
import {
  IMPORT_STATUS,
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";
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


const PATH = "vault/deck.canvas";
const TODAY = "2026-08-02";

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function ids(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: number, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "9d40b1e7c8a2436f9051be7c2ad38f60");
    meta.set(PATH_KEY, PATH);
    meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [i, id] of nodeIds.entries()) {
      const record = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(node(id, i * 25))) record.set(key, value);
      nodes.set(id, record);
    }
  });
  return doc;
}

/** One rig whose ownership answer can be flipped between runs. */
function switchableRig() {
  const doc = replica(4, ["board-1"]);
  const writes: string[] = [];
  const updates: unknown[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));
  const state = { owned: false };

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: state.owned, degraded: false }),
    liveDoc: () => doc,
    peers: () => [],
    readCanvasFile: async () => JSON.stringify({ nodes: [node("z")], edges: [] }),
    confirm: async () => true,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
      resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async (path: string) => {
            writes.push(path);
          },
          notify: () => {},
          today: () => TODAY,
        },
      }),
    notify: () => {},
  };
  return { env, doc, writes, updates, state };
}

describe("WP30 tp02 blind2 — ownership is enforced where the destruction happens", () => {
  it("the orchestrator itself refuses an unowned path", async () => {
    const rig = switchableRig();
    rig.state.owned = false;

    const result = await runImportFromFile(PATH, rig.env);

    expect(result.status).toBe(IMPORT_STATUS.UNAVAILABLE);
    expect(rig.writes).toEqual([]);
    expect(rig.updates).toEqual([]);
    expect(ids(rig.doc)).toEqual(["board-1"]);
  });

  it("LIVENESS: the same rig imports the moment ownership is established", async () => {
    const rig = switchableRig();

    rig.state.owned = false;
    expect((await runImportFromFile(PATH, rig.env)).status).toBe(IMPORT_STATUS.UNAVAILABLE);

    rig.state.owned = true;
    expect((await runImportFromFile(PATH, rig.env)).status).toBe(IMPORT_STATUS.IMPORTED);
    expect(rig.writes).toHaveLength(1);
    expect(rig.updates).toHaveLength(1);
    expect(ids(rig.doc)).toEqual(["z"]);
  });

  it("the orchestrator does not even open the file for an unowned path", async () => {
    const opened: string[] = [];
    const rig = switchableRig();
    rig.state.owned = false;
    const env: ImportFromFileEnv = {
      ...rig.env,
      readCanvasFile: async (path: string) => {
        opened.push(path);
        return JSON.stringify({ nodes: [node("z")], edges: [] });
      },
    };

    await runImportFromFile(PATH, env);

    expect(opened).toEqual([]);
  });

  it("the command refuses too, and becomes available when ownership arrives", () => {
    const state = { owned: false };
    const commands: { id: string; checkCallback?: (checking: boolean) => boolean | void }[] = [];
    const runImport = vi.fn(async () => ({ status: "imported" }));
    const plugin = {
      addCommand: (command: { id: string }) => commands.push(command),
      settings: { role: "host", clientId: "h", displayName: "H", githubUserId: "" },
      sessionManager: { isActive: true, copyInvite: () => {} },
      remoteUsers: new Map(),
      app: {},
      activeCanvasPathForImport: () => PATH,
      canvasImportAvailability: () => ({ owned: state.owned, degraded: false }),
      runCanvasImportFromFile: runImport,
    };
    // biome-ignore lint/suspicious/noExplicitAny: fake LiveSharePlugin
    registerCommands(plugin as any);
    const guard = commands.find((c) => c.id === IMPORT_FROM_FILE_COMMAND_ID)?.checkCallback;

    expect(guard?.(true)).toBe(false);
    guard?.(false);
    expect(runImport).not.toHaveBeenCalled();

    state.owned = true;
    expect(guard?.(true)).toBe(true);
    guard?.(false);
    expect(runImport).toHaveBeenCalledTimes(1);
  });

  it("both layers refuse independently — neither is the other's only defence", async () => {
    // Bypass the command entirely and call the orchestrator directly, which is
    // exactly what a future second caller would do.
    const rig = switchableRig();
    rig.state.owned = false;

    for (let i = 0; i < 3; i++) {
      const result = await runImportFromFile(PATH, rig.env);
      expect(result.status, `attempt ${i}`).toBe(IMPORT_STATUS.UNAVAILABLE);
    }
    expect(rig.writes).toEqual([]);
    expect(rig.updates).toEqual([]);
  });
});
