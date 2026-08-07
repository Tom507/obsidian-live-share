# Implementation Report — WP69

Attempt: 3

## Status: DONE

All 11 visible test files pass: **68 collected / 68 passed / 0 failed** (pytest 8.4.2,
`h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe`, re-run after every attempt-2 and
attempt-3 change, cwd = repo root).

---

# Attempt 3 — `build:e2e` appended instead of inserted

One file changed, `plugin/package.json`, one key moved, nothing else — not `version`, not either
dependency block, not the definition of any script including the added one.

## What was wrong

Attempts 1 and 2 placed `"build:e2e": "node esbuild.config.mjs e2e"` **immediately after `build`**,
i.e. at index 2 of `scripts`. Its *definition* was correct and the six pre-existing scripts were
verbatim, so TC3 passed — but the insertion displaced `test`, `test:watch`, `lint` and `format` by
one position each. `plugin/package.json` is a batch shared-ownership file, and that rule is
**append, never edit or reorder**: a co-owner's entry keeps its text *and* its place. Verbatim
definitions alone do not satisfy it; the six baseline names must remain an untouched contiguous
prefix in their original order.

## The fix

`build:e2e` is now the **last** key of `scripts`:

```
dev, build, test, test:watch, lint, format, build:e2e
                                            ^^^^^^^^^ appended last
```

Its name and command string are unchanged (`node esbuild.config.mjs e2e`), so nothing the AC1/AC3
measurements rest on moved. The practical confirmation is the diff shape: `git diff
plugin/package.json` against HEAD is now a **single added line** on the tail of the object plus the
comma that the previous last entry needed — no line of the file is shown as removed-and-re-added,
which is precisely what "append, never reorder" looks like in a diff. Before the fix the same diff
showed four displaced scripts.

`plugin/esbuild.config.mjs`, `tools/obsidian_e2e/install.py`, `constants.py` and
`T3_SharedContract.md` were **not touched in attempt 3**, and no test file was edited, weakened,
retitled, skipped or deleted.

## Attempt-3 verification (all re-measured after the change)

| Check | Result |
|---|---|
| Visible suite, 11 files, repo root as cwd, explicit file paths | **68 collected / 68 passed / 0 failed** |
| `npm run build` (from `plugin/`) | exit 0 |
| `plugin/main.js` sha256 | `58fda6f8a9f2534fb4c4d08d4b45ac3c4db6bfc8bd06b47ba84899e9f23946bc` — **unchanged**, the abort criterion holds |
| `plugin/main.js` size | 759 892 B — unchanged |
| `npm run build:e2e` still resolves under the new key order | exit 0, terminates, 3 601 280 B |
| `npm run dev` | **not run**, by instruction |

The tree is left carrying the **production** bundle: `npm run build` was the last build command
executed, and the hash above was taken after it.

## Foreign edits at attempt-3 handover (reported, not touched)

`git status` shows, besides this WP's files: `tools/obsidian_e2e/__pycache__/constants.cpython-312.pyc`
(tracked `.pyc`, re-dirties on every import — pre-existing hygiene item) and
`workflowArtifacts/canvas-v2/TaskCharter_WP69_E2EBuildModeAndInstall.md`, which this sub-agent did
not write. Neither was modified here. The `workflowArtifacts/canvas-v2/` entries attempt 2 reported
have been committed by their owner in the meantime; HEAD is now `ba2c129`.

---

# Attempt 2 — generalising the restore-point discipline

Attempt 1 was green and still is; it was also **overfit**. Its record validation satisfied the
cases the visible tests name rather than the property behind them. Attempt 2 changes exactly one
file, `tools/obsidian_e2e/install.py`, and changes no behaviour that any AC1/AC2 measurement
depends on: `plugin/esbuild.config.mjs` and `plugin/package.json` were **not touched**, and no new
constant or failure reason was needed, so `constants.py` §4.1 and `T3_SharedContract.md` §4.1 were
**not amended either**. Every refusal added below names a reason WP69 already owns.

## The property that was missing

Stated as a property, not as a list of cases:

> **A recorded restore point is a claim stored in two files. Every field of that claim is
> structurally valid or the claim is refused; every fingerprint the claim carries about the
> displaced bundle is checked against the bundle it describes; the same checks run at every entry
> point that consumes the claim; and establishing the claim is verified through the validator that
> will later consume it, before anything irreversible happens.**

Attempt 1 held a strictly weaker version of each clause. WP44's `ports.py` is the module WP69 was
chartered to *follow*, and the gaps are exactly the places where attempt 1's checks were fewer or
weaker than the ones `ports.py` performs on the state it owns:

| Clause | Attempt 1 | Attempt 2 |
|---|---|---|
| Marker fields validated | 2 of 8 — `hadOriginal`, `originalSha256` | all 8 of `INSTALL_MARKER_FIELDS` |
| Fingerprints of the displaced bundle checked against it | sha256 only | sha256 **and** the recorded byte length |
| Where those checks run | `capture_bundle_state` and `restore_bundle` disagreed on which they did | identical at `capture_bundle_state`, `install_bundle` and `restore_bundle` |
| Restore point verified as *restorable* | the backup was hashed after writing | backup **and** marker are read back through `capture_bundle_state` — the same oracle teardown runs |
| A refusal after the rig started writing | left the rig's half-borrow in the vault | rolls back every artefact **this call** created; an adopted one is never removed |
| `role` | any string, recorded verbatim into the marker | must be one of `constants.ROLES` (`ValueError`, exactly as `ports.provision_port`) |
| Exit status | `int(status)` — `None` raised `TypeError` | a non-integer status is a named `E2EBuildFailed`, never coerced |

### Why `originalSize` was the sharp edge

WP69's marker records **two** fingerprints of the displaced bundle (`originalSha256`,
`originalSize`); WP44's records one. Attempt 1 copied WP44's *verification* while writing WP69's
*record* — so the second fingerprint was written, displayed and never once compared against the
file it describes. A recorded fingerprint that nothing verifies is worse than an absent one,
because it reads as corroboration. A marker whose `originalSize` had been hand-edited, or whose
`hadOriginal: false` half carried a stray size, was accepted as a valid restore point.

### Why the rollback matters

AC4's "an install that cannot establish its restore point does not install" is a statement about
the *failure* path. Attempt 1 satisfied it only while the failure was detected **before** the rig
wrote anything. A failure detected after the backup landed left an unattributed backup in the
plugin directory — which every later run then refuses as `INSTALL_CONFLICT`, forever, for a vault
in which nothing was ever installed. Attempt 2 makes install all-or-nothing up to the `main.js`
replacement: on any failure the artefacts this call created are removed and any marker it
overwrote is put back byte-exactly, so the refusal leaves the vault as it was. The distinction that
keeps this safe is *created by this call* vs *adopted from an earlier one* — an adopted backup may
be the only surviving copy of the owner's bundle and is never removed by a rollback.

## Changes made in attempt 2 — `tools/obsidian_e2e/install.py` only

- `_is_int` / `_is_digest` helpers. `_is_digest` deliberately checks **shape only** (a 64-character
  string), because whether those characters are the *right* ones is a content question. Keeping
  shape and content apart is what preserves the `INSTALL_CONFLICT` (damaged record) vs
  `BUNDLE_RESTORE_MISMATCH` (intact record the bytes contradict) discriminator that `ports.py`
  draws and that TC8 and TC10 both rely on.
- `_load_marker` validates the whole pinned field set: `runId`/`role`/`createdAt` non-empty
  strings, `role` a real role, `pid` a non-negative non-bool integer, `hadOriginal` a true boolean,
  `installedSha256` always a digest, and `originalSha256` **and** `originalSize` present together
  exactly when `hadOriginal` and both absent otherwise.
- `capture_bundle_state` additionally checks the backup's byte length against the recorded
  `originalSize` (`INSTALL_CONFLICT`), after the sha256 check so every existing message is
  unchanged.
