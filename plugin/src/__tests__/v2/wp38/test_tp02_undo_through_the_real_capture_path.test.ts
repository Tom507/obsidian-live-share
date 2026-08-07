// WP38 / C38 AC2 + AC3 + AC5 — undo driven through the REAL capture path:
// `handleLocalModify` -> `planCapture` -> `applyIntentPlan`, the path
// `useCanvasBinding: false` makes the live one.
//
// The harness is WP36's (`v2/wp36/test_tp03`): a subscribed host whose Surface-
// Shadow already holds the values it last confirmed, and edits driven by
// rewriting the `.canvas` on disk. Peer traffic arrives the way it really does
// — as a `Y.applyUpdate` from a second doc under the SyncManager's origin — so
// "a peer's op is not tracked" is exercised rather than simulated by a sentinel.
//
// The live halves of AC2 and AC5 are two Obsidian instances and are in the
// implementation report; these are the headless counterparts, and where the
// charter says a criterion is only satisfiable live, that is said rather than
// faked.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SurfaceState,
  advanceField,
  createSurfaceShadow,
} from "../../../canvas/canvas-shadow";
import { CanvasUndoRegistry } from "../../../canvas/canvas-undo";
import { CanvasSync, DELETED_MAP_NAME, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "deck.canvas";

function node(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type: "text", x: 0, y: 0, width: 260, height: 120, text: `${id} text`, ...fields };
}

function canvasJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
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
  const manager = {
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
  return manager;
}

/**
 * A subscribed host whose shadow already holds `seed` — i.e. a client that has
 * confirmed those values are on its surface. That is the three-way base and it
 * is what makes these scenarios deterministic.
 *
 * The registry's clock is INJECTED so that every capture below is a separate
 * undo step unless a scenario deliberately says otherwise. Without it, two
 * saves inside the same 500 ms would legitimately collapse and an assertion
 * about "the last action" would be timing-dependent.
 */
async function makeRoom(seedNodes: Record<string, unknown>[]) {
  const vault = createVault({ [PATH]: canvasJson(seedNodes) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const ids = seedNodes.map((n) => n.id as string);
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set(ids), edge: new Set<string>() },
    }),
  );
  const shadow = createSurfaceShadow();
  for (const record of seedNodes) {
    for (const [field, value] of Object.entries(record)) {
      advanceField(shadow, PATH, "node", record.id as string, field, value as never);
    }
  }
  cs.setSurfaceShadow(shadow);

  let clock = 10_000;
  const registry = new CanvasUndoRegistry({ now: () => clock, captureTimeoutMs: 500 });
  cs.setUndoRegistry(registry);
  await cs.subscribe(PATH, "host");

  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return {
    vault,
    cs,
    doc,
    syncManager,
    registry,
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    deleted: doc.getMap<unknown>(DELETED_MAP_NAME),
    /** Advance the injected clock past the capture window. */
    tick(): void {
      clock += 5_000;
    },
    async save(records: Record<string, unknown>[]): Promise<void> {
      vault.files.set(PATH, canvasJson(records));
      await cs.handleLocalModify(PATH);
    },
    projection(): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
      return buildCanvasData(
        doc.getMap<Y.Map<unknown>>("nodes"),
        doc.getMap<Y.Map<unknown>>("edges"),
        doc.getMap<unknown>(DELETED_MAP_NAME),
      );
    },
  };
}

function projected(room: Awaited<ReturnType<typeof makeRoom>>, id: string) {
  return room.projection().nodes.find((n) => n.id === id);
}

describe("WP38 AC1 — the real capture transaction is TAGGED, and it is the only one that is", () => {
  it("a local save produces an undo step; the subscribe seed that preceded it did not", async () => {
    const room = await makeRoom([node("c1")]);
    // The host seed ran inside `subscribe`, under no tracked origin.
    expect(room.registry.report(PATH).undoDepth).toBe(0);
    expect(room.nodes.get("c1")?.get("text")).toBe("c1 text");

    room.tick();
    await room.save([node("c1", { x: 500 })]);
    expect(room.registry.report(PATH).undoDepth).toBe(1);
    expect(room.nodes.get("c1")?.get("x")).toBe(500);
  });

  it("the registry holds exactly one manager for the subscribed canvas, and none after unsubscribe", async () => {
    const room = await makeRoom([node("c1")]);
    expect(room.registry.size()).toBe(1);
    expect(room.registry.report(PATH).available).toBe(true);
    room.cs.unsubscribe(PATH);
    expect(room.registry.size()).toBe(0);
    expect(room.registry.report(PATH).available).toBe(false);
  });
});

