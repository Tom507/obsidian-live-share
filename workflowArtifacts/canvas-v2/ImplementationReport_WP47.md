# Implementation Report — WP47: Scratch canvas + vault data safety

**Status:** `DONE`
**WP:** WP47 · PHASE T3 · attempt 1
**Charter:** `TaskCharter_WP47_ScratchCanvasVaultSafety.md` (Charter Status → `DONE`)
**Visible tests:** **81/81 pytest**, **64/64 vitest** — 0 failed, 0 skipped, 0 modified.

---

## 1. Per-AC table

| AC | Statement (abridged) | State | Where it lives, and why it is structural rather than promised |
|---|---|---|---|
| **AC1** | Each run creates a uniquely named `.canvas` inside a rig-owned folder in each vault, and no pre-existing note, canvas or attachment is ever opened for writing | **MET** | The path is *derived*, never chosen: `scratch_relpath()` delegates to `constants.scratch_rel_path()`. Every mutation in `scratch.py` passes through **one** funnel, `assert_write_allowed()`, which resolves the target and refuses anything outside `SCRATCH_FOLDER` / `PLUGIN_DIR_REL` with `VaultWriteRefused` *before* anything is opened — there are exactly four call sites (`_write_scratch_file`, `_remove_scratch_file`, `_create_scratch_folder`, `_remove_scratch_folder`) and no parameter can steer a write elsewhere. On the TS side `isScratchPath()` is applied twice, independently: in `routeCommand` (so the adapter is never reached) and again in `buildPluginHost` (so a direct call is refused too). A pre-existing note matching the scratch *name* but living outside the rig folder is an ordinary protected note — the rig owns a **folder**, not a name — and `scratch.create` reports `created:false` on a collision instead of adopting or overwriting. |
| **AC2** | The scratch file and the rig-owned folder are removed on teardown, including after a failed, aborted or interrupted run | **MET** | `scratch_run` catches `BaseException` (not `Exception`), tears down, and re-raises the original unmasked — so `KeyboardInterrupt` is covered and is not downgraded. Folder removal is conditional twice over: `folder_created` (this run made it) **and** the folder is empty, enforced by `rmdir` rather than `rmtree`, so a stray user file, a user subfolder or a concurrent run's live artefact stops the removal and is **never** deleted with it. `_teardown` is idempotent. |
| **AC3** | Before-run and after-teardown fingerprints are equal apart from scratch artefacts; a mismatch **fails the run** (D16) | **MET** | `fingerprint_vault()` records `(relpath, size, sha256_of_bytes)` — hash only, never content (S4) — excluding `SCRATCH_FOLDER`, `PLUGIN_DIR_REL`, `.git/`, `.trash/` per `constants.FINGERPRINT_EXCLUDED`, while the rest of `.obsidian/` stays covered. `diff_fingerprints()` catches added, deleted, renamed and **size-preserving content change** (that last case is what makes the hash load-bearing rather than the size). The comparison is the **verdict**: a non-empty diff makes `scratch_run` raise `ScratchError(reason=FINGERPRINT_MISMATCH, changed=…)`, so a mutated vault cannot reach the normal end of the `with` block. Bytes are read in 1 MiB chunks and never retained. |
| **AC4** | The scratch name cannot collide between concurrent runs; a stale artefact from a crashed run is detected and removed at start-up, never reused | **MET** | `run_id` = `constants.new_run_id()` = `timestamp-pid-6 hex`; the random tail is load-bearing (2000-id bursts contain same-second pairs and none collide). `reclaim_stale_scratch()` runs first thing in `scratch_run`, removes only files that satisfy `is_scratch_relpath` **directly** inside the rig folder, skips anything owned by a run live in this process (`_LIVE_RUNS`), never recurses into a subfolder, never creates the folder it inspects, and is idempotent. Anything rig-owned that survives reclaim stops the run with the named `SCRATCH_STALE_UNRECLAIMED`. |

---

## 2. Blocked Items

**None.** No AC was weakened, no escalation was required, no capability gap was hit.

Two decisions worth recording because a reviewer could otherwise read them as scope drift:

1. **The fingerprint is implemented as a hard gate, as the charter specifies** — `ScratchError` on
   mismatch, not a warning. T3_SharedContract §0.1 records that S5 expired and that the owner has
   released both vaults, which downgrades this from a data-safety gate to a *regression oracle*;
   AC3 nonetheless says a mismatch fails the run, so it fails the run. The relaxed constraint was
   not used to soften it.
