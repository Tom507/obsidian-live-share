// S151 — THE INITIATOR'S OWN DISK LAGS ITS PEERS.
//
// THE MEASUREMENT: an emptying reached both peers' disks in 0.00 s while the
// initiator's own disk still held the old bytes.
//
// THE VERDICT: A PROPERTY, and a deliberate one. It is the SINGLE-WRITER
// INVARIANT, visible from outside for the first time.
//
// THE LINE, as B1 asks for it. `background-sync.ts::attachObserver` installs the
// observer that turns a `Y.Text` change into a disk write, and its FIRST
// statement is:
//
//     if (transaction.local) return;
//
// The initiator's own emptying IS a local transaction — that is what yCollab
// produces for the user's keystrokes — so on the initiator the observer returns
// on line one and `scheduleDiskWrite` is never called for it. A second,
// independent gate stands behind it four lines later (`if (path ===
// this.activeFile) return; if (path === this.collabBoundFile) return;`), and the
// initiator necessarily satisfies both: to empty a note you have it open.
//
// On every OTHER peer the same change arrives as a REMOTE transaction, both
// gates pass (they have the note closed — the live run verified zero open leaves
// before each gesture), and the write lands after the trailing debounce.
//
// SO IT IS NOT DEFERRED OR DEBOUNCED ON THE INITIATOR. IT IS NOT SCHEDULED AT
// ALL. The active file's copy on disk belongs to Obsidian's editor, and the
// plugin writing it would be the second writer that invariant exists to
// forbid. The initiator's disk settles when Obsidian saves the buffer, or when
// the user switches away — `setActiveFile` flushes the outgoing file through
// `writeToDisk`, which is the only plugin-owned catch-up and is demonstrated in
// row B3 as the control.
//
// WHAT IS NEVERTHELESS TRUE AND WORTH THE SIGNAL: anything that asks "did it
// land?" ON THE INITIATOR is asking a peer that, by design, is the last to
// know. That is a RIG correctness statement, not a product defect. Score
// convergence on a peer, or force the flush by switching away first.
//
// B3 — THE DEBOUNCE AGAINST S147's CLAMP. `scheduleDiskWrite` arms ONE
// `setTimeout` of at most `DEBOUNCE_MS` (300), capped by `MAX_WAIT_MS` (500)
// since the first pending update. One timer, never a hop COUNT — so under the
// clamp it costs ONE clamp period and no more, which is the difference between
// this and the twenty-hop seed loop WP114 repaired. Row B4 measures it: at a
// 1 200 ms floor the peer's disk has NOT settled at +600 ms (it settles in ~300
// unclamped) and HAS settled well inside one clamp period. A debounce that is
// fine at 12 ms is 9 s at ten minutes hidden, and that is the honest number to
// carry — but it does not grow without bound.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { underTimerClamp } from "../../support/timer-clamp";
import { type Rig, SHARE, sleep, startRig } from "./harness";

const NOTE = `${SHARE}/emptied.md`;
const ORIGINAL = "fifty-six characters of note that the user will empty out";

