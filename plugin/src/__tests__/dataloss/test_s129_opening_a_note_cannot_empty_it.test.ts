// S129 — OPENING A NOTE COULD EMPTY IT.
//
// S119 needed a restart to fire. This needed only OPENING A NOTE before the
// shared document arrived — the most common action in the product.
//
// The sequence: a guest activates a file; `waitForSync` resolves INSTANTLY
// because the relay reported `peerCount === 0` (S128 — for a doc nobody has
// subscribed to, that is the common case); a one-second wall-clock loop waits
// for the text to become non-empty; when it expires the code CONTINUES and
// hands the empty `Y.Text` to `yCollab`, which reconciles the editor buffer to
// match it. The note goes blank on screen, and Obsidian persists the buffer.
//
// AND IT IS THE ONE PATH BOTH EMPTY-WRITE FLOORS MISS BY DESIGN.
// `BackgroundSync`'s observer returns for `path === this.activeFile` — "the
// active file is persisted by the editor / yCollab, never by background-sync" —
// so the active file never reaches `doWriteToDisk`, where S119's and S126's
// floor lives.
//
// AC1: the loop is NOT the defect. What it does ON EXPIRY is. That fall-through
// is now a decision.
//
// AC2: the evidence is S128's `SyncResolution` and S126's tombstones — NOT a
// longer timeout. A longer timeout closes this on the runs that happen to be
// fast enough, which is exactly what S123 looked like before its probe became
// an event.
//
// DEMONSTRATED vs ARGUED, stated up front because the line matters here:
//   ├── the DECISION is executed exhaustively (the pure function, every branch)
//   ├── the REAL `activateForFile` is driven end-to-end over a real `Y.Doc`,
//   │     a real `SyncManager`, and a CodeMirror `EditorView` double, and the
//   │     buffer is asserted before and after — so the refusal is demonstrated
//   └── what is NOT executed here is `yCollab`'s own reconciliation of a
//         CodeMirror document against an empty `Y.Text`. That is upstream
//         library behaviour; the vacuity control below asserts the BINDING is
//         reached in the allowed case and skipped in the refused one, which is
//         the seam this package controls. Stated plainly rather than implied.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  COLLAB_BIND,
  decideCollabBind,
  getCollabBindRefusals,
  hostMaySeedFromEditor,
  resetCollabBindRefusals,
} from "../../editor/collab-bind-decision";
import { SYNC_RESOLUTION } from "../../sync/sync";

/** AC4 — stated, because timing is involved. */
const ITERATIONS = 50;

const NOTE = "notes/hello.md";
const BUFFER = "the user's note, still on screen\n";

