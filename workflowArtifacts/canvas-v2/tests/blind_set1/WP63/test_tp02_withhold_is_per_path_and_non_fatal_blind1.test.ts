// WP63 / AC2 — blind counterpart 1. Same claim as the visible probe, derived
// independently and attacked with a wider blast radius:
//
//   ├── THREE paths share one disk, not two. A withhold implemented as a module
//   │   -level flag, or keyed on "some canvas has refusals", passes a two-path
//   │   probe by accident far more often than a three-path one, and the two
//   │   clean canvases here sit on either side of the refused one in write order.
//   ├── the refused record is an EDGE (MISSING_TO), so the per-path ledger is
//   │   exercised through the edge id space, and
//   └── the "still syncing" leg lands a remote NODE *and* a remote EDGE on the
//       withheld canvas — the write-back is suspended, the CRDT is not.
//
// The failure this rules out is the "safe" over-reaction: a refusal that trips a
// global flag, throws out of `flush`, or tears the session down. Each of those
// trades one data-loss class for a bigger one.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const REFUSED = "team/a-refused.canvas";
const CLEAN_EARLY = "team/0-clean.canvas";
const CLEAN_LATE = "team/z-clean.canvas";

const NODE_A = { id: "n-alpha", type: "text", x: 0, y: 0, width: 200, height: 90, text: "alpha" };
const NODE_B = { id: "n-beta", type: "text", x: 400, y: 0, width: 200, height: 90, text: "beta" };
const SIDELESS_EDGE = { id: "e-sideless", fromNode: "n-alpha", toNode: "n-beta" };
const HALF_EDGE = { id: "e-half", fromNode: "n-alpha", fromSide: "right", color: "4" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges });
}

interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

function createIO(initial: Record<string, string>): FakeIO {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
}

function recordingLogger(): {
  lines: string[];
  debug(c: string, m: string): void;
  warn(c: string, m: string): void;
} {
  const lines: string[] = [];
  return {
    lines,
    debug: (_c: string, m: string) => void lines.push(m),
    warn: (_c: string, m: string) => void lines.push(m),
  };
}

function nodeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id));
}

/** Apply a delta the way a PEER would — a real update from a second doc. */
function applyRemoteDelta(doc: Y.Doc, build: (peer: Y.Doc) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function putRecord(container: Y.Map<Y.Map<unknown>>, id: string, fields: Record<string, unknown>) {
  const record = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) record.set(k, v);
  container.set(id, record);
}

describe("WP63 AC2 blind1 — one canvas degrades, the rest of the session does not", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a refusal on one path suspends nothing on the two canvases either side of it", async () => {
    const refusedBefore = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
    const earlyBefore = canvasJson([NODE_A], []);
    const lateBefore = canvasJson([NODE_B], []);
    const io = createIO({
      [CLEAN_EARLY]: earlyBefore,
      [REFUSED]: refusedBefore,
      [CLEAN_LATE]: lateBefore,
    });

    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const early = new CanvasPersistence(docs[0], io, CLEAN_EARLY);
    const refused = new CanvasPersistence(docs[1], io, REFUSED);
    const late = new CanvasPersistence(docs[2], io, CLEAN_LATE);

    for (const p of [early, refused, late]) {
      expect(await p.coldOpen()).toBe("seeded-from-file");
    }
    // Interleaved on purpose: the refused path flushes BETWEEN the two clean
    // ones, so a global latch would be visible.
    await early.flush();
    await refused.flush();
    await late.flush();

    expect(refused.isWriteWithheld(), "the refused path is not withheld").toBe(true);
    expect(early.isWriteWithheld(), "the withhold leaked backwards to an unrelated canvas").toBe(
      false,
    );
    expect(late.isWriteWithheld(), "the withhold leaked forwards to an unrelated canvas").toBe(
      false,
    );

    expect(io.files.get(REFUSED), "the refused path's file was rewritten").toBe(refusedBefore);
    expect(
      io.files.get(CLEAN_EARLY),
      "an unrelated canvas stopped persisting because a DIFFERENT canvas had a refusal",
    ).not.toBe(earlyBefore);
    expect(io.files.get(CLEAN_LATE)).not.toBe(lateBefore);
    expect(nodeIdsIn(io.files.get(CLEAN_EARLY) as string)).toEqual(["n-alpha"]);
    expect(nodeIdsIn(io.files.get(CLEAN_LATE) as string)).toEqual(["n-beta"]);

    // The ledgers are per path, not a shared bag.
    expect(refused.seedRefusals().map((r) => r.id)).toEqual(["e-half"]);
    expect(early.seedRefusals()).toEqual([]);
    expect(late.seedRefusals()).toEqual([]);

    for (const p of [early, refused, late]) p.destroy();
    for (const d of docs) d.destroy();
  });

  it("the withheld canvas keeps syncing: remote node AND edge deltas land, and no flush throws", async () => {
    const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
    const io = createIO({ [REFUSED]: before });
    const logger = recordingLogger();
    const doc = new Y.Doc();
    const p = new CanvasPersistence(doc, io, REFUSED, { logger });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    p.start();

    applyRemoteDelta(doc, (peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      const edges = peer.getMap<Y.Map<unknown>>("edges");
      (nodes.get("n-alpha") as Y.Map<unknown>).set("x", 640);
      putRecord(nodes, "n-peer", {
        id: "n-peer",
        type: "text",
        x: 900,
        y: 300,
        width: 100,
        height: 50,
        text: "from a peer",
      });
      putRecord(edges, "e-peer", { id: "e-peer", fromNode: "n-beta", toNode: "n-peer" });
    });

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    expect(nodes.get("n-alpha")?.get("x"), "a remote delta was dropped by the withheld canvas").toBe(
      640,
    );
    expect(nodes.has("n-peer"), "the withheld canvas stopped accepting remote records").toBe(true);
    expect(edges.has("e-peer"), "the withheld canvas stopped accepting remote EDGES").toBe(true);

    // Repeated real write attempts: still withheld, still no throw, file still
    // byte-identical. A withhold is a degrade, never a failure.
    await expect(p.flush()).resolves.toBeUndefined();
    await expect(p.flush()).resolves.toBeUndefined();
    await expect(p.flush()).resolves.toBeUndefined();
    expect(io.files.get(REFUSED)).toBe(before);
    expect(io.write).not.toHaveBeenCalled();
    expect(p.isWriteWithheld()).toBe(true);

    // ...and it is never a SILENT no-op.
    expect(
      logger.lines.filter((line) => line.startsWith("SEED REFUSED:")).length,
      "a withheld write went unnarrated",
    ).toBeGreaterThanOrEqual(1);

    p.destroy();
    doc.destroy();
  });
});
