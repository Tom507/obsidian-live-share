// S128 — ONE API DEFECT, NOT SIX CODING MISTAKES.
//
// `waitForSync` resolving has always meant two different things:
//
//   PEER_STATE  a peer answered and its state was applied
//   NO_PEERS    the relay reported nobody holds this doc, so there was nobody
//               to ask and the document is empty because it is NEW
//
// Both resolve the promise at the same instant and NO CALLER COULD TELL THEM
// APART. Three defects in this run — S119 (every `.md` truncated to 0 bytes),
// S121 (the skew cliff), S123 (a canvas that reached one guest and not another)
// — are that single gap reached from three directions. Fixing instances one at
// a time is how the run collected three.
//
// `peerCount === 0` is not an edge case. For any doc id no peer has ever
// subscribed to — every new canvas, every newly shared note — it is the COMMON
// case.
//
// WHAT THIS PACKAGE DOES AND DOES NOT DO. It makes the distinction VISIBLE. It
// deliberately does NOT change when the promise resolves: a caller that ignores
// the resolved value behaves exactly as before, which is what keeps a
// cross-cutting API change safe to land in one step. Acting on the new fact is
// per-consumer work, and the audit that decides which consumers need it is in
// the report, not here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { SYNC_RESOLUTION, SyncManager } from "../../../sync/sync";
import { DEFAULT_SETTINGS } from "../../../types";

/** Stated, as the charter asks for anything with an ordering in it. */
const ITERATIONS = 40;

function manager() {
  return new SyncManager({ ...DEFAULT_SETTINGS, roomId: "r" } as never);
}

function withDoc(m: SyncManager, docId: string): Y.Doc {
  const doc = new Y.Doc();
  (m as unknown as { docs: Map<string, Y.Doc> }).docs.set(docId, doc);
  return doc;
}

/** The relay's MUX_SUBSCRIBED with a peer count of zero (an empty payload). */
function subscribedWithNoPeers(m: SyncManager, docId: string) {
  (
    m as unknown as { handleSubscribed(id: string, payload: Uint8Array): void }
  ).handleSubscribed(docId, new Uint8Array());
}

describe("S128 AC5 — waitForSync says WHY it resolved", () => {
  it(`"nobody held this doc" is reported as NO_PEERS, ${ITERATIONS} runs`, async () => {
    // The producer behind S119 and S123. A brand-new doc id, nobody else on it.
    const seen: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const m = manager();
      const docId = `__canvas__:new-${i}`;
      withDoc(m, docId);
      subscribedWithNoPeers(m, docId);
      seen.push(await m.waitForSync(docId));
    }
    expect(seen).toHaveLength(ITERATIONS);
    expect(seen.every((r) => r === SYNC_RESOLUTION.NO_PEERS)).toBe(true);
    // …and it is genuinely a different value from the other outcome, so the row
    // cannot pass because everything resolves to one constant.
    expect(SYNC_RESOLUTION.NO_PEERS).not.toBe(SYNC_RESOLUTION.PEER_STATE);
  });

  it("a peer answering is reported as PEER_STATE", async () => {
    // The other producer: SYNC_STEP2, i.e. a peer sent its state and it was
    // applied before the promise resolved.
    const m = manager();
    const docId = "notes/hello.md";
    withDoc(m, docId);
    (m as unknown as { setSynced(id: string, v: boolean, r: string): void }).setSynced(
      docId,
      true,
      SYNC_RESOLUTION.PEER_STATE,
    );
    expect(await m.waitForSync(docId)).toBe(SYNC_RESOLUTION.PEER_STATE);
  });

  it("the reason is readable without awaiting, for a caller that already synced", () => {
    const m = manager();
    const docId = "__canvas__:x";
    withDoc(m, docId);
    expect(m.getSyncResolution(docId)).toBeNull();
    subscribedWithNoPeers(m, docId);
    expect(m.getSyncResolution(docId)).toBe(SYNC_RESOLUTION.NO_PEERS);
  });

  it("a resolution with no recorded reason reports ALREADY_SYNCED, never PEER_STATE", async () => {
    // The fail-safe direction. An unknown reason must not masquerade as the
    // STRONGER fact — anything destructive treats ALREADY_SYNCED as unknown.
    const m = manager();
    const docId = "notes/legacy.md";
    withDoc(m, docId);
    (m as unknown as { synced: Map<string, boolean> }).synced.set(docId, true);
    expect(await m.waitForSync(docId)).toBe(SYNC_RESOLUTION.ALREADY_SYNCED);
  });

  it("the reason is dropped with the doc, so a re-subscribe cannot inherit it", () => {
    const m = manager();
    const docId = "__canvas__:y";
    withDoc(m, docId);
    subscribedWithNoPeers(m, docId);
    expect(m.getSyncResolution(docId)).toBe(SYNC_RESOLUTION.NO_PEERS);
    m.releaseDoc(docId);
    expect(m.getSyncResolution(docId)).toBeNull();
  });
});