describe("S129 AC1/AC2 — the fall-through is now a decision", () => {
  const base = { docTextLength: 0, editorBufferLength: BUFFER.length };

  it("🚨 THE DEFECT: an unproven-empty document is REFUSED, not bound", () => {
    // `NO_PEERS` — nobody held this doc, so its emptiness establishes nothing.
    const v = decideCollabBind({
      ...base,
      resolution: SYNC_RESOLUTION.NO_PEERS,
      docHeldContent: false,
    });
    expect(v.decision).toBe(COLLAB_BIND.REFUSE_UNPROVEN_EMPTY);
    // The reason names what was at stake, so the log line is diagnostic.
    expect(v.reason).toContain(String(BUFFER.length));
  });

  it("an unknown resolution refuses too — ALREADY_SYNCED establishes nothing", () => {
    for (const resolution of [SYNC_RESOLUTION.ALREADY_SYNCED, null]) {
      const v = decideCollabBind({ ...base, resolution, docHeldContent: false });
      expect(v.decision).toBe(COLLAB_BIND.REFUSE_UNPROVEN_EMPTY);
    }
  });

  it("AC2 — a peer that ANSWERED licenses the bind, even with an empty document", () => {
    // The legitimate empty note. Without this the fix would stop collaboration
    // on every genuinely empty shared file.
    const v = decideCollabBind({
      ...base,
      resolution: SYNC_RESOLUTION.PEER_STATE,
      docHeldContent: false,
    });
    expect(v.decision).toBe(COLLAB_BIND.BIND);
  });

  it("AC2 — tombstones license the bind: somebody emptied this note on purpose", () => {
    // S126's evidence, reused rather than re-derived. A real
    // select-all-and-delete must reach the editor.
    const v = decideCollabBind({
      ...base,
      resolution: SYNC_RESOLUTION.NO_PEERS,
      docHeldContent: true,
    });
    expect(v.decision).toBe(COLLAB_BIND.BIND);
  });

  it("a document that HOLDS content always binds, whatever the resolution says", () => {
    for (const resolution of [SYNC_RESOLUTION.NO_PEERS, SYNC_RESOLUTION.ALREADY_SYNCED, null]) {
      const v = decideCollabBind({
        docTextLength: 12,
        editorBufferLength: BUFFER.length,
        resolution,
        docHeldContent: false,
      });
      expect(v.decision).toBe(COLLAB_BIND.BIND);
    }
  });

  it("an EMPTY buffer binds — there is nothing to lose, and new notes must work", () => {
    const v = decideCollabBind({
      docTextLength: 0,
      editorBufferLength: 0,
      resolution: SYNC_RESOLUTION.NO_PEERS,
      docHeldContent: false,
    });
    expect(v.decision).toBe(COLLAB_BIND.BIND);
  });
});

describe("S129 AC3 — the host arm", () => {
  it("seeds a document that has never held content (the case it was written for)", () => {
    expect(hostMaySeedFromEditor({ docTextLength: 0, docHeldContent: false })).toBe(true);
  });

  it("does NOT re-seed a document somebody emptied — that would undo the deletion", () => {
    // The second, milder hole: it resurrects rather than destroys, but it is
    // still a divergence nobody asked for, and the tombstones close it free.
    expect(hostMaySeedFromEditor({ docTextLength: 0, docHeldContent: true })).toBe(false);
  });

  it("never seeds over a document that already holds content", () => {
    expect(hostMaySeedFromEditor({ docTextLength: 5, docHeldContent: false })).toBe(false);
    expect(hostMaySeedFromEditor({ docTextLength: 5, docHeldContent: true })).toBe(false);
  });
});

/**
 * AC4 — BOTH HALVES, END TO END, THROUGH THE REAL `activateForFile`.
 *
 * The `EditorView` double carries a real buffer length and records every
 * `reconfigure`, so "was `yCollab` installed" is observable without running
 * CodeMirror.
 */
