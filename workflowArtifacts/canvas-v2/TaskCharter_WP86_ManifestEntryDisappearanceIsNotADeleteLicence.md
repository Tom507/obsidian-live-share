# Task Charter — WP86: a manifest entry disappearing is not a licence to destroy a local file

<!-- Updated: chartered 2026-08-05 (B27) from `ImplementationReport_WP80.md` §9 row S34, re-verified against the current tree on branch `fix-bugs-and-raceconditions` per hard-won rule 12. The reported defect HOLDS at a corrected line — `main.ts:366-370`, not the report's `:344-350` (the symbols had not moved; the numbers had). Re-verification added TWO facts the source row does not contain: the same handler holds a SECOND unguarded destructive sink (`vault.rename`, `main.ts:319`), and the vanished-key set has a producer that has nothing to do with deletion at all (`manifest.ts:559-565` retires a parent DIRECTORY entry when the folder stops being empty, and the consumer at `:368-369` never checks `instanceof TFile`, so `trashFile` takes a TFolder and everything in it). Every line number below was read from the working tree. No Obsidian was launched, no vault file was written or read, no `data.json` value was read or printed, no relay was contacted, no E2E script was run. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP86
**Phase:** P3
**task_mode:** `standard`
**Depends on:** the D1/D2/D3 data-loss chain (landed `6380e28`, `94a09c7`, `d9390ba`) and **WP80** (landed `22fc50b`, `dd91921`). Both are prerequisites *and* precedents: D2 supplies the consuming-side evidence gate this route is not on, WP80 supplies the producing-side completeness gate this route consumes the output of.
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a manifest **key disappearing** stops being executed as *"trash the user's local file"*. Today `registerManifestChangeHandler` (`main.ts:260-399`) reacts to every `delete` key in a `Y.Map` event by trashing the corresponding local file — for **every peer, host or guest**, on **any** peer's authority, with **no role guard, no evidence gate and no completeness check**:

  ```ts
  // plugin/src/main.ts:366-370
  for (const path of actuallyRemoved) {
    this.backgroundSync.onFileRemoved(path);
    const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
    if (file) await this.app.fileManager.trashFile(file);
  }
  ```

  After this WP, no destructive local write happens on the strength of a vanished manifest key unless there is **positive evidence** that a live host asserted that deletion — and legitimate deletions still propagate, demonstrated with a non-empty deletion.

- **Why this exists, stated plainly, because it is the reason the scope is what it is.** This run has now spent **two work packages hardening one door while a second door stood open beside it.** The data-loss batch put an evidence gate on `cleanupStaleFiles`; WP80 put a completeness predicate on the producing side. **Neither is on this path.** WP80's own RED run proved it rather than argued it: the canary file was *already gone* by the time the reconcile ran —

  ```
  S2 stale-reconcile decision on the demoted peer:
    {"candidates": 0, "ran": true, "reason": "host e9e612b8-… published a manifest of 8 entries
     this session", "trashed": []}
  S2 ORACLE: … wp80-canary-20260805-044133.bin present=False
  ```

  **The protected path was not the path that destroyed the file.** That is why this WP's subject is *every route from a manifest-entry disappearance to a destructive local write*, enumerated from the tree, and **not** *"this loop"*. Someone stopped at the first door once already; §3 Verification 1 is the census that makes stopping at the first door a test failure rather than a judgement.

- **The composition, in the run's own terms.** A vanished key has at least **five** producers (§3 Verification 2) and **only one of them means a file was deleted.** The other four are an *absence of information* — a purge by a peer that could not know, a local read failure, a peer that never held the entry, and a directory entry retired for bookkeeping — and this loop executes all five identically, as a destructive assertion. **I11, one level up, for the third time in one week.**

- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP86**; section 4.5 invariant **I11 REFUSAL NEVER DESTROYS**; section 4.7 (the manifest arm of the data flow). Phase **P3**, the manifest surface, for the same reason WP80 is P3: this WP changes what a manifest document is permitted to *cause*.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: make *"may a vanished manifest key destroy something on this disk?"* a **decided, named, reported** question, on the consuming side, for **every** sink reachable from a manifest change — currently two of them, both unguarded.
  - Scope summary: the trash arm (`main.ts:366-370`) and the rename-pairing arm (`main.ts:296-347`, sink at `:319`) of `registerManifestChangeHandler` stop performing destructive local writes on unevidenced key disappearances · the route reports what it decided instead of being silent · the vanished-key→destructive-sink census is **derived from the tree by a test**, so a third sink cannot be added unnoticed.

- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a **§7 abort criterion**. The relay's host-identity churn (**S25**, `server/src/control-handler.ts:588`) is what makes producer 2 routine; it is not what decides to trash.
  - **⚠ Re-implementing, re-deriving, widening or relocating WP80's producing-side predicate.** `files/manifest-purge-decision.ts` and `publishManifest`'s consultation are **byte-unchanged**. WP80 answers *"may this peer's publication delete entries?"*; WP86 answers *"may a deleted entry destroy this peer's file?"*. Opposite sides of the wire, and **a consumer cannot compute a publisher's completeness — the publisher's knowledge is not on the wire.** That is precisely why WP80 had to be producer-side, and re-deriving it here would be a second definer of a fact this side cannot hold. **One WP defines, the others read** (hard-won rule 10).
  - **⚠ Weakening, widening, re-deriving or relocating the D2 consuming-side gate.** `cleanupStaleFiles` (`main.ts:725-782`), `hasFreshPublication` (`manifest.ts:234-240`), the `manifest.size === 0` floor (`main.ts:755-757`), `armStaleReconcileRetry` (`main.ts:244-258`) and the absence of a reconcile in `demoteToGuest` all keep their current behaviour **exactly**. WP86 may **call** the landed evidence functions; it may not author a third copy of them.
  - **⚠ Deleting, weakening, retitling or skipping any test in `plugin/src/__tests__/dataloss/`.** WP86 holds **no §7 licence of any class**.
  - **⚠ Re-ordering `registerManifestChangeHandler`, `armStaleReconcileRetry` or `armCanvasMirrorPass` relative to one another or to `syncFromManifest` / `backgroundSync.startAll` at any of the five session entry points** (`main.ts:605`, `:614-626`, `:848`, `:880-890`, `:917-927`). Those positions are a **measured** result: moving `registerManifestChangeHandler` ahead of `syncFromManifest` cost the data-loss batch canvas E2E `[06]` (19/19 → 17/19, `ImplementationReport_DataLossChain.md` §5), and WP79 pinned `armCanvasMirrorPass` **after** it for the same reason (`main.ts:623-626`). Changing an order here re-opens two closed measurements. The comment blocks at `main.ts:382-394` and `:400-406` record why and must survive.
  - **The manifest entry shape** (`FileEntry`), the attestation shape (`ManifestPublication`), the sidecar format, the wire protocol, the relay's persistence.
  - **The file-op delete route** (`file-ops.ts:450-459` producer, `:220-231` consumer). It is the route legitimate live deletions take, it is **verified unaffected** (§3 Verification 4), and it is **WP83's file this batch** — read only, edited never.
  - **`syncFromManifest`'s content overwrite** (`manifest.ts:512-516`). It is a destructive local write reachable from a manifest change (route **R5**, §3 Verification 1) but it is driven by an entry's **presence and hash**, not by an absence — a different class, and it is WP83's / WP85's neighbourhood. **Named so it is not re-found as a finding; not repaired here.**
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** The flag is `false` and frozen until P5. **No criterion here may depend on any unbuilt phase.**
  - **`canvas.simulateEdit`.** Not used, not extended, not repaired. Remote changes in every WP86 scenario are driven by **writing files on disk**.
  - **Any new runtime dependency.** D11 — an ESCALATE.

