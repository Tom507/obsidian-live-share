# Task Charter — WP78: the build runner is required, so no spawn is reachable by accident

<!-- Updated: chartered 2026-08-04 — the Dispatcher's B11a ruling, re-verified against the current tree per hard-won rule 12 on branch `fix-bugs-and-raceconditions`. Every count, every line number and every call-site classification below was MEASURED by an AST walk over the package and the repository, not read off the escalation. The trace confirmed all three of the ruling's findings and added three the ruling did not contain (§3 Verification 2, 4 and 6). No file in either owner vault was read, no build was run, nothing was launched. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP78
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP69 (`DONE`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** *"nothing in the rig starts a process by accident"* goes back to being true **by construction** instead of being true **by call-site audit**. `tools/obsidian_e2e/install.py` exposes `build_e2e_bundle(plugin_dir, *, runner=None)`, and the `None` branch runs `subprocess.run` on npm. Nobody has taken that branch yet — but the guarantee C45 AC4 encoded was *structural*, and a spawning **default** converts it into a promise that has to be re-audited on every future edit. After this WP the parameter has **no default**, the spawning implementation is a named, public, opt-in symbol, and *"no spawn is reachable without a runner the caller supplied explicitly"* is a fact about the module's shape that an AST assertion can decide.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP78**, and section 5, **PHASE T3**, component **C71 AC4** (amended by this WP into its honest, satisfiable form). Phase **P0** (PHASE T3 group).

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **one production file** (`tools/obsidian_e2e/install.py`) plus one contract mirror.
  - Responsibility: make *"the build is never driven by a spawn the caller did not ask for"* a property of the **signature**, in the same way WP70 and WP77 made *"a credential is never rendered"* a property of the **type**. A required parameter is that guarantee in argument position.
  - Scope summary: `build_e2e_bundle`'s `runner` loses its default and becomes required; the spawning implementation is re-exported under an explicit opt-in public name and is the default value of nothing; a headless AST oracle decides the property over the parsed package and carries the positive control that stops it passing vacuously; `T3_SharedContract.md` gains **its own appended block** naming the opt-in symbol, so WP71's plan does not invent a second name for it.
- **Out of scope / non-goals:**
  - **Removing the spawn.** The spawning runner stays, and staying is the point. WP69 needs a way to actually build the bundle; what it may not have is that way as a **default**. A WP78 that deletes `subprocess` from the package has removed the capability instead of gating it, and has also made WP69's own build impossible. **Deleting it is an ESCALATE, not a simplification.**
  - **Weakening C71 AC4 to fit the code.** Amending it to *"no subprocess except `install.py`'s"* is the move §7 exists to make impossible, and this charter's §3 argument exists so a reader can check that the amendment actually landed is the opposite. See the amendment ruling below.
  - **Re-opening WP69.** See the §7 disposition below — WP78 changes **how a function is called**, never **what the module does**, and it restates, weakens and re-verifies no C69 acceptance criterion. A behavioural change to the build, the capability oracle, the install or the restore is an **ESCALATE**.
  - **The other fourteen optional injectables with real-effect defaults.** Measured and enumerated in §3 Verification 2. **Not one of them starts a process** — they are socket probes, one HTTP transport, a clock, a sleeper, a `os.path.isfile`, a ctypes process **lister**, and two vault-registry paths. They are **named here so they are not rediscovered as findings**, and they are explicitly **not covered**: the subject of C45 AC4 is process *starting*, and generalising this repair to every injected seam would be an unchartered widening of exactly the kind five WPs in this run were held to.
  - **`tools/launch_obsidian_e2e.py`.** It does not import `install` and has no call site of `build_e2e_bundle` — measured. Wiring the install step into the entrypoint is WP71's plan and WP7's run, not this WP.
  - **`plugin/**`.** Untouched. This WP is Python-only and adds **no** TypeScript. **No test suite of any kind is mirrored into `plugin/src/__tests__/`** — `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide for every other WP. Stated even though it cannot bite here, because it has been violated once already in this run.
  - **`server/**`.** Untouched. §7 makes a `server/` edit outside WP41 an abort criterion.
- **Known interfaces / dependencies:**
  - Input: `install.build_e2e_bundle` (`install.py:526`), `install._default_runner` (`:444`), the `Runner` type alias (`:132-135`), `install.__all__` (`:118-137`)
  - Output: a `build_e2e_bundle` with no runner default; one public opt-in spawning runner; an AST-decidable property; one appended contract block
  - Depends on work packages: **WP69** only, and WP69 is `DONE`. Nothing planned is a prerequisite.
  - **WP71 depends on this WP.** See the ordering ruling below — it is the one hard blocking relation, and it is on **satisfiability of a chartered criterion**, not on compilation.

### The C71 amendment is part of this WP — and it is a STRENGTHENING, stated so a reader can check it

**C71 AC4 as written today is unsatisfiable**, and C71 §3's *"measured 2026-08-04 — no process spawn anywhere in `tools/obsidian_e2e/`"* is stale. It was true of the WP43–WP49 rig and stopped being true when WP69 landed. **§7's own rule covers this exactly: a ledger row is a measurement, not a timeless fact.** The same stale sentence appears in three further places, all enumerated in §6.

**Two amendments were available. Only one of them is admissible, and the difference is the whole reason this is a work package rather than a two-line doc edit.**

| | The weakening (**REFUSED**) | The strengthening (**this WP**) |
|---|---|---|
| C71 AC4 becomes | *"no `subprocess` under `tools/obsidian_e2e/` **except `install.py`'s**"* | *"no spawn **reachable** without a runner the caller supplied explicitly"* |
| What changed to make it true | **the criterion** — it was edited until the code satisfied it | **the code** — the default was removed until it satisfied the criterion |
| C45 AC4 afterwards | retrospectively reinterpreted: *"started through `visible-console`"* now means *"started through `visible-console`, or by a default nobody is supposed to take"* | unweakened, and enforced by the shape of the module rather than by the discipline of its callers |
| Falsifiable by | nothing — it is true of the tree that produced it, and will stay true of any tree that adds a second spawning default in the same file | an AST assertion that goes red the moment a spawn becomes reachable without an explicit runner, wherever it is added |
| Strength | **strictly lower** than the original: it admits a class of tree the original forbade | **strictly higher** than the original: the original was a *grep over text*, which a rename, an alias, an `importlib` call or a `getattr` defeats; this is a statement about *reachability* over the parsed module |

**The last row is the load-bearing one and it is why this is not a §7 weakening.** The original AC4 asserted the **absence of five spellings** in a text search. The amended AC4 asserts a **reachability property of the parsed package**, and it additionally asserts the spelling-absence everywhere except one named, enumerated function. Everything the grep could have caught, the AST assertion still catches; the AST assertion also catches things the grep never could. **No tree that failed the original criterion passes the amended one.** That is the definition of a strengthening, and it is checkable by reading the two criteria side by side — which is the point of writing it down rather than asserting it.

**The honesty cost is named rather than hidden.** The amended criterion does permit a `subprocess` call to exist in the package, where the original permitted none. That is not a loosening of the *property* — the property was never "the string `subprocess` does not occur", it was *"nothing starts a process the caller did not ask for"*, and §7's own §5-body argument for C71 says so in those words: *"the console is **injected**, which is what makes it impossible for a test, a dev loop or a mistaken import to reach the real `Obsidian.exe` and the owner's live working vaults by accident (D16)."* Injection is the property. A required parameter **is** injection, made mandatory. The original wording was a proxy for the property, chosen when the proxy and the property happened to coincide; WP69 separated them, and the amendment re-attaches the criterion to the property rather than to the proxy.

### §7 disposition — WP69 is NOT reopened, and no §7 licence of any class is taken

Stated explicitly because the brief requires it not be left implicit, and each clause is measured rather than argued.

1. **No C69 acceptance criterion is touched.** C69's four ACs govern: the `e2e` esbuild mode and the one added `package.json` script (AC1); the byte-identity of the production bundle (AC2); the capability oracle — exit status **and** all three build markers (AC3); install reversibility and the backup namespace (AC4). **Not one of them mentions `runner`, its default, `subprocess`, or how the build process is driven** — checked against the charter's §4, which is an exact copy of the BUILD_SPEC §5 text. WP78 restates none, weakens none, re-verifies none.
2. **No test is deleted, weakened, retitled, skipped or amended, so neither §7 ledger is engaged.** All **22** existing call sites of `build_e2e_bundle` pass `runner=` **as a keyword argument** — measured by AST, not by grep, across the whole repository. `runner` is already keyword-only (`*` precedes it). Removing its default therefore leaves every one of the 22 **source-identical and behaviourally identical**. **WP78 holds no §7 licence of any class**, and an unenumerated deletion or assertion rewrite is an abort criterion exactly as it is for every other WP.
3. **This is the same relationship WP77 has to WP44 and WP70 had to WP44:** edit the module, do not re-open the work package that authored it. WP69 is `DONE`; its file is not frozen, its criteria are.
4. **What WP78 *does* owe WP69 is a stale-record note, not an edit.** `TaskCharter_WP69_E2EBuildModeAndInstall.md:163` and `:289`, and `ImplementationReport_WP69.md:222`, record the signature `build_e2e_bundle(plugin_dir, *, runner=None)`. Those are measurements of a tree that will no longer exist. **They are named in WP78's implementation report as superseded, with the new signature written out — and they are not back-dated (rule 5).** A landed charter is a record of what was chartered, not a live description of the tree.

### Ordering ruling — blocks WP71, blocks nothing else

- **WP78 blocks WP71, and the reason is satisfiability rather than compilation.** C71 AC4 requires that after WP71 lands there is no `subprocess` / `Popen` / `os.system` / `os.spawn*` under `tools/obsidian_e2e/`, and C71 §6 requires the implementation report to carry **the grep evidence**. That grep returns two hits WP71 did not add and **may not remove** — removing them would delete WP69's build capability, and WP71's own §2 forbids it from touching the install module at all. **WP71 cannot discharge its own AC4 honestly until WP78 has landed**, and a WP71 that reports it discharged anyway would be recording a green that cannot fail, in the WP whose entire subject is preventing exactly that. WP78 first, then WP71 re-asserts the amended AC4 against the tree WP78 leaves.
- **WP78 does NOT block WP50, WP74, WP75 or WP76 — measured, not assumed.** WP74, WP75 and WP76 own `plugin/src/testing/e2e-control.ts` and the AgenticWorkspace-side matrix driver; WP50 owns the driver and is verified against fake endpoints; WP51 is decided under the `plugin/` vitest gate. **Not one of them names a file under `tools/obsidian_e2e/`, and three of them are not even in this repository.** File overlap with all four: **zero**. Serialising them behind WP78 would buy no verification and would put the gate queue behind a one-file signature change.
- **⚠ WP78 and WP77 both modify `tools/obsidian_e2e/install.py`, and this is the one real coordination hazard.** The regions are disjoint — WP77 owns `BundleState` (`:252-264`) and its `original_bytes` field; WP78 owns `_default_runner` (`:444-459`), `build_e2e_bundle` (`:526-548`) and `__all__` (`:118-137`) — and neither reads the other's. **They must not be in flight in the same batch.** Whichever lands second rebases onto the first and touches nothing outside its own region; a merge that silently reverts the other's edit to this file is an abort, not a conflict to resolve by preference. Stated here rather than left to the Dispatcher because rule 10 exists for exactly this shape.
- **Recorded, not enacted:** nothing else in §9 changes. No existing dependency row is edited and no `planned` charter is back-dated (rule 5). The only §9 dependency statement this WP makes is the WP71 one.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the build-runner seam of `tools/obsidian_e2e/install.py` — one parameter default and one symbol's visibility
- **Interfaces involved:**
  - Input: `build_e2e_bundle(plugin_dir, *, runner)` — the seam WP69 built and left optional
  - Output: the same function with no default for `runner`, plus one public opt-in spawning runner that is the default value of nothing

### Why a required argument and not a rule — stated plainly, because it is this charter's whole argument

A default is evaluated at **call time**, by whoever writes the call, including the call written next month by someone who has not read this charter. `build_e2e_bundle(plugin_dir)` is a complete, type-correct, lint-clean expression today, and it starts npm. **The first real gate run is exactly the moment someone writes it** — the install step has no call site yet, so the first person to add one is writing the call this repair is about. An audit of the call sites has to be right at every one of them, forever, including the ones that do not exist yet; the signature has to be right once.

**That is not a new argument in this project — it is the one this run has now accepted twice.** WP70 closed the room-token leak with a `Secret` type rather than a sweep of `print` sites, and its own docstring says why (`relay.py:248-256`): *"Auditing call sites is a promise; a type is a guarantee."* WP77 applied the identical reasoning one module over, to the owner's `data.json`. **A required parameter is that same guarantee in argument position:** the call site cannot omit it, the omission is a `TypeError` at the call rather than a spawn at runtime, and the property is decidable by reading the signature instead of by enumerating the callers.

**The package already agrees with itself on this, in five places.** These are the pattern WP78 extends, not a design it introduces:

```text
lifecycle.spawn_through_console(console, argv, ...)     :290  ← console REQUIRED, positional
relay.LocalRelay.__init__(*, console, repo_root, ...)   :672  ← console REQUIRED, keyword-only
teardown.check_endpoints_alive(..., probe, ...)         :305  ← probe REQUIRED
teardown.run_with_teardown(..., runner, ...)            :750  ← runner REQUIRED
teardown._reclaim_ports(..., clock, ...)               :1043  ← clock REQUIRED
```

`lifecycle.py:305` states the reason in the file: *"`console` is always injected, which is what makes it impossible for a test — or a dev loop — to reach the real `Obsidian.exe`."* **`install.py`'s `runner` is the same seam with the same blast radius and the opposite default.** WP69 is not being criticised for adding a spawn; it is being corrected for making it the one that happens when nobody chose.

### Verified against the current tree (rule 12), 2026-08-04 — measured, given, do not re-derive

Every statement below was produced by an AST walk over all 11 modules of `tools/obsidian_e2e/` (9 170 lines) and over every `.py` file in the repository outside `node_modules`. **Nothing was imported, nothing was executed, no build was run, no vault was read.**

**Verification 1 — the defect is real, and it is exactly what the ruling says.**

| site | what is there |
|---|---|
| `install.py:101` | `import subprocess` |
| `install.py:444-459` | `def _default_runner(command, cwd) -> int:` … `completed = subprocess.run(argv, cwd=cwd, check=False)` at `:458`, with `shutil.which` resolution at `:452` |
| `install.py:526` | `def build_e2e_bundle(plugin_dir: PathLike, *, runner: Optional[Runner] = None) -> BuildResult:` |
| `install.py:539` | `reported = (runner or _default_runner)(command, str(cwd))` |

`_default_runner` is **private and unexported** — it is not in `install.__all__` (`:118-137`) — so today the only way to reach the spawn is to *not* pass a runner. **The spawn is reachable only by omission**, which is the inverse of what an opt-in should be.

**Verification 2 — the blast radius, measured rather than estimated. The pattern repeats fifteen times; exactly one of them starts a process.**

An AST walk for *"a parameter defaulting to `None` whose body substitutes a module-level default via `x or _d` or `x if x is not None else _d`"* returns **42 sites** across the package. Of those, **27** substitute a constant, an empty container, a generated run id or a pure helper. **15** substitute a default that reaches a real external effect:

| # | site | default | effect class |
|---|---|---|---|
| 1 | `install.py:539` `build_e2e_bundle(runner=)` | `_default_runner` | **PROCESS SPAWN — `subprocess.run`. The only one.** |
| 2 | `lifecycle.py:487` `plan_endpoints(probe=)` | `default_probe` (`:262`) | outbound TCP connect, read-only |
| 3 | `provisioning.py:495` `provision_gate_settings(control_probe=)` | `_default_control_probe` (`:443`) | outbound TCP connect, read-only |
| 4 | `readiness.py:259` `probe_endpoints(transport=)` | `_default_transport` (`:190`) | one `urlopen` POST to a control port |
| 5 | `relay.py:699` `LocalRelay(port_probe=)` | `probe_port` (`:559`) | outbound TCP connect |
| 6 | `relay.py:700` `LocalRelay(health_probe=)` | `probe_health` (`:575`) | HTTP `GET /healthz` |
| 7 | `relay.py:701` `LocalRelay(room_minter=)` | `mint_room` (`:588`) | HTTP `POST /rooms` — the only write-shaped default |
| 8 | `relay.py:690` `LocalRelay(store_root=)` | `Path(_temp_root())` | temp-directory path |
| 9 | `relay.py:702` `LocalRelay(clock=)` | `time.monotonic` | wall-clock read |
| 10 | `relay.py:703` `LocalRelay(sleeper=)` | `time.sleep` | wall-clock sleep |
| 11 | `teardown.py:255` `wait_for(clock=)` | `time.monotonic` | wall-clock read |
| 12 | `teardown.py:256` `wait_for(sleep=)` | `time.sleep` | wall-clock sleep |
| 13 | `lifecycle.py:224` `resolve_executable(exists=)` | `os.path.isfile` | filesystem stat |
| 14 | `vaults.py:441` `is_obsidian_running(process_lister=)` | `default_process_lister` (`:358`) | **read-only kernel query — see below** |
| 15 | `vaults.py:285` / `:472` `registry_path=` | `constants.VAULT_REGISTRY_PATH` | reads the owner's real vault registry |

**The decision, stated explicitly rather than left to inference: WP78 covers row 1 only, and names rows 2–15.** The subject of C45 AC4 is *starting a long-running process*; rows 2–15 open sockets, read a clock, stat a file and read a registry. Generalising the repair to all fifteen would be an unchartered widening of the kind WP74 was correctly held to when it excluded `plugin/**`. They are recorded in §5 so a later reader can tell a boundary from an oversight.

**Row 14 is the positive precedent and deserves its own sentence.** `default_process_lister` faces the identical temptation — *"list the running processes"* is a one-line `subprocess.run(["tasklist"])* — and WP43 refused it. Its docstring (`vaults.py:358-368`): *"Uses the Win32 ToolHelp snapshot through `ctypes` — a read-only kernel query — rather than shelling out to `tasklist`/`wmic`, which would start a process and violate AC4."* **The rig has a landed, working example of solving this exact problem without a spawn, in the same package, under the same criterion.** It is not the answer for `build_e2e_bundle` — the build genuinely must run npm — but it is the evidence that the criterion was understood and applied deliberately everywhere else.

**Verification 3 — the process-spawn census, AST rather than grep, and it is decisive.**
An AST walk of all 11 modules for `import subprocess`, `from subprocess import …`, any `subprocess.*` call, `os.system`, `os.popen`, `os.spawn*` and any call whose target ends in `Popen` returns **exactly two nodes in 9 170 lines**: `install.py:101` and `install.py:458`. **There is no second spawn anywhere in the package.** The three module docstrings that assert "no subprocess" (`provisioning.py:52`, `relay.py:17`, `vaults.py:28-30`) are each **scoped to their own module** and each is **still true** — they are not stale and they are not in scope. Only the four *package-scoped* claims are stale, and they are enumerated in §6.

**Verification 4 — NEW, and it is the fact that decides the §7 disposition: every existing call passes `runner` as a KEYWORD.**
An AST census of every call to `build_e2e_bundle` in the repository (excluding `node_modules`):

```text
22 call sites total
├── 0  bare  (no runner argument)
├── 22 supplied  — every one as the keyword `runner=`, never positionally
└── 0  non-test callers — all 22 live under
    workflowArtifacts/canvas-v2/tests/{visible,blind_set1,blind_set2}/WP69/
```

`runner` is **already keyword-only** — `*` precedes it in the signature. **Removing the default is therefore a source-compatible change for all 22 sites**: none of them is edited, none is amended, none is deleted, and no §7 licence is engaged. This is measured, and it is the reason WP78 is a small change rather than a batch-wide one.

**Verification 5 — NEW: the entrypoint does not use this function at all.**
`tools/launch_obsidian_e2e.py` imports `constants`, `lifecycle`, `ports`, `readiness`, `scratch`, `teardown` and `vaults` (`:70`) — **not `install`** — and contains no call to `build_e2e_bundle`. The install step is chartered (C69) and landed, but is **wired into nothing**. So the first bare call is genuinely in the future, and this WP lands before it rather than after it. That is the same ordering argument WP77 made about `capture_state` and the owner's vaults, one seam over.

**Verification 6 — NEW, and carried up rather than fixed: two bare non-test call sites of *other* optional injectables exist today.**
`tools/launch_obsidian_e2e.py:519` calls `resolve_executable(...)` with no `exists=` (row 13 — falls back to `os.path.isfile`), and `tools/obsidian_e2e/vaults.py:475` calls `is_obsidian_running(...)` with no `process_lister=` (row 14 — falls back to the ctypes snapshot). **Neither starts a process, neither writes anything, and neither is in WP78's scope.** They are recorded so that a reader running the same census later does not read them as a regression this WP introduced.

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **C45 AC4 stands unweakened**, and this WP exists to make it structural again rather than to reinterpret it. Every long-running process still goes through `visible-console`; the console stays injected; `spawn_through_console` stays the single seam for a launched process.
  - **WP69's landed guarantees survive intact.** The build command (`build_command()`, `:432`), the capability oracle (`verify_e2e_bundle`, `:461` — exit status **and** all three markers, never file existence or mtime), the non-integer-status refusal (`:540-546`), the "a failed build leaves the previous bundle untouched" property, the install/restore byte comparison against the recorded restore point, and the `BUNDLE_RESTORE_MISMATCH` reason are **all unchanged**. **WP78 changes how the function is called, never what it does.**
  - **The restore oracle is not touched at all, and it is worth saying why it survives trivially:** `capture_bundle_state`, `install_bundle` and `restore_bundle` neither call `build_e2e_bundle` nor read `runner`. The byte comparison against the restore point is downstream of the build and reads a file, not a runner. A change to the build's argument list cannot reach it — but the implementation report states this positively rather than leaving it inferred (§6).
  - **Zero new runtime dependencies.** `install.py` is standard library plus `constants`; it stays that way.
  - **Data safety (§7 data-safety gate).** No file in either owner vault is read, opened, hashed into an artefact or pointed at by any test. Every fixture is synthetic and under `tmp_path` or `h:\tmp`. Naming a settings **key** is permitted; naming a **value** is not, and no value appears in this charter, in any test this WP produces, or in any artefact it writes.
  - **No secret through an agent tool**, in any command string, script argument, test name or commit message.
  - **`plugin/src/**`, `server/**` and `plugin/esbuild.config.mjs` are untouched.**
- **Technology / framework / config constraints:**
  - Python, standard library only. The package has **no** `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini` or `conftest.py` (measured, WP77 §5 S16), so nothing is enabled by default that a test can lean on.
  - The verification is an **AST assertion over the parsed module**, not an import and not a grep. Importing `install.py` to inspect it is admissible only if nothing is executed; parsing is preferred because it cannot run module-level code and cannot be defeated by a `getattr`.
  - Run tests from the workspace root, never from a subdirectory. Long-running invocations go through `visible-console` `run_python` with an **absolute** script path — never a Bash background process.
  - **Schema impact:** none. No file format, no marker format, no wire format changes.
- **Entry points / relevant files:**
  - `tools/obsidian_e2e/install.py` — `import subprocess` (`:101`); the `Runner` type alias and its docstring (`:132-135`); `__all__` (`:118-137`); `build_command` (`:432-441`); `_default_runner` (`:444-459`); `build_e2e_bundle` (`:526-548`), specifically the signature at `:526` and the substitution at `:539`
  - `workflowArtifacts/canvas-v2/T3_SharedContract.md` — §9 (*Process launching — workspace rule (WP45 AC4)*) is the block this WP's own appended block sits beside. **§9 is WP45's and §4.1 is WP69's; WP78 modifies neither and appends its own.**
  - Read-only context, not modified: `tools/obsidian_e2e/lifecycle.py` `spawn_through_console` (`:290-315`) and its injection rationale (`:305`); `tools/obsidian_e2e/vaults.py` `default_process_lister` (`:358-368`); `tools/obsidian_e2e/relay.py` `LocalRelay.__init__` (`:672-703`)
- **Files this WP may NOT touch:** anything under `plugin/`, anything under `server/`, `plugin/esbuild.config.mjs`, `tools/launch_obsidian_e2e.py`, every module under `tools/obsidian_e2e/` **other than `install.py`**, `T3_SharedContract.md` §4.1 and §9 (append a new block instead), and any existing test under `workflowArtifacts/canvas-v2/tests/`. **If the repair appears to require reaching outside `tools/obsidian_e2e/install.py`, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Each criterion is followed by the statement of what would make it vacuous. This run has found ten-plus instances of a green test that cannot fail; a criterion that does not name its own vacuity risk is incomplete.*

1. **`build_e2e_bundle` has no runner default, and the spawning implementation is a named, public, opt-in symbol that is the default value of nothing.** The `runner` parameter stays keyword-only and loses its default entirely, so `build_e2e_bundle(plugin_dir)` raises `TypeError` at the call rather than starting npm; the `Optional[…] = None` and the `(runner or _default_runner)` substitution both disappear, and no replacement substitution — `if runner is None`, a sentinel, a `functools.partial`, a module-level `DEFAULT_RUNNER` constant read inside the body, or a class attribute — takes their place. The spawning implementation is **exported under an explicit opt-in name** in `install.__all__`, with a docstring that says what it does and that it is the only thing in the package that starts a process; the private `_default_runner` name does not survive as an alias, because two names for one spawn is how one of them stops being audited. **After this criterion, the only way to reach `subprocess` in this package is for a caller to have written the spawning runner's name.**
   - **Vacuous if:** the test asserts only that `build_e2e_bundle(plugin_dir)` raises. That passes for any `TypeError`, including one from an unrelated signature break, and it says nothing about whether a substitution was reintroduced elsewhere in the body. The criterion is decided **from the AST of the signature and the body**, and the test must additionally assert the positive direction — that a call **with** an explicit runner still builds and still returns the same `BuildResult` — or "the function is now unusable" would satisfy it.

2. **No process spawn is reachable anywhere in `tools/obsidian_e2e/` without a runner the caller supplied explicitly, and the assertion is made over the parsed package rather than over its text.** An AST walk of every module in the package establishes all four of: **(a)** every reference to `subprocess`, `Popen`, `os.system`, `os.popen`, `os.spawn*` and `os.exec*` occurs inside the one named opt-in runner, enumerated by module, function and line, with the total node count pinned so a second one cannot appear silently; **(b)** that runner is the default value of **no** parameter anywhere in the package, and no `x or …` / `x if x is not None else …` substitution names it; **(c)** `build_e2e_bundle`'s `runner` is a keyword-only parameter **with no default**, read from the parsed signature; **(d)** every call to `build_e2e_bundle` in the repository supplies `runner`. This is the honest, satisfiable form of C71 AC4 and it is what WP71 will re-assert. **A grep is not sufficient evidence for this criterion** — an alias, an `importlib.import_module("subprocess")` or a `getattr(os, "system")` defeats a text search and does not defeat (a).
   - **Vacuous if:** — **and this is the failure mode the brief names by hand, so it is written out.** An assertion of the form *"no bare call to `build_e2e_bundle` exists"* passes **trivially** when the function has been renamed, when the module path is wrong, when the parse silently returned an empty tree, or when the walk visited a stale `__pycache__` artefact rather than the source. **A positive control is mandatory and is part of this criterion, not a courtesy:** before any absence is asserted, the same test asserts that the walk **found** `build_e2e_bundle` by name, **found** the opt-in runner by name, **found** the `subprocess` reference it is about to attribute, and **found** a non-zero number of call sites. An absence assertion that runs after a lookup returning nothing is not evidence and is an abort, not a pass.

3. **WP69's landed guarantees are unchanged, and this is shown rather than asserted.** The build command, the capability oracle (exit status **and** all three build markers — never file existence, never mtime), the refusal of a non-integer exit status, the "a failed build leaves the previous bundle byte-untouched" property, and the whole install/restore path with its byte comparison against the recorded restore point behave exactly as before. **No C69 acceptance criterion is restated, re-verified or weakened**, no existing test is deleted, weakened, retitled, skipped or amended, and **WP78 holds no §7 licence of any class**. All 22 existing call sites are shown to be **byte-unchanged** and still passing.
   - **Vacuous if:** the evidence is *"the WP69 tests still pass"* with no count. §7's blind-set execution gate applies in spirit here: an exit code is not evidence. The report carries the **executed test count** for the WP69 suites before and after, and the count does not move — a drop is a deletion wearing the wrong label, and a rise means this WP added coverage it did not declare.

4. **Every criterion above is falsified separately and headless — no Obsidian, no npm build, no vault, no socket — and each named injection is shown to redden the assertion it targets.** The whole verification runs in-process against the parsed source and synthetic fixtures under `tmp_path`. For each criterion, one injection at a time with the rest unchanged, each recorded as **not a pass** under the repaired code and shown to produce the pre-repair outcome against a **byte copy** of the pre-repair module under an identical harness. The three injections are named, not left to the implementor: **(i)** restore a default for `runner` — AC1 and AC2(c) must go red; **(ii)** add a second `subprocess` reference in a different module of the package — AC2(a) must go red and must **name the module and line it found**, not merely fail; **(iii)** rename `build_e2e_bundle` in the parsed copy — the **positive control** must go red, proving the assertion sees what it claims to see rather than passing on an empty lookup. Injections are targeted, never global (rule 2), and the report states whether neighbouring behaviour stayed green. **A perturbation that changes nothing is a finding, not a null result.**
   - **Vacuous if:** the "before" harness is not a byte copy of the pre-repair module, or if injection (iii) is omitted. (iii) is the one that distinguishes a real assertion from a lookup that always returns nothing, and it is the specific vacuity the Dispatcher named. An implementation report carrying (i) and (ii) without (iii) is incomplete, not partial.

**Definition of Done:** `build_e2e_bundle(plugin_dir)` no longer starts a process, because it no longer exists as a legal call — and the statement *"nothing in this package spawns without being asked"* is decided by parsing the package rather than by trusting its callers.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Python, standard library only, run from the workspace root with the workspace venv. Long-running invocations through `visible-console` `run_python` with an absolute script path, never a Bash background process. No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is deleting the spawn instead of gating it.** *"No `subprocess` under `tools/obsidian_e2e/`"* reads like an instruction to remove it, and removing it makes the assertion trivially true, the diff smaller and the WP wrong — WP69 would then have no way to build the bundle at all, and the gate would be blocked by the WP that was supposed to unblock it. **The spawn stays; only its reachability changes.** If the diff removes `import subprocess`, the WP is wrong.
  - **⚠ The second most likely is a substitution that moves rather than disappears.** `runner = runner if runner is not None else spawning_runner` inside the body, a `DEFAULT_RUNNER` module constant consulted in the body, a `functools.partial`, or a sentinel default all preserve the exact defect while satisfying a naive "the signature has no default" check. **AC2(b) is the guard and it is asserted over the body, not the signature.**
  - **⚠ The third is the absence assertion with no positive control** — the vacuity the Dispatcher named specifically. `assert not bare_calls` passes when the AST walk found nothing at all: wrong module path, a rename, an empty parse, a stale `__pycache__`. **Every absence assertion in this WP is preceded, in the same test, by the assertion that the walk found the symbols it is about to reason about.** A control that can be skipped independently of the assertion it licenses is not a control.
  - **⚠ Do not widen to the other fourteen injectables.** §3 Verification 2 enumerates them and §2 rules them out. A WP78 that also makes `probe`, `transport`, `clock` and `sleeper` required is a different, larger change with a different risk profile, it touches five modules WP77 and WP71 are working in, and it has no criterion here. **Widening is an ESCALATE.**
  - **⚠ Do not change what the module does.** WP78 changes how a function is called. The build, the capability oracle, the install and the restore are WP69's and are `DONE`. **A behavioural change is an ESCALATE.**
  - **⚠ Do not run a build to test this.** Every criterion is decidable from the parsed source and from fake runners. An implementation that verifies itself by actually invoking npm has both left the headless boundary and taken the exact spawn this WP exists to gate.
  - **⚠ The defect has never fired, and that is not a mitigation.** Zero bare calls exist today and all 22 call sites are tests. **The install step is wired into no entrypoint**, so the first bare call is the one someone writes when they wire it — which is the first real gate run. Landing WP78 after that is landing it after the only event it protects against. That is the ordering ruling in §2 and it is the whole reason this is a work package rather than a note.
  - **⚠ No statement about a live Obsidian instance, a real vault or a gate result may appear in any artefact of this WP.** Nothing here is verified against one and nothing needs to be.

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP78's scope. Each is recorded so it is not rediscovered as a finding, with its owner named where one exists.*

- **S17 — fourteen further optional injectables fall back to a real-effect default; none starts a process.** Enumerated as rows 2–15 of §3 Verification 2: three socket probes, one `urlopen` transport, one room-minting HTTP POST, two clocks, two sleepers, one `os.path.isfile`, one ctypes process lister, one temp-dir default and two vault-registry paths. **Deliberately excluded** — C45 AC4's subject is process starting, and every one of these is a read, a probe or a wait. **Owner: none assigned; inventory note.** A reader who later decides the pattern should be uniform across the package should note that five seams in the same package are **already** required (§3), so the codebase is inconsistent rather than uniformly permissive, and that `LocalRelay` is the sharpest example: its `console` is required and its five probe/clock seams are not.
- **S18 — `relay.py:701` `LocalRelay(room_minter=None)` is the only optional injectable whose default performs a write-shaped network operation.** `mint_room` issues `POST /rooms` against the relay. It is not a spawn and is not in scope; it is singled out from S17 because it is the one whose accidental default would *create state on a server* rather than merely observe one. **Owner: none assigned.**
- **S19 — `tools/obsidian_e2e/__init__.py`'s `__all__` omits three landed modules.** It lists `constants`, `lifecycle`, `ports`, `readiness`, `scratch`, `teardown`, `vaults` and **not** `install`, `provisioning` or `relay`; the docstring's "Members" list omits the same three. Harmless today — the modules import fine by name — but the package's own self-description is two work packages out of date, and `install` is the module this WP edits. **Not repaired here:** editing `__init__.py` would put WP78 outside the one file it declares, which is the boundary the charter is enforcing on itself. **Owner: none assigned; carried up.**
- **S20 — three module docstrings assert "no `subprocess` in this module" and all three are still TRUE.** `provisioning.py:52`, `relay.py:17`, `vaults.py:28-30`. They are **module-scoped**, they were checked, and they are **not** part of the stale-claim set — recorded so that a later sweep of the string `subprocess` across the package does not read them as four stale claims instead of one. The stale claims are the **package-scoped** ones enumerated in §6.

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - A test that asserts an absence is suspect by default. Ask what it would take for it to fail, and write that down.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** none permitted. `install.py` is standard library plus `constants` and stays that way. If a dependency looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **The spawn is gated, never deleted.** `import subprocess` and the `subprocess.run` call both remain, inside one named opt-in function.
  - **No substitution of any shape reintroduces a default runner** — not in the signature, not in the body, not as a module constant, not as a partial, not as a sentinel.
  - **`_default_runner` does not survive as an alias.** One name for the spawn, exported.
  - **Every absence assertion carries its positive control in the same test.**
  - **No behavioural change to the build, the capability oracle, the install or the restore.**
  - **No file other than `tools/obsidian_e2e/install.py` is modified** in the production tree; the only other write is the **appended** contract block. **No `plugin/**`, no `server/**`, no `tools/launch_obsidian_e2e.py`, no other module under `tools/obsidian_e2e/`**; **no test suite is mirrored into `plugin/src/__tests__/`**.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP78 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **WP78 and WP77 must not be in flight in the same batch** — both modify `install.py` (disjoint regions; see the §2 ordering ruling).
  - **No secret through an agent tool**, in any command string, script argument or commit message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `tools/obsidian_e2e/install.py` — this repo, branch `fix-bugs-and-raceconditions`. **The only production file this WP modifies.**
  - `workflowArtifacts/canvas-v2/T3_SharedContract.md` — **one appended block**, naming the opt-in spawning runner symbol and the required-`runner` rule, so WP71's plan and WP7's run do not invent a second name for it (rule 10). **§4.1 (WP69's) and §9 (WP45's) are not modified, moved, renamed or re-ordered by one line.**
- **Already landed by Worker 2 with this charter — NOT implementor work, listed so the implementor does not repeat it:** the C71 amendment. The **package-scoped** stale claim *"there is no `subprocess` / `Popen` / process spawn anywhere in `tools/obsidian_e2e/`"* occurs in **four** places, and all four are corrected in the same edit as the §9 row and the header count:
  1. `BUILD_SPEC_CanvasV2.md` §5, PHASE T3 preamble note **(b)** (`:1149`)
  2. `BUILD_SPEC_CanvasV2.md` §5, **C71** — the *"The gap this closes"* bullet and **AC4**
  3. `BUILD_SPEC_CanvasV2.md` §7, the *"Live real-Obsidian rig"* gate-command bullet (`:1776`)
  4. `TaskCharter_WP71_AgentMediatedGateExecution.md` — the header note (`:3`), §2 out-of-scope (`:29`), §3 (`:52`), **AC4** (`:88`), §5 hard constraints (`:109`) and §6's grep-evidence requirement (`:126`)
  **WP71 has not been implemented** (status: chartered), so amending its charter is spec work, not a reopening. The implementor of WP78 does not edit any of these files.
- **Required report:** `ImplementationReport_WP78.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **AST evidence for AC2**, as the enumerated list of every spawn-primitive node in the package with module, function and line, plus the pinned total count — **not a grep transcript**; the **positive-control evidence**, naming each symbol the walk found before any absence was asserted, and the result of injection (iii) which must have reddened it; the AC4 falsification in full, per injection, naming the pre-repair and post-repair result for each and stating explicitly that the "before" harness was a **byte copy** of the pre-repair module; the **executed test count** for the WP69 visible and blind suites before and after, shown not to move, with the statement that all 22 call sites are byte-unchanged; a positive statement that the **install/restore byte comparison against the recorded restore point is untouched**, with the reason (it neither calls `build_e2e_bundle` nor reads `runner`); the note that `TaskCharter_WP69:163,289` and `ImplementationReport_WP69:222` record the **superseded** signature, quoted alongside the new one and **not** back-dated; an explicit statement that **no build was run, nothing was launched, and no file in either owner vault was read, hashed into this report or placed in a fixture**; confirmation that nothing outside `tools/obsidian_e2e/install.py` and the appended contract block was modified and that no suite was mirrored into `plugin/src/__tests__/`; and a statement that **no live Obsidian instance, no real vault and no gate result is involved or claimed**.
- **BUILD_SPEC updates required:** no — the §9 row, the header count and the C71 amendment were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** the WP's own headless verification script passes, launched through `visible-console` `run_python` with an absolute path, with its executed-assertion count recorded. `npm run build` and `npm test` from `plugin/` are **unaffected by this WP** and must be shown still green — this WP adds no TypeScript, so an unchanged result is the expected evidence, not a formality.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. **No blind sets and no ledger rows** — discontinued by the 2026-08-05
workflow change (`DISPATCHER_STATE.md`, AUTONOMOUS MODE). AC4's three named injections are
ordinary tests in this suite; the property is a reachability fact about a parsed module, not
something observable in an editor.*

All under `workflowArtifacts/canvas-v2/tests/visible/WP78/`. **40 tests, 479 executed
assertions over all 175 assert sites, 0 failed.**

| file | AC | cases |
|---|---|---|
| `_spawn_oracle.py` | — | the parse-only oracle deciding (a)–(d), with `assert_found(...)` as a **built-in** positive control. Reusable by WP71. |
| `_prerepair.py` | — | the "before" harness: a **byte copy** of the package at `d9390ba` from git's object store, blob sha re-derived per file. Parsed, never imported. |
| `test_ac1_runner_required_no_substitution_visible.py` | AC1 | T1 parsed signature (keyword-only, no default, annotation not `Optional`) · T2 body holds exactly one use of `runner`, as the callee, no `or`/`IfExp`/`is None`/rebinding · T3 no module-level `DEFAULT_RUNNER`, no `functools.partial`, only the `Runner` type alias · T4 opt-in symbol public, exported, documented, defaults nothing, referenced nowhere · T5 `_default_runner` does not survive · T6 bare call is a `TypeError` **naming `runner`** · T7/T7b explicit runner still builds, `BuildResult` field-for-field WP69's, and the refusal paths still refuse · T8 the spawn was gated, **not deleted** |
| `test_ac2_no_spawn_reachable_visible.py` | AC2 | T1a the enumerated, attributed, **pinned-at-2** spawn census over all 11 modules · T2b defaults-nothing / substituted-nowhere / referenced-nowhere · T3c the parsed signature · T4d every repository call site supplies `runner`, with the one bare-call-under-assertion admitted **structurally** · T4e control proving that exemption is not a blanket · T5 ×7 grep-defeating spellings all caught · T5b innocent module produces zero hits · T6 no module-scope `subprocess` binding anywhere |
| `test_ac3_wp69_guarantees_unchanged_visible.py` | AC3 | T1 build command · T2 oracle = exit status **and** all three markers, each half vetoing alone, existence/mtime never consulted · T3 non-integer status refused at both levels · T4 failed build leaves the bundle byte-untouched · T5 install/restore neither calls the build nor reads `runner` (structural, with control) · T6 install→restore byte-exact round trip · T7 **git-measured**: no WP69 test file changed since the baseline, 22 call sites intact · T8 `__all__` gained exactly one name |
| `test_ac4_falsification_visible.py` | AC4 | baseline (repaired tree green on every criterion) · byte-copy verification · **(i)** pre-repair byte copy reddens AC1/AC2(a)/(b)/(c) · **(i′)** targeted reintroduction, AC2(a) stays green · **(ii)** second spawn in `scratch.py` reddens AC2(a) **naming module and line**, neighbours stay green · **(ii′)** the same via `importlib.import_module` · **(iii)** rename reddens the **positive control** · **(iii′)** the vacuity reproduced: the naive check passes on the renamed tree because it found *nothing* · **(iii″)** an empty parse also reddens the control |

**Gate:** `visible-console` `run_python` on the absolute path `H:\tmp\wp78_gate.py`
(console `70397fdc`, exit 0). Headless throughout — no Obsidian, no npm build, no socket, no
vault.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Worker 3, attempt 1)

- **Observed current behavior:** re-measured against the tree at `d9390ba` (line numbers had
  moved under WP77): `install.py:544` `def build_e2e_bundle(plugin_dir, *, runner:
  Optional[Runner] = None)`, `:557` `(runner or _default_runner)(...)`, `_default_runner` at
  `:462` with `subprocess.run` at `:476` and `import subprocess` at module scope `:101`.
  Package spawn census **2**. Call sites **22**, all `runner=` keyword, all tests, **0** bare,
  **0** non-test — every one of the charter's §3 measurements confirmed independently. C69's
  four ACs re-read in full: **none** mentions `runner`, its default or `subprocess`, so the
  §7 disposition holds and no licence is taken.
- **Approach:** remove the default; rename `_default_runner` → `spawning_subprocess_runner`
  and export it; **move `import subprocess` into that function** so the package binds it at
  module scope nowhere and C71 AC4's *"every reference occurs inside the one named opt-in
  runner"* is literally true rather than needing a gloss (the charter's own hard constraint
  says both *"remain, inside one named opt-in function"*); build a parse-only oracle with the
  positive control **inside** it; falsify with the pre-repair byte copy plus targeted
  injections.
- **Judgement calls made autonomously, each recorded in the report:** (1) the function-local
  import, above; (2) the one bare call inside `pytest.raises(TypeError)` is admitted
  **structurally** rather than by allowlist, with its own control; (3) the `plugin/` npm gate
  was **not** run — batch instruction plus a live agent in `plugin/src/**` — with the
  unchanged input offered as evidence instead (S22).
- **Fallback path if all attempts fail:** not needed; attempt 1 succeeded.

---

## 9. Handover Summary (filled by Worker 3 on completion)

- **What is complete:** all four ACs. `build_e2e_bundle(plugin_dir)` is a `TypeError` at the
  call; `spawning_subprocess_runner` is public, exported, and the default value of nothing;
  the package's **2** spawn primitives are both inside it and `subprocess` is bound at module
  scope nowhere; the property is decided by an AST walk with a positive control that
  injection (iii) is shown to redden. WP69's build, oracle, install and byte-exact restore are
  behaviourally untouched: **279/279** WP69 tests pass, identical to the pre-change baseline,
  and the 22 call sites are git-measured byte-unchanged. `T3_SharedContract.md` §9a pins the
  symbol for WP71/WP7 as a pure insertion (**zero** deletion lines in that diff).
- **What remains open:** nothing in scope. Carried up: **S18** (`relay.py:701`
  `LocalRelay(room_minter=None)` → `POST /rooms`, the only write-shaped default; not a spawn,
  no owner), **S19** (`__init__.py`'s `__all__` still omits `install`, `provisioning`,
  `relay`), **S17**, and two new: **S21** (the parameter-default scanner has no live control
  in this package — all 42 injectable sites default to `None`) and **S22** (the `plugin/` npm
  gate deliberately not run; Worker 4 may re-run it once `plugin/src/**` is quiet).
- **Final status:** `DONE`, risk_flag `NONE`. Commits `303292b`, `4cb472a`, `d5b4e06`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
