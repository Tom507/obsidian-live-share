# Implementation Report — WP86: a manifest entry disappearing is not a licence to destroy a local file

**Batch:** B28 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions` · **Baseline commit:** `d7eda85`

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes, both destructive shapes, on two live Obsidian instances.** Producer 5 destroyed a **folder and the file inside it on BOTH vaults** (run `20260805-055139`). The WP80 shape destroyed a 4 MB canary on the peer that held it (`present=False`). |
| **Did producer 5 reproduce AS TRACED?** | **It reproduced, and the trace's MECHANISM is CORRECTED.** It does not reach the rename arm at all — see §3. The outcome that occurred is the worse of the two the charter named: `trashFile` on a `TFolder`. |
| **Fixed** | `registerManifestChangeHandler` no longer holds a trash sink at all. A vanished key with a local **file** behind it is **delegated** to the landed, gated `cleanupStaleFiles`; a vanished key with a **folder** behind it is refused by name. The rename arm now requires a **content-identity pair**. |
| **Positive control** | **Green, on both routes.** Op route: the guest's file set shrank by the named path. Gated route: the inherited `liveshare_dataloss_e2e.py` `[S2]` *"a live host's fresh manifest still deletes (the fix is not a lobotomy)"* → `guest_copy_present=False`, **12 passed / 0 failed / 0 skipped, unamended**. The manifest route's own `destroyed` set is **non-empty and named** when the evidence holds. |
| **WP86 live E2E** | RED **31 passed / 7 failed** → GREEN **38 passed / 0 failed / 4 skipped** (shipped bundle, run `20260805-060448`) |
| **Data-loss E2E** | **12 passed / 0 failed / 0 skipped** (run `20260805-060633`) — unchanged, unamended |
| **Canvas E2E** | **13/18** — identical to the S30 baseline WP80 recorded, same five failures, not this WP's |
| **Unit tests** | **2157 / 2157** with WP86 vs **2136 / 2136** at `d7eda85` — **+21 tests in 2 new files, no existing test moved, deleted, weakened, retitled, skipped or amended** |
| **Gates** | `npm run build` (tsc `-noEmit -skipLibCheck` + esbuild production) **PASS**, exit 0 |
| **§7 licence** | **None of any class taken. No `DONE` work package re-opened. No inherited assertion reddened.** |
| **Carried up** | four findings, §9 — one of them corrects this charter's own trace, one is a measured behavioural trade |

---

## 1. What was built

### 1.1 `plugin/src/files/manifest-removal-decision.ts` — NEW, the pure core

Zero imports. No Obsidian, no filesystem, no clock, no Yjs — the
`manifest-purge-decision.ts` / `canvas-seed-decision.ts` precedent. Two closed verdict sets:

```
decideManifestRemoval → nothing-to-destroy · refused · delegated
decideManifestRename  → rename · refused
```

**`delegated` is not a destructive verdict.** This core has **no destructive branch at all**: the
strongest thing it can say is *"hand this to the route that owns the evidence gate"*. That is why
every unknown input is safe by construction rather than by an audited branch list.

**No third predicate is authored.** The core does not ask *"was that host complete?"* — unanswerable
on the consuming side, which is why WP80 had to be producer-side — and it does not re-derive D2's
evidence gate. `role`, `hasFreshPublication`, the live-host claim and the `manifest.size === 0`
floor are consulted **only** by `cleanupStaleFiles`, which is byte-unchanged.

### 1.2 `plugin/src/main.ts` — `registerManifestChangeHandler` only

| before | after |
|---|---|
| `const file = getAbstractFileByPath(...); if (file) await fileManager.trashFile(file);` — no role guard, no evidence gate, no completeness check, no `instanceof TFile` | **the sink is gone.** `backgroundSync.onFileRemoved` still runs for every key (I11: memory-only, verified at `background-sync.ts`); a **file** behind a vanished key is `delegated` and, once per pass, `cleanupStaleFiles()` is called; a **folder** is refused by name |
| `orderedAdded = added` when `matchRenamesByHash` found no pair → the first arbitrary added key is taken and `vault.rename` moves the user's file onto it | the destructive half accepts **only** `preferred === newPath` (an equal content hash) **and** an `instanceof TFile` at the old path. The non-destructive `!oldFile && newFile` bookkeeping branch is left exactly as it was |
| `Notice: removed N file(s)` counted paths nobody had decided about | the notice counts what was **actually** destroyed |
| one `.catch` logging a line was the only trace of a pass that aborted mid-way | the pass records `aborted` + `error` as **state**, then rethrows into the same `.catch` |

The handler body was extracted verbatim into `processManifestChange(...)` so the disposition can be
recorded in a `finally`. **The intra-handler order is unchanged** (rename arm → `syncFromManifest` →
removals → binary re-requests → `armCanvasMirrorPass`).

### 1.3 `plugin/src/types.ts` — `ManifestChangeDisposition`, **at the top**

Beside `StaleReconcileDecision` and `ManifestPublishDecision`, **above `DEFAULT_SETTINGS`**, so the
WP22 comment-strip trap cannot fire. `DEFAULT_SETTINGS` untouched; the wp22 dormancy tests are green.

### 1.4 `plugin/src/testing/e2e-control.ts` — **one** additive, read-only command

`manifest.lastChange` → `plugin.getLastManifestChangeDisposition()`, returning
`{ latest, recent[] }`. **The licence in §5 of the charter is taken, and it was necessary**: no
landed command can observe this route, and AC6 forbids a log line as the oracle. It triggers
nothing — the route runs on a `Y.Map` observer, there is nothing to re-ask — and **no field is
composed in the E2E layer**; the object is produced by the production handler.

**Why a bounded history rather than one slot:** the passes are queued, and several ran between two
reads in the very first RED run — the refusing pass was overwritten before it could be read. A
single "last" slot would have re-created the silence one level up. 110 insertions, **0 deletions**;
no existing command's shape or behaviour changed. `ManifestChangeDisposition` is mirrored
structurally (`../types` is not on the frozen import allow-list), and `tsc` checks the mirror
against the real return type at the `buildPluginHost` call site.

---

## 2. AC1 — the census, derived from the tree, with its positive control ✅

`plugin/src/__tests__/v2/wp86/test_tp01_vanished_key_sink_census.test.ts`, **8 tests, green**.

The census is derived by extracting the body of each manifest-reachable function from
`plugin/src/` and matching a destructive-sink pattern against it. **The executed table:**

| # | file | function | sink | route | disposition | gate |
|---|---|---|---|---|---|---|
| 1 | `main.ts` | `processManifestChange` | `vault.rename(` | **R2** — the rename-pairing arm | **gated** | `decideManifestRename`: a content-identity pair from `matchRenamesByHash` (`preferred === newPath`), a `TFile` at the removed path, a free target |
| 2 | `main.ts` | `cleanupStaleFiles` | `fileManager.trashFile(` | **R3/R4** — the stale reconcile | **gated** | the D2 evidence gate: host refusal, `hasFreshPublication` excluding self past `seqAtConnect`, a peer present claiming host, D3's `manifest.size === 0` floor |
| 3 | `files/manifest.ts` | `syncFromManifest` | `vault.modify(` | **R5** — the presence-driven overwrite | **out of scope, explicitly** | driven by an entry's PRESENCE and hash difference, not by an absence. Adjacent to WP83/WP85. Recorded, not repaired. Owner: none assigned |

**R1's sink no longer appears** — `tp01d` asserts `fileManager.trashFile(` is absent from
`processManifestChange` and that `this.cleanupStaleFiles()` is present in its place.

**Positive control (`tp01e`)**: a `trashFile` call injected into the handler's source text is
detected as an unpinned site. **Rule 15 (`tp01f`)**: the sink pattern is shown to match all seven
known-present destructive spellings and *not* to match `getAbstractFileByPath`. **`tp01g`**: the
body extractor finds the three known bodies and throws on an unknown name — it was fixed after it
silently found *nothing* in `syncFromManifest`, because a type literal in the signature
(`options?: { skipText?: boolean }`) is a `{` that is not the body. A deriver that looks in the
wrong place returns an empty census, which is the exact failure mode this AC exists to prevent.
**`tp01h`**: the file-op delete route is shown to contain **no** manifest reference at all, with the
pattern first shown able to match a known-present one in `main.ts`.

---

## 3. AC3 — producer 5. RED first, and the trace is CORRECTED ⚠️✅

### 3.1 RED — run `20260805-055139`, seam-disabled build, roles **A resumed as host, B as guest**

**Precondition, recorded before the act:**

```
PASS  S1 PRECONDITION (recorded): the DIRECTORY entry is in the manifest on BOTH instances
      _liveshare-test/wp86-dir-20260805-055139 host=True guest=True
PASS  S1 PRECONDITION (recorded): the guest MATERIALISED the folder on disk
```

The act: a `.md` created inside the shared folder (**a `.md`, not a `.canvas`** — WP83 was live in
`file-ops.ts`). `updateFile` retires the parent directory key.

```
PASS  S1 ENTRY-INTO-THE-ROUTE CONTROL: the directory key MEASURABLY DISAPPEARED from
      manifest.info.paths on BOTH instances
      hostBefore=True guestBefore=True hostAfter=False guestAfter=False
>>> FAIL  S1 ORACLE: the guest still HAS the folder     wp86-dir-20260805-055139 present=False
>>> FAIL  S1 ORACLE: and everything that was inside it  keeper.md present=False
>>> FAIL  S1 ORACLE: the HOST still has the folder too  wp86-dir-20260805-055139 present=False
```

**A real folder, on two real vaults, destroyed with its contents, by a manifest key that was retired
for bookkeeping.** Directory listings taken immediately afterwards confirm both vaults were back to
exactly the eight baseline files, with the folder and `keeper.md` gone to the Recycle Bin.

### 3.2 Which of the two outcomes occurred, and the correction to the trace

**Measured: `trashFile` on the `TFolder`. The folder-renamed-into-itself throw did NOT occur, and it
cannot** — and the reason is a correction to §3 Verification 2 of the charter, not a detail.

The charter traces step 3 as *"one `Y.Map` event with `removed=[folder]` and
`added=[folder/file.md]`"*, which is what puts producer 5 into the R2 rename branch. **It is two
events.** `ManifestManager.updateFile` (`manifest.ts:557-566`) does:

```ts
if (parentEntry?.directory) this.manifest.delete(parentDir);   // transaction 1
const previous = this.manifest.get(canonical);
this.manifest.set(canonical, carryGuid({ hash: await hashContent(normalized), … }));  // transaction 2
```

The `await` between the `delete` and the `set` **ends the implicit Yjs transaction**, so the
observer fires twice: once with `removed=[folder], added=[]`, and once with
`removed=[], added=[folder/file.md]`. `added.length > 0 && removed.length > 0` is therefore **never
true for producer 5**, the rename arm never runs, and the removal goes **straight to the trash arm**.

Measured directly, from the production route's own disposition (GREEN run, both vaults):

```
"removed": ["_liveshare-test/wp86-dir-20260805-060221"],  "added": [],  "renames": []
```

**This makes producer 5 strictly worse than charted, not better.** The charter's "guest does not yet
hold the file" branch — a swallowed throw that silently aborts the pass — does not exist; **both**
branches land on `trashFile(TFolder)`, and the precondition the charter said would decide between
them (`guest_holds_note_before=False` in the RED run) turns out not to matter. Recorded as **S50**.

### 3.3 GREEN — run `20260805-060221`, shipped bundle, roles **A resumed as guest, B as host**

```
PASS  S1 ENTRY-INTO-THE-ROUTE CONTROL: the directory key MEASURABLY DISAPPEARED from
      manifest.info.paths on BOTH instances
      hostBefore=True guestBefore=True hostAfter=False guestAfter=False
PASS  S1 ORACLE: the guest still HAS the folder                     present=True
PASS  S1 ORACLE: and everything that was inside it   keeper.md      present=True
PASS  S1 ORACLE: the HOST still has the folder too                  present=True
PASS  S1 ORACLE: nothing under the shared tree was lost on the guest   lost=[]
PASS  S1 ORACLE: nothing under the shared tree was lost on the host    lost=[]
```

The decision object, read back from production code, **identical on both vaults**:

```json
{"pass": 10, "removed": ["_liveshare-test/wp86-dir-20260805-060221"],
 "removals": [{"path": "_liveshare-test/wp86-dir-20260805-060221", "verdict": "refused",
   "reason": "the vault holds a folder at this path, not a file; a manifest key can be retired for
     bookkeeping (a shared folder stops being empty and its directory entry is replaced by the
     file's), and trashing what is there would take the folder and everything inside it"}],
 "destroyed": [], "renamed": [], "renames": [], "delegated": [], "aborted": false, "error": ""}
```

**`file-ops.ts` build installed when AC3 ran:** WP83's, landed as `f5d8abd` and byte-identical to
`HEAD` at run time (`git diff --quiet HEAD -- plugin/src/files/file-ops.ts` → clean, with a positive
control that the same check reports `main.ts` as changed).

---

## 4. AC2 — the trash arm. RED first ✅

### 4.1 The bundle and the disabled seam, stated

RED and GREEN both ran on a `npm run build:e2e` bundle of the same tree with **WP80's producing-side
decision core disabled at its seam** — a temporary early return in `decidePublication` yielding
`PURGE` whenever a manifest is connected and a purge is requested, i.e. the pre-WP80 behaviour, with
the reason string `"SEAM DISABLED: pre-WP80 behaviour"` so no output can be mistaken for a real
verdict. This is the charter's stated technique and this run's own precedent
(`ImplementationReport_WP80.md` §AC3): it is the **only** way to feed this consumer the input it
exists to survive. **The seam edit was removed afterwards and `plugin/src/files/manifest-purge-decision.ts`
is byte-unchanged versus `HEAD`** (§7).

The RED build additionally restored the pre-repair trash sink and the positional rename fallback in
`processManifestChange`. Both temporary edits are gone.

### 4.2 RED — run `20260805-055139`, roles **A host, B guest**; the oracle is A, which held the file

```
PASS  S2 PRECONDITION (recorded): the guest's local set is a STRICT SUBSET of the manifest it holds,
      and the canary is in the difference
      difference=['_liveshare-test/wp86-canary-20260805-055139.bin']
PASS  S2 precondition: the canary IS on the host's disk
    publication (from the REAL promoteToHost):
      {"deleted": ["_liveshare-test/wp86-canary-20260805-055139.bin"], "purged": true,
       "verdict": "purge", "reason": "SEAM DISABLED: pre-WP80 behaviour"}
PASS  S2 ENTRY-INTO-THE-ROUTE CONTROL: the canary's key MEASURABLY DISAPPEARED from
      manifest.info.paths on BOTH instances
      hostBefore=True guestBefore=True hostAfter=False guestAfter=False
>>> FAIL  S2 ORACLE: the file on the peer that HELD it still exists on disk
          wp86-canary-20260805-055139.bin present=False on vault A (role=host)
```

The pre-repair route's own disposition names it: `"destroyed": ["…wp86-canary-….bin"]`,
`"reconcile": null` — **the gated route was never consulted.**

### 4.3 GREEN — run `20260805-055651`, same scenario, same instances, roles **A guest, B host**; the oracle is B

```
PASS  S2 ENTRY-INTO-THE-ROUTE CONTROL: the canary's key MEASURABLY DISAPPEARED from
      manifest.info.paths on BOTH instances
      hostBefore=True guestBefore=True hostAfter=False guestAfter=False (publication purged=True)
PASS  S2 ORACLE: the file on the peer that HELD it still exists on disk
      wp86-canary-20260805-055651.bin present=True on vault B (role=host)
PASS  S2 AC6: it destroyed nothing on this peer   destroyed=[]
```

Read back from the production route:

```json
{"pass": 3, "delegated": ["_liveshare-test/wp86-canary-20260805-055651.bin"], "destroyed": [],
 "reconcile": {"ran": false, "candidates": 0, "trashed": [],
   "reason": "this peer is the host; the host is the source of the manifest, not a consumer"},
 "removals": [
   {"path": "_liveshare-test/wp86-dir-20260805-055651", "verdict": "refused",
    "reason": "the vault holds a folder at this path, not a file; …"},
   {"path": "_liveshare-test/wp86-canary-20260805-055651.bin", "verdict": "delegated",
    "reason": "a local file exists at a path the manifest stopped listing; this route holds no
      evidence about WHY the key vanished, so the question is handed to the stale reconcile, which
      requires a live host's fresh publication before anything is trashed"}]}
```

**That is the whole repair in one object**: the route did not decide, it delegated, and the route
that owns the evidence refused with the rule its own neighbour has held since D2.

**On the shipped bundle the same scenario correctly records a SKIP**, because WP80's gate now
refuses the truncated purge and nothing enters the route at all (`purged=False`,
`"1 manifest entry is not accounted for locally…"`). The suite records that as a SKIP with the
reason, never as a pass — an AC2 green on a shipped bundle would be vacuous by construction.

---

## 5. AC4 — the rename arm. Both halves ✅ / ⚠️

### 5.1 (a) — an unpaired removal does not relocate a file. GREEN, run `20260805-055651`

The shape is manufactured with WP80's technique: a 4 MB file the guest lacks (the removal side) and
a 4 MB file **only the guest holds** (the addition side), so the promoted peer's single
`doc.transact` publication carries **both** an unpaired removal and an addition.

```
PASS  S3 PRECONDITION (recorded): the removal-side file is in the manifest the guest holds but NOT
      on the guest's disk    difference=['_liveshare-test/wp86-unpaired-20260805-055651.bin']
PASS  S3 PRECONDITION (recorded): NO hash pair is available — the removed key's local bytes and the
      added key's manifest hash are independent random content
PASS  S3 ENTRY-INTO-THE-ROUTE CONTROL: the removed key MEASURABLY DISAPPEARED on the host
      before=True after=False
    host tree set difference: lost=[] gained=['wp86-guestonly-20260805-055651.bin']
PASS  S3 AC6: the pass performed NO rename    renamed=[]
PASS  S3 AC6: and it reported the refusal, naming the missing content identity
```

```json
"renames": [{"oldPath": "…/wp86-unpaired-….bin", "newPath": "…/wp86-guestonly-….bin",
  "verdict": "refused",
  "reason": "no content-identity pair: the removed key's local bytes do not hash to the added key's
    manifest hash, so there is no evidence these two keys are the same file under a new name"}]
```

**Recorded absence of a hash pair:** two independently generated 4 MB random payloads, and the
product's own `renames` row states that `matchRenamesByHash` produced no pair. `lost=[]` — the
host's set difference contains no disappearance at all. The added path *does* appear on the host,
and that is the guest's own op-route transfer, not a relocation: the oracle is that the **removed**
file is still at its own path.

### 5.2 (b) — a real rename still works. GREEN on the observable, ⚠️ on the route

```
PASS  S4 precondition: the file reached the guest's disk
    guest content hash before the rename: c71016db728f2489
PASS  S4 ORACLE: on the guest the OLD path is gone and the NEW path exists   old=False new=True
PASS  S4 ORACLE: and the content at the new path is BYTE-IDENTICAL to the original
      before=c71016db728f2489 after=c71016db728f2489
```

**The honest deviation, stated rather than buried: the rename arrived over the FILE-OP route, not
over R2.** The guest's disposition for that pass records the old key as `nothing-to-destroy`
(*"the vault holds nothing at this path"* — the op route had already applied the rename) and
`renames: []`. That is true on the **RED build too** (`renames: []`, same verdict), so it is not
caused by this repair: with both peers connected, the op route simply wins. R2's positive case is
therefore covered here by the criterion's own observable (old gone, new present, hash identical) and
by the decision core's truth table (`tp02h`), **not by a live R2 execution**. Reaching R2's positive
branch live requires an offline rename across a restart; it was not run, and no claim is made that
it was.

---

## 6. AC5 — legitimate deletions still land. Both routes, non-empty and named ✅

### 6.1 (a) the op route — run `20260805-060448`, shipped bundle, both peers `connected=true`

```
PASS  S5 ORACLE: the guest's shared file set SHRANK by exactly that named path
      deleted=True shrank_by=['wp86-victim-20260805-060448.md']
PASS  S5: the deleted set is NON-EMPTY and NAMED (it changes with the scenario)
PASS  S5 ENTRY CONTROL: the key also left the manifest    before=True after=False
```

And **the manifest route's own destroyed branch**, in the same act:

```json
{"pass": 39, "delegated": ["_liveshare-test/wp86-victim-20260805-060448.md"],
 "destroyed": ["_liveshare-test/wp86-victim-20260805-060448.md"],
 "reconcile": {"ran": true, "candidates": 1,
   "trashed": ["_liveshare-test/wp86-victim-20260805-060448.md"],
   "reason": "host e9e612b8-… published a manifest of 13 entry/entries this session"}}
```

```
PASS  S5 AC6 (the DESTROYED branch): the delegated key was trashed by the GATED route, and the
      destroyed set is NON-EMPTY and NAMES the path
```

The destroyed set is **not** constant: `[]` in AC2 and AC3, `[victim]` here, and it changed within
this same suite between two runs purely because the guest's evidence state changed (§9, S51).

### 6.2 (b) the gated route — the inherited suite, run unchanged

`python H:\tmp\liveshare_dataloss_e2e.py`, run `20260805-060633`, **on the shipped bundle**:

```
[S2] a live host's fresh manifest still deletes (the fix is not a lobotomy)
  PASS  S2 precondition: the file reached the guest (B) — both sides hold it   host=True guest=True
  PASS  S2 precondition: the file is gone on the host and still present on the guest
  guest B manifest: size=9 fresh=True hostPeers=['500920d4-…']
  decision on B: {"ran": true, "reason": "host 500920d4-… published a manifest of 9 entry/entries
                  this session", "candidates": 0, "trashed": []}
  PASS  S2: the guest DID delete the file its live host no longer lists
           ran=True … guest_copy_present=False

RESULT: 12 passed, 0 failed, 0 skipped   (run 20260805-060633)
```

**`guest_copy_present=False`.** `plugin/src/__tests__/dataloss/**` and the suite script are
byte-unchanged; nothing was deleted, weakened, retitled, skipped or amended. **No ESCALATE was
required — no inherited test asserts that a removed manifest entry trashes the local file.** The
pattern used to look for one and the proof it can match are in §7.

---

## 7. AC6 — nothing is silent ✅

Four distinct, non-constant reasons were read back from **production code** across the runs:

| verdict | reason (verbatim, abbreviated) | seen in |
|---|---|---|
| `refused` | *"the vault holds a **folder** at this path, not a file; a manifest key can be retired for bookkeeping … and trashing what is there would take the folder and everything inside it"* | AC3, both vaults |
| `delegated` | *"a local file exists at a path the manifest stopped listing; this route holds **no evidence about WHY** the key vanished, so the question is handed to the stale reconcile …"* | AC2, AC4a, AC5a |
| `nothing-to-destroy` | *"the vault holds nothing at this path … a legitimate delete has usually already arrived over the file-op route"* | AC4b |
| `refused` (rename) | *"**no content-identity pair**: the removed key's local bytes do not hash to the added key's manifest hash …"* | AC4a |

Each is paired with the **gated route's own** reason when a delegation occurred — *"this peer is the
host; the host is the source of the manifest, not a consumer"* (AC2), *"no manifest publication
observed this session (last attestation seq=5 predates this connection …)"* (AC5a, first run),
*"host e9e612b8-… published a manifest of 13 entry/entries this session"* (AC5a, evidenced run).

**The disposition is state, not a log line**, observable through `manifest.lastChange`, and the
decision is **returned by the production code and read back** — no field is composed by the rig.
The `.catch` is no longer the only trace of an aborted pass: `aborted` / `error` are recorded before
the rethrow (`aborted=False error=''` asserted on every green pass; the branch itself is covered by
construction, not by a live throw).

---

## 8. Constraint compliance — each stated, none implicit

- **No `server/**` file was modified.** `git status --porcelain -- server/` → empty.
- **`plugin/src/files/file-ops.ts` and `plugin/src/utils.ts` were NOT edited.** `git diff --quiet
  HEAD --` reports both byte-unchanged, **with a positive control** that the same command reports
  `plugin/src/main.ts` as changed. WP83's build of both is what was installed for every live run.
- **`plugin/src/files/manifest.ts`, `plugin/src/files/manifest-purge-decision.ts` and
  `plugin/src/__tests__/dataloss/**` are byte-unchanged versus `HEAD`**, by the same check with the
  same control. The temporary WP80 seam used for the RED runs was removed and the file diffed clean.
- **The D2 gate is byte-unchanged.** `cleanupStaleFiles`, `armStaleReconcileRetry` and
  `armCanvasMirrorPass` are untouched: `git diff -U0` on `main.ts` produces hunks only at old lines
  `2`, `53`, `73`, `185`, `259`, `264-370`, `371-394` and `408`; `cleanupStaleFiles` sat at
  `725-782` and is outside every hunk. `armStaleReconcileRetry` and `armCanvasMirrorPass` were
  additionally compared body-for-body and are byte-identical.
- **The five registration sites and the intra-handler ordering are unchanged.** Host arms:
  `registerManifestChangeHandler` → `armCanvasMirrorPass`. Guest arms: `armStaleReconcileRetry` →
  `cleanupStaleFiles` → `syncFromManifest` → `backgroundSync.startAll` →
  `registerManifestChangeHandler` → `armCanvasMirrorPass`. The comment blocks recording why are
  preserved verbatim.
- **No clock gates anything.** No sleep, no debounce, no `publishedAt` comparison, no timestamp in
  either decision core or in the handler. The only `setTimeout` is the pre-existing
  `VAULT_EVENT_SETTLE_MS` unmute, untouched.
- **A `TFolder` never reaches `trashFile`**, on two independent grounds: this route no longer calls
  `trashFile` at all, and `cleanupStaleFiles` iterates `vault.getFiles()`.
- **No new predicate, no clock, no absorption of the gate.** The verdict delegates; it does not
  re-decide.
- **No new runtime dependency.** `package.json` untouched.
- **No §7 licence of any class; no `DONE` work package re-opened; no inherited assertion reddened.**
  **Rule 15 for that absence.** Pattern `trashFile|actuallyRemoved`, run over
  `plugin/src/__tests__/` (`grep -rlE`). It **can** match — four files hit:
  `file-ops.test.ts` and `v2/wp83/test_wp83_tp01_…` (the file-op route, another WP's),
  `regression.test.ts` (**line 166, a `createMockFileManager` helper — a mock definition, not an
  assertion**), and WP86's own census test. `dataloss/test_stale_reconcile_evidence_gate.test.ts`
  contains neither token: its subject is `ManifestManager`'s attestation, and it says so in its own
  header. **No inherited test asserts that a removed manifest entry trashes the local file**, so no
  ESCALATE was owed. The full suite being green is the stronger form of the same statement.
- **`canvas.simulateEdit` was not called** by any scenario. Remote changes were driven by writing
  files on disk.
- **`useCanvasBinding` is still `false`.** Plugin version not bumped. `plugin/manifest.json` (a
  broken symlink) not read or edited. **`BUILD_SPEC_CanvasV2.md` not edited.**
  `WORKFLOW_ANALYSIS.md` left untouched and unstaged.
- **Rule 14.** No `git checkout --`, `git restore` or `git stash` was run on any shared path. The
  only `git checkout --` in this batch ran **inside a disposable detached worktree** (`H:/tmp/wp86-attrib`)
  on files this batch had copied there itself; that worktree has been removed.
  `git status --porcelain` was re-read **immediately** before the commit, and staging is by explicit
  path.
- **Data safety.** Ports contacted: `39431` (vault A) and `39432` (vault B). **No `data.json` value
  was read, printed, logged, fixtured or named.** No owner-vault file content was read into an
  artefact or hashed into this report; the only hashes recorded are of this run's own `wp86-*`
  fixtures. `sharedFolder` remained `_liveshare-test` in both vaults and was never set empty. No
  `.bak` file touched; `obsidian-git` left disabled.

### Roles each instance actually RESUMED as, per live run (S37 — the election is a coin flip)

| run | A (39431) | B (39432) | build |
|---|---|---|---|
| `20260805-055139` (RED) | **host**, `connected=true` | guest, `connected=true` | WP86 seam disabled + WP80 seam disabled |
| `20260805-055651` (GREEN) | guest, `connected=true` | **host**, `connected=FALSE` | WP86 repaired + WP80 seam disabled |
| `20260805-060221` (shipped) | guest, `connected=true` | **host**, `connected=true` | shipped |
| `20260805-060448` (shipped, final) | guest, `connected=true` | **host**, `connected=true` | shipped |
| `20260805-060633` (data-loss) | **host** | guest | shipped |

---

## 9. Found and NOT fixed — carried up

| # | Finding | Why not fixed here |
|---|---|---|
| **S50** | **Producer 5 is TWO `Y.Map` events, not one — so the charter's rename branch for it is unreachable, and `trashFile(TFolder)` is the only outcome.** `ManifestManager.updateFile` `await`s between the parent-directory `delete` and the file `set`, which ends the implicit Yjs transaction. Measured from the production route's own disposition on both vaults: `removed:[folder], added:[], renames:[]`. The charter states this branch as *traced, not measured*; the measurement contradicts the mechanism and **strengthens** the severity. | The consequence is fully repaired (the folder is refused by name on both peers). Making `updateFile` atomic is a **producing-side** change to `manifest.ts`, which WP86 may not touch. **Needs an owner** — it also means a guest can briefly see a folder key vanish before the file key arrives. |
| **S51** | **The op route can be silently dead for a whole session, and WP86 then correctly declines to compensate.** In run `20260805-055651` vault B reported `role=host, connected=FALSE` (WP82's latch), so every op B emitted went to the unbounded `OfflineQueue`: a host-side delete never reached the guest, a host-side rename arrived as a *copy* (both paths present on the guest), and the manifest route's delegation was refused by the gated route for want of a fresh publication. **This is the residue the charter named, now measured live.** The file is *stale*, not destroyed — the trade this WP makes deliberately. | The cause is **WP82's**, chartered and unimplemented. The residue itself is unowned. Recorded so the next batch does not read a lingering file as a WP86 regression. |
| **S52** | **An empty shared folder created mid-session is never materialised on a guest.** `syncFromManifest`'s directory branch is gated on `!options.skipText`, and the manifest-change handler is the one caller that passes `skipText: true`, so a directory entry only materialises at a full sync (session entry). Measured: the guest failed to create the folder within 30 s in run `20260805-055651`; the suite now constructs the precondition on both disks instead of racing it. | Presence-driven, in `manifest.ts`, out of WP86's scope and adjacent to WP79's mirror. **Owner: none assigned.** |
| **S53** | **A tree-derived census can return an empty answer by looking in the wrong place.** The AC1 deriver initially found **zero** sinks in `syncFromManifest` because a type literal in the signature (`options?: { skipText?: boolean }`) was taken as the start of the body. It reported a clean census and both "every derived site is pinned" assertions passed. Caught only by the reverse assertion (*every pinned row is still present*). **A census needs its absence controls in both directions**, and `tp01g` now pins the extractor itself. | Fixed inside WP86's own test. Recorded because it is the run's own defect class — a green that cannot fail — reproduced inside the very test written to prevent it. |

**Not re-found as findings (already recorded by the charter):** R5's presence-driven overwrite (an
explicit out-of-scope row in the census), the swallowing `.catch` (now reported as state; making the
pass resumable is still out of scope), S40's unbounded `OfflineQueue`, and S25's server-side host
identity churn.

---

## 10. Suite numbers, all measured

| suite | command | result |
|---|---|---|
| plugin unit, **WP86 on a clean `d7eda85`** (detached worktree) | `npx vitest run` | **2157 passed / 2157**, 321 files |
| plugin unit, **`d7eda85` baseline**, same worktree | `npx vitest run` | **2136 passed / 2136**, 319 files → **+21 tests, +2 files, no existing test moved** |
| plugin unit, shared working tree | `npx vitest run` | 2196 passed / 13 failed — **all 13 belong to a sibling's uncommitted `canvas-sync.ts` + `canvas-text-merge.ts` (WP36) work**, proven by the two rows above rather than assumed |
| build gate | `npm run build` | **PASS**, exit 0 (tsc `-noEmit -skipLibCheck` + esbuild production) |
| WP86 live E2E, seam-disabled | `python H:\tmp\liveshare_wp86_e2e.py` | **31 passed, 7 failed, 0 skipped** (`20260805-055139`) — the RED |
| WP86 live E2E, repaired + WP80 seam disabled | same | **25 passed, 6 failed, 1 skipped** (`20260805-055651`) — AC2/AC3/AC4a GREEN; the six are S51's dead op route and two suite bugs since fixed |
| WP86 live E2E, **shipped bundle, final** | same | **38 passed, 0 failed, 4 skipped** (`20260805-060448`) |
| data-loss E2E (inherited, unamended) | `python H:\tmp\liveshare_dataloss_e2e.py` | **12 passed, 0 failed, 0 skipped** (`20260805-060633`) |
| canvas E2E | `python H:\tmp\liveshare_e2e.py` | **13/18** — identical to the S30 baseline, same five failures, not this WP's |

The four skips in the final run are honest: AC2 and AC3's rename-shape cannot enter the route on a
shipped bundle, because WP80's gate refuses the truncated purge that feeds them. The suite records
that with its reason rather than passing vacuously.

---

## 11. Files changed

| File | Change |
|---|---|
| `plugin/src/files/manifest-removal-decision.ts` | **new** — the pure decision core, zero imports |
| `plugin/src/main.ts` | `registerManifestChangeHandler` only: the trash sink removed and delegated, the rename arm gated on content identity, the disposition recorded, `classifyLocal`, `getLastManifestChangeDisposition` |
| `plugin/src/types.ts` | `ManifestChangeDisposition`, **at the top** |
| `plugin/src/testing/e2e-control.ts` | **one** additive read-only command, `manifest.lastChange` (+110, −0) |
| `plugin/src/__tests__/v2/wp86/test_tp01_vanished_key_sink_census.test.ts` | **new** — AC1's tree-derived census, 8 tests |
| `plugin/src/__tests__/v2/wp86/test_tp02_removal_decision_core.test.ts` | **new** — the truth table, 13 tests |
| `H:\tmp\liveshare_wp86_e2e.py` | **new** — the live suite, idempotent (per-run ids, sweep at preflight and teardown, set comparison, roles restored, SKIP recorded as SKIP) |

No `server/**` edits. No `.bak` files touched. `BUILD_SPEC_CanvasV2.md` not edited.
`WORKFLOW_ANALYSIS.md` left unstaged and untouched. The sibling's in-flight `canvas-sync.ts`,
`canvas/canvas-text-merge.ts`, `testing/canvas-node-editor.ts` and `__tests__/v2/wp36/` are **not
staged by this batch.**