describe("S128 AC5 — the resolution BEHAVIOUR is unchanged", () => {
  it("a caller that ignores the value still resolves at the same instant", async () => {
    // The requirement that makes this landable in one step: every existing
    // `await waitForSync(x)` in the tree behaves exactly as before.
    const m = manager();
    const docId = "notes/a.md";
    withDoc(m, docId);
    let resolved = false;
    const p = m.waitForSync(docId).then(() => {
      resolved = true;
    });
    // Not resolved before the signal.
    await Promise.resolve();
    expect(resolved).toBe(false);
    subscribedWithNoPeers(m, docId);
    await p;
    expect(resolved).toBe(true);
  });

  it("it still rejects on timeout rather than resolving with a reason", async () => {
    // A timeout is not a third resolution value; it stays a rejection, because
    // callers catch it and take a different path.
    const m = manager();
    const docId = "notes/never.md";
    withDoc(m, docId);
    await expect(m.waitForSync(docId, 10)).rejects.toThrow(/Sync timeout/);
  });

  it("an already-synced doc still resolves immediately", async () => {
    const m = manager();
    const docId = "notes/b.md";
    withDoc(m, docId);
    subscribedWithNoPeers(m, docId);
    // Resolves without any further signal.
    await expect(m.waitForSync(docId)).resolves.toBe(SYNC_RESOLUTION.NO_PEERS);
  });
});

/**
 * AC7 — THE FOURTH INSTANCE, PINNED.
 *
 * The audit found one consumer that needs PEER_STATE, does not get it, and is
 * NOT defended by either floor built in this run: `editor/collab.ts`, which
 * binds `yCollab` to the doc's `Y.Text` after a 1-second wall-clock wait.
 *
 * What makes it the undefended one is the line asserted below.
 * `BackgroundSync`'s observer returns for `path === this.activeFile`, because
 * "the active file is persisted by the editor / yCollab, never by
 * background-sync". So the active file never reaches `doWriteToDisk` — and
 * `doWriteToDisk` is exactly where S119's and S126's empty-write floor lives.
 * A guest that opens a note before the host's state arrives therefore binds an
 * EMPTY `Y.Text` into its editor, and the floor is nowhere on that path.
 *
 * Described, not fixed, and not numbered — the charter asked for the finding.
 */
describe("S128 AC7 — why the active file is the undefended path", () => {
  const source = readFileSync(
    new URL("../../../files/background-sync.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    "utf8",
  );

  it("the observer returns for the active file, before any disk write is scheduled", () => {
    const observer = source.slice(source.indexOf("private attachObserver("));
    const body = observer.slice(0, observer.indexOf("text.observe(observer)"));
    expect(body).toContain("if (path === this.activeFile) return;");
    // …and the return is BEFORE the write is scheduled, which is what takes the
    // active file out of the floor's reach.
    expect(body.indexOf("if (path === this.activeFile) return;")).toBeLessThan(
      body.indexOf("this.scheduleDiskWrite(path, text)"),
    );
  });

  it("the empty-write floor lives in doWriteToDisk, which that return skips", () => {
    const writer = source.slice(source.indexOf("private async doWriteToDisk("));
    expect(writer).toContain("decideEmptyWrite({");
    // The floor is downstream of `scheduleDiskWrite`, so a path that returns
    // above never consults it. Stated as an assertion so the relationship is
    // pinned rather than argued in a comment.
    expect(source.indexOf("private async doWriteToDisk(")).toBeGreaterThan(
      source.indexOf("this.scheduleDiskWrite(path, text)"),
    );
  });
});