describe("WP38 AC2 — undo reverts only this client's own action, never a peer's", () => {
  it("a peer's edit to the SAME record, a different field, survives this client's undo", async () => {
    const room = await makeRoom([node("c1", { text: "card one" })]);

    // This client's own action, captured through the real path.
    room.tick();
    await room.save([node("c1", { text: "card one", x: 400 })]);
    expect(room.nodes.get("c1")?.get("x")).toBe(400);
    expect(room.registry.report(PATH).undoDepth).toBe(1);

    // THE PEER, arriving the way a peer really arrives: an update from another
    // doc applied under the SyncManager's origin (`sync/sync.ts:530`).
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(room.doc));
    peer.transact(() => {
      peer.getMap<Y.Map<unknown>>("nodes").get("c1")?.set("color", "4");
    });
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(peer), room.syncManager);

    // The peer's op did NOT become an undo step on this client.
    expect(room.registry.report(PATH).undoDepth).toBe(1);
    expect(room.nodes.get("c1")?.get("color")).toBe("4");

    const outcome = room.registry.undo(PATH);
    expect(outcome.popped).toBe(true);

    // THE CRITERION, same record, different field: my `x` is back, the peer's
    // `color` is untouched. A coarse whole-record undo reverts both.
    expect(room.nodes.get("c1")?.get("x")).toBe(0);
    expect(room.nodes.get("c1")?.get("color")).toBe("4");
    expect(projected(room, "c1")?.color).toBe("4");
  });

  it("a peer's edit to a DIFFERENT record survives too, and the peer's op is never on my stack", async () => {
    const room = await makeRoom([node("c1"), node("c2")]);
    room.tick();
    await room.save([node("c1", { x: 300 }), node("c2")]);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(room.doc));
    peer.transact(() => peer.getMap<Y.Map<unknown>>("nodes").get("c2")?.set("y", 777));
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(peer), room.syncManager);
    expect(room.registry.report(PATH).undoDepth).toBe(1);

    room.registry.undo(PATH);
    expect(room.nodes.get("c1")?.get("x")).toBe(0);
    expect(room.nodes.get("c2")?.get("y")).toBe(777);

    // And with my own stack now empty, a further undo cannot reach the peer's op.
    const second = room.registry.undo(PATH);
    expect(second.popped).toBe(false);
    expect(room.nodes.get("c2")?.get("y")).toBe(777);
  });
});

describe("WP38 AC3 — undo of a delete restores THROUGH THE TOMBSTONE FLAG, losslessly", () => {
  it("restores every field individually, keeps the record's Y.Map identity, and issues no re-creation", async () => {
    const room = await makeRoom([
      node("c1", { text: "keep me", color: "6", width: 321, height: 111 }),
      node("c2"),
    ]);

    // A tripwire on the record collection itself: AC3's prohibition is that no
    // `nodes.set(id, ...)` is issued for this id, and a `set` on an existing key
    // is exactly what would be observed here.
    const nodeKeyEvents: string[] = [];
    room.nodes.observe((event) => {
      for (const [key, change] of event.changes.keys) {
        nodeKeyEvents.push(`${change.action}:${key}`);
      }
    });
    const identityBefore = room.nodes.get("c1");
    expect(identityBefore).toBeDefined();

    room.tick();
    await room.save([node("c2")]); // c1 vanishes from the save => a delete

    // The delete is a VALUE: the record's own map is untouched, and the
    // projection is what suppresses it.
    expect(room.nodes.get("c1")).toBe(identityBefore);
    expect(projected(room, "c1")).toBeUndefined();
    expect(room.deleted.get("c1")).toBeDefined();
    expect(room.registry.report(PATH).undoDepth).toBe(1);

    const outcome = room.registry.undo(PATH);
    expect(outcome.popped).toBe(true);

    // THE CRITERION — the card is back, and every field is compared
    // INDIVIDUALLY. A whole-record `toEqual` against a one-field record proves
    // nothing, so the fixture carries four distinct values and each has a row.
    const restored = projected(room, "c1");
    expect(restored).toBeDefined();
    expect(restored?.text).toBe("keep me");
    expect(restored?.color).toBe("6");
    expect(restored?.width).toBe(321);
    expect(restored?.height).toBe(111);
    expect(restored?.type).toBe("text");
    expect(restored?.x).toBe(0);
    expect(restored?.y).toBe(0);

    // THROUGH THE TOMBSTONE FLAG: the record's `Y.Map` is the SAME OBJECT it was
    // before the delete, so nothing was re-created and nothing was lost with the
    // container.
    expect(room.nodes.get("c1")).toBe(identityBefore);

    // And no `set` was ever issued against the record collection for `c1` after
    // its creation — a re-creating undo would show one.
    expect(nodeKeyEvents).toEqual([]);
  });

  it("the restore is a projection change, not a re-write of the record", async () => {
    const room = await makeRoom([node("c1", { text: "alpha" }), node("c2")]);
    room.tick();
    await room.save([node("c2")]);
    expect(projected(room, "c1")).toBeUndefined();

    // What the undo touches is the tombstone container, and the record's own
    // fields are byte-identical either side of the whole delete/undo cycle.
    const fieldsBefore = JSON.stringify([...(room.nodes.get("c1") as Y.Map<unknown>).entries()]);
    room.registry.undo(PATH);
    const fieldsAfter = JSON.stringify([...(room.nodes.get("c1") as Y.Map<unknown>).entries()]);
    expect(fieldsAfter).toBe(fieldsBefore);
    expect(projected(room, "c1")?.text).toBe("alpha");
  });
});

