# WP70 — Pinned decisions (Worker 3 Core, batch B10a)

> **Written before any WP70 file was opened.** Hard-won rule 10: *two agents independently
> choosing incompatible constants has already cost this run a batch. One WP defines, the
> others read.* Every value below is **pinned here first**, then transcribed into
> `tools/obsidian_e2e/constants.py` **§10** and mirrored into `T3_SharedContract.md`.
> A value in one and not the other is drift.
>
> **Batch baseline:** `fd7de1f47a…` (`fd7de1f`), tree measured **clean, 0 dirty entries**.
> Rule 4: "pre-existing" in this batch means pre-existing to **that** commit, never to any
> WP's own diff. No WP establishes staleness by stashing its own edits.
>
> ⚠ **A sibling batch B10b is live on WP72 (`plugin/src/testing/e2e-control.ts`) and WP73
> (`h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`).** Neither file
> is WP70's. Report foreign edits; never fix them. Every commit uses explicit path staging —
> `git add -A` would sweep up B10b.

---

## 0. Measured facts taken before any work (independent, reproducible)

| Fact | Value |
|---|---|
| `data.json` sha256, `ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` — **matches** the `T3_PREFLIGHT.md` baseline |
| `data.json` sha256, `ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` — **matches** |
| `community-plugins.json`, both vaults | byte-identical, `["obsidian-git", "live-share"]` |
| plugin dir listing, both vaults | `data.json · main.js · main.js.0.5.9.bak · main.js.bak · manifest.json · manifest.json.bak · styles.css · styles.css.bak` — **no rig artefact left by WP69** |

Both hashes matching at batch start is the precondition that makes the post-run comparison
mean anything. They are re-measured at handover.

---

## 1. The relay port — a third band, disjoint from all four existing ports

```python
RELAY_PORT = 39441
```

| Port | Owner | Kind |
|---|---|---|
| `39421` / `39422` | `HEADLESS_RIG_PORT_A/B` | headless **mock** rig control |
| `39431` / `39432` | `REAL_CONTROL_PORT_A/B` | real rig control (D13) |
| **`39441`** | **`RELAY_PORT` (WP70)** | **the rig-started local relay** |

`39441` is disjoint from all four, and sits one decade above the real-control pair so a
transposed digit lands on nothing. **Spelled as a literal nowhere else** — not in `relay.py`,
not in a default argument, not in a docstring example, not in a URL string, not in a test.
Every consumer imports it. If any artefact of this batch contains `39421` or `39422` in a
record claiming to satisfy the gate, that record is void.

---

## 2. Everything else pinned in `constants.py` §10

```python
# --- the relay ---------------------------------------------------------------
RELAY_PORT              = 39441
RELAY_HOST              = "127.0.0.1"      # what the RIG probes; see the bind note below
RELAY_BASE_URL          = f"http://{RELAY_HOST}:{RELAY_PORT}"
RELAY_HEALTH_PATH       = "/healthz"
RELAY_ROOMS_PATH        = "/rooms"
RELAY_ROOM_NAME_PREFIX  = "e2e-gate-"      # room name = prefix + run_id
RELAY_SERVER_DIR_REL    = "server"         # repo-relative; the module resolves it
RELAY_ENTRY_REL         = "server/dist/index.js"
RELAY_BUILD_SCRIPT      = "build"          # server/package.json — `tsc`, TERMINATES

# --- bounded waits (NO sleeps as oracles; see §5b for why these values) ------
RELAY_READY_BUDGET_S            = 30.0     # bounded; names the awaited condition on expiry
RELAY_READY_POLL_INTERVAL_S     = 0.25
RELAY_READY_CONNECT_TIMEOUT_S   = 2.0
RELAY_STOPPED_BUDGET_S          = 15.0
RELAY_STOPPED_POLL_INTERVAL_S   = 0.25
RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25     # a closed port on this host consumes the WHOLE
                                           # connect timeout, so keep it small (§5b)

# --- the run-scoped store directory (AC3) ------------------------------------
# Outside the repository and outside both vaults, removed at teardown.
RELAY_STORE_ROOT_NAME   = "obsidian-e2e-relay"          # under tempfile.gettempdir()
RELAY_STORE_SUBDIRS     = ("data/frames", "data/yjs-docs", "data/audit")

# --- the provisioned settings key set (AC1) — pinned ORDER, exhaustive -------
PROVISIONED_SETTINGS_KEYS = (
    "e2eControlPort", "serverUrl", "roomId", "token", "role",
    "permission", "sharedFolder", "excludePatterns", "autoReconnect", "debugLogging",
)
SETTINGS_ROLE_HOST      = "host"
SETTINGS_ROLE_GUEST     = "guest"
SETTINGS_ROLES          = {ROLE_A: SETTINGS_ROLE_HOST, ROLE_B: SETTINGS_ROLE_GUEST}
SETTINGS_PERMISSION     = "read-write"
SETTINGS_SHARED_FOLDER  = SCRATCH_FOLDER   # "_e2e-rig" — NOT re-spelled
SETTINGS_EXCLUDE_PATTERNS = ()             # provisioned as an EMPTY list
SETTINGS_AUTO_RECONNECT = True
SETTINGS_DEBUG_LOGGING  = False

#: Never read, never written, never named in a value position (S4).
CREDENTIAL_SETTINGS_KEYS = (
    "encryptionPassphrase", "encryptionSalt", "jwt", "serverPassword",
)

# --- the obsidian-git precondition borrow (Dispatcher ruling 2026-08-04) -----
DISABLED_PLUGIN_IDS          = ("obsidian-git",)
COMMUNITY_PLUGINS_BACKUP_REL = ".obsidian/community-plugins.json.e2e-original"
COMMUNITY_PLUGINS_MARKER_REL = ".obsidian/.e2e-community-plugins.json"
COMMUNITY_PLUGINS_MARKER_FIELDS = (
    "runId", "role", "hadOriginal", "originalSha256", "originalSize",
    "disabled", "pid", "createdAt",
)
```

