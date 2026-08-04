# B9b — the real-Obsidian gate: running notes

> Worker 3 Core. Measured facts only. Nothing here is inherited from a prior document without
> having been re-measured — rule 6: *a cited contract must be re-read, not recalled.*
>
> **Batch baseline:** `fcb229523d90d13b676059b8533ef1be6405a7de`, tree clean (0 dirty entries),
> **advanced during the batch to `f9774f8a8fec88f60fa0b1f5c9afbd88af12e87b` by a concurrent
> Worker 2** — see M0.

---

## M0 — a concurrent Worker 2 moved HEAD mid-batch; the AC2 comparison survives it

Partway through B9b, `git status` showed `BUILD_SPEC_CanvasV2.md` modified without any B9b agent
having touched it, and HEAD then advanced by two commits:

```
a42845f  spec(section7): measured rows for the WP27 amendment and WP25 fixture repair
f9774f8  docs: P2 done; two section-7 rulings, one of them a correction of mine
```

This is the Worker 2 discharging the two §7 rows `DISPATCHER_STATE.md` records as **owed**
(*"WP27's measured §7 row is owed. Owner: Worker 2, one instance, nobody else"*). It is **not**
B9b's work and B9b does not stage, revert or reconcile it.

**Why this did not void WP69 AC2.** AC2's whole point is that a build-config change must not alter
what ships, so a *different* change to a build input between the two measurements would destroy
the comparison in both directions. Checked, not assumed:

```
git diff --name-only fcb2295..HEAD  →  workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md
                                       workflowArtifacts/canvas-v2/DISPATCHER_STATE.md
```

Two documentation files. **No `plugin/src/**`, no `plugin/package.json`, no `plugin/tsconfig*`,
no `plugin/esbuild.config.mjs`, no lockfile.** The "before" bundle hash taken at `fcb2295` is
therefore still the correct comparand at `f9774f8`, and the batch baseline for rule-4 purposes is
`f9774f8` with the note that its delta from `fcb2295` cannot reach the bundle.

**Standing hazard recorded:** this repository has more than one agent writing to it during B9b.
Every B9b commit must use explicit path staging. `git add -A` would sweep up Worker 2's §7 work.

---

## M0b — batch-baseline plugin suite (rule 4: "pre-existing" means pre-existing to *this*)

Measured at `f9774f8`, with no B9b-owned test file yet collected (verified, the leak check
returned empty):

| | |
|---|---|
| command | `npx vitest run --reporter=json` from `plugin/` |
| exit | **0** |
| collected | **1833** |
| passed | **1833** |
| failed | **0** |
| pending | 0 |
| test files | **299** |

The full collected file list is preserved at `H:\tmp\b9b_baseline_suite.json`, so a later count is
reconciled **file by file** rather than by arithmetic. Note this supersedes the 1687/283 figure in
`DISPATCHER_STATE.md`, which was reported at WP28 attempt 2 while B4 was still mid-flight — B4 then
went on to land WP29 and WP30.

---

## M1 — WP69 AC2 "before" bundle, taken first, on the quiet tree

Taken as the batch's **first action**, before any file in this batch was edited, because the
comparison is void in both directions if the tree drifts first.

| | |
|---|---|
| commit | `fcb229523d90d13b676059b8533ef1be6405a7de` |
| dirty entries | **0** |
| command | `npm run build` in `plugin/` → `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`, exit **0** |
| `plugin/main.js` sha256 | `58fda6f8a9f2534fb4c4d08d4b45ac3c4db6bfc8bd06b47ba84899e9f23946bc` |
| size | 759 892 bytes |
| `__LS_E2E__` occurrences | **0** |

`plugin/main.js` is git-ignored (`.gitignore:10`), so building it did not dirty the tree.

⚠ **Do not compare this against the 626 711-byte installed bundles.** Those are a *different,
older* build (2026-07-26) of a different source tree. AC2's invariant is before-vs-after of the
config change **on this tree**, and nothing else.

---

## M2 — the restore baselines still hold (rule 5: a hash is a measurement, not a timeless fact)

Re-measured 2026-08-04, hash-only, no content read out:

| Vault | `data.json` sha256 | matches `T3_PREFLIGHT.md`? |
|---|---|---|
| `ObsidianOrga` | `c2c4db2d…8e4162` | ✅ yes |
| `ObsidianOrga - Kopie` | `070e3f3a…9030f` (777 B) | ✅ yes |

Both files carry all five credential keys (`encryptionPassphrase`, `encryptionSalt`, `jwt`,
`serverPassword`, `token`). No value was read out of either; only key presence and value *shape*.

Byte-shape facts the restore path depends on, both vaults: LF (no CRLF), **no** trailing newline,
**no** UTF-8 BOM, 26 top-level keys.

---

## M3 — ⚠ CONFIRMED LIVE: `sharedFolder` is empty in **both** vaults

| key | vault A | vault B |
|---|---|---|
| `sharedFolder` | `""` (**empty**) | `""` (**empty**) |
| `roomId` | `""` (empty) | `""` (empty) |
| `serverUrl` | non-empty, len 33 | non-empty, len 33 |
| `excludePatterns` | `[]` | `[]` |
| `role` | `null` | `null` |
| `autoReconnect` | `true` | `true` |
| `debugLogging` | **`true`** | **`true`** |
| `useCanvasBinding` | `false` | `false` |
| `e2eControlPort` | **absent** | **absent** |

This is the measured confirmation of the data-safety finding, not a re-derivation of it:

```
manifest.ts:445   if (!this.settings.sharedFolder) return true;   ← empty ⇒ WHOLE VAULT shared
main.ts:471       guest role → cleanupStaleFiles()
main.ts:523-540   trashFile()s every shared local file absent from the host's manifest
```

**No session of any kind may start against either vault before WP70's `sharedFolder` narrowing
holds.** WP70 is a safety precondition, not a convenience.

Two further consequences that were not previously stated:

- `debugLogging` is **`true` today in both vaults**. WP70 AC1's "provision `debugLogging` false
  for the duration" is therefore an *active change*, not a no-op confirmation: a debug log written
  to `debugLogPath` inside the vault is a vault write, and `fingerprint_vault` excludes only
  `_e2e-rig`, `.obsidian/plugins/live-share`, `.git` and `.trash` — the **rest of `.obsidian/` is
  fingerprinted**, so such a write would be reported as a C47 AC3 mismatch.
- `role` is `null` and `roomId` is `""` in both, so the `main.ts:408-417` auto-reconnect
  (`roomId && token && role && autoReconnect`) cannot currently fire in either vault. Nothing is
  provisioned; a room must be minted. This is the *reason* nothing has been destroyed so far.

---

## M4 — ⚠ FINDING: the second-sync-engine claim carried by four charters is **wrong**

`DISPATCHER_STATE.md`, `T3_PREFLIGHT.md` and the WP50 / WP51 / WP7 / WP69 / WP70 charters all
state that **`lan-vault-sync` is enabled in both vaults**. Measured:

| | vault A | vault B |
|---|---|---|
| installed plugin dirs | `lan-vault-sync`, `live-share`, `obsidian-git` | same |
| `.obsidian/community-plugins.json` (the **enabled** list) | `["obsidian-git", "live-share"]` | `["obsidian-git", "live-share"]` |
| `lan-vault-sync` enabled? | **NO** | **NO** |

`community-plugins.json` is byte-identical in both vaults
(`42932112c59b49e0efce14ba9d5f82543688bb45c25eb1118bd1e4915d571611`, 36 bytes).

**"Installed" and "enabled" are different facts in Obsidian, and the pre-flight conflated them.**
The claim was carried through four charters and two state files without anyone reading the enabled
list. Sixth-class hazard in a new location: a *disposition* about to be spent on a plugin that was
never running.

### The engine that IS enabled and was never dispositioned: `obsidian-git` 2.38.6

Measured, identical in both vaults:

| setting | value | reading |
|---|---|---|
| `autoSaveInterval` | `0` | auto-commit **off** |
| `autoPullInterval` | `0` | timed auto-pull **off** |
| `autoPushInterval` | `0` | timed auto-push **off** |
| `autoBackupAfterFileChange` | `false` | no change-triggered writer |
| `refreshSourceControlTimer` | `7000` | read-only status refresh, not a writer |
| **`autoPullOnBoot`** | **`true`** | ⚠ **pulls when Obsidian starts** |

