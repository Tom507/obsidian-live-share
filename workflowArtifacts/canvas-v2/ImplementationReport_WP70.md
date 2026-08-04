# Implementation Report — WP70

Attempt: 1 (of 3) · Batch **B10a** · Written by **Worker 3 Core**

## Status: RISKY/UNSTABLE — `risk_flag = HIGH`

Visible is green; **both blind sets are not**. The implementation is **overfit to the
visible set**, which is exactly the condition the blind sets exist to detect, and it is
reported rather than papered over (Worker 3 rule 4: a risk flag with detailed notes is a
better outcome than silently passing).

| Test set | collected | passed | failed |
|---|---|---|---|
| visible | **259** | **259** | **0** |
| blind_set1 | **284** | 261 | **23** |
| blind_set2 | **257** | 247 | **10** |

Every count is **executed and non-zero** (rule 9). Interpreter
`h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe`, cwd
`H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share` (the junction — pytest
**cannot** collect through `Projects\_external\`, see "environment" below), explicit paths,
`-p no:cacheprovider`, launched through `visible-console` `run_python`
(consoles `508dddd2`, `f3434757`, `5b0b30a3`).

⚠ **The blind sets are 29 files each, not 31.** The unit-test sub-agent was terminated by
an account spend limit while generating them, so `tp03` and one other point have no blind
counterpart in set 1, and likewise in set 2. The Review Gate's "exactly 2 blind
counterparts per visible test" is therefore **not** satisfied, and the 23/10 failures are
measured against an **incomplete** hidden set — the true failure count can only be ≥ these.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — one borrow, one splice, byte-identical for the port-only case | **DONE (visible) / UNSTABLE (blind)** | The three structural claims are verified **independently by Core, by hash** — see below. `blind_set1/tp29` (6 failures) says the *restore-mismatch* discrimination is not yet right. |
| **AC2** — the shared surface is established and narrowed | **DONE** | `SETTINGS_SHARED_FOLDER is SCRATCH_FOLDER` (`_e2e-rig`) — the constant, not a re-spelling; `excludePatterns` provisioned empty. One blind failure (`tp09`, run-record role ordering). |
| **AC3** — relay built, started, proven ready, provably released | **PARTIAL** | The mechanism is **live-verified end to end by Core** (below). 11 blind failures across `tp13`/`tp15`/`tp17` mean the *refusal and readiness edge cases* are not yet general. |
| **AC4** — ordering stated, enforced, recorded | **PARTIAL** | Enforced at the boundaries per the pinned table; `blind_set1/tp19` and `blind_set2/tp22` show two ordering/teardown paths not yet general. |
| **AC5** — propagation evidence **mechanism** | **PARTIAL — and by charter it CANNOT be completed here** | 7 blind failures in `tp23`/`tp25`/`tp26`. **The positive leg needs two real Obsidian instances, which is WP7's run.** Nothing about propagation has been observed. |
| **`obsidian-git` precondition** (Dispatcher ruling, not a charter AC) | **DONE and LIVE-VERIFIED** | See the dedicated section — the one part of this WP exercised against the owner's real vaults. |

---

## The relay port constant

```python
RELAY_PORT = 39441          # tools/obsidian_e2e/constants.py:353
```

| Port | Owner | Kind |
|---|---|---|
| `39421` / `39422` | `HEADLESS_RIG_PORT_A/B` | headless **mock** rig |
| `39431` / `39432` | `REAL_CONTROL_PORT_A/B` | real rig control (D13) |
| **`39441`** | **`RELAY_PORT`** | the rig-started local relay |

Disjoint from all four, verified by assertion, and one decade above the real-control pair
so a transposed digit lands on nothing. **Rule 10 discharged by measurement:**
`grep -rn 39441 tools/ --include=*.py` returns **exactly one line**, `constants.py:353`.
It is spelled in no other module, no default argument, no docstring and no URL string.

---

## AC1 — the three structural claims, verified by hash rather than asserted

Baselines were taken by Core at commit `abcab9a`, **before** the implementation existed
(`WP70_PinnedDecisions.md` §3). Re-measured after:

| function | verdict | sha256 (first 32) |
|---|---|---|
| `restore_port` | **UNCHANGED** | `59c113a335b372d656b8cc0e936641fe` |
| `_load_marker` | **UNCHANGED** | `5ac26e4bbcb4e02a879d8ee82b0504b5` |
| `_marker_blob` | **UNCHANGED** | `2ed4b8c2c9bf83c0525b42d6c8ab892a` |
| `_with_port` | **CHANGED** (`1856dc8a…` → `9c0bf602…`) | the one generalisation |

Three unchanged and exactly one changed is what *"one generalisation, reached through one
added keyword argument"* looks like as a measurement rather than as a promise. The restore
path and the marker's pinned field set are **byte-identical**, as AC1 requires.

The provisioned key set is exactly the pinned ten, in the pinned order:

```
e2eControlPort · serverUrl · roomId · token · role
permission · sharedFolder · excludePatterns · autoReconnect · debugLogging
```

**No value from either `data.json` appears anywhere in this report**, and the four
credential keys (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`) are
neither read nor written. Comparison is sha256-of-bytes only (S4).