### Failure reasons appended to `FAILURE_REASONS` (WP70, one contiguous run, after WP69's)

```
RELAY_PORT_OCCUPIED                # WP70 AC3 — never adopt, never kill
RELAY_BUILD_FAILED                 # WP70 AC3
RELAY_READINESS_TIMEOUT            # WP70 AC3 — names the awaited condition
RELAY_NOT_STOPPED                  # WP70 AC3 — an orphaned listener fails the run
ROOM_MINT_FAILED                   # WP70 AC3/AC4
GATE_ORDER_VIOLATION               # WP70 AC4
SHARED_SURFACE_NOT_ESTABLISHED     # WP70 AC2
PROPAGATION_EVIDENCE_UNAVAILABLE   # WP70 AC5 — a leg's channel is not there
NEGATIVE_CONTROL_LEAKED            # WP70 AC5 — the change arrived anyway ⇒ FAILED run
COMMUNITY_PLUGINS_CONFLICT         # precondition — contradictory leftover borrow
COMMUNITY_PLUGINS_RESTORE_MISMATCH # precondition — a restore that is not byte-exact
```

`RESTART_REQUIRED_OPERATOR` (WP45, existing) is **reused** for AC4's refusal to provision a
vault whose plugin is already loaded. No new reason is invented for it.

**Append, never edit or reorder.** WP69's `§4.1` block and every WP43–WP49 block are
untouched — not one line moved, renamed or re-indented.

---

## 3. File boundary for WP70 (extends `SharedOwnershipContract_B9b_Gate.md` §2)

| Path | Disposition |
|---|---|
| `tools/obsidian_e2e/constants.py` | **modify** — append a `§10 — WP70` block only |
| `tools/obsidian_e2e/ports.py` | **modify** — the modify path only, via **one** added keyword argument |
| `tools/obsidian_e2e/relay.py` | **create** |
| `tools/obsidian_e2e/provisioning.py` | **create** — see §4 |
| `workflowArtifacts/canvas-v2/T3_SharedContract.md` | **modify** — §3, §4, §7, new §10b; **correct §10a** |