2. **`main.ts` was not touched.** Charter §7b item 1 flags "`scratchAdapter` production wiring" as
   an untestable seam because `main.ts` has no test file. Rather than add untested wiring,
   `buildPluginHost` resolves the adapter itself: an explicitly supplied `plugin.scratchAdapter`
   wins, otherwise it falls back to `plugin.app?.vault?.adapter`, which — because Obsidian's
   `DataAdapter` already exposes `exists`/`mkdir`/`write`/`remove` — structurally satisfies
   `ScratchAdapterLike` as-is. The wiring therefore lives in the module that *does* have tests, and
   `null` still means "no adapter" (structured 400), never a guess. §7b item 1 is reduced, not
   closed: the real adapter's behaviour is still only exercised against fakes.

---

## 3. Changes Made

### 3.1 `tools/obsidian_e2e/scratch.py` — new (≈ 560 lines incl. docstrings)

Public surface, exactly as the visible tests pin it:

```python
ScratchError(reason, message="", changed=())        # .reason, .changed; subclass of RuntimeError
VaultWriteRefused                                   # the AC1 funnel's refusal (programming error)
Verdict(ok, reason, changed)                        # frozen dataclass
scratch_relpath(run_id) -> str
is_scratch_relpath(relpath) -> bool
assert_write_allowed(vault, target) -> str          # THE single write funnel
fingerprint_vault(vault) -> dict[str, tuple[int, str]]
diff_fingerprints(before, after) -> tuple[str, ...]
reclaim_stale_scratch(vault) -> tuple[str, ...]
stale_scratch_relpaths(vault) -> tuple[str, ...]    # feeds SCRATCH_STALE_UNRECLAIMED
scratch_run(vault, run_id=None, content=None) -> ContextManager[ScratchRun]
# ScratchRun: .vault .run_id .relpath .path .folder .folder_created .reclaimed
#             .before .after .removed .folder_removed .verdict  + .write(content)
```

Standard library only. Everything is pointable at a fixture vault by argument; no real vault path
appears anywhere in the module.

### 3.2 `plugin/src/testing/e2e-control.ts` — modified, **purely additive** (+~130 / −0 logic lines)

Regions touched, listed so WP49 can serialize against them:

| Region | Change | Kind |
|---|---|---|
| after `E2E_BUILD_MARKER` (was `:71`), before `interface E2EControlHost` | **inserted** the WP47 block: `SCRATCH_FOLDER`, `SCRATCH_PREFIX`, `SCRATCH_EXT`, `DEFAULT_SCRATCH_CONTENT`, `isScratchPath()`, `interface ScratchAdapterLike` | insertion |
| `interface E2EControlHost` body, at the end | **added** `scratchCreate?` and `scratchRemove?` — **optional**, so the hand-rolled fake hosts in `e2e-control.test.ts` and `wp49/*` stay valid | additive |
| immediately after `interface E2EControlHost` | **inserted** `interface E2EScratchControlHost extends E2EControlHost` re-declaring both methods as **required** | insertion |
| just before `routeCommand`'s doc comment | **inserted** helper `requireScratchPath(args)` | insertion |
| `routeCommand`'s `switch`, after `case "sync.waitQuiescent"` and before `default` | **added** `case "scratch.create"` and `case "scratch.remove"` | additive |
| `interface E2EPluginLike`, after `hasCanvasSurface?` | **added** `scratchAdapter?: ScratchAdapterLike \| null` | additive |
| just before `buildPluginHost`'s doc comment | **inserted** `isScratchAdapter()` + `resolveScratchAdapter()` | insertion |
| `buildPluginHost` signature | return type `E2EControlHost` → `E2EScratchControlHost` | one-token widening |
| `buildPluginHost`'s returned object, before `setFlag` | **added** `scratchCreate` and `scratchRemove` methods | additive |

**WP46's regions were not disturbed.** `E2E_BUILD_MARKER`, the optional `sessionInfo()` fields, the
`app?` / `manifest?` / `hasCanvasSurface?` members, the five WP46 resolvers and the `sessionInfo`
body are byte-identical to what WP46 landed. `createControlServer`, `resolvePort` and
`maybeStartE2EControlServer` are **untouched** — the two new commands ride the existing
`POST /command` envelope and add no transport, no route and no dependency.

