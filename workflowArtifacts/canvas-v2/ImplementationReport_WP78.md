# Implementation Report — WP78: the build runner is required, so no spawn is reachable by accident

**WP:** WP78 · **Phase:** P0 (PHASE T3 group) · **Branch:** `fix-bugs-and-raceconditions`
**Status:** `DONE` · **risk_flag:** `NONE`
**Charter:** `TaskCharter_WP78_RequiredRunnerNoAccidentalSpawn.md` (4 ACs)
**Commits:** `303292b` (implementation) · `4cb472a` (oracle + visible suite + contract §9a) ·
one final commit carrying this report and a one-line docstring correction in `install.py`
(the opt-in runner's docstring still described the `import` as living "at the top of this
module" after it had been moved into the function — corrected, no behaviour change)

> **Workflow note.** Written under the 2026-08-05 workflow change (`DISPATCHER_STATE.md`,
> AUTONOMOUS MODE): **blind sets, `BlindVerificationLedger` rows and falsification injections
> as a separate ledger discipline are discontinued.** This WP therefore produced **no**
> `blind_set1` / `blind_set2` suite and owes no ledger row. AC4's three named injections are
> still executed — they are ordinary tests in the visible suite, because the property here is
> a reachability fact about a parsed module, not something observable in an editor. Every
> absence assertion carries its positive control.

---

## 0. What was done, in one paragraph

`install.build_e2e_bundle`'s `runner` lost its default and stayed keyword-only, so
`build_e2e_bundle(plugin_dir)` is a `TypeError` **at the call** instead of an npm spawn at
runtime. The spawning implementation was renamed from the private, unexported
`_default_runner` to the public, exported, opt-in `spawning_subprocess_runner`, which is the
default value of nothing and is referenced nowhere inside the package. Its `import
subprocess` was moved **into** that function, so the package binds `subprocess` at module
scope nowhere and **both** of its spawn primitives are inside the one named function. Nothing
was deleted: `import subprocess` and `subprocess.run` both remain, gated rather than removed.

---

## 1. Acceptance criteria

### AC1 — no runner default; the spawning implementation is a named, public, opt-in symbol — **MET**

| | before (`d9390ba`) | after |
|---|---|---|
| signature | `def build_e2e_bundle(plugin_dir: PathLike, *, runner: Optional[Runner] = None) -> BuildResult:` | `def build_e2e_bundle(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:` (`install.py:595`) |
| substitution | `reported = (runner or _default_runner)(command, str(cwd))` | `reported = runner(command, str(cwd))` |
| spawning runner | `_default_runner` — private, **not** in `__all__`, reachable **by omission** | `spawning_subprocess_runner` (`install.py:479`) — public, in `__all__` (`:133`), reachable only by being **named** |
| `import subprocess` | module scope (`:101`) — bound `install.subprocess` | function-local (`:518`), inside the opt-in runner |
| `subprocess.run` | `:476`, inside `_default_runner` | `:527`, inside `spawning_subprocess_runner` |

- `runner` is **keyword-only**, `has_default = False`, `default_source = None`, annotated
  `Runner` (not `Optional[Runner]` — an `Optional` annotation would re-open the `None` branch).
- **No replacement substitution of any shape.** The AST classification of every use of
  `runner` in the body returns `call-target: 1` and `boolop / ifexp / compare / rebound /
  other: 0`. `functools.partial` occurs nowhere in the package. The only module-level binding
  in the package matching `/runner/i` is the **type alias** `Runner = Callable[[Sequence[str],
  str], int]` (`install.py:153`) — pinned exactly, so a constant named anything at all that
  holds the spawning runner fails the test.
- **`_default_runner` does not survive as an alias:** no definition, zero name references
  anywhere in the package, not in any `__all__`, `hasattr(install, "_default_runner")` is
  `False`. The only surviving occurrences of the string are two lines of the new docstring
  explaining the supersession, and historical records in `DISPATCHER_STATE.md`,
  `WP70_PinnedDecisions.md` and the WP69/WP71/WP77 artefacts.
- **The positive direction is asserted**, because "the function is now unusable" would
  otherwise satisfy the criterion: with an explicit runner the build still runs and the
  `BuildResult` is field-for-field WP69's (`mode`, `command`, `exit_status`, `bundle_path`,
  `size`, `sha256`, `markers_found == all three`, `markers_missing == ()`, `e2e_capable`), and
  the injected runner is called exactly once with `(build_command(), str(plugin_dir))`.
