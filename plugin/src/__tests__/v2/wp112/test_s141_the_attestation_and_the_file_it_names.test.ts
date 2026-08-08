// S141 — THE EMPTY-WRITE FLOOR, DEFEATED THROUGH THE FRONT DOOR OF ITS OWN GUARD.
//
// THE SIGNAL SAID "TRACED IN CODE, NOT MEASURED". IT IS NOW MEASURED.
// ---------------------------------------------------------------------------
// The register left S141 open on a reading of the source, and stated the limit
// of that reading honestly. Row A1 below closes it the other way: an executed
// write and lost bytes, over the real relay, with the floor active and NOT
// firing. The pre-repair reading, taken on `6786938` before a line was changed:
//
//   host publishes honestly ......... {"hash":"68a95c72…","size":50}
//   host `setActiveFile` round ...... {"hash":"e3b0c442…","size":0}   ← the LIE
//   host's OWN disk ................. 50 bytes, untouched
//   host's empty-write ledger ....... {total:1, byArm:{"doc-write":1}}
//   guest `syncFromManifest` ........ synced: 1
//   guest's disk .................... ""              ← TRUNCATED
//   guest's writes .................. ["modify:…/attested.md"]
//   guest's empty-write ledger ...... {"doc-write":1}  ← manifest-sync: ZERO
//   conflict copies ................. {total:0, discarded:1}
//   the guest's bytes survive? ...... FALSE — gone from the vault entirely
//
// Read the host's two lines together, because they are the whole signal: the
// S119 floor REFUSED to truncate the host's own file — and the very same three
// lines published `e3b0c442…` about the bytes it had just saved. The guard
// protecting this peer's disk and the statement destroying everybody else's are
// two statements apart, and only one of them was floored.
//
// WHY THE GUEST'S FLOOR DID NOT FIRE, AND WHY THAT IS NOT THE GUEST'S FAULT
// ---------------------------------------------------------------------------
// `syncFromManifest`'s evidence is `hashContent(content) === entry.hash`. With
// `content === ""` and `entry.hash === hash("")` that is TRUE, so the write was
// not empty-LOOKING to the floor and it proceeded. The floor was armed, correct
// and answering the question it was asked. **Hash agreement is evidence of
// AGREEMENT, not of CORRECTNESS** — `""` matching `hash("")` proves the
// transmission was faithful and nothing else.
//
// The floor being ARMED rather than absent is not argued here, it is measured
// twice in the same file: row A1's post-repair half runs the identical scenario
// with the attestation repaired, and the same floor on the same line fires
// (`manifest-sync: 1`) and saves the same bytes. Row P1 states the property in
// pure form. A zero in this ledger is a decision, not an absence — S155.
//
// THE FIX IS AT THE PRODUCER, AND AT THE FUNNEL RATHER THAN AT THE CALLER.
// ---------------------------------------------------------------------------
// WP109 removed the one producer it knew about and S141 stayed open BECAUSE THE
// PATH SURVIVES ITS PRODUCER. `ManifestManager.updateFile` is the single
// publication funnel for one file's content — six call sites reach it — so the
// floor is there. The consumer is untouched: its evidence test is not wrong.
//
// WHAT THE VAULT DOUBLE DOES NOT EXERCISE — see `../wp115/harness.ts` for the
// full statement. Relevant here: Obsidian's own file watcher, the editor's save
// cadence, and `Vault.trash`. Every participant that decides anything in these
// rows — both `SyncManager`s, both `ManifestManager`s, both `BackgroundSync`es,
// the relay, the manifest publication, `syncFromManifest`, `setActiveFile`,
// every floor and every ledger — is production code.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATTESTATION_DECISION,
  decideAttestation,
  getAttestationDecisions,
  resetAttestationDecisions,
} from "../../../files/attestation-guard";
import { getConflictCopies, resetConflictCopies } from "../../../files/conflict-copy";
import {
  EMPTY_WRITE_DECISION,
  decideEmptyWrite,
  getEmptyWriteRefusals,
  resetEmptyWriteRefusals,
} from "../../../files/empty-write-guard";
import { resetSingleWriterDeclines } from "../../../files/single-writer";
import { type Peer, type Rig, SHARE, sleep, startRig } from "../wp115/harness";

const NOTE = `${SHARE}/attested.md`;
const OTHER = `${SHARE}/other.md`;
const HOST_TEXT = "the host's bytes, which the host is about to deny\n";
const HOST_HASH_LEN = HOST_TEXT.length;
const GUEST_MARK = "GUEST-BYTES";
const GUEST_TEXT = `${GUEST_MARK} the guest's own copy of the shared note\n`;
/** The empty digest. The whole signal, in eight characters. */
const EMPTY_HASH_PREFIX = "e3b0c442";

