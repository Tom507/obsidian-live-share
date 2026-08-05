# Implementation Report — WP80: a peer may not purge a manifest it cannot know is complete

**Batch:** B23 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Commits:** `22fc50b` (implementation + AC1 table), plus the report/AC2-branch checkpoint below.

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes.** A user file was DESTROYED on a real vault, on demand, before the gate was live. Run `20260805-044133`, `S2 ORACLE ... present=False`. |
| **Fixed** | The producing side: `publishManifest`'s purge is now a *request*, granted by a pure decision core from facts the peer already holds, and it fails closed. |
| **Positive control** | **Green, with a non-empty deletion.** A complete host still purges (`deleted=[…wp80-pos-…bin]`), and the accepted data-loss control `S2` still passes. |
| **WP80 live E2E** | **24 passed, 0 failed, 0 skipped** (run `20260805-050403`, on the shipped bundle) |
| **Data-loss E2E** | **12 passed, 0 failed, 0 skipped** (run `20260805-045424`) — unchanged |
| **Canvas E2E** | **13/18** — identical to the S30 baseline, before and after |
| **Unit tests** | **2119 passed / 2119 (318 files)**, 43 new; no existing test deleted, weakened, retitled, skipped or amended |
| **Gates** | `npm run build` (tsc + esbuild) **PASS** |
| **Carried up** | one new finding (**S34**), one behavioural trade recorded (**§8**), plus WP81's deferred command **landed** |

---

## 1. What was actually wrong, re-measured (rule 12)

Every line number below was read from the working tree today, after WP37 and WP79 landed.

| site | what was there |
|---|---|
| `files/manifest.ts:189` | `async publishManifest(options?: { purge?: boolean }): Promise<void>` — the caller supplied `purge` as a bare boolean |
| `files/manifest.ts:190` | `if (!this.manifest || !this.docHandle) return;` — a **silent** no-op |
| `files/manifest.ts:192` | entry set built from `getSharedFiles()` — **this peer's own vault** |
| `files/manifest.ts:234-240` | every manifest key the local disk did not account for was **deleted** |
| `main.ts:576` | call site 1 — `resumeSession`, host arm *(charter said `:557`)* |
| `main.ts:815` | call site 2 — `startSession` *(charter said `:796`)* |
| `main.ts:2194` | call site 3 — `promoteToHost`, **the defect** *(charter said `:2053`)* |
| `sync/control-handlers.ts:127` | call site 4 — new-peer republish *(unchanged)* |

**The charter's `main.ts` line numbers had all drifted; the symbols had not.** Resolved by symbol, as instructed.

### The D2 gate does not bound this shape — confirmed, and it is worse than the charter thought

The charter predicted the guest would delete via `cleanupStaleFiles`, whose two evidence
conditions a newly-promoted host satisfies. In the live RED run the file was destroyed
**without `cleanupStaleFiles` being involved at all**:

```
S2 stale-reconcile decision on the demoted peer:
  {"candidates": 0, "ran": true, "reason": "host e9e612b8-… published a manifest of 8 entry/entries
   this session", "trashed": []}
S2 ORACLE: the file a peer could not know about STILL EXISTS on disk
  >>> FAIL   wp80-canary-20260805-044133.bin present=False
```

`candidates: 0` and `trashed: []` because **the file was already gone** by the time the reconcile
ran. `registerManifestChangeHandler` (`main.ts:344-350`) trashes every path in its `actuallyRemoved`
list directly, with **no role guard and no evidence gate**:

```ts
for (const path of actuallyRemoved) {
  this.backgroundSync.onFileRemoved(path);
  const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
  if (file) await this.app.fileManager.trashFile(file);
}
```

So the truncated purge does not merely *pass* the D2 gate — **the D2 gate is not on the path.**
A manifest entry deletion is a file deletion for every peer holding the manifest, host or guest.
That makes WP80 not "the last live route" but the **only** guard on this route. Recorded as **S34**
(§9). It also means the *host* destroys its own file, which is why the AC3 oracle is the original
host's disk.

---

## 2. What was built

### 2.1 `plugin/src/files/manifest-purge-decision.ts` — NEW, the pure core

Zero imports. No Obsidian, no filesystem, no clock, no Yjs — the `canvas-seed-decision.ts` /
`canvas-mirror-decision.ts` precedent. Exported, stateless between calls, does not mutate its
argument, never throws.

