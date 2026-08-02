// WP21 AC1 blind1 — the seam judged by ENUMERATION rather than by name.
//
// The visible test asks "is `setCanWriteNode` undefined?". That is a question
// about a name someone has to remember to ask about. This one asks the opposite
// question: what injection points does `CanvasSync` still expose AT ALL? The
// expected answer is a closed list, so a gate that survives under a renamed
// spelling (`setNodeWriteGate`, `setLockPredicate`, …) is caught too, and so is
// an over-deletion that removed a seam AC2 and AC3 require to stay.
//
// The second oracle is runtime reachability on an EDGE-ONLY canvas — the branch
// the visible test does not start from. An edge write used to be gated on BOTH
// endpoint nodes, so an edge-heavy fixture is the densest way to reach the old
// gate; if the denial machinery were still live behind any spelling, a warn line
// would appear. Nothing is asserted about log CONTENT as an oracle for state:
// the doc is checked independently.

import { readFileSync } from "node:fs";

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "graphs/wiring.canvas";

const HUB = { id: "hub", type: "group", x: 0, y: 0, width: 400, height: 400, label: "hub" };
const LEAF = { id: "leaf", type: "link", x: 700, y: 0, width: 200, height: 100, url: "https://x" };
const A_TO_B = { id: "ab", fromNode: "hub", fromSide: "right", toNode: "leaf", toSide: "left" };
const B_TO_A = { id: "ba", fromNode: "leaf", fromSide: "bottom", toNode: "hub", toSide: "top" };

const canvasJson = (nodes: Record<string, unknown>[], edges: Record<string, unknown>[]) =>
  JSON.stringify({ nodes, edges });

function createVault(initial: Record<string, string>) {
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

/** Every injection point on the class, whatever it happens to be called. */
function injectionPoints(instance: object): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object)
    .filter((name) => /^set[A-Z]/.test(name))
    .sort();
}

describe("WP21 AC1 blind1 — CanvasSync's injection surface no longer includes a lock gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the set of injectable seams is exactly the post-WP21 list", async () => {
    const vault = createVault({ [PATH]: canvasJson([HUB, LEAF], [A_TO_B, B_TO_A]) });
    const cs = new CanvasSync(vault as never, createSyncManager() as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);

    const seams = injectionPoints(cs);

    // Nothing that gates a WRITE on a per-node LOCK may remain, under any name.
    const lockShaped = seams.filter((name) => /Node$/.test(name) && /^setCan/.test(name));
    expect(
      lockShaped,
      "a per-node lock gate is still injectable into the capture path (possibly renamed)",
    ).toEqual([]);
    expect(seams, "the removed write gate is still injectable").not.toContain("setCanWriteNode");
    expect(seams, "the removed delete gate is still injectable").not.toContain("setCanDeleteNode");

    // The over-deletion guard, stated as membership rather than as `typeof`.
    for (const required of [
      "setCanWrite",
      "setLogger",
      "setOnLocalNodeChange",
      "setOnRemoteCanvasUpdate",
      "setSurfaceStateProvider",
    ]) {
      expect(seams, `the surviving seam \`${required}\` was deleted with the lock gate`).toContain(
        required,
      );
    }

    cs.destroy();
  });

  it("an edge-dense capture pass produces no denial signature and lands every write", async () => {
    const vault = createVault({ [PATH]: canvasJson([HUB, LEAF], [A_TO_B, B_TO_A]) });
    const syncManager = createSyncManager();
    const warns: string[] = [];
    const cs = new CanvasSync(vault as never, syncManager as never, {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never);
    cs.setLogger({ debug: () => {}, warn: (_c: string, m: string) => warns.push(m) });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: false,
        handedToView: { node: new Set<string>(), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const both = canvasJson(
      [HUB, LEAF],
      [
        { ...A_TO_B, label: "feeds", color: "5" },
        { ...B_TO_A, toSide: "left" },
      ],
    );
    vault.files.set(PATH, both);
    await cs.handleLocalModify(PATH);

    const edges = syncManager.getDoc(`__canvas__:${PATH}`).doc.getMap<Y.Map<unknown>>("edges");
    expect((edges.get("ab") as Y.Map<unknown>).get("label"), "an edge write was dropped").toBe(
      "feeds",
    );
    expect((edges.get("ba") as Y.Map<unknown>).get("toSide"), "an edge write was dropped").toBe(
      "left",
    );
    expect(
      warns.filter((m) => m.includes("DENIED")),
      "a denial signature is still reachable at runtime",
    ).toEqual([]);
    expect(
      (cs as unknown as { lastWrittenContent: Map<string, string> }).lastWrittenContent.get(PATH),
      "the diff baseline did not advance on a clean pass",
    ).toBe(both);

    cs.destroy();
  });

  it("the module source names no lock-seam gate", () => {
    const source = readFileSync(new URL("../../../files/canvas-sync.ts", import.meta.url), "utf8");
    for (const token of ["canWriteEntity", "LOCK DENIED:", "canDeleteNode", "canWriteNode"]) {
      expect(
        source.includes(token),
        `canvas-sync.ts still mentions \`${token}\` — the removal left a live reference or a stale comment`,
      ).toBe(false);
    }
  });
});