/**
 * A modification time INSIDE the last session, so `S125`'s preservation
 * DISCARDs. Deliberate: the demonstration must show the bytes LOST, not merely
 * moved to a conflict copy, and the safety net not catching it is the setup in
 * which the loss is total.
 */
const LAST_SESSION_ENDED_AT = 10_000;
const STALE = 500;

describe("S141 — an attestation must be true of the file it names", () => {
  let rig: Rig;

  beforeEach(async () => {
    resetAttestationDecisions();
    resetConflictCopies();
    resetEmptyWriteRefusals();
    resetSingleWriterDeclines();
    rig = await startRig("wp112-s141");
  });

  afterEach(async () => {
    await rig.close();
  });

  /** A host whose manifest names `NOTE` honestly, with `hostFile` on its disk. */
  async function hostWithPublishedManifest(hostFile = HOST_TEXT): Promise<Peer> {
    const host = await rig.peer({
      clientId: "host",
      role: "host",
      files: { [NOTE]: hostFile, [OTHER]: "other\n" },
    });
    await host.manifest.publishManifest();
    return host;
  }

  /**
   * A guest holding its own bytes, joined and reconciled exactly as `main.ts`
   * does it. `STALE` on both clocks so `S125`'s net DISCARDs — the loss must be
   * a loss.
   */
  async function guestJoins(files: Record<string, string>) {
    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files,
      cachedMtime: STALE,
      diskMtime: STALE,
      lastSessionEndedAt: LAST_SESSION_ENDED_AT,
    });
    await sleep(150);
    const synced = await guest.manifest.syncFromManifest(
      () => {},
      () => {},
      () => {},
    );
    await sleep(150);
    return { guest, synced };
  }

  // -------------------------------------------------------------------------
  // PART A — over the real relay.
  // -------------------------------------------------------------------------

  it("🚨 A1 — THE DEMONSTRATION: an empty attestation about a file with bytes is now REFUSED, and the floor that could not save the guest before is shown to be armed", async () => {
    const host = await hostWithPublishedManifest();
    const honest = host.manifest.getEntries().get(NOTE);
    expect(honest?.size).toBe(HOST_HASH_LEN);
    expect(honest?.hash.startsWith(EMPTY_HASH_PREFIX)).toBe(false);

    // THE PRODUCER, DRIVEN FOR REAL. The note is the active file, the user
    // switches away, and the document behind it is EMPTY — which is what every
    // one of S143's five early returns leaves behind, and what a document
    // acquired by `getDoc` for a path nothing ever seeded is by construction.
    host.bg.setActiveFile(NOTE);
    host.bg.setActiveFile(OTHER);
    await sleep(200);

    // THE HOST'S OWN FILE WAS ALWAYS SAFE — the write floor did its job. That
    // is the half that made this so hard to see: the peer that publishes the
    // lie is never the peer that loses anything.
    expect(host.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);

    // 🚨 Before the repair the entry here read {"hash":"e3b0c442…","size":0}.
    const attested = host.manifest.getEntries().get(NOTE);
    expect(attested?.hash).toBe(honest?.hash);
    expect(attested?.size).toBe(HOST_HASH_LEN);
    expect(getAttestationDecisions()).toMatchObject({
      refusedContradicted: 1,
      publishedVerifiedEmpty: 0,
    });

    // ...and the consequence, at the peer that would have paid for it.
    const { guest, synced } = await guestJoins({ [NOTE]: GUEST_TEXT, [OTHER]: "other\n" });

    // 🚨 Before the repair: synced 1, disk "", writes ["modify:…"], the guest's
    // bytes gone from the vault entirely and NOTHING in `manifest-sync`.
    expect(synced).toBe(0);
    expect(guest.vault.bytes.get(NOTE)).toBe(GUEST_TEXT);
    expect(guest.vault.writes).toHaveLength(0);
    expect(guest.vault.survives(GUEST_MARK)).toBe(true);

    // THE POSITIVE CONTROL, AND IT COSTS NOTHING: told the TRUTH about the file,
    // the guest's own floor — same line, same function, same run — fires and
    // saves the bytes. The zero above was a decision, not an absence.
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBe(1);
    // The net was never needed, so it never ran. Both counters, so the reading
    // is unambiguous in the S155 sense.
    expect(getConflictCopies()).toMatchObject({ total: 0, discarded: 0 });
  }, 60_000);

  it("A2 — the same producer, reached through a REAL early return (`cancelSubscribe`, which `vault-events` calls on a rename)", async () => {
    const host = await hostWithPublishedManifest();
    const honest = host.manifest.getEntries().get(NOTE)?.hash;

    // `subscribe()` is entered, then cancelled while it awaits `waitForSync` —
    // exactly what `vault-events.ts:260` does when a shared file is renamed. The
    // host arm never runs, so the document is never seeded, and the `finally`
    // detaches the observer again. This is one of S143's five doors, driven.
    const pending = host.bg.subscribe(NOTE);
    host.bg.cancelSubscribe(NOTE);
    await pending;

    host.bg.setActiveFile(NOTE);
    host.bg.setActiveFile(OTHER);
    await sleep(200);

    expect(host.manifest.getEntries().get(NOTE)?.hash).toBe(honest);
    expect(getAttestationDecisions().refusedContradicted).toBe(1);
  }, 60_000);

  it("A3 — a LEGITIMATE emptying still publishes, and still empties the guest (S126's lesson: a floor that refuses the true case is a new defect)", async () => {
    // The host's file really IS empty. The attestation is then TRUE of the file
    // it names, and every consumer must act on it.
    const host = await hostWithPublishedManifest("");
    host.bg.setActiveFile(NOTE);
    host.bg.setActiveFile(OTHER);
    await sleep(200);

    const entry = host.manifest.getEntries().get(NOTE);
    expect(entry?.hash.startsWith(EMPTY_HASH_PREFIX)).toBe(true);
    expect(entry?.size).toBe(0);
    expect(getAttestationDecisions()).toMatchObject({
      publishedVerifiedEmpty: 1,
      refusedContradicted: 0,
      refusedUnverifiable: 0,
    });

    const { guest, synced } = await guestJoins({ [NOTE]: GUEST_TEXT, [OTHER]: "other\n" });
    expect(synced).toBe(1);
    expect(guest.vault.bytes.get(NOTE)).toBe("");
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBeUndefined();
  }, 60_000);

  it("A4 — an UNREADABLE file is never attested empty: an unknown refuses, it does not guess", async () => {
    const host = await hostWithPublishedManifest();
    const honest = host.manifest.getEntries().get(NOTE)?.hash;
    const realRead = host.vault.asVault.read;
    host.vault.asVault.read = async (f: { path: string }) => {
      if (f.path === NOTE) throw new Error("EIO");
      return realRead(f);
    };
    try {
      host.bg.setActiveFile(NOTE);
      host.bg.setActiveFile(OTHER);
      await sleep(200);
    } finally {
      host.vault.asVault.read = realRead;
    }

    expect(host.manifest.getEntries().get(NOTE)?.hash).toBe(honest);
    expect(getAttestationDecisions()).toMatchObject({
      refusedUnverifiable: 1,
      refusedContradicted: 0,
    });
  }, 60_000);

  it("A5 — the BINARY arm is governed too: an empty binary attestation about a file with bytes is refused", async () => {
    const host = await hostWithPublishedManifest();
    const honest = host.manifest.getEntries().get(NOTE)?.hash;
    const file = host.vault.asVault.getAbstractFileByPath(NOTE);
    host.vault.asVault.readBinary = async () => new ArrayBuffer(16);

    await host.manifest.updateFile(file, new ArrayBuffer(0));
    expect(host.manifest.getEntries().get(NOTE)?.hash).toBe(honest);
    expect(getAttestationDecisions().refusedContradicted).toBe(1);

    // ...and a genuinely empty binary still publishes.
    host.vault.asVault.readBinary = async () => new ArrayBuffer(0);
    await host.manifest.updateFile(file, new ArrayBuffer(0));
    expect(host.manifest.getEntries().get(NOTE)?.binary).toBe(true);
    expect(getAttestationDecisions().publishedVerifiedEmpty).toBe(1);
  }, 60_000);

  it("A6 — the ledger tells 'never published' from 'published, and allowed' (S155)", async () => {
    const host = await hostWithPublishedManifest();
    // NEVER PUBLISHED: `publishManifest` builds its entries from its own disk
    // reads and does not route through this funnel at all.
    expect(getAttestationDecisions()).toMatchObject({
      total: 0,
      publishedNotEmpty: 0,
      publishedVerifiedEmpty: 0,
      refusedContradicted: 0,
      refusedUnverifiable: 0,
    });

    // PUBLISHED, AND ALLOWED: an ordinary non-empty content update.
    const file = host.vault.asVault.getAbstractFileByPath(NOTE);
    await host.manifest.updateFile(file, "a new line of the host's own text\n");
    expect(getAttestationDecisions()).toMatchObject({ total: 1, publishedNotEmpty: 1 });

    // No reading of this ledger is ambiguous between "ran" and "did not run",
    // which is the whole of the lesson WP115 paid for.
  }, 60_000);

  it("A7 — the ordinary publication does no disk read at all: a vault that cannot read still publishes non-empty content", async () => {
    const host = await hostWithPublishedManifest();
    const file = host.vault.asVault.getAbstractFileByPath(NOTE);
    host.vault.asVault.read = async () => {
      throw new Error("the floor must not have consulted the disk here");
    };
    await host.manifest.updateFile(file, "content the host really holds\n");
    expect(getAttestationDecisions()).toMatchObject({
      publishedNotEmpty: 1,
      refusedUnverifiable: 0,
    });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// PART P — the two decisions, pure. Every branch has a row.
// ---------------------------------------------------------------------------

describe("S141 — decideAttestation: is the statement true of the file it names?", () => {
  it("P1 — THE PROPERTY, stated where it can be read: the CONSUMER's floor is correct and still loses the file", () => {
    // This is `syncFromManifest`'s evidence test, with the exact inputs S141
    // produced. It says ALLOW, and it is RIGHT to: it was asked whether the
    // document matches the host's published hash, and it does. Hash agreement
    // is evidence of AGREEMENT, never of CORRECTNESS.
    //
    // It is asserted here and deliberately NOT changed. Hardening it would
    // refuse the legitimate emptying too, which is `S126` — the regression this
    // project already introduced once by tightening a floor at the reader.
    expect(
      decideEmptyWrite({
        incoming: "",
        existing: HOST_TEXT,
        intentional: true, // hashContent("") === entry.hash
        evidenceLabel: "the host's published hash for this path",
      }).decision,
    ).toBe(EMPTY_WRITE_DECISION.ALLOW);

    // ...and told the truth about the same file, the same function refuses.
    expect(
      decideEmptyWrite({
        incoming: "",
        existing: HOST_TEXT,
        intentional: false,
        evidenceLabel: "the host's published hash for this path",
      }).decision,
    ).toBe(EMPTY_WRITE_DECISION.REFUSE_NO_EVIDENCE);
  });

  it("P2 — an empty attestation about a file with bytes is refused", () => {
    const v = decideAttestation({ attestedLength: 0, fileLength: HOST_HASH_LEN });
    expect(v.decision).toBe(ATTESTATION_DECISION.REFUSE_CONTRADICTED);
    expect(v.refused).toBe(true);
    expect(v.reason).toContain(`${HOST_HASH_LEN} unit(s)`);
  });

  it("P3 — an empty attestation about an empty file is published", () => {
    const v = decideAttestation({ attestedLength: 0, fileLength: 0 });
    expect(v.decision).toBe(ATTESTATION_DECISION.PUBLISH_VERIFIED_EMPTY);
    expect(v.refused).toBe(false);
  });

  it("P4 — an empty attestation about an unreadable file is refused", () => {
    const v = decideAttestation({ attestedLength: 0, fileLength: null });
    expect(v.decision).toBe(ATTESTATION_DECISION.REFUSE_UNVERIFIABLE);
    expect(v.refused).toBe(true);
  });

  it("P5 — a non-empty attestation is decided WITHOUT reference to the file, and that ordering is the caller's contract", () => {
    // `updateFile` passes `fileLength: null` for every non-empty publication
    // rather than reading the disk. That is only safe because this branch is
    // taken first: a reordering would turn every ordinary publish into
    // REFUSE_UNVERIFIABLE and stop the product syncing. Pinned here so the
    // reordering cannot happen quietly.
    for (const fileLength of [null, 0, 1, 10_000]) {
      expect(decideAttestation({ attestedLength: 1, fileLength }).decision).toBe(
        ATTESTATION_DECISION.PUBLISH_NOT_EMPTY,
      );
    }
  });

  it("P6 — every branch is a distinct decision, and none of them is silent", () => {
    resetAttestationDecisions();
    const inputs = [
      { attestedLength: 1, fileLength: null },
      { attestedLength: 0, fileLength: 0 },
      { attestedLength: 0, fileLength: 3 },
      { attestedLength: 0, fileLength: null },
    ];
    const seen = new Set(inputs.map((i) => decideAttestation(i).decision));
    expect(seen.size).toBe(4);
  });
});
