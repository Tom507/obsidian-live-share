// WP19 AC3 blind1 — the cascade must reach the FILE on its own initiative.
//
// A remote delete writes to `deleted` and to nothing else: `nodes` and `edges`
// are not touched at all. `CanvasPersistence` is the single CRDT→disk writer and
// it schedules its debounced write from an observer. If that observer does not
// watch the tombstone container, the delete simply never triggers a write and
// the user's `.canvas` keeps the deleted card and its arrows forever — no error,
// no signature, just a file that quietly disagrees with every peer.
//
// So this test deliberately does NOT call `flush()`. It lets the debounce fire
// through the injected scheduler and reads whatever landed on disk, which is the
// only way to distinguish "the projection is right" from "the projection is
// right and something asks for it".
//
// Different shape from the visible scenario in three ways: the deleted card is
// the arrow's TO endpoint rather than its FROM endpoint, the doc is built by
// `coldOpen` rather than by a host subscribe, and the deletion is remote rather
// than local.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const PATH = "ops/runbook.canvas";

const SOURCE = { id: "source", type: "text", x: 0, y: 0, width: 200, height: 100, text: "source" };
const SINK = { id: "sink", type: "text", x: 600, y: 0, width: 200, height: 100, text: "sink" };
const OTHER = { id: "other", type: "text", x: 0, y: 500, width: 200, height: 100, text: "other" };
const INBOUND = {
  id: "inbound",
  fromNode: "source",
  fromSide: "right",
  toNode: "sink",
  toSide: "left",
};
const ELSEWHERE = {
  id: "elsewhere",
  fromNode: "source",
  fromSide: "bottom",
  toNode: "other",
  toSide: "top",
};

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createIO(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const io = {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string> };
}

function fileIds(content: string): { nodes: string[]; edges: string[] } {
  const parsed = JSON.parse(content) as {
    nodes?: Record<string, unknown>[];
    edges?: Record<string, unknown>[];
  };
  return {
    nodes: (parsed.nodes ?? []).map((node) => String(node.id)),
    edges: (parsed.edges ?? []).map((edge) => String(edge.id)),
  };
}

describe("WP19 AC3 blind1 — a remote node delete cascades all the way to disk, unprompted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the debounced writer notices the tombstone and writes a file without the card or its inbound arrow", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [PATH]: canvasJson([SOURCE, SINK, OTHER], [INBOUND, ELSEWHERE]) });
    const persistence = new CanvasPersistence(doc, io, PATH, {
      logger: { debug: () => {}, warn: () => {} },
    });

    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    persistence.start();

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const nodeKeysBefore = [...nodes.keys()].sort();
    const edgeKeysBefore = [...edges.keys()].sort();
    const inboundBefore = edges.get("inbound")?.toJSON();
    expect(inboundBefore, "the cold-open seed never created the arrow under test").toBeDefined();

    // A peer deletes the arrow's TO endpoint. Nothing but `deleted` changes.
    doc.transact(() => {
      applyTombstoneOp(doc.getMap<unknown>("deleted"), "sink", {
        t: 11,
        by: "peer-remote",
        on: true,
      });
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const written = io.files.get(PATH);
    expect(written, "the writer produced no file at all").toBeDefined();
    const onDisk = fileIds(written ?? "{}");
    expect(
      onDisk.nodes.sort(),
      "the tombstoned card is still in the file — the writer never noticed the delete",
    ).toEqual(["other", "source"]);
    expect(
      onDisk.edges.sort(),
      "the cascade did not reach the file, or it took the unrelated arrow with it",
    ).toEqual(["elsewhere"]);

    // Nothing was destroyed to achieve any of that.
    expect([...nodes.keys()].sort(), "a node key was removed").toEqual(nodeKeysBefore);
    expect([...edges.keys()].sort(), "the cascade removed an edge key").toEqual(edgeKeysBefore);
    expect(
      edges.get("inbound")?.toJSON(),
      "the cascaded arrow lost fields — it is no longer restorable",
    ).toEqual(inboundBefore);

    persistence.destroy();
    doc.destroy();
  });
});
