# Worker 3 Handover — Canvas V2, batch B9a (PHASE T3 rig infrastructure)

**Batch:** B9a · **Scope:** WP43–WP49 (narrow_scope as briefed)
**Explicitly out of scope and not touched:** WP50, WP51, WP7, WP52, WP53, WP54
**Returned to Dispatcher:** `HANDOVER_READY` (one licensing decision required — see §6)

---

## 1. Scope of This Run

Tasks completed: **WP43, WP44, WP45, WP46, WP47, WP48, WP49** — all seven implemented.
Tasks with risk flags: **none open from licensing.** <!-- Updated: Phase 7 — WP46's licensing
decision was taken by Worker 2 and both amendments are applied 2026-08-01 --> WP46's licensing
question is **resolved** and its two assertion amendments are applied and verified. One unrelated
WP46 blind_set1 TS failure is open and documented in the WP46 section below.

Execution order followed, from declared charter dependencies:
`WP43 → WP44 → WP45 → WP46 → WP47 → WP49 → WP48`.
The four WPs that share `plugin/src/testing/e2e-control.ts` (WP44, WP46, WP47, WP49) were
**serialized**, each handed the previous one's touched regions so edits stayed additive. Verified:
WP47 preserved WP46's regions byte-identically; WP49 preserved both WP46's and WP47's.

---

## 2. Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP43 — Vault registry + instance discovery | DONE | NONE | NORMAL |
| WP44 — Per-vault control-port provisioning | DONE | NONE | NORMAL |
| WP45 — Obsidian launch/attach lifecycle | DONE | NONE | NORMAL |
| WP46 — Readiness + identity handshake | DONE | NONE — ruling taken, amendments applied | **CRITICAL** — see the open blind_set1 note in its section |
| WP47 — Scratch canvas + vault-safety fingerprint | DONE | NONE | HIGH — it is the data-safety gate |
| WP48 — Teardown + crash recovery | DONE | NONE | HIGH — it is the false-pass guard |
| WP49 — Real quiescence + file-level oracle | DONE | NONE | HIGH — it is the D17 gate |

---

## 3. Vault safety — the question the Dispatcher asked

### 3.1 Fingerprint diff: **CLEAN**

Read-only fingerprints taken before and after the batch (`h:\tmp\b9a_vault_fingerprint.py`,
opens every file `rb` only, records `(relpath, size, sha256)`, never content):

| Vault | Before | After | Added | Removed | Changed |
|---|---|---|---|---|---|
| `H:\Developement\_NeuralAngels\ObsidianOrga` | 307 files / 4 522 078 B | 307 files / 4 522 078 B | 0 | 0 | 0 |
| `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` | 311 files / 4 526 656 B | 311 files / 4 526 656 B | 0 | 0 | 0 |

Compared at **sha256 level per file**, not merely by count or total size.
**Verdict: both vaults byte-identical. Zero vault files were written in this batch.**
Artefacts: `h:\tmp\b9a_fingerprint_before.json`, `h:\tmp\b9a_fingerprint_after.json`.

**Which vault files were touched: none.** WP43's probe read the registry
`%APPDATA%\obsidian\obsidian.json` and both vault trees read-only; it never opened anything for
writing. All other WPs were unit-tested exclusively against fixture vaults under `tmp_path`.
`%APPDATA%\obsidian\obsidian.json` was read and never rewritten.

### 3.2 Did anything in this batch terminate Obsidian processes? **No — and here is the evidence.**

Audited the full termination vocabulary (`taskkill`, `Stop-Process`, `os.kill`,
`TerminateProcess`, `.terminate()`, `.kill()`) across every file this batch created or modified:

- `tools/obsidian_e2e/{constants,vaults,ports,lifecycle,readiness,scratch,teardown}.py` — **the
  only textual match is a docstring in `teardown.py` stating that there is no `taskkill` and no
  `Stop-Process`.** A denial, not a call.
- `tools/launch_obsidian_e2e.py` — clean. (WP45's robustness pass deliberately removed a
  docstring that *mentioned* the vocabulary, precisely because a lexical scan cannot distinguish
  a denial from a use.)
- WP48 routes both stop paths through funnels that refuse by default: `_stop_rig_started` raises
  unless `record.rig_started`; `_terminate_rig_owned` raises unless the pid is named in the rig's
  own provisioning marker. Both call an **injected** terminate seam, so no unit test can reach a
  real process either.