Closed verdict set: **`purge` · `additive` · `nothing-to-publish`**.

Completeness has **two independent witnesses**, either sufficient:

```
├── OWN MANIFEST  — this peer entered the session as host AND no other peer has published
│                   this manifest since it connected. Its disk was never populated from
│                   somebody else's manifest and nobody else has spoken since, so its local
│                   set is the room's truth. (call sites 1, 2, and 4-on-an-original-host)
└── ACCOUNTED     — every key the manifest carries is present in the local set, so a purge
                    cannot be wrong about anything it does not already hold.
```

Everything else — and **every unknown** — is `additive`, on the `!== true` / `!== false`
discipline `decideSeed` states in its own header.

**Two spellings deliberately rejected, both measured:**

- **NOT "the attestation currently in the doc is mine."** A peer promoted mid-sync publishes once
  additively and thereby stamps its *own* id into the attestation — that test would grant the very
  next publication a purge and re-open the hole **one republish later**. Pinned by the test
  *"the same peer AFTER its first additive publication still refuses"*.
- **NOT "the attestation I found on arrival was somebody else's."** This was implemented first and
  **measured wrong on the live rig**: seeding the foreign flag from the *replayed* attestation
  disabled the host's own deletion propagation for a whole session after a single role flip, and the
  positive control went red (run `20260805-044311`, S1 `verdict=additive`). A replayed attestation is
  the room's persistence, not a live peer talking over us — the line D2 already draws with
  `seqAtConnect`. Rescoped to `hasFreshPublication(ownId)`, latched. **This is a lobotomy AC4 caught,
  exactly as the charter said it would.**

### 2.2 `plugin/src/files/manifest.ts`

- `publishManifest` returns `ManifestPublishDecision` instead of `void`; the `:190` early return is a
  **named refusal** (`nothing-to-publish`) with a stated reason.
- Owns the three facts the decision turns on so `main.ts` gains no conditional:
  `roleAtConnect` (captured in `connect()` **before** the awaits, because a `join-response` can
  promote this peer mid-call), `manifestSynced` (set after `waitForSync`), and
  `foreignPublicationSinceConnect` (latched, via D2's own `hasFreshPublication`, not a re-derivation).
- **S28 repaired as an input constraint:** per-file read failures are now *counted*, and any
  `readFailures !== 0` disqualifies the purge — a transient IO error can no longer present as a
  deletion.
- Purge keys are collected before deletion rather than deleted while iterating the `Y.Map` key
  iterator.
- `getLastPublishDecision()` for the instrument.
- **The attestation still rides the entries' transaction, unchanged** (`publishedAt` remains
  diagnostics-only). Pinned by a test asserting exactly one `afterTransaction` on an additive publish.

### 2.3 `plugin/src/types.ts`

`ManifestPublishDecision` added **at the top of the file, beside `StaleReconcileDecision`** — above
`DEFAULT_SETTINGS`, so the WP22 comment-strip trap cannot fire. `DEFAULT_SETTINGS` untouched; the
wp22 dormancy tests are green.

### 2.4 `main.ts` and `sync/control-handlers.ts` — CALLS ONLY

Each of the four sites `await`s the decision and passes it to one log helper
(`logPublishDecision`, main.ts). **No conditional over manifest or sync state was written in either
file.** The helper contains no branch at all — it formats and logs what it was handed.
`promoteToHost`'s doc comment, which asserted the hazard was "bounded on the consuming side", is
corrected in place rather than left to mislead the next reader.

### 2.5 `plugin/src/testing/e2e-control.ts` — additive, plus one corrected literal

| command | status |
|---|---|
| `manifest.publish` | **corrected.** Was `await mm.publishManifest({purge:true}); return {published:true}` — a literal. Now returns the real decision, unaltered. Its two refusal branches return the same *shape* with a stated reason instead of a bare `{published:false, reason}`. |
| `manifest.lastPublish` | **NEW, additive.** Read-only; the decision the most recent REAL publication produced. The only way to observe the four production call sites *separately*, since none is reachable from the rig without re-triggering it. |
| `session.promoteToHost` | **NEW, additive.** Invokes the real `plugin.promoteToHost` and returns the decision that promotion produced, read back from the manager. |
| `session.demoteToGuest` | **NEW, additive.** Invokes the real `plugin.demoteToGuest`. |
| `plugin.sinkState` | **NEW — WP81's deferred case body, landed.** See §7. |

