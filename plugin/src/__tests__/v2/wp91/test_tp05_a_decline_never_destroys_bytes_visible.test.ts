// WP91 / C91 AC4 — I11 REFUSAL NEVER DESTROYS, on the CAPTURE side.
//
// I11 has been read as a rule about deletions for this whole run. This is the same
// invariant one seam upstream: the plugin refuses to accept an edit it cannot
// attribute, and the user loses it. B44 recorded the swallowed bytes "present on
// disk, unchanged after 20 s" — but with the doc unmoved `flushToDisk` dedups at
// `canvas-persistence.ts` and nothing is written, so the file survived because
// NOTHING TRIED. One further remote change removes the dedup, and the projection of
// a doc that never learned about the user's edit is then written over the file that
// still holds it.
//
// WHAT THIS FILE IS AND IS NOT. The charter's AC4 proper is a two-instance live
// scenario and it belongs to W4; its verdict is owed either way. What is decidable
// headless is (T1) the charter's own "headless companion" — a decline performs no
// destructive vault operation — and (T2/T3) the two-step chain itself, driven
// against this rig, which is a SURROGATE for the live row and is labelled as one.
// T3 in particular reproduces the destruction on demand by re-arming the swallow,
// so the claim "the fix is what prevents it" is measured rather than argued.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PATH,
  type Rig,
  advance,
  applyRemoteDelta,
  canvasJson,
  createRig,
  node,
  nodeIdsIn,
  remoteNode,
  settle,
} from "./harness";

const SEED = canvasJson([node("seed", "seed card")]);

/** AC4 vacuity (b): the presence check parses the record's own `id` field. A
 * substring search over a `.canvas` matches `"x": 20` and `"width": 400`, which is
 * the guard WP87 got wrong. */
function idsOnDisk(raw: string): string[] {
  const parsed = JSON.parse(raw) as { nodes?: { id?: unknown }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id)).sort();
}

describe("WP91 AC4 — a declined capture never destroys the user's bytes", () => {
  let rig: Rig;

  beforeEach(async () => {
    vi.useFakeTimers();
    rig = await createRig({ initial: { [PATH]: SEED } });
  });

  afterEach(() => {
    rig.destroy();
    vi.useRealTimers();
  });

  it("T1 — the headless companion: no decline path performs a modify, a create, a delete or a trash", async () => {
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer")));
    await advance(200);
    const vault = rig.vault as {
      modify: { mock: { calls: unknown[] } };
      create: { mock: { calls: unknown[] } };
      delete: { mock: { calls: unknown[] } };
      trash: { mock: { calls: unknown[] } };
    };

    // Drive every reason in the closed set on this instance.
    rig.emitModify(PATH); // echo, through the registered handler
    await settle();
    const bytesAfterEcho = rig.files.get(PATH) as string;

    rig.canvasSync.setCanWrite(() => false);
    await rig.canvasSync.handleLocalModify(PATH); // read-only
    rig.canvasSync.setCanWrite(() => true);
    rig.docHandleEnabled.value = false;
    await rig.canvasSync.handleLocalModify(PATH); // no-doc
    rig.docHandleEnabled.value = true;
    rig.canvasSync.unsubscribe(PATH);
    await rig.canvasSync.handleLocalModify(PATH); // not-subscribed

    // The declines really happened — otherwise "performed nothing" is vacuous.
    const counts = rig.canvasSync.captureDeclineCounts();
    expect(counts.echo + counts["read-only"] + counts["no-doc"] + counts["not-subscribed"]).toBe(4);

    expect(vault.modify.mock.calls).toHaveLength(0);
    expect(vault.create.mock.calls).toHaveLength(0);
    expect(vault.delete.mock.calls).toHaveLength(0);
    expect(vault.trash.mock.calls).toHaveLength(0);
    expect(rig.files.get(PATH)).toBe(bytesAfterEcho);
  });

  it("T2 — the two-step chain, SURVIVED: the user's save is captured, so a later remote change cannot project it away", async () => {
    // STEP 0 — a remote change lands and opens the mute. This is the condition.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote-a", remoteNode("remote-a", "peer a")));
    await advance(200);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

    // STEP 1 — the user saves, inside the window.
    rig.files.set(
      PATH,
      canvasJson([node("seed", "seed card"), node("user", "the user's card", 900)]),
    );
    rig.emitModify(PATH);
    await settle();
    expect(idsOnDisk(rig.files.get(PATH) as string)).toContain("user");
    // The difference from the pre-fix bundle, and the whole point: the writer's
    // OWN doc learned about it.
    expect(nodeIdsIn(rig.doc)).toContain("user");

    // STEP 2 — ONE FURTHER REMOTE CHANGE to the same path. Non-geometry (a new
    // record), which is the shape the charter requires at least one of.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote-b", remoteNode("remote-b", "peer b")));
    await advance(500);

    // The projection was really attempted — a file that survived because nothing
    // was queued has demonstrated nothing (AC4 vacuity (a)).
    expect(rig.written.length).toBeGreaterThan(1);
    const finalIds = idsOnDisk(rig.files.get(PATH) as string);
    expect(finalIds).toContain("user"); // I11: the user's bytes survived the projection
    expect(finalIds).toContain("remote-a");
    expect(finalIds).toContain("remote-b");
  });

  it("T3 — the same chain with the swallow RE-ARMED destroys the user's node: the loss is real and the capture is what prevents it", async () => {
    // The mechanism, reproduced on demand. Nothing about the product is changed:
    // the swallow is re-created by NOT delivering the event, which is exactly what
    // `vault-events.ts`'s mute check used to do. If step 2 could not destroy the
    // record, T2's survival would be true for free.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote-a", remoteNode("remote-a", "peer a")));
    await advance(200);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

    rig.files.set(
      PATH,
      canvasJson([node("seed", "seed card"), node("user", "the user's card", 900)]),
    );
    // ...and the event is dropped, as the mute used to drop it.
    expect(idsOnDisk(rig.files.get(PATH) as string)).toContain("user");
    expect(nodeIdsIn(rig.doc)).not.toContain("user");

    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote-b", remoteNode("remote-b", "peer b")));
    await advance(500);

    expect(rig.written.length).toBeGreaterThan(1);
    // THE RED THIS WORK PACKAGE EXISTS TO PREVENT: the user's card is gone from
    // the user's own disk, and nothing anywhere recorded that it existed.
    expect(idsOnDisk(rig.files.get(PATH) as string)).not.toContain("user");
  });
});
