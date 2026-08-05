# PHASE T3 — Shared Contract (authoritative, pinned by Worker 3 Core)

> **Why this file exists.** In an earlier batch two sub-agents independently chose different
> frame-type numbers for the same protocol and *both* suites went green. Every constant that
> more than one WP in this batch touches is pinned **here**, once. A sub-agent that needs one
> of these values **reads it from the owning module** — it never re-declares it, and never
> invents a variant name.

**Owning module:** `tools/obsidian_e2e/constants.py` — created by **WP43**, imported by WP44–WP49.
No other module may define any value listed below. TS-side constants are pinned in
`plugin/src/testing/e2e-control.ts` and mirrored here for the Python side to match verbatim.

### §0.2 ⚠ Import rule — `import tools.…` is BROKEN in this workspace, verified (STANDING rule)

`h:\My Code\AgenticWorkspace\tools\` is a **regular package** (it has `__init__.py`). The repo's
own `obsidian-live-share/tools/` has none, so it is only a *namespace portion*. Python prefers a
regular package found anywhere on `sys.path` over a namespace portion found earlier — so
`from tools.obsidian_e2e import ...` resolves to the **workspace** `tools`, even with the repo
root first on `sys.path`. Verified empirically, not theorised.

**The one sanctioned import form** — every Python test and module in this batch uses exactly this:

```python
import sys, pathlib
_TOOLS = pathlib.Path(__file__).resolve().parents[N] / "tools"   # <repo>/tools
sys.path.insert(0, str(_TOOLS))
from obsidian_e2e import constants, vaults          # top-level, NOT tools.obsidian_e2e
```

`obsidian_e2e` is unique on the whole path, so this is collision-free.
`tools/obsidian_e2e/__init__.py` **must exist** (regular package) — WP43 creates it.
Do **not** add an `__init__.py` to `obsidian-live-share/tools/` — that would create a second
regular `tools` package and make the collision worse.

---

## 0. Data-safety invariants (override every other consideration)

The two target vaults are the owner's **live working vaults**, currently open in real Obsidian.

| # | Invariant |
|---|---|
| S1 | **No production note, canvas or attachment is ever opened for writing.** The only write locations the *module design* sanctions are `<vault>/_e2e-rig/` (scratch) and `<vault>/.obsidian/plugins/live-share/` (port provisioning, WP44) — and see **S5a**, which forbids exercising either of them against the owner's real vaults in this batch. |
| S1a | **~~SUPERSEDED 2026-08-01 — no longer in force.~~** *Was:* do not install a dev build into either live vault, do not touch `<vault>/.obsidian/plugins/**`. **The owner has since released both vaults for unrestricted testing** — verbatim: there is nothing important in them and they may be used fully. Installing an instrumented dev build into `.obsidian/plugins/live-share/` is now **permitted**, and byte-exact restore drops from a hard acceptance criterion to **good hygiene**. See §0.1. |
| S2 | **Attach, never kill** (D15). The rig never terminates, closes or restarts a process or window it did not itself start. |
| S3 | `%APPDATA%\obsidian\obsidian.json` is shared global state — **read-only, never rewritten**, not even to reformat. |
| S4 | **`data.json` contains a live production secret** (`serverPassword`, and `token`/`jwt` fields). Its content must **never** be printed, logged, echoed into a test fixture, copied into the repo, or included in an error message. Backups stay **beside the original, inside the vault**. Fingerprints and comparisons use **hashes of bytes, never the bytes themselves**. |
| S5 | **This batch performs no live run against the owner's vaults.** WP43's read-only probe may read the real registry and the real vault paths. **Every other WP is unit-tested exclusively against temporary fixture vaults** under `h:\tmp\`. Driving real Obsidian is WP50/WP51, which are out of scope. |
| S6 | Any AC that cannot be met without risking vault data → return `FAILED/BLOCKED`. A blocked WP is a far better outcome than a mutated vault. |

### 0.1 Which of the above are STANDING rules and which expire with B9a

Read this before inheriting anything from §0. Getting it wrong in either direction is a real failure:
a later batch that keeps S1a/S5 will refuse work it is supposed to do; a later batch that drops
S4 will leak a production secret.

| Rule | Lifetime | Successor condition |
|---|---|---|
| **S1**, S2, S3, S6 | **STANDING** — project-wide, every batch | — |
| **S4** (`data.json` secret handling) | **STANDING** — project-wide, every batch | Never lifted. Backups stay beside the original inside the vault; comparisons are sha256-of-bytes only; contents are never printed, logged, echoed into a report, written into a test fixture, or included in a handover. |
| §0.2 (`tools` package shadowing) | **STANDING** — project-wide, every batch | Never lifted. |
| **S1a** (no dev build, `.obsidian/plugins/**` untouched) | **SUPERSEDED 2026-08-01 — not in force for any batch** | Owner released both vaults for unrestricted testing: nothing important is in them. Installing the instrumented dev build is **permitted**. WP44's byte-exact restore is now **good hygiene, not a gate**. Do not refuse work on the strength of S1a. |
| **S5** (no live run; fixture vaults only) | **B9a ONLY — expires with this batch** | Superseded by B9b / WP50 / WP51, which perform the real two-instance run against the live vaults. The WP47 fingerprint gate (D16) is retained as a **regression oracle**, not as a data-safety gate. |

**Why S1a existed at all:** during B9a the dev-build question was still an open owner decision, and
the batch had no acceptance criterion covering a plugin-directory write. It was a scope boundary,
never a judgement that the write is unsafe. WP44's byte-exact-restore machinery was built in B9a
precisely so that B9b can perform that write safely.

---

## 1. Verified environment facts (given — do not re-derive, do not probe for alternatives)

| Fact | Value |
|---|---|
| Obsidian executable | `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe` |
| Vault registry | `%APPDATA%\obsidian\obsidian.json` (= `C:\Users\tschm\AppData\Roaming\obsidian\obsidian.json`) |
| Vault A (role `a`) | `H:\Developement\_NeuralAngels\ObsidianOrga` |
| Vault B (role `b`) | `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` — **contains spaces** |
| Installed plugin id | **`live-share`** (NOT `obsidian-live-share` — that is the repo folder name) |
| Plugin install dir | `<vault>\.obsidian\plugins\live-share\` |
| Plugin present in | **both** vaults, and enabled in both (`community-plugins.json` lists `live-share`) |
| Installed build | **production** — `main.js` contains **zero** `e2eControlPort` / `LIVESHARE_E2E` markers |

### 1.1 Consequence of the production build — read this before designing WP44/WP45/WP46

`plugin/esbuild.config.mjs` defines `__LS_E2E__: prod ? "false" : "true"`, and `main.ts` only
imports `./testing/e2e-control` inside that dead-code branch. The build currently installed in
both vaults is a production build, so **it has no control server and never will, whatever port
is provisioned.**

Therefore a real run requires a **dev build** installed into the vaults. That installation step
belongs to WP50/WP51 (out of scope for this batch) — but every module here must:

- treat "plugin present but not e2e-capable" as a **distinct, named state**, not as "port not provisioned";
- never conclude from an unanswered control port that Obsidian is absent or the vault is wrong.

---

## 2. Roles and identifiers

```python
ROLE_A = "a"
ROLE_B = "b"
ROLES  = (ROLE_A, ROLE_B)          # ordered; index 0 is always the host role
```

Reuse the existing headless-rig client ids and doc-id scheme verbatim — do **not** invent new ones:

| Concept | Value | Source |
|---|---|---|
| client id, role a | `e2e-a` | existing `two-host-harness.ts` |
| client id, role b | `e2e-b` | existing `two-host-harness.ts` |
| canvas doc id | `` `__canvas__:${path}` `` | existing `two-host-harness.ts:34` |

---

## 3. Ports — the single most collision-prone value in this batch

| Constant | Value | Owner | Notes |
|---|---|---|---|
| headless rig port A | `39421` | *existing*, `launch_liveshare_e2e.py` | **unchanged** — do not touch |
| headless rig port B | `39422` | *existing*, `launch_liveshare_e2e.py` | **unchanged** — do not touch |
| `REAL_CONTROL_PORT_A` | `39431` | **WP43** `constants.py` | real rig, role a |
| `REAL_CONTROL_PORT_B` | `39432` | **WP43** `constants.py` | real rig, role b |
| `RELAY_PORT` | `39441` | **WP70** `constants.py` | the rig-started **local** relay |

The real rig uses a **disjoint** port pair so a headless run and a real run can never be
mistaken for one another, and so a stale headless process can never satisfy a real-rig
readiness check. This is the port-level expression of decision **D13**.

`39441` is a third band, disjoint from both pairs and one decade above the real-control
pair so a transposed digit lands on nothing at all. It is **spelled as a literal in
`constants.py` and nowhere else** — not in `relay.py`, not in a default argument, not in a
docstring example, not in a URL string, not in a test. Every consumer imports it, and
`LocalRelay` takes a `port=` override that is then the port it probes, launches against,
reports in its refusals and reports in its `RelayStopResult`.

---

## 4. Plugin settings surface (WP44)

```python
SETTINGS_PORT_KEY   = "e2eControlPort"    # EXISTING hidden loose setting, read by resolvePort()
PLUGIN_ID           = "live-share"
PLUGIN_DIR_REL      = ".obsidian/plugins/live-share"
PLUGIN_DATA_REL     = ".obsidian/plugins/live-share/data.json"
COMMUNITY_PLUGINS_REL = ".obsidian/community-plugins.json"

# Byte-exact backup + provisioning marker — both live INSIDE the plugin dir (S4).
SETTINGS_BACKUP_REL   = ".obsidian/plugins/live-share/data.json.e2e-original"
PROVISION_MARKER_REL  = ".obsidian/plugins/live-share/.e2e-provision.json"
```

**`resolvePort` precedence is frozen** (WP44 AC4). Current order, which must survive unchanged:

1. `process.env.LIVESHARE_E2E` — numeric → that port
2. loose setting `settings.e2eControlPort` — number or numeric string → that port
3. truthy non-numeric env → `0` (ephemeral)
4. otherwise `null` → **server never listens**

WP44 adds **no new dependency** to `resolvePort` and adds **no new branch above the setting**.
The only sanctioned change is the D14 rationale comment at the provisioning site.

**Marker file** (`.e2e-provision.json`) records, so a crashed run is recoverable:
`{"runId": str, "role": "a"|"b", "port": int, "hadOriginal": bool, "originalSha256": str|null, "pid": int, "createdAt": iso8601}`
— **never** the original content itself (S4).

**Idempotence rule (WP44 AC3):** if a backup already exists, it is the *original* and is
**never** overwritten by the current (already-provisioned) state. Provision twice → one backup.

### 4.1 E2E build mode and bundle install namespace (WP69)

Owned by **WP69** (`SharedOwnershipContract_B9b_Gate.md` §1). Appended, never inserted into another
block; no other WP modifies, moves, renames or re-orders one line of it.

```python
E2E_BUILD_ARGV      = "e2e"          # process.argv[2] token, plugin/esbuild.config.mjs
E2E_BUILD_SCRIPT    = "build:e2e"    # the ONE added plugin/package.json script

# The rig's OWN restore point for the plugin bundle — inside the plugin dir (S4).
BUNDLE_BACKUP_REL   = ".obsidian/plugins/live-share/main.js.e2e-original"
INSTALL_MARKER_REL  = ".obsidian/plugins/live-share/.e2e-install.json"
INSTALL_MARKER_FIELDS = (
    "runId", "role", "hadOriginal", "originalSha256", "originalSize",
    "installedSha256", "pid", "createdAt",
)
```

**Why the mode exists.** `npm run build` folds `__LS_E2E__` to `"false"`, so `src/testing/` is
dead-code-eliminated and the shipped bundle can never host a control server (§1.1,
`PLUGIN_NOT_E2E_CAPABLE`). The instrumented build was reachable only through `npm run dev`, which
calls `ctx.watch()` and **never returns**. `E2E_BUILD_ARGV` selects a third mode whose build options
are identical in every field to the watch branch — including `__LS_E2E__: "true"` and
`sourcemap: "inline"` — and which calls `ctx.rebuild()` then `process.exit(0)`. `production` and the
default watch branch are unchanged in behaviour.

**Backup namespace, binding.** The owner's own backups in both plugin directories —
`main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak` **and `styles.css.bak`** (a fourth one, found
by measurement; `T3_PREFLIGHT.md` lists only three) — are never written, moved, renamed, deleted, or
used as a restore point. The rig restores from `BUNDLE_BACKUP_REL` and from nothing else: a corrupted
rig backup is a loud `BUNDLE_RESTORE_MISMATCH`, never a fallback to `main.js.bak`.

**Install marker** (`.e2e-install.json`) records, so a crashed run is recoverable:
`{"runId": str, "role": "a"|"b", "hadOriginal": bool, "originalSha256": str|null, "originalSize": int|null, "installedSha256": str, "pid": int, "createdAt": iso8601}`
— fingerprints and structure only, **never** file content (S4).

**Idempotence rule (same shape as §4):** if the rig's bundle backup already exists, it *is* the
original and is never overwritten by the already-installed state. Install twice → one backup.

**Failure reasons added to §7 by WP69,** appended to `FAILURE_REASONS` in one contiguous run:
`E2E_BUILD_FAILED` (AC1/AC3 — a non-zero build exit is never a bundle, whatever is on disk),
`BUNDLE_NOT_E2E_CAPABLE` (AC3 — a clean exit with a missing build marker),
`BUNDLE_RESTORE_MISMATCH` (AC4 — a restore that would not be byte-exact),
`INSTALL_CONFLICT` (AC4 — an irreconcilable leftover install state).

**`data.json` is out of scope for WP69 entirely** — it is not read, moved or written by the install,
and both vaults' `data.json` sha256 must be unchanged when the WP is done.

### 4.2 The provisioned gate member set and the `obsidian-git` borrow (WP70)

Owned by **WP70** (`WP70_PinnedDecisions.md` §2). Appended, never inserted into another block.

```python
# The ONE data.json borrow of §4, generalised from one member to an ordered member set.
# `ports.provision_port(..., members=…)` is WP70's single added keyword argument; the
# RESTORE path does not consult it and is byte-identical to WP44's.
PROVISIONED_SETTINGS_KEYS = (
    "e2eControlPort", "serverUrl", "roomId", "token", "role",
    "permission", "sharedFolder", "excludePatterns", "autoReconnect", "debugLogging",
)
SETTINGS_SHARED_FOLDER    = SCRATCH_FOLDER   # the constant itself, NOT a second spelling
SETTINGS_EXCLUDE_PATTERNS = ()               # provisioned as an EMPTY list

# A SECOND borrow, over a DIFFERENT file, in its own namespace — never inside ports.py,
# whose whole invariant is one borrow over one file.
DISABLED_PLUGIN_IDS          = ("obsidian-git",)
COMMUNITY_PLUGINS_BACKUP_REL = ".obsidian/community-plugins.json.e2e-original"
COMMUNITY_PLUGINS_MARKER_REL = ".obsidian/.e2e-community-plugins.json"
COMMUNITY_PLUGINS_MARKER_FIELDS = (
    "runId", "role", "hadOriginal", "originalSha256", "originalSize",
    "disabled", "pid", "createdAt",
)

# The member names whose VALUES are credentials (S4). The room token is minted
# server-side by POST /rooms, so it is a live credential in exactly the sense the four
# data.json members are; nothing downstream may distinguish them.
SETTINGS_TOKEN_KEY   = "token"
SECRET_SETTINGS_KEYS = (SETTINGS_TOKEN_KEY,) + CREDENTIAL_SETTINGS_KEYS
```

**Marker validation is total, and it is the same at both doors.** Every field of
`COMMUNITY_PLUGINS_MARKER_FIELDS` is structurally validated by the one loader the disable
path and the restore path share — non-empty strings where a string is meant, a `role` that
is a real role, a non-`bool` non-negative `pid`, an actual `bool` for `hadOriginal`, a list
of distinct non-empty ids for `disabled`, and a digest **and** a byte length exactly when
`hadOriginal`. A record is one statement, and a half-checked statement is not a weaker
guarantee but a false one. **Shape** checks (is this 64 hex characters?) stay distinct from
**content** checks (are they the right 64?): shape is `COMMUNITY_PLUGINS_CONFLICT`, content
is `COMMUNITY_PLUGINS_RESTORE_MISMATCH`, the same discriminator §4 and §4.1 already use.

**Adoption is only for this rig's own leftover.** The rig disables exactly
`DISABLED_PLUGIN_IDS`, so a marker recording any other `disabled` set was written by
something else and is a `COMMUNITY_PLUGINS_CONFLICT` at the **disable** door. It is *not*
checked at the **restore** door: there the recorded sha256 and byte length fully determine
the bytes to write back, and refusing on a field that has no bearing on them would strand
the owner's file behind a record they cannot edit. Entry asks *may I take this over?*;
exit asks *what do I give back?*

**The modify path is a textual splice, never a re-serialisation** — the same discipline
`ports.py::_with_port` applies to `data.json`. Only the spans occupied by the removed ids
are cut, so the borrowed file keeps the owner's BOM, CRLFs, tabs, indentation, single-line
spacing and missing trailing newline for the duration of the borrow, and a list with
nothing to remove is left byte-identical.

**Failure reasons added to §7 by WP70** — see §7.

---

## 5. Scratch artefacts (WP47)

```python
SCRATCH_FOLDER  = "_e2e-rig"          # vault-relative, rig-owned, created and removed per run
SCRATCH_PREFIX  = "e2e-scratch-"
SCRATCH_EXT     = ".canvas"
# scratch file: f"{SCRATCH_FOLDER}/{SCRATCH_PREFIX}{run_id}{SCRATCH_EXT}"
```

**`run_id`** — one generator, in `constants.py`, used by every WP that needs a run identity
(scratch name, marker file, log correlation):

```python
run_id = f"{utcnow:%Y%m%dT%H%M%SZ}-{os.getpid()}-{secrets.token_hex(3)}"
```

Timestamp + pid + 6 random hex → two concurrent runs cannot collide (WP47 AC4).

**Fingerprint** (WP47 AC3) — the gate, not a diagnostic:

- walks the vault, **excluding** `SCRATCH_FOLDER`, `.obsidian/plugins/live-share/`, `.git/`, `.trash/`
- per file records `(relative_posix_path, size, sha256_of_bytes)` — **hash only, never content** (S4)
- before-run and after-teardown fingerprints must be **equal**; a mismatch **fails the run**

---

## 6. Control protocol — existing commands (reuse verbatim, do not rename)

`POST /command` → `{cmd, args}` → `{ok: true, result}` (HTTP 200) | `{ok: false, error}` (HTTP 400).
`GET /events` → SSE, `{type, path, payload}`.

| cmd | args | result |
|---|---|---|
| `session.info` | — | `{clientId, role, roomId, connected}` |
| `canvas.open` | `path` | `{opened, subscribed}` |
| `canvas.state` | `path` | `{nodes, edges}` |
| `canvas.binding` | `path` | `{applyRemote, captureLocal, rePush, originUpdates}` |
| `canvas.simulateEdit` | `path`, `change` | `{applied}` |
| `canvas.setFlag` | `name`, `value` | `{set}` |
| `sync.waitQuiescent` | `timeoutMs?` (default `2000`) | `{quiescent}` |

**`sync.waitQuiescent` — `timeoutMs = 0` (WP61 AC4).** `0` is a legal, explicitly forwarded
value, not an absent one: the router falls back to the `2000` default only when the argument is
absent, non-numeric or negative. `0` means **"expire at the earliest opportunity — answer after
the first poll, never from pre-call history"**. It does not mean "infinite", and it does not mean
"decided synchronously": a wait is a question about the interval it covers, so `waitQuiescent`
sleeps one poll interval before its first evaluation (WP49 AC1), and a zero-budget probe
therefore costs exactly one poll interval (`pollMs = 20`) instead of returning for free. This is
the single authority for `timeoutMs = 0`; no test and no implementation may assume a
zero-latency answer.

## 6.1 Control protocol — commands ADDED in this batch (exact names, pinned)

| cmd | owning WP | args | result |
|---|---|---|---|
| `scratch.create` | **WP47** | `path`, `content?` | `{created: bool, path: string}` |
| `scratch.remove` | **WP47** | `path` | `{removed: bool}` |
| `canvas.file` | **WP49** | `path` | `{exists: bool, sha256: string, size: number, content: string \| null}` |

`canvas.file` is a **read-back only** (WP49 AC3): it opens the file for reading, and must not
write, touch `mtime`, re-serialise or normalise. It reports what the plugin's own writer produced.

## 6.2 `session.info` added fields (WP46) — exact names, pinned

| field | type | meaning |
|---|---|---|
| `vaultId` | `string` | stable identity of the vault this instance serves |
| `vaultName` | `string` | vault basename as Obsidian knows it |
| `vaultPath` | `string \| null` | absolute vault path when the adapter exposes it |
| `pluginBuild` | `string` | plugin build identity (version + build marker) |
| `canvasSurface` | `boolean` | whether a canvas view surface is available |

Existing four fields (`clientId`, `role`, `roomId`, `connected`) keep their names and semantics.
**Production impact must remain zero** and `src/testing/` must still tree-shake out of the
production bundle — the existing guard grep (`e2e-control|LIVESHARE_E2E|e2eControlPort`
→ 0 matches in the production `main.js`) must still return 0.

---

## 7. Named failure reasons — one enum, all WPs use it

Defined once in `constants.py` as string constants. Every abort names exactly one of these;
no WP invents an ad-hoc reason string, and no abort is reported as a bare exception.

```
VAULT_NOT_IN_REGISTRY        # WP43 AC1
VAULT_PATH_MISSING           # WP43 AC1
PLUGIN_MISSING               # WP43 AC2
PLUGIN_PRESENT_BUT_DISABLED  # WP43 AC2 — distinct state, NOT a variant of missing
PLUGIN_NOT_E2E_CAPABLE       # §1.1 — production build, no control server
SETTINGS_RESTORE_MISMATCH    # WP44 AC2 — non-byte-exact restore
PROVISION_CONFLICT           # WP44 AC3
LAUNCH_EXECUTABLE_MISSING    # WP45 AC3
RESTART_REQUIRED_OPERATOR    # WP45 AC2 — stop and instruct, never restart
READINESS_TIMEOUT            # WP46 AC2/AC3
IDENTITY_SAME_VAULT          # WP46 AC2 — both endpoints report the same vault
IDENTITY_UNKNOWN_VAULT       # WP46 AC3 — a vault that is not one of the two configured
ROOM_MISMATCH                # WP46 AC2
ENDPOINT_LOST_MIDRUN         # WP48 AC3
FINGERPRINT_MISMATCH         # WP47 AC3 — vault changed; fails the run
SCRATCH_STALE_UNRECLAIMED    # WP47 AC4 / WP48 AC4
DOC_CONVERGED_FILE_DIVERGED  # WP49 AC2 — the D17 defect class
WAIT_TIMEOUT                 # WP48 AC2 — always names the awaited condition
E2E_BUILD_FAILED             # WP69 AC1/AC3
BUNDLE_NOT_E2E_CAPABLE       # WP69 AC3
BUNDLE_RESTORE_MISMATCH      # WP69 AC4 — non-byte-exact restore
INSTALL_CONFLICT             # WP69 AC4
RELAY_PORT_OCCUPIED          # WP70 AC3 — never adopt, never kill
RELAY_BUILD_FAILED           # WP70 AC3
RELAY_READINESS_TIMEOUT      # WP70 AC3 — names the awaited condition on expiry
RELAY_NOT_STOPPED            # WP70 AC3 — an orphaned listener is a FAILED run
ROOM_MINT_FAILED             # WP70 AC3/AC4
GATE_ORDER_VIOLATION         # WP70 AC4 — raised by relay.py AND provisioning.py, one type
SHARED_SURFACE_NOT_ESTABLISHED    # WP70 AC2
PROPAGATION_EVIDENCE_UNAVAILABLE  # WP70 AC5 — a leg's channel is absent or is not a channel
NEGATIVE_CONTROL_LEAKED           # WP70 AC5 — the change arrived anyway ⇒ FAILED run
COMMUNITY_PLUGINS_CONFLICT        # WP70 precondition — contradictory or foreign leftover
COMMUNITY_PLUGINS_RESTORE_MISMATCH # WP70 precondition — a restore that is not byte-exact
```

`RESTART_REQUIRED_OPERATOR` (WP45, existing) is **reused** by WP70 AC4 for its refusal to
provision a vault whose plugin is already loaded, and `VAULT_PATH_MISSING` (WP43, existing)
for a vault with no `.obsidian/` configuration directory. No new reason is invented for
either: a state that already has a name does not get a second one.

---

## 8. Entrypoints — decision D13

| Entrypoint | Status | Rule |
|---|---|---|
| `tools/launch_liveshare_e2e.py` | **kept**, demoted in status | The fast headless mock rig. Its `--alias:obsidian=plugin/src/__mocks__/obsidian.ts` (line 101) stays. WP45 adds **self-identification** only: it must state in its banner and `--help` that it is the **headless mock rig** and **cannot satisfy the Teil-14 gate**. Do not rip out the mock path. |
| `tools/launch_obsidian_e2e.py` | **new**, created by WP45 | The real-Obsidian rig. The only entrypoint that can satisfy the gate. |

A run record produced by the headless rig must be structurally impossible to mistake for a real
run record — the rig kind is recorded in the run record as `"headless-mock"` or `"real-obsidian"`.

---

## 9. Process launching — workspace rule (WP45 AC4)

Every long-running or interactive process the rig starts goes through the workspace
`visible-console` MCP tools (`run_python` / `run_command`, then `await_console`) — **never** a
detached Bash background process. The rig entrypoint is a Python script invoked by
**absolute path** via `run_python`.

Both vault paths contain spaces (`ObsidianOrga - Kopie`), which is exactly what the documented
`run_command` nested-quote trap breaks on. Use `run_python` with an absolute script path, and
build every subprocess argument as a **list**, never a joined string.

Vault opening uses the Obsidian URI with the vault name **URL-encoded** (WP45 AC3):
`obsidian://open?vault=<urlencoded name>`.

---

## 9a. The build runner is REQUIRED, and the spawn has exactly one name (WP78)

> **Appended by WP78. §9 above is WP45's and §4.1 is WP69's — neither is modified, moved,
> renamed or re-ordered by this block.** It exists so WP71's plan and WP7's run read the
> symbol name from here instead of inventing a second one (rule 10).

**The pinned symbol — spelled here once, read from the owning module, never re-declared:**

```python
obsidian_e2e.install.spawning_subprocess_runner        # the ONE opt-in spawning runner
obsidian_e2e.install.build_e2e_bundle(plugin_dir, *, runner)   # `runner` is REQUIRED
```

**The rule.** `build_e2e_bundle`'s `runner` is keyword-only and has **no default**. A caller
that wants a real npm build passes the runner **by name**:

```python
result = install.build_e2e_bundle(plugin_dir, runner=install.spawning_subprocess_runner)
```

`build_e2e_bundle(plugin_dir)` is a `TypeError` **at the call**, not an npm spawn at runtime.
Nothing in the body substitutes a default — no `if runner is None`, no sentinel, no
`functools.partial`, no module-level constant — and the superseded private name
`_default_runner` does not survive as an alias. Two names for one spawn is how one of them
stops being audited.

**Where the spawn lives, pinned and countable.** `tools/obsidian_e2e/` holds **exactly two**
spawn primitives, and **both are inside `spawning_subprocess_runner`**: its function-local
`import subprocess` and the `subprocess.run` call. The import is function-local on purpose —
a module-level one would bind `install.subprocess`, leaving a second spawn seam reachable by
anyone who imports the module, needing no runner and no call to `build_e2e_bundle` at all.
The package therefore binds `subprocess` at module scope **nowhere**.

**What this is for.** C45 AC4's guarantee is *structural*: the console is **injected**, so no
test, no dev loop and no mistaken import can reach the real `Obsidian.exe` or the owner's live
working vaults by accident (D16). A spawning **default** turns that into a call-site
convention. A required parameter is that guarantee in argument position — the same move WP70
and WP77 made with `Secret` for credentials, one module over: *auditing call sites is a
promise; a signature is a guarantee.*

**Consequence for WP71 (C71 AC4).** The criterion is now satisfiable and is decided by an
**AST walk over the parsed package**, never by a grep — a rename, an alias,
`importlib.import_module("subprocess")` or `getattr(os, "system")` defeats a text search and
does not defeat the walk. Four things are established together, and the walk must carry a
**positive control** proving it found the symbols it names before any absence is asserted:

├── **(a)** every `subprocess` / `Popen` / `os.system` / `os.popen` / `os.spawn*` / `os.exec*`
│          reference is inside `spawning_subprocess_runner`, enumerated by module, function
│          and line, with the total node count **pinned at 2**
├── **(b)** `spawning_subprocess_runner` is the default value of **no** parameter anywhere in
│          the package, and no `x or …` / `x if … else …` substitution names it
├── **(c)** `build_e2e_bundle`'s `runner` is keyword-only **with no default**, read from the
│          parsed signature
└── **(d)** every call to `build_e2e_bundle` in the repository supplies `runner` — the one
           admissible exception being a call written **inside `with pytest.raises(TypeError):`**
           in order to assert that a bare call is refused, which is recognised structurally
           and never by a file-name allowlist

**The reusable oracle already exists** — `workflowArtifacts/canvas-v2/tests/visible/WP78/_spawn_oracle.py`,
with its positive control built in. WP71 re-asserts (a)–(d) against the tree WP78 leaves; it
introduces no new spawn reference and removes neither of the two.

**Adding a spawn backend is out of scope and is an ESCALATE, not a judgement call.**
`spawn_through_console` remains the single seam for a launched process.

---

## 10. Assertion hygiene — CRDT tie-breaks

Yjs resolves same-key concurrent writes by `clientID`, and `clientID` is `random.uint32()` per
`Y.Doc`. **Never assert a specific value after two concurrent same-key writes** — that assertion
passes about half the time and is not a behavioural oracle. Assert only on values with a single
author or a causal predecessor chain; where both peers must write, **order the writes**.

---

## 10a. Relay target — a real deployed relay is available (for WP50/WP51 and W4)

Nothing in B9a's scope changes because of this; it is recorded here so the batches that run the
matrix know the option exists and know the constraints that come with it.

The owner has **authorized deploying new relay server versions to the NeuralAngels box for
testing**. So a real run has two valid relay targets:

| Target | When to prefer it |
|---|---|
| local in-process relay | fast iteration; default for headless and for first real-rig bring-up |
| deployed relay on the NeuralAngels box (`liveshare.neuralangels.de`) | verifying behaviour over real TLS/WS and the real network path |

> ### ⚠ Correction (WP70) — the **gate** relay is the local one, and that is not a preference
> The table above reads as a free choice. For the Teil-14 gate it is not. **The gate runs
> against a relay the rig starts locally** (`RELAY_PORT`, §3): a release gate must be
> hermetic, and a network dependency injects exactly the flake this run has spent its
> length removing from its own signals. Authorisation to deploy is *permission*, not a
> requirement. Remote-relay operation is a possible **future, non-gating** matrix case; it
> is not chartered and must not be added in passing.
>
> Two measured facts that go with it, recorded and accepted rather than repaired because
> `server/**` is a §7 abort criterion outside WP41:
>
> - The relay **binds on all interfaces** (`server/src/index.ts:236` — `server.listen(port)`
>   with no host argument), so it is network-reachable for the run's duration even though
>   the rig only ever probes `127.0.0.1`.
> - Only **one** of its three LevelDB stores (`BLOB_STORE_PATH`) is reachable by an
>   environment variable; room persistence and the audit log take *parameter* defaults that
>   no variable can reach. All three are **cwd-relative**, so the run-scoped store directory
>   is established by starting the relay *inside* it — outside the repository and outside
>   both vaults, removed at teardown.

**Standing constraints on any such deploy — all non-negotiable:**

- Deploys run through the **`ssh-deploy` MCP pipeline**, not ad-hoc ssh.
- Compose **must** set `name: liveshare` — otherwise the project name collides on `stack` and
  orphans the NA gateway.
- **Never** `--remove-orphans`.
- `neural-angels-access` and `n8n` are **protected services** — never touched.
- **No secret may pass through any agent tool** — not in a command string, not in `ssh_args`, not
  in a tool argument. Secrets are typed by the operator in the console's masked SECRET mode.
  This is the same rule as S4 and it is equally absolute.

---

## 10b. The local relay, its evidence channels, and secret handling (WP70)

Owned by **WP70**. Every constant named here lives in `constants.py` §10 and is imported,
never re-spelled.

### The lifecycle, and the one oracle that is not obvious

```
port free (probed FIRST, before anything reaches the console)
  → built (entry point present, or one awaited `tsc` build)
  → started (exactly ONE launch payload; a second start() is GATE_ORDER_VIOLATION)
  → healthy (GET /healthz answering ok=true — bounded, polled, never a sleep)
  → room minted ONCE on THAT relay
  → …run…
  → stopped (the PORT no longer completes a connection — never the close call's return)
  → released (store directory removed on every path, then the failure re-raised)
```

⚠ **Measured on this host: a closed port raises `TimeoutError`, never
`ConnectionRefusedError`.** Every unused port drops the SYN and the connect consumes its
whole timeout. An oracle written `except ConnectionRefusedError: return stopped` can
**never fire here** and would look correct only because a surrounding `except OSError`
swallowed the timeout. The shipped oracle is therefore *"a connection no longer completes
within a bounded budget"*, and it is non-vacuous because the positive direction was
measured too — a live relay accepted the connection and answered `/healthz` on the first
poll. `RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25` is small because every negative poll costs
it in full.

Readiness is the mirror image: a **refused connection, a socket timeout, a truncated
response and a malformed body are each "not ready yet", not errors** — node binds late, and
treating any of them as an error turns that into a failed run. Only the expiry of the
bounded budget is an error, and it names the awaited condition. Readiness once established
is **not re-probed**.

`RelayStopResult` carries `host`, `port` and `probes`. `probes` is not decoration: a verdict
of `stopped=True` reached after **zero** probes is one inferred from the close call's
return, and without the count the two are indistinguishable in a run record.

**`release()` finishes its own work and then raises.** The store is removed on every path,
including an unexpected exception out of the console seam — and then the failure propagates.
"Teardown runs to completion even when a step fails" is a property of the teardown *driver*
(`provisioning.run_teardown`), which attempts every action and reports each one's reason; it
is not a licence for a step to hide its own failure in a returned field. An orphaned
listener is a **failed run**.

### AC5's two evidence channels — the mechanism, never the demonstration

```python
RELAY_EVIDENCE_KEYS    = ("roomId", "documents", "clients", "frames")
NEGATIVE_EVIDENCE_KEYS = ("relayMediated", "changed")
```

`relay.relay_observation(local_relay)` builds the positive channel from **what the relay
itself holds** — its own `/healthz` body and the frames its own run-scoped store retained.
A relay with no minted room, or one that never reported healthy, cannot build one:
`PROPAGATION_EVIDENCE_UNAVAILABLE`. A built channel carries every key of
`RELAY_EVIDENCE_KEYS` and **no token**.

**Validate the type, never the truthiness.** `0` is not `False`, `""` is not "absent", and
an empty or wrongly-typed channel is *absent* rather than falsy-but-present. The split that
runs through the evaluation: **the type decides whether this is a channel (a refusal); the
value decides the verdict.** A count that is not an integer is a channel that measured
nothing; a count that is an integer but too small — or negative — is a measurement that
fails the criterion, i.e. `positive_observed=False`. A window that is absent, zero, negative
or not a number is the *absence* of an observation, not a short one.

⚠ **The positive leg cannot be settled by WP70 at all** — it needs two real Obsidian
instances. Content appearing in vault B is **not** sufficient and may not be recorded as
satisfying AC5, and neither may the `obsidian-git` disposition record: a precondition is a
claim about what was *configured*, AC5 is a claim about what the relay *observed*.

### Secrets — a type, not an audit (S4)

The room token is **minted server-side by `POST /rooms`**, so it is a live credential. The
rule is that a value carrying a secret **cannot be rendered by any general-purpose
stringification and cannot arrive in a message, a log record or a traceback by accident** —
and it is enforced structurally rather than by auditing call sites, because a `@dataclass`
repr, `str()`'s fallback to `repr()`, `logging`'s lazy `%s` and a traceback frame are four
different call sites that all reach the same object.

- `relay.Secret` — redacting `__repr__` / `__str__` / `__format__`, refused `__bytes__` /
  `__iter__` / `__contains__`, immutable, and `reveal()` as the **only** accessor. Equality
  is deliberately open: comparing against a candidate a caller already holds discloses
  nothing; *rendering* is the accidental act and rendering is what is shut. Copying returns
  the wrapper, so `dataclasses.asdict()` cannot unwrap it.
- `relay.REDACTED` — the placeholder, named so a check can assert a rendering *was
  redacted* rather than only that the secret is absent.
- `RelayRoom.token` is a `Secret`; `RelayRoom.reveal_token()` is the one legitimate reveal.
- `relay.RedactedMapping` — the same property one level up, for the minted `POST /rooms`
  payload and for the provisioned member set, both of which are mappings a caller prints.
- An evidence channel carrying any of `SECRET_SETTINGS_KEYS` is **refused**: a channel is a
  count, and a credential can only have got there by a caller copying a settings payload in.

---

## 11. File boundary for this batch (B9a)

**In scope:** `tools/obsidian_e2e/**` (new), `tools/launch_obsidian_e2e.py` (new),
`tools/launch_liveshare_e2e.py` (self-identification only),
`plugin/src/testing/e2e-control.ts` (the named seams only), rig-side tests.

**Out of bounds — another Worker 3 is editing these right now:**
`plugin/src/canvas/**`, `plugin/src/files/**`, `plugin/src/sync/**`, `server/**`.

**Deletion ledger:** licenses WP4, WP21, WP22, WP33 only. **No WP in this batch may delete or
weaken a test.** Green baseline to preserve: plugin **81 files / 926 tests, 0 failed**;
server **18/149**; `npm run build` PASS.