Command contract (T3_SharedContract §6.1), verbatim:

| cmd | args | result |
|---|---|---|
| `scratch.create` | `path`, `content?` | `{created: bool, path: string}` |
| `scratch.remove` | `path` | `{removed: bool}` |

### 3.3 `tools/obsidian_e2e/__init__.py` — one docstring bullet + `scratch` added to `__all__`.

### 3.4 Test staging

The three vitest files were staged at **`plugin/src/__tests__/wp47/`**, not `…/t3/wp47/`. This is
not a preference: the visible files import `"../../testing/e2e-control"`, which only resolves one
level deep, and their own headers pin `plugin/src/__tests__/wp47/`. It matches the WP46 precedent
(`__tests__/wp46/`); the `t3/wp44/` files use `../../../` and are the other convention.

### 3.5 No constant owned by `constants.py` was redefined

`SCRATCH_FOLDER`, `SCRATCH_PREFIX`, `SCRATCH_EXT`, `PLUGIN_DIR_REL`, `FINGERPRINT_EXCLUDED`,
`FINGERPRINT_MISMATCH`, `SCRATCH_STALE_UNRECLAIMED`, `VAULT_PATH_MISSING`, `new_run_id()` and
`scratch_rel_path()` are all **imported** from `obsidian_e2e.constants`; `constants.py` itself was
not edited. The TS module declares `SCRATCH_FOLDER` / `SCRATCH_PREFIX` / `SCRATCH_EXT` /
`DEFAULT_SCRATCH_CONTENT` because §5 of the contract makes `e2e-control.ts` the pin for the TS
side; `scratch.py`'s `DEFAULT_SCRATCH_CONTENT` is documented in-file as the Python mirror of that
TS constant (the one value the contract locates on the TS side rather than in `constants.py`), and
the two strings are byte-identical: `{"nodes":[],"edges":[]}`.

---

## 4. Visible Test Results

**Python** — `cd <repo root> && "h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe" -m pytest workflowArtifacts/canvas-v2/tests/visible/WP47 -q`
→ **81 passed, 0 failed** (1.8 s). Run from the repo root, not the workspace root (the workspace
root aborts collection on the dangling `Projects/_external/FinaleAbgabe` junction — known
environment defect, unrelated to this WP).

| Test case | File | Result |
|---|---|---|
| TC1 scratch path derivation | `test_tp01_scratch_path_derivation_visible.py` | 13 passed |
| TC2 write-mode-open guard, full cycle | `test_tp02_write_guard_full_cycle_visible.py` | 4 passed |
| TC3 pattern collision not adopted | `test_tp03_pattern_collision_not_adopted_visible.py` | 4 passed |
| TC4 teardown on every exit path | `test_tp04_teardown_exit_paths_visible.py` | 11 passed |
| TC5 folder removal conditions | `test_tp05_folder_removal_conditions_visible.py` | 6 passed |
| TC6 fingerprint, clean run | `test_tp06_fingerprint_clean_run_visible.py` | 6 passed |
| TC7 one mutated byte fails the run | `test_tp07_fingerprint_mutation_fails_visible.py` | 6 passed |
| TC8 all four change classes | `test_tp08_fingerprint_change_classes_visible.py` | 11 passed |
| TC9 run_id collision | `test_tp09_run_id_collision_visible.py` | 7 passed |
| TC10 stale reclaim at start-up | `test_tp10_stale_reclaim_startup_visible.py` | 7 passed |
| TC11 reclaim is idempotent | `test_tp11_reclaim_idempotent_visible.py` | 6 passed |

**TypeScript** — `cd plugin && npx vitest run src/__tests__/wp47`
→ **64 passed, 0 failed** (0.5 s).

| Test case | File | Result |
|---|---|---|
| TC12 control path confinement | `test_tp12_control_path_confinement_visible.test.ts` | 46 passed |
| TC13 `scratch.create` contract | `test_tp13_control_create_contract_visible.test.ts` | 10 passed |
| TC14 `scratch.remove` contract | `test_tp14_control_remove_contract_visible.test.ts` | 8 passed |

**Regression gate.** Full plugin suite `npx vitest run`: **1099 tests, 1071 passed, 28 failed** —
every one of the 28 pre-existing and untouched by WP47:

- 25 in `src/__tests__/wp49/` — WP49's visible tests are staged ahead of WP49; `canvasFile` and
  `evaluateCanvasConvergence` do not exist yet.