**Out of bounds, absolutely:** `server/**` (§7 abort criterion outside WP41),
`plugin/src/**` — *including* `plugin/src/testing/e2e-control.ts`, which is **B10b/WP72's**;
`h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` (**B10b/WP73's**);
`tools/obsidian_e2e/lifecycle.py`, `install.py`, `vaults.py`, `readiness.py`, `scratch.py`,
`teardown.py`; `%APPDATA%\obsidian\obsidian.json` (S3, read-only, including its stray third
registration); the owner's four `*.bak` files in either plugin dir.

### Why a fifth file, `provisioning.py`

The charter names four. The Dispatcher's 2026-08-04 ruling then assigned WP70 a fifth
deliverable — **mechanising the `obsidian-git` disable/restore** — without naming a file.
It goes in a new module rather than in either existing one, for two structural reasons:

- it must **not** go in `ports.py`, whose whole invariant is *one borrow over `data.json`*.
  `community-plugins.json` is a different file and a different borrow; putting a second
  borrow in the module that owns the first is exactly the shape AC1 exists to forbid.
- it must **not** go in `relay.py`, which owns a process lifecycle and nothing else.

`provisioning.py` therefore owns three things that are all *"prepare the environment for a
run, reversibly"*: the gate settings provisioning wrapper over `ports.provision_port`, the
`community-plugins.json` borrow, and the AC4 ordering enforcement. No other WP writes it.

---

## 4. ⚠ Structural constraint the implementer must NOT break: the rig does not spawn

**`relay.py` and `provisioning.py` contain no `subprocess`, no `Popen`, no `os.system`, no
`os.exec*`, and no `shutil.which`-plus-spawn.** This is not stylistic:

- **C45 AC4 is landed and says so** — every long-running process the rig starts goes through
  the workspace `visible-console` tools, never a detached background process.
- **C71 AC4 requires the property to survive** — "after this component lands there is still
  no `subprocess`, `Popen`, `os.system` or equivalent under `tools/obsidian_e2e/`; the
  console remains injected; `spawn_through_console` remains the single seam."
- The injected console is the **only** thing that makes it structurally impossible for a
  test or a dev loop to reach the real `Obsidian.exe` and the owner's live vaults (D16).

The relay is therefore started **by the mediating agent through `visible-console`**, from a
plan `relay.py` emits. The console protocol `relay.py` depends on is exactly:

| call | used for | awaited? |
|---|---|---|
| `run_command(argv, title=…, cwd=…)` → `console_id` | the `tsc` server build | **yes** — it terminates |
| `run_command(argv, title=…, cwd=…)` → `console_id` | starting the relay | **NO** — fire-and-forget; awaiting a server is the C69 watch trap in a new place |
| `await_console(console_id, timeout=…)` | the build only | — |
| `close_console(console_id)` | stopping the rig's **own** relay (D15/S2: it started it) | — |

`lifecycle.PlanOnlyConsole` has no `close_console` and no `cwd`. `relay.py` **subclasses**
it (a read of `lifecycle.py`, never a write) and adds both. Readiness, room minting, health
observation and the stopped-port probe are plain `http.client` / `socket` — no spawn needed
for any of them.

> ### FINDING — the no-spawn property is **already false**, and WP69 broke it
> `tools/obsidian_e2e/install.py:101` imports `subprocess` and `:458` calls
> `subprocess.run(argv, cwd=cwd, check=False)` in `_default_runner`. It landed in `e27b352`
> (WP69). `DISPATCHER_STATE.md` and `T3_PREFLIGHT.md` both still assert "no `subprocess` /
> `Popen` anywhere in `tools/obsidian_e2e/`", and **C71 AC4 is written to preserve a property
> that no longer holds.** Mitigating: it drives a *terminating* build, not a long-running
> process, so C45 AC4's letter ("every long-running process the rig **starts**") is arguably
> intact — but the structural grep C71 AC4 names now returns a hit.
> **Not WP70's to fix** (`install.py` is WP69's file). Recorded, escalated in the report,
> and the reason `relay.py` takes an injected console with **no default spawning runner**.

---

## 5. The store directory — env vars are NOT sufficient, and the charter says they are

C70 AC3: *"All three of the relay's cwd-relative LevelDB stores (`BLOB_STORE_PATH` →
`./data/frames`, room persistence → `./data/yjs-docs`, audit log → `./data/audit`) are
pointed at a run-scoped directory outside the repository and outside both vaults."*
The charter §3 heading calls the relay *"configured entirely through environment variables it
already reads"*. **Re-traced against the current tree (rule 12) — that is true of `PORT`,
`SERVER_PASSWORD`, `REQUIRE_GITHUB_AUTH` and `BLOB_STORE_PATH`, and false of the other two:**

| store | site | configurable? |
|---|---|---|
| blob / frames | `server/src/index.ts:204` — `process.env.BLOB_STORE_PATH \|\| "./data/frames"` | **yes**, env |
| room persistence | `getDefaultPersistence()` at `persistence.ts:84` calls `createLevelPersistence()` with **no argument**; the `"./data/yjs-docs"` default is a *parameter default*, reachable by no env var | **no** |
| audit log | `index.ts` calls `initAuditLog()` with **no argument**; `"./data/audit"` is likewise a parameter default | **no** |

