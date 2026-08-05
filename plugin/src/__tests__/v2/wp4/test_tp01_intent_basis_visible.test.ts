// WP4 / AC1 — the C2 intent plan decides what reaches the CRDT, never the
// three-way diff against `lastWrittenContent`.
//
// AC1: "The three-way diff against `lastWrittenContent` no longer decides what is
// written to the CRDT; the intent plan from C2 does. `lastWrittenContent` may
// remain only as an echo/telemetry aid and must not be read as the intent basis
// at `:520-521`."
//
// The oracle is NOT a source scan. Every case below is a state in which the two
// possible bases give OPPOSITE verdicts, so the test can only pass if the shadow
// is the basis:
//
//   ├── T1 the baseline says "the user changed x", the shadow says "this is the
//   │      stale open view" → zero CRDT writes (the legacy basis would push the
//   │      stale value; that push IS the Symptom-2 cascade).
//   ├── T2 the same save also carries a GENUINE change → it must still land, so
//   │      the mechanism is not a blanket mute.
//   ├── T3 a record present in the baseline and missing from the save is NOT
//   │      deleted while the view is closed (I7: observation never deletes).
//   ├── T4 the same record IS deleted once the view is open and it was handed
//   │      to the view — the delete rule is gated, not removed.
//   └── T5 a captured local edit advances the shadow, so the capture path feeds
//          the same structure it reads.
//
// The divergence between the two bases is manufactured through the documented
// seam only: with the view OPEN a persistence write advances `lastWrittenContent`
// but must NOT advance the shadow (the confirmed-apply receipt is WP5's job).

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField, getRecordState } from "../../../canvas/canvas-shadow";
// WP19 AC1: deletion is a VALUE. Key presence proves neither survival nor
// deletion any more, so both halves of the T3/T4 pair read suppression and the
// projection instead — otherwise the pair discriminates nothing.
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";
import { collabText } from "../../harness/collab-text";

const PATH = "board.canvas";

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

/** A genuine REMOTE transaction on `doc` (tr.local === false). */
function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function nodeField(doc: Y.Doc, id: string, field: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(field);
}

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  cs.setLogger({ debug: (_c: string, m: string) => debugs.push(m), warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, debugs, surface };
}

/** Flush the settle window opened by `noteExternalDiskWrite` — no constant. */
async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "note" };
const N2 = { id: "n2", type: "text", x: 400, y: 0, width: 200, height: 100, text: "peer" };