All optional on the host interface, on the `canvasFile` / `clearFlags` precedent, so pre-existing
fake hosts stay valid. **No existing command's shape or behaviour changed** beyond the one corrected
literal. `ManifestPublishDecision` is mirrored structurally rather than imported, exactly as the D2
batch mirrored `StaleReconcileDecision`, because `../types` is not on the frozen import allow-list —
and `tsc` still checks the mirror against the real return type at the `buildPluginHost` call site.

---

## 3. AC-by-AC

### AC1 — the verdict is taken by a pure core, it is a closed set, and it fails closed ✅

`plugin/src/__tests__/manifest-purge-decision.test.ts`, **39 tests, all green**, run
`04:52:57`. The executed table, row by row:

**Licensed rows**

| row | verdict |
|---|---|
| entered as host, no foreign publication since connect | `purge` |
| entered as host, empty room (`startSession`) | `purge` |
| entered as **guest**, every manifest entry accounted for | `purge` |
| a **replayed** foreign attestation, entered as host | `purge` — the room's persistence is not a live peer |

**The defect row and its neighbours**

| row | verdict |
|---|---|
| **promoted mid-sync, entries unaccounted** | `additive` |
| the same peer *after* its own first additive publication | `additive` (sticky flag) |
| host-origin peer that has seen a foreign publication since connect | `additive` |

**Each conjunct removed individually** — one flipped field of the licensed baseline per row:

| flipped | verdict |
|---|---|
| `manifestConnected: false` | `nothing-to-publish` |
| `manifestSynced: false` | `additive` |
| `isHost: false` | `additive` |
| `purgeRequested: false` | `additive` |
| `readFailures: 1` | `additive` |
| `enteredSessionAsHost: false` | `additive` |
| `foreignPublicationSinceConnect: true` | `additive` |

**Every unknown-input row, asserted individually — never `purge`:**
`manifestSynced` {undefined, null, `1`} · `isHost` {undefined, `"host"`} ·
`enteredSessionAsHost` {undefined, `1`} · `purgeRequested` undefined ·
`foreignPublicationSinceConnect` {undefined, null, `0`} · `readFailures` {undefined, `NaN`, `"0"`} ·
`manifestPaths` {undefined, non-array, array holding a non-string} · `localPaths` {undefined,
non-array} · a `null` knowledge object · a non-object probe · `{}` (→ `nothing-to-publish`).

Plus the pure-core contract: does not mutate its argument · stateless between calls · **no branch
returns an empty reason**.

### AC2 — `publishManifest` reports what it did, and the silent no-op is gone ✅

Live, both instances, run `20260805-050403`. Every field read from the real call:

```
S1 (grant):    {"verdict":"purge","published":true,"purged":true,"entries":8,
                "deleted":["_liveshare-test/wp80-pos-20260805-050403.bin"],
                "unaccounted":["_liveshare-test/wp80-pos-20260805-050403.bin"],
                "reason":"this peer entered the session as host and no other peer has published
                          this manifest since it connected, so its local set is the room's truth"}

S2 (refusal):  {"verdict":"additive","published":true,"purged":false,"entries":8,
                "deleted":[],
                "unaccounted":["_liveshare-test/wp80-canary-20260805-050403.bin"],
                "reason":"1 manifest entry is not accounted for locally, and this peer did not enter
                          the session as host, so it cannot know whether they were deleted or have
                          simply not arrived yet"}

S3 (not host): {"verdict":"additive","published":false,"purged":false,"entries":0,
                "deleted":[],"unaccounted":[],
                "reason":"this peer is not the host; only a host publishes a manifest"}
```

**The deleted-key list changes with the scenario** — non-empty and named in S1, empty in S2 — so a
constant does not satisfy the oracle.

**Before/after `manifest.info.paths` on both instances:** S1's orphan disappears from both
(`S1: the entry is gone from BOTH manifests` — PASS); S2's canary survives on both
(`S2: the canary's manifest entry survives on BOTH instances` — PASS). The deleted set is exactly
the difference.

**The `manifest.ts:190` refusal.** Not reachable on demand from the live rig — the manifest is
connected for the whole session. Covered against the **real method** in
`manifest-publish-decision-branches.test.ts` (4 tests, green): a `ManifestManager` on which
`connect()` was never called returns
`{verdict:"nothing-to-publish", published:false, purged:false, reason:<non-empty>}` and that decision
is readable afterwards through `getLastPublishDecision()`. Stated plainly: **this one branch is
evidenced headlessly, not live.**