`grep -n "process.env" server/src/*.ts` returns nine hits and none of them is a store path
other than `BLOB_STORE_PATH`. Adding one would be a `server/` edit — an **abort criterion**.

**Resolution, and it needs no `server/` change:** all three paths are **cwd-relative**, so the
rig starts the relay with its **working directory set to the run-scoped store directory**:

```
argv = ["node", "<abs repo>/server/dist/index.js"]
cwd  = <tempdir>/obsidian-e2e-relay/<run_id>          ← the run-scoped store dir
env  = PORT=<RELAY_PORT>, BLOB_STORE_PATH=<abs>/data/frames
```

Node resolves `node_modules` by walking up from the **module file's** directory, not from
cwd, so `server/node_modules` is still found. `isMain` compares `resolve(process.argv[1])`
against the module URL, so an absolute entry path still takes the `isMain` branch.
`BLOB_STORE_PATH` is *additionally* set absolutely — belt and braces, and it is the one AC3
names by env.

⚠ **This contradicts charter §5's** *"Node commands run from `server/` for the relay and never
from the repo root"*. Running from `server/` would put all three stores in `server/data/**`,
i.e. **inside the repository**, which AC3 forbids in the same sentence. The AC wins over the
§5 gloss; §5's underlying intent (*never the repo root*) is honoured — the cwd is neither.

---

## 5b. ⚠ MEASURED ON THIS HOST — a closed port does NOT refuse, it TIMES OUT

Worker 3 Core started a real relay on `39441` and stopped it, before any WP70 code existed.
**This retires two open items and creates one hard implementation constraint.** Measured
2026-08-04, `visible-console` consoles `684386df` (relay), `b7e5bd5b` (live probe),
`5b40d8a7` (stop probe):

| Port probed with `socket.create_connection`, nothing listening | result |
|---|---|
| `39441` (relay, just stopped) | **`TimeoutError`** after the full connect timeout |
| `39421` (headless-mock A) | **`TimeoutError`** |
| `39431` (real-control A) | **`TimeoutError`** |
| `65000` (certainly unused) | **`TimeoutError`** |

And the timeout is consumed in full — `0.05 s → 63 ms`, `0.25 s → 265 ms`, `1.0 s → 1000 ms`,
`2.0 s → 2016 ms`. Something on this host **drops loopback SYNs to closed ports instead of
sending RST**. Every unused port behaves identically, so this is the host, not the relay.

**Consequence — this is a "green that cannot fail" waiting to happen, and it is AC3's:**

- An oracle written `except ConnectionRefusedError: return stopped` **can never fire on this
  host.** `ConnectionRefusedError` is never raised. Anyone testing that oracle would see it
  "work" only because the surrounding `except OSError` swallowed the timeout.
- The oracle must be **"a connection no longer completes within a bounded budget"**, not
  "a connection is refused". AC3's wording ("the port no longer accepts a connection") is
  satisfiable in that reading and in no other.
- It is sound here **because the positive direction was measured too**: while the relay was
  up, `create_connection` **succeeded** and `GET /healthz` answered `ok` on the **first**
  poll. So on this host a listening socket is reachable and a non-listening one times out —
  the two states are distinguishable. That pairing is what makes the probe non-vacuous, and
  the implementation must keep both halves.
- **Cost:** every negative poll costs the whole connect timeout. Pin a short one
  (`RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25`) for the stopped probe, separate from the
  readiness probe's. A 5 s connect timeout would make a 15 s stop budget three polls.

### Two open items this retires

- **"Windows graceful relay shutdown is unverified"** — `close_console(console_id)` (a
  process-tree kill of the console the rig itself started) **did** stop it: the port stopped
  completing connections on the **first** poll after the close returned. D15/S2 is satisfied
  because the rig started that console. The *signal-based* graceful path is still unverified
  and is not what the rig uses.
- **"the relay decision / can a local relay even be driven"** — yes, measured end to end.

### Measured relay facts (same run)