> **Charter imprecision, recorded not acted on.** AC1 says all ten keys are *"an existing
> member of `LiveShareSettings`"*. Nine are. **`e2eControlPort` is not** — it is the
> pre-existing *hidden loose setting* WP44 already owns (`constants.py:83`,
> `plugin/src/types.ts:5–34` does not declare it). It is not an invented key, so the AC's
> intent holds; the wording is simply wrong about one member.

---

## `obsidian-git` disable / restore — the mechanism and its INDEPENDENT verification

**Ruling:** enabled in both vaults with `autoPullOnBoot: true` over dirty git work trees
with `origin` remotes. It fires at **launch** — the moment a gate starts Obsidian — and an
auto-pull onto a dirty tree can merge or check out over local state *before any Canvas V2
code runs*. A failure caused this way would look like a sync bug and would not be one.
**Precondition, not a disposition.**

**Where it lives.** A new module `tools/obsidian_e2e/provisioning.py`, deliberately **not**
`ports.py` (whose whole invariant is *one borrow over `data.json`*; a second borrow in that
module is the shape AC1 forbids) and **not** `relay.py` (a process lifecycle and nothing
else). Writing `community-plugins.json` is WP70's — WP69 AC4's prohibition binds WP69,
which is install-only.

**Mechanism** — the same reversible-borrow discipline as the `data.json` borrow:

```
capture (byte-exact backup + marker carrying sha256 AND byte length, never content)
  → modify (remove only the pinned DISABLED_PLUGIN_IDS; every other id keeps text and place)
  → restore (drive from the BACKUP verbatim; verify sha256 AND exact length before and after)
  → verify INDEPENDENTLY
```

Namespace: `.obsidian/community-plugins.json.e2e-original` +
`.obsidian/.e2e-community-plugins.json`. A contradictory leftover is
`COMMUNITY_PLUGINS_CONFLICT` with nothing written; a non-byte-exact restore is
`COMMUNITY_PLUGINS_RESTORE_MISMATCH` with the evidence left for a human. Restore runs on
every exit path — `borrowed_community_plugins.__exit__` covers `KeyboardInterrupt` and
`SystemExit`, which a teardown hung off `except Exception` would miss.

### The live run (console `ad2174a0`, both owner vaults, exit 0)

Guarded first: **0 `Obsidian.exe` processes** — the rig never acts on an instance it did
not start (D15/S2).

| | vault A `ObsidianOrga` | vault B `ObsidianOrga - Kopie` |
|---|---|---|
| `community-plugins.json` **before** | `42932112…d571611` | `42932112…d571611` |
| `disabled` / `enabled_after` | `('obsidian-git',)` / `('live-share',)` | same |
| **during** the borrow | `f6f63830cb8357b4…82c9039e` | `f6f63830cb8357b4…82c9039e` |
| **after** restore | `42932112…d571611` | `42932112…d571611` |

**Why this is not a green that cannot fail.** The file provably *changed* under the borrow
(`42932112 → f6f63830 → 42932112`) — rule 11's converse: a perturbation that changed
nothing would have been the finding. And the comparand is **independent**: `42932112…` was
measured by Core *before any WP70 code existed*, so the restore is graded against something
the rig did not produce, not against the rig's own backup.

Four checks, both vaults, all **OK**: restored == the pre-run measurement · restored == the
independent baseline · `data.json` still == the `T3_PREFLIGHT` baseline · **no rig artefact
left in the vault**.