- 1 in `src/__tests__/e2e-control.test.ts` and 1 in `src/__tests__/t3/wp44/test_tp11_…` — both
  assert `session.info`'s exact shape and see WP46's five added fields. Documented as the WP46
  baseline in `ImplementationReport_WP46.md` §4 ("26 failed … adding back the two assertions makes
  it 28").

`28` before and `28` after: no test outside WP47 changed state in either direction, and no
existing test was deleted, weakened or edited.

**Build gate.** `npm run build` is `tsc -noEmit && esbuild production`.

- `tsc -noEmit -skipLibCheck`: **17 errors, all in `src/__tests__/wp49/`** (`canvasFile` /
  `evaluateCanvasConvergence` / `DOC_CONVERGED_FILE_DIVERGED` not yet exported). **Zero** errors
  from `wp47/` or from `e2e-control.ts`. This half was already red before WP47 for the same reason;
  it goes green when WP49 lands.
- `node esbuild.config.mjs production`: **PASS**. The zero-production-footprint guard still holds —
  `grep -c -E "e2e-control|LIVESHARE_E2E|e2eControlPort" main.js` → **0**, and a WP47-specific grep
  `-E "_e2e-rig|e2e-scratch-|scratchCreate|isScratchPath"` → **0**. `plugin/main.js` is
  untracked/gitignored; it was rebuilt, never hand-edited.

**Data safety during implementation.** No path under `H:\Developement\_NeuralAngels\` was read,
written, hashed, listed or named. Every test ran against throwaway `tmp_path` fixture vaults. No
`data.json` content was printed, logged or included anywhere — the only `data.json` touched at all
is the synthetic one the fixtures create, and even that is only ever hashed.

---

## 5. Summary for Worker 3

WP47 is **DONE**, all four ACs met, 145/145 visible tests green (81 pytest + 64 vitest), zero
regressions, zero new dependencies, zero constants redefined.

Three things worth carrying forward:

1. **The two commands are in `routeCommand`'s `switch` only.** `createControlServer`, `resolvePort`
   and `maybeStartE2EControlServer` were not touched, and WP46's regions are byte-identical. WP49
   adds `canvas.file` to the same `switch` — the merge point is the block between
   `case "sync.waitQuiescent"` and `default`, and WP47's two cases now sit there.
2. **`buildPluginHost` now returns `E2EScratchControlHost`, not `E2EControlHost`.** The scratch
   methods are optional on the base interface (so existing fake hosts stay valid) and required on
   the returned type (so the visible tests can call them without an optional-call dance). If WP49
   adds `canvasFile`, the same pattern applies: optional on `E2EControlHost`, required on the
   narrowed return type — otherwise the three existing `fakeHost()` literals stop compiling.
3. **The reclaim rule is "not owned by a live run *in this process*".** This is data-safe in every
   case (only rig-owned artefacts inside the rig folder are ever removed) and it is what lets two
   overlapping runs share a vault, but it is an assumption about single-process operation. If WP48
   ever spawns a second rig process against the same vault, `_LIVE_RUNS` must become
   cross-process — charter §7b item 3 already flags this and it remains open.

---

## Attempt 2 — robustness

Three items. **No test was modified**; one visible test that had been failing
*intermittently by luck* is now deterministically green.

### 1. Run-id uniqueness no longer depends on the clock — or on luck

`constants.new_run_id()` built its 6-hex tail with `secrets.token_hex(3)`. That is
16.7 M values, so by the birthday bound a burst of a couple of thousand ids inside one
process collides with near-certainty — and TP09's
`test_all_ids_in_a_burst_are_unique` (2000 ids) *was failing on this run*: `1999 == 2000`.
The random tail made uniqueness probabilistic, which is precisely what a "two ids in the
same second must differ" AC must not be.

The uniqueness carrier is now something that **cannot repeat inside a process**: a
lock-guarded `itertools.count`, started at a random 24-bit offset, rendered as the same
6 hex digits. The pinned shape `<utc stamp>-<pid>-<6 hex>` is unchanged, the pid still
separates concurrent processes, and the random start still keeps two processes that share
a recycled pid from marching in lockstep. Verified: **200 000 ids in one process, zero
collisions** (the old generator fails at ~2 000).

This is edited in `constants.py`, the owning module — nothing was redefined or shadowed
elsewhere, and the format the contract pins is untouched.

### 2/3. Interrupt unwinding: order preserved, interruption never masked

The ordering property held already and is now *guaranteed* rather than incidental — the
cleanup runs inside the `except BaseException` handler, i.e. while the original exception
is propagating, so every context manager the body opened has finished unwinding first
(Python unwinds inside-out) and an outer teardown observes this one as finished. Verified
with an inner context manager nested inside `scratch_run` inside
`teardown.run_with_teardown`: `inner-unwound` → `outer-teardown`, in that order.

The **masking** defect was real. `except BaseException: _teardown(run); raise` looks safe
and is not: an exception raised *out of the handler* replaces the exception in flight. With
the scratch file locked (the realistic case: Obsidian still holds it), an interrupted run
raised `OSError("locked")` and the `KeyboardInterrupt` was gone — the operator's Ctrl-C
reported as a file error. `_teardown` now:

- attempts the file removal and the folder removal **independently**, so one failure no
  longer costs the other, nor the live-run deregistration, nor the after-fingerprint —
  teardown always reaches its end and always leaves a settled state;
- collects what went wrong on `ScratchRun.teardown_errors` (recorded, never silently
  dropped);
- takes `mask_errors`: on the failure path the collected errors are **not** raised, so the
  original `KeyboardInterrupt` propagates unmasked; on the clean path the first one *is*
  raised, because there is nothing more important to report.

Verified: with removal forced to fail, an interrupted run propagates `KeyboardInterrupt`
(previously `OSError`) and the error is retrievable from `run.teardown_errors`. And an
interrupted run over a **500-file** fixture vault (nine nested folders, `.obsidian/`) leaves
the vault byte-identical — full sha256 map before and after.

### Also added here (consumed by WP48)

`reclaim_scratch_folder(vault)` — the **start-up** rule for the rig folder, kept in the
module that owns the vault-write funnel. Every removal still passes `assert_write_allowed`
and there is still no `rmtree` anywhere: the tree is walked bottom-up and each file and
directory is removed through the guarded primitives. See WP48 §7.4 for why start-up needs a
different rule from teardown's. `scratch_run`'s own teardown rule is **unchanged** — the
folder goes only if this run created it and it is empty, so a user file or a concurrent
run's artefact still stops it (TP05) — and `reclaim_stale_scratch`'s file-level rule is
unchanged too.

**Result.** Visible suite **266/266** (before: 265 passed, **1 failed** — TP09's burst
test). WP47's own tests unchanged and green.

### One reported defect, left unfixed (no test was modified)

`tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` contains two test points
that **no implementation can pass**, because its own helper consumes the exception before
the test can see it:

```python
def drive(vault, exit_path, log):
    ...
    with pytest.raises(expected):      # <- the exception is caught HERE
        body()
    return captured["file"]

def test_the_inner_context_manager_unwinds_before_teardown_finishes(vault):
    with pytest.raises(RigFailure):    # <- ...so this can never see one
        drive(vault, "raised_exception", log)
```

`pytest.raises` as a context manager *suppresses* the exception, so `drive()` always
returns normally and the outer `with pytest.raises(...)` fails `DID NOT RAISE` whatever the
production code does. This affects
`test_the_inner_context_manager_unwinds_before_teardown_finishes` and
`test_forty_notes_are_all_still_there_after_an_interrupted_run`; the other nine tests in the
same file use `drive()` correctly (relying on it *not* propagating) and all pass.

Both properties they intend to check are in fact covered — and green — by their siblings in
that same file, which is why this is reported rather than worked around:

- inner-CM unwind order → `test_two_consecutive_runs_on_the_same_path_both_clean_up`
  asserts `log == ["enter", "exit", "enter", "exit"]` on all four exit paths, including
  `keyboard_interrupt`;
- large-vault integrity after an interruption →
  `test_the_large_vault_is_bit_identical_afterwards[keyboard_interrupt]` compares the full
  `fingerprint_vault` of the 43-file fixture before and after.

Independently verified outside the suite: an interrupted run over a 500-file, nine-folder
fixture vault leaves it byte-identical, and the unwind order is
`inner-unwound → outer-teardown` with `scratch_run` nested inside
`teardown.run_with_teardown`.

**Suite status at handover:** visible **266/266**; blind sets **645/647**, the two failures
being exactly the double-wrapped test points above.
