# Task Charter — WP80: a peer may not purge a manifest it cannot know is complete

<!-- Updated: chartered 2026-08-05 (B20) from `ImplementationReport_DataLossChain.md` §8 row 2, re-verified against the current tree on branch `fix-bugs-and-raceconditions` per hard-won rule 12. The reported defect HOLDS exactly as described, and the re-verification added the fact that changes its priority: the D2 evidence gate does **not** bound it. A newly-promoted host's truncated purging manifest satisfies BOTH of `cleanupStaleFiles`' conditions — `hasFreshPublication` is true because the promotion itself advances `seq` under a foreign `hostId`, and the promoted peer is a live peer claiming host — so the guest deletes. See §3 Verification 2. The report's "now bounded on the consuming side" is true of the *hostless* shape and false of *this* one. Every line number below was measured by reading the tree. No Obsidian was launched, no vault file was written, no `data.json` value was read or printed, no relay was contacted, no E2E script was run. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP80
**Phase:** P3
**task_mode:** `standard`
**Depends on:** the D1/D2/D3 data-loss chain (landed `6380e28`, `94a09c7`, `d9390ba` — an emergency batch with no WP number; its `ManifestPublication` attestation and its `StaleReconcileDecision` are both prerequisites and precedents)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a peer publishes a manifest that **deletes entries** only when it can know the entry set is complete. Today `publishManifest({ purge: true })` computes the entry set from **this peer's own local disk** (`files/manifest.ts:192` → `getSharedFiles()` at `:594`) and then deletes every manifest key not in that set (`:234-240`). A peer whose initial sync has not completed has a local disk that is a strict **subset** of the room's shared set, so the purge removes entries for files that exist on other peers and simply have not arrived here yet. After this WP a purge requires **positive evidence of completeness**, exactly as a deletion now requires positive evidence of authority; a peer that cannot establish completeness still publishes — **additively** — and says so.
- **The parallel is the point, and it is exact.** The D2 repair made the *consumer* require positive evidence before deleting a file. WP80 makes the *producer* require positive evidence before **asserting completeness**. A manifest published by a peer that cannot know the full set is the same defect as a deletion decided by a peer that cannot know what the host said: in both cases an **absence of information is converted into a destructive statement** (I11, one level up).
- **Why this is live now and was not before.** The D1 repair made **promotion work for the first time** (`sync/control-handlers.ts:193-195`; `main.ts:2046` `promoteToHost`). Promotion now actually happens, so a producing path that was effectively unreachable is reachable on every restart — and the relay re-elects a survivor on every host disconnect (`server/src/control-handler.ts:568-591`), which means it happens **routinely**, not exceptionally.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP80**; section 4.5 invariants **I11 REFUSAL NEVER DESTROYS** and **I3 DOC IS TRUTH**; section 4.7 (the manifest arm of the data flow). Phase **P3**, because the manifest document is the P3 surface (§2, *"P3 … manifest doc gains `path → {mode, guid}`"*) and this WP changes what that document is permitted to assert.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify + create, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: make "may I delete manifest entries?" a **decided, named, reported** question instead of a caller-supplied boolean, and make the answer fail closed.
  - Scope summary: one **pure decision core** (zero imports, in the precedent of `files/canvas-seed-decision.ts` and `files/canvas-mirror-decision.ts`) that answers, from facts the peer already holds, whether a publication may purge · `publishManifest` consults it and **returns a decision instead of `void`** · the four purge call sites become wiring · one additive E2E control command so the decision is observable on a live instance.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a **§7 abort criterion**. The relay's auto-election (`server/src/control-handler.ts:568-591`, the rewrite at `:588`) is what *creates* the promotion; it is **not** what decides to purge. See the ruling in §3 — the fix is client-side and client-side is sufficient.
  - **⚠ Host identity instability across restarts.** Carried up by the data-loss batch (§8 row 1) and **named here, not covered here**. The election swaps host and guest on every restart, churning a full purge-republish each time. WP80 makes that churn **non-destructive**; making it **not happen** is a server change and belongs to a WP that may touch `server/**`. Recorded as **S25**. A WP80 that "fixes" it by editing `server/` has aborted.
  - **⚠ Weakening, widening, re-deriving or relocating the D2 consuming-side gate.** `main.ts:679-702` (`cleanupStaleFiles`'s two conditions), `manifest.ts:170-176` (`hasFreshPublication`), the `manifest.size === 0` floor at `main.ts:709-711`, the removal of the reconcile from `demoteToGuest`, and `armStaleReconcileRetry` (`main.ts:210`) all keep their current behaviour **exactly**. WP80 is a second, independent gate on the other side of the wire. Two independent gates is the design; folding them into one is the failure.
  - **⚠ Deleting, weakening, retitling or skipping any test in `plugin/src/__tests__/dataloss/`.** Those nine tests pin the consuming side. WP80 holds **no §7 licence of any class**.
  - **The attestation's shape.** `ManifestPublication` (`manifest.ts:60-74`) keeps `hostId`, `seq`, `publishedAt`, keeps being written **inside the same transaction as the entries** (`:233-263`), and `publishedAt` stays diagnostics-only — **no criterion may gate on a clock**. Adding a field to the attestation is permitted **only** if AC1 cannot otherwise be satisfied, and then it is stated in the report as a wire-visible change with its backward-compatibility argument; a peer running an older build must never read a new field's absence as a licence to delete.
  - **The manifest entry shape** (`FileEntry`), the sidecar format, the wire protocol, the relay's persistence.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** The flag is `false` (`types.ts:65`) and frozen until P5; flipping it is a §7 abort criterion. **No criterion here may depend on any unbuilt phase.**
  - **`canvas.simulateEdit`.** Not used, not extended, not repaired. It writes straight into the `Y.Doc` (`testing/e2e-control.ts:995-1005`) and returns a hardcoded `applied: true` (`:1023`). Remote edits in every WP80 scenario are driven by **writing files on disk**.
  - **The `isSharedPath` prefix-match question.** Two artefacts disagree (WP79's charter §3 Verification 5 says CLOSED-negative; the data-loss report §8 row 3 says unverified). **WP80 neither settles it nor depends on it** — recorded as **S26** so the disagreement is not inherited as a fact in either direction.
  - **Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: `ManifestManager.getEntries()` (`manifest.ts:537-540`), `getPublication()` (`:150-156`), `hasFreshPublication()` (`:170-176`), `seqAtConnect` (`:110`), `isSharedPath()` (`:542-`), `getSharedFiles()` (`:594`), the local vault file list, and the peer's own role and id
  - Output: one pure decision core; a decision **returned** by `publishManifest`; wiring at the four purge call sites; one additive E2E control command
  - **Blocks nothing.** Product-safety scope, off the WP7 gate's critical path.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

Stated explicitly because the brief requires it not be left implicit. Each clause is measured, not argued.

1. **No `DONE` work package is re-opened.** `publishManifest`'s purge behaviour was never chartered as an acceptance criterion of any WP: it predates the initiative, it is not named in any §5 component, and the emergency data-loss batch that touched this file **explicitly declined it** (`ImplementationReport_DataLossChain.md` §8 row 2, *"A real fix is … its own work package"*). WP80 is that work package.
2. **The data-loss batch has no WP number, so there is no `DONE` WP to re-open even in principle** — but its tests are inherited and binding. WP80 holds **no §7 licence of any class**; an unenumerated deletion, weakening or assertion rewrite in `plugin/src/__tests__/dataloss/` or anywhere else is an **abort criterion**, exactly as for every other WP.
3. **Widening `publishManifest`'s return type is source-compatible for every `await`ing caller** (`main.ts:557`, `:796`, `:2053`, `sync/control-handlers.ts:127`, `testing/e2e-control.ts:1064`, and the local interface declaration at `:764`). If, despite that, an inherited exact-shape assertion reddens, that is an **ESCALATE with the measured before/after, left red** — not a rewrite. Worker 2 does not assume a licence.
4. **`main.ts` gains wiring only.** §3.1 S11 and the §7 abort criterion are absolute: the decision lives in a headless module; `main.ts` may only construct, inject and forward. A conditional over manifest or sync state written inside `main.ts` is an abort, not a shortcut.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

> ⚠ `plugin/src/main.ts` is being modified **concurrently** by the WP79 implementor. Its line numbers below were read from the working tree at charter time and **will drift**. Every `main.ts` reference is therefore given with the symbol name as well; resolve by symbol, not by number. `files/manifest.ts`, `sync/control-handlers.ts`, `plugin/src/types.ts` and `plugin/src/testing/e2e-control.ts` were clean at charter time.

**Verification 1 — the producing defect is real, and it is a purely local computation.**

| site | what is there |
|---|---|
| `files/manifest.ts:189` | `async publishManifest(options?: { purge?: boolean }): Promise<void>` — the caller supplies `purge` as a bare boolean; nothing is asked, nothing is decided |
| `files/manifest.ts:190` | `if (!this.manifest || !this.docHandle) return;` — a **silent** no-op. "I published" and "I could not publish" are the same observation. See Verification 4. |
| `files/manifest.ts:192` | `const files = this.getSharedFiles();` → `:594`, which enumerates **this peer's own vault** |
| `files/manifest.ts:194-231` | the entry set is built **only** from those local files (plus local empty folders) |
| `files/manifest.ts:234-240` | `for (const filePath of this.manifest?.keys() ?? []) { if (!entries.has(filePath)) this.manifest?.delete(filePath); }` — **every key the local disk does not account for is deleted** |
| `files/manifest.ts:250-262` | the attestation is written in the same transaction, so the truncated set arrives **vouched for** |

The entry set is a statement about **one peer's disk**. The purge turns it into a statement about **the room**. Nothing between them checks that the two are the same thing.

**Verification 2 — the D2 gate does NOT bound this shape. This is the fact that changes the priority.**

The data-loss report says the hazard is *"now bounded on the consuming side"*. That is true of the **hostless** shape and **false of this one**. Trace it through `main.ts` `cleanupStaleFiles` (`:679`):

| gate | what a newly-promoted host's purging manifest does to it |
|---|---|
| `:685-687` role guard | passes — the **consumer** is a guest, unchanged |
| `:689-698` condition 1, `hasFreshPublication(this.userId)` | **passes.** `promoteToHost` (`main.ts:2046`) publishes immediately (`:2053`), which advances `seq` past the guest's `seqAtConnect` (`manifest.ts:110`, `:258-261`) under a `hostId` that is **not** the guest's — so it is fresh *and* the peer is not its own witness |
| `:699-702` condition 2, a live peer claiming host | **passes.** The promoted peer is present, connected and `isHost` |
| `:709-711` the `manifest.size === 0` floor | **passes.** A partially-synced peer's manifest is non-empty; it is *short*, which is precisely the case D3 established the floor cannot catch |
| `:713-729` | the guest **trashes** every shared local file the truncated manifest omits |

**So the two evidence conditions are satisfied by a manifest that is wrong.** They were designed to answer *"did a live host say this?"*, and a live host **did** say it. They cannot answer *"could that host know?"*, because that fact is not on the wire. **WP80 is not defence in depth on a closed path; it is the one remaining live route from a correct promotion to a destroyed user file.**

**Verification 3 — the four purge call sites, measured, with what each one knows at the moment it fires.**

| # | Site | Symbol | What the peer knows about completeness |
|---|---|---|---|
| 1 | `main.ts:557` | `resumeSession`, host arm | It was host before the restart and its disk is its own. **Strongest case** — but it has just connected and has not yet observed the room's manifest, so "its disk is authoritative" is a *policy*, not a fact it checked. |
| 2 | `main.ts:796` | `startSession` | It is creating the room. The manifest is empty or its own. **Genuinely safe**, and the criterion must not break it. |
| 3 | `main.ts:2053` | `promoteToHost` | **The defect.** It may have been a guest seconds ago, mid-`syncFromManifest`, with an arbitrary fraction of the room's files on disk. It publishes and purges immediately. |
| 4 | `sync/control-handlers.ts:127` | `presence-update`, new-peer republish | Mid-session, host already established. Usually complete — but it is a **repeat** of whatever state site 3 left behind, so a wrong purge is re-asserted with a fresh `seq` and cannot age out. |

`promoteToHost` is reached from **two** places, both routed through the one idempotent implementation: the `join-response` verdict (`sync/control-handlers.ts:193-195`) and `host-transfer-complete` (`:309-311`). The report's claim that *"the identical shape exists on the `host-transfer-complete` path"* is confirmed and is now **the same code**, so one repair covers both.

**Verification 4 — `promoteToHost`'s publish can be a silent no-op, and nothing anywhere would show it.**

`resumeSession` (`main.ts:~552`) is `await this.connectSync(); await this.manifestManager.connect(this.syncManager); …`. `connectSync` establishes the control channel and issues the `join-request`; the `join-response` therefore arrives **asynchronously and may land while `manifestManager.connect(...)` is still awaiting `waitForSync`**. `promoteToHost` then runs with `this.manifest === null`, and `publishManifest` returns at `manifest.ts:190` **without publishing and without saying so**. The peer is host, believes it published, and no attestation exists.

This is the **same silence class** the D2 repair fixed for `cleanupStaleFiles` — *"I published", "there was nothing to publish" and "I could not publish" are one observation"* — and it is why AC2 requires a returned decision rather than only a corrected `purge` flag. Recorded as measured **code shape**; whether it has fired live is not established and AC2 does not depend on it having fired.

**Verification 5 — the observability instrument does not exist, and this WP owns it.**

`routeCommand` (`testing/e2e-control.ts:435-573`) exposes: `session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `canvas.setFlag`, `canvas.clearFlags`, `sync.waitQuiescent`, `scratch.create`, `scratch.remove`, `canvas.file`, `manifest.info`, `session.reconcileStale`, `manifest.publish`. **`plugin.settings` is not among them** — the only occurrence of that string is a flag-owner label at `:1253`, not a command.

`manifest.publish` (`:1057-1066`) calls the real method and returns `{published: true}` — **a literal**, because the real method returns `void`. It cannot report *whether the publication purged*, *what it deleted*, or *why it was allowed to*. So AC1 and AC3 have no instrument today. Per the owner's standing instruction — *"Falls das e2e plugin noch bugs hat gerne bei w3 in revision geben"* — the missing observability is chartered **here, inside WP80**, as a W3 revision, and `manifest.publish`'s hardcoded `{published: true}` is corrected as part of it (AC5).

- **Component(s) being changed:** `files/manifest.ts` (the publication decision and its report), a new headless decision core in `plugin/src/files/`, `plugin/src/types.ts` (the decision interface, **at the top of the file**), `main.ts` and `sync/control-handlers.ts` (wiring only), `testing/e2e-control.ts` (additive).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS.** A peer that cannot establish completeness must still be **useful**: it publishes additively so new and changed files reach peers. Refusing to publish at all would strand the room. The refusal is of the **deletion**, never of the publication.
  - **I3 DOC IS TRUTH.** The attestation keeps riding the entries' transaction (`manifest.ts:233-263`). No orderings become representable that are not representable today.
  - **`seq`, never a clock.** `publishedAt` stays diagnostics-only. A criterion that gates on wall time is wrong on this project by ruling.
  - **`useCanvasBinding` stays `false`.** No criterion depends on P4 or P5 behaviour.
  - **⚠ `plugin/src/types.ts` — position is load-bearing.** The new decision interface goes **at the top of the file, beside `StaleReconcileDecision` (`types.ts:13-22`)**, and not below `DEFAULT_SETTINGS`. `DEFAULT_SETTINGS` contains a `//` comment holding the literal `` `${configDir}/**` ``; the WP22 dormancy test strips comments with a naive non-greedy `/\*[\s\S]*?\*/`, so that `/**` opens a block comment as far as the test is concerned and any JSDoc added **below** it supplies the `*/` that closes the pairing, swallowing `useCanvasBinding: false,` and reddening a test that has nothing to do with this change. Documented by the data-loss batch (`ImplementationReport_DataLossChain.md` §10) after it was paid for once.
  - **Data safety.** No owner-vault file is read into an artefact, hashed into a report or pointed at by a fixture. **Both vaults' `data.json` hold live credentials** — never printed, logged, echoed into a report, a test name, a commit message or a fixture. **Keys may be named; values may not.** Comparison, if any is ever needed, is sha256-of-bytes only. **No secret through any agent tool**, in any command string or script argument.
- **Technology / framework / config constraints:**
  - TypeScript, `plugin/` workspace, Vitest 4.0.18, pure-core + injected-seam style. **Zero new runtime dependencies** (D11).
  - The decision core takes the impure world by argument, in the precedent of `files/canvas-seed-decision.ts` (*"A pure core … ZERO imports. No Obsidian, no filesystem, no clock, no Yjs"*).
  - **Schema impact:** none expected. If AC1 forces one, see the §2 non-goal — it is reported, argued and made backward-safe, never assumed.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/files/manifest.ts` — `publishManifest` `:189-264`, the silent early return `:190`, `getSharedFiles` `:594`, `getEntries` `:537-540`, `getPublication` `:150-156`, `hasFreshPublication` `:170-176`, `seqAtConnect` `:110`, `connect` `:136-`
  - `plugin/src/files/` — the new pure decision core lives here, beside `canvas-seed-decision.ts`
  - `plugin/src/main.ts` — **wiring only**, at `publishManifest({purge:true})` call sites (`resumeSession` host arm, `startSession`, `promoteToHost`)
  - `plugin/src/sync/control-handlers.ts` — **wiring only**, the new-peer republish at `:114-130`
  - `plugin/src/types.ts` — the decision interface, **at the top**
  - `plugin/src/testing/e2e-control.ts` — `manifest.publish` `:568-573` / `:1057-1066`, `manifest.info` `:556-561` / `:1031-1044`, the host-interface declarations `:348` and `:764`
  - Read-only context, not modified: `main.ts` `cleanupStaleFiles` `:679-731`, `armStaleReconcileRetry` `:210`, `demoteToGuest`; `server/src/control-handler.ts:568-591` (**read only, never edited**)
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/utils.ts`, `plugin/src/files/background-sync.ts`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, `main.ts`'s `cleanupStaleFiles` body, and `plugin/src/__tests__/dataloss/**`. **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### The ruling: this CAN be fixed client-side, it MUST be, and client-side is sufficient

The brief requires this be answered explicitly rather than left as a judgement call. **Ruling: yes.** Three measured reasons and one consequence.

1. **The purge is decided entirely on the client.** `options.purge` originates at four client call sites (§3 Verification 3) and is executed at `manifest.ts:234-240`. The relay is content-blind (BUILD_SPEC §1 non-goals) and has no opinion about manifest entries. **No byte of the deletion decision lives on the server.**
2. **The completeness question is answerable from data the client already holds**, with no new frame and no server help. The peer holds the room's manifest as replayed and synced (`getEntries()`, `:537-540`), the attestation and its `seq` (`getPublication()`, `seqAtConnect`), its own local file set (`getSharedFiles()`, `:594`) and its own membership predicate (`isSharedPath`). *"Every entry the manifest already carried is accounted for locally"* is a computation over those four things.
3. **The server change would not fix this anyway.** Making `room.hostUserId` stable (`server/src/control-handler.ts:588`) removes the *routine* promotion; it does not remove promotion, and a legitimate host transfer to a mid-sync peer produces the identical truncated purge. **A server fix reduces frequency; only the client fix removes the defect.**

**Consequence, stated so it is not discovered later:** the host-identity churn (§8 row 1 of the data-loss report) is **not** covered by WP80 and is **not** fixed by it. WP80 makes each churn cycle harmless; it leaves the churn. That is **S25**, unowned, and it needs a WP that is licensed to touch `server/**` — which no current WP except WP41 is.

**What the correct predicate is, stated as a constraint rather than an implementation.** The safe direction is fixed by asymmetry: publishing additively when a purge was warranted leaves a **stale entry**, which is visible, self-correcting on the next complete publication, and costs a guest one file it could delete later. Purging when completeness was not established **trashes a user's file**. The costs are not comparable, so the predicate must be **conservative in exactly one direction**, and every unknown — a manifest not yet synced, a `getEntries()` that is empty because `connect` has not run, an unresolvable local path, a read failure inside the entry loop (`manifest.ts:216`, which currently swallows into a `Notice` and **omits the file from the entry set**, i.e. a *read error becomes a deletion*) — must resolve to **additive**, never to purge.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**. This run has found ten-plus instances of a green that cannot fail; a criterion that does not name its own vacuity risk is incomplete.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}` (route confirmed at `testing/e2e-control.ts:641`). **Edits are driven by writing files on disk.** `canvas.simulateEdit` is not called by any criterion. **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification-injection requirement, no `BlindVerificationLedger` row is owed. Unit tests are welcome where they are the honest tool and are **not** the acceptance evidence.*

1. **The purge verdict is taken by a pure core, it is a closed set, and it fails closed.**
   - **Deliverable:** a dependency-free function — no Obsidian, no filesystem, no clock, no Yjs — that answers, for one publication, exactly one verdict from a closed set covering at least: *purge licensed* (completeness established), *additive* (publish entries, delete nothing, with a stated reason), *nothing to publish* (no manifest connected — the state at `manifest.ts:190`). It is exported, stateless between calls, does not mutate its argument and never throws.
   - **Observable:** headless, row by row — a truth table over {manifest entries seen, local shared set, own role, own id, attestation present/absent}. **Every** input that is missing, `undefined`, `null` or non-boolean yields *additive*, never *purge*, on the `!== false` discipline `decideSeed` already states in its own header (*"a knowledge probe that cannot answer … is not evidence"*).
   - **Vacuous if:** only the *purge licensed* row is exercised and the rest are treated as obvious. A guard that is right on three rows of four is how R4 was re-armed once already. A test that still passes when one conjunct is deleted has not tested a conjunction. **Each unknown-input row is asserted individually**, and the report carries the executed table, not a summary of it.

2. **`publishManifest` reports what it did, and the silent no-op is gone.**
   - **Deliverable:** `publishManifest` returns a decision — at minimum *did it publish*, *did it purge*, *the stated reason*, *how many entries it published*, *which keys it deleted* — in the precedent of `StaleReconcileDecision` (`types.ts:13-22`) and for the same reason: *"I published", "there was nothing to publish" and "I had no business publishing" must stop being one observation.* The early return at `manifest.ts:190` becomes a **named refusal**, not a bare `return`.
   - **Observable (live):** on a live instance the new control command (AC5) returns the decision produced by the **real** call; the reason field is non-empty in every branch; and the deleted-key list is **exactly** the set that disappeared from `manifest.info.paths` across the call, compared before and after on **both** instances.
   - **Vacuous if:** the decision is a literal, or is assembled by the E2E command rather than returned by the method — that is `canvas.simulateEdit`'s `applied: true` (`e2e-control.ts:1023`) wearing a new name, and it has produced false greens in this run at least twice already (WP73, WP75). The deleted-key list must be shown to **change** with the scenario; a constant satisfies a careless oracle. Equally vacuous: asserting only the happy branch, so the `manifest.ts:190` refusal — the whole reason this AC exists — is never executed.

3. **A peer promoted before its initial sync completes does not delete another peer's file. Measured on two live vaults, with the precondition recorded.**
   - **Observable (live), and this is the WP's Definition of Done:** vault A hosts, vault B is a guest, both hold the same shared set. A file is created on A and, **before B has received it**, B is promoted to host (the natural production route is a restart — the relay re-elects on host disconnect, `server/src/control-handler.ts:568-591`; the scenario asserts the promotion it actually got from `session.info` rather than assuming it). After `sync.waitQuiescent` on both: **the file still exists on A's disk**, its manifest entry is still present in `manifest.info.paths` on both instances, and B's publication decision reports **additive** with a stated reason. The file-system state of both vaults is the oracle.
   - **The precondition must be recorded and asserted, not assumed:** that at the moment B published, B's local shared set was a **strict subset** of the manifest it held — from `manifest.info` and a directory listing, before the publication. Without that record the scenario proves nothing, because a fully-synced peer purging correctly produces the same green.
   - **Vacuous if:** B happened to have finished syncing, which is the *likely* outcome on a fast local relay and would make this pass against the **unrepaired** build. The run must show the pre-repair build **failing** the same scenario with the same recorded precondition — this project's own precedent for building the parent commit's bundle on the same two instances (`ImplementationReport_DataLossChain.md` §5) is the standard. Equally vacuous: asserting only that the *manifest entry* survived. **The oracle is the file on disk in both vaults**, because the manifest entry surviving while `cleanupStaleFiles` has already trashed the file is precisely the outcome this WP exists to prevent.

4. **A host that IS complete still purges — the fix is not a lobotomy.**
   - **Observable (live), the S2-shaped positive control:** with a live, fully-synced host, a file deleted on the host's disk is removed from the manifest **and** trashed on the guest, exactly as today. Session start (`startSession`, an empty or self-owned manifest) still purges. A host that republishes for a newly-arrived peer (`sync/control-handlers.ts:127`) still purges when it is complete. Each of the four call sites of §3 Verification 3 is exercised and reported **separately**.
   - **Vacuous if:** this is asserted by argument (*"the same function is called"*) from one representative site. The four differ in what the peer knows when they fire — that difference **is** the subject of this WP — so a single representative measures the code, not the states it meets. Equally vacuous: a "still purges" assertion whose fixture never had anything to purge; the deleted-key list must be **non-empty** and named.

5. **The instrument exists, reports measured facts, and `manifest.publish` stops returning a literal.**
   - **Deliverable:** one additive E2E control command that publishes through the **real** `ManifestManager.publishManifest` — not a copy, not a re-implementation of its rules (`ImplementationReport_DataLossChain.md` §10: *"A rig command that re-implements the logic it is testing proves only that the rig agrees with itself"*) — and returns the AC2 decision unaltered. The existing `manifest.publish` (`e2e-control.ts:1057-1066`) stops returning the hardcoded `{published: true}` and returns the same decision. Optional on the host interface, on the `canvasFile` / `clearFlags` precedent (`:513-518`, `:348`), so pre-existing fake hosts stay valid. **No existing command's shape or behaviour changes** beyond that one corrected literal.
   - **Observable:** on a live instance, the response's every field is read from the call at call time; a call on a peer that is **not** host, and a call on a peer whose manifest is not connected, both return a **structured refusal with a reason**, not a success and not a thrown 400 that a driver could mistake for a crash. Both failure cases are exercised.
   - **Vacuous if:** the command returns a hardcoded success. This is not hypothetical — it is the defect being corrected in the same breath. Equally vacuous: the response is composed in the E2E layer from facts it gathered itself rather than returned by the method; the discriminator is that disabling the decision core at its seam must change the **command's** answer.

**Definition of Done:** a peer that does not yet hold the room's files cannot make the room forget them — demonstrated on two live Obsidian instances by AC3, with its precondition recorded, and with AC4 showing the legitimate purge intact.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. No Graphify graph exists (declared FALLBACK mode).

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is deleting the purge.** *"A peer that cannot know must not purge"* reads like an instruction to stop purging. Publishing only additively makes the symptom disappear, makes the diff a one-line change, and permanently strands every deleted file's entry in the manifest — so a file the user deletes on the host is never removed anywhere, forever. **AC4 exists to make that fail**, and it may not be trimmed.
  - **⚠ The second most likely is fixing it on the server.** The relay's election is the visible cause, `server/src/control-handler.ts:588` is one line, and it is a **§7 abort criterion** outside WP41. It would also not fix the defect (§3 ruling, point 3).
  - **⚠ The third is gating on time.** *"Wait N seconds after promotion before purging"* is a clock, on a project whose whole freshness design is a monotonic `seq` precisely because *"freshness has to survive two peers whose clocks disagree"* (`manifest.ts:60-68`). A sleep, a debounce or a `publishedAt` comparison used as evidence is wrong by ruling, not by taste.
  - **⚠ The fourth is folding this gate into the D2 consuming-side gate.** They answer different questions on different sides of the wire — *"is this assertion authorised?"* versus *"can this peer know?"* — and their independence is what makes the pair fail closed. One gate is a smaller diff and a strictly weaker guarantee.
  - **⚠ A read failure is currently a deletion.** `manifest.ts:210-217` catches a per-file read error, raises a `Notice`, and **omits that file from the entry set** — under `purge: true` that omission deletes the entry. The decision core's inputs must not let a *transient local read failure* present as *completeness*. Named because it is adjacent, in the same loop, and would otherwise be re-found as a finding.
  - **⚠ `types.ts` position.** The new interface goes at the **top**. See §3. This is a measured trap, not a style preference.
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5; card text is a whole-string LWW register until P4. A criterion that would only pass once P4 or P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report, a fixture, a test name or a commit message. Keys may be named; values may not.
  - **⚠ Scenario `[07]` is FLAKY and is not a verdict on anything.** PASS/PASS/FAIL/PASS across three bundles with no correlation. Do not gate on it in either direction.

- **Known flaky patterns:**
  - No wall-clock sleeps. Live waits are `sync.waitQuiescent` or a bounded wait that names the condition it was waiting for on expiry.
  - **The E2E suites are idempotent as of the data-loss batch, and every WP80 scenario must stay so** — per-run ids, a sweep at preflight, set comparison rather than hardcoded expectations, and a SKIP recorded as a SKIP and never folded into the pass count.
  - Do not assert on log strings as the primary oracle; **state is the oracle** — here, the file system in both vaults. A decision object asserted **in addition** is required by AC2, not instead.
  - A test that asserts an absence — *"the file was not deleted"* — is suspect by default. Ask what it would take to fail, write that down, and pair it with the discriminating positive.

- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **No `server/**` edit**, in any file, for any reason. §7 abort criterion outside WP41.
  - **The D2 consuming-side gate is byte-unchanged**, and `plugin/src/__tests__/dataloss/**` is not deleted, weakened, retitled, skipped or amended.
  - **The verdict is taken by a pure core and fails closed.** Every unknown resolves to *additive*.
  - **A refusal to purge is never a refusal to publish.**
  - **`publishManifest` returns a decision; no branch is silent**, including `manifest.ts:190`.
  - **`seq`, never a clock.** No sleep, no debounce, no `publishedAt` gate.
  - **The attestation keeps riding the entries' transaction.**
  - **The new interface goes at the TOP of `types.ts`.**
  - **`main.ts` and `control-handlers.ts` gain calls only** — a conditional over manifest or sync state in either is a §7 abort criterion.
  - **The E2E command invokes the real method and returns no literal.**
  - **`canvas.simulateEdit` is not used.** `useCanvasBinding` is not flipped. The plugin version is not bumped. `plugin/manifest.json` (a broken symlink) is not read or edited.
  - **No `DONE` work package is re-opened; WP80 holds no §7 licence of any class.** A reddened inherited assertion is an ESCALATE, left red.
  - **No owner-vault file is read into an artefact, hashed into a report, fixtured or named by value; no secret through any agent tool.**

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP80's scope. Each is recorded so it is not rediscovered as a finding.*

- **S25 — host identity is unstable across restarts.** `server/src/control-handler.ts:568-591` rewrites `room.hostUserId` to the surviving peer on every host disconnect (`:588`), so host and guest swap on every restart and each swap churns a full purge-republish. WP80 makes the churn **harmless**; it does not make it stop. **Fix is server-side and requires a WP licensed to touch `server/**`. Owner: none assigned.**
- **S26 — the `isSharedPath` prefix-match question has two contradictory verdicts in the artefact set.** WP79's charter §3 Verification 5 reports it CLOSED-negative on the grounds that the `normalizePath` in scope is the plugin's own (`utils.ts:38-40`); `ImplementationReport_DataLossChain.md` §8 row 3 reports it unverified. **WP80 depends on neither and settles neither.** It is adjacent — a wider `isSharedPath` widens both what is published and what is deleted. **Owner: none assigned; needs one measurement, not a charter.**
- **S27 — the E2E readiness probe accepts any HTTP answer as "control is live."** `H:\tmp\liveshare_e2e_install.py:56-69` posts to `/cmd`; the control server routes only `/command` (`testing/e2e-control.ts:641`). The probe treats every non-`no answer` result as success, so an HTTP error from a server that would reject every command is read as **"REMOTE CONTROL IS LIVE"** (`:108`). Another instance of the class this run has found ten-plus times, in the rig's own readiness check. **Not WP80's, and WP80 must not silently rely on it. Owner: none assigned.**
- **S28 — a per-file read failure inside `publishManifest` currently causes an entry deletion under `purge`.** `manifest.ts:210-217`. In scope for WP80 only as an **input-validity constraint** on the decision core (§5); repairing the read path itself is not. **Owner: none assigned.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/` — the new pure decision core
  - `plugin/src/files/manifest.ts` — the consultation, the returned decision, the named refusal at `:190`
  - `plugin/src/types.ts` — the decision interface, **at the top of the file**
  - `plugin/src/main.ts` and `plugin/src/sync/control-handlers.ts` — **wiring only**, at the four call sites
  - `plugin/src/testing/e2e-control.ts` — the AC5 command, additive, host method optional on the interface; `manifest.publish`'s literal corrected
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP80 row and the §7 / header counts (79 → 81, together with WP81), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP80.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **AC1 truth table as executed**, row by row including every unknown-input row; the **AC2 decision object** for every branch including the `manifest.ts:190` refusal, with the before/after `manifest.info.paths` comparison on both instances; the **AC3 scenario in full**, with its **recorded precondition** (B's local shared set was a strict subset of the manifest it held at publication time), the file-system state of both vaults before and after, and the **pre-repair build's result on the identical scenario**, stating which bundle was built and installed; **AC4's four call sites asserted separately**, each with its non-empty deleted-key list; **AC5's two failure cases** showing structured refusals rather than successes, and the seam-disable result proving the command reflects the core; a quoted statement that the D2 gate (`main.ts:679-731`, `manifest.ts:170-176`) is **byte-unchanged** and that `plugin/src/__tests__/dataloss/**` is untouched; confirmation that **no `server/**` file was modified**, that `main.ts` and `control-handlers.ts` received **calls only**, that the new interface sits at the top of `types.ts`, and that **no clock gates anything**; the **executed test count** for the plugin suite before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision** — and note that for this WP the E2E command is itself part of the deliverable, so a defect in it is a defect in WP80.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
