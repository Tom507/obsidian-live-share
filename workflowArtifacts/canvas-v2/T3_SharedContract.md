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

The real rig uses a **disjoint** port pair so a headless run and a real run can never be
mistaken for one another, and so a stale headless process can never satisfy a real-rig
readiness check. This is the port-level expression of decision **D13**.

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
```

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

## 11. File boundary for this batch (B9a)

**In scope:** `tools/obsidian_e2e/**` (new), `tools/launch_obsidian_e2e.py` (new),
`tools/launch_liveshare_e2e.py` (self-identification only),
`plugin/src/testing/e2e-control.ts` (the named seams only), rig-side tests.

**Out of bounds — another Worker 3 is editing these right now:**
`plugin/src/canvas/**`, `plugin/src/files/**`, `plugin/src/sync/**`, `server/**`.

**Deletion ledger:** licenses WP4, WP21, WP22, WP33 only. **No WP in this batch may delete or
weaken a test.** Green baseline to preserve: plugin **81 files / 926 tests, 0 failed**;
server **18/149**; `npm run build` PASS.