- **Vacuity guard honoured:** the `TypeError` is not accepted as "any `TypeError`" — the test
  asserts the message contains `runner`, `missing` and `required`, and that the bundle on disk
  is byte-unchanged afterwards.

### AC2 — no spawn reachable without an explicitly supplied runner, asserted over the parsed package — **MET**

**(a) The spawn census — AST, enumerated by module, function and line, count pinned. Not a grep transcript.**

| # | module | function | line | node |
|---|---|---|---|---|
| 1 | `tools/obsidian_e2e/install.py` | `spawning_subprocess_runner` | 518 | `import subprocess` |
| 2 | `tools/obsidian_e2e/install.py` | `spawning_subprocess_runner` | 527 | `subprocess.run` |

**Total spawn-primitive nodes in the package: 2 — pinned in the test.** Walked: all **11**
modules (`__init__`, `constants`, `install`, `lifecycle`, `ports`, `provisioning`,
`readiness`, `relay`, `scratch`, `teardown`, `vaults`), **401 995 bytes** of source, module
set asserted rather than merely iterated. Both nodes are inside the one opt-in runner; **zero**
are at module scope, in another module, or in another function.

The walk recognises `import subprocess`, `from subprocess import …`, any `subprocess.*`
attribute, a bare `subprocess` alias binding, `os.system` / `os.popen` / `os.fork` /
`os.posix_spawn*` / `os.startfile` / `os.spawn*` / `os.exec*`, any callee ending in `Popen`,
`importlib.import_module("subprocess"|"os")`, `__import__("subprocess")` and
`getattr(os|subprocess, "<spawn attr>")`. **Each of those seven evasion spellings is a
parametrised test** against a synthetic package (T5), and a matched innocent module is
asserted to produce **zero** hits (T5b) — a detector that fires on everything proves nothing.

**(b) The opt-in runner is the default value of no parameter and is named by no substitution.**
Measured: `param_defaults_naming(spawning_subprocess_runner) == ()`,
`substitutions_naming(...) == ()`, and — strictly stronger, and the reason (b) cannot be
evaded — **`name_references(...) == ()`: nothing inside the package references the symbol at
all.** It is defined and exported, and nothing reads it. Same three queries for
`_default_runner`: all empty.

**(c)** `build_e2e_bundle`'s `runner`, read from the **parsed** signature (not from `inspect`,
which reads an imported object): `kind = keyword-only`, `has_default = False`,
`default_source = None`.

**(d) Every call to `build_e2e_bundle` in the repository supplies `runner`.** Repo-wide AST
census, `node_modules` / `__pycache__` / `.git` excluded:

```text
call sites total                     28
├── WP69 test tree                   22   all `runner=` keyword, 1 positional arg, byte-unchanged
├── WP78 visible suite (this WP)      6   5 supply `runner=`; 1 is bare, under assertion
├── non-test callers                  0   the install step is still wired into no entrypoint
└── bare calls NOT under assertion    0
```

**The one bare call is stated, not hidden.** AC1's T6 must write
`install.build_e2e_bundle(plugin_dir)` in order to assert that it is refused — the criterion
is unassertable otherwise, and such a call cannot spawn because the `TypeError` is raised at
the call before the body runs. It is admitted **structurally**: the oracle records whether a
call is lexically inside `with pytest.raises(TypeError):`, and the test asserts there is
**exactly one** such call and that it lives in the WP78 AC1 file. It is **not** a file-name
allowlist — an allowlist would also cover a real bare call in the same file. The exemption
carries its own control (T4e): in a synthetic file, an unguarded bare call and a call under
`pytest.raises(ValueError)` are both reported as **not** guarded. No call site uses
`*args`/`**kwargs`, which would make the argument list undecidable from the AST.

**Positive-control evidence for AC2 — every symbol the walk found before any absence was asserted.**

| control | asserted before | result |
|---|---|---|
| 11 modules parsed, 401 995 bytes, module set pinned | (a) | found |
| `install.py:build_e2e_bundle` located by name | (a)(c)(d) | found |
| `install.py:spawning_subprocess_runner` located by name | (a)(b) | found |
| ≥ 2 spawn primitives located, i.e. the nodes about to be attributed | (a) | found (2) |
| substitution scanner sees a live `probe or default_probe` in `lifecycle.py` | (b) | found |
| parameter-default scanner sees a synthetic `hook=_a_module_level_default` | (b) | found |
| signature reader reports a default where one exists (`install_bundle(run_id=None)`) | (c) | found |
| call-site scanner found > 0 sites, incl. WP69's and WP78's own | (d) | found |
| `install.py` has module-scope imports at all (so "no module-scope `subprocess`" is not an empty list) | T6 | found |