> `lan-vault-sync` is installed but **NOT enabled** and was **not** dispositioned.
> `community-plugins.json` is the *enabled* list and contains exactly `obsidian-git` and
> `live-share`, byte-identically in both vaults.

---

## `data.json` — both vaults against the pre-flight baselines

| Vault | `T3_PREFLIGHT.md` baseline | measured at handover | |
|---|---|---|---|
| `ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` | identical | **MATCH** |
| `ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` | identical | **MATCH** |

Checked at batch start **and** after the live borrow. The two differ from each other, which
is correct (per-vault identity keys) and was not "converged".

---

## The relay — live-verified before a line of `relay.py` existed

Core started a real relay, drove it and stopped it (consoles `89e3a37d`, `684386df`,
`b7e5bd5b`, `5b40d8a7`), so the design was measured rather than assumed:

- `server` `npm run build` (`tsc`) — exit 0, **terminates**; no watch trap on this side.
- readiness: `GET /healthz` → `{"ok": true, "uptime": 2.62, "sessions": 0, "documents": 0,
  "clients": 0}` on the **first** poll.
- `POST /rooms` → **HTTP 201**, keys `['id','name','token']`, `id` length 36 (uuid),
  `token` length 24 (nanoid24) — **minted server-side; neither value read or printed.**
- **all three** LevelDB stores landed under the run-scoped directory; the directory was
  removed and `git status` stayed clean.
- stop: `close_console` released the port on the **first** probe afterwards.

### ⚠ AC3's store claim needed correcting — env vars are NOT sufficient (rule 12)

The charter calls the relay *"configured entirely through environment variables it already
reads"*. Re-traced against the current tree:

| store | site | env-configurable? |
|---|---|---|
| blob / frames | `index.ts:204` — `process.env.BLOB_STORE_PATH \|\| "./data/frames"` | **yes** |
| room persistence | `getDefaultPersistence()` (`persistence.ts:84`) calls `createLevelPersistence()` with **no argument**; `"./data/yjs-docs"` is a *parameter default* | **no** |
| audit log | `index.ts` calls `initAuditLog()` with **no argument**; `"./data/audit"` likewise | **no** |

Adding an env var would be a `server/` edit — a §7 **abort criterion**. **Resolution needing
no `server/` change:** all three are *cwd-relative*, so the relay is started with its
**working directory set to the run-scoped store directory**. Node resolves `node_modules`
from the module file's directory, and `isMain` compares `resolve(process.argv[1])`, so an
absolute entry path still works. Measured: all three stores landed correctly.

This **contradicts charter §5's** *"Node commands run from `server/`"* — which would put the
stores in `server/data/**`, **inside the repository**, which AC3 forbids in the same
sentence. The AC wins; §5's intent (*never the repo root*) is honoured, as the cwd is neither.

### ⚠ A closed port on this host TIMES OUT — it does not refuse

Measured for `39441`, `39421`, `39431` and a certainly-unused `65000`: every one raises
**`TimeoutError`**, consuming the whole connect timeout (`0.05 s → 63 ms`, `2.0 s → 2016 ms`).
Something drops loopback SYNs to closed ports instead of sending RST.

**An AC3 stop oracle written `except ConnectionRefusedError` could never fire here** — it
would look correct only because a surrounding `except OSError` swallowed the timeout. The
oracle must be *"a connection no longer completes within a bounded budget"*, paired with the
measured positive direction (a live relay **did** accept, and answered `healthz` on poll 1)
so the two states stay distinguishable. `RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25` is pinned
small because every negative poll costs the full timeout.

**This retires "Windows graceful relay shutdown is unverified"** for the path the rig
actually uses (`close_console`, a process-tree kill of a console the rig itself started, so
D15/S2 holds). The *signal-based* graceful path remains unverified and is not used.

### ⚠ The `run_command` nested-quote trap — reproduced, not theorised

A rendered `node "H:\…\dist\index.js"` was wrapped as `cmd.exe /d /c "chcp 65001 > NUL && …"`
and reached node with **literal quotes inside the path**
(`Cannot find module 'C:\…\"H:\Developement\…"'`). It then failed as a *readiness timeout*
after 14 polls — which reads like a slow relay rather than a launch that never happened.
**A launch failure must be distinguishable from a readiness failure.** `run_python` with an
absolute path and list args worked first try. Related gap for WP71/C71: `PlanOnlyConsole`
emits an argv **list** for `run_command`, but the real MCP `run_command` takes a **string**,
so a mediating agent that renders the list re-enters this trap.

