# Task Charter — WP69: One-shot E2E build mode and instrumented-build installation

<!-- Updated: chartered from the measured T3 pre-flight — the only E2E-capable build is the only build that never terminates, and the install step T3_SharedContract §1.1 assigned to "WP50/WP51" was in neither charter 2026-08-02 -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP69
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP43, WP44
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the gate can build, in one terminating command, the only bundle that can host it — and both the shipped bundle and the owner's vaults are provably where they were.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C69 — One-shot E2E build mode and instrumented-build installation** (work package WP69); phase **P0**. C69 sits at the end of the PHASE T3 block, after C54; in execution order it precedes **WP7**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: **modify**, in exactly two files, plus one **create**:
    - `plugin/esbuild.config.mjs` — the `process.argv[2]` mode branch (currently `:4`, `:32–37`) and nothing else in the file's option object except what a third mode requires
    - `plugin/package.json` — **one** added script entry; every existing script keeps its current definition verbatim
    - `tools/obsidian_e2e/install.py` — **new** module: install and restore of the E2E bundle in a vault's plugin directory
  - Responsibility: produce an E2E-capable plugin bundle with a build that **terminates**, and place it in a vault's plugin directory reversibly, without altering one byte of what `npm run build` ships.
- **Out of scope / non-goals:**
  - **Changing the behaviour of either existing build mode.** `production` and the default watch branch must behave exactly as they do today. This is AC1 and AC2, not a preference.
  - **Bumping the plugin version, or touching `plugin/manifest.json`** (broken symlink in the repo — neither read nor edited). The vaults already carry a valid `manifest.json` for the unchanged version, so the install writes `main.js` and nothing else.
  - **Rewriting `%APPDATA%\obsidian\obsidian.json`.** It is shared global state and read-only (S3). Its stray third registration — vault B's own `.obsidian` folder, `open: false` — is **user state and explicitly out of scope**. Do not "clean it up": a rig that rewrites the vault registry is a rig that can destroy the owner's vault list.
  - **The owner's own backups in the plugin directories** — `main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`. Not ours. Never written, moved, renamed or deleted, and never used as this WP's restore point.
  - Settings provisioning (`e2eControlPort`, capture/restore of `data.json`) — that is **WP44**, landed, and its backup namespace (`data.json.e2e-original`, `.e2e-provision.json`) is reused, not re-implemented.
  - Launching Obsidian, attaching, readiness, scratch canvases, teardown of the *run* — WP45–WP48.
  - Any change to `plugin/src/**`. This WP builds and installs the plugin; it does not modify it.
  - Any relay, deployment, `docker/.env` or secret.