The only `.terminate()`/`.kill()` calls anywhere in the rig tree are
`tools/launch_liveshare_e2e.py:161,165` — **pre-existing** (that file dates from the prior
e2e-infra initiative, 2026-07-20) and they terminate that launcher's *own spawned node child*,
not Obsidian. This batch did not modify that logic.

**So: no code in this batch is capable of terminating an Obsidian process.**

**What I cannot determine:** *why* Obsidian is no longer running. It was reported as running
when the batch was briefed; WP43's read-only probe observed **0 Obsidian processes** at ~05:14,
and it is still 0 now. Nothing in my scope closed it, but I cannot establish what did — it may
have been the owner. Stating this plainly rather than guessing.

### 3.3 No secret material reached any artifact, log, or test fixture — confirmed

`data.json` in both live vaults carries live credentials (`serverPassword`, `token`, `jwt`).
Confirmed across the batch:

- No settings-file **content** was printed, logged, echoed into a report, or written into a
  fixture. Every fixture `data.json` contains obviously-fake values authored by the test agents.
- All comparisons — restore verification, fingerprints, reclaim checks — use **sha256 of bytes**
  plus byte length. WP44's provisioning marker records `originalSha256`, never the original.
- WP43 never reads `data.json` at all. WP46's `readiness.py` has **no filesystem access
  whatsoever** (no `open`, `os`, `pathlib`, `subprocess`).