### AC3 — a peer promoted before its initial sync completes does not delete another peer's file ✅

**Suite:** `H:\tmp\liveshare_wp80_e2e.py`, scenario `[S2]`. Idempotent: per-run ids, a sweep of
previous runs at preflight and at teardown, set comparison, roles restored, SKIP recorded as SKIP.

**How the precondition is constructed deterministically.** A `.md` created on the host reaches the
other vault in **≤1 s** (measured), so racing it is not deterministic; and a guest-side delete is
*not* a way in, because a guest's delete op propagates and the host then removes the manifest entry
(measured — the entry vanished from both). A **4 MB binary** does it reliably: its manifest entry
lands over Yjs in **~0.12 s** while the content still has to be requested in chunks — measured window
**>60 s**. That is the same state a mid-`syncFromManifest` peer is in, held open long enough to act
in. **The promotion itself is the real `plugin.promoteToHost`** — the single implementation both
`join-response` and `host-transfer-complete` route through. Only the *server's delivery* of the
verdict is replaced, because the relay's election is a coin flip (S27) and a restart scenario is a
lottery.

**The recorded precondition** (measured immediately before the publication, not assumed):

```
guest manifest: 9 entr(y|ies)
guest disk:     8 file(s)
NOT on the guest's disk: ['_liveshare-test/wp80-canary-20260805-050403.bin']
PASS  S2 PRECONDITION (recorded): the guest's local set is a STRICT SUBSET of the manifest it
      holds, and the canary is in the difference
PASS  S2 precondition: the canary file is on the host's disk
```

It is recorded a **second** time by the product itself: the decision's `unaccounted` list is computed
inside `publishManifest`, atomically with the publication.

**RED — the pre-repair build, run `20260805-044133`.** The identical scenario, on the same two
instances, with the decision core **disabled at its seam** (a temporary edit returning `purge`
whenever a purge is requested and a manifest is connected — the pre-repair behaviour of
`manifest.ts:234`). This is also AC5's seam-disable discriminator. *Which bundle:* the WP80 bundle
with the instruments present and the gate neutered, built with `npm run build:e2e` and installed with
`liveshare_e2e_install.py`. A true parent-commit bundle cannot run this scenario at all — the
promotion command does not exist there — so a seam-disabled build is the only way to run the
**identical** scenario, and it isolates the change to one function.

```
S2 publication decision (from the REAL promotion):
  {"deleted":["_liveshare-test/wp80-canary-20260805-044133.bin"], "entries":8, "purged":true,
   "verdict":"purge", "reason":"SEAM DISABLED: pre-repair behaviour"}
>>> FAIL  S2: the promoted mid-sync peer published ADDITIVELY    verdict=purge purged=True
>>> FAIL  S2: it deleted NOTHING
>>> FAIL  S2: the canary's manifest entry survives on BOTH instances
>>> FAIL  S2 ORACLE: the file a peer could not know about STILL EXISTS on disk
          wp80-canary-20260805-044133.bin present=False
RESULT: 20 passed, 4 failed, 0 skipped
```

**A real file, on a real vault, destroyed by a correct promotion.**

**GREEN — the shipped bundle, run `20260805-050403`:**

```
S2 publication decision (from the REAL promotion):
  {"deleted":[], "entries":8, "published":true, "purged":false, "verdict":"additive",
   "unaccounted":["_liveshare-test/wp80-canary-20260805-050403.bin"],
   "reason":"1 manifest entry is not accounted for locally, and this peer did not enter the
             session as host, …"}
PASS  S2: the promoted mid-sync peer published ADDITIVELY
PASS  S2: with a stated reason naming what it could not account for
PASS  S2: it deleted NOTHING
PASS  S2: I11 — the refusal was of the DELETION, not of the publication  published=True entries=8
PASS  S2: the canary's manifest entry survives on BOTH instances
PASS  S2: the reconcile trashed nothing
PASS  S2 ORACLE: the file a peer could not know about STILL EXISTS on disk   present=True
```

**File-system state, both vaults:** before — host 9 files / guest 8 (the canary is host-only by
construction); after — unchanged, and teardown confirms
`P9: both shared folders are back to the preflight file set   A: []  B: []` (symmetric difference
empty on both).

### AC4 — a host that IS complete still purges ⚠️ green, with two honest deviations

