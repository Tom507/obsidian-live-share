// WP30 / AC3 + I11 blind2 — the refused archive attacked as RECOVERABILITY over
// a stateful vault, which is the only way its actual field behaviour shows up.
//
// WP28's `conflictCopyPath` is day-granular. Two conflicts on the same board on
// the same day therefore name the SAME file, and `writeConflictCopy` never
// clobbers: an identical body is an idempotent re-run and succeeds, anything
// else throws — and because the mechanism is fail-closed, that refusal cancels
// the adoption. All of that is invisible to a stub that always resolves or
// always rejects. So the vault here is a real map with contents, and the
// scenarios are the three it distinguishes:
//
//   ├── the name is free            -> the archive lands, the import lands;
//   ├── the name is taken by an
//   │   IDENTICAL body              -> idempotent, the import lands anyway;
//   └── the name is taken by a
//       DIFFERENT body              -> refused, and NOTHING is lost: the import
//                                      does not happen, the board is untouched,
//                                      and the file already there — another
//                                      replica's only surviving copy — is still
//                                      byte-for-byte what it was.
//
// The last line is the recoverability claim and it is the one worth writing
// down. A "best effort" archive would have traded one loser's copy for another's
// and called it success; here the user keeps everything and simply has to try
// again (or tomorrow, when the name is free). The state after the refusal must
// be a state they can act on: board intact, archive intact, and a notice saying
// so — never a silent no-op.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  conflictCopyPath,
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

const PATH = "vault/deck.canvas";
const TODAY = "2026-08-02";
const ARCHIVE = conflictCopyPath(PATH, TODAY);

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
    meta.set(GUID_KEY, "e0417cba9d2f45638a170cde52b93f6a");
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

/** The never-clobber rule, implemented over a real store. */
function statefulVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    write: async (path: string, content: string) => {
      const existing = files.get(path);
      if (existing !== undefined) {
        if (existing === content) return; // idempotent re-run
        throw new Error(
          `canvas-epoch: ${path} already exists with different content - refusing to overwrite an existing conflict copy`,
        );
      }
      files.set(path, content);
    },
  };
}

function rig(vault: ReturnType<typeof statefulVault>, boardIds: string[]) {
  const doc = replica(6, boardIds);
  const updates: unknown[] = [];
  const notices: string[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [{ displayName: "Nia" }],
    readCanvasFile: async () => JSON.stringify({ nodes: [node("z")], edges: [] }),
    confirm: async () => true,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
      resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: vault.write,
          notify: (message: string) => notices.push(message),
          today: () => TODAY,
        },
      }),
    notify: (message: string) => notices.push(message),
  };
  return { env, doc, updates, notices };
}

describe("WP30 tp09 blind2 — a refused archive is recoverable, not a silent no-op", () => {
  it("a free name: the archive lands and so does the import", async () => {
    const vault = statefulVault();
    const r = rig(vault, ["board-1"]);

    const result = await runImportFromFile(PATH, r.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect([...vault.files.keys()]).toEqual([ARCHIVE]);
    expect(vault.files.get(ARCHIVE)).toContain("board-1");
    expect(ids(r.doc)).toEqual(["z"]);
    expect(readEpoch(r.doc)).toBe(7);
  });

  it("a name taken by an IDENTICAL body is an idempotent re-run", async () => {
    const body = JSON.stringify(["board-1"]);
    const vault = statefulVault({ [ARCHIVE]: body });
    const r = rig(vault, ["board-1"]);

    const result = await runImportFromFile(PATH, r.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(vault.files.get(ARCHIVE)).toBe(body);
    expect(vault.files.size).toBe(1);
    expect(ids(r.doc)).toEqual(["z"]);
  });

  it("a name taken by a DIFFERENT body is refused, and the import does not happen", async () => {
    const someoneElse = JSON.stringify(["a-different-replicas-only-copy"]);
    const vault = statefulVault({ [ARCHIVE]: someoneElse });
    const r = rig(vault, ["board-1", "board-2"]);

    const result = await runImportFromFile(PATH, r.env);

    expect(result.status).toBe(IMPORT_STATUS.ADOPTION_REFUSED);
    expect(result.archivedTo).toBeNull();
  });

  it("NOTHING is lost by the refusal: board intact, other replica's copy intact", async () => {
    const someoneElse = JSON.stringify(["a-different-replicas-only-copy"]);
    const vault = statefulVault({ [ARCHIVE]: someoneElse });
    const r = rig(vault, ["board-1", "board-2"]);
    const stateBefore = Array.from(Y.encodeStateVector(r.doc));

    await runImportFromFile(PATH, r.env);

    expect(vault.files.get(ARCHIVE)).toBe(someoneElse);
    expect(vault.files.size).toBe(1);
    expect(ids(r.doc)).toEqual(["board-1", "board-2"]);
    expect(readEpoch(r.doc)).toBe(6);
    expect(r.updates).toEqual([]);
    expect(Array.from(Y.encodeStateVector(r.doc))).toEqual(stateBefore);
  });

  it("the refusal is legible: the user is told, and told about this board", async () => {
    const vault = statefulVault({ [ARCHIVE]: JSON.stringify(["other"]) });
    const r = rig(vault, ["board-1"]);

    const result = await runImportFromFile(PATH, r.env);

    expect(r.notices.length).toBeGreaterThan(0);
    expect(r.notices.join(" ")).toContain(PATH);
    expect(result.detail).toBeTruthy();
  });

  it("clearing the obstruction lets the very same import through", async () => {
    const vault = statefulVault({ [ARCHIVE]: JSON.stringify(["other"]) });
    const r = rig(vault, ["board-1"]);

    expect((await runImportFromFile(PATH, r.env)).status).toBe(IMPORT_STATUS.ADOPTION_REFUSED);

    vault.files.delete(ARCHIVE);

    const second = await runImportFromFile(PATH, r.env);
    expect(second.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(ids(r.doc)).toEqual(["z"]);
    expect(readEpoch(r.doc)).toBe(7);
    expect(vault.files.get(ARCHIVE)).toContain("board-1");
  });
});
