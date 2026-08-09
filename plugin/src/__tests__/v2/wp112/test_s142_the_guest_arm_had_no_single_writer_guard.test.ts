// S142 — `subscribe()`'s GUEST ARM HAD NO ACTIVE-FILE GUARD AT ALL.
//
// STILL OPEN, AND UNCHANGED IN SHAPE BY WP115. The charter asked whether S148's
// repair had closed or altered it. It had not: WP115 routed this arm's write
// through the conflict-preservation seam, which decides what happens to the
// bytes it is about to replace. It says nothing about WHO MAY WRITE, and the
// write it added is the same `adapter.write`, on the same line, for the same
// file the editor owns. Preserving a copy of a file you must not be writing is
// a better outcome, not a different decision.
//
// THE INVARIANT: the file the editor currently has open is written by Obsidian
// and yCollab and by nothing else. `background-sync.ts` honours it in
// `handleLocalTextModify`, in the `Y.Text` observer and — since WP109 — in
// `subscribe()`'s HOST arm. The GUEST arm never did, in the role where the
// editor owns the disk copy just as much.
//
// THE PRE-REPAIR READING, measured — break row `W5` disables this package's
// guard, which restores `6786938`'s behaviour exactly, and reruns this file:
//
//   guest has NOTE open, the host's document holds the host's text,
//   the guest's disk holds its own
//     ├── writes ......... include `adapter.write:_liveshare-test/open-in-the-editor.md`
//     ├── the guest's disk BECOMES the host's text, under the open editor
//     └── declines ....... byArm["subscribe-guest"] === undefined
//
// The ledger did not exist before this package, so the third line is what the
// absence looked like: not a zero — no reading at all.
//
// TWO LESSONS FROM NEIGHBOURING PACKAGES ARE BUILT INTO THE FIX
//   ├── S134 — the guard stands immediately in front of the WRITE, never in
//   │     front of the arm. The host's version of it used to sit one branch
//   │     earlier, where it also disabled SEEDING, and every mid-session note
//   │     stopped syncing. Row B2 asserts the arm's non-writing work still runs
//   │     for the active file.
//   └── S155 — the decline is COUNTED. WP109 expressed the host arm's invariant
//         as an empty branch: a thing a test can point at, but a thing no
//         observer can distinguish from "never reached". Row B5 makes that
//         branch produce a reading too, which is a fix to WP109's blind spot
//         rather than to its logic.
//
// B3 — CONVERGENCE, WHICH IS THE RISK THIS FIX CREATES. Guests do not seed, so
// a guest that declines a write and then has nothing else write it would keep a
// divergent file for ever. Row B3 measures the catch-up. The subtle half is in
// the production comment: `lastWrittenContent` must NOT be set in the decline
// branch, or `writeToDisk`'s first line short-circuits the catch-up and the file
// never converges. Break row W6 reddens exactly that.
//
// Vault double, everything else production — see `../wp115/harness.ts`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAttestationDecisions } from "../../../files/attestation-guard";
import { resetConflictCopies } from "../../../files/conflict-copy";
import { resetEmptyWriteRefusals } from "../../../files/empty-write-guard";
import {
  getSingleWriterDeclines,
  resetSingleWriterDeclines,
  singleWriterDeclineMessage,
} from "../../../files/single-writer";
import { underTimerClamp } from "../../support/timer-clamp";
import { type Peer, type Rig, SHARE, sleep, startRig } from "../wp115/harness";

const NOTE = `${SHARE}/open-in-the-editor.md`;
const OTHER = `${SHARE}/not-open.md`;
const HOST_TEXT = "the host's text, which the relay is holding\n";
const GUEST_TEXT = "the guest's own bytes, under an open editor\n";
const OTHER_HOST_TEXT = "the other file, which nobody has open\n";
const OTHER_GUEST_TEXT = "the other file, diverged on the guest\n";

/** `doWriteToDisk`'s mute/settle window. The clamp row reads it. */
const SETTLE_MS = 250;