- **Known interfaces / dependencies:**
  - Input: the plugin source tree; a resolved vault plugin directory per role
  - Output: an E2E-capable `main.js` whose capability is verified **before** installation; a recorded restore point per vault; the recorded sha256 of the displaced production bundle and of the production bundle rebuilt after the config change
  - Depends on work packages: **WP43** (per-role plugin install state and the `PLUGIN_NOT_E2E_CAPABLE` marker set), **WP44** (the byte-exact capture/restore discipline and the rig's backup namespace, which this WP follows rather than invents)
  - **WP7 depends on this WP.** WP50 and WP51 deliberately do not — see §9 of the BUILD_SPEC.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the plugin's build configuration, and a new rig-side install/restore module.
- **The measured blocker, given — do not re-derive.** `plugin/esbuild.config.mjs:4` sets `const prod = process.argv[2] === "production"`. At `:32–37`, `if (prod) { await ctx.rebuild(); process.exit(0); } else { await ctx.watch(); }` — **the else branch never returns**. At `:26`, `define: { __LS_E2E__: prod ? "false" : "true" }`. Consequences, measured on this host 2026-08-02 (`T3_PREFLIGHT.md`):

  | Command | `__LS_E2E__` | Terminates? |
  |---|---|---|
  | `npm run build` (`node esbuild.config.mjs production`) | `"false"` | yes, `exit(0)` |
  | `npm run dev` (no `argv[2]`) | `"true"` | **no — watch mode, runs forever** |

  So the only build capable of hosting the control server is the only build that never exits. A `run_python` / `run_command` followed by `await_console` on `npm run dev` blocks until the timeout, and the obvious diagnosis — "the build is slow" — is wrong. **Do not attempt to produce an E2E bundle with `npm run dev`.**
- **Why the install step exists at all.** Both vaults carry an identical **production** install: `main.js`, 626 711 bytes, dated 2026-07-26, with **zero** `__LS_E2E__` occurrences. That is the correct production signature (the flag folds to `false` and the whole `src/testing/` tree is dead-code-eliminated) and it is simultaneously the reason no real control endpoint can ever answer, whatever port WP44 provisions. `readiness.py` already reports this as the distinct named state `PLUGIN_NOT_E2E_CAPABLE` rather than as a timeout — that part of the infra is correct and is not changed here. `T3_SharedContract` §1.1 assigned the installation step to "WP50/WP51" in prose; **neither charter's scope, ACs or Definition-of-Done artefacts ever contained it.** This WP owns it.
- **Plugin identity — the trap the infra already dodged.** The plugin id is **`live-share`**; the install directory is `<vault>\.obsidian\plugins\live-share\`. `obsidian-live-share` is the *repo folder* name, and a path built from it installs nothing, silently. `tools/obsidian_e2e/constants.py` already pins `PLUGIN_ID`, `PLUGIN_DIR_REL` and `PLUGIN_MAIN_REL` with that warning — **import them; never re-spell a path here.**
- **Interfaces involved:**
  - Input: the plugin source tree; a vault plugin directory
  - Output: a verified E2E `main.js`; a recorded restore point; recorded sha256 values
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **The production build's output is the invariant of this WP.** A byte difference in `main.js` from `npm run build`, of any size, is an **abort** — not a diff to explain.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - **Zero new runtime dependencies**, and zero new dev dependencies. Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`. The Python side is standard-library only, as the rest of `tools/obsidian_e2e/` is.
  - **Data safety (D16, BUILD_SPEC §7 data-safety gate).** `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` are the owner's **live working vaults**. This WP writes exactly one file per vault and restores it.
  - **No secret through an agent tool, and no secret in a report.** `data.json` in both plugin directories holds live credentials (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`, `token`). This WP does not read it, does not move it and does not need it; where any file is compared, comparison is **sha256-of-bytes only**, and no byte of it is printed, logged, echoed into a report or placed in a fixture.
  - **Never terminate what the rig did not start (D15).** In particular: this WP exists so that nothing has to kill a watcher.
  - **Long-running or interactive processes go through the `visible-console` MCP tools** (`run_python` / `run_command`, then `await_console`) — never a Bash background process. Python is launched via `run_python` with an **absolute** script path: `run_command` wraps its argument in `cmd.exe /d /c "…"`, so any nested double quote — and therefore any quoted path with spaces — breaks argument parsing. **Vault B's path contains spaces**, which makes this the single most likely mechanical failure of the batch.
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and must not be weakened.
  - `plugin/src/**` is not modified by this WP. `server/` source is off limits. Deployment and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - esbuild `^0.24.0`, already present. The change is a branch and a define, not a plugin or a loader.
  - **Schema impact:** none. No doc format, no `.canvas` format, no wire format, no settings-shape change.
- **Entry points / relevant files:**
  - `plugin/esbuild.config.mjs:4` (mode selection), `:19` (`sourcemap`), `:25–27` (`define`), `:32–37` (the terminating vs. watching branch)
  - `plugin/package.json` — `scripts.dev` = `node esbuild.config.mjs`, `scripts.build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`
  - `tools/obsidian_e2e/constants.py:84–113` — `PLUGIN_ID`, `PLUGIN_DIR_REL`, `PLUGIN_MAIN_REL`, `SETTINGS_BACKUP_REL`, `PROVISION_MARKER_REL`, `E2E_BUILD_MARKERS`
  - `tools/obsidian_e2e/vaults.py:148`, `:302` — plugin install state and the e2e-capability probe (**read-only context, not a target**)
  - `tools/obsidian_e2e/ports.py` — WP44's capture/restore and marker discipline, the pattern to follow (**read-only context, not a target**)
  - `workflowArtifacts/canvas-v2/T3_PREFLIGHT.md` — the measured host facts and the restore baselines
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C69. No paraphrasing.*

1. `esbuild.config.mjs` gains **one** explicit third mode, selected by `process.argv[2] === "e2e"`, which builds **once** and exits — `ctx.rebuild()` then `process.exit(0)` — and whose build options are identical in every field to the existing default (watch) branch, including `__LS_E2E__: "true"` and `sourcemap: "inline"`. The only difference between the two is one-shot versus watch. Both existing branches are **unchanged in behaviour**: `production` still rebuilds once, folds `__LS_E2E__` to `"false"` and exits `0`; an invocation with no `argv[2]`, or with any other value, still enters watch mode and still never returns. A failed e2e build exits **non-zero**. The mode is reachable through exactly one added `package.json` script; `dev`, `build`, `test`, `lint` and `format` keep their current definitions verbatim, and no dependency is added.
2. **The production build's output is provably unchanged.** `npm run build` is run before and after the config change and the two emitted `main.js` files are **byte-identical**, established by sha256 of both and recorded in the implementation report. The post-change production bundle additionally contains **zero** occurrences of `__LS_E2E__` and zero of each E2E build marker (`e2eControlPort`, `LIVESHARE_E2E`, `e2e-control`), i.e. `src/testing/` still tree-shakes out — the same property C7 AC4 asserts, now re-established against a bundle built from the edited config rather than inherited from one built before it. A byte difference of any size is an **abort**, not a diff to explain: a build config is exactly the kind of file that silently changes what ships to users.
3. **The E2E bundle is verified capable and complete before it is installed anywhere.** Success is decided by the build process's exit status **and** by finding all three E2E build markers in the emitted `main.js` — never by the file existing, by its mtime moving, or by a watcher having been killed at a plausible moment. A failed or interrupted build leaves the previous `main.js` in place, so "a file is there" proves nothing. The E2E bundle is **substantially larger** than the 626 711-byte production bundle because the dev configuration emits an inline sourcemap; that size difference is expected and is recorded as such, so no later reader mistakes it for corruption.
4. **Installation is exactly reversible and touches nothing that is not ours.** Exactly one file per vault is written — `<vault>/.obsidian/plugins/live-share/main.js` — and `manifest.json`, `styles.css`, `data.json`, `community-plugins.json` and the vault's own pre-existing backups (`main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`) are never written, moved, renamed or deleted. The displaced production bundle is captured under the rig's **own** backup namespace with its sha256 recorded, restoration runs on every exit path including failure, abort and interruption, and after restore each vault's `main.js` sha256 equals the recorded production value. An install that cannot establish its restore point does not install. The plugin version is not bumped and `plugin/manifest.json` in the repo is neither read nor edited (broken symlink) — the vaults already carry a valid `manifest.json` for the unchanged version.

**Definition of Done:** the gate can build, in one terminating command, the only bundle that can host it — and both the shipped bundle and the owner's vaults are provably where they were.

### Where each criterion is decided

- **AC1** is decided by invoking each of the three modes and observing termination and the emitted `define`. The watch branch must be shown to still watch **without** being left running — start it through `visible-console` and stop it deliberately, or assert the branch structurally; never `await_console` on it.
- **AC2** is a **measurement recorded in the implementation report**: two sha256 values of `plugin/main.js` from `npm run build`, taken before and after the config edit, plus the marker counts. It is not a vitest test and must not be dressed up as one.
- **AC3** and **AC4** are decided by the new Python module's own standalone `python tools/test_<name>.py` script (workspace convention), run through `visible-console` `run_python` with an **absolute** path, against **temporary fixture vaults under `h:\tmp\`** — never against the owner's vaults. The single live installation into the owner's two vaults happens once, inside WP7's gate run, under the restore point this WP establishes.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **T3 host facts, given — do not re-derive:** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json` (read-only); vaults `H:\Developement\_NeuralAngels\ObsidianOrga` (role `a`) and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (role `b`, **spaces in the path are load-bearing**); plugin id `live-share`, installed **and enabled in both** vaults, **production** build in both.
- **Known risks specific to this WP:**
  - **The silent-ship risk is the whole point of AC2.** A `define` that flips, a `sourcemap` that leaks into production, or a branch that reorders is invisible to every test this project runs — the plugin suite never loads `main.js`. Only the byte comparison catches it. Take the "before" sha256 **first**, before touching the config; if the tree is dirty in `plugin/src/**` at that moment, the comparison is void and the measurement must be retaken on a quiet tree. **Batch B4 is live in `plugin/src/`** while this charter is written; a "before" bundle built mid-write and an "after" bundle built after B4 lands will differ for reasons that have nothing to do with this WP, and reporting that as a finding would be a false alarm in one direction and cover for a real change in the other.
  - **`npm run dev` never returns.** This is the trap the WP exists to remove; do not fall into it while removing it. Never `await_console` a watch build.
  - **A killed watcher can leave a truncated bundle.** This is why the fire-and-forget alternative was rejected in C69 and why AC3 requires exit status **plus** marker verification rather than file presence or mtime.
  - **Installing the wrong path installs nothing, silently.** `obsidian-live-share` is the repo folder; `live-share` is the plugin id. Import the constants.
  - **Restore is the criterion, not the intention.** An install that writes before its restore point is established has already failed AC4, even if it later restores correctly. Establish, verify, then write.
  - **Obsidian may be running.** Obsidian is single-instance and both vault windows can share one process (D14). Replacing `main.js` under a running instance does not take effect until that plugin is reloaded, and the rig may **not** kill a window it did not start (D15). If the run requires a reload of an instance the rig did not start, it stops and says so — it does not restart Obsidian.
  - **`lan-vault-sync` is enabled in both vaults** and is a second sync engine. It is WP50's disposition to make (C50 AC5), but note the interaction here: a sync engine that observes `.obsidian/plugins/**` could propagate or revert an installed bundle. If the WP50 disposition is "left live", say so in this WP's report rather than assuming the install is stable.
- **Known flaky patterns:**
  - No wall-clock sleeps and no timing constants in new tests; polling for a file is not a completion signal (AC3).
  - Do not assert on log strings as the primary oracle; state — here, bytes and exit status — is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime **or** dev dependency is permitted. esbuild is already present at `^0.24.0`; the Python side stays standard-library only. If a dependency looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - `plugin/src/**`, `server/`, `plugin/manifest.json`, the plugin version and `%APPDATA%\obsidian\obsidian.json` are all untouched. If implementation appears to require any of them, ESCALATE.
  - No existing test is deleted, weakened, retitled, skipped or amended. WP69 holds **no** §7 licence of any class; an unenumerated deletion or assertion rewrite is an abort criterion.
  - Nothing in this charter may be reported as observed until it has run. The pre-flight established **preconditions, not results**: the `e2e` mode does not exist, no E2E bundle has been built or installed, and no control endpoint has ever answered on this host.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/esbuild.config.mjs`
  - `plugin/package.json`
  - `tools/obsidian_e2e/install.py` (new)
- **Required report:** `ImplementationReport_WP69.md` (in `workflowArtifacts/canvas-v2/`), containing: the two production `main.js` sha256 values (before and after the config change) and the explicit statement that they are equal; the marker counts in the post-change production bundle; the E2E bundle's size and marker set, with the inline-sourcemap size difference stated so it is not read as corruption; the exact command that produces the E2E bundle; the recorded per-vault production `main.js` sha256 that AC4's restore is checked against; and an explicit statement of what has **not** been executed — in particular whether any live installation has yet occurred.
- **BUILD_SPEC updates required:** no — C69 and the §9 row are already written. If implementation invalidates an architecture decision, ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`, with results attributed against whatever batch is concurrently live. All visible tests PASS. The standalone `python tools/test_<name>.py` script for the install module passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* AC1 and AC2 are settled by invocation and by byte comparison, recorded in the implementation report; AC3 and AC4 are settled by the module's standalone Python script against fixture vaults. None requires a live relay, a second Obsidian instance or the T3 gate. What this WP **cannot** settle is whether an installed E2E bundle actually answers on a real host — that is WP7's run, and it is recorded in §3 rather than deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