---

## AC5 — the mechanism, and what it explicitly does NOT establish

Built: a positive relay-side channel (`/healthz` `documents`/`clients` plus the frames the
relay's own store retained for the run's room), a negative control over a window **at least
as long** as the positive leg needed, and the two refusals —
`PROPAGATION_EVIDENCE_UNAVAILABLE` when a channel is absent and `NEGATIVE_CONTROL_LEAKED`
when the change arrives anyway (a **FAILED** run under its own name, never a stronger
result, never re-run until green).

**AC5's positive leg cannot be settled by this WP at all.** It needs two real Obsidian
instances, which is WP7's run. **Content appearing in vault B is not sufficient and has not
been observed.** This split is stated so a passing WP70 is never read as evidence that
propagation was seen. AC5 also holds *independently* of the `obsidian-git` disposition: a
precondition is a claim about what was configured, AC5 about what the relay observed.

**7 of the 33 blind failures are in this mechanism** (`tp23` ×7, `tp25` ×2, `tp26` ×2), so
even the parts that *can* be settled here are not yet general.

---

## Blind failure clusters — the rework targets, in priority order

**blind_set1 (23):** `tp29` restore byte-exactness / re-serialised-copy discrimination (**6**,
incl. BOM, CRLF-no-final-newline, deep indent, escaped non-ASCII, single-line) · `tp13`
occupied-port refusal (**5**) · `tp15` readiness probe: refused vs timeout vs
"not re-probed once established" (**4**) · `tp23` empty/wrongly-typed evidence channel (**2**)
· `tp26` zero/negative positive window (**2**) · `tp17` stop reporting/propagation (**2**) ·
`tp09` run-record role ordering (**1**) · `tp19` second `mint_room` refused (**1**).

**blind_set2 (10):** `tp23` evidence channel construction (**5**) · `tp25` "only boolean
`False` counts as no change" (**2**) · `tp02` minted room token redacted in the room's own
`repr` (**1**) · `tp22` a stuck relay must not stop either vault's restore (**1**).

`tp02` and `tp29` are the two that matter most: the first is a **credential-leak** surface
(a token in a `repr`), the second is the **restore** oracle this whole WP's safety rests on.

---

## Two visible-test fixture defects corrected — and why no §7 licence was needed

**WP70 holds no §7 licence of any class**, and none was used. Both files were authored **by
this batch**, and per the Dispatcher's **D-1 ruling** every §7 class governs *inherited*
tests (same precedent as WP26's type-annotation edit and WP27's own-test revision). **No
assertion, count, matcher or title claim was weakened.**

- **`tp17` (3 tests).** They set the port probe to *occupied* and then called `start()` —
  which correctly refuses an occupied port, AC3's own requirement, pinned by `tp13`. Making
  them pass by changing the implementation would have meant **deleting the occupied-port
  refusal**, a D15/S2 safety rule. Two passing siblings *in the same file* already used the
  right pattern (`listening = [False]` → `start()` → `listening[0] = True`); the three now
  match them. Every assertion is verbatim.
- **`tp03` (1 param).** The corpus self-audit asserts a naive JSON round-trip destroys each
  entry. `{}` is the one entry `json.dumps` reproduces exactly, so it cannot carry that
  property. It is **named** as degenerate and excluded from the **audit only**; it stays in
  `CORPUS`, and the byte-identity requirement still applies to it. `empty_object_padded`
  (`b"  {   }  \n"`) covers the same shape adversarially.

---

## `canvas.setFlag` — the interaction, now stateable rather than a caveat

WP70's borrow could be destroyed mid-run by `canvas.setFlag`, which called
`plugin.saveSettings()` for any name matching an existing settings key, rewriting the
borrowed `data.json` from the live in-memory copy. **WP72 landed in sibling batch B10b and
fixes it.** B10b's correction to the mechanism: the clobber branch was decided by
`hasOwnProperty` on the **live object**, not by the declared type — i.e. **broader** than the
original description.

