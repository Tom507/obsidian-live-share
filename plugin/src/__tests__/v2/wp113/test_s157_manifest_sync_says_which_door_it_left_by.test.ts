// ===========================================================================
// WP113 / PACKAGE C — S157: `syncFromManifest` gives up completely silently,
// twice.
//
// ## A CORRECTION TO THE SIGNAL, MEASURED FROM SOURCE
//
// `S157` describes the second give-up as "a bare `catch` around `waitForSync`".
// IT IS NOT. The `try` wraps the WHOLE body of the text branch: the wait, the
// document read, the empty-write decision (which itself reads the file and
// hashes it), `preserveLocalVersion`, `ensureFolder`, and the `vault.modify` /
// `vault.create`. So "this path threw" could mean a sync timeout OR A FAILED
// WRITE TO THE USER'S DISK, and nothing distinguished them. The repair carries
// a PHASE label rather than narrowing the `try`, which would have changed
// control flow — C3 forbids that.
//
// ## C3 IS THE CONSTRAINT AND IT IS HONOURED
//
// Neither branch's DECISION changes. `getDoc → null` still `continue`s, the
// `catch` still continues with the rest, and `synced` is still what it was.
// WP115 made the OUTCOME of both safe; this package makes them AUDIBLE.
//
// REAL: the relay, both peers' `SyncManager`s and `Y.Doc`s, both
// `ManifestManager`s, the real `syncFromManifest`, the real empty-write floor.
// DOUBLE: the vault and the logger — see `harness.ts`.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MANIFEST_SYNC_OUTCOMES,
  PATH_DISPOSITION,
  PATH_OUTCOME_FACTS,
  getPathOutcomes,
  resetPathOutcomes,
} from "../../../files/path-outcome";
import {
  getEmptyWriteRefusals,
  resetEmptyWriteRefusals,
} from "../../../files/empty-write-guard";
import { findPluginSrc, stripComments } from "../wp83/wp83-source-derivation";
import { SHARE, type Rig, startRig, waitUntil } from "./harness";

const NOTE = `${SHARE}/shared-note.md`;
const HOST_BYTES = "the host's version\n";

function cell(outcome: string): number {
  return getPathOutcomes().byArm[`manifest-sync/${outcome}`] ?? 0;
}

beforeEach(() => {
  resetPathOutcomes();
  resetEmptyWriteRefusals();
});

// ---------------------------------------------------------------------------
// 1. THE SHAPE, FROM SOURCE — the four exits, and the correction to S157.
// ---------------------------------------------------------------------------

