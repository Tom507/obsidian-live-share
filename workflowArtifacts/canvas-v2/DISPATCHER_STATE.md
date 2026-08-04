# Dispatcher State — Canvas V2 Atomic Orchestrator Run

> **Purpose:** resumable orchestration state. If the Dispatcher's context is compacted or lost,
> this file plus the BUILD_SPEC and the handovers are sufficient to continue the run.
> **Last updated:** 2026-08-02, during batch B4 (phase P2), after the Worker 2 WP68 charter + §7 audit.

---

## Coordinates

| | |
|---|---|
| Project | `liveshareCollab` (workflow-memory project key) |
| Repo | `h:\My Code\AgenticWorkspace\Projects\_external\liveshareCollab\obsidian-live-share` |
| Real path | `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share` (junction) |
| Branch | `fix-bugs-and-raceconditions` (NOT a default branch — safe to commit) |
| Artifact folder | `workflowArtifacts/canvas-v2/` |
| Authority | `workflowArtifacts/CONCEPT_V2.md` → `canvas-v2/BUILD_SPEC_CanvasV2.md` |
| Workflow | `Coding/Workflows/AtomicAgentOrchestrator/AtomicOrchestratorWorkflow.md` |
| worker4_mode | `full` (BUILD_SPEC §7) |

**Commits so far (this repo):** `65fbb44` (V2 work, 870 files) · `2e3ca6b` (this state file) ·
`71661fd` (T3 pre-flight) · `a3028fa` (WP68 charter + WP-count correction).
**Workspace repo:** `6440d02` (workflow commit-checkpoint feature).

---

## Standing user decisions (do not re-ask)

- **Commit freely** whenever useful. Now built into the workflow as `commit_checkpoint_every` (default 2).
- **Both Obsidian vaults are free for testing** — `H:\Developement\_NeuralAngels\ObsidianOrga` and
  `…\ObsidianOrga - Kopie`. Nothing important in them; dev-build install permitted.
  Still binding: `data.json` holds live credentials → sha256-compare only, never printed/logged/fixtured.
- **Relay server may be deployed to the NeuralAngels box for testing** (via `ssh-deploy`).
  Constraints stand: compose `name: liveshare`, never `--remove-orphans`, `neural-angels-access`/`n8n` protected,
  no secret through any agent tool.
- **Max two W3/W2 workers in parallel.**
- Build everything from CONCEPT_V2 — nothing deferred, including "optional" P6.

---

## Phase status

| Phase | WPs | State |
|---|---|---|
| P0 — shadow diff + canonical serialization | WP1–WP7 | ✅ done (WP7 gate still unrun — see below) |
| P1 — data model | WP8–WP23 | ✅ done |
| P2 — sidecar / GUID / epoch / import | WP24–WP30 | ✅ **done** — all 7, `HANDOVER_READY`, committed `fcb2295` |
| P3 — mode consensus, receive-and-persist | WP31–WP35 | ⬜ queued |
| P4 — Y.Text, blur merge, UndoManager | WP36–WP38 | ⬜ queued |
| P5 — op-capture promotion | WP39–WP40, WP52–WP54 | ⬜ queued (gated on the real-Obsidian gate) |
| P6 — relay blob persistence | WP41–WP42 | ✅ done |
| T3 — real-Obsidian rig | WP43–WP49 infra ✅ · WP50, WP51, WP7 ⬜ | infra done, **gate not yet run** |
| PHASE VI — verification integrity | WP55–WP58, WP62, WP64, WP67 | ✅ done |
| Open | WP59 ✅ · WP65 ⬜ · WP66 ⬜ · **WP68 ⬜ (chartered 2026-08-02)** | see queue |

**Chartered total: 76 WPs.** Implemented: WP1–30, 41–49, 55–64, 67, 69, 72, 73.

### THE GATE — required order, and why each one blocks

Nothing may run against real Obsidian until these land. Each was found by a batch that tried.

| WP | State | Without it, the gate… |
|---|---|---|
| **WP70** | 🔄 attempt 2, `risk_flag HIGH` | …**trashes the owner's vault** (`sharedFolder=""` ⇒ whole vault shared ⇒ guest `cleanupStaleFiles`). Also owns the relay and the `obsidian-git` borrow. |
| **WP74** | ⬜ chartered | …can run against a canvas **never opened**, or treat a **timeout** as convergence — a false green under exactly the conditions a real sync bug creates. |
| **WP75** | ⬜ chartered | …**cannot tell two vaults from one** (D14: both windows may share one process), over an unidentified build, with `applied` a constant. |
| **WP76** | ⬜ chartered | …**never runs the path the fix lives on.** Proves Yjs converges; says nothing about P0/P1. |
| **WP71** | ⬜ chartered | …has no reproducible invocation (the rig is plan-only **by design**; C45 AC4 forbids a spawn backend). |
| WP50, WP51 | ⬜ | matrix + stale-view surface |
| **WP7** | ⬜ | the run itself |