And both vaults really are git working trees:

| | vault A | vault B |
|---|---|---|
| `.git` present | yes | yes |
| branch | `main` | `main` |
| remote configured | yes | yes |
| dirty entries **before** the gate | **13** | **14** |

`autoPullOnBoot` fires exactly when Obsidian launches — which is exactly when the gate starts —
and a pull into an already-dirty tree can move files, fail, or leave merge state. This is the
AC5-class second engine for this gate.

**WP50 AC5's disposition must therefore cover `obsidian-git`, not `lan-vault-sync`**, and both
must be re-measured at run time rather than inherited from this note: they are user state and the
owner can flip either between now and the run.

---

## M5 — the installed bundles, and a fourth pre-existing backup

Both vaults carry a **byte-identical** production install:

| | value |
|---|---|
| `main.js` sha256 (both vaults) | `93bdc5f4c8785a4e3a326a8a4d275d8ee622c692d28a43d4da1b8c57eae69d9c` |
| size | 626 711 bytes |
| `__LS_E2E__` occurrences | **0** |
| `e2eControlPort` / `LIVESHARE_E2E` / `e2e-control` occurrences | **0 / 0 / 0** |

That hash is **WP69 AC4's restore comparand** — after teardown each vault's `main.js` must equal
it. It also corroborates the tree-shaking property (W4-1), though it does **not** discharge C7 AC4,
which must be re-established against a bundle built *after* WP69's config change.

The plugin directory in **both** vaults contains **four** pre-existing owner backups, not the three
the pre-flight lists:

```
main.js.bak · main.js.0.5.9.bak · manifest.json.bak · styles.css.bak   ← the 4th, previously unrecorded
```

None of them is ours. Never written, moved, renamed, deleted, or used as a restore point.

Neither vault currently has an `_e2e-rig` folder — no crashed-run scratch artefacts to reclaim.

---

## M6 — structural finding: the rig cannot launch Obsidian by itself

From the infra survey of `tools/obsidian_e2e/**` and `tools/launch_obsidian_e2e.py`:

- There is exactly **one** console class in the whole rig, `lifecycle.PlanOnlyConsole`
  (`CONSOLE_BACKEND = "plan-only"`). **No backend anywhere starts a process.**
- `launch_obsidian_e2e.py:549` instantiates it, and `:353` gates rig-started tagging on
  `CONSOLE_BACKEND != "plan-only"`, so `rig_started` is always `False` and `terminated` is always
  `[]` today.
- `PlanOnlyConsole` has no `close_console`, so `teardown.request_process_stop` currently always
  refuses.

This is **not** a defect to route around — it is the shape the workspace rule forces: a Python
script cannot call an MCP tool, so the rig *plans* the `visible-console` call and the agent
*executes* it. The consequence for WP7 is that the gate run is **not** one `run_python`; it is an
orchestration in which the agent is the console backend.

Also not yet wired into the entrypoint at all: `ports.provision_port`, `scratch.scratch_run` and
`readiness.check_readiness`. The entrypoint discovers, plans and tears down; it does not yet
borrow settings, create a scratch canvas or run a readiness handshake.

---

## M11 — ⚠ I broke `npm run build` repo-wide, and the mechanism generalises

**Self-inflicted, caught by the AC2 re-measurement, reverted.** Recorded because the mechanism
will bite any future batch that follows the same convention.

WP47's landed convention is that a visible `.test.ts` is **mirrored** into `plugin/src/__tests__/wpNN/`,
because vitest's root is `plugin/` and a `.test.ts` living under `workflowArtifacts/` is never
collected. I applied that convention to WP51's freshly generated suite (`85e2c8f`).

`npm run build` is `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`, and **`tsc`
typechecks the whole `src/` tree, tests included.** WP51's tests import the API WP51 has not been
implemented to provide yet — `STALE_VIEW_FLAG`, `STALE_VIEW_MODES`, `StaleViewMode`,
`RUNTIME_FLAG_READERS`, `isKnownRuntimeFlag`, `CanvasSaveChannelLike`. Result: **18 × `TS2305` /
`TS18046`, `tsc` exits 2, esbuild never runs, and `npm run build` fails for every WP in the repo** —
including WP69, whose Definition of Done requires it to PASS and whose AC2 needs it to emit a
bundle at all.

