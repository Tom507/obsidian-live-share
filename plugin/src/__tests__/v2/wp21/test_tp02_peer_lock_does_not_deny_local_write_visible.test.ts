// WP21 / AC1, the behavioural half — "no capture path consults a lock before
// writing, and no code path holds a diff baseline because a write was denied."
//
// The lock is REAL here, not a stub predicate: two peers hold `n1` through
// actual `CanvasPresence` instances over one shared awareness map, so
// `presence.canWriteNode("n1")` is genuinely `false` for the local client for
// the whole of every scenario below. That is what stops this from being a
// vacuous "nothing was wired, so nothing was denied" test — the UX lock is held,
// and the write lands anyway.
//
// The `CanvasSync` under test is wired the way `main.ts` must wire it AFTER this
// WP: the read-only guard (AC3), the diff-inferred lock claim (AC2) and the
// surface-state seam, and NO per-node write gate — because there is none to
// wire. Each scenario therefore carries the seam-absence assertion with it: "no
// capture path consults a lock" is only true if the capture path cannot be
// given a lock to consult.
//
// All three of the removed gate's call sites are covered, because they are three
// separate branches in `applyIntentPlan`:
//
//   ├── the node UPSERT branch        (the field-group loop),
//   ├── the EDGE branch               (gated on BOTH endpoint nodes), and
//   └── the node DELETE branch        (the old `canDeleteNode` check).
//
// CRDT ORDERING: the peer's delta is integrated BEFORE the local save in every
// scenario, so the local write is a causal successor and asserting its value is
// legitimate. Nothing here asserts the winner of a concurrent same-key write.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type AwarenessLike, CanvasPresence } from "../../../canvas/canvas-presence";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";
import { collabText } from "../../harness/collab-text";

const PATH = "atlas/board.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "left" };
const N2 = { id: "n2", type: "text", x: 400, y: 0, width: 200, height: 100, text: "right" };
const E1 = { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" };

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
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

/** One shared in-memory awareness map — three real peers, no transport. */
function makeAwarenessNetwork() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners: Array<() => void> = [];
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    states,
    client(clientID: number): AwarenessLike {
      return {
        clientID,
        getLocalState: () => states.get(clientID) ?? null,
        setLocalState: (s: Record<string, unknown> | null) => {
          if (s === null) states.delete(clientID);
          else states.set(clientID, s);
          notify();
        },
        getStates: () => states,
        on: (_e, cb) => {
          listeners.push(cb);
        },
        off: (_e, cb) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };
}

/** A non-local (remote) mutation, exactly as the sync protocol integrates one. */
function applyRemoteCanvasDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
) {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "remote");
  remote.destroy();
}

/**
 * The room: three peers over one awareness map, `LOCAL` (clientID 2) being this
 * client. `peerHolds` is claimed by B (1) and C (3), so the local client is
 * never the lowest-id holder and its `canWriteNode` is false throughout.
 *
 * The `CanvasSync` wiring below is `main.ts` AFTER WP21 — every seam it still
 * owns, and no write gate.
 */
async function makeRoom(diskJson: string, peerHolds: string[], handed: string[]) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const net = makeAwarenessNetwork();

  const B = new CanvasPresence({
    path: PATH,
    awareness: net.client(1),
    identity: { clientId: 1, name: "B", color: "#1b1" },
  });
  const LOCAL = new CanvasPresence({
    path: PATH,
    awareness: net.client(2),
    identity: { clientId: 2, name: "A", color: "#a11" },
  });
  const C = new CanvasPresence({
    path: PATH,
    awareness: net.client(3),
    identity: { clientId: 3, name: "C", color: "#11c" },
  });
  B.start();
  LOCAL.start();
  C.start();
  for (const nodeId of peerHolds) {
    B.acquireLock(nodeId);
    C.acquireLock(nodeId);
  }

  const warns: string[] = [];
  const cs = new CanvasSync(vault as never, syncManager as never, {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  } as never);
  cs.setLogger({ debug: () => {}, warn: (_c: string, m: string) => warns.push(m) });
  // AC3 — authorisation is NOT locking, and it stays wired.
  cs.setCanWrite(() => true);
  // AC2 — the diff-inferred lock CLAIM is UX and stays wired.
  cs.setOnLocalNodeChange((_p, nodeId) => LOCAL.onDiffInferredChange(nodeId));
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: handed.length > 0,
      handedToView: { node: new Set(handed), edge: new Set(handed) },
    }),
  );
  await cs.subscribe(PATH, "host");

  return {
    vault,
    cs,
    warns,
    LOCAL,
    B,
    C,
    doc: syncManager.getDoc(`__canvas__:${PATH}`).doc,
    baseline: () =>
      (cs as unknown as { lastWrittenContent: Map<string, string> }).lastWrittenContent.get(PATH),
    teardown: () => {
      cs.destroy();
      B.destroy();
      LOCAL.destroy();
      C.destroy();
    },
  };
}

/** AC1's structural half, carried by every scenario. */
function expectNoWriteGateSeam(cs: CanvasSync): void {
  const surface = cs as unknown as Record<string, unknown>;
  expect(
    typeof surface.setCanWriteNode,
    "a lock write-gate can still be injected into the capture path",
  ).toBe("undefined");
  expect(
    typeof surface.setCanDeleteNode,
    "a lock delete-gate can still be injected into the capture path",
  ).toBe("undefined");
}

const denials = (warns: string[]) => warns.filter((m) => m.startsWith("LOCK DENIED:"));