describe("S151 — the initiator's own disk lags its peers", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await startRig("wp115-s151");
  });

  afterEach(async () => {
    await rig.close();
  });

  /**
   * Two real peers over the real relay, converged on `NOTE`, with the INITIATOR
   * holding it open: `activeFile` and `collabBoundFile` both name it, exactly as
   * `main.ts` sets them when a note is focused and yCollab is bound.
   */
  async function converged() {
    const initiator = await rig.peer({
      clientId: "initiator",
      role: "host",
      files: { [NOTE]: ORIGINAL },
    });
    await initiator.manifest.publishManifest();
    await initiator.bg.startAll("host");

    const peer = await rig.peer({ clientId: "peer", role: "guest", files: {} });
    await peer.bg.startAll("guest");
    await sleep(400);

    expect(peer.vault.bytes.get(NOTE)).toBe(ORIGINAL);
    expect(initiator.vault.bytes.get(NOTE)).toBe(ORIGINAL);

    // The user has the note open on the initiator. Nobody has it open elsewhere.
    initiator.bg.setActiveFile(NOTE);
    initiator.bg.setCollabBoundFile(NOTE);
    return { initiator, peer };
  }

  /** The user's select-all-and-delete, as yCollab produces it: a LOCAL transaction. */
  function emptyLocally(peer: Awaited<ReturnType<typeof converged>>["initiator"]) {
    const handle = peer.sync.getDoc(NOTE);
    if (!handle) throw new Error("no doc on the initiator");
    expect(handle.text.toString()).toBe(ORIGINAL);
    handle.doc.transact(() => handle.text.delete(0, handle.text.length));
    return handle;
  }

  it("B1/B2 — the peer's disk settles and the initiator's does not, and the reason is one line", async () => {
    const { initiator, peer } = await converged();
    const writesBefore = initiator.vault.writes.length;

    emptyLocally(initiator);
    await sleep(900); // ~3× the 300 ms trailing debounce

    // The peer — note closed, remote transaction — settled.
    expect(peer.vault.bytes.get(NOTE)).toBe("");
    expect(peer.vault.writes).toContain(`adapter.write:${NOTE}`);

    // The initiator — note open, local transaction — did not, and NOT because a
    // timer is pending: no write was ever scheduled for it.
    expect(initiator.vault.bytes.get(NOTE)).toBe(ORIGINAL);
    expect(initiator.vault.writes).toHaveLength(writesBefore);

    // The document agrees with the peer's disk on both sides. The divergence is
    // between the initiator's CRDT and the initiator's DISK, nowhere else.
    expect(initiator.sync.getDoc(NOTE)?.text.toString()).toBe("");
  }, 30_000);

  it("B2 (control) — closing the note does NOT make the initiator settle: the LOCAL-transaction gate is the primary one", async () => {
    // The same gesture, the same code, with the active-file and collab-bound
    // gates BOTH lifted. This is the row that separates the two explanations,
    // and it rules the active-file gate out as the cause: the initiator still
    // does not write.
    const { initiator, peer } = await converged();
    initiator.bg.setActiveFile(null);
    initiator.bg.setCollabBoundFile(null);

    emptyLocally(initiator);
    await sleep(900);

    // ...and it STILL does not write, because the emptying is a LOCAL
    // transaction on this peer and `attachObserver` returns on line one for
    // those. The active-file gate is the second reason, never the only one.
    expect(initiator.vault.bytes.get(NOTE)).toBe(ORIGINAL);
    expect(peer.vault.bytes.get(NOTE)).toBe("");
  }, 30_000);

  it("B3 (control) — switching away IS the plugin-owned catch-up, and it lands immediately", async () => {
    const { initiator } = await converged();
    emptyLocally(initiator);
    await sleep(400);
    expect(initiator.vault.bytes.get(NOTE)).toBe(ORIGINAL);

    // `setActiveFile` flushes the file the user just left through `writeToDisk`.
    initiator.bg.setActiveFile(`${SHARE}/something-else.md`);
    await sleep(200);

    expect(initiator.vault.bytes.get(NOTE)).toBe("");
    expect(initiator.vault.writes).toContain(`adapter.write:${NOTE}`);
  }, 30_000);

  it("B4 — the peer's debounce under S147's clamp: one clamp period, not twenty", async () => {
    const { initiator, peer } = await converged();

    await underTimerClamp(
      { floorMs: 1_200, growthPerFireMs: 200, jitterMs: 20, scope: /background-sync\.ts/ },
      async (clamp) => {
        emptyLocally(initiator);

        // PROVE THE INSTRUMENT CAN TURN THIS RED. Unclamped the peer settles in
        // ~300 ms; this is 2× that and it must NOT have settled yet.
        await sleep(600);
        expect(peer.vault.bytes.get(NOTE)).toBe(ORIGINAL);

        // ...and it settles inside ONE clamp period plus slack, not twenty.
        // `scheduleDiskWrite` arms a single timer; a hop count would be
        // unreachable here and that is exactly the S147 distinction.
        for (let i = 0; i < 40 && peer.vault.bytes.get(NOTE) !== ""; i++) await sleep(100);
        expect(peer.vault.bytes.get(NOTE)).toBe("");

        clamp.assertClamped(1, /background-sync\.ts/);
        const stats = clamp.stats();
        // The debounce asked for at most 300 ms and was handed at least the floor.
        expect(stats.maxRequestedMs).toBeLessThanOrEqual(300);
        expect(stats.maxAppliedMs).toBeGreaterThanOrEqual(1_200);
      },
    );

    // The initiator is unchanged by any of it: there was no timer to clamp.
    expect(initiator.vault.bytes.get(NOTE)).toBe(ORIGINAL);
  }, 30_000);
});
