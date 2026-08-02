// WP21 / AC3 — "`canWriteCanvasPath` (read-only permission and guest globs) is
// preserved and still consulted — authorisation is not locking."
//
// The two guards look alike from inside `canvas-sync.ts` — both are injected
// predicates that can drop a local write — which is exactly why a removal aimed
// at one of them can take the other with it. They are NOT the same thing:
//
//   ├── the LOCK gate answered "is someone else editing this card right now?"
//   │      That is a UX hint, it was never authoritative, and it is gone.
//   └── `canWriteCanvasPath` answers "is this client ALLOWED to write this path
//          at all?" The server's `ws-handler` is authoritative; this is the
//          defense-in-depth client half that stops a read-only guest diverging
//          locally. It stays, and it must still be CONSULTED.
//
// `canWriteCanvasPath` is private to `main.ts`, which has no test file, so the
// claim is pinned the way this repo already pins main.ts glue (`v2/wp5v2/
// test_tp07_wiring_only_visible.test.ts`): the decision rule is written out as
// the predicate `main.ts` must inject, driven through the REAL `setCanWrite`
// seam and the REAL capture path, and the source is scanned to prove main.ts
// still owns and still injects it.
//
// Three permission shapes are exercised, all of them refusals the *lock* removal
// must not have weakened: global read-only, a guest inside a host-designated
// read-only glob, and — the discrimination half — a guest OUTSIDE that glob,
// whose write must land. Without the last one, an implementation that refuses
// everything would pass.

import { readFileSync } from "node:fs";

import { minimatch } from "minimatch";
import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const MAIN_CODE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const LOCKED_PATH = "shared/locked-board.canvas";
const FREE_PATH = "scratch/free-board.canvas";

const CARD = { id: "n1", type: "text", x: 0, y: 0, width: 160, height: 80, text: "card" };

const canvasJson = (nodes: Record<string, unknown>[]) => JSON.stringify({ nodes, edges: [] });

interface Permissions {
  permission: "read-write" | "read-only";
  role: "host" | "guest";
  remoteReadOnlyPatterns: string[];
}

/** `main.ts::canWriteCanvasPath`, written out as the predicate it injects. */
function canWriteCanvasPath(settings: Permissions, path: string): boolean {
  if (settings.permission === "read-only") return false;
  if (
    settings.role === "guest" &&
    settings.remoteReadOnlyPatterns.some((p) => minimatch(path, p))
  ) {
    return false;
  }
  return true;
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** A client whose ONLY injected guard is the authorisation one main.ts owns. */
async function makeClient(settings: Permissions, paths: string[]) {
  const vault = createVault(Object.fromEntries(paths.map((p) => [p, canvasJson([CARD])])));
  const syncManager = createSyncManager();
  const cs = new CanvasSync(vault as never, syncManager as never, {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  } as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setCanWrite((path) => canWriteCanvasPath(settings, path));
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  // Subscribed as `host` so the doc is SEEDED from disk and every scenario below
  // starts from a known shared value. The subscription role is a seeding concern;
  // the authorisation role under test is `settings.role`, which only reaches the
  // capture path through the injected predicate.
  for (const path of paths) await cs.subscribe(path, "host");
  return {
    vault,
    cs,
    nodesOf: (path: string) =>
      syncManager.getDoc(`__canvas__:${path}`).doc.getMap<Y.Map<unknown>>("nodes"),
  };
}

/** Move the card on disk and run one capture pass. */
async function move(
  client: Awaited<ReturnType<typeof makeClient>>,
  path: string,
  x: number,
): Promise<void> {
  client.vault.files.set(path, canvasJson([{ ...CARD, x }]));
  await client.cs.handleLocalModify(path);
}

describe("WP21 AC3 — the read-only authorisation guard is preserved and still consulted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a globally read-only client still cannot push a local canvas edit", async () => {
    const client = await makeClient(
      { permission: "read-only", role: "guest", remoteReadOnlyPatterns: [] },
      [FREE_PATH],
    );

    await move(client, FREE_PATH, 777);

    expect(
      (client.nodesOf(FREE_PATH).get("n1") as Y.Map<unknown>).get("x"),
      "a read-only client pushed a local edit — the authorisation guard was deleted with the lock gate",
    ).toBe(0);

    client.cs.destroy();
  });

  it("a guest is refused inside a host-designated read-only glob and allowed outside it", async () => {
    const client = await makeClient(
      { permission: "read-write", role: "guest", remoteReadOnlyPatterns: ["shared/**"] },
      [LOCKED_PATH, FREE_PATH],
    );

    await move(client, LOCKED_PATH, 500);
    expect(
      (client.nodesOf(LOCKED_PATH).get("n1") as Y.Map<unknown>).get("x"),
      "the guest wrote inside a host-designated read-only glob",
    ).toBe(0);

    // The DISCRIMINATION half: the same client, the same pass, a path the glob
    // does not cover. A guard that refuses everything is not this guard.
    await move(client, FREE_PATH, 500);
    expect(
      (client.nodesOf(FREE_PATH).get("n1") as Y.Map<unknown>).get("x"),
      "the guest was refused on a path no read-only pattern covers",
    ).toBe(500);

    client.cs.destroy();
  });

  it("the host is not caught by a guest glob", async () => {
    const client = await makeClient(
      { permission: "read-write", role: "host", remoteReadOnlyPatterns: ["shared/**"] },
      [LOCKED_PATH],
    );

    await move(client, LOCKED_PATH, 250);
    expect(
      (client.nodesOf(LOCKED_PATH).get("n1") as Y.Map<unknown>).get("x"),
      "the guest read-only globs were applied to the host as well",
    ).toBe(250);

    client.cs.destroy();
  });

  it("main.ts still owns canWriteCanvasPath and still injects it on both capture paths", () => {
    expect(MAIN_CODE, "`canWriteCanvasPath` was removed from main.ts").toMatch(
      /canWriteCanvasPath\s*\(\s*path\s*:/,
    );
    expect(MAIN_CODE, "the read-only permission branch was removed").toMatch(
      /permission\s*===\s*"read-only"/,
    );
    expect(MAIN_CODE, "the guest read-only glob branch was removed").toMatch(/\bminimatch\s*\(/);
    expect(
      MAIN_CODE,
      "main.ts no longer injects the authorisation guard into CanvasSync",
    ).toMatch(/setCanWrite\s*\(\s*\(path\)\s*=>\s*this\.canWriteCanvasPath\(path\)\s*\)/);
    expect(
      MAIN_CODE,
      "the binding-side capture path no longer receives the authorisation guard",
    ).toMatch(/canWrite\s*:\s*\(p\)\s*=>\s*this\.canWriteCanvasPath\(p\)/);
  });
});