describe("WP21 AC1 — a peer's lock no longer denies a local write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a node two peers hold is still moved by the local save, and the baseline advances", async () => {
    const room = await makeRoom(canvasJson([N1, N2], [E1]), ["n1"], []);
    const nodes = room.doc.getMap<Y.Map<unknown>>("nodes");

    expect(
      room.LOCAL.canWriteNode("n1"),
      "the fixture is vacuous: no peer actually holds the node under test",
    ).toBe(false);
    expectNoWriteGateSeam(room.cs);

    // The holder's move arrives FIRST, so the local write below is a causal
    // successor and its value is a legitimate assertion target.
    applyRemoteCanvasDelta(room.doc, (n) => {
      (n.get("n1") as Y.Map<unknown>).set("x", 300);
    });
    expect((nodes.get("n1") as Y.Map<unknown>).get("x")).toBe(300);

    const moved = canvasJson([{ ...N1, x: 50 }, N2], [E1]);
    room.vault.files.set(PATH, moved);
    await room.cs.handleLocalModify(PATH);

    expect(
      (nodes.get("n1") as Y.Map<unknown>).get("x"),
      "the local move never reached the doc — a lock still gates the capture path",
    ).toBe(50);
    expect(
      room.baseline(),
      "the diff baseline was HELD: some path still treats this pass as denied",
    ).toBe(moved);
    expect(denials(room.warns), "the removed `LOCK DENIED:` emitter still fires").toEqual([]);
    expect(
      room.LOCAL.canWriteNode("n1"),
      "the peers' lock evaporated — the UX lock must be untouched by this WP",
    ).toBe(false);

    room.teardown();
  });

  it("an edge whose endpoint two peers hold is still re-routed by the local save", async () => {
    const room = await makeRoom(canvasJson([N1, N2], [E1]), ["n2"], []);
    const edges = room.doc.getMap<Y.Map<unknown>>("edges");

    expect(
      room.LOCAL.canWriteNode("n2"),
      "the fixture is vacuous: no peer holds the edge's endpoint",
    ).toBe(false);
    expectNoWriteGateSeam(room.cs);

    applyRemoteCanvasDelta(room.doc, (_n, e) => {
      (e.get("e1") as Y.Map<unknown>).set("color", "3");
    });

    const rerouted = canvasJson([N1, N2], [{ ...E1, toSide: "top", label: "depends on" }]);
    room.vault.files.set(PATH, rerouted);
    await room.cs.handleLocalModify(PATH);

    const e1 = edges.get("e1") as Y.Map<unknown>;
    expect(
      e1.get("toSide"),
      "the edge write was dropped because a peer holds an endpoint node",
    ).toBe("top");
    // WP36 follow-up (B32) — RE-ORACLED. An edge `label` is a collaborative text
    // now, so the old `.toBe("depends on")` compared a `Y.Text` to a string.
    // Value verbatim, plus the post-WP36 invariant that the capture did not
    // flatten it. Paired PRE-WP36 CONTROL below.
    expect(collabText(e1.get("label")), "the edge's new label never reached the doc").toEqual({
      shape: "ytext",
      text: "depends on",
    });
    expect(e1.get("color"), "the peer's concurrent key was lost by the local pass").toBe("3");
    expect(room.baseline(), "the diff baseline was held on an edge write").toBe(rerouted);
    expect(denials(room.warns), "the removed `LOCK DENIED:` emitter still fires").toEqual([]);

    room.teardown();
  });

  it("PRE-WP36 CONTROL: the re-oracled label assertion is RED on the whole-string LWW register", async () => {
    const room = await makeRoom(canvasJson([N1, N2], [E1]), ["n2"], []);
    room.cs.setCollabTextEnabled(false); // the behaviour WP36 replaced
    const edges = room.doc.getMap<Y.Map<unknown>>("edges");

    applyRemoteCanvasDelta(room.doc, (_n, e) => {
      (e.get("e1") as Y.Map<unknown>).set("color", "3");
    });
    room.vault.files.set(
      PATH,
      canvasJson([N1, N2], [{ ...E1, toSide: "top", label: "depends on" }]),
    );
    await room.cs.handleLocalModify(PATH);

    const observed = collabText((edges.get("e1") as Y.Map<unknown>).get("label"));
    expect(() => expect(observed).toEqual({ shape: "ytext", text: "depends on" })).toThrow();
    expect(observed).toEqual({ shape: "string", text: "depends on" });

    room.teardown();
  });

  it("a node two peers hold is still deleted by the local save, as a tombstone", async () => {
    const room = await makeRoom(canvasJson([N1, N2], [E1]), ["n2"], ["n1", "n2", "e1"]);
    const nodes = room.doc.getMap<Y.Map<unknown>>("nodes");
    const deleted = room.doc.getMap<unknown>("deleted");

    expect(
      room.LOCAL.canDeleteNode("n2"),
      "the fixture is vacuous: no peer holds the node being deleted",
    ).toBe(false);
    expectNoWriteGateSeam(room.cs);

    const containerBefore = nodes.get("n2");
    const removed = canvasJson([N1], []);
    room.vault.files.set(PATH, removed);
    await room.cs.handleLocalModify(PATH);

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "n2")),
      "the local delete was dropped because a peer holds the node",
    ).toBe(true);
    expect(
      nodes.get("n2"),
      "the delete destroyed the record container — WP19's tombstone contract broke",
    ).toBe(containerBefore);
    expect(room.baseline(), "the diff baseline was held on a delete pass").toBe(removed);
    expect(denials(room.warns), "the removed `LOCK DENIED:` emitter still fires").toEqual([]);

    room.teardown();
  });
});