**One measured finding, recorded rather than smoothed over:** the parameter-default scanner
has **no live positive control inside this package** — not one of its 42
optional-injectable sites puts the fallback *in* the default; all of them default to `None`
and substitute in the body. The control is therefore synthetic, and that is stated here
because a scanner with no control is exactly what makes an absence assertion hollow.

**Why a grep is not sufficient evidence, demonstrated rather than argued:** injection (ii)
variant plants `importlib.import_module('subprocess').run(...)` in `readiness.py` and AC2(a)
goes red naming the module — a text search for the five spellings would not have seen it.

### AC3 — WP69's landed guarantees unchanged, shown rather than asserted — **MET**

**Executed test counts, before and after. They do not move.**

| suite | before (`d9390ba`, pre-change) | after (`4cb472a`) | delta |
|---|---|---|---|
| WP69 `visible` | **68 passed** | **68 passed** | 0 |
| WP69 `blind_set1` | **94 passed** | **94 passed** | 0 |
| WP69 `blind_set2` | **117 passed** | **117 passed** | 0 |
| **total** | **279 passed, 0 failed** | **279 passed, 0 failed** | **0** |

Measured by
`python -m pytest workflowArtifacts/canvas-v2/tests/{visible,blind_set1,blind_set2}/WP69 --rootdir=workflowArtifacts/canvas-v2/tests -q`,
run before the edit and again inside the gate script. A drop would be a deletion wearing the
wrong label; a rise would be undeclared coverage. Neither happened.

**All 22 existing call sites are byte-unchanged.** Measured against git, not asserted:
`git diff --name-only d9390ba -- <the three WP69 test dirs>` returns **empty**, with a
positive control that `git ls-tree` lists **33** files (the 33 WP69 test modules across the
three suites) at that path at the baseline, so the empty diff is over a real, populated path. The 22 call sites are re-counted from the AST
afterwards and all still supply `runner=`. **No test was deleted, weakened, retitled, skipped
or amended. WP78 holds no §7 licence of any class.**

**`install.__all__` gained exactly one name and lost none** — set difference measured against
the pre-repair byte copy: added `{spawning_subprocess_runner}`, removed `{}`.

**WP69's behaviour, asserted directly:**

- `build_command() == ("npm", "run", "build:e2e")`, unchanged.
- The capability oracle still needs **exit status AND all three markers**, each half vetoing
  on its own: markers present + exit 0 → capable; one marker corrupted + exit 0 →
  `BundleNotE2ECapable`; a perfectly good E2E bundle + exit 1 → `E2EBuildFailed`; exit 0 with
  **no** emitted file → `BundleNotE2ECapable`. Existence and mtime are consulted nowhere.
- The non-integer-status refusal survives at both levels (`build_e2e_bundle` with a runner
  returning `None`; `verify_e2e_bundle` with `exit_status=True`).
- A failed build leaves the previous bundle **byte-untouched** (sha256 compared).

**The install/restore byte comparison against the recorded restore point is untouched, and
here is the positive statement of the reason the charter asks for:** `capture_bundle_state`,
`install_bundle` and `restore_bundle` **neither call `build_e2e_bundle` nor read `runner`
nor name the spawning runner** — asserted structurally over the AST of all three, with a
positive control that the walk really sees their machinery (`restore_bundle` references
`_sha256`). The byte comparison is downstream of the build and reads a **file**, not a
runner, so a change to the build's argument list cannot reach it. An end-to-end
install → restore round trip on a synthetic vault is additionally shown byte-exact, with the
owner-style `main.js.bak` in the fixture untouched.

### AC4 — every criterion falsified separately and headless; each named injection reddens what it targets — **MET**

The "before" harness is a **byte copy** of the pre-repair package, taken from git's object
store at baseline `d9390bad587a8ec5d2738166f7f291a47dfbdef4` and **verified as a byte copy by
re-deriving git's own object id** (`sha1("blob <len>\0" + bytes)`) from every file written —
measured in `_prerepair.py` and re-measured in the test, not asserted here. It is **parsed,
never imported**: the pre-repair module is precisely the version in which starting a process
takes no argument. The test additionally asserts the copy is a *different* tree from the
repaired one, so a baseline that had drifted onto the repaired code would fail loudly rather
than make every falsification vacuous.

