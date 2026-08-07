// REPRESENTATION-BLINDNESS SWEEP — member 2 (PRODUCT, LIVE).
//
// THE BLIND CHECK
//   `CanvasSync.handleLocalModify` (`files/canvas-sync.ts`) computes WP4 AC4's
//   DIVERGENT DISCARDS:
//
//     record !== undefined && record.get(discard.field) !== discard.value
//
//   `discard.value` is the SHADOW's value, and the shadow stores the RENDERED
//   projection (C36 AC4: `buildApplyReceipt` -> `advanceFromReceipt`). Once
//   `text` / `label` became a nested `Y.Text`, the raw doc value is never
//   `===` its own rendered string — so the test "has the CRDT genuinely moved
//   past what the save restated?" answered YES for EVERY discarded text field,
//   on every save, whether or not anything had moved.
//
// WHY NOTHING WENT RED
//   The verdict drives one debug line, `SHADOW STALE:`. It got noisier, not
//   wrong-looking, and no assertion anywhere reads it. But `discarded` holds
//   every unchanged field of every record in the save, so a board with one
//   migrated card names that card on every single save — and the one line the
//   signature exists to surface (a real stale push) is now indistinguishable
//   from the restatement noise it was built to be quieter than. That is the
//   run's own lesson about a logger that stops, in its mirror image: a
//   diagnostic that fires unconditionally reports nothing.
//
// THE PAIR
//   Test 1 shows the signature going quiet for a pure restatement.
//   Test 2 is the CONTROL: a genuine divergence on the SAME migrated field
//   must still raise it. A repair that only silenced the line would pass the
//   first and fail the second.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, advanceField, createSurfaceShadow } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "deck.canvas";

function node(text: string, x = 0): Record<string, unknown> {
  return { id: "c1", type: "text", x, y: 0, width: 260, height: 120, text };
}

const canvasJson = (nodes: Record<string, unknown>[]) => JSON.stringify({ nodes, edges: [] });

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

async function makeRoom(diskText: string) {
  const vault = createVault({ [PATH]: canvasJson([node(diskText)]) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugLines: string[] = [];
  cs.setLogger({
    debug: (_scope: string, message: string) => {
      debugLines.push(message);
    },
    warn: () => {},
  } as never);
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set(["c1"]), edge: new Set<string>() },
    }),
  );
  const shadow = createSurfaceShadow();
  for (const [field, value] of Object.entries(node(diskText))) {
    advanceField(shadow, PATH, "node", "c1", field, value as never);
  }
  cs.setSurfaceShadow(shadow);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, debugLines, nodes: doc.getMap<Y.Map<unknown>>("nodes") };
}

type Room = Awaited<ReturnType<typeof makeRoom>>;

async function save(room: Room, text: string, x = 0) {
  room.vault.files.set(PATH, canvasJson([node(text, x)]));
  await room.cs.handleLocalModify(PATH);
}

const staleLines = (room: Room) => room.debugLines.filter((l) => l.startsWith("SHADOW STALE:"));

describe("reprsweep 2 — the SHADOW STALE signature still distinguishes a stale push", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a pure RESTATEMENT of a migrated text raises no stale signature", async () => {
    const room = await makeRoom("AliceBob");

    // One capture, so the field migrates to a nested `Y.Text` and the shadow
    // advances to the value the doc now holds.
    await save(room, "AliceBob!");
    expect(
      room.nodes.get("c1")?.get("text"),
      "precondition: the field never migrated, so this scenario is vacuous",
    ).toBeInstanceOf(Y.Text);

    room.debugLines.length = 0;

    // A geometry-only save. `text` is restated at exactly the shadow's value,
    // so it is DISCARDED — and the doc holds precisely that value, rendered.
    // Nothing is stale about it.
    await save(room, "AliceBob!", 40);

    expect(
      staleLines(room),
      "the shadow-stale signature fired for a field that was merely restated",
    ).toEqual([]);
  });

  it("CONTROL — a GENUINE divergence on the same migrated field still fires", async () => {
    const room = await makeRoom("AliceBob");
    await save(room, "AliceBob!");
    const ytext = room.nodes.get("c1")?.get("text") as Y.Text;
    expect(ytext).toBeInstanceOf(Y.Text);

    // A peer's character reaches the DOC and not this client's file or shadow.
    ytext.insert(5, "Y");
    expect(ytext.toString()).toBe("AliceYBob!");

    room.debugLines.length = 0;

    // The save restates the SHADOW's value — so `text` is discarded — while the
    // CRDT has genuinely moved past it. This is precisely the stale push the
    // signature exists to name, on the field where it is most destructive.
    await save(room, "AliceBob!", 40);

    const lines = staleLines(room);
    expect(
      lines,
      "a real divergence on a migrated field produced no stale signature — the check is now blind the other way",
    ).toHaveLength(1);
    expect(lines[0]).toContain("node/c1.text");
  });

  it("CONTROL — a plain-string field is unaffected in both directions", async () => {
    const room = await makeRoom("AliceBob");
    room.debugLines.length = 0;

    // `text` is never captured here, so it stays a plain string. A geometry
    // restatement must stay silent, exactly as it did before WP36.
    await save(room, "AliceBob", 40);
    expect(typeof room.nodes.get("c1")?.get("text")).toBe("string");
    expect(staleLines(room)).toEqual([]);

    // ...and a real divergence on that plain string still raises it.
    room.nodes.get("c1")?.set("text", "moved on by a peer");
    room.debugLines.length = 0;
    await save(room, "AliceBob", 80);
    expect(staleLines(room)).toHaveLength(1);
  });
});