**The S2-shaped positive control, live, with a NON-EMPTY deletion** (`[S1]`, run
`20260805-050403`). The orphan entry is created without a restart: the host publishes a file, is
demoted, the file is deleted from disk — a **guest** does not remove manifest entries
(`vault-events.ts:175` gates `removeFile` on `role === "host"`) — and the peer is then re-promoted.

```
PASS  S1 precondition: the manifest still lists a file no peer holds on disk
      manifest=True hostDisk=False guestDisk=False
S1 publication decision: {"verdict":"purge","purged":true,
      "deleted":["_liveshare-test/wp80-pos-20260805-050403.bin"], …}
PASS  S1: the complete host was GRANTED the purge
PASS  S1: and the deleted-key list is NON-EMPTY and names the orphan
PASS  S1: the entry is gone from BOTH manifests
```

**And the accepted positive control of the consuming-side fix still passes unchanged** —
`H:\tmp\liveshare_dataloss_e2e.py`, run `20260805-045424`, **12 passed / 0 failed / 0 skipped**,
including `[S2] a live host's fresh manifest still deletes (the fix is not a lobotomy)` →
`guest_copy_present=False`. That is the same instrument the consuming-side fix was accepted on.

**Per call site, separately** (the four differ in what the peer knows when they fire, which is the
subject of this WP; each read from `manifest.lastPublish`, i.e. the decision the *production* call
produced, not one the rig triggered):

| # | site | observed decision | deleted |
|---|---|---|---|
| 1 | `resumeSession` host arm | `purge` — *"entered the session as host and no other peer has published this manifest since it connected"* | `[]` this run; **non-empty** in the dataloss `[S2]` restart, where the offline-deleted file's entry is removed and the guest trashes its copy |
| 2 | `startSession` | not exercised live — creating a room needs a UI action the rig cannot drive. Covered by AC1's *"entered as host, empty room"* row and by the same witness-1 branch site 1 exercises. **Stated as not-live.** |
| 3 | `promoteToHost` | mid-sync → `additive` (AC3); complete → `purge`, observed at startup on the promoted peer: *"every entry the manifest carries is accounted for locally"* | `[]` |
| 4 | new-peer republish | `purge` on an original host (witness 1); `additive` on a promoted one — same decision as site 3, by construction | `[]` |

**Two deviations, stated rather than buried:**

1. **AC4's "each of the four call sites … with a non-empty deleted-key list" is unsatisfiable for
   site 3, by construction of the fix.** A peer promoted mid-sync may only purge once it accounts for
   the whole manifest — and "accounts for the whole manifest" *means* there is nothing to delete. A
   non-empty deletion from site 3 is precisely the outcome this WP exists to prevent. The honest
   alternative implemented: site 3 purges when complete (deleting nothing) and refuses when not, and
   both branches are shown.
2. **Site 2 was not driven live** (see the table). Not a rig defect — `startSession` needs a UI
   action, and the rig has no command for it. Not added, because inventing a session-creation command
   to satisfy a criterion is how a rig ends up agreeing with itself.

### AC5 — the instrument exists, reports measured facts, and `manifest.publish` stops returning a literal ✅

- `manifest.publish` publishes through the **real** `ManifestManager.publishManifest` and returns its
  decision **unaltered** (`return mm.publishManifest({ purge: true })` — no field is composed in the
  E2E layer). The hardcoded `{published:true}` is gone.
- `manifest.lastPublish` is the additive command; read-only, and it returns what the *production*
  call sites decided.
- **Failure case 1 — not host:** exercised live (`[S3]`). HTTP `ok:true` with a structured refusal
  carrying a reason, not a success and not a thrown 400.
- **Failure case 2 — manifest not connected:** exercised against the real method headlessly
  (`nothing-to-publish` + reason), because the live session never enters that state on demand.
  Stated, not glossed.
- **Seam-disable discriminator:** disabling the core changed the **command's** answer —
  `verdict:"purge"` / `purged:true` / `deleted:[canary]` on the disabled build versus
  `verdict:"additive"` / `purged:false` / `deleted:[]` on the live one, same scenario, same
  instances. The command reflects the core.

---

## 4. Suite numbers, all measured