| | |
|---|---|
| `GET /healthz` while up | `{"ok": true, "uptime": 2.62, "sessions": 0, "documents": 0, "clients": 0}` — readiness on poll **1** |
| `POST /rooms` | **HTTP 201**, keys `['id','name','token']`, `id` length **36** (uuid), `token` length **24** (nanoid24) — **minted server-side; neither value read or printed** |
| all three LevelDB stores | created under the run-scoped cwd: `…/core-preflight/data/{frames,yjs-docs,audit}` — **the cwd mechanism of §5 works, and no `server/` change was needed** |
| repo pollution by this run | **none** — the store dir was removed afterwards and `git status` is clean |

> **Pre-existing debris, NOT created by this run (rule 4).** The repository already contains
> `data/audit` and `data/yjs-docs` dated **2026-07-20** and an empty `server/data/` dated
> **2026-08-01** — LevelDB stores left by earlier hand-run relays. Both are gitignored
> (`.gitignore`: `data/`), so they do not dirty the tree and did not show at the batch
> baseline. **They are exactly the failure AC3 exists to prevent, and they are evidence that
> it happens.** Not WP70's to delete. A test asserting "the repo has no `data/` directory"
> would therefore be RED for a pre-existing reason — assert **"this run wrote nothing into
> them"** instead.

---

## 5c. ⚠ The `run_command` nested-quote trap — reproduced, not theorised

`T3_PREFLIGHT.md` warns about it; Worker 3 Core walked into it on the **first** relay launch
attempt and it is recorded here so nobody re-derives it. Passing `run_command` a rendered
string containing a quoted absolute path:

```
node "H:\Developement\...\server\dist\index.js"
```

is wrapped as `cmd.exe /d /c "chcp 65001 > NUL && …"`, and the inner quotes are folded into
the argument. Node received a path with **literal quote characters embedded in it**:

```
Error: Cannot find module 'C:\…\core-preflight\"H:\Developement\…\dist\index.js"'
```

It also failed in the most expensive possible way: the readiness probe then reported
`RELAY_READINESS_TIMEOUT` after 14 polls, which reads like a slow or broken relay rather
than a launch that never happened. **A launch failure must be distinguishable from a
readiness failure** — the relay's console status is the discriminator, and the module must
consult it before blaming readiness.

**The sanctioned form, which worked first try:** `run_python` with an **absolute** script
path and every argument as a **list**. That is contract §9, and it is now measured, not
assumed. Note the gap it exposes: the rig's `PlanOnlyConsole` emits an `argv` **list** for
`run_command`, but the real `visible-console` `run_command` tool accepts a `command`
**string** — so a mediating agent that renders that list itself re-enters this trap. Record
it; the seam belongs to WP71/C71, not to WP70.

---

## 6. Ordering (AC4) — enforced at each boundary, not only recorded

```
install+verify bundle (C69) → relay port free → relay started → relay healthz-ok
  → room minted on THAT relay → per vault: obsidian-git disabled  → data.json borrowed
  and provisioned with the room's own id+token, while that instance is NOT running
  → launch/attach (C45) → readiness+identity (C46) → scratch (C47) → matrix case 1 (C50)
```

Teardown reverses it and **runs to completion even when a step fails**. Each constraint is a
refusal at the boundary that owns it, so a step arriving out of order is refused *wherever it
arrives from* — a mediated run is exactly where a documented-only ordering gets stepped around:

| boundary | refuses with |
|---|---|
| `relay.start()` when the port is occupied | `RELAY_PORT_OCCUPIED` — never adopt, never kill |
| `relay.mint_room()` before `healthz` ok | `GATE_ORDER_VIOLATION` |
| `provision_gate_settings()` without a minted room | `GATE_ORDER_VIOLATION` |
| `provision_gate_settings()` while that vault's control port answers | `RESTART_REQUIRED_OPERATOR` |
| `GateSequence` step out of the pinned order | `GATE_ORDER_VIOLATION` |

---

## 7. AC5 — what WP70 owns, and what it explicitly does not

WP70 delivers the **mechanism and its evidence channels**, not the demonstration:

- **positive leg channel** — a relay-side observation: `GET /healthz` `documents` / `clients`
  counts plus the frames the relay's own store retained for the run's room. Hermetic relay,
  so no file-copying engine can manufacture it.
- **negative control channel** — the same gesture with the relay-mediated path provably not
  in place, over a window **at least as long** as the positive leg needed.
- **the refusal** — `PROPAGATION_EVIDENCE_UNAVAILABLE` when either channel is absent, and
  `NEGATIVE_CONTROL_LEAKED` when the change arrives anyway. The latter is a **FAILED run**
  reported under its name — never re-run until green, never recorded as a stronger result.