describe("WP38 AC5 — no undo step ever reverts a `text` -> `Y.Text` conversion", () => {
  it("the migrating capture produces NO step, and the SAME fixture produces one for the next edit", async () => {
    const room = await makeRoom([node("c1", { text: "Alice" })]);
    expect(typeof room.nodes.get("c1")?.get("text")).toBe("string");

    // The FIRST text write converts (WP36's lazy, write-triggered migration).
    room.tick();
    await room.save([node("c1", { text: "AliceX" })]);
    expect(room.nodes.get("c1")?.get("text")).toBeInstanceOf(Y.Text);
    // THE CRITERION: nothing on the stack, so nothing can revert the conversion.
    expect(room.registry.report(PATH).undoDepth).toBe(0);

    // THE DISCRIMINATOR the charter demands. "The stack is empty" is trivially
    // satisfiable by a manager that was never constructed, by the wrong doc, or
    // by a scope that tracks nothing — so the SAME fixture must produce a normal
    // step for a normal edit. It does, on the very next save.
    room.tick();
    await room.save([node("c1", { text: "AliceXY" })]);
    expect(room.registry.report(PATH).undoDepth).toBe(1);
    expect(room.nodes.get("c1")?.get("text")).toBeInstanceOf(Y.Text);

    // And undoing that step leaves the field a NON-EMPTY `Y.Text` — never
    // absent, never a plain string again, never empty when it was not.
    room.registry.undo(PATH);
    const after = room.nodes.get("c1")?.get("text");
    expect(after).toBeInstanceOf(Y.Text);
    expect((after as Y.Text).toString()).toBe("AliceX");
    expect((after as Y.Text).length).toBeGreaterThan(0);
    expect(room.nodes.get("c1")?.has("text")).toBe(true);
  });

  it("a geometry move in the SAME pass as a conversion is not undoable either — the cost, stated", async () => {
    const room = await makeRoom([node("c1", { text: "Alice" })]);
    room.tick();
    await room.save([node("c1", { text: "AliceX", x: 900 })]);
    expect(room.nodes.get("c1")?.get("x")).toBe(900);
    // Recorded as an assertion rather than as prose: the whole converting pass
    // is untracked, which is the price of never reverting a conversion. It is
    // one save per field per record, and every later save is tracked.
    expect(room.registry.report(PATH).undoDepth).toBe(0);
  });

  it("a peer's characters merged into the converted Y.Text SURVIVE a local undo", async () => {
    const room = await makeRoom([node("c1", { text: "Alice" })]);
    room.tick();
    await room.save([node("c1", { text: "AliceX" })]); // converts, untracked
    const ytext = room.nodes.get("c1")?.get("text") as Y.Text;
    expect(ytext.toString()).toBe("AliceX");

    // THE PEER contributes a character INTO the nested `Y.Text`, which is
    // exactly what an inbound update produces once the field has migrated.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(room.doc));
    peer.transact(() => {
      (peer.getMap<Y.Map<unknown>>("nodes").get("c1")?.get("text") as Y.Text).insert(6, "P");
    });
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(peer), room.syncManager);
    expect(ytext.toString()).toBe("AliceXP");

    // A local text edit, from a file that does NOT contain the peer's character
    // — the vacuity guard: if the file already held `P` the survival would be a
    // restatement rather than a survival.
    expect(canvasJson([node("c1", { text: "AliceXZ" })])).not.toContain("P");
    room.tick();
    await room.save([node("c1", { text: "AliceXZ" })]);
    expect(room.registry.report(PATH).undoDepth).toBe(1);
    expect(ytext.toString()).toContain("Z");
    expect(ytext.toString()).toContain("P");

    room.registry.undo(PATH);

    // THE CRITERION: my character is gone, the peer's is still there. A tracked
    // conversion would have restored the pre-conversion plain string `"Alice"`
    // and destroyed `P` along with it.
    const final = room.nodes.get("c1")?.get("text");
    expect(final).toBeInstanceOf(Y.Text);
    expect((final as Y.Text).toString()).not.toContain("Z");
    expect((final as Y.Text).toString()).toContain("P");
    expect((final as Y.Text).toString()).toBe("AliceXP");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