describe("S142 — the guest arm and the file the editor owns", () => {
  let rig: Rig;

  beforeEach(async () => {
    resetSingleWriterDeclines();
    resetEmptyWriteRefusals();
    resetConflictCopies();
    resetAttestationDecisions();
    rig = await startRig("wp112-s142");
  });

  afterEach(async () => {
    await rig.close();
  });

  /**
   * A host that has seeded both documents from its own disk, and a guest whose
   * disk diverges on both. `startAll("host")` is the real seeding path.
   */
  async function twoPeers(): Promise<{ host: Peer; guest: Peer }> {
    const host = await rig.peer({
      clientId: "host",
      role: "host",
      files: { [NOTE]: HOST_TEXT, [OTHER]: OTHER_HOST_TEXT },
    });
    await host.manifest.publishManifest();
    await host.bg.startAll("host");

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: { [NOTE]: GUEST_TEXT, [OTHER]: OTHER_GUEST_TEXT },
      cachedMtime: 5_000,
      diskMtime: 5_000,
      lastSessionEndedAt: 1_000,
    });
    await sleep(200);
    return { host, guest };
  }

  /**
   * The guest's real join pass. `startAll` is what `main.ts` calls at every
   * guest entry point, it is the only setter of this writer's ROLE, and it
   * reaches `subscribe()` for every announced path — so the active file is set
   * FIRST here for the same reason it is set first in the product: on a resume
   * or a reconnect the user already has a note open.
   */
  async function guestJoinsWithNoteOpen(guest: Peer, active: string | null = NOTE) {
    guest.bg.setActiveFile(active);
    await guest.bg.startAll("guest");
    await sleep(300);
  }

  it("🚨 B1 — a guest with the note OPEN no longer has its disk copy written by background-sync", async () => {
    const { guest } = await twoPeers();
    // The editor owns this file. `main.ts` sets exactly this on an active-leaf
    // change, and `subscribe()` is reached mid-session from `onFileAdded` and
    // on every resume/reconnect pass.
    await guestJoinsWithNoteOpen(guest);

    // 🚨 Before the repair: ["adapter.write:_liveshare-test/open-in-the-editor.md"]
    // and a single-writer ledger that did not exist.
    expect(guest.vault.writes).not.toContain(`adapter.write:${NOTE}`);
    expect(guest.vault.bytes.get(NOTE)).toBe(GUEST_TEXT);
    expect(getSingleWriterDeclines()).toMatchObject({
      total: 1,
      byArm: { "subscribe-guest": 1 },
    });
  }, 60_000);

  it("B2 — the guard is in front of the WRITE, not in front of the ARM (S134)", async () => {
    const { guest } = await twoPeers();
    await guestJoinsWithNoteOpen(guest);

    // S119's evidence is gathered by `noteIfNonEmpty`, which sits in this arm
    // ABOVE the write. If the guard had been placed in front of the arm — which
    // is exactly what S134 was — this peer would no longer know that the
    // document has held content, and a later legitimate emptying of the active
    // file would be refused on every peer that had it open.
    const observed = (guest.bg as unknown as { observedNonEmpty: Set<string> })
      .observedNonEmpty;
    expect(observed.has(NOTE)).toBe(true);

    // The observer is installed, so everything arriving after this pass still
    // reaches disk through the ordinary path.
    const observers = (guest.bg as unknown as { observers: Map<string, unknown> }).observers;
    expect(observers.has(NOTE)).toBe(true);
  }, 60_000);

  it("B3 — the declined file still CONVERGES: switching away flushes doc → disk (guests do not seed, so this is the whole risk)", async () => {
    const { guest } = await twoPeers();
    await guestJoinsWithNoteOpen(guest);
    expect(guest.vault.bytes.get(NOTE)).toBe(GUEST_TEXT);

    // The user switches to another note. `setActiveFile` flushes the outgoing
    // file through `writeToDisk` — the plugin-owned catch-up, and the same one
    // S151 identified for the host.
    guest.bg.setActiveFile(OTHER);
    await sleep(300);

    expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
    expect(guest.vault.writes).toContain(`adapter.write:${NOTE}`);
  }, 60_000);

  it("B4 — the invariant is SCOPED, not a blanket refusal: a file the editor does not own is still written by the same arm in the same run", async () => {
    const { guest } = await twoPeers();
    // ONE `startAll` pass, both files, one open and one not.
    await guestJoinsWithNoteOpen(guest);

    expect(guest.vault.bytes.get(NOTE)).toBe(GUEST_TEXT); // declined
    expect(guest.vault.bytes.get(OTHER)).toBe(OTHER_HOST_TEXT); // written
    expect(guest.vault.writes).toContain(`adapter.write:${OTHER}`);
    expect(getSingleWriterDeclines().byArm["subscribe-guest"]).toBe(1);
  }, 60_000);

  it("B5 — the HOST arm's decline now produces a reading too, and 'declined' is distinguishable from 'never reached' (S155)", async () => {
    const host = await rig.peer({
      clientId: "host",
      role: "host",
      files: { [NOTE]: HOST_TEXT, [OTHER]: OTHER_HOST_TEXT },
    });
    // `startAll` is the only setter of this writer's role, and it is run here
    // BEFORE the manifest is published — so the role is host, explicitly, while
    // the announced set is still empty and nothing is subscribed or seeded yet.
    await host.bg.startAll("host");
    await host.manifest.publishManifest();
    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: {},
    });
    // A peer puts content into the document that is NOT the host's disk copy.
    const handle = guest.sync.getDoc(NOTE);
    expect(handle).toBeTruthy();
    handle?.doc.transact(() => handle.text.insert(0, "text that only the relay holds\n"));
    await sleep(300);

    // NEVER REACHED: no active file, so the host arm takes the ordinary branch
    // and writes. The ledger stays at zero — and that zero means "not reached".
    await host.bg.subscribe(OTHER);
    await sleep(200);
    expect(getSingleWriterDeclines().total).toBe(0);

    // RAN, AND DECLINED. Before this package both readings were `{total: 0,
    // byArm: {}}` and no observer, live or here, could tell them apart.
    host.bg.setActiveFile(NOTE);
    await host.bg.subscribe(NOTE);
    await sleep(200);
    expect(getSingleWriterDeclines()).toMatchObject({
      total: 1,
      byArm: { "subscribe-host": 1 },
    });
    expect(host.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
  }, 60_000);

  it("B6 — the decline line names the arm and the path, and never any content", () => {
    const message = singleWriterDeclineMessage("subscribe-guest", NOTE);
    expect(message).toContain("SINGLE-WRITER DECLINE:");
    expect(message).toContain("arm=subscribe-guest");
    expect(message).toContain(`path=${NOTE}`);
    expect(message).not.toContain(GUEST_TEXT.trim());
    expect(message).not.toContain(HOST_TEXT.trim());
  });

  it("B7 — under a CLAMPED renderer: the instrument is proved live on this file first, then the decline and the catch-up are unchanged", async () => {
    const { guest } = await twoPeers();

    await underTimerClamp(
      { floorMs: 1_200, growthPerFireMs: 200, jitterMs: 20, scope: /background-sync\.ts/ },
      async (clamp) => {
        await guestJoinsWithNoteOpen(guest);
        expect(getSingleWriterDeclines().byArm["subscribe-guest"]).toBe(1);
        expect(guest.vault.bytes.get(NOTE)).toBe(GUEST_TEXT);

        // The catch-up, under the clamp.
        guest.bg.setActiveFile(OTHER);
        await sleep(400);
        expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);

        // THE INSTRUMENT HAS TEETH ON THIS EXACT FILE, and that is asserted
        // rather than assumed (S65/S113/S133: a reader that cannot match its
        // subject has been quoted as a result four times in this project).
        // `doWriteToDisk`'s settle window is a `background-sync.ts` timer; under
        // the clamp it is still open long after the unclamped 250 ms would have
        // closed it. A scenario scored on `isRecentDiskWrite` at the unclamped
        // moment reads the OPPOSITE answer here — that is the clamp changing an
        // outcome, on this path, in this run.
        await sleep(SETTLE_MS * 2);
        expect(guest.bg.isRecentDiskWrite(NOTE)).toBe(true);

        clamp.assertClamped(1, /background-sync\.ts/);
        expect(clamp.stats().maxAppliedMs).toBeGreaterThanOrEqual(1_200);
      },
    );

    // Unclamped control for the teeth claim: the same window closes on its own.
    guest.bg.setActiveFile(NOTE);
    guest.bg.setActiveFile(OTHER);
    await sleep(SETTLE_MS * 3);
    expect(guest.bg.isRecentDiskWrite(NOTE)).toBe(false);
  }, 60_000);
});