- **Known interfaces / dependencies:**
  - Input: the `(added, removed, updated)` triple from `ManifestManager.setManifestChangeHandler` (`manifest.ts:531-554`); `getEntries()`, `getPublication()`, `hasFreshPublication(excludeUserId)` (`manifest.ts:234-240`), `isSharedPath()`; the peer's own role, id and `remoteUsers`; the local vault.
  - Output: a decided, reported disposition for each vanished key; wiring at the two sinks; a tree-derived census test.
  - **Blocks nothing.** Product-safety scope, off the WP7 gate's critical path.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

Stated explicitly because the brief requires it not be left implicit. Each clause is measured, not argued.

1. **No `DONE` work package is re-opened.** `registerManifestChangeHandler`'s deletion behaviour has never been an acceptance criterion of any WP: it predates this initiative, it appears in no §5 component, and the two batches that touched the surrounding code **explicitly declined it** — `ImplementationReport_WP80.md` §9 row **S34**: *"Out of WP80's scope, which is the producing side … **Needs its own WP.** Owner: none assigned."* WP86 is that work package.
2. **WP79 and WP80 are not re-opened by proximity.** WP79 owns `armCanvasMirrorPass`'s *position* inside this handler (`main.ts:382-394`) and WP80 owns the four publish call sites; WP86 touches neither. If a repair appears to require moving WP79's arm or editing WP80's decision core, that is an **ESCALATE**, not a judgement call — and the §2 non-goal above makes it an abort.
3. **The emergency data-loss batch has no WP number**, so there is no `DONE` WP to re-open there either — but its nine tests are inherited and binding, and `main.ts:725-782` is byte-unchanged.
4. **A reddened inherited assertion is an ESCALATE, left red, with the measured before/after** — not a rewrite. Worker 2 does not assume a licence. Note the one shape to expect: any inherited test that asserts *"a removed manifest entry trashes the local file"* is asserting the defect. If one exists it is an **escalation with the measured line**, and only the Dispatcher rules on it; the implementor may not amend it silently, and may not assume it does not exist.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

> ⚠ `plugin/src/main.ts` is **chartered-but-unimplemented** territory for WP82 and WP85 as well (§5, ordering). Line numbers below were read from a clean working tree at charter time (`git status --porcelain` showed only the untracked `WORKFLOW_ANALYSIS.md`) and **will drift**. Every reference is given with its symbol; **resolve by symbol, not by number** — WP80 already found all four of its `main.ts` numbers drifted while every symbol held.

**Verification 0 — the defect is present, at a corrected line.**

`main.ts:366-370` is verbatim what the source row quotes. The row's `main.ts:344-350` had drifted by 22 lines. `getAbstractFileByPath` returns `TAbstractFile | null`; `:369` tests only `if (file)` and hands whatever it got to `fileManager.trashFile`. **There is no `instanceof TFile` check** — contrast `:275`, sixteen lines up in the same handler, which does check it (for hashing). That asymmetry is load-bearing; see Verification 2, producer 5.

**Rule 15 — the absence is proved, and the pattern is shown able to match.**

Pattern `settings\.role|isHost|hasFreshPublication|remoteUsers|getPublication|StaleReconcileDecision|refuse|decide`:

| range | symbol | hits |
|---|---|---|
| `main.ts:260-399` | `registerManifestChangeHandler` (the whole handler) | **1**, and it is a **comment** at `:385` (*"`resolveGuidForSubscribe` refuses to mint on a guest"*, WP79's) — **zero guard code** |
| `main.ts:725-782` | `cleanupStaleFiles` — **the positive control** | **11**, across 10 lines: `:725`, `:726`, `:727`, `:731`, `:732`, `:735`, `:736`, `:737`, `:745`, `:747`, `:756` |

The pattern matches every known-present guard line in the gated route and finds none in the ungated one. **The absence is measured, not inferred.**

---

**Verification 1 — the CENSUS. Every route from a manifest change to a destructive local write, derived from the tree.**

The manifest document carries exactly **two** observers — `meta.observe` (`manifest.ts:250`) and `manifest.observe` (`manifest.ts:553`). Everything a manifest change can cause flows through one of those two, or through a direct `cleanupStaleFiles()` call. Enumerated:

| # | Route | Destructive sink | Guard today |
|---|---|---|---|
| **R1** | `manifest.observe` (`manifest.ts:553`) → `registerManifestChangeHandler` (`main.ts:261`) → `actuallyRemoved` loop (`:366-370`) | `fileManager.trashFile` — **`main.ts:369`** | **NONE.** No role guard, no evidence gate, no completeness check, no `instanceof TFile` |
| **R2** | **the same handler**, rename-pairing branch (`main.ts:266-347`) | `vault.rename` — **`main.ts:319`** | **`isPathSafe(newPath)` only** (`:306`). No role guard, no evidence gate, and no content identity required — see below |
| **R3** | `meta.observe` (`manifest.ts:250`) → `armStaleReconcileRetry` (`main.ts:244-258`) → `cleanupStaleFiles` | `trashFile` — **`main.ts:771`** | **D2 evidence gate** (host refusal `:731`, `hasFreshPublication` `:735`, live-host-claim `:745`) **+ D3 floor** (`:755`) |
| **R4** | direct `cleanupStaleFiles()` at session entry — `main.ts:615` (resume, guest arm), `:881` (join), `:918` (join via link) | same sink, **`main.ts:771`** | same gate |
| **R5** | the same handler, `actuallyAdded` → `syncFromManifest` (`main.ts:353`) | `vault.modify` content overwrite — **`manifest.ts:513`** | hash difference only (`:481-492`). **Driven by an entry's PRESENCE, not by an absence — different class, OUT of scope (§2)** |

**Non-manifest destructive routes, given for the boundary and edited by nothing here:**

| # | Route | Sink |
|---|---|---|
| **N1** | `vault.on("delete")` (`vault-events.ts:170-183`) → `onFileDelete` (`file-ops.ts:450-459`, **every role**) → `emitOp` → peer's `applyRemoteOpInner` case `"delete"` (`file-ops.ts:220-231`) | `trashFile` — **`file-ops.ts:224`** |
| **N2** | rename collision on an applied remote op (`file-ops.ts:250-252`) | `trashFile` — **`file-ops.ts:251`** |

**So there IS a third door, and it is inside the loop the source row pointed at.** **R2** is it. Its mechanics, because they are not obvious:

- The branch runs whenever `added.length > 0 && removed.length > 0` (`main.ts:266`) — and `publishManifest` writes its entry `set`s and its purge `delete`s **in one `doc.transact`** (`manifest.ts:368-402`), so a single `Y.Map` event carrying both is the *normal* shape of a purging publication, not a corner case.
- `matchRenamesByHash` (`utils.ts:142-163`) pairs only on an **equal content hash**, and returns nothing for an old path it could not hash — including every path that is not a `TFile` (`main.ts:275`) and every path whose read threw (`:284-286`, *"fall back to positional pairing"*).
- With no hash pair, `orderedAdded = added` (`:300-302`) and the loop takes **the first added path** for which `oldFile && !newFile`. **An arbitrary vanished key is then paired with an arbitrary new key and the user's file is renamed onto it** (`:319`), with no content identity checked at any point.
- Second-order, **traced not measured**: after such a rename the local file at `newPath` holds the *old* file's bytes while the manifest entry for `newPath` carries a different hash, so the next `syncFromManifest` (`:481-492` → `:513`) overwrites it. R2 destroys content on a delay.

---

**Verification 2 — what a disappearing manifest entry actually means. FIVE producers; ONE of them is a deletion.**

| # | Producer | Site | Does it mean "this file was deleted"? |
|---|---|---|---|
| **1** | **A genuine remote delete.** Host arm of `vault.on("delete")` → `manifestManager.removeFile` | `vault-events.ts:174-178` → `manifest.ts:640-643`; also `control-handlers.ts:74-75`, the host applying a guest's delete op | **YES — the only one.** And note: the file-op (**N1**) was already emitted at `vault-events.ts:174`, *before* the manifest mutation at `:177`, so every online peer is already having the file trashed by a route that never consults the manifest |
| **2** | **A purge by a peer that could not know the set is complete** — WP80's subject | `manifest.ts`'s purge loop, inside `publishManifest`'s transaction | **NO.** Now refused at the producer by WP80 — **but only on a WP80 build.** A peer on an older bundle still purges, and this consumer trusts it identically |
| **3** | **A per-file `readFailure` skip** — WP80's S28 input | `manifest.ts:210-217` | **NO.** A local failure to *observe* published as an assertion that the file is *gone*. Disqualifies a purge at the producer since WP80; the read path itself is untouched |
| **4** | **A peer that never held the entry.** `getSharedFiles()` enumerates the publishing peer's **own disk** | `manifest.ts:192` → `:594` | **NO.** Same shape as 2, reachable at session start and for any legacy peer |
| **5** | **A parent DIRECTORY entry retired because the folder stopped being empty.** Not about deletion in any sense | `manifest.ts:559-565`, inside `updateFile` (host-gated at `vault-events.ts:143`) | **NO — and this one is not even about a file.** See below |

**Producer 5 is a reachable, previously unnamed data-loss shape, and it is not the WP80 shape.** Traced end to end, every link pinned:

1. Host creates an empty shared subfolder → `addFolder` (`vault-events.ts:163` → `manifest.ts:645-650`) writes `{directory: true}`; `publishManifest` also emits local empty folders (`manifest.ts:345`).
2. Guest materialises it — `syncFromManifest`'s directory branch `ensureFolder`s it (`manifest.ts:441-450`).
3. Host creates a file **inside** that folder → `updateFile` (`vault-events.ts:155`) deletes the parent directory key and sets the file key (`manifest.ts:559-566`) — **one `Y.Map` event with `removed=[folder]` and `added=[folder/file.md]`**.
4. On the guest: the R2 branch runs. `getAbstractFileByPath(folder)` is a `TFolder`, so `:275`'s `instanceof TFile` fails, no hash is taken, `matchRenamesByHash` returns no pair (`utils.ts:151-152`).
   - **If the guest does not yet hold the file:** `oldFile && !newFile` → **`vault.rename(<folder>, "<folder>/file.md")`** at `:319` — a folder renamed into a path inside itself. Whatever Obsidian does with that, the throw is swallowed by the handler's `.catch` at `:396-398`, and **the entire rest of that handler pass is skipped** — `syncFromManifest`, the removal loop and `armCanvasMirrorPass` included. Silent.
   - **If the guest already holds the file** — reachable, because `FileOpsManager.onFileCreate` pushes the whole file content over the control channel for **every role with no guard** (`file-ops.ts:375-405`, WP83's subject, measured live at under 3 seconds) while the manifest travels the mux — then neither rename branch matches, the loop falls through, `actuallyRemoved = [folder]`, and **`main.ts:369` calls `trashFile` on a `TFolder`: the folder and everything in it goes to the Recycle Bin.**

**Status of producer 5: TRACED, NOT MEASURED LIVE.** Every link is pinned to a line; the composition has not been run. It is stated at exactly that strength, and AC3 requires it be **reproduced RED before it is repaired** — this run does not charter repairs for compositions it has only reasoned about (rule 12, and the falsified-symptom lesson of WP81 and WP82).

**Also present, and R2 exists to serve it:** `renameFile` (`manifest.ts:652+`) re-keys an entry — a `delete` of the old key and a `set` of the new — which is a legitimate rename and *is* the case hash-pairing handles correctly. **R2 must keep working for that case**; it is AC4's positive control.

---

**Verification 3 — the route is live for EVERY role, and no later role transition disarms it.**

`registerManifestChangeHandler()` is called on **both** host arms and **all three** guest arms, at every session entry point:

| site | arm |
|---|---|
| `main.ts:605` | `resumeSession`, **host** |
| `main.ts:622` | `resumeSession`, **guest** |
| `main.ts:848` | `startSession` (**host**) |
| `main.ts:888` | `joinSession` (**guest**) |
| `main.ts:925` | `joinWithInvite` (**guest**) |

Neither `promoteToHost` nor `demoteToGuest` re-registers or unregisters it, so the handler installed at session entry **stays live across every role transition** — which is exactly the population WP82 shows is churning (34 role transitions in 2 h 05 min, S37). The handler body contains no role test (Verification 0), so the role it was installed under is irrelevant anyway.

**And the host destroys its own file through it.** That is not a corollary — it is the measured shape of WP80's RED run: a promoted mid-sync peer purged the entry, the deletion travelled over Yjs to the **original host**, which held the file, and the original host trashed it. `ImplementationReport_WP80.md` §1: *"It also means the host destroys its own file, which is why the AC3 oracle is the original host's disk."*

---

**Verification 4 — the `removeFile` path IS unaffected, and this is the fact that makes the WP's job small.**

WP80's report claims legitimate deletions travel a different route and are unaffected. **Verified true**, at both ends:

| | |
|---|---|
| Producer | `vault.on("delete")` → `plugin.fileOpsManager.onFileDelete(file)` — **`vault-events.ts:174`, called for every role, unconditionally, BEFORE the host-only `removeFile` at `:177`** |
| Emission | `onFileDelete` (`file-ops.ts:450-459`) → `emitOp({type:"delete", path})` → `sendOp` (`:103-110`) |
| Consumer | `applyRemoteOpInner` case `"delete"` (`file-ops.ts:220-231`) → `fileManager.trashFile` at `:224` |
| Manifest involvement | **none.** The op carries a path and a type; it never reads `getEntries()`, an attestation or a role |

**Consequence, and it is the charter's central simplification: this loop does not need to delete in order for deletions to work.** See the ruling below.

**One honest caveat, measured:** `emitOp` enqueues to the `OfflineQueue` when `isOnline` is false (`file-ops.ts:105-108`), and WP82 established that `FileOpsManager.isOnline` can be wrongly false for a whole session and that the queue's drain edge can no longer occur (S40, and `OfflineQueue` is unbounded). So the op route **can** silently fail to deliver. That is named in the ruling as the one residue, and it is WP82's defect, not this one's.

---

- **Component(s) being changed:** `plugin/src/main.ts` — `registerManifestChangeHandler` (`:260-407`) only; plus, if the verdict is taken by a pure core (recommended, not mandated), one new headless module in `plugin/src/files/` on the `canvas-seed-decision.ts` / `manifest-purge-decision.ts` precedent, and its interface **at the TOP of `plugin/src/types.ts`**.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS.** A route that cannot establish evidence must still do its **non-destructive** work: `backgroundSync.onFileRemoved` (memory-only — timers, observers, `releaseDoc`; verified at `background-sync.ts:243-258`, it touches no disk), the `actuallyAdded` sync, the `updated` binary requests, and `armCanvasMirrorPass` all continue. **The refusal is of the destruction, never of the pass.**
  - **I3 DOC IS TRUTH.** No change to what the manifest document contains or to the transaction the attestation rides.
  - **`seq`, never a clock.** No sleep, no debounce, no `publishedAt` comparison. Wrong on this project by ruling.
  - **`useCanvasBinding` stays `false`.** No criterion depends on P4 or P5.
  - **⚠ `plugin/src/types.ts` — position is load-bearing.** Any new interface goes **at the top of the file**, beside `StaleReconcileDecision` and `ManifestPublishDecision`, never below `DEFAULT_SETTINGS`, whose `//` comment holds the literal `` `${configDir}/**` `` and whose pairing the WP22 dormancy test's naive comment-strip will close with any JSDoc added below it. Paid for once already (`ImplementationReport_DataLossChain.md` §10).
  - **Data safety.** No owner-vault file is read into an artefact, hashed into a report or pointed at by a fixture. **Both vaults' `data.json` hold live credentials** — never printed, logged, echoed into a report, a test name, a commit message or a fixture. **Keys may be named; values may not.** No secret through any agent tool.
- **Technology / framework / config constraints:** TypeScript, `plugin/` workspace, Vitest, pure-core + injected-seam style. **Zero new runtime dependencies** (D11). Biome reports a whole-file `format` finding per touched file (CRLF artefact) — advisory locally, gating in CI; do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/main.ts` — `registerManifestChangeHandler` `:260-407`; the trash sink `:366-370`; the rename branch `:266-347` and its sink `:319`; `armStaleReconcileRetry` `:244-258`; the five registration sites `:605`, `:622`, `:848`, `:888`, `:925`
  - `plugin/src/files/manifest.ts` — **read only**: `setManifestChangeHandler` `:531-554`, `removeFile` `:640-643`, `updateFile`'s parent-dir retirement `:559-565`, `addFolder` `:645-650`, `renameFile` `:652+`, `hasFreshPublication` `:234-240`, the publish transaction `:368-402`
  - `plugin/src/utils.ts` — **read only, and live under another agent**: `matchRenamesByHash` `:142-163`
  - `plugin/src/files/file-ops.ts` — **read only, and live under another agent**: `onFileDelete` `:450-459`, `applyRemoteOpInner` `:220-231`, `emitOp` `:103-110`
  - `plugin/src/files/vault-events.ts` — **read only**: `:143`, `:155`, `:163`, `:170-183`
  - Read-only context, never edited: `main.ts:725-782` (`cleanupStaleFiles`), `files/manifest-purge-decision.ts`, `server/src/**`
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/files/file-ops.ts`, `plugin/src/utils.ts`, `plugin/src/files/manifest-purge-decision.ts`, `main.ts`'s `cleanupStaleFiles` body, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, and `plugin/src/__tests__/dataloss/**`. **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### The ruling: this loop does NOT need to delete — not on its own authority, and on the evidence it holds, essentially not at all

The brief requires this be answered rather than left open. **Ruling: no.** Four measured reasons and one named residue.

1. **Legitimate live deletions already have a complete, manifest-independent route.** Verification 4: `onFileDelete` fires for **every role**, **before** the manifest is touched, and the receiving peer trashes at `file-ops.ts:224`. WP80's report says the same in its own words (§8): *"Ordinary deletions are unaffected — they propagate through `vault-events` → `removeFile`, not through the purge; the purge only reconciles deletions nobody was watching."*
2. **"Deletions nobody was watching" is `cleanupStaleFiles`' stated job**, and it is armed on the guest arm of **every** session entry (R4: `main.ts:615`, `:881`, `:918`) plus on every publication (R3). It is gated. R1 duplicates its purpose without its evidence.
3. **On a host, an entry disappearance the host did not author is, by definition, another peer speaking over the manifest's own author** — the exact WP80 RED shape. A host must never trash on it. `cleanupStaleFiles` already encodes this: `main.ts:731-733` refuses outright for `role === "host"`. R1 contradicts a rule the neighbouring route already holds.
4. **R1 cannot tell the five producers apart.** All five arrive as one `Y.Map` `delete` key with no provenance whatsoever. A route that cannot distinguish *"the host deleted this file"* from *"a folder stopped being empty"* has no business performing an irreversible operation on either.

**The one residue, named rather than argued away:** R1 uniquely covers a Yjs-delivered entry deletion whose control-channel `delete` op was **lost** — the deleting peer was `isOnline: false`, so the op went to the `OfflineQueue` whose drain edge WP82 shows can no longer occur (`file-ops.ts:105-108`, S40). R1 is the only route that would still trash in that shape. **But that is also the shape in which R1 has the least evidence and the most ways to be wrong**, so covering it needs evidence, not a bare loop — which is the same answer. WP82 owns the cause.

**Therefore, as a constraint rather than an implementation:** R1 and R2 stop performing destructive local writes on their own authority. Whether the deletion is then delegated to the landed gated route or taken past the **landed** D2 evidence functions is the implementor's call — but **no third predicate may be authored**, no clock may be consulted, `cleanupStaleFiles` may not be weakened, and **AC5 must show a legitimate deletion still landing, with a non-empty deletion**. A charter that only forbids is a lobotomy, and this project has rejected two of those already.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**. This run has found ten-plus instances of a green that cannot fail; a criterion that does not name its own vacuity risk is incomplete.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}`. **Edits are driven by writing files on disk.** `canvas.simulateEdit` is not called by any criterion. **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification-injection requirement, no `BlindVerificationLedger` row is owed. Unit tests are welcome where they are the honest tool and are **not** the acceptance evidence.*

*⚠ **Every criterion that asserts a file SURVIVED must carry a positive control that the deletion path was entered.** "The file is still there" passes trivially in a run where nothing ever tried to delete it. The minimum admissible control is the **manifest key measurably disappearing** on both instances — `manifest.info.paths` compared before and after, with the vanished key named — because that is the input this WP's routes consume. A scenario that cannot show the key disappeared has measured nothing.*

1. **The vanished-key → destructive-sink census is derived from the tree, and it is complete.**
   - **Deliverable:** one test that derives, from `plugin/src/`, every site reachable from a manifest **key removal** to a destructive local write (`fileManager.trashFile`, `vault.delete`, `vault.trash`, `vault.rename`, `adapter.remove`), and asserts it against a pinned disposition table in which every site is either **gated** (naming its gate) or **explicitly dispositioned out of scope** (naming why). The five routes of §3 Verification 1 are the expected content; a sixth appearing is a **test failure**, not a silent addition.
   - **Observable:** the executed table in the report, site by site, with the file and symbol for each. R5 appears as an explicit *out-of-scope, presence-driven* row rather than being absent.
   - **Vacuous if:** the census is a hand-written list. A hand-written list is exactly what produced this WP — WP80 read one sink and stopped, and the run then hardened one door twice. It must be **derived from the tree**, and it must carry a **positive control**: an injected temporary destructive call in a manifest-reachable path is detected. A census that cannot detect a new door proves nothing about the doors it lists. Equally vacuous: a grep-shaped derivation that cannot match a known-present site — the pattern's ability to match the **five known sites** is itself asserted (rule 15).

2. **No unevidenced destructive local write on a vanished manifest key — the trash arm. RED first.**
   - **Observable (live), and this is the WP's Definition of Done:** the WP80 shape, on two live instances, with WP80's producing-side gate **disabled at its seam** so a truncated purging manifest actually reaches the wire (this is the only way to feed the consumer the input the WP exists to survive — and it is this run's own established technique, `ImplementationReport_WP80.md` §AC3). The peer that **holds** the file is the oracle: the manifest key is shown to disappear from `manifest.info.paths` on **both** instances (the entry-into-the-path control), and **the file is still on that peer's disk afterwards**, with the route's decision reporting a refusal and a stated reason.
   - **RED is required, not optional:** the identical scenario on the **unrepaired** `registerManifestChangeHandler` must destroy the file. This project's standard is a bundle built and installed on the same two instances (`ImplementationReport_DataLossChain.md` §5); a seam-disabled build of the same bundle is admissible and must be stated as such, naming which seam was disabled.
   - **Vacuous if:** the manifest key never disappeared — then nothing entered the route and the survival is meaningless; the before/after `manifest.info.paths` comparison is what forbids this. Equally vacuous: asserting only that the manifest entry survived. **The oracle is the file on disk**, because an entry surviving while the file was already trashed is precisely the outcome WP80's RED run recorded. Equally vacuous: running the scenario on a peer that never held the file.

3. **A manifest key retired for bookkeeping does not destroy a directory. RED first, and the composition is reproduced before it is repaired.**
   - **Observable (live):** producer 5 of §3 Verification 2, driven end to end on two live instances — an empty shared subfolder created on the host and materialised on the guest, then a `.md` file created inside it on the host. The guest's oracle is its **file system**: the folder and its contents are still present afterwards, and the route reports what it decided about the vanished directory key.
   - **RED is required:** on the unrepaired build the same scenario must be shown producing the destructive outcome — either `trashFile` on the `TFolder` (the guest already held the file) or the folder-renamed-into-itself throw at `main.ts:319` (it did not). **Which of the two occurs is a measurement, not a prediction**, and the report states which, with the recorded precondition (whether the guest held the file at the moment the manifest event arrived). **If neither occurs, that is a finding and an ESCALATE — the trace in §3 Verification 2 is stated as traced-not-measured and must not be defended past a contrary measurement.**
   - **Vacuous if:** the directory entry was never in the manifest, or the guest never materialised the folder. Both preconditions are **recorded from `manifest.info.paths` and a directory listing before the act**, not assumed. Equally vacuous: a `.canvas` file is used — `FileOpsManager.onFileCreate`'s content push is WP83's subject and a `.canvas` would make the timing depend on a sibling WP's state. **Use a `.md`.**

4. **The rename arm may not move a user's file on an unpaired removal — and a real rename still works.**
   - **Observable (live), both halves in the same run:** (a) a manifest event carrying an unrelated removal and an unrelated addition does **not** relocate any local file — the peer's shared-folder file set is compared by **set difference** before and after, and is unchanged except for the genuinely added path; (b) **the positive half** — a real rename performed on the host (`manifest.renameFile`'s re-key, `manifest.ts:652+`) still arrives on the guest as a rename: the old path is gone, the new path exists, **and the content is byte-identical to the original** (the hash, not the mere existence of a file at the new path).
   - **Vacuous if:** only half (a) is asserted — refusing to rename anything satisfies it and breaks every legitimate rename, which is the same lobotomy AC5 guards against on the deletion side. Equally vacuous: half (b) asserted by the new file merely existing; a fresh empty file at the new path passes that. **The content hash is the oracle.** Equally vacuous: constructing (a) from a hash-matched pair — the defect is in the **unmatched** fallback (`main.ts:300-302`), so the scenario must record that no hash pair was available.

5. **Legitimate deletions still propagate. Non-empty, on both routes, and this criterion may not be trimmed.**
   - **Observable (live), the mandatory positive control:** (a) **the op route** — a shared file deleted on the host disappears from the guest's disk, exactly as today, with the guest's shared file set shown shrinking by that named path; (b) **the gated route** — the accepted data-loss control still passes unchanged: `H:\tmp\liveshare_dataloss_e2e.py` `[S2]` *"a live host's fresh manifest still deletes (the fix is not a lobotomy)"* → `guest_copy_present=False`, on the shipped bundle. That is the same instrument both prior data-loss fixes were accepted on, and it stays green **without amendment**.
   - **Vacuous if:** the deleted-path set is empty or constant. It must be **non-empty and named**, and it must **change with the scenario**. Equally vacuous: asserting propagation only through the route the WP did not change (a), so a repair that quietly disabled the gated route (b) would still pass. **Both halves are required, and (b) is an inherited suite that is run, not reasoned about.**

6. **The route says what it did. No destructive branch, and no refusal, is silent.**
   - **Deliverable:** for each manifest change the handler processes, a reported disposition per vanished key — at minimum *what was destroyed*, *what was refused*, and *the stated reason* — in the precedent of `StaleReconcileDecision` (`types.ts`, D2) and `ManifestPublishDecision` (WP80), and for the same reason the D2 batch gave: *"I deleted three files", "there was nothing to delete" and "I had no business deciding" were the same observation — silence. A destructive operation that cannot say which of those happened cannot be audited."* The handler's existing `.catch` at `main.ts:396-398` must additionally stop being the only trace of a pass that aborted mid-way (§3 Verification 2, step 4, first branch).
   - **Observable (live):** in AC2 and AC3 the reason field is non-empty and **names what it could not account for**; in AC5(a) the destroyed set is non-empty and names the path. The decision is **returned by the production code and read back**, never composed by the rig — `canvas.simulateEdit`'s hardcoded `applied: true` (`e2e-control.ts:1023`) is the shape being avoided, and it has produced false greens in this run at least twice (WP73, WP75).
   - **Vacuous if:** the reason is a constant string, or the disposition is only logged and never observable as state. **A log line is not the oracle** on this project. If no landed E2E command can read it, **one additive, read-only command is licensed** on the `manifest.lastPublish` precedent — additive only, no existing command's shape or behaviour changed, and see §5 for the `e2e-control.ts` contention.

**Definition of Done:** a manifest key that vanished for a reason nobody vouched for cannot destroy anything on any peer's disk — demonstrated RED-then-GREEN on two live Obsidian instances by AC2 and AC3, with AC5 showing that deletions that *are* vouched for still land.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. No Graphify graph exists (declared FALLBACK mode).

### ⚠ Ordering constraints — this WP is contended, and the contention is the main scheduling fact

| File | Contended by | Disposition |
|---|---|---|
| **`plugin/src/main.ts`** | **WP82** (`:191-193`, `:985-988`), **WP85** (`:1249-1273`), **WP86** (`:244-407`) — all three **chartered and unimplemented** | **SERIALISE. WP86 must not be batched with WP82 or WP85.** §9 already carries that constraint for WP82 and WP85 ("all three edit `main.ts`"); **WP86 joins that set.** The regions are disjoint, and that is **not** sufficient: rule 14 exists because a sibling batch reverted `main.ts` in the shared tree between WP81's edit and its stage, leaving no trace in its own diff |
| **`plugin/src/files/file-ops.ts`, `plugin/src/utils.ts`** | **an agent is LIVE in both** (WP83) | **WP86 reads them and edits neither, so WP86 IS batchable with WP83.** One coupling, stated so a green cannot silently become unreproducible: AC3's *"the guest already holds the file"* branch depends on `onFileCreate`'s unguarded content push (`file-ops.ts:375-405`) for its **timing** — which is exactly what WP83 removes. WP83 removes it **for shared paths its predicate answers for**; **AC3 uses a `.md`**, and the report must state which build of `file-ops.ts` was installed when AC3 ran |
| **`plugin/src/testing/e2e-control.ts`** | WP37, WP80 and WP81's case have all landed here; WP85 explicitly declines it | **WP86 needs NO new command for AC1–AC5.** `manifest.info`, `session.info`, `session.reconcileStale`, `manifest.lastPublish`, `session.promoteToHost`, `session.demoteToGuest` are all landed and sufficient. **At most ONE additive read-only command is licensed, and only if AC6 cannot otherwise be satisfied.** If it is taken, say so — it changes nothing about the WP82/WP85 serialisation, which is already absolute |
| **`plugin/src/types.ts`** | shared, additive-at-top by convention | Any new interface goes **at the top**. See §3 |

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is guarding the trash arm and leaving the rename arm.** That is the defect this WP exists to answer, repeated inside the WP's own diff: WP80 guarded one sink and the other one destroyed the file. **AC1's tree-derived census and AC4 exist to make that fail**, and neither may be trimmed.
  - **⚠ The second most likely is deleting the deletion.** *"A vanished key must not destroy anything"* reads as an instruction to stop trashing. A guest would then never lose a file its host deleted while it was away, forever. **AC5 exists to make that fail**, and it has two halves for a reason.
  - **⚠ The third is re-deriving WP80's completeness predicate on the consuming side.** It is unsatisfiable and it is a second definer: the publisher's knowledge is **not on the wire**, which is why WP80 had to be producer-side. A consumer-side "was that host complete?" check is a guess wearing a gate's clothes.
  - **⚠ The fourth is folding this into `cleanupStaleFiles`.** Two independent gates on two sides of one route is the design the D2 batch and WP80 chose deliberately. WP86 may **call** the landed gate; it may not absorb it, move it, or re-derive its conditions in a third place (hard-won rule 10).
  - **⚠ The fifth is gating on time.** *"Wait N ms before acting on a removal"* is a clock, on a project whose entire freshness design is a monotonic `seq` precisely because *"freshness has to survive two peers whose clocks disagree"* (`manifest.ts:60-68`). Wrong by ruling, not by taste.
  - **⚠ A `TAbstractFile` is not a `TFile`.** `main.ts:368-369` is the only destructive sink in this handler that does not check, and producer 5 is the consequence. A repair that adds evidence but keeps handing a `TFolder` to `trashFile` has fixed half of AC3.
  - **⚠ Do not move `armCanvasMirrorPass` or `armStaleReconcileRetry`.** Their positions are measured results with a recorded regression behind them (`ImplementationReport_DataLossChain.md` §5; `main.ts:623-626`). See §2.
  - **⚠ Do not assume WP80 protects the input.** WP80 constrains what a **WP80 peer** publishes. A peer on an older bundle, and producers 1 and 5 on **any** bundle, still delete entries. This route consumes whatever arrives.
  - **⚠ `session.info`'s `role: host` can be true on a peer that is not connected at all** (WP82's finding, and it is *"directly relevant to WP80"* by the Dispatcher's own note). Any criterion that uses "a live peer claims host" as a precondition inherits that weakness — **do not build a new one on it**; the landed `hasFreshPublication` is the honest operand.
  - **⚠ Scenario `[07]` is FLAKY and is not a verdict on anything.** Do not gate on it in either direction.
  - **⚠ Canvas E2E's current baseline is 13/18, not 19/19** (S30 / WP82). Five failures are pre-existing; do not record them as this WP's, and do not record their absence as this WP's either.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report, a fixture, a test name or a commit message. Keys may be named; values may not.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. Violated once already in this run.

- **Known flaky patterns:**
  - No wall-clock sleeps. Live waits are `sync.waitQuiescent` or a bounded wait that names the condition it was waiting for on expiry.
  - **Every WP86 scenario must be idempotent** — per-run ids, a sweep at preflight *and* teardown, set comparison rather than hardcoded expectations, and a **SKIP recorded as a SKIP**, never folded into the pass count.
  - **Record the role each instance actually RESUMED as** (from its own `[session] resuming as …` line). The relay's election is a coin flip — 34 transitions in 2 h 05 min, no alternation (S27, S37) — so a green that does not state which peer was host is a lottery ticket.
  - Do not assert on log strings as the primary oracle; **state is the oracle** — here, the file system in both vaults, plus `manifest.info.paths`. A decision object asserted **in addition** is what AC6 requires, not instead.
  - A test that asserts an absence — *"the file was not deleted"* — is suspect by default. Ask what it would take to fail, write that down, and pair it with the discriminating positive. **This charter makes that pairing mandatory rather than advisory** (the header note to §4).

- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **No `server/**` edit**, in any file, for any reason. §7 abort criterion outside WP41.
  - **No edit to `plugin/src/files/file-ops.ts` or `plugin/src/utils.ts`** — a sibling agent is live in both.
  - **The D2 consuming-side gate is byte-unchanged**; `plugin/src/__tests__/dataloss/**` is not deleted, weakened, retitled, skipped or amended.
  - **`files/manifest-purge-decision.ts` and `publishManifest`'s consultation are byte-unchanged.**
  - **No third predicate.** The verdict either delegates to the landed gated route or reads the landed evidence functions.
  - **`seq`, never a clock.** No sleep, no debounce, no `publishedAt` gate.
  - **A refusal never destroys, and never cancels the non-destructive work** of the handler pass.
  - **No destructive branch is silent**, including the handler's `.catch`.
  - **A `TFolder` never reaches `trashFile`.**
  - **The five registration sites and the intra-handler ordering are unchanged.**
  - **`canvas.simulateEdit` is not used.** `useCanvasBinding` is not flipped. The plugin version is not bumped. `plugin/manifest.json` (a broken symlink) is not read or edited. `BUILD_SPEC_CanvasV2.md` is not edited by the implementor.
  - **No `DONE` work package is re-opened; WP86 holds no §7 licence of any class.** A reddened inherited assertion is an ESCALATE, left red.
  - **No owner-vault file is read into an artefact, hashed into a report, fixtured or named by value; no secret through any agent tool.**
  - **Rule 14:** never `git checkout --`, `git restore` or `git stash` a shared path. `git commit -o <paths>` only, with `git status` re-read **immediately** before each commit. `WORKFLOW_ANALYSIS.md` is not this WP's and is left untouched and unstaged.

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP86's scope. Each is recorded so it is not rediscovered as a finding.*

- **R5, the presence-driven overwrite.** `syncFromManifest` overwrites a local file whose hash differs from the manifest entry's (`manifest.ts:481-492` → `:513`), driven by an entry's presence. A destructive local write reachable from a manifest change, but of the opposite class to this WP's, and adjacent to WP83 and WP85. **Recorded as an explicit out-of-scope row in AC1's census. Owner: none assigned.**
- **The handler's swallowing `.catch`** (`main.ts:396-398`). A throw anywhere in the pass — including the folder-into-itself rename of §3 Verification 2 — skips `syncFromManifest`, the removal loop and `armCanvasMirrorPass` for that event, and logs one line. AC6 requires it stop being the only trace; **making the pass resumable is not in scope.**
- **S40 / the `OfflineQueue`.** Unbounded, and its drain edge can no longer occur once WP82's latch is wrong, so the file-op delete route can silently fail to deliver. **WP82's, named in the ruling as the one residue R1 uniquely covered. Owner: WP82 for the cause; the residue itself unowned.**
- **S25 — host identity is unstable across restarts.** `server/src/control-handler.ts:588`. Makes producer 2 routine rather than exceptional. **Server-side; needs a WP licensed to touch `server/**`. Owner: none assigned.**
- **Producer 5's own shape, if AC3's RED contradicts §3 Verification 2.** The trace is stated as traced-not-measured. A contrary measurement is a finding to escalate, not a trace to defend.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/main.ts` — `registerManifestChangeHandler` only: the two sinks, the reported disposition
  - `plugin/src/files/` — one new headless decision core, if the verdict is taken by one (recommended, not mandated)
  - `plugin/src/types.ts` — the disposition interface, **at the top of the file**, if one is added
  - `plugin/src/__tests__/` — AC1's tree-derived census with its positive control
  - `plugin/src/testing/e2e-control.ts` — **only** if AC6 requires it; one additive read-only command, nothing else changed
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP86 row and the §7 / header counts (84 → **85** live), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP86.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: **AC1's census as executed**, site by site with its dispositions and its injected-site positive control; **AC2's RED and GREEN in full**, naming which bundle and which disabled seam produced the RED, with the before/after `manifest.info.paths` on **both** instances and the file-system state of the peer that held the file; **AC3's RED**, stating which of the two destructive outcomes occurred and the recorded precondition that decided it, plus which build of `file-ops.ts` was installed; **AC4's both halves**, with the content hash for the positive half and the recorded absence of a hash pair for the negative; **AC5's two routes**, each with a non-empty named deleted set, and the inherited data-loss suite's result quoted verbatim; **AC6's decision objects** for a destroyed branch and a refused branch; a quoted statement that `main.ts:725-782`, `manifest.ts`'s evidence functions, `files/manifest-purge-decision.ts` and `plugin/src/__tests__/dataloss/**` are **byte-unchanged**, and that `file-ops.ts` and `utils.ts` were **not edited**; confirmation that **no `server/**` file was modified**, that the five registration sites and the intra-handler ordering are unchanged, and that **no clock gates anything**; the **executed test count** for the plugin suite before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; the **role each instance resumed as** for every live run; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision**.*

**Acceptance evidence — two live Obsidian instances.** `H:\tmp\liveshare_wp86_e2e.py` (new, idempotent: per-run ids, sweep at preflight **and** teardown, set comparison, roles restored, SKIP recorded as SKIP, and a **vacuity guard** that turns "the key never vanished" into a SKIP with its reason rather than a pass). Ports 39431 (A) / 39432 (B). `canvas.simulateEdit` is not called.

| id | AC | what it drives | oracle |
|---|---|---|---|
| `[S1]` | AC3 | producer 5: a shared folder both peers hold, then a `.md` created inside it — `updateFile` retires the parent directory key | **the file system on BOTH vaults**: the folder and its contents; plus the directory key's before/after presence in `manifest.info.paths` on both |
| `[S2]` | AC2 | the WP80 shape, removal-only: a 4 MB canary only the host holds, then a REAL `plugin.promoteToHost` on the mid-sync peer, with WP80's gate disabled at its seam | **the disk of the peer that HELD the file**, plus the key's measured disappearance on both |
| `[S3]` | AC4a | the same shape plus a 4 MB file only the guest holds, so one publication transaction carries an unpaired removal **and** an addition | the host's shared **tree set difference**, plus the product's own `renames` refusal row |
| `[S4]` | AC4b | a real rename on the host | the guest's disk: old path gone, new path present, **content hash byte-identical** |
| `[S5]` | AC5a | a live host publishes, then deletes a shared file | the guest's shared set shrinking by that **named** path, plus the route's `destroyed` set and the gated route's own decision |
| `[S6]` | AC6 | reads every disposition observed in the run | the reasons are **distinct**, non-empty, and produced by production code |

**Headless tests, where they are the honest tool and not the acceptance evidence:**

| file | subject | tests |
|---|---|---|
| `plugin/src/__tests__/v2/wp86/test_tp01_vanished_key_sink_census.test.ts` | AC1's tree-derived census, its injected-site positive control, and rule 15 for the sink pattern and the body extractor | 8 |
| `plugin/src/__tests__/v2/wp86/test_tp02_removal_decision_core.test.ts` | both pure cores' truth tables, every unknown input, non-mutation, statelessness, no empty reason | 13 |

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** confirmed live, RED, on two vaults. Producer 5 destroyed a shared folder **and the file inside it on BOTH instances**. The WP80 shape destroyed a 4 MB canary on the peer that held it (`present=False`) while the key measurably vanished from both manifests. **One correction to §3 Verification 2: producer 5 is TWO `Y.Map` events, not one** — `updateFile` `await`s between the parent-directory `delete` and the file `set`, ending the implicit Yjs transaction — so it never reaches the rename arm and `trashFile(TFolder)` is its **only** outcome. Recorded as S50; it makes the shape worse, not milder.
- **Approach:** the trash sink is **removed** from the handler rather than gated. A vanished key with a local **file** behind it is `delegated` to the landed, byte-unchanged `cleanupStaleFiles`, which already owns the evidence gate; a **folder** is `refused` by name; nothing behind it is `nothing-to-destroy`. The rename arm's destructive half now requires `preferred === newPath` (an equal content hash from `matchRenamesByHash`) **and** a `TFile` at the removed path. Two pure cores in `files/manifest-removal-decision.ts` (zero imports), one `ManifestChangeDisposition` at the top of `types.ts`, one additive read-only rig command. **No third predicate is authored** — the core has no destructive branch at all.
- **Fallback path if all attempts fail:** not needed; no attempt was consumed.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all six ACs. AC1 census derived from the tree with an injected-site positive control (8 tests). AC2 and AC3 RED-then-GREEN on two live instances. AC4 both halves. AC5 both routes, the inherited `liveshare_dataloss_e2e.py` **12/12 unamended** including `[S2] guest_copy_present=False`. AC6 observable as state with four distinct production-authored reasons and a **non-empty, named** destroyed set. Unit **2157/2157** with WP86 on a clean `d7eda85` versus **2136/2136** at that baseline; `npm run build` PASS. Commit `1494319`.
- **What remains open:** **AC4b's positive half was satisfied by its own observable, not by a live R2 execution** — with both peers connected the file-op route applies the rename first, on the repaired **and** the pre-repair build alike. Reaching R2's positive branch live needs an offline rename across a restart; it was not run and no claim is made that it was. Four findings carried up (S50–S53) — see `ImplementationReport_WP86.md` §9.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Do not read a lingering file as a WP86 regression.** Under WP82's latch defect (`role=host, connected=false`) the op route is silently dead for the whole session and the gated route cannot establish a fresh publication, so a deleted file **stays** on the peer instead of being destroyed. That is the trade this WP makes deliberately (S51), measured live in run `20260805-055651`.
- **Probe R2's positive branch.** The one path this run could not exercise live. An offline rename across a restart is the shape.
- **AC2 and AC3 cannot be re-measured on a shipped bundle** — WP80's producing-side gate refuses the truncated purge, so nothing enters the route. The suite records that as a SKIP with its reason; a green there without the seam disabled would be vacuous.
- **Record the role each instance RESUMED as** for every re-run (S37).