**The generalisation:** the mirror convention is only valid **after** the WP is implemented. For a
WP whose tests exist but whose implementation does not, mirroring converts "tests fail" (correct,
expected, informative) into "the repo does not build" (blocking, and blocking for *other* WPs).
Test generation and mirroring must therefore be separated by the implementation step.

**Resolution:** reverted in `6b20c17`. All 27 WP51 test files remain intact under
`workflowArtifacts/canvas-v2/tests/{visible,blind_set1,blind_set2}/WP51/` — nothing was deleted,
weakened, retitled or skipped, so no §7 licence is implicated; only my own premature copy into the
compiled tree was undone. WP51's implementer mirrors them when implementing.

**How it was caught is the part worth keeping.** The coordinator's instruction was to re-check the
AC2 comparand "the same way, don't assume my word for it". Doing the measurement rather than
re-reasoning about it is what surfaced this — a broken build gate that no one had looked for.
Rule 7, holding.

---

## M12 — the AC2 comparand, measured twice at two commits, identical

| | measurement 1 | measurement 2 |
|---|---|---|
| commit | `fcb2295` | `6b20c17` |
| dirty entries | 0 | 0 |
| `npm run build` exit | 0 | 0 |
| `plugin/main.js` sha256 | `58fda6f8…46bc` | **`58fda6f8…46bc`** |
| size | 759 892 | 759 892 |
| `__LS_E2E__` | 0 | 0 |

Ten commits separate the two, including three by a concurrent Worker 2 and four of mine. The
agreement is **evidence, not an argument**: whatever landed in between provably did not reach the
bundle. This is the comparand WP69 AC2's "after" measurement is checked against.

Note the coarse-grep trap I set for myself and then disarmed: a `^plugin/src/` path filter flags
`plugin/src/__tests__/wp51/**` as a "build input change". Test sources are typechecked by `tsc`
(so they can **fail** the build) but are unreachable from `src/main.ts` (so they cannot **change**
the emitted bytes). The re-measurement settles that distinction without needing the argument.

---

## M10 — host state at the start of the gate, measured through the rig's **own** primitives

Not a re-implementation: this ran `vaults.discover_instances`, `vaults.is_obsidian_running` and
`lifecycle.default_probe`, so what is recorded is what the rig itself will see.

| | |
|---|---|
| Obsidian running | **no** (`obsidian_running_known: true` — measured, not assumed) |
| vault registry | readable at `%APPDATA%\obsidian\obsidian.json` |
| role a | `ObsidianOrga`, registry id `703aa794cc73a117`, plugin **present + enabled** |
| role b | `ObsidianOrga - Kopie`, registry id `55a4253eb7a90dde`, plugin **present + enabled** |
| `plugin_state`, both roles | **`PLUGIN_NOT_E2E_CAPABLE`** |
| `discovery_ok` | `false`, failures `["PLUGIN_NOT_E2E_CAPABLE", "PLUGIN_NOT_E2E_CAPABLE"]` |

That refusal is **correct behaviour, not a defect**: both vaults carry the production build, so no
control endpoint can ever answer at any port, and the rig names the state instead of launching
windows and timing out. It is also the precise statement of why **WP69 is a hard precondition of
the run**.

Ports, probed:

| constant | port | free | answers |
|---|---|---|---|
| `REAL_CONTROL_PORT_A` | 39431 | yes | **no** |
| `REAL_CONTROL_PORT_B` | 39432 | yes | **no** |
| `HEADLESS_RIG_PORT_A` *(mock — not the gate)* | 39421 | yes | — |
| `HEADLESS_RIG_PORT_B` *(mock — not the gate)* | 39422 | yes | — |

**This is the live confirmation of the standing claim that no control endpoint has ever answered
on this host.** The mock pair is probed only to record that it is idle too — so no stale mock
process could be mistaken for a real endpoint (D13). The mock ports are named here **only** to
exclude them; they appear in no record that claims to satisfy the gate.