**WP75 and WP76 are ORTHOGONAL, not ranked** — I proposed a ranking and Worker 2 rejected it with the better
argument: a gate running the right path but unable to tell two vaults apart is equally unrescuable.
WP75 makes the run's **signals** true; WP76 makes its **subject** right. Each independently voids WP7.
The only asymmetry cuts against my framing: a WP76-less gate with a corrected docstring is *honestly
labelled*, whereas a WP75-less gate **lies**. Sequencing is WP75 → WP76 only because they edit the same
two files.

### ⚠ RULING — the gate runs the FILE path, not the binding path

**Measured: both vaults have `useCanvasBinding = false`**, and BUILD_SPEC freezes it there until P5
(WP39/WP40). So the live capture path is `vault.on("modify")` → `handleLocalModify`
(`vault-events.ts:230-255`) — **and that is where CONCEPT_V2's surface-shadow repair actually lives**
(`canvas-sync.ts:2736`, `:2792-2801`). `captureLocal` belongs to `CanvasBinding`, which is switched off.

**This corrected my own framing:** I had told Worker 2 the fix lives on `captureLocal`. A WP scoped that
way would have chartered a repair for the **switched-off path**. Consequence (S11): `bindingInstrument`
fires only inside `CanvasBinding`, so with the flag off **all four binding counters are permanently zero
however much capture ran** — "counters moved ⇒ the path ran" is the `__LS_E2E__` mistake with the sign
flipped. The path witness must be the gesture's own report plus file/doc observation.

### ⚠ CONFIRMED LIVE — a gate run would trash the owner's vault files

Verified in the current tree by the Dispatcher, then measured on this host:

```
manifest.ts:445   if (!this.settings.sharedFolder) return true;   ← empty ⇒ WHOLE VAULT shared
main.ts:471       guest role → cleanupStaleFiles()
main.ts:523-540   trashFile()s every shared local file absent from the host's manifest
```

**Both vaults have `sharedFolder = ""`** (emptiness checked; the value was never read). So a gate run
with vault B as guest trashes everything in B that is not in the host's manifest. `trashFile` is
recoverable and the owner has declared both vaults expendable — but this is why **WP70 pinning
`sharedFolder` to the rig-owned `_e2e-rig` is a data-safety requirement, not a convenience.**
It is not to be relaxed for convenience later.

### Identity keys — measured by hash, values never read (retires two risks)

| key | A vs B | consequence |
|---|---|---|
| `encryptionPassphrase`, `encryptionSalt` | **both empty ⇒ agree** | the decrypt-mismatch failure mode does **not** exist — risk retired |
| `clientId` | **differ** | the identical-client risk does **not** exist — risk retired |
| `roomId` | both empty | nothing is provisioned; confirms a room must be minted (WP70) |
| `serverUrl` | identical | both point at the same relay today; WP70 repoints to local |
<!-- was miscounted as 66; WP65 was never counted in the 64→66 step. 68 = +WP68, 69 = +WP69. -->

### T3 gate — newly chartered, must run in this order

| WP | What | Why it exists |
|---|---|---|
| **WP69** | one-shot `e2e` build mode + install into both vaults | the only E2E-capable build never terminates; the install step was unowned |
| **WP70** | settings provisioning + local relay lifecycle | chartered — without it the gate is vacuous **and unsafe** (see above) |
| WP50 / WP51 | run matrix · stale-view scenario surface | amended for the pre-flight |
| WP7 | the gate itself | **was pointing at the mock rig's ports** — corrected |

**WP69 must not start until B4 lands:** its AC2 takes a `npm run build` sha256 *before* the config change,
and a before-bundle built while B4 is mid-write voids the comparison in both directions.

---

## Immediate queue (in order)

1. **B4 returns** (P2) → commit → then:
2. **B9b — WP50, WP51, WP7** → the real two-vault Obsidian gate.
   **Recommended next after P2**, ahead of P3/P4: every green so far is headless.
   **Read `T3_PREFLIGHT.md` before writing these charters** — it contains a build blocker.