WP70 does **not** depend on that fix for safety: the borrow's restore is verified against the
independent `T3_PREFLIGHT` baselines, so a clobber surfaces as a loud
`SETTINGS_RESTORE_MISMATCH` rather than a silent wrong restore. With WP72 landed, the
mid-run source is closed; AC4's `RESTART_REQUIRED_OPERATOR` refusal continues to cover the
*late-provisioning* source, which is a different one.

---

## Environment / foreign edits / what was NOT executed

- **pytest cannot collect from the workspace root.** `Projects/_external/FinaleAbgabe` is a
  dangling symlink to an absent drive; it is the **owner's thesis link — not deleted, not
  repaired**. Every run used the junction as cwd with explicit paths.
- **`plugin/main.js` is not a safe bundle oracle** (B10b): untracked, shared,
  last-build-wins across concurrent batches. **No WP70 verification hashes it.**
- **Pre-existing LevelDB debris in the repo, not created by this run:** `data/audit` and
  `data/yjs-docs` (2026-07-20) and an empty `server/data/` (2026-08-01), from earlier
  hand-run relays. Gitignored, dated before the batch baseline — and exactly the failure
  AC3 exists to prevent. Not WP70's to delete.
- **⚠ WP69 already broke the "no spawn in `tools/obsidian_e2e/`" property.**
  `install.py:101` imports `subprocess` and `:458` calls `subprocess.run` (landed
  `e27b352`). `DISPATCHER_STATE.md`, `T3_PREFLIGHT.md` and **C71 AC4** all still assert that
  property. It drives a *terminating build*, so C45 AC4's letter survives, but the
  structural grep C71 AC4 names now returns a hit. **Not WP70's to fix** — and the reason
  `relay.py`/`provisioning.py` take an **injected** console with no default spawning runner.
- **⚠ A concurrent Worker 2 committed WP70's files.** `b8a541e` ("spec(wp74) …") contains
  **97** files — their 5 plus **all 92 of WP70's** — so it was staged with `git add -A`
  / `commit -a` despite the shared-ownership rule. Nothing is lost and nothing was
  overwritten, but WP70's work is **attributed to a WP74 spec commit**. History was **not**
  rewritten (another agent is live on this branch). Also observed and never touched:
  `BUILD_SPEC_CanvasV2.md`, `TaskCharter_WP74_…` (Worker 2) and
  `plugin/src/testing/e2e-control.ts` (B10b/WP72, since committed).

### NOT executed — nothing below may be read as observed

- **No Obsidian session was started.** No control endpoint has answered on this host.
- **No propagation between the two vaults has been observed**, by any means.
- **No plugin bundle was installed** into either vault by WP70; both keep the production build.
- **No relay was deployed anywhere.** The gate is hermetic and local.
- No `server/` byte was changed. The relay **binds on all interfaces**
  (`index.ts:236`, `server.listen(port)` with no host argument), so it is network-reachable
  for a run's duration — **recorded and accepted** per §7, not repaired.
- The guest's `cleanupStaleFiles` will still trash rig-owned scratch artefacts inside the
  shared folder that the manifest lacks, including one from a crashed run. Under AC2's
  narrowed surface that is confined to the rig-owned `_e2e-rig`. Touches WP47 AC4. **Noted,
  not fixed.**
- `npm test` for the plugin suite was **not** re-run by WP70 (no `plugin/src/**` file is
  touched); `tsc --noEmit` was clean at `abcab9a` with B10b's edit present, which is the
  attribution baseline.

---

## Summary for Worker 3 / the Dispatcher

The gate now has a sync path the rig owns: a pinned relay port (`39441`, spelled once), a
relay whose whole lifecycle was **live-verified** before the module was written, a room the
rig mints, and a shared surface narrowed **by construction** to the rig-owned `_e2e-rig` —
which is the data-safety precondition that must hold before any session is ever started.
The `obsidian-git` precondition is mechanised and its restore is **independently verified on
both real vaults**, with both `data.json` hashes still matching the pre-flight baselines.

**It is not done.** 33 blind failures across two *incomplete* hidden sets say the
implementation is overfit to the visible set, and the two sharpest clusters are the restore
oracle (`tp29`) and a credential-leak surface (`tp02`). Attempt 2 should be a **generalisation**
pass, not a patch of the named tests, and the blind sets need their missing counterparts
generated first so the gate is measured against a complete set.
