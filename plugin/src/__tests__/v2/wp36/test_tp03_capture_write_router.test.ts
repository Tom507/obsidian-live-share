// WP36 / C36 AC1 + AC2 + AC5 — the CAPTURE WRITE, through the real
// `handleLocalModify` -> `planCapture` -> `applyIntentPlan` path.
//
// The two defects this file discriminates against are both silent:
//
//   1. FLATTENING. `docValueEquals` has no `Y.Text` arm and a string is never
//      `===` a `Y.Text`, so the unrouted write replaces the `Y.Text` with a
//      plain string on the FIRST capture after conversion. The visible symptom
//      is "it merged once and then stopped merging", which reads like flaky
//      sync. A string read-back cannot see it — hence the doc-level assertions
//      and the receipt.
//   2. THE TWO-WAY DIFF. A capture that diffs the `Y.Text`'s own content against
//      the local file computes a peer's freshly merged characters as a deletion.
//      Both replicas then converge on the truncated string, so no cross-replica
//      oracle can see it. The assertion is therefore over ONE client's capture.
//
// The peer's contribution is injected as a real op on the nested `Y.Text`,
// which is exactly what an inbound Yjs update produces.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SurfaceState,
  advanceField,
  createSurfaceShadow,
} from "../../../canvas/canvas-shadow";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "deck.canvas";

function node(text: string): Record<string, unknown> {
  return { id: "c1", type: "text", x: 0, y: 0, width: 260, height: 120, text };
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

/**
 * A subscribed host whose shadow already holds `baseText` for `c1.text` — i.e. a
 * client that has confirmed that string is on its surface. That is the
 * three-way BASE, and injecting it is what makes these scenarios deterministic.
 */
async function makeRoom(diskText: string, baseText: string | null) {
  const vault = createVault({ [PATH]: canvasJson([node(diskText)]) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set(["c1"]), edge: new Set<string>() },
    }),
  );
  const shadow = createSurfaceShadow();
  if (baseText !== null) {
    for (const [field, value] of Object.entries(node(baseText))) {
      advanceField(shadow, PATH, "node", "c1", field, value as never);
    }
  }
  cs.setSurfaceShadow(shadow);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, nodes: doc.getMap<Y.Map<unknown>>("nodes") };
}

function textValue(nodes: Y.Map<Y.Map<unknown>>): unknown {
  return nodes.get("c1")?.get("text");
}

/** Save a new `.canvas` on disk and let the capture path see it. */
async function save(room: Awaited<ReturnType<typeof makeRoom>>, text: string) {
  room.vault.files.set(PATH, canvasJson([node(text)]));
  await room.cs.handleLocalModify(PATH);
}