3. **WP66** hollow-fixture suite-wide sweep — *held: needs a quiet tree*
4. **WP65** ledger provenance + intermittent register — *held: touches `_run_blind.py`*
5. **WP68** file-op rename sidecar boundary (charter ready, `SPEC_COMPLETE`)
6. **B5** P3 (WP31–35) · **B6** P4 (WP36–38)
7. **B7** P5 (WP39–40 + WP52–54) — promotion gated on WP54's `CaptureTriggerLedger.md`
8. **W4** integration & system testing (`worker4_mode = full`)
9. KC routing agents + `consolidate_memory(liveshareCollab)` + final report

---

## Open items that must not be lost

- **⚠ WP7 was pointing at the MOCK rig.** Its §2 named ports `39421`/`39422` — those are
  `HEADLESS_RIG_PORT_A/B`. Real control is `REAL_CONTROL_PORT_A/B` = `39431`/`39432`, deliberately
  disjoint per D13. An implementor following WP7 verbatim would have driven the headless mock and
  recorded a **green gate that never touched real Obsidian** — the exact substitution WP7's own AC5
  exists to prevent. Corrected to import the constants and spell no literal. **Standing lesson: the
  gate's own charter is not exempt from the vacuity classes.**
- **⚠ Vacuity hazard at the gate — the reason WP70 exists.** The scratch canvas lands at
  `<vault>/_e2e-rig/…` (`constants.py:119`), but nothing establishes that `_e2e-rig` is inside the
  **shared surface**, nor that both vaults agree on `roomId`/`serverUrl`/`sharedFolder`. If they do not,
  every matrix case passes while syncing nothing. C50 AC5 is the **detector** (refuses `inconclusive`);
  WP70 is the **provisioner**. Keep them distinct — a detector its own provisioner can satisfy
  trivially is worthless.
- **Dispatcher decision (binding): the gate runs against a LOCAL relay**, started and stopped by the
  rig. `server/` runs under ordinary process control (`npm run build` → `npm start`). The owner
  *authorised* deploying to the NeuralAngels box, but that is permission, not a requirement, and a
  network dependency would inject exactly the flake this run has spent its length eliminating.
  Remote-relay operation may later be a **non-gating** matrix case.
- **⚠ The dev build has no one-shot mode — it will hang a gate batch.**
  `plugin/esbuild.config.mjs` branches on `argv[2] === "production"`: prod rebuilds and exits,
  **everything else calls `ctx.watch()` and never returns**. `npm run build` sets `__LS_E2E__=false`;
  `npm run dev` sets it `true`. So the only E2E-capable build is the one that never exits, and an
  `await_console` on it blocks to timeout while looking like a slow build. **WP50 must charter an
  explicit `e2e` build mode** (recommended: `argv[2]==="e2e"` → true + `rebuild()` + `exit(0)`,
  leaving `production` and default-watch byte-identical). Full detail → `T3_PREFLIGHT.md`.
- **`fileOpsManager.onFileRename` leak — VERIFIED and now chartered as WP68.** No longer an open
  question; it is queued work. The *outbound* arm remains **unverified** (depends on Obsidian emitting
  a vault rename whose destination is under `.obsidian/` — never observed, cannot be until the gate runs).
  AC1 is written at `onFileRename` directly so it is falsifiable today.
- **The rename branch is the only asymmetric inbound gate.** `control-handlers.ts:49-50` uses
  `paths.some(isSharedPath)`; every other op type uses the strict all-paths form. This is the shape
  that hid WP68 — keep the standing note even after WP68 lands.
- **`isPathSafe` does not exclude the config directory.** It rejects traversal only. Any peer-supplied
  path reaching a vault write is protected by `isSharedPath`/`isSidecarPath` and by nothing else.
  This is the trap for any newly added op type.
- ~~`TaskCharter_WP67` status field stale~~ — **discharged**, flipped to `DONE`.
- ~~WP25 fixture-completion §7 row owed~~ · ~~WP27 measured §7 row owed~~ — **both discharged** (`a42845f`).
- **Dispatcher ruling corrected (D-3):** I originally filed WP25 under §7's **fourth** class. Wrong —
  the fourth class governs a test that is **RED**, failing on scenery; WP25's ordering tests were
  **GREEN while asserting nothing**, which is the **fifth** class verbatim, and they were found the
  fifth class's way (a perturbation that reddened nothing). Being re-filed to the fifth class as a
  second grantee; the fourth class's own "extended no further" sentence then stands unviolated.