| suite | command | result |
|---|---|---|
| plugin unit | `npx vitest run` (from `plugin/`) | **2119 passed / 2119, 318 files** |
| plugin unit, before this WP's tests | same, mid-batch | 2076 / 2076, 316 files — **+43 tests, all new; no existing count moved** |
| build gate | `npm run build` | **PASS** (tsc `-noEmit -skipLibCheck` + esbuild production) |
| WP80 live E2E | `python H:\tmp\liveshare_wp80_e2e.py` | **24 passed, 0 failed, 0 skipped** (`20260805-050403`) |
| WP80 live E2E, seam disabled | same | **20 passed, 4 failed, 0 skipped** (`20260805-044133`) — the RED |
| data-loss E2E | `python H:\tmp\liveshare_dataloss_e2e.py` | **12 passed, 0 failed, 0 skipped** (`20260805-045424`) |
| canvas E2E | `python H:\tmp\liveshare_e2e.py` | **13/18** — identical to the S30 baseline; the 5 failures are S30's, not this WP's |

**Production bundle check:** `grep -c e2e-control plugin/main.js` → **0**. The testing module is
still dead-code-eliminated.

---

## 5. Constraint compliance — each one stated, none left implicit

- **No `server/**` file was modified.** `git status --porcelain` shows no path under `server/`.
- **The D2 consuming-side gate is byte-unchanged.** `cleanupStaleFiles` (`main.ts:679-731` at charter
  time), `hasFreshPublication` (`manifest.ts:170-176`), the `manifest.size === 0` floor,
  `armStaleReconcileRetry` and the absence of a reconcile in `demoteToGuest` all keep their exact
  behaviour. `git diff` on `main.ts` touches only the three call sites, the `promoteToHost` doc
  comment, one import line and the new `logPublishDecision` helper.
- **`plugin/src/__tests__/dataloss/**` is untouched.** Not deleted, weakened, retitled, skipped or
  amended; all 9 tests green.
- **`main.ts` and `control-handlers.ts` received calls only.** No conditional over manifest or sync
  state was written in either.
- **The new interface sits at the top of `types.ts`**, above `DEFAULT_SETTINGS`. wp22 dormancy tests
  green.
- **No clock gates anything.** `publishedAt` is written for diagnostics and read by nothing; there is
  no sleep, no debounce, no timestamp comparison in the decision path. Freshness is `seq`.
- **The attestation still rides the entries' transaction** — asserted, not assumed (exactly one
  `afterTransaction` per publication).
- **No §7 licence of any class was taken; no `DONE` work package was re-opened.**
- **No new runtime dependency.** `package.json` untouched.
- **`useCanvasBinding` is still `false`.** Plugin version not bumped. `plugin/manifest.json` (a broken
  symlink) not read or edited. `BUILD_SPEC_CanvasV2.md` not edited.
- **`canvas.simulateEdit` was not called** by any scenario in this WP.
- **Data safety.** Ports contacted: `39431` (vault A) and `39432` (vault B). **No `data.json` value
  was read, printed, logged, fixtured or named.** No owner-vault file content was read into an
  artefact or hashed into this report; the only vault files created were this run's own `wp80-*`
  canaries, swept at teardown. `sharedFolder` remained `_liveshare-test` in both vaults and was never
  set empty. No `.bak` file was touched; `obsidian-git` left disabled; the vault registry untouched.
  For the WP81 live check, only the debug log's **byte length** was read — never its contents.

---

## 6. What was destroyed, and what was restored

The RED run trashed exactly one file — this run's own 4 MB canary — to the Windows Recycle Bin, on
the vault that was host. Nothing else. Both suites' teardowns confirmed both shared folders returned
to their preflight file sets (`symmetric difference: A: []  B: []`) on every run, RED and GREEN.
Obsidian was restarted several times by `liveshare_e2e_install.py`; the final state is both instances
live, exactly one host, `pluginBuild 0.6.1+e2e`.

---

## 7. WP81's deferred command — LANDED

`ImplementationReport_WP81.md` §7 deferred AC1's `routeCommand` case because WP37 owned
`e2e-control.ts` that batch. This WP touched that file, so it landed the case:
`plugin.sinkState` → `plugin.logger.getSinkState()`, the logger's own accessor invoked, on the
optional-host-method precedent. No existing command changed shape.

**WP81 AC1's live observable, now evidenced** (both vaults, 2026-08-05):

```
host port 39432: reported path exists=True bytes=894276 linesWritten=19
after two REAL role transitions: bytes=895344 (+1068) linesWritten=27 (+8) lastWriteOk=True
WP81 AC1 live: the file at the REPORTED path grew and linesWritten advanced by the same act: True
```

