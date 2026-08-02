// WP29 / AC3 blind1 — four replicas, and the oracle is a PER-PEER WORK-LOST
// LEDGER rather than a membership list on the host.
//
// The visible test looks at the host's board and then checks the peers. This one
// inverts it: for every peer it records the set of ids that peer could see
// BEFORE the host rejoined, ships the host's update to that peer, and asserts
// the peer's own set never shrank. The claim is then stated in the units the AC
// is written in — "did anyone lose work?" — and it holds for any board, not just
// for the ids this fixture happens to use.
//
// FOUR replicas rather than three, because with three the host's file is a
// minority of one against two and an implementation could plausibly be
// "reconciling"; with four it is a minority of one against three, and the three
// peers' additions are pairwise disjoint, so a deletion of "everything my file
// omits" is unambiguously destruction rather than arbitration.
//
// The host's `.canvas` is OLDER in the strongest sense available: it is the file
// as it was written before the board existed in its current form, holding two
// cards that have since been RENAMED in body by their owners, and holding none
// of the nine records added afterwards.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasSync,
  buildCanvasData,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";

const PATH = "teams/roadmap.canvas";

function card(id: string, x: number, text: string) {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text };
}
function arrow(id: string, from: string, to: string) {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

const BASE_NODES = [card("q1", 0, "Q1"), card("q2", 250, "Q2")];
const BASE_EDGE = arrow("q1-q2", "q1", "q2");
const OLD_FILE = JSON.stringify({ nodes: BASE_NODES, edges: [BASE_EDGE] });

/** Each peer's own, disjoint contribution after the host went offline. */
const CONTRIBUTIONS: Record<
  string,
  { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
> = {
  beta: {
    nodes: [card("b-hire", 500, "hiring"), card("b-budget", 750, "budget")],
    edges: [arrow("b-link", "q2", "b-hire")],
  },
  gamma: {
    nodes: [card("g-infra", 1000, "infra"), card("g-sec", 1250, "security")],
    edges: [arrow("g-link", "q2", "g-infra")],
  },
  delta: {
    nodes: [card("d-docs", 1500, "docs"), card("d-i18n", 1750, "i18n")],
    edges: [arrow("d-link", "q2", "d-docs")],
  },
};

function put(doc: Y.Doc, kind: "nodes" | "edges", source: Record<string, unknown>): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>(kind).set(String(source.id), record);
    for (const [k, v] of Object.entries(source)) record.set(k, v);
  });
}

function ship(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

function visibleIds(doc: Y.Doc): Set<string> {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
  return new Set([...data.nodes.map((n) => String(n.id)), ...data.edges.map((e) => String(e.id))]);
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

function buildBoard(fileContent: string) {
  const vault = vaultDouble(fileContent);
  const sync = syncDouble();
  const host = sync.getDoc(canvasDocId(PATH)).doc;

  for (const source of BASE_NODES) put(host, "nodes", source);
  put(host, "edges", BASE_EDGE);

  const peers: Record<string, Y.Doc> = {};
  for (const name of Object.keys(CONTRIBUTIONS)) {
    const peer = new Y.Doc();
    ship(host, peer);
    peers[name] = peer;
  }

  // Each peer draws its own records, and renames one of the base cards' bodies.
  for (const [name, work] of Object.entries(CONTRIBUTIONS)) {
    const peer = peers[name];
    for (const source of work.nodes) put(peer, "nodes", source);
    for (const source of work.edges) put(peer, "edges", source);
  }
  peers.beta.transact(() => {
    peers.beta.getMap<Y.Map<unknown>>("nodes").get("q1")?.set("text", "Q1 — committed");
  });

  // Everyone meets everyone, including the host's replica.
  const all = [host, ...Object.values(peers)];
  for (const a of all) for (const b of all) if (a !== b) ship(a, b);

  return { vault, sync, host, peers };
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

describe("WP29 AC3 blind1 — nobody's work-lost ledger has an entry", () => {
  it("the fixture really does put nine peer records out of the host file's reach", () => {
    const { host } = buildBoard(OLD_FILE);
    const board = visibleIds(host);
    const inFile = new Set(["q1", "q2", "q1-q2"]);
    const outOfReach = [...board].filter((id) => !inFile.has(id));
    expect(outOfReach.sort()).toEqual([
      "b-budget",
      "b-hire",
      "b-link",
      "d-docs",
      "d-i18n",
      "d-link",
      "g-infra",
      "g-link",
      "g-sec",
    ]);
  });

  it("no peer's visible set shrinks when the host's rejoin update arrives", async () => {
    const { vault, sync, host, peers } = buildBoard(OLD_FILE);
    const beforeByPeer = Object.fromEntries(
      Object.entries(peers).map(([name, doc]) => [name, visibleIds(doc)]),
    );

    const canvasSync = await rejoin(vault, sync);
    for (const peer of Object.values(peers)) ship(host, peer);

    for (const [name, doc] of Object.entries(peers)) {
      const lost = [...beforeByPeer[name]].filter((id) => !visibleIds(doc).has(id));
      expect(lost, `${name} lost work when the host rejoined with an older file`).toEqual([]);
    }

    canvasSync.destroy();
  });

  it("the host's own replica holds all twelve records after the rejoin", async () => {
    const { vault, sync, host } = buildBoard(OLD_FILE);
    const canvasSync = await rejoin(vault, sync);
    expect(visibleIds(host).size, "the rejoining host's board shrank").toBe(12);
    canvasSync.destroy();
  });

  it("a rejoin with an EMPTY file is equally harmless", async () => {
    const { vault, sync, host, peers } = buildBoard(JSON.stringify({ nodes: [], edges: [] }));
    const before = visibleIds(host);
    const canvasSync = await rejoin(vault, sync);
    for (const peer of Object.values(peers)) ship(host, peer);

    expect([...visibleIds(host)].sort()).toEqual([...before].sort());
    for (const [name, doc] of Object.entries(peers)) {
      expect([...visibleIds(doc)].sort(), `${name} was emptied by the host's empty file`).toEqual(
        [...before].sort(),
      );
    }
    canvasSync.destroy();
  });

  it("the rejoin still speaks — the file's own body for `q1` lands", async () => {
    // Non-vacuity, and the honest boundary of the claim: keys still upsert
    // (WP18), records are never removed (WP29). Without this the whole file
    // passes against an implementation with no host seed at all.
    const { vault, sync, host } = buildBoard(OLD_FILE);
    expect(host.getMap<Y.Map<unknown>>("nodes").get("q1")?.get("text")).toBe("Q1 — committed");
    const canvasSync = await rejoin(vault, sync);
    expect(
      host.getMap<Y.Map<unknown>>("nodes").get("q1")?.get("text"),
      "the host seed never ran",
    ).toBe("Q1");
    canvasSync.destroy();
  });

  it("nothing was removed by tombstone either", async () => {
    const { vault, sync, host } = buildBoard(OLD_FILE);
    const canvasSync = await rejoin(vault, sync);
    expect(host.getMap<unknown>("deleted").size).toBe(0);
    canvasSync.destroy();
  });
});