**The positive leg cannot be settled by WP70 at all** — it needs two real Obsidian instances,
which is WP7's run. Content appearing in vault B is **not** sufficient and may not be
recorded as satisfying AC5. Stated here so no reader mistakes a passing WP70 for evidence
that propagation was ever observed.

**AC5 must hold independently of the `obsidian-git` disposition.** It may not be discharged
by observing content in vault B, and it may not be discharged by citing the disposition
record. A precondition is a claim about what was *configured*; AC5 is a claim about what the
relay *observed*. If the disposition record could satisfy AC5, the record would have become
the evidence — the exact substitution AC5 exists to refuse.

---

## 8. Credentials — absolute, no exception in this batch

`data.json` in both vaults holds live credentials: `encryptionPassphrase`, `encryptionSalt`,
`jwt`, `serverPassword`, `token`. **No byte of either file, and no value read from either
file, is ever printed, logged, echoed into a report, run record, commit message, error
message or fixture. Comparison is sha256-of-bytes only.** The room token the rig mints is
not the owner's credential but it **is** a credential: it lives in memory and in the
provisioned file and is never printed either.

Measured, and relied on only as hashes: `encryptionPassphrase` and `encryptionSalt` are empty
in both vaults (so they agree); `clientId` differs; `roomId` is empty in both; `serverUrl` is
identical. None of those values was read.

---

## 9. Verification discipline

- **Rule 4** — pre-existing means pre-existing to `fd7de1f`, never to your own diff. Never
  establish staleness by stashing your own edits.
- **Rule 11** — a perturbation that changes nothing is a **finding**, not a null result.
- **Rule 12** — verify a defect against the **current tree** before acting on a description
  of it. Two descriptions in these charters have already failed that test (§4 and §5 above).
- **Rule 9** — a blind pass without a non-zero executed collected count is UNVERIFIED.
- **WP70 holds no BUILD_SPEC §7 licence of any class.** No test is deleted, weakened,
  retitled, skipped or amended. Escalate rather than edit one.
- **Do not mirror the generated suite into `plugin/src/__tests__/`.** `tsc` typechecks `src/`
  including tests, so a mirrored unimplemented suite turns "tests fail" into "the repo does
  not build" for every other WP. This cost the previous batch a revert (`6b20c17`).
- **pytest cannot collect from the workspace root** — `Projects/_external/FinaleAbgabe` is a
  dangling symlink to an absent drive. It is the owner's thesis link: **do not delete or
  repair it.** Invoke pytest with explicit file paths and cwd
  `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share` (the junction), with
  interpreter `h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe`.
- Nothing may be reported as observed until it has run.

---

## 10. What must NOT happen in this batch

- **No Obsidian session is started.** WP70 is provisioning and relay lifecycle only. The
  gate run is WP7. Note that starting a guest session before the `sharedFolder` narrowing
  holds would trash the owner's files in vault B (`manifest.ts:445` → `main.ts:471` →
  `:523-540`) — which is *why* WP70 is a safety precondition, not a convenience.
- **No relay is deployed anywhere.** The gate is hermetic and local. The owner's
  authorisation to deploy to the NeuralAngels box is permission, not a requirement.
- No `server/` byte changes. The relay **binds on all interfaces**
  (`server/src/index.ts:236`, `server.listen(port)` with no host argument), so it is
  network-reachable for the run's duration. §7 makes a `server/` edit outside WP41 an abort
  criterion, so this is **recorded and accepted**, not repaired.
- The guest's `cleanupStaleFiles` will trash rig-owned scratch artefacts inside the shared
  folder that the manifest lacks — including one left by a crashed earlier run. Under AC2's
  narrowed surface that is confined to `_e2e-rig`, which is rig-owned and disposable. It
  touches WP47 AC4's stale-scratch reclaim. **Noted, not fixed here.**
- `canvas.setFlag` can destroy this WP's borrow (`saveSettings()` from the live in-memory
  copy for any name matching an existing settings key). **WP72, in sibling batch B10b, is
  fixing it.** WP70's design must not silently depend on that fix landing first: the
  interaction is recorded, the borrow's restore verifies independently against the
  `T3_PREFLIGHT.md` baselines, and a clobbered borrow therefore surfaces as a loud
  `SETTINGS_RESTORE_MISMATCH` rather than as a silent wrong restore.