describe("WP36 AC1 — the field becomes a Y.Text and is never replaced by a plain value", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts on the first capture and STAYS a Y.Text on the second", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");
    // The seed wrote the flat file shape: a plain string, pre-migration.
    expect(typeof textValue(room.nodes)).toBe("string");

    await save(room, "AliceBob!");
    expect(textValue(room.nodes)).toBeInstanceOf(Y.Text);
    expect((textValue(room.nodes) as Y.Text).toString()).toBe("AliceBob!");

    // THE SECOND CAPTURE — the one AC1 says is the one that matters. An
    // unrouted `existing.set(field, string)` here would un-migrate the record.
    await save(room, "AliceBob!!");
    expect(
      textValue(room.nodes),
      "the second capture flattened the Y.Text back to a plain string",
    ).toBeInstanceOf(Y.Text);
    expect((textValue(room.nodes) as Y.Text).toString()).toBe("AliceBob!!");

    room.cs.destroy();
  });

  it("emits a doc-level receipt per text write, with ops and target shape", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");

    await save(room, "AliceBobX");
    const first = room.cs.getTextWriteReceipts();
    expect(first).toHaveLength(1);
    expect(first[0].field).toBe("text");
    expect(first[0].targetBefore).toBe("string");
    expect(first[0].migrated).toBe(true);
    expect(first[0].ytextAfter).toBe(true);
    expect(first[0].ops).toBeGreaterThan(0);

    await save(room, "AliceBobXY");
    const second = room.cs.getTextWriteReceipts();
    expect(second).toHaveLength(2);
    // The SECOND receipt is the one that discriminates: the target was already a
    // `Y.Text`, the write was a merge, and it emitted real ops. A capture
    // reporting `targetBefore: "ytext", ops: 0` for a card whose text changed
    // has done nothing; one reporting `ytextAfter: false` has flattened it.
    expect(second[1].targetBefore).toBe("ytext");
    expect(second[1].migrated).toBe(false);
    expect(second[1].ytextAfter).toBe(true);
    expect(second[1].ops).toBeGreaterThan(0);
    // No user text may leave the process through this receipt.
    expect(JSON.stringify(second)).not.toContain("Alice");

    room.cs.destroy();
  });

  it("getTextShape reports the doc shape, which no string read-back can", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");
    const before = room.cs.getTextShape(PATH);
    expect(before?.fields.find((f) => f.field === "text")?.shape).toBe("string");

    await save(room, "AliceBob!");
    const after = room.cs.getTextShape(PATH);
    expect(after?.fields.find((f) => f.field === "text")?.shape).toBe("ytext");

    // ...while the projected string is identical in both states, which is why
    // the shape probe exists at all.
    expect(buildCanvasData(room.nodes, room.doc.getMap("edges")).nodes[0].text).toBe(
      "AliceBob!",
    );

    room.cs.destroy();
  });
});

describe("WP36 AC2/AC3 — the capture does not delete a character it never observed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("THE discriminating scenario: a peer's merged character survives the local save", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");

    // Migrate the field, then bring both the shadow and the file to "AliceBob".
    await save(room, "AliceBob ");
    await save(room, "AliceBob");
    const ytext = textValue(room.nodes) as Y.Text;
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext.toString()).toBe("AliceBob");

    // --- the PRECONDITION, which is what stops this being vacuous ------------
    // A peer inserts "Y" at offset 5. This is a real op on the nested text —
    // the same thing an inbound Yjs update produces. It reaches the DOC and NOT
    // this client's `.canvas` file.
    ytext.insert(5, "Y");
    expect(ytext.toString()).toBe("AliceYBob");
    expect(
      room.vault.files.get(PATH),
      "the precondition failed: the peer's character is already in this client's file",
    ).not.toContain("AliceYBob");

    // --- the local save, which does NOT contain "Y" --------------------------
    await save(room, "AliceXBob");

    const after = (textValue(room.nodes) as Y.Text).toString();
    expect(after, "the capture deleted the peer's character").toContain("Y");
    expect(after, "the local user's character never landed").toContain("X");
    expect(after).toBe("AliceXYBob");

    room.cs.destroy();
  });

  it("a single-character SUBSTITUTION at the same offset keeps both markers", async () => {
    const room = await makeRoom("AliceKBob", "AliceKBob");
    await save(room, "AliceKBob ");
    await save(room, "AliceKBob");
    const ytext = textValue(room.nodes) as Y.Text;
    expect(ytext.toString()).toBe("AliceKBob");

    // The peer replaced K with Y first.
    room.doc.transact(() => {
      ytext.delete(5, 1);
      ytext.insert(5, "Y");
    });
    expect(ytext.toString()).toBe("AliceYBob");

    // This client replaces K with X, from a file that still holds K.
    await save(room, "AliceXBob");

    const after = (textValue(room.nodes) as Y.Text).toString();
    expect(after).toContain("X");
    expect(after, "the peer's replacement character was deleted").toContain("Y");
    expect(after, "the character BOTH users deleted is still there").not.toContain("K");

    room.cs.destroy();
  });

  it("a genuine local deletion IS applied — a merge that never deletes is not a merge", async () => {
    const room = await makeRoom("hello brave world", "hello brave world");
    await save(room, "hello brave world.");
    await save(room, "hello brave world");
    expect((textValue(room.nodes) as Y.Text).toString()).toBe("hello brave world");

    await save(room, "hello world");
    expect((textValue(room.nodes) as Y.Text).toString()).toBe("hello world");

    room.cs.destroy();
  });

  it("the capture emits INSERT/DELETE ops, not a whole-value replace", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");
    await save(room, "AliceBob!");
    const ytext = textValue(room.nodes) as Y.Text;

    // Watch the nested text itself. A whole-value replace shows up as a delete
    // of the entire length; a merge shows up as a one-character insert.
    const deltas: unknown[] = [];
    ytext.observe((event: Y.YTextEvent) => deltas.push(event.delta));
    await save(room, "AliceBob!?");

    expect(deltas).toHaveLength(1);
    expect(JSON.stringify(deltas[0])).toContain('"?"');
    expect(JSON.stringify(deltas[0])).not.toContain('"delete":9');

    room.cs.destroy();
  });
});