Relay-port candidates, all measured free and disjoint from all four above: `39441`, `39442`,
`39443`. WP70 pins **one** of these in `constants.py` and spells it as a literal nowhere else.

Structural confirmation of M6, from the module itself: the set of console backends that start a
process is **empty**.

---

## M8 — ⚠ `canvas.setFlag` can destroy WP70's borrow — an interaction no charter names

Measured directly in `plugin/src/testing/e2e-control.ts:991-1001`:

```ts
setFlag(name, value) {
  const settings = plugin.settings as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(settings, name)) {
    settings[name] = value;
    void plugin.saveSettings?.();          // ← writes the WHOLE in-memory settings to data.json
  } else {
    runtimeFlags.set(name, value);         // ← read by NOTHING
  }
  return { set: true };                    // ← unconditional, even for an unknown flag
}
```

**Two distinct defects, both live today.**

**(1) The inert map — WP51 AC3's target.** `grep -rn runtimeFlags plugin/src/` returns *only* the
two sites inside `e2e-control.ts` itself. Nothing reads it. `setFlag` returns `{set:true}` for any
name whatsoever. A test that asserts *"setFlag stored it and getFlag returns it"* therefore passes
against an implementation in which the flag can never affect anything — the vacuous class in its
purest form, and precisely what AC3 forbids: *"a flag no path consults is rejected at the command
boundary rather than silently stored."*

**(2) The borrow clobber — not named in any charter, and the more dangerous of the two.** For any
flag name that happens to be an existing `LiveShareSettings` key, `setFlag` calls
`plugin.saveSettings()`, which serialises the live instance's **whole in-memory settings object**
back over `<vault>/.obsidian/plugins/live-share/data.json`.

WP70's charter warns of this *shape* — *"any later `saveSettings()` in that live instance writes
its in-memory copy back over the rig's file, silently reverting the provisioning and corrupting
the borrow the restore depends on"* — but attributes it only to **provisioning while the instance
is already running**. It is in fact reachable from **a control command the gate itself issues**,
at any point in the run, on an instance that was provisioned perfectly.

Consequence chain if it fires during the gate: the rig's spliced `data.json` is replaced by the
instance's own serialisation. `ports.restore_port` still restores the byte-exact backup, so the
vault survives — but any key WP70 provisioned after load is silently gone, and a write landing
between restore and the independent post-teardown check makes the sha256 comparison against the
`T3_PREFLIGHT` baselines fail, **failing the gate for a reason that has nothing to do with
Canvas V2**.

**Actions this batch:** WP51 rejects unknown flags at the command boundary and does **not** reach
`saveSettings` for the stale-view flag — the stale-view state rides the WP6 injected seams, not a
persisted setting. WP7's run record states whether any `setFlag` call touched a real settings key.

---

## M9 — a live vacuity in the matrix driver: `applied` is never checked

`h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`.

`_simulate` returns the control server's `{applied}`, and the MCP tool `edit` surfaces it — but
**`_run_case` discards it at every one of the six call sites.** So if a gesture silently does not
take effect on instance A, `a_snap` and `b_snap` are both unchanged, `_compare` finds no
difference, and the case is recorded as **`pass`**.

That is exactly the state C50 AC3 forbids: *"a case whose gesture did not take effect is reported
as inconclusive rather than as a pass."* It is a currently-live instance of the vacuous class, in
the driver that produces the gate's verdict.

Note the *other* direction is already safe and should not be "fixed": if the two instances are not
connected at all, B's snapshot stays empty, `_compare` reports `nodes_only_in_a`, and the case
**fails**. Unshared does not silently pass — it is the *unapplied gesture* that does.

Second, separate hazard in the same file: `_compare` reads `canvas.state`, which is the shared-doc
snapshot — **not the file**. D17: doc convergence is not file convergence on a real host. C50 AC1's
requirement that the C49 **file-level** oracle join the doc oracle is what closes this.

---

## M7 — cross-repo: WP50's target is not in this repository

`TaskCharter_WP50` names `tools/MCPserver/liveshare_e2e_mcp_server.py`. **That path does not exist
in this repo.** The file is `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`
— the *workspace* repo, a different git repository on a different branch. WP50's edit is committed
there, and this repo's checkpoint commits must not try to stage it.