describe("S157 — the text branch's exits, enumerated from source", () => {
  const src = stripComments(readFileSync(join(findPluginSrc(), "files", "manifest.ts"), "utf8"));
  const body = (() => {
    const start = src.indexOf("async syncFromManifest(");
    expect(start, "`syncFromManifest` is not in this file").toBeGreaterThan(-1);
    const end = src.indexOf("getLastSyncConflictCopies()", start);
    expect(end, "the end of `syncFromManifest` could not be located").toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it("the `catch` is WIDER than S157 says — it wraps the writes, not just `waitForSync`", () => {
    const tryAt = body.indexOf("let phase =");
    const catchAt = body.indexOf("} catch (err) {");
    expect(tryAt, "the phase label is gone").toBeGreaterThan(-1);
    expect(catchAt, "the bare catch is gone").toBeGreaterThan(tryAt);
    const guarded = body.slice(tryAt, catchAt);
    // Every one of these is INSIDE the `try`. That is the correction.
    for (const statement of [
      "waitForSync(path)",
      "decideEmptyWrite(",
      "preserveLocalVersion(",
      "ensureFolder(",
      "this.vault.modify(",
      "this.vault.create(",
    ]) {
      expect(
        guarded.includes(statement),
        `${statement} is no longer inside the catch — S157's shape has changed`,
      ).toBe(true);
    }
  });

  it("all four exits report, and the closed set is pinned to them", () => {
    const used = new Set(
      [...body.matchAll(/MANIFEST_SYNC_OUTCOMES\.([A-Z_]+)/g)].map((m) => m[1]),
    );
    expect([...Object.keys(MANIFEST_SYNC_OUTCOMES)].filter((d) => !used.has(d))).toEqual([]);
    expect([...used].filter((u) => !(u in MANIFEST_SYNC_OUTCOMES))).toEqual([]);
    expect(Object.keys(PATH_OUTCOME_FACTS["manifest-sync"]).sort()).toEqual(
      Object.values(MANIFEST_SYNC_OUTCOMES).sort(),
    );
  });

  it("C3 — the two give-ups still `continue`; nothing decides differently", () => {
    // The decision is a `continue` in both, and this is what pins it. A `return`
    // or a `throw` appearing here would be a behaviour change smuggled in behind
    // an observability package.
    const noDoc = body.slice(body.indexOf("if (!tempHandle) {"));
    expect(noDoc.slice(0, noDoc.indexOf("}") + 400)).toContain("continue;");
    const caught = body.slice(body.indexOf("} catch (err) {"));
    expect(caught).not.toContain("throw ");
  });
});

// ---------------------------------------------------------------------------
// 2. THE TWO GIVE-UPS, DRIVEN.
// ---------------------------------------------------------------------------

describe("S157 C1/C2 — both give-ups counted and logged, with the path and the exit", () => {
  let rig: Rig;
  beforeEach(async () => {
    rig = await startRig("s157");
  });
  afterEach(async () => {
    await rig.close();
  });

  it("`getDoc → null`: counted, logged, and it still leaves the local bytes alone", async () => {
    // A REAL `ManifestManager` whose `SyncManager` has never been told to
    // connect — the state `getDoc` answers `null` in. The manifest is
    // populated from the host over the real relay FIRST, so the entry exists
    // and the loop genuinely reaches the text branch.
    const host = await rig.peer({ clientId: "host", role: "host", files: { [NOTE]: HOST_BYTES } });
    await host.manifest.publishManifest();

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: { [NOTE]: "the guest's own bytes\n" },
    });
    await waitUntil(() => guest.manifest.getEntries().has(NOTE), { timeout: 5_000 });

    // …and NOW the link goes away, which is what makes `getDoc` answer `null`.
    guest.sync.disconnect();
    const synced = await guest.manifest.syncFromManifest();

    expect(synced, "the pass claimed to have synced something").toBe(0);
    expect(cell(MANIFEST_SYNC_OUTCOMES.NO_DOC), "the give-up was not counted").toBe(1);
    expect(
      getPathOutcomes().byDisposition[PATH_DISPOSITION.RETRYABLE],
      "the give-up was not classified",
    ).toBe(1);
    const lines = guest.logger.outcomes();
    expect(lines.length, "the give-up reached no log").toBe(1);
    expect(lines[0]).toContain("arm=manifest-sync");
    expect(lines[0]).toContain("outcome=no-doc");
    expect(lines[0]).toContain(`path=${NOTE}`);

    // C3 — THE DECISION IS UNCHANGED. The guest's bytes are exactly where they
    // were, which is `S148`'s setup and is precisely what WP115 made safe.
    expect(guest.vault.bytes.get(NOTE), "the give-up wrote something").toBe(
      "the guest's own bytes\n",
    );

  }, 60_000);

  it("the bare `catch`: counted, logged, and it says WHICH STATEMENT threw", async () => {
    const host = await rig.peer({ clientId: "host", role: "host", files: { [NOTE]: HOST_BYTES } });
    await host.manifest.publishManifest();

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: { [NOTE]: "the guest's own bytes\n" },
    });
    await waitUntil(() => guest.manifest.getEntries().has(NOTE), { timeout: 5_000 });
    // The HOST seeds the shared document from its own disk — what
    // `startAll("host")` does at session start. Without it the doc is empty and
    // the `S119` floor would (correctly) refuse, which is a different row.
    await host.bg.subscribe(NOTE);
    // The guest ACQUIRES the document and lets the host's state arrive, but does
    // NOT run `subscribe()` — that arm writes the file itself, and then
    // `syncFromManifest`'s hash test would find nothing to do and the text
    // branch would never be entered at all.
    guest.sync.getDoc(NOTE);
    await waitUntil(
      () => guest.sync.getDoc(NOTE)?.text.toString() === HOST_BYTES,
      { timeout: 5_000 },
    );

    // THE THROW, raised by the vault at the WRITE — the far end of the `try`,
    // and the case S157's own description could not name.
    guest.vault.asVault.modify = async () => {
      throw new Error("EROFS: read-only file system");
    };

    const synced = await guest.manifest.syncFromManifest();
    expect(synced, "the write succeeded — this row is vacuous").toBe(0);
    expect(cell(MANIFEST_SYNC_OUTCOMES.THREW), "the throw was not counted").toBe(1);
    const line = guest.logger.outcomes().find((l) => l.includes("outcome=threw"));
    expect(line, "the throw reached no log").toBeDefined();
    expect(line).toContain(`path=${NOTE}`);
    // THE ATTRIBUTION. Without the phase this reads "something in this path
    // threw", which is the state S148 took two live rounds to get out of.
    expect(line, "the line does not say which statement threw").toContain("phase=writing to disk");
    expect(line).toContain("EROFS: read-only file system");

  }, 60_000);

  it("S155/C2 — the SUCCESS branch is counted, so a zero can only mean 'did not run'", async () => {
    const host = await rig.peer({ clientId: "host", role: "host", files: { [NOTE]: HOST_BYTES } });
    await host.manifest.publishManifest();

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: { [NOTE]: "the guest's own bytes\n" },
    });
    await waitUntil(() => guest.manifest.getEntries().has(NOTE), { timeout: 5_000 });
    // The HOST seeds the shared document from its own disk — what
    // `startAll("host")` does at session start. Without it the doc is empty and
    // the `S119` floor would (correctly) refuse, which is a different row.
    await host.bg.subscribe(NOTE);
    // The guest ACQUIRES the document and lets the host's state arrive, but does
    // NOT run `subscribe()` — that arm writes the file itself, and then
    // `syncFromManifest`'s hash test would find nothing to do and the text
    // branch would never be entered at all.
    guest.sync.getDoc(NOTE);
    await waitUntil(
      () => guest.sync.getDoc(NOTE)?.text.toString() === HOST_BYTES,
      { timeout: 5_000 },
    );

    const synced = await guest.manifest.syncFromManifest();
    expect(synced, "nothing synced — the success branch was not reached").toBe(1);
    expect(cell(MANIFEST_SYNC_OUTCOMES.SYNCED), "the success branch is invisible").toBe(1);
    expect(cell(MANIFEST_SYNC_OUTCOMES.NO_DOC)).toBe(0);
    expect(cell(MANIFEST_SYNC_OUTCOMES.THREW)).toBe(0);
    // …and it is silent, which is the point of counting it rather than logging it.
    expect(guest.logger.outcomes(), "an ordinary success was logged").toEqual([]);
    expect(PATH_OUTCOME_FACTS["manifest-sync"][MANIFEST_SYNC_OUTCOMES.SYNCED].logged).toBe(false);

    // THE POSITIVE CONTROL FOR THE ZERO, and it is the whole of S155: a run in
    // which the arm was NEVER CALLED leaves the ledger empty, not merely
    // give-up-free.
    resetPathOutcomes();
    expect(getPathOutcomes().byArm["manifest-sync/synced"]).toBeUndefined();
    expect(getPathOutcomes().byArm["manifest-sync/no-doc"]).toBeUndefined();

  }, 60_000);

  it("the empty-write refusal is recorded on BOTH ledgers, and they agree", async () => {
    // The `S119` floor's own census is across WRITER ARMS; this arm's census is
    // across THIS FUNCTION'S EXITS. Two independent counters, deliberately, and
    // a disagreement between them is a defect in one of them.
    const host = await rig.peer({ clientId: "host", role: "host", files: { [NOTE]: HOST_BYTES } });
    await host.manifest.publishManifest();

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: { [NOTE]: "the guest's own bytes\n" },
    });
    await waitUntil(() => guest.manifest.getEntries().has(NOTE), { timeout: 5_000 });
    // The doc is acquired but EMPTY — the host's content has not arrived — while
    // the host's published hash says the file is not empty. That is exactly the
    // absence the floor refuses to write.
    guest.sync.getDoc(NOTE);

    const synced = await guest.manifest.syncFromManifest();
    expect(synced, "the write was not refused — this row is vacuous").toBe(0);
    expect(cell(MANIFEST_SYNC_OUTCOMES.EMPTY_WRITE_REFUSED), "this arm's exit was not counted").toBe(
      1,
    );
    expect(
      getEmptyWriteRefusals().byArm["manifest-sync"],
      "the two ledgers disagree about the same refusal",
    ).toBe(1);
    expect(guest.vault.bytes.get(NOTE), "a refusal wrote something").toBe(
      "the guest's own bytes\n",
    );

  }, 60_000);
});