Both vaults answer `plugin.sinkState` with `enabled:true`, `lastWriteOk:true`, `failureCount:0`,
`linesDropped:0`. **This also retires `ImplementationReport_DataLossChain.md` §8 finding 5** ("the
plugin debug log stopped writing"): it is writing, on both vaults, and the sink now says so.
WP81 AC6's live restart observable is **not** covered here — it is WP81's, and this WP only unblocked
it.

---

## 8. The behavioural trade this fix makes — stated, not hidden

A purge is now refused when a host cannot establish completeness. The cost, in the one shape where
it bites:

**If another peer publishes during our session and our local set does not account for every manifest
entry, we stop purging for the rest of that session.** A file deleted on the host while the other
peer was away may then linger as a manifest entry until a later session in which the host has
own-manifest standing. Ordinary deletions are unaffected — they propagate through
`vault-events` → `removeFile`, not through the purge; the purge only reconciles deletions nobody was
watching.

This is the asymmetry the charter fixes as a ruling: a stale entry is visible and self-correcting;
a purge without completeness trashes a user's file. Recorded so it is not rediscovered as a defect.

---

## 9. Found and NOT fixed

| # | Finding | Why not fixed here |
|---|---|---|
| **S34** | **A manifest entry deletion is an unguarded file deletion for every peer, host or guest.** `registerManifestChangeHandler` (`main.ts:344-350`) trashes every path in `actuallyRemoved` with no role guard and no evidence gate — this, not `cleanupStaleFiles`, is what destroyed the file in the RED run (`candidates:0, trashed:[]` on the reconcile, file already gone). The D2 gate is not merely insufficient for this shape; **it is not on the path.** | Out of WP80's scope, which is the producing side. WP80 makes the *entry* deletion not happen; it does not add a gate to the consumer of entry deletions. **Needs its own WP.** Owner: none assigned. |
| **S25** | Host identity is unstable across restarts (`server/src/control-handler.ts:588`). Observed on every restart in this run — A→B→A→B. | `server/**` is a §7 abort criterion outside WP41. WP80 makes each churn cycle harmless; it does not stop it. Unchanged from the charter. |
| **S26** | The `isSharedPath` prefix-match question still has two contradictory verdicts. | WP80 depends on neither and settles neither. Unchanged. |
| **S27** | The relay's host election is a coin flip, and **which** peer is host after a restart also decides whether that peer has own-manifest standing. The WP80 suite therefore asks the product (`manifest.lastPublish`'s reason) and records a SKIP rather than a FAIL when the draw is unfavourable. Four restarts were needed to draw a host-origin host for the final run. | Not WP80's; the suite is designed around it. |
| **S28** | A per-file read failure omitting a file from the entry set. | **Partially repaired**: it can no longer cause a deletion (any read failure disqualifies the purge). The read path itself is untouched, as the charter scoped it. |
| **S30** | Canvas E2E at 13/18. | Measured identical before and after; not this WP's. Dispatcher is investigating. |

---

## 10. Files changed

| File | Change |
|---|---|
| `plugin/src/files/manifest-purge-decision.ts` | **new** — the pure decision core |
| `plugin/src/files/manifest.ts` | decision returned; named refusal at the early return; `roleAtConnect` / `manifestSynced` / `foreignPublicationSinceConnect`; read-failure counting; `getLastPublishDecision` |
| `plugin/src/types.ts` | `ManifestPublishDecision`, at the top |
| `plugin/src/main.ts` | wiring at 3 call sites + `logPublishDecision`; corrected `promoteToHost` doc comment |
| `plugin/src/sync/control-handlers.ts` | wiring at the 4th call site |
| `plugin/src/testing/e2e-control.ts` | `manifest.publish` literal corrected; `manifest.lastPublish`, `session.promoteToHost`, `session.demoteToGuest`, `plugin.sinkState` (WP81's) added |
| `plugin/src/__tests__/manifest-purge-decision.test.ts` | **new** — 39 tests, AC1's table |
| `plugin/src/__tests__/manifest-publish-decision-branches.test.ts` | **new** — 4 tests, AC2's branches on the real method |
| `H:\tmp\liveshare_wp80_e2e.py` | **new** — the live suite, idempotent |

No `server/**` edits. No `.bak` files touched. `BUILD_SPEC_CanvasV2.md` not edited.
`WORKFLOW_ANALYSIS.md` left unstaged and untouched.