describe("WP36 AC5 — the conversion is one op, and the empty card survives", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the record map sees exactly ONE change for the converted key, never a delete", async () => {
    const room = await makeRoom("AliceBob", "AliceBob");
    const record = room.nodes.get("c1") as Y.Map<unknown>;

    const actions: string[] = [];
    const seenAt: (string | null)[] = [];
    record.observe((event: Y.YMapEvent<unknown>) => {
      for (const [key, change] of event.changes.keys) {
        if (key !== "text") continue;
        actions.push(change.action);
        const value = record.get("text");
        seenAt.push(value instanceof Y.Text ? value.toString() : null);
      }
    });

    await save(room, "AliceBobX");

    expect(actions, "the conversion deleted the key or wrote it more than once").toEqual([
      "update",
    ]);
    // Populated at its first observable instant — never empty-then-filled.
    expect(seenAt).toEqual(["AliceBobX"]);

    room.cs.destroy();
  });

  it('"" survives as a PRESENT key equal to "" through a real capture', async () => {
    const room = await makeRoom("something", "something");
    await save(room, "");

    const value = textValue(room.nodes);
    expect(value).toBeInstanceOf(Y.Text);
    expect((value as Y.Text).toString()).toBe("");

    const data = buildCanvasData(room.nodes, room.doc.getMap("edges"));
    expect(data.nodes).toHaveLength(1);
    // Key presence + exact equality, never a falsy assertion.
    expect(Object.prototype.hasOwnProperty.call(data.nodes[0], "text")).toBe(true);
    expect(data.nodes[0].text).toBe("");

    // The non-empty control in the same run.
    await save(room, "back again");
    expect(buildCanvasData(room.nodes, room.doc.getMap("edges")).nodes[0].text).toBe(
      "back again",
    );

    room.cs.destroy();
  });

  it("no bulk pass: a record the local user did NOT edit keeps its plain string", async () => {
    const vault = createVault({
      [PATH]: JSON.stringify({
        nodes: [node("edited"), { ...node("untouched"), id: "c2", y: 400 }],
        edges: [],
      }),
    });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["c1", "c2"]), edge: new Set<string>() },
      }),
    );
    const shadow = createSurfaceShadow();
    for (const [field, value] of Object.entries(node("edited"))) {
      advanceField(shadow, PATH, "node", "c1", field, value as never);
    }
    for (const [field, value] of Object.entries({ ...node("untouched"), id: "c2", y: 400 })) {
      advanceField(shadow, PATH, "node", "c2", field, value as never);
    }
    cs.setSurfaceShadow(shadow);
    await cs.subscribe(PATH, "host");
    const nodes = syncManager
      .getDoc(`__canvas__:${PATH}`)
      .doc.getMap<Y.Map<unknown>>("nodes");

    vault.files.set(
      PATH,
      JSON.stringify({
        nodes: [node("edited more"), { ...node("untouched"), id: "c2", y: 400 }],
        edges: [],
      }),
    );
    await cs.handleLocalModify(PATH);

    expect(nodes.get("c1")?.get("text")).toBeInstanceOf(Y.Text);
    expect(
      typeof nodes.get("c2")?.get("text"),
      "a record nobody edited was converted — that is a bulk pass",
    ).toBe("string");

    cs.destroy();
  });
});