describe("WP4 AC1 — the intent plan, not lastWrittenContent, is the write basis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a save the three-way diff calls a change is discarded as staleness", async () => {
    const initial = canvasJson([N1]);
    const p = await makePeer(initial);

    // The surface provably holds the initial content (closed view + persistence).
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "n1", "x")).toBe(0);

    // The user opens the canvas; from here only a CONFIRMED apply (WP5) may
    // advance the shadow.
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("n1");

    // A peer moves the card and the single writer persists it. The open view
    // never received it — Obsidian ignores external writes to an open canvas.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    // WP64 — 3-arg: these are the bytes THE SINGLE WRITER would have persisted,
    // and production serialises with the tombstone map. This file's later tests
    // do write tombstones, so the 2-arg form would make the persisted basis
    // disagree with the real one exactly when a delete is in play.
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
      p.doc.getMap<unknown>("deleted"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await settle();

    // The two candidate bases now DISAGREE about n1.x.
    expect(
      getField(p.cs.getSurfaceShadow(), PATH, "node", "n1", "x"),
      "an open-view persistence write must not advance the shadow (WP5 owns that receipt)",
    ).toBe(0);

    // The stale view saves its own, older picture.
    p.vault.files.set(PATH, initial);
    const before = fingerprint(p.doc);
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "n1", "x"), "the stale save overwrote the peer's move").toBe(500);
    expect(fingerprint(p.doc), "a stale save must produce zero CRDT writes").toBe(before);
  });

  it("T2 a genuine change in the same stale save still reaches the CRDT", async () => {
    const initial = canvasJson([N1]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("n1");

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    // WP64 — 3-arg: these are the bytes THE SINGLE WRITER would have persisted,
    // and production serialises with the tombstone map. This file's later tests
    // do write tombstones, so the 2-arg form would make the persisted basis
    // disagree with the real one exactly when a delete is in play.
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
      p.doc.getMap<unknown>("deleted"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await settle();

    // Same stale x, but the user really did retype the card's text.
    p.vault.files.set(PATH, canvasJson([{ ...N1, text: "edited" }]));
    await p.cs.handleLocalModify(PATH);

    // WP36 follow-up (B32) — RE-ORACLED. The value half is the old assertion
    // verbatim; the shape half asserts the capture wrote through the
    // collaborative-text path instead of flattening it back to a register.
    // Paired PRE-WP36 CONTROL below.
    expect(collabText(nodeField(p.doc, "n1", "text")), "real intent was swallowed").toEqual({
      shape: "ytext",
      text: "edited",
    });
    expect(nodeField(p.doc, "n1", "x"), "staleness leaked into the CRDT").toBe(500);
  });

  it("T2 PRE-WP36 CONTROL: the re-oracled assertion is RED on the whole-string LWW register", async () => {
    const initial = canvasJson([N1]);
    const p = await makePeer(initial);
    p.cs.setCollabTextEnabled(false); // the behaviour WP36 replaced
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("n1");

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("x", 500);
    });
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
      p.doc.getMap<unknown>("deleted"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await settle();

    p.vault.files.set(PATH, canvasJson([{ ...N1, text: "edited" }]));
    await p.cs.handleLocalModify(PATH);

    const observed = collabText(nodeField(p.doc, "n1", "text"));
    expect(() => expect(observed).toEqual({ shape: "ytext", text: "edited" })).toThrow();
    expect(observed).toEqual({ shape: "string", text: "edited" });
  });

  it("T3 with the view closed, a record missing from the save is not deleted", async () => {
    const initial = canvasJson([N1, N2]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();

    // `lastWrittenContent` holds n2; the save does not. The legacy base→next
    // diff calls that a local delete. With no hand-over receipt it is ignorance.
    p.vault.files.set(PATH, canvasJson([N1]));
    await p.cs.handleLocalModify(PATH);

    expect(
      p.doc.getMap<Y.Map<unknown>>("nodes").has("n2"),
      "a partial observation deleted a record (I7 violated)",
    ).toBe(true);
    // WP19 AC1 — the line above can no longer FAIL on its own: no delete path
    // removes a key any more. Survival is pinned where it is now decided.
    const t3Deleted = p.doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(t3Deleted, "n2")),
      "a partial observation TOMBSTONED a record (I7 violated)",
    ).toBe(false);
    expect(
      buildCanvasData(
        p.doc.getMap<Y.Map<unknown>>("nodes"),
        p.doc.getMap<Y.Map<unknown>>("edges"),
        t3Deleted,
      ).nodes.map((n) => n.id),
      "the record vanished from what the user actually sees",
    ).toContain("n2");
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "node", "n2")).toBe("present");
  });

  it("T4 with the view open and a hand-over receipt, the delete still happens", async () => {
    const initial = canvasJson([N1, N2]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("n1");
    p.surface.handedToView.node.add("n2");

    p.vault.files.set(PATH, canvasJson([N1]));
    await p.cs.handleLocalModify(PATH);

    // WP19 AC1 — the proven delete still happens, spelled as a tombstone.
    const t4Deleted = p.doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(t4Deleted, "n2")),
      "a proven user delete was swallowed — the rule is gated, not removed",
    ).toBe(true);
    expect(
      buildCanvasData(
        p.doc.getMap<Y.Map<unknown>>("nodes"),
        p.doc.getMap<Y.Map<unknown>>("edges"),
        t4Deleted,
      ).nodes.map((n) => n.id),
    ).toEqual(["n1"]);
    // ...and destroys nothing: the container and its field values survive.
    const t4N2 = p.doc.getMap<Y.Map<unknown>>("nodes").get("n2") as Y.Map<unknown>;
    expect(t4N2.get("text")).toBe("peer");
    expect(t4N2.get("x")).toBe(400);
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "node", "n2")).toBe("absent");
  });

  it("T5 a captured local edit advances the shadow it was diffed against", async () => {
    const initial = canvasJson([N1]);
    const p = await makePeer(initial);
    p.cs.noteExternalDiskWrite(PATH, initial);
    await settle();

    p.vault.files.set(PATH, canvasJson([{ ...N1, x: 120, text: "moved" }]));
    await p.cs.handleLocalModify(PATH);

    const shadow = p.cs.getSurfaceShadow();
    expect(getField(shadow, PATH, "node", "n1", "x")).toBe(120);
    expect(getField(shadow, PATH, "node", "n1", "text")).toBe("moved");

    // Re-observing the same surface a second time is therefore intent-free —
    // even when Obsidian re-serialises the identical values in another key order
    // (different bytes, so the byte echo breaker cannot be what silences it).
    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([
        { text: "moved", height: 100, width: 200, y: 0, x: 120, type: "text", id: "n1" },
      ]),
    );
    await p.cs.handleLocalModify(PATH);
    expect(fingerprint(p.doc)).toBe(before);
  });
});