- The fingerprint JSONs in `h:\tmp\` contain digests only, by construction.
- No secret passed through any agent tool at any point.

---

## 4. Test results — my scope

### 4.1 Python (the rig: `tools/obsidian_e2e/**`, `tools/launch_obsidian_e2e.py`)

Run from the repo root (see §7 for why):

| Test Set | Tests | PASS | FAIL |
|---|---|---|---|
| visible (WP43–WP49) | 266 | 266 | 0 |
| blind_set1 + blind_set2 | 647 | 645 | **2** |
| **Total** | **913** | **911** | **2** |

**The 2 failures are a defect in a blind test, not in the implementation**, and I verified this
myself rather than accepting the sub-agent's claim.
`tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` — its `drive()` helper already
wraps the body in `with pytest.raises(expected)`, which *consumes* the exception; the two failing
test points then wrap `drive()` in a second outer `pytest.raises`, which can therefore never see
one. `DID NOT RAISE` is structurally guaranteed regardless of implementation. Nine sibling tests
in the same file use `drive()` correctly and pass — **including tests covering both intended
properties** (the `["enter","exit"]` unwind ordering on all four exit paths, and the large-vault
fingerprint on the interrupt path). Coverage of the behaviour is intact.
Per the no-weakening rule I left the defective test unmodified.

### 4.2 TypeScript (`plugin/`)

| | Files | Tests | PASS | FAIL |
|---|---|---|---|---|
| Full plugin suite | 154 | 1181 | 1177 | 4 |

Of the 4 failures:

- **2 are mine and need a licensing ruling** (§6): `src/__tests__/e2e-control.test.ts` →
  `buildPluginHost > sessionInfo maps settings + connection state`, and
  `src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts` →
  `binds the numeric LIVESHARE_E2E port (order 1)`.
- **2 are FOREIGN — batch B2's work in `plugin/src/canvas/**`, not mine:**
  `src/__tests__/v2/wp15/test_tp03_rounding_no_intent_visible.test.ts` (2 test points).

> **Note on the foreign condition, stated separately as instructed.** At batch start the foreign
> failure was a *collection error* in `src/__tests__/v2/wp9/` (`canvas/canvas-registers`
> unresolved). B2 has progressed since: that collection error is **gone**, and the foreign
> condition is now 2 ordinary assertion failures in `v2/wp15/`. Either way it is B2's territory,
> outside my file boundary, and excluded from my pass/fail figure.

**Baseline preserved.** The green baseline I was told not to regress was plugin 81 files / 926
tests / 0 failed. The suite is now 154 files / 1181 tests because B2 and this batch both added
tests. **Zero tests were deleted or weakened by this batch** — the deletion ledger (WP4, WP21,
WP22, WP33 only) was not drawn on.

### 4.3 Server

`server/` was **not touched** by this batch. Baseline re-measured at batch start and unchanged:
**18 files / 149 tests, all passing.**

### 4.4 Build

- `tsc -noEmit -skipLibCheck`: WP49 drove `wp49/` errors **17 → 0**. Remaining errors are in
  `v2/wp8` (`canvas/canvas-schema` missing) — **B2's**, outside my boundary. `npm run build` as a
  whole therefore cannot pass until B2 lands, for reasons that are not mine.
- **Production footprint: zero, verified.** An esbuild production bundle greps to **0 matches**
  for `e2e-control|LIVESHARE_E2E|e2eControlPort`, while the same bundle built with
  `__LS_E2E__=true` matches — so the 0 is real tree-shaking, not a broken grep. `plugin/main.js`
  is byte-unchanged (651 991 bytes before and after WP49).

---

## 5. Per-Task Detail

### WP43 — Vault registry + instance discovery
- Status: **DONE** · risk NONE
- Files: `tools/obsidian_e2e/{__init__.py, constants.py, vaults.py}`
- Owns **every shared constant in the batch** (contract §2–§7). WP44–WP49 import from it and
  redefine nothing — confirmed by each coder.
- AC4 ("no writes, structurally") is enforced by a single `_read_bytes` helper with a hardcoded
  `"rb"` and no mode parameter; process enumeration uses a `ctypes` ToolHelp snapshot rather than
  shelling out to `tasklist`, so "starts no process" genuinely holds.
- AC3: the default process lister **drops the pid** that sits right there in `PROCESSENTRY32W`,
  so no pid exists in the module to attribute to a vault even by accident.

### WP44 — Per-vault control-port provisioning
- Status: **DONE** · risk NONE
- Files: `tools/obsidian_e2e/ports.py`; D14 rationale comment in `e2e-control.ts`
- `resolvePort`'s precedence is unchanged (numeric env → loose `e2eControlPort` setting →
  truthy-env-ephemeral → `null`), as AC4 requires.
- Byte-exact restore verified against tab indentation, CRLF, trailing-newline presence, key order
  and non-ASCII — a `json.load`/`json.dump` round-trip fails those, and the restore path writes
  back captured raw bytes without depending on the modify path.

### WP45 — Obsidian launch/attach lifecycle
- Status: **DONE** · risk NONE (2 robustness gaps found by blind sets, both fixed)
- Files: `tools/obsidian_e2e/lifecycle.py`, `tools/launch_obsidian_e2e.py`;
  self-identification added to `tools/launch_liveshare_e2e.py`
- **D13 honoured:** the headless mock rig is kept and demoted, not replaced — its
  `--alias:obsidian=plugin/src/__mocks__/obsidian.ts` survives untouched — and every run record
  is stamped `rig_kind` so a mock result can never be mistaken for a real one.
- Blind sets caught: the per-role record omitted its own `port`, and the record was positional
  rather than role-keyed. Both generalized in attempt 2; record ordering is now canonical via one
  `role_order()` helper while *acting* order still follows the caller's sequence.

### WP46 — Readiness + identity handshake
<!-- Updated: Phase 7 re-entry — Worker 2 licensed the two stale exact-shape assertions as
     amendments; both applied and verified 2026-08-01 -->
- Status: **DONE** · risk **NONE** (was HIGH — the licensing question is **resolved**) · CRITICAL for W4
- Files: `tools/obsidian_e2e/readiness.py`; `e2e-control.ts` `session.info` + `buildPluginHost`
  (+123 / −0 lines, purely additive — **unchanged in Phase 7**, byte-verified by md5)
- 62/62 of its own tests green. Exposes `check_endpoints_gone` for WP48's inverted teardown use.
- **Licensing resolved → amendments applied (BUILD_SPEC §7 amendment ledger, charter AC5).** The
  two assertions that pinned the pre-WP46 four-key `session.info` payload were **stale, not
  violated**: widening to nine keys is the literal content of AC1. Both restated as whole-object
  `toEqual` over all nine keys — strictness **rose** (they now also pin the AC3 degradation values
  `vaultId: ""`, `vaultPath: null`), and the test count did **not** move (37 → 37 in the
  `e2e-control` + `t3/` scope, `2 failed` → `0 failed`). Full ledger entry with file+line in
  `ImplementationReport_WP46.md` §2.0.
  - `plugin/src/__tests__/e2e-control.test.ts:203` (pre-existing baseline)
  - `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:147`
    **and its source of truth** `workflowArtifacts/canvas-v2/tests/visible/WP44/…:147` — the
    staged copy alone would revert on the next restage. Cross-licensed for that one assertion only.
- **Falsified rather than trusted:** perturbing one field of the nine-key payload turned **both**
  amended assertions red and nothing else; source then restored byte-clean (md5 verified).
- **Open, NOT caused by this amendment — WP46 blind_set1 TS, 1 failure (21/22).**
  `test_probe_side_effect_free_blind1.ts > does not disturb an edit that follows it`:
  `expect(bump).toHaveBeenCalledTimes(1)` gets **2** after a single `canvas.simulateEdit`. This is
  the *edit/bump* path, not the identity fields, and it is unreachable from the amendment (that run
  loads neither amended file, and `e2e-control.ts` is byte-identical to pre-Phase-7). Deterministic
  across 3 runs, not flaky. Likely never executed before: the shared `_run_blind.py` copies blind
  filenames verbatim, and WP46's are `test_*_blind1.ts`, which does **not** match vitest's
  `**/*.{test,spec}.*` glob — so it reports "No test files found" for this WP. Blind TS must be
  staged **one level** under `__tests__/` (the files import `../../testing/e2e-control`).
  Needs a WP46 owner decision; out of this Phase 7 amendment's scope.
- Blind set caught: a non-2xx response carrying a *perfect* identity payload was being accepted.
  Generalized — transport outcome is validated by status class **before** the body is touched.
- Correctly distinguishes `PLUGIN_NOT_E2E_CAPABLE` from `READINESS_TIMEOUT`: a missing control
  server and a slow one are different diagnoses, and conflating them would mislead WP50/WP51.

### WP47 — Scratch canvas + vault-safety fingerprint
- Status: **DONE** · risk NONE · 145/145 own tests green
- Files: `tools/obsidian_e2e/scratch.py`; `scratch.create`/`scratch.remove` in `e2e-control.ts`
- The fingerprint is implemented as a **hard gate** (mismatch raises `FINGERPRINT_MISMATCH`; the
  `with` block cannot reach its normal end), exactly as D16/AC3 specify — **deliberately not
  softened** when the owner later relaxed the vault constraint.
- AC1 is structural: every Python vault mutation funnels through one `assert_write_allowed()`
  before opening; the TS side applies `isScratchPath()` twice independently.
- Folder removal uses `rmdir`, never `rmtree`, and only when the rig created it and it holds no
  non-rig files.
- **Blind sets caught a real latent defect:** `new_run_id()`'s `secrets.token_hex(3)` tail is only
  16.7 M values, so a burst collides by the birthday bound. Replaced with a lock-guarded
  `itertools.count` from a random offset — 200 000 ids in-process, zero collisions. This is
  exactly the class of bug a visible-only suite would have shipped.

### WP48 — Teardown + crash recovery
- Status: **DONE** · risk NONE · 46/46 own tests green
- Files: `tools/obsidian_e2e/teardown.py`; `tools/launch_obsidian_e2e.py` wiring
- AC1 "exactly once" is a memoised result slot claimed *before* execution, so re-entrancy is
  impossible rather than merely unlikely; `executions` is an int counter, not a boolean.
- AC3 (the phase's false-pass guard) verified end-to-end on the real entrypoint: endpoint lost
  mid-run → `ENDPOINT_LOST_MIDRUN` + full teardown + `exit_status=1`.
- The sub-agent ran three **targeted mutations of its own implementation** (step order swapped,
  D15 guard dropped, reclaim returning early) and each was killed by its intended test point —
  evidence the tests actually bite.

### WP49 — Real quiescence + file-level oracle
- Status: **DONE** · risk NONE · 36/36 own tests green
- Files: `plugin/src/testing/e2e-control.ts` only
- AC1: the activity seam moved from the *command* to the `Y.Doc` — `buildPluginHost` subscribes
  `markActivity` to `update` on every doc reached, idempotently via a `WeakSet<Y.Doc>`, **never
  inspecting origin**. That is what makes peer- and interaction-originated updates count.
- AC3: `CanvasFileAdapterLike` declares readers and **no mutating member at all**, so read-only is
  a compile-time property rather than a review-time promise.
- `timeoutMs` default of 2000 and the `{quiescent}` envelope are unchanged.

---

## 6. The one open decision — Worker 2 licensing required

**WP46 AC1 mandates that `session.info` "additionally reports" vault identity, plugin build and
canvas-surface availability.** That takes it from 4 keys to 9. Two assertions pin the exact 4-key
shape with `toEqual` and are therefore **arithmetically unsatisfiable** — there is no
implementation that can pass both them and AC1.

| Failing assertion | Origin | My ruling |
|---|---|---|
| `plugin/src/__tests__/e2e-control.test.ts:197` — `sessionInfo maps settings + connection state` | **Pre-existing**, from the prior e2e-infra initiative; part of the 926 baseline | **Needs Worker 2 licensing.** My deletion ledger licenses WP4/WP21/WP22/WP33 only — WP46 is not licensed to retire or amend a baseline test, so I left it failing and unmodified. |
| `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:140` | **Created this batch** — a staged mirror of WP44's visible test, written before WP46 extended `session.info` | Intra-batch ordering artefact. Trivially correctable, but it is a *visible test* and coders are barred from editing visible tests, so I left it failing rather than have a coder touch it. |

Both are strictness-*preserving* one-line changes (assert the added keys explicitly rather than
loosening `toEqual` to `toMatchObject`); the exact patches are in
`ImplementationReport_WP46.md` § Blocked Items. **I did not apply either** — three coders
independently chose to leave them failing rather than weaken a test, which is the correct
instinct and the outcome the no-weakening rule is meant to produce.

**Recommendation:** license the amendment. The alternative is reverting WP46 AC1, which would
remove the vault-identity handshake that makes it structurally impossible to drive one vault
twice — the whole point of the WP.

---

## 7. Notes for Worker 4 / WP50 / WP51

1. **A real run is still blocked on one thing, and it is not any of my WPs.** Both live vaults
   have the plugin present *and enabled*, but the installed `main.js` is a **production build**
   with the control server tree-shaken out (`__LS_E2E__: prod ? "false" : "true"`). Verified
   empirically by WP43's probe: both report `PLUGIN_NOT_E2E_CAPABLE`. **No port provisioning will
   ever make an endpoint answer until an instrumented dev build is installed.** That install is
   WP50/WP51's (B9b's), and the owner has since authorized it.
2. **Obsidian is not currently running** (0 processes). The batch brief said both vaults were
   open; that went stale. WP45's attach-vs-launch branch already treats "nothing to attach to" as
   the normal path.
3. **pytest must be run from the repo root**, not the workspace root — from the workspace root it
   aborts during *session collection* on a pre-existing dangling junction
   (`Projects/_external/FinaleAbgabe`, absent E: drive). It looks like an import failure and is
   not. Use `--ignore` if you must run from the workspace root.
4. **`T3_SharedContract.md` is the single source of truth for every cross-WP constant** and is
   the mechanism that prevented the B8 failure mode (two agents picking incompatible constants
   and both suites going green). It also now records, as **standing** project rules: the
   `data.json` secret handling, and the `tools` package-shadowing trap (§0.2) — `import
   tools.obsidian_e2e` silently resolves to the *workspace* `tools` package, so the sanctioned
   form is `sys.path.insert(<repo>/tools)` + `from obsidian_e2e import …`. §0.1 marks S1a and S5
   as **superseded/batch-scoped** so no later batch refuses work it is supposed to do.
5. **`plugin/src/testing/e2e-control.ts` now has three additive layers** (WP46 identity, WP47
   scratch, WP49 file oracle). The type pattern that makes them coexist under `tsc` is *optional
   on the base interface, required on a narrowed return type* — `E2EControlHost` →
   `E2EScratchControlHost` → `E2EFileControlHost`. Anything added later should follow it;
   a required member on the base breaks the three hand-rolled `fakeHost()` literals.
6. **`__pycache__` is being committed.** A concurrent commit swept `tools/obsidian_e2e/__pycache__/*.pyc`
   into git — the repo `.gitignore` has no pycache rule. Outside my scope to change, worth fixing.

---

## 8. Automation candidates

- The before/after vault fingerprint (`h:\tmp\b9a_vault_fingerprint.py`) proved its worth as a
  cheap, independent run-guard. Promoting it to a permanent rig tool — invoked automatically
  around any real run — would make WP47's per-run gate verifiable from outside the rig too.
- Every Python coder independently rediscovered the pytest rootdir trap (§7.3). It belongs in the
  project's run instructions.