- `restore_bundle` performs the same length check before writing (`BUNDLE_RESTORE_MISMATCH`,
  matching the entry point's existing discriminator), and its post-write readback is now verified
  against the **marker's** recorded size and sha256 rather than against the bytes it just wrote — a
  readback compared only to its own source proves the write, never the restore.
- `install_bundle` rejects an unknown `role` with `ValueError` before anything is read; verifies the
  freshly written backup by length **and** sha256; then re-reads backup + marker through
  `capture_bundle_state` before touching `main.js`; and rolls back its own artefacts on any failure
  in that window.
- `verify_e2e_bundle` / `build_e2e_bundle` refuse a non-integer exit status as `E2EBuildFailed`
  instead of coercing it. A runner that returns nothing did not report a successful build.

## How attempt 2 was verified beyond the visible set

The visible suite is unchanged and re-run: **68 collected / 68 passed / 0 failed**. Because passing
it is what attempt 1 already did, the new properties were additionally exercised by an adversarial
scratch probe outside the repo, `h:\tmp\wp69_attempt2_probe.py`, run through `visible-console`
`run_python` (console `e5b3e801`, exit 0) against synthetic fixture vaults under `h:\tmp\` only:

| Probe | Result |
|---|---|
| a marker whose `originalSize` disagrees with the backup is refused at `capture_bundle_state`, `install_bundle` **and** `restore_bundle`, with the vault digest map unchanged | OK |
| 15 individually damaged marker fields (non-string `runId`, empty `createdAt`, unknown `role`, string `pid`, negative `pid`, `hadOriginal: 1`, null/truncated `installedSha256`, null/string/negative `originalSize`, truncated `originalSha256`, a size recorded alongside `hadOriginal: false`, …) are each refused at all three entry points, vault unchanged | OK |
| an unknown role raises `ValueError` and never reaches the marker | OK |
| an install whose restore point cannot be verified leaves **no** artefact behind and `main.js` untouched | OK |
| that rollback does **not** delete an earlier run's backup or marker, and that run is still restorable afterwards | OK |
| a runner returning `None` is `E2EBuildFailed`, not a `TypeError` and not a success | OK |
| every happy path still works: install, adopt-and-reinstall, byte-exact restore, repeat-restore no-op, and the no-prior-bundle vault that restores to *no file* | OK |

The probe is scratch, lives outside the repository, and is **not** a test file — no test in
`tests/visible/WP69/` was added, deleted, weakened, retitled, skipped or amended.

## Attempt-2 constraints re-checked

- `plugin/esbuild.config.mjs` and `plugin/package.json` are byte-identical to attempt 1 — the
  production-bundle abort criterion (`58fda6f8…`, 759 892 B, zero E2E markers) cannot have moved.
- `constants.py` and `T3_SharedContract.md` are byte-identical to attempt 1; no failure reason was
  added, so the append-only rule had nothing to append.
- `data.json` is still unreachable from this module; the string `PLUGIN_DATA_REL` still does not
  occur in it. No refusal message added above carries anything but paths, sizes, digests, field
  names and a reason.
- The owner's four `*.bak` files are still never written, moved, renamed, deleted or consulted; the
  new rollback removes only `BUNDLE_BACKUP_REL` and `INSTALL_MARKER_REL`, and only when this call
  created them.
- No install or restore ran against an owner vault. Every exercise above used
  `h:\tmp\wp69probe-<uuid>\`, removed afterwards.
- `git status` at attempt-2 handover shows only this WP's files plus the tracked
  `tools/obsidian_e2e/__pycache__/constants.cpython-312.pyc`, which re-dirties on import. The two
  Worker 2 entries attempt 1 reported (`BUILD_SPEC_CanvasV2.md`, `TaskCharter_WP7_…`) are no longer
  dirty — Worker 2 has evidently committed them. Reported, not touched.

---

# Attempt 1 (retained verbatim)

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — one explicit third mode, `argv[2] === "e2e"`, one-shot, options identical to the watch branch, both existing branches behaviourally unchanged, one added script | **DONE** | `esbuild.config.mjs` now derives `const oneShot = prod || mode === E2E_MODE` and the terminating branch is `if (oneShot)`. The option object is untouched, so the `e2e` options are *the same expression* as the watch options — `__LS_E2E__: "true"`, `sourcemap: "inline"` — rather than a copy that can drift. TC1/TC2 verify this against the option object the real config passes to a recording `esbuild` stub, not against the file's text: `e2e` → `context, rebuild, exit` (no `beforeExit` ⇒ ended by `process.exit`), `production` → `context, rebuild, exit` with `__LS_E2E__ "false"` / `sourcemap false`, no-argv **and** an unknown token → `context, watch, beforeExit, exit`. A failing rebuild exits **1** (rejected top-level await). One script added: `"build:e2e": "node esbuild.config.mjs e2e"`; the six existing scripts, both dependency blocks and `version` are byte-identical to the B9b baseline (TC3). |
| **AC2** — production build's output provably unchanged | **HALF DONE — the "after" half is Worker 3 Core's, by instruction** | The "before" measurement was taken by Worker 3 Core before this sub-agent started and is **not re-taken here**: commit `fcb2295` (and independently `6b20c17`), quiet tree, `npm run build` in `plugin/`, `plugin/main.js` sha256 `58fda6f8a9f2534fb4c4d08d4b45ac3c4db6bfc8bd06b47ba84899e9f23946bc`, 759 892 bytes, **0** occurrences of `__LS_E2E__`. The "after" production build and its marker counts are Core's measurement. ⚠ **See "What has NOT been executed" below: `plugin/main.js` currently holds the E2E bundle, not a production one.** |
| **AC3** — the E2E bundle is verified capable and complete before installation | **DONE** | `verify_e2e_bundle` accepts only exit status `0` **and** all three of `constants.E2E_BUILD_MARKERS`; the status is checked first and *without reading the file*, so a complete-looking bundle at the outfile can never speak for a build that failed. Neither file presence nor `mtime` is consulted anywhere in the module (TC6 asserts both non-signals explicitly). Real measurement below. |
| **AC4** — installation is exactly reversible and touches nothing that is not ours | **DONE (against fixture vaults only)** | One file per vault is written, `<vault>/.obsidian/plugins/live-share/main.js`, plus the rig's own two files. The restore point is written, **read back and verified against its sha256 before `main.js` is touched** — an install that cannot establish it raises and writes nothing. Restore runs on normal exit, exception, `KeyboardInterrupt` and an `atexit` guard; it restores from `BUNDLE_BACKUP_REL` **only** and refuses (`BundleRestoreMismatch`) rather than falling back to the owner's `main.js.bak`. TC7–TC11 assert a whole-vault sha256 map before/after. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| Running the visible suite from the AgenticWorkspace root, as §7 specifies | **Pre-existing environment breakage, unrelated to WP69.** `Projects/_external/FinaleAbgabe` is a symlink to `/e/Dateien/…` on a drive that is not mounted. pytest's directory walk raises `FileNotFoundError` in `os.path.samefile` on it and aborts collection **before any test file is read**, for *any* path under `Projects/_external/`. Reproduced identically on WP44's visible suite (`--co` ⇒ same error), so it is not caused by this WP. | Ran the same interpreter and the same test files with the repository as cwd (`H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share`, reached through the junction rather than through `Projects/_external/`). Collection then succeeds: WP44 collects 59, WP69 collects 68. The scratch launcher is `h:\tmp\wp69_run_visible_tests.py` (outside the repo). **This is a workspace-hygiene item for the owner (a dangling symlink), not a WP69 defect, and it is not fixed here — it is outside this WP's file boundary.** |
| The standalone `python tools/test_<name>.py` script named by charter §6 | The batch scope handed to this sub-agent is **exactly three files** plus the two shared-ownership files; a new `tools/test_install.py` is outside it. No earlier PHASE T3 WP created one either (`tools/` holds no `test_*.py`). | Not created. AC3 and AC4 are settled by the 11-file visible pytest suite, which is executable, was executed, and asserts strictly more than a smoke script would. Flagged for Worker 3 Core rather than decided unilaterally. |

## Tools Created

| Tool | Type | Purpose |
|---|---|---|
| `tools/obsidian_e2e/install.py` | new Python module (stdlib only) | Build, verify, install and reversibly restore the E2E plugin bundle. Public surface exactly as charter §7 pins it. |
| `plugin/package.json` → `build:e2e` | npm script | The single reachable entry point to the one-shot instrumented build. |
| `h:\tmp\wp69_run_visible_tests.py`, `h:\tmp\wp69_measure_bundle.py` | scratch, **outside the repo** | Test launcher and bundle measurement. Not part of the deliverable; delete at will. |

## Changes Made

- **`plugin/esbuild.config.mjs`** — the mode branch only. `const prod = process.argv[2] === "production"` becomes `const mode = process.argv[2]` / `const prod = mode === "production"` / `const oneShot = prod || mode === E2E_MODE`, and `if (prod)` becomes `if (oneShot)`. The esbuild option object is **not edited** — that is deliberate and is what makes AC1's "identical in every field" structural rather than a promise: `e2e` and the watch branch evaluate the *same* `prod ? … : …` expressions. `production` still folds `__LS_E2E__` to `"false"`, still sets `sourcemap: false`, still exits `0`; every other `argv[2]`, including none, still reaches `ctx.watch()`.
- **`plugin/package.json`** — one line added, `"build:e2e": "node esbuild.config.mjs e2e"`, placed after `build`. Nothing else in the file changed: no dependency, no `version`, no existing script. It mirrors `dev` (no `tsc` pass) because `e2e` *is* the dev configuration, one-shot; the type-check gate stays where it is, on `build`.
- **`tools/obsidian_e2e/install.py`** — new, ~640 lines, standard library only, following WP44's `ports.py` discipline rather than inventing one: raw bytes end to end (a bundle is not text), atomic `os.replace` writes with the temp file in the same directory and removed on every failure path, a marker carrying fingerprints and structure only, adoption of a consistent leftover borrow and refusal of a contradictory one. Public surface: `count_build_markers`, `build_command`, `verify_e2e_bundle`, `build_e2e_bundle(plugin_dir, *, runner=None)`, `capture_bundle_state`, `install_bundle`, `restore_bundle`, `installed_bundle`; errors `InstallError` / `E2EBuildFailed` / `BundleNotE2ECapable` / `BundleRestoreMismatch` / `InstallConflict` / `PluginNotInstalled`; dataclasses `BuildResult`, `BundleState`, `InstallRecord`, `RestoreBundleResult`. The string `PLUGIN_DATA_REL` does not occur in the module: `data.json` is not read, moved or written by this WP at all.
- **`tools/obsidian_e2e/constants.py`** — one appended `§4.1 — WP69` block (between §4 and §5; no existing line edited, moved or re-indented) with `E2E_BUILD_ARGV`, `E2E_BUILD_SCRIPT`, `BUNDLE_BACKUP_REL`, `INSTALL_MARKER_REL`, `INSTALL_MARKER_FIELDS` and the four reason names; plus four entries appended to the **end** of `FAILURE_REASONS` in one contiguous run, each with a `# WP69 ACn` comment. WP70's `§10` block goes after this one.
- **`workflowArtifacts/canvas-v2/T3_SharedContract.md`** — the matching `§4.1` amendment (contract §1.4). Nothing else in the file touched; §11 left as B9a's historical record.

**Not touched, verified by `git status`:** `plugin/src/**`, `server/**`, `plugin/manifest.json` (broken symlink — neither read nor opened), the plugin version, `%APPDATA%\obsidian\obsidian.json`, `tools/obsidian_e2e/ports.py`, and both owner vaults.

## The E2E bundle — AC3's measurement

**Exact command that produces it** (from `plugin/`, and it is the only one):

```
npm run build:e2e          →  node esbuild.config.mjs e2e
```

It **terminates**: exit `0`, no watcher, nothing killed. `install.build_command()` returns
`("npm", "run", "build:e2e")`, so the run record and the module agree by construction.

| | E2E bundle (measured, 2026-08-04) | production bundle (Core's "before", `fcb2295`) |
|---|---|---|
| size | **3 601 280 bytes** | 759 892 bytes |
| sha256 | `1f905b04dad12d109c0b7558381cb7e928db28a1470f42c7a2c72d0c891f9f16` | `58fda6f8a9f2534fb4c4d08d4b45ac3c4db6bfc8bd06b47ba84899e9f23946bc` |
| `e2eControlPort` | 1 | 0 |
| `LIVESHARE_E2E` | 1 | 0 |
| `e2e-control` | 2 | 0 |
| `__LS_E2E__` | **0** — see the note below | 0 |
| verdict | `e2e_capable = True`, `markers_missing = ()` | not capable, by design |

**The size difference is expected and is not corruption.** The E2E bundle is ~4.7× the production
bundle (3 601 280 vs 759 892 bytes, +2 841 388) for two compounding reasons: the dev configuration
emits `sourcemap: "inline"`, which base64-embeds the entire TypeScript source map into `main.js`,
and `__LS_E2E__` is `"true"` so the whole `src/testing/` tree survives tree-shaking instead of being
eliminated. A reader who finds a multi-megabyte `main.js` in a plugin directory during the gate run
is looking at the instrumented build, not at damage.

**Note on `__LS_E2E__` counts — read before quoting AC2.** The count is **0 in both builds**. esbuild's
`define` substitutes the identifier at compile time, so the *name* never survives into either bundle;
what differs is the value it folded to and therefore whether `src/testing/` is still there. AC2's
"zero `__LS_E2E__` occurrences in the production bundle" is thus a *necessary but not distinguishing*
signal. The three build markers are the distinguishing one, and they are 0/0/0 in production versus
1/1/2 in the E2E bundle. `install.count_build_markers()` returns both, so the AC2 measurement can quote
the pair rather than the flag alone.

## AC4's restore comparand — the recorded per-vault production `main.js`

Measured before any gate work; both live vaults are **byte-identical**:

| Vault | `main.js` sha256 | size |
|---|---|---|
| `H:\Developement\_NeuralAngels\ObsidianOrga` (role `a`) | `93bdc5f4c8785a4e3a326a8a4d275d8ee622c692d28a43d4da1b8c57eae69d9c` | 626 711 B |
| `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (role `b`) | `93bdc5f4c8785a4e3a326a8a4d275d8ee622c692d28a43d4da1b8c57eae69d9c` | 626 711 B |

That is the value `restore_bundle()` must reproduce in each vault, and the value
`RestoreBundleResult.restored_sha256` will carry. It is **not** the 759 892-byte figure above: the
installed bundles are an older build of an older source tree (2026-07-26), which is expected and is
not a discrepancy.

## What has **NOT** been executed

Nothing below may be reported as observed by anyone reading this file.

- **No live installation into the owner's vaults has occurred in this run.** `install_bundle()` was
  never called with `H:\Developement\_NeuralAngels\ObsidianOrga` or `… - Kopie`. Every install and
  restore in this run ran against synthetic fixture vaults created under `h:\tmp\wp69-<uuid>\` and
  removed afterwards; each fixture asserts it is neither an owner vault nor inside one before it is
  built. The single live installation is Worker 3 Core's / WP7's, under the restore point this module
  establishes.
- **Neither vault's `data.json` was read, moved or written.** The module has no code path to it.
- **The AC2 "after" production build is Worker 3 Core's measurement, not mine** — deliberately, so the
  before/after pair is taken by one party on a quiet tree.
- ⚠ **`plugin/main.js` currently holds the E2E bundle** (`1f905b04…`, 3 601 280 B), because building it
  was AC3's measurement and the outfile is fixed. **Run `npm run build` in `plugin/` before taking the
  AC2 "after" hash.** Hashing the file as it stands would compare a production bundle against an E2E
  one and abort for the wrong reason. `plugin/main.js` is git-ignored (`.gitignore:10`), so this does
  not dirty the tree.
- **No control endpoint has answered on this host, no relay was started, and no propagation between
  the two vaults was observed.** Unchanged by this WP.
- `npm test` / `npm run build` were **not** run by this sub-agent — the handover gate in charter §6 is
  Worker 3 Core's, and `npm run dev` was never invoked at any point, by design.

## Visible Test Results

Run: `pytest workflowArtifacts/canvas-v2/tests/visible/WP69 -p no:cacheprovider -v`, cwd = repo root,
interpreter `h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe` (pytest 8.4.2, Python 3.12.10),
launched through `visible-console` `run_python`. **68 collected / 68 passed / 0 failed / 11 files.**

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_build_mode_termination_visible.py` (5) | PASS | `e2e` = `context, rebuild, exit`, no `beforeExit`, no `watch`; `production` unchanged; missing and unknown `argv[2]` both still `context, watch, beforeExit, exit`. |
| TC2 `test_tp02_e2e_options_identical_to_watch_visible.py` (5) | PASS | `e2e` options deep-equal the watch branch's; `production` differs in exactly `{sourcemap, define}`; the shared fields are non-trivial. |
| TC3 `test_tp03_package_json_one_added_script_visible.py` (5) | PASS | Six baseline scripts verbatim, exactly one added, it passes the pinned argv token and not `production`, no dependency changed, version still `0.6.1`. |
| TC4 `test_tp04_failed_e2e_build_exits_nonzero_visible.py` (6) | PASS | Node-level failure exits non-zero; the Python seam raises `E2EBuildFailed` with a fully marked bundle already at the outfile and leaves it byte-identical; the runner receives the recorded command. |
| TC5 `test_tp05_marker_counting_visible.py` (6) | PASS | Independent per-marker counting over raw bytes, including a blob no codec accepts. |
| TC6 `test_tp06_verify_requires_status_and_markers_visible.py` (12) | PASS | Status and markers each veto on their own; presence, a moved `mtime` and a truncated bundle are all refused. |
| TC7 `test_tp07_install_writes_exactly_one_file_visible.py` (6) | PASS | Whole-vault sha256 map: only `main.js` changes identity; the only new paths are the rig's backup and marker; nothing is removed. |
| TC8 `test_tp08_restore_point_before_write_visible.py` (6) | PASS | Missing plugin dir, unattributed backup, marker without backup and hash disagreement each raise a named refusal with the digest map unchanged; a clean vault still installs. |
| TC9 `test_tp09_restore_every_exit_path_visible.py` (7) | PASS | Byte-exact restore on normal exit, on an exception and on `KeyboardInterrupt`; the bundle really was replaced in between; no rig artefact survives; repeated restore is a safe no-op. |
| TC10 `test_tp10_owner_backups_untouched_visible.py` (5) | PASS | The three owner backups survive install *and* restore byte-identically; with a corrupted rig backup the module raises `BundleRestoreMismatch` instead of using `main.js.bak`, which in that test holds bytes that would have made the fallback look correct. |
| TC11 `test_tp11_no_secret_leak_visible.py` (5) | PASS | The settings file is byte-identical throughout; the sentinel appears in no record, marker or refusal message; the marker's key set is exactly the pinned field set. |

## Foreign edits observed (reported, not touched)

`git status` at handover shows, besides this WP's files, three entries this sub-agent did **not**
write and did **not** modify:

- `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — the concurrent Worker 2.
- `workflowArtifacts/canvas-v2/TaskCharter_WP7_E2ERigMandatoryGate.md` — likewise.
- `tools/obsidian_e2e/__pycache__/constants.cpython-312.pyc` — a **tracked** `.pyc`, which re-dirties
  itself every time anyone imports `constants`. Pre-existing repo-hygiene item; not this WP's to fix,
  but explicit path staging must not sweep it in accidentally.

HEAD at handover is `fb778a5`, i.e. the batch has advanced past the `fcb2295` / `f9774f8` baselines
recorded in the shared-ownership contract. The advance is documentation and a revert of a
`plugin/src/__tests__` mirror (`6b20c17`), so it does not reach the bundle.

## Summary for Worker 3

WP69 is implemented and locally green: the plugin now has a third, one-shot build mode reachable only
through `npm run build:e2e`, whose options are the *same expressions* as the watch branch rather than a
copy that can drift, and `tools/obsidian_e2e/install.py` can build, verify, install and byte-exactly
restore that bundle in a vault, establishing and verifying its restore point before it writes and
refusing to touch or borrow from any of the owner's four `*.bak` files. 68/68 visible tests pass. Two
things need your hand: **(1)** `plugin/main.js` currently holds the E2E bundle (3 601 280 B,
`1f905b04…`), so run `npm run build` in `plugin/` before taking AC2's "after" sha256 — comparing the
file as it stands would abort for the wrong reason; **(2)** the visible suite cannot be collected from
the AgenticWorkspace root at all right now because `Projects/_external/FinaleAbgabe` is a dangling
symlink that kills pytest's directory walk for every path under `_external/` — reproduced on WP44's
suite too, so it is an environment item, not a WP69 one, and it will hit your own gate run. Nothing was
installed into either owner vault, no `data.json` was read, and no control endpoint has answered.