**Baseline recorded first:** on the repaired tree, the positive control and all four criteria
are **GREEN**. Without that, "the injection turned it red" is compatible with "it was red
already".

| injection | target | pre-repair / injected result | repaired result | neighbouring criteria |
|---|---|---|---|---|
| **(i)** restore a default for `runner` — *against the pre-repair **byte copy*** | AC1, AC2(c) | **RED**: AC1 *"`runner` defaults to None"*; AC2(c) *"default present: None"*; AC2(a) also **RED** — the pre-repair `import subprocess` is at `<module>` scope, so a spawn primitive is reachable without entering any function; AC2(b) **RED** — `_default_runner` *is* the substituted default | GREEN | control GREEN there (it finds `build_e2e_bundle` and both spawn nodes), so the criteria go red because the **property** is absent, not because the walk found nothing |
| **(i′)** the same, as a **targeted** injection on the repaired tree (one default + one `or`-substitution, nothing else; both replacements proven to have applied) | AC1, AC2(b), AC2(c) | **RED** on all three | GREEN | **AC2(a) stayed GREEN** — the injection moved reachability, not the spawn census. Recorded because a perturbation that changes nothing is a finding |
| **(ii)** a second `subprocess` reference in a **different** module (`scratch.py`) | AC2(a) | **RED**, and it **names the module and the line**: `scratch.py:<line> in _injected_second_spawn()`; census rises 2 → **4** | GREEN | AC1, AC2(b), AC2(c) **all stayed GREEN** — targeted, not global |
| **(ii′)** the same in a grep-defeating spelling — `importlib.import_module('subprocess').run(...)` in `readiness.py` | AC2(a) | **RED**, naming `readiness.py` and `import_module` | GREEN | — |
| **(iii)** rename `build_e2e_bundle` in the parsed copy | **the POSITIVE CONTROL** | **RED**: *"POSITIVE CONTROL FAILED: `build_e2e_bundle` was not found …"* | GREEN | — |
| **(iii′)** the **vacuity itself, reproduced**: on the renamed copy the naive check `assert not bare_calls` **PASSES** — and it passes because the scan found **zero** call sites, not because none was bare, while a real bare call under the renamed name is sitting right there | — | naive check GREEN on a broken tree; control **RED** | — | this is what makes the control load-bearing rather than decorative |
| **(iii″)** an **empty parse** — the wrong directory, the other way a lookup returns nothing (stale `__pycache__`, moved package, typo'd path) | the POSITIVE CONTROL | **RED**: *"no module was parsed"* | GREEN | — |

**Injection hygiene:** every textual mutation asserts its own occurrence count before
applying (`mutate(..., expect=1)`). An injection that silently failed to apply is a green that
means nothing — the same class this WP is about, one level up.

**Everything ran headless.** No Obsidian, no npm build, no socket, no vault, no import of any
mutated or pre-repair module.

---

## 2. Gate status

Run through `visible-console` `run_python` with an **absolute** script path
(`H:\tmp\wp78_gate.py`), console `2339cf52`, **exit 0**:

```text
WP78 visible: 40 passed, 0 failed
EXECUTED assertions in the WP78 suite: 479 (over 175 distinct `assert` sites of 175 present)
WP69 visible:     68 passed
WP69 blind_set1:  94 passed
WP69 blind_set2: 117 passed
VERDICT: wp78=PASS wp69_visible=PASS wp69_blind_set1=PASS wp69_blind_set2=PASS
```

The executed-assertion count is **measured by line-tracing the `assert` statements of the
suite as they are reached**, not counted statically. **All 175 assert sites were reached at
least once** — the suite contains no dead assertion.

**`npm run build` / `npm test` from `plugin/`: NOT RUN — a documented judgement call, stated
rather than implied.** Two reasons, both binding: (1) this batch's instructions forbid running
a real npm build; (2) another agent is live in `plugin/src/**` right now (`main.ts`,
`canvas-single-writer.test.ts`, `files/canvas-mirror*.ts`, `__tests__/v2/wp79/` are all dirty
in the working tree), so a build would both race their work and overwrite `plugin/main.js`,
which currently may hold an installed E2E bundle. The evidence offered instead is that **this
WP adds no TypeScript and modified no file under `plugin/`** — see §5, measured from
`git show --stat` on both commits. An unchanged result was the expected evidence; the
unchanged **input** is what is shown.

---

## 3. Files changed

| file | change |
|---|---|
| `tools/obsidian_e2e/install.py` | the only production file. `__all__` + 1 name; `Runner` alias docstring; `_default_runner` → `spawning_subprocess_runner` with the opt-in docstring and a function-local `import subprocess`; `build_e2e_bundle` signature + body + docstring; one module-docstring section |
| `workflowArtifacts/canvas-v2/T3_SharedContract.md` | **one appended block, §9a.** §4.1 (WP69's) and §9 (WP45's) are **not** modified, moved, renamed or re-ordered by one line — measured: the diff for this file contains **zero deletion lines**, it is a pure insertion |
| `workflowArtifacts/canvas-v2/tests/visible/WP78/**` | new: `_spawn_oracle.py`, `_prerepair.py`, 4 AC test files |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP78.md` | this file |

**Nothing else was modified.** No `plugin/**`, no `server/**`, no
`plugin/esbuild.config.mjs`, no `tools/launch_obsidian_e2e.py`, no other module under
`tools/obsidian_e2e/`, no existing test under `workflowArtifacts/canvas-v2/tests/`, and **no
suite was mirrored into `plugin/src/__tests__/`**.

---

## 4. Superseded records — named, quoted, NOT back-dated

A landed charter is a record of what was chartered, not a live description of the tree. These
three lines measured a tree that no longer exists. They are **left exactly as they are**
(rule 5) and named here instead:

| record | what it says | what is true now |
|---|---|---|
| `TaskCharter_WP69_E2EBuildModeAndInstall.md:163` | *"Injectable build runner (TC4, TC6). `install.build_e2e_bundle(plugin_dir, *, runner=None)`"* | `install.build_e2e_bundle(plugin_dir, *, runner: Runner)` — no default |
| `TaskCharter_WP69_E2EBuildModeAndInstall.md:289` | `build_e2e_bundle(plugin_dir, *, runner=None) -> BuildResult` | `build_e2e_bundle(plugin_dir, *, runner) -> BuildResult` |
| `ImplementationReport_WP69.md:222` | public surface *"… `build_e2e_bundle(plugin_dir, *, runner=None)` …"* | public surface additionally carries `spawning_subprocess_runner`, and `runner` is required |

The **package-scoped** stale claims in `BUILD_SPEC_CanvasV2.md` §5/§7 and
`TaskCharter_WP71` were corrected by Worker 2 when this charter was written (`3f1b2d5`) and
were **not** touched by the implementor. The three **module-scoped** docstrings that assert
"no `subprocess` in this module" (`provisioning.py:52`, `relay.py:17`, `vaults.py:28-30`) were
re-checked and are **still true** (S20).

---

## 5. Data safety and boundary statements — explicit, as the charter requires

- **No build was run. Nothing was launched. No process was started by this WP** other than
  `git` (reading this repository's own blobs) and `pytest` itself.
- **No file in either owner vault was read, opened, hashed into this report, printed, logged,
  echoed, or placed in a fixture.** No vault path is opened anywhere in the suite; the two
  owner vault paths appear only as **negative** assertions (every fixture root is checked not
  to be, and not to be inside, either of them). The only `data.json` written anywhere is an
  obviously fake literal inside `tmp_path`.
- **No live Obsidian instance, no real vault and no gate result is involved or claimed.**
  Nothing in this WP is verified against one and nothing needs to be.
- **No socket was opened, no relay started, no control port touched.**
- **No secret passed through an agent tool**, in any command string, script argument, test
  name or commit message.
- **No `subprocess` was added to the package and none was removed** — the census is 2 before
  and 2 after; only their reachability changed.
- **No new runtime dependency.** `install.py` remains standard library plus `constants`.
- **Nothing outside `tools/obsidian_e2e/install.py`, the appended contract block, the WP78
  test directory and this report was modified.** `git show --stat 303292b 4cb472a` lists
  exactly: `tools/obsidian_e2e/install.py`, `workflowArtifacts/canvas-v2/T3_SharedContract.md`
  and the six new `tests/visible/WP78/*.py` files.
- **WP77's work was neither reverted nor weakened.** `BundleState.original_bytes` is still a
  `Secret`; the WP78 diff touches `__all__`, the `Runner` alias, `spawning_subprocess_runner`,
  `build_e2e_bundle` and one module-docstring section — regions disjoint from `BundleState`.
- **WP69 was not reopened, and the §7 disposition was RE-VERIFIED rather than inherited.**
  C69's four ACs were read in full from `BUILD_SPEC_CanvasV2.md:1352-1355`: AC1 is the esbuild
  mode and the one npm script; AC2 the byte-identity of the production bundle; AC3 the
  capability oracle; AC4 install reversibility and the backup namespace. **Not one mentions
  `runner`, its default, `subprocess`, or how the build process is driven** — confirmed by
  reading, not assumed. And `runner` was **already keyword-only** at all 22 sites, so removing
  the default left every one of them source-identical, measured by AST. **No §7 licence of any
  class is taken.**

---

## 6. Consequence for C71 AC4 — the evidence can now actually be produced

C71 AC4 requires (a)–(d) plus a positive control. All five are **produced above from the
current tree** and are re-runnable: the oracle is committed at
`workflowArtifacts/canvas-v2/tests/visible/WP78/_spawn_oracle.py`, its positive control is
built into `assert_found(...)` rather than left to the caller, and §9a of
`T3_SharedContract.md` pins the symbol name so WP71 does not invent a second one. WP71 now
re-asserts (a)–(d) against the tree WP78 leaves; per C71 AC4 it introduces no new spawn
reference and removes neither of the two. **Before WP78 the criterion was unsatisfiable by any
WP71** — the grep could not come back clean and WP71 may not remove WP69's build capability.

---

## 7. Carried up — recorded, not repaired

| id | finding | why not here |
|---|---|---|
| **S18** | `relay.py:701` `LocalRelay(room_minter=None)` → `mint_room`, `POST /rooms`. The **only** optional injectable whose default performs a **write-shaped network operation** — it would *create state on a server*, not merely observe one. Re-verified in this run: still `None`-defaulted, still substituted in the body. | Not a spawn. C45 AC4's subject is process *starting*; widening is an ESCALATE (charter §5). **No owner assigned.** |
| **S17** | Fourteen further optional injectables fall back to a real-effect default (three socket probes, one `urlopen` transport, the S18 minter, two clocks, two sleepers, one `os.path.isfile`, one ctypes process lister, one temp-dir default, two vault-registry paths). **None starts a process.** Re-measured incidentally by this WP's oracle: **zero** parameter defaults in the package name a module-level callable — all fifteen use `None` + body substitution. | Enumerated and excluded by the charter. **No owner.** |
| **S19** | `tools/obsidian_e2e/__init__.py`'s `__all__` and its "Members" docstring omit `install`, `provisioning` and `relay`. Still true after this WP — and `install` is the module WP78 edits, so its self-description is now three WPs out of date. | Editing `__init__.py` would put WP78 outside the one production file it declares. **No owner.** |
| **S21** *(new, this WP)* | The parameter-default scanner has **no live positive control in this package**: not one of its 42 optional-injectable sites places the fallback in the default. Recorded so a later reader knows the control at that one point is synthetic **by necessity**, not by laziness. | Inventory note. **No owner.** |
| **S22** *(new, this WP)* | The `plugin/` npm gate was **not** run — batch instruction plus a live agent in `plugin/src/**`. WP78 adds no TypeScript and touched no file under `plugin/`, so the unchanged **input** is offered as the evidence. | A judgement call, documented in §2 rather than silently omitted. **Owner: Worker 4** may re-run it once `plugin/src/**` is quiet. |

---

## 8. Open assumptions and known edge cases

- **The bare-call exemption is structural and narrow**, but it is an exemption: a call inside
  `with pytest.raises(TypeError):` is admitted. Its control (T4e) proves the recogniser is not
  a blanket, and the test pins the count at **exactly one** and its file. If a future WP adds
  a second, the count assertion fails and the reader is forced to look.
- **`_prerepair.BASELINE_COMMIT` is pinned, not `HEAD`.** If a future rebase rewrites
  `d9390ba`, the AC4 falsifications fail loudly (the byte-copy sha re-derivation and the
  "before ≠ after" assertion both break) rather than going quietly vacuous.
- **The spawn census is pinned at 2.** A legitimate future spawn inside the opt-in runner
  would fail the count assertion. That is intended: a change to the number of ways this
  package can start a process should require a deliberate edit to a pinned number.
- **Nothing verifies the runner at runtime.** `build_e2e_bundle` does not check that `runner`
  is callable — a caller may pass anything, and a non-callable fails at the call site. This is
  WP69's existing contract and was not changed; the non-integer-return refusal is what guards
  the outcome.
