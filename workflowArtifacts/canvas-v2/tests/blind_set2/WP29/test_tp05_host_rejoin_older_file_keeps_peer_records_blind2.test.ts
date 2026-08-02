// WP29 / AC3 blind2 — the rejoin's OWN UPDATE is examined, not the board.
//
// The other angles look at what the host holds afterwards and at what the peers
// hold afterwards. This one isolates the artefact that travels: the delta the
// rejoining host produces. A pristine replica of the pre-rejoin state is built,
// ONLY the host's rejoin delta is applied to it, and the replica's visible board
// must not shrink. That separates "the host still has everything" from "the host
// is not TELLING anyone to remove anything" — a rejoin could satisfy the first
// and still ship a removal that bites the moment a peer with a slightly
// different state applies it.
//
// The board also carries a record the peers have already DELETED, which is the
// edge case none of the other angles cover. The host's older file still lists
// it. Two things must both hold:
//
//   ├── the peers' deletion is not undone — a seed is an observation, and a
//   │   stale file is not evidence that a delete was a mistake (WP19's
//   │   tombstone stays in force), and
//   └── the live records the file omits are still not removed.
//
// Those pull in opposite directions, which is exactly why they are asserted
// together: an implementation that "fixed" AC3 by making the seed a no-op passes
// the first and fails the third assertion below; one that kept the old
// destruction passes neither.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasSync,
  buildCanvasData,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";

const PATH = "studio/storyboard.canvas";

function panel(id: string, x: number, text: string) {
  return { id, type: "text", x, y: 0, width: 220, height: 130, text };
}
function tie(id: string, from: string, to: string) {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

// T0 — what the host's `.canvas` file still says.
const T0_PANELS = [panel("p1", 0, "open"), panel("p2", 250, "cut"), panel("p3", 500, "close")];
const T0_TIES = [tie("t12", "p1", "p2"), tie("t23", "p2", "p3")];
const OLD_FILE = JSON.stringify({ nodes: T0_PANELS, edges: T0_TIES });

// After T0 — two peers add panels, and together they delete `p2`.
const PEER_PANELS = [panel("q1", 800, "insert"), panel("q2", 1050, "reaction")];
const PEER_TIE = tie("tq", "p3", "q1");

function put(doc: Y.Doc, kind: "nodes" | "edges", source: Record<string, unknown>): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>(kind).set(String(source.id), record);
    for (const [k, v] of Object.entries(source)) record.set(k, v);
  });
}

function visible(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
  return [...data.nodes.map((n) => String(n.id)), ...data.edges.map((e) => String(e.id))].sort();
}

function vaultDouble(content: string) {
  const files = new Map<string, string>([[PATH, content]]);
  return {
    files,
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    adapter: {
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
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

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** The shared board as it stands when the host comes back. */
function board(fileContent: string) {
  const vault = vaultDouble(fileContent);
  const sync = syncDouble();
  const host = sync.getDoc(canvasDocId(PATH)).doc;

  for (const source of T0_PANELS) put(host, "nodes", source);
  for (const source of T0_TIES) put(host, "edges", source);
  for (const source of PEER_PANELS) put(host, "nodes", source);
  put(host, "edges", PEER_TIE);
  // The peers deleted `p2`. WP19's removal shape is a tombstone entry.
  host.transact(() => {
    host.getMap<unknown>("deleted").set("p2", { t: 9, by: "peer-b", on: true });
  });

  return { vault, sync, host };
}

async function rejoin(vault: unknown, sync: unknown): Promise<CanvasSync> {
  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never,
  );
  canvasSync.setLogger({ debug: () => {}, warn: () => {} });
  await canvasSync.subscribe(PATH, "host");
  return canvasSync;
}

describe("WP29 AC3 blind2 — the rejoin delta carries no removal", () => {
  it("a pristine replica does not shrink when only the rejoin delta is applied", async () => {
    const { vault, sync, host } = board(OLD_FILE);
    // A replica of the state BEFORE the rejoin, and the state vector to diff
    // against so the delta really is only the rejoin's.
    const witness = new Y.Doc();
    Y.applyUpdate(witness, Y.encodeStateAsUpdate(host));
    const mark = Y.encodeStateVector(host);
    const beforeRejoin = visible(witness);

    const canvasSync = await rejoin(vault, sync);
    Y.applyUpdate(witness, Y.encodeStateAsUpdate(host, mark));

    const lost = beforeRejoin.filter((id) => !visible(witness).includes(id));
    expect(lost, "the rejoin delta instructed a peer to remove records").toEqual([]);

    canvasSync.destroy();
    witness.destroy();
  });

  it("the peers' deletion of `p2` is not undone by the host's older file", async () => {
    // The file still lists `p2`. A seed is an observation, not evidence that a
    // delete was wrong — the tombstone stays in force and the panel stays gone.
    const { vault, sync, host } = board(OLD_FILE);
    expect(visible(host), "the fixture did not delete p2").not.toContain("p2");

    const canvasSync = await rejoin(vault, sync);

    expect(visible(host), "the stale file resurrected a panel the peers deleted").not.toContain(
      "p2",
    );
    canvasSync.destroy();
  });

  it("every LIVE record the file omits is still on the board", async () => {
    // `t12` and `t23` are absent from the projection because `p2` is
    // tombstoned and the node->edge cascade prunes an edge whose endpoint is
    // gone — that is WP19's rule, not a WP29 removal, and it is the same before
    // and after the rejoin.
    const { vault, sync, host } = board(OLD_FILE);
    const before = visible(host);
    expect(before, "the fixture's cascade did not behave as described").toEqual([
      "p1",
      "p3",
      "q1",
      "q2",
      "tq",
    ]);

    const canvasSync = await rejoin(vault, sync);

    expect(visible(host)).toEqual(before);
    canvasSync.destroy();
  });

  it("the seed still speaks: the host's own body for `p1` lands", async () => {
    const { vault, sync, host } = board(
      JSON.stringify({
        nodes: [{ ...panel("p1", 0, "open (host's older cut)") }, ...T0_PANELS.slice(1)],
        edges: T0_TIES,
      }),
    );
    const canvasSync = await rejoin(vault, sync);
    expect(
      host.getMap<Y.Map<unknown>>("nodes").get("p1")?.get("text"),
      "the host seed never ran at all",
    ).toBe("open (host's older cut)");
    canvasSync.destroy();
  });

  it("the rejoin adds no tombstone of its own", async () => {
    const { vault, sync, host } = board(OLD_FILE);
    const canvasSync = await rejoin(vault, sync);
    const deleted = host.getMap<unknown>("deleted");
    expect([...deleted.keys()].sort(), "the rejoin wrote tombstones").toEqual(["p2"]);
    canvasSync.destroy();
  });
});
