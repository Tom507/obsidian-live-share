// WP30 / AC3 + I11 blind1 — the refusals attacked as a CORPUS with one uniform
// contract, instead of as four hand-written scenarios.
//
// Every way an import can decline must satisfy the same three-part contract, and
// stating it once over a corpus is what makes a newly-added refusal path inherit
// it rather than quietly opting out:
//
//   ├── it does not THROW. The command fires this from a `checkCallback` where
//   │   a rejection has nowhere to go; an unhandled rejection is the difference
//   │   between "your import did not happen" and a console the user never sees.
//   ├── it writes NOTHING. Zero bytes offered to the vault, zero transactions on
//   │   the live doc, and the doc's state vector byte-identical afterwards.
//   └── it does not claim SUCCESS. The status is never `imported`, and
//       `archivedTo` is never populated by a run that archived nothing.
//
// The corpus is deliberately heterogeneous — a permission refusal, two source
// refusals, a vault refusal and a missing-doc refusal — because the failure mode
// this catches is an implementation that handles the refusal it was thinking
// about and lets the other four escape as rejected promises.
//
// The paired POSITIVE CONTROL is in the same file: the identical rig with a
// well-formed file and a working vault must write, must report `imported`, and
// must name an archive. Without it every assertion here is satisfied by an
// import that never does anything at all.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  readEpoch,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  IMPORT_STATUS,
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

const PATH = "atlas/roadmap.canvas";
const TODAY = "2026-08-02";

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function fileText(nodeIds: string[]): string {
  return JSON.stringify({ nodes: nodeIds.map((id, i) => node(id, i * 10)), edges: [] });
}

function ids(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: unknown, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "31fe8c07d5b2496a8e40c71fa9236bd5");
    meta.set(PATH_KEY, PATH);
    if (epoch !== undefined) meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [i, id] of nodeIds.entries()) {
      const record = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(node(id, i * 25))) record.set(key, value);
      nodes.set(id, record);
    }
  });
  return doc;
}

interface RigOptions {
  owned?: boolean;
  degraded?: boolean;
  text?: string | null;
  noDoc?: boolean;
  vaultRefuses?: boolean;
}

function rig(options: RigOptions) {
  const doc = options.noDoc ? null : replica(11, ["board-1", "board-2"]);
  const writes: string[] = [];
  const updates: unknown[] = [];
  const notices: string[] = [];
  doc?.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: options.owned ?? true, degraded: options.degraded ?? false }),
    liveDoc: () => doc,
    peers: () => [{ displayName: "Nia" }],
    readCanvasFile: async () => (options.text === undefined ? fileText(["z"]) : options.text),
    confirm: async () => true,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) => {
      if (!doc) return null;
      return resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async (path: string) => {
            if (options.vaultRefuses) {
              throw new Error(
                `canvas-epoch: ${path} already exists with different content - refusing to overwrite an existing conflict copy`,
              );
            }
            writes.push(path);
          },
          notify: (message: string) => notices.push(message),
          today: () => TODAY,
        },
      });
    },
    notify: (message: string) => notices.push(message),
  };
  return { env, doc, writes, updates, notices };
}

const REFUSALS: { name: string; options: RigOptions }[] = [
  { name: "unowned path", options: { owned: false } },
  { name: "degraded path", options: { degraded: true } },
  { name: "missing file", options: { text: null } },
  { name: "truncated file", options: { text: '{"nodes":[{"id":"a"' } },
  { name: "file that is not an object", options: { text: "42" } },
  { name: "vault refuses the archive", options: { vaultRefuses: true } },
  { name: "no live doc for this path", options: { noDoc: true } },
];

describe("WP30 tp09 blind1 — every refusal obeys one contract", () => {
  it.each(REFUSALS)("$name never throws", async ({ options }) => {
    const { env } = rig(options);
    await expect(runImportFromFile(PATH, env)).resolves.toBeDefined();
  });

  it.each(REFUSALS)("$name writes nothing at either boundary", async ({ options }) => {
    const { env, doc, writes, updates } = rig(options);
    const before = doc ? Array.from(Y.encodeStateVector(doc)) : null;

    await runImportFromFile(PATH, env);

    expect(writes).toEqual([]);
    expect(updates).toEqual([]);
    if (doc && before) {
      expect(Array.from(Y.encodeStateVector(doc))).toEqual(before);
      expect(ids(doc)).toEqual(["board-1", "board-2"]);
      expect(readEpoch(doc)).toBe(11);
    }
  });

  it.each(REFUSALS)("$name never claims success", async ({ options }) => {
    const { env } = rig(options);
    const result = await runImportFromFile(PATH, env);
    expect(result.status).not.toBe(IMPORT_STATUS.IMPORTED);
    expect(result.archivedTo).toBeNull();
  });

  it("POSITIVE CONTROL: the same rig with a good file and a working vault imports", async () => {
    const { env, doc, writes, updates, notices } = rig({});

    const result = await runImportFromFile(PATH, env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(result.archivedTo).toBeTruthy();
    expect(writes).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(notices.length).toBeGreaterThan(0);
    expect(ids(doc as Y.Doc)).toEqual(["z"]);
    expect(readEpoch(doc as Y.Doc)).toBe(12);
  });

  it("the refusals that got as far as trying still tell the user something", async () => {
    // A refusal the user asked for (unavailable, missing file) may be silent —
    // they will see the command do nothing. A refusal that happened AFTER they
    // confirmed a destruction may not: they authorised something and it did not
    // happen, and I11 says that state has to be legible.
    for (const options of [{ vaultRefuses: true }, { noDoc: true }]) {
      const { env, notices } = rig(options);
      await runImportFromFile(PATH, env);
      expect(notices.length, JSON.stringify(options)).toBeGreaterThan(0);
    }
  });
});