- **Ruling (D-1):** WP27's restatement of the blind1 tp05 state-vector oracle required **no licence** —
  the file was **authored by B4 itself**, and every §7 class governs *inherited* tests. Same precedent
  as WP26's type-annotation edit. Recorded as a note, not a row; WP27's condition 5 narrowed to
  pre-existing assertions, since as written it would have made a batch's revision of its own new test
  an abort criterion.
- **⚠ OUTSTANDING TEST-TITLE CORRECTION owed to a Worker 3 batch.**
  `workflowArtifacts/canvas-v2/tests/blind_set1/WP27/test_tp05_rename_creates_no_doc_and_no_orphan_blind1.test.ts`
  still reads *"clientID and state vector are **unchanged** across the rename"* while its assertion now
  pins a delta of exactly 1. **A title asserting the opposite of its own assertion is the trap that bit
  WP26/AC3 twice.** Title/message text only — no assertion, no count, no matcher. Not done during B9b
  because that batch must not have test files moving under it.
- **§7's lists are authoritative; every quotation of them elsewhere is a snapshot.** Three stale-recall
  instances so far (`_B4_P2_running_notes.md:56`, `ImplementationReport_WP27.md:62`, and the WP27
  coder's own reading). Rule 6 exists for exactly this.
- **Superseded item (kept for the record):** Ruled: extend §7's **4th class**
  (fixture completion, currently WP18 + WP64) to **WP25**, bounded to the IO double's `wait` signature
  in `blind_set2/WP25/tp01` and nothing else. The class's demonstration requirement is satisfied and
  must be recorded in that form: **before the repair, falsification A left set2 47/47 green; after it,
  falsification A reddens it.** Same owner rule as below — Worker 2 writes the row.
- **Superseded (discharged `a42845f`):** The licence is granted and recorded; the *measured* row (post-
  amendment strictness, falsification result, executed count) was deliberately withheld until B4
  reports what was actually done. **Owner: Worker 2, one instance, nobody else** — this is the exact
  overlap that already cost a reconciliation once.
- **WP69 and WP70 both add constants to `constants.py`.** No other file overlap, but if they run in the
  same batch this is a rule-10 hazard. The batch's shared-ownership contract must name who writes
  which block.
- **Relay binds on all interfaces** — `server.listen(port)` with no host argument
  (`server/src/index.ts:236`). Accept for the run, or charter a `server/` change under a WP permitted
  to touch it (§7 makes `server/` edits outside WP41 an abort criterion). **Undecided.**
- **Windows graceful relay shutdown is unverified.** The server's only shutdown channel is
  SIGTERM/SIGINT, so C70 AC3 defines "stopped" as *the port refuses a connection*, not *terminate
  returned*. Whether a clean shutdown is achievable on this host has not been tested.
- **Guest `cleanupStaleFiles` will trash rig-owned scratch files** absent from the manifest, including
  one left by a crashed run — this touches WP47 AC4's stale-scratch reclaim. Noted in WP70, not fixed.
- **`TaskCharter_WP64` and `TaskCharter_WP59` also read `SPEC_COMPLETE` while apparently closed.**
  Not verified against their handovers; only WP67 was checked. Needs a sweep, not a guess.
- **Install-then-launch ordering is implied everywhere and stated nowhere.** Replacing `main.js` under
  a running instance needs a plugin reload, and D15 forbids restarting an instance the rig did not
  start. WP70 is chartering the sequence.
- **Teardown grey area:** if the owner has Obsidian open on either vault, the rig's launches become
  windows in a process it did not start (D14/D15). WP48 owns teardown of **rig-started** processes only;
  window-level teardown inside a foreign process is undefined. Unresolved.
### Dispatcher rulings on the WP76 pass

- **WP51 depends on WP76** (one-definer rule: C76 defines the unconditional open+gesture primitive,
  C51 composes it, C51 AC2 unchanged). Recorded as a decision; **not back-dated into WP51**, which is
  still `planned`.
- **WP76's 5 ACs accepted.** Not to be split; AC2's gesture is meaningless without AC1's open.
- **Warning owed to WP50's implementor:** the D17 file oracle is **vacuous against a canvas with no
  writer attached** — `sameFileObservation` returns `true` for two `{exists:false, sha256:"", size:0,
  content:null}` observations, so it would report `fileConverged: true` over **two files that do not
  exist**. Not a defect in C50; a precondition C50 cannot supply itself. **First instance of the
  unfalsifiable-green class caught *before* it landed.**
- **The vacuity sweep is declared exhausted.** Six consecutive passes each found something; the sixth
  found S8/S9/S11, none of which is "a field with no reader" — it is a different question (does the gate
  run the right code). Worker 2's own read: a seventh pass would return nothing. Accepted.

### ⚠ My own errors this stretch, recorded so they are not repeated

1. **Twice I specified a check that cannot fire.** `__LS_E2E__` count (zero in *both* bundles), then
   "a production build refuses to start the run" (a production build has **no control port to answer
   on** — `src/testing` tree-shakes out). Both rewritten as positive identification.
2. **I told Worker 2 the fix lives on `captureLocal`.** It lives on `handleLocalModify`; `captureLocal`'s
   path is switched off by default. Caught by the sweep, not by me.
3. **I committed while a sibling batch had staged work** — `git commit` commits the whole **shared
   index**, so explicit `git add` is not protection. `b8a541e` swept in 94 of B10a's files.
   **Fix adopted: `git commit -o <paths>`, or verify `git diff --cached` immediately before committing.**
   Nothing was lost; WP70's implementation is mislabelled under a WP74 message and history was **not**
   rewritten because agents were live on the branch.

### ⚠ `plugin/main.js` is NOT a safe bundle oracle (B10b, 2026-08-04)

It is **untracked, shared, and last-build-wins — including a concurrent batch's build.** B10b observed
it mid-batch as a **3.6 MB e2e bundle** while B10a was building. Consequences:

- **W4-1 must be discharged against an in-memory esbuild, never against the file.** B10b's blind set 2
  does exactly this (0/16 vs 16/16). W4-1 has already once been recorded on a check that could not fail
  (the `__LS_E2E__` count); discharging it against a file another batch can overwrite would be the
  second time.
- **WP69's byte-identity result still stands** — its measurements were taken before B10a existed and
  re-taken four times consistently with no concurrent builder — but **the method must not be reused
  while any other batch can run a build.** Treat "the tree is quiet" as including "nobody else is
  building".

### ⚠ Same vacuity class, one seam over — NOT yet chartered

WP73 fixed `_run_case` discarding `applied`. **`_open` and `_wait_both` still discard their results**,
so a case run against a canvas that was **never opened**, or one that "settled" only because the wait
**timed out**, is still recordable. Out of WP73's scope by charter. **Must be closed before the gate
run, or the gate can pass without ever opening the document it claims to test.**

### Process deviation to weigh (B10b, disclosed unprompted)

WP72/WP73's blind sets were authored **after** implementation. They are an independent re-derivation of
the criteria and were mutation-checked (9/3/4/6 red under four different fakes), but they are **not
evidence of non-overfitting** the way a pre-implementation set is. Recorded because the distinction is
real and the batch volunteered it rather than letting it pass.

### ⚠ `__LS_E2E__` is NOT a distinguishing marker — my pre-flight was wrong

`__LS_E2E__` occurs **zero times in the e2e bundle too**: esbuild's `define` substitutes the identifier
at compile time, so the name never survives into any bundle in any mode. A count of zero is consistent
with every build. The **distinguishing** signature is the marker triple (`e2eControlPort`,
`LIVESHARE_E2E`, `e2e-control`) — production **0/0/0**, e2e **1/1/2** — plus the size difference
(626 711 B vs ~3.6 MB inline-sourcemap).

**Consequence: W4-1 is NOT discharged.** I recorded it as partially discharged on the strength of a
check that could not fail. It must be re-established against the marker triple on a freshly built bundle.

### Dispatcher rulings, 2026-08-04 (from WP69 + the Worker 2 correction pass)

- **Both vaults stay on the production build.** B9b installed, verified, restored and re-verified, then
  deliberately left production in place, asking whether to leave the e2e bundle installed. **Agreed —
  leave production.** An instrumented 3.6 MB dev build sitting in live vaults with no gate running is an
  unforced risk, and re-installing at gate time is one call. WP7's run owns the persistent install.
- **The test-mirror convention is only valid AFTER implementation.** B9b's own WP51 mirror commit broke
  `npm run build` repo-wide — `tsc` typechecks `src/` including tests, so mirroring a
  generated-but-unimplemented suite turns "tests fail" into "the repo does not build" **for every other
  WP**. Reverted at `6b20c17`; all 27 WP51 test files intact under `workflowArtifacts/`. Do not mirror
  a generated suite into `plugin/src/__tests__/` until its WP is implemented.
- **⚠ Will hit the gate run: pytest cannot collect from the workspace root.**
  `h:\My Code\AgenticWorkspace\Projects\_external\FinaleAbgabe` is a **dangling symlink** to
  `/e/Dateien/Tom/THM/MIB5/FinaleAbgabe` (E: not present). Reproduced on WP44's suite, so pre-existing
  and unrelated to this run. **It is the owner's thesis link — do not delete or repair it.** The gate
  must invoke pytest with an **explicit path or rootdir**, never a bare collection from the workspace
  root. Record this in WP71's procedure.
- **27 tracked `__pycache__/*.pyc` files removed from the index** (`.gitignore` already listed them; my
  earlier fix untracked only two directories). They re-dirtied the tree on every import, which makes
  "the tree is quiet" unmeasurable — and a quiet tree is a precondition of WP69-style hash comparisons.

- **`community-plugins.json` — WP69 vs. the `obsidian-git` precondition is NOT a conflict.**
  WP69 AC4 forbids **WP69** from writing that file, and that stands: WP69 is install-only and must not
  change the enabled set. Disabling `obsidian-git` is **environment preparation for a run**, not part of
  installing a bundle. **Owner: WP70**, which already owns the reversible-borrow pattern — same
  discipline as its `data.json` borrow: capture, modify, restore, and verify the restore independently.
  This also discharges "the disable/restore has no owner": it is **mechanised in WP70**, not an operator
  step. A run whose restore is not verified is a failed run.
- **`liveshare_e2e_mcp_server.py` lives in the AgenticWorkspace repo** —
  `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, confirmed present. It is
  correctly placed (it is a workspace MCP server, not plugin source) and **does not move**. Consequence:
  **WP50's and WP73's changes land in a second repository**, outside this branch and outside §7's
  commit/abort accounting. Both WPs must declare the cross-repo edit explicitly and record **both**
  commit hashes in their implementation reports. §7's accounting is extended to say so. The line numbers
  C50 cites (`:134`, `:280`, `:402`) are **correct** against that file — only the repo was wrong.
- **`_run_case` is worse than reported: eleven sites, not six.** Six was the *case* count. Five of the
  missed sites are **setup** gestures, and `delete-node-edge`'s `node_gone` predicate is satisfied by the
  node **never having been created** — so an unapplied setup makes that case's own oracle *vacuously
  true* rather than merely unprotected. `initial-sync` has no content predicate at all, so `converged`
  is its entire verdict. **A repair scoped to "six" would have left the worst cases open.** Rule 12
  (verify against the current tree) caught this.

- **⚠ CORRECTED — the `lan-vault-sync` disposition was aimed at the wrong plugin (my error).**
  `community-plugins.json` is the *enabled* list; it is byte-identical in both vaults and contains only
  `obsidian-git` and `live-share`. **`lan-vault-sync` is installed but NOT enabled.** The false claim
  propagated from `T3_PREFLIGHT.md` into this file and **four charters**, which W2 must now correct.
  **The real hazard is `obsidian-git`: `autoPullOnBoot: true` in both vaults, on real git working trees
  with `origin` remotes, already dirty (13 and 14 entries), firing at exactly the moment the gate
  launches Obsidian.** Ruling: **disabled in both vaults for the run and restored afterwards**, not a
  discretionary call. `autoSaveInterval`/`autoPushInterval` are `0`, so nothing is pushed, but the
  boot-time pull alone is disqualifying. **Standing lesson: "installed" is not "enabled" — read
  `community-plugins.json`, not the directory listing.**
- **⚠ The T3 rig cannot launch Obsidian.** `lifecycle.py`'s only console backend is `PlanOnlyConsole`
  and there is no `subprocess`/`Popen` anywhere in `tools/obsidian_e2e/`. WP43–49 built a **plan-only**
  rig. **The gate run is therefore agent-mediated** — an agent launches both instances via
  `visible-console` and drives the control endpoints. Nobody has exercised the launch path because
  there is no launch path. Charter language implying the entrypoint runs the gate end-to-end is wrong.
- **`canvas.setFlag` can destroy WP70's settings borrow** — for any name matching an existing settings
  key it calls `plugin.saveSettings()`, rewriting `data.json` from the live in-memory copy. Its
  `runtimeFlags` map is read by nothing in `plugin/src`, and it returns `{set:true}` for any name
  (the inert-map vacuity WP51 AC3 targets, plus a borrow-clobber no charter names).
- **Live vacuity in the matrix driver:** `_run_case` discards `applied` at all six call sites, so an
  unapplied gesture leaves both snapshots equal and the case records **pass** — exactly what C50 AC3
  forbids. Seventh instance of the class, and it is in the gate's own driver.
- **`_B4_P2_running_notes.md:56` quotes the licensed-amendment list without WP64.** Harmless for B4
  (no WP in that batch is on either list) but it is a stale recall of a §7 list.
- **Hollow-fixture class** — WP66. Literal grep is a *screen, not an oracle*: `text: ""` is valid,
  `remoteRecord(...)` takes accept-then-quarantine. Scope by measurement, not by the suspected list.
- **WP7 / T3 gate never executed.** Both vaults carry production builds (zero `__LS_E2E__`
  occurrences) and cannot host the control server — WP50/WP51 must install a dev build.
- ~~**`lan-vault-sync` is enabled in both vaults**~~ — **FALSE, superseded by the correction above.**
  It is installed but not enabled. Kept struck rather than deleted so the propagation path stays
  visible. Original text follows: a second sync engine that can move files under the
  test and produce a failure unrelated to Canvas V2. WP50 must decide explicitly: disable and restore,
  or accept as noise.
- **`wp5/latency.test.ts` RTT flake** — owned by WP65, accepted with a falsifiable threshold
  (>1 failure in 10 consecutive runs, or co-occurrence with another `wp5` assertion, voids acceptance).
- **W4-1**: C46 production-bundle counter-check — **partially discharged** by the pre-flight (both
  installed production builds contain zero `__LS_E2E__` occurrences, so `src/testing/` does tree-shake
  out). W4 should still confirm against a freshly built bundle rather than the 2026-07-26 install.

---

## Hard-won rules (apply to every future batch)

1. **A green test may be unable to fail.** Five classes found this run: vacuous blind runner; unfalsifiable
   assertions; oracles vacated by a semantic change; global perturbation that falsely certifies; a prior
   batch's amendment masking a later falsification.
2. **Falsify with a *targeted* injection of the exact class**, confirm the row fails on **its own** pin, and
   record whether neighbouring pre-existing oracles stayed green. Narrow when masked.
3. **Convergence is not correctness.** WP23's fuzzer demonstrated SEC, schema, byte-equality and shadow
   oracles all green over a provably corrupt document; only the **intent-trace** oracle caught it.
4. **Pre-existing means pre-existing to the batch baseline**, not to your own diff.
5. **A ledger row is a measurement, not a timeless fact.** Old rows are not passes.
6. **A cited contract must be re-read, not recalled** — especially after its WP was reopened.
7. **Run the oracle's own extraction** rather than reasoning about whether prose "reads unambiguously".
8. **CRDT assertion trap:** assert a specific value only when it has a single author or a causal predecessor
   chain. Concurrent same-key writes tie-break on `clientID` = `random.uint32()` → ~50% pass rate.
9. **Ledger discipline:** no deletion or weakening without a named §7 licence; every amendment enumerated by
   file · line · why-stale · post-amendment strictness. Blind pass without an executed count = UNVERIFIED.
10. Two agents independently choosing incompatible constants has cost this run a batch. One WP defines,
    the others read.
11. **An ordering oracle can be stalled at the wrong seam and never reach the ordering it pins.**
    WP25's blind2 tp01 gated on `hold("exists")`, but `resolveGuidForSubscribe` → `store.bind` →
    `readIndex()` → `io.exists(sidecarIndexPath())` meant the gate stalled the subscribe *inside
    identity resolution* — before `getDoc`, before `waitForSync`, before the load. Both ordering tests
    were vacuous. **Sixth distinct instance of "a green test that cannot fail", and the first located
    in a GATE rather than in an assertion.** Generalised: *identity resolution touches the sidecar
    before the doc exists*, so any gate written against `subscribe` must name the seam it blocks.
    Detected only because falsification A left set2 **47/47 green** — the perturbation that should have
    reddened it did nothing. **A perturbation that changes nothing is a finding, not a null result.**
12. **Verify a defect against the current tree before chartering it.** WP68's source description was
    written before WP26's third attempt landed; W2 re-traced it rather than accepting it, and found two
    reachability facts the original description did not contain.

---

## Measured state — B4 in progress (reported by its sub-agents, tree not quiet)

| | |
|---|---|
| Full plugin suite | **1687 passed / 0 failed** (283 files), reported at WP28 attempt 2 |
| Arithmetic | 1470 (post-WP26) + 54 (WP27) + 59 (WP25) + 104 (WP28) = **1687** — reconciles exactly |
| `tsc --noEmit -skipLibCheck` | clean |
| B4 WP status | WP24 ✅ WP26 ✅ WP27 ✅ WP25 ✅ WP28 ✅ · WP29, WP30 remaining |

**Open against B4, must not close without it:** WP28 claimed three `canvas-sync.ts` Biome findings
pre-existing *by stashing its own diff* — which measures against its own edit, not the batch baseline.
Rule 4 violation, same shape as the WP26 `TS2493` case. Must be re-established against
`H:\tmp\liveshare_snap_B4_P2\snapshot_pre_B4.tgz` or the batch merge-base.

---

## Measured state (last quiet measurement — taken before B4)

| | |
|---|---|
| Plugin suite | **1470 tests / 1470 pass / 0 fail** (253 files) |
| Server suite | 149 / 149 |
| `tsc --noEmit` | clean |
| `npm run build` | PASS |
| Blind-verification ledger | 58 rows · 58 CONFIRMED · 0 DIVERGENT · 0 VACUOUS |
| Unlicensed deletions, whole run | **0** |

**B4's own baseline** (its notes, `_B4_P2_running_notes.md`): 1346 → 1424 after WP24 → 1470 after WP26,
0 failed throughout. B4 has one self-assigned open item: 3 × `TS2493` in
`wp26/test_tp04_sync_from_manifest_visible.test.ts` authored by its own test sub-agent, new relative to
the batch baseline, to be fixed without weakening the assertion before the batch closes.

---

## Substantive results

- **The reported corruption cascade is closed at its root** — capture now diffs against the per-field
  surface shadow instead of `lastWrittenContent` (disk), so a stale view can no longer push a revert.
- **Silent `.canvas` data loss found and closed** — side-less edges are legal JSON Canvas, were refused at
  ingest, and were then deleted from the user's file on flush. Closed at three depths (WP10/WP14
  representability, WP17 projection, WP63 invariant **I11 REFUSAL NEVER DESTROYS**).
- **Insertion-order corruption found and closed** — `decodeV2RecordToFlat` resolved flat-vs-register
  collisions by `Y.Map` insertion order; a moved card could snap back with **both replicas agreeing on the
  wrong value**, so byte-equality provably cannot detect it.
- **Manifest sidecar leak found and closed** (WP26) — `renameFile` wrote to the manifest without consulting
  `isSharedPath`, publishing a sidecar key every peer would then hold.
- **A second arm of that same leak found, verified and chartered** (WP68) — the file-op broadcast arm,
  two lines from the arm WP26 closed. Unconditionally reachable inbound: any peer can put the op on the
  wire and today's gate admits it.
- **§7 licence registers audited independently and found CLEAN** — deletion list, amendment list, the
  fixture-completion and hollow-fixture classes, the unfalsifiable-repair register and the
  named-intermittent register all agree with the charters that claim entries in them. B17's WP67
  discharge was *stricter* than ordered (kept the row verbatim + appended a discharge block rather than
  flipping it, per rule 5 above). Nothing re-applied.

- **Permanent epoch freeze found and closed** (WP28) — `normalizeEpoch` used `Number.isInteger`, which
  admits `2 ** 53`, where `n + 1 === n`. `nextEpoch`'s pinned *"strictly greater for every input"* was
  therefore **false**, and one corrupt cell would have frozen a board's epoch forever, the only symptom
  being that imports quietly stop winning. Now `Number.isSafeInteger`, with `nextEpoch` throwing at the
  ceiling rather than returning an unbeatable value, and `bumpEpoch` computing it *before* opening its
  transaction so a refusal cannot half-write `meta`. **Found by asking the path question of a non-path
  export** — the generalisation, not the original defect, is what found it.
- **Conflict-copy clobber found and closed** (WP28) — `conflictCopyPath` is deterministic and
  day-granular, so a second conflict on the same board on the same day names the *same file*, and the
  file already there is another loser's only copy. `writeConflictCopy` is now fail-closed: identical
  body is an idempotent re-run, anything else throws, and the refusal cancels the adoption so nothing
  is lost rather than one copy traded for another. I11-conformant; keep it that way.

**Not yet true:** nothing has been exercised in real Obsidian. All greens are headless.