describe("S129 AC4 — the real activation path, both halves", () => {
  beforeEach(() => resetCollabBindRefusals());

  async function rig(options: { docContent?: string; emptiedByPeer?: boolean }) {
    const { CollabManager } = await import("../../editor/collab");
    const { SyncManager } = await import("../../sync/sync");
    const { DEFAULT_SETTINGS } = await import("../../types");

    const doc = new Y.Doc();
    const text = doc.getText("content");
    if (options.docContent) text.insert(0, options.docContent);
    if (options.emptiedByPeer) {
      text.insert(0, "content a peer then deleted");
      text.delete(0, text.length);
    }

    const sync = new SyncManager({ ...DEFAULT_SETTINGS, roomId: "r" } as never);
    (sync as unknown as { docs: Map<string, Y.Doc> }).docs.set(NOTE, doc);
    // The relay reports nobody else holds this doc — S128's NO_PEERS, and the
    // common case for a note whose peers have not subscribed yet.
    (
      sync as unknown as { handleSubscribed(id: string, p: Uint8Array): void }
    ).handleSubscribed(NOTE, new Uint8Array());
    (sync as unknown as { getDoc(p: string): unknown }).getDoc = () => ({
      doc,
      text,
      awareness: {
        setLocalStateField: vi.fn(),
        setLocalState: vi.fn(),
      },
    });

    const reconfigures: unknown[][] = [];
    const view = {
      state: {
        doc: { length: BUFFER.length, toString: () => BUFFER },
        selection: { main: { anchor: 0, head: 0 } },
      },
      dispatch: vi.fn((spec: { effects?: unknown }) => {
        reconfigures.push([spec.effects]);
      }),
      destroyed: false,
    };

    const manager = new CollabManager();
    const logs: string[] = [];
    manager.setLogger({ log: (_c: string, m: string) => logs.push(m) });
    return { manager, view, sync, doc, text, reconfigures, logs };
  }

  it("🚨 a guest opening a note whose doc has NOT arrived keeps its buffer", async () => {
    const r = await rig({});
    await r.manager.activateForFile(r.view as never, NOTE, r.sync, "guest");

    // The buffer is untouched — asserted on the buffer itself, not on the
    // absence of an exception.
    expect(r.view.state.doc.toString()).toBe(BUFFER);
    // AC5 — and the user is told, and a validator can read it.
    expect(getCollabBindRefusals().total).toBe(1);
    expect(getCollabBindRefusals().paths).toEqual([NOTE]);
    expect(r.logs.some((l) => l.includes("bind refused"))).toBe(true);
  });

  it("AC4 — a guest opening a note whose doc HAS arrived binds and collaborates", async () => {
    const r = await rig({ docContent: "the shared content" });
    await r.manager.activateForFile(r.view as never, NOTE, r.sync, "guest");

    // No refusal, and the binding was installed.
    expect(getCollabBindRefusals().total).toBe(0);
    expect(getCollabBindRefusals().paths).toEqual([]);
    // VACUITY CONTROL: the allowed case genuinely reaches the binding, so the
    // refused case above is not passing because nothing ever binds.
    expect(r.reconfigures.length).toBeGreaterThan(0);
  });

  it("AC4 — a genuine select-all-and-delete still reaches the editor", async () => {
    // S126's property at this site: tombstones mean the emptiness is real.
    const r = await rig({ emptiedByPeer: true });
    await r.manager.activateForFile(r.view as never, NOTE, r.sync, "guest");
    expect(getCollabBindRefusals().total).toBe(0);
  });

  it(`AC4 — the refusal is deterministic over ${ITERATIONS} activations`, async () => {
    // Timing is involved (a wall-clock loop precedes the decision), so a single
    // green cannot distinguish a fix from a won race.
    //
    // TIME IS CONTROLLED, NOT SLEPT THROUGH. Each refusal genuinely costs the
    // full 1 s wait loop, so 50 real activations would take 50 s; fake timers
    // advance that deterministically. This is the opposite of sleep-as-settle:
    // nothing here waits and hopes, the clock is driven to a known point and
    // the promise is then awaited.
    const outcomes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      resetCollabBindRefusals();
      const r = await rig({});
      vi.useFakeTimers();
      try {
        const activation = r.manager.activateForFile(r.view as never, NOTE, r.sync, "guest");
        // Past the 10 x 100 ms loop with room to spare.
        await vi.advanceTimersByTimeAsync(1_500);
        await activation;
      } finally {
        vi.useRealTimers();
      }
      outcomes.push(getCollabBindRefusals().total);
    }
    expect(outcomes).toHaveLength(ITERATIONS);
    expect(outcomes.every((n) => n === 1)).toBe(true);
  });

  it("AC2 — a refused path RECOVERS when the content arrives, with no retry timer", async () => {
    const r = await rig({});
    await r.manager.activateForFile(r.view as never, NOTE, r.sync, "guest");
    expect(getCollabBindRefusals().paths).toEqual([NOTE]);

    // The event, not a timer: the document gains content.
    r.text.insert(0, "the shared content arrives late");
    // Let the re-activation settle.
    for (let i = 0; i < 30; i++) await Promise.resolve();

    expect(getCollabBindRefusals().paths).toEqual([]);
    expect(r.logs.some((l) => l.includes("content arrived"))).toBe(true);
  });
});
