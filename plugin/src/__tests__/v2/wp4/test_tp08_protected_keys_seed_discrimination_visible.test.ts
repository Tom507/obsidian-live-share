// WP4 / AC6 — the PROTECTED_KEYS discrimination coverage, RELOCATED.
//
// A9 and A10 in `src/__tests__/w4-canvas-integrity.test.ts` used to hold this
// coverage. They disarmed `PROTECTED_KEYS` and asserted that `handleLocalModify`
// then LOST the endpoint. WP4 (AC1) re-based the capture path on the
// Surface-Shadow: `handleLocalModify` routes every write through the C2 intent
// plan, which has no field-removal category at all (I7), so it no longer reads
// `PROTECTED_KEYS`. Disarming the guard could not change that path's outcome any
// more — those probes had become UNFALSIFIABLE, not merely failing, and were
// retired under AC5.
//
// The guard itself is NOT dead. It is still live on the seed boundaries via
// `applyToYMap`, and it is WP18's job to retire it there — not WP4's. So the
// discrimination is relocated to a boundary where it can still go red:
//
//   `CanvasSync.subscribe(path, "host")` → `applyCanvasToYMaps` → `applyToYMap`
//
// That is the host seed: the local file is merged over whatever the doc already
// holds, and `applyToYMap`'s full-merge branch DELETES every doc key the file
// record omits — except the ones `PROTECTED_KEYS` shields. A partial/transient
// `.canvas` read that lists an edge without its endpoints is therefore the exact
// scenario that used to drop arrows on every peer.
//
// The repo's discrimination pattern: ONE scenario, TWO runs, ONE difference.
//   ├── Run A — guard intact  → the edge keeps `fromNode` / `toNode`.
//   └── Run B — that one key deleted from the live guard → the endpoint IS lost.
// Both outcomes are asserted AND compared directly, so a change that quietly
// neutralises the guard cannot leave both halves green.
//
// `PROTECTED_KEYS` is an exported Set, so Run B disarms it IN PROCESS — no source
// file is touched — and a `finally` restores it so test order cannot leak.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync, PROTECTED_KEYS } from "../../../files/canvas-sync";

const PATH = "board.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50 };
const N2 = { id: "n2", type: "text", x: 300, y: 0, width: 100, height: 50 };
/** What the CRDT holds: a complete, routable edge. */
const FULL_EDGE = {
  id: "e1",
  fromNode: "n1",
  toNode: "n2",
  fromSide: "right",
  toSide: "left",
};
/** What the seed file holds: the same edge, endpoints and sides MISSING. */
const PARTIAL_EDGE = { id: "e1", color: "3" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
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

function recordMap(rec: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(rec)) m.set(k, v);
  return m;
}

function edgeRecord(doc: Y.Doc, id: string): Record<string, unknown> | undefined {
  const ymap = doc.getMap<Y.Map<unknown>>("edges").get(id);
  if (!ymap) return undefined;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of ymap) obj[k] = v;
  return obj;
}

/**
 * THE scenario, run identically in both halves. The doc already holds the full
 * edge (a peer built it, or this client held it before the re-subscribe); the
 * local file lists the same edge WITHOUT its endpoints. The host seed merges the
 * file over the doc through `applyToYMap`.
 *
 * Nothing here touches `PROTECTED_KEYS` — the caller owns the one difference.
 */
async function runHostSeed(): Promise<Record<string, unknown> | undefined> {
  const vault = createVault({ [PATH]: canvasJson([N1, N2], [PARTIAL_EDGE]) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });

  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    nodes.set("n1", recordMap(N1));
    nodes.set("n2", recordMap(N2));
    edges.set("e1", recordMap(FULL_EDGE));
  });

  await cs.subscribe(PATH, "host");
  const e1 = edgeRecord(doc, "e1");
  cs.destroy();
  return e1;
}

describe("WP4 AC6 — PROTECTED_KEYS stays falsifiable at the still-live host-seed boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Belt and braces: the guard must be whole for every other suite.
    for (const k of ["fromNode", "toNode"]) PROTECTED_KEYS.add(k);
  });

  it("T1 DISCRIMINATION `fromNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it", async () => {
    // ── Run A: one difference — none. The guard is whole. ──────────────────
    const intact = await runHostSeed();
    expect(intact, "the edge vanished from the CRDT entirely").toBeDefined();
    expect(
      intact?.fromNode,
      "the intact guard failed to protect fromNode across the host seed",
    ).toBe("n1");
    // The non-protected key the partial file DID carry still landed, so the
    // merge genuinely ran rather than being skipped wholesale.
    expect(intact?.color, "the seed never reached applyToYMap — this probe is vacuous").toBe("3");

    // ── Run B: the ONE difference — `fromNode` is no longer guarded. ───────
    const hadFromNode = PROTECTED_KEYS.has("fromNode");
    PROTECTED_KEYS.delete("fromNode");
    let disarmed: Record<string, unknown> | undefined;
    try {
      disarmed = await runHostSeed();
    } finally {
      if (hadFromNode) PROTECTED_KEYS.add("fromNode");
    }
    expect(PROTECTED_KEYS.has("fromNode"), "the guard was not restored").toBe(true);

    expect(
      disarmed?.fromNode,
      "VACUOUS: the endpoint survived even with the guard disarmed — this pair proves nothing",
    ).toBeUndefined();
    // `toNode` was still guarded in run B, so the loss is attributable to the
    // one key that changed and not to the merge failing altogether.
    expect(disarmed?.toNode, "the untouched half of the guard also stopped working").toBe("n2");

    // The two runs are compared directly: the guard is what makes the outcome.
    expect(
      intact?.fromNode === disarmed?.fromNode,
      "both runs agreed — PROTECTED_KEYS no longer decides the outcome at this boundary",
    ).toBe(false);
  });

  it("T2 DISCRIMINATION `toNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it", async () => {
    const intact = await runHostSeed();
    expect(intact, "the edge vanished from the CRDT entirely").toBeDefined();
    expect(intact?.toNode, "the intact guard failed to protect toNode across the host seed").toBe(
      "n2",
    );
    expect(intact?.color, "the seed never reached applyToYMap — this probe is vacuous").toBe("3");

    const hadToNode = PROTECTED_KEYS.has("toNode");
    PROTECTED_KEYS.delete("toNode");
    let disarmed: Record<string, unknown> | undefined;
    try {
      disarmed = await runHostSeed();
    } finally {
      if (hadToNode) PROTECTED_KEYS.add("toNode");
    }
    expect(PROTECTED_KEYS.has("toNode"), "the guard was not restored").toBe(true);

    expect(
      disarmed?.toNode,
      "VACUOUS: the endpoint survived even with the guard disarmed — this pair proves nothing",
    ).toBeUndefined();
    expect(disarmed?.fromNode, "the untouched half of the guard also stopped working").toBe("n1");

    expect(
      intact?.toNode === disarmed?.toNode,
      "both runs agreed — PROTECTED_KEYS no longer decides the outcome at this boundary",
    ).toBe(false);
  });
});
