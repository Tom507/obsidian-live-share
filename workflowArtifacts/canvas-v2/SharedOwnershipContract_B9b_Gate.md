# Shared Ownership Contract — batch B9b (the real-Obsidian gate)

> **Written by Worker 3 Core before any WP in this batch started.** Rule 10: *two agents
> independently choosing incompatible constants has already cost this run a batch. One WP
> defines, the others read.*
>
> **Batch baseline:** `fcb229523d90d13b676059b8533ef1be6405a7de`, tree clean (0 dirty entries,
> measured), **advanced mid-batch to `f9774f8a8fec88f60fa0b1f5c9afbd88af12e87b`** by a *concurrent
> Worker 2* discharging the two §7 rows `DISPATCHER_STATE.md` records as owed (`a42845f`,
> `f9774f8`). That delta is **documentation only** — `BUILD_SPEC_CanvasV2.md` and
> `DISPATCHER_STATE.md`, no `plugin/src/**`, no build input — so it cannot reach the bundle and
> WP69 AC2's "before" hash stands. Rule 4: "pre-existing" in this batch means pre-existing to
> **that baseline**, never to any WP's own diff. No WP establishes staleness by stashing its own
> edits.
>
> **Suite baseline, measured at `f9774f8` with no B9b test file yet collected: 1833 collected /
> 1833 passed / 0 failed / 299 files.** The collected file list is preserved so a later count is
> reconciled file by file, not by arithmetic.
>
> ⚠ **More than one agent is writing to this repository during B9b.** Every checkpoint commit uses
> explicit path staging. `git add -A` would sweep up Worker 2's concurrent §7 work.

**WPs, in the only permitted execution order:** WP69 → WP70 → WP50 → WP51 → WP7.

---

## 1. `tools/obsidian_e2e/constants.py` — the rule-10 hazard of this batch

`constants.py` is the single owning module for every pinned value in PHASE T3 (WP43). **Two WPs
in this batch add to it.** They run **sequentially, never concurrently**: WP69 lands and is
committed before WP70's implementer opens the file.

### Block ownership — binding

| Block | Owner | Contents (exhaustive; nothing else) |
|---|---|---|
| `§4.1 — WP69: E2E build mode and bundle install namespace` | **WP69** | the `e2e` build-mode argv token and npm script name; the rig's **own** `main.js` backup path (the vault-side restore point); nothing about the relay, nothing about settings keys |
| `§10 — WP70: local relay and gate settings provisioning` | **WP70** | the relay port, relay host/base-URL form, the run-scoped store directory scheme, the provisioned settings key set and its values |

### Rules that make the ownership real

1. **Append, never edit or reorder.** WP70's implementer may not modify, move, rename or
   re-order one line of WP69's `§4.1` block, and neither may touch any WP43–WP49 block.
2. **`FAILURE_REASONS` is the one genuinely shared structure.** Both WPs need to add named
   reasons to it. The tuple is extended by **appending at the end**, in batch order:
   - WP69's reasons are appended first, in one contiguous run, each with a `# WP69 ACn` comment.
   - WP70's reasons are appended after them, in one contiguous run, each with a `# WP70 ACn`
     comment.
   Neither WP re-orders, re-indents or re-wraps an existing entry. The individual
   `NAME = "NAME"` definitions live in the owner's own block, not in a shared pile.
3. **No literal is spelled twice.** Every port, path fragment, argv token, npm script name and
   settings key appears exactly once, in `constants.py`, and every other module imports it —
   including in docstrings, default arguments, URL strings and error messages.
   **`39421`/`39422` are `HEADLESS_RIG_PORT_A/B` — the mock rig.** Real control is
   `REAL_CONTROL_PORT_A/B` = `39431`/`39432`. The relay port is a **third**, new value, disjoint
   from all four. If any artefact produced by this batch contains `39421` or `39422` in a record
   claiming to satisfy the gate, that record is **void**.
4. **`T3_SharedContract.md` moves with `constants.py`.** `constants.py`'s own header states that
   a value there is transcribed from the contract and that "the fix is to amend the contract and
   this file together — never to shadow it locally". A constant added to one and not the other is
   drift. WP69 amends contract **§4**; WP70 amends contract **§3** (the relay port row), **§4**
   (the provisioned key set) and **§7** (its failure reasons), and adds the relay-lifecycle
   entries. WP70 additionally **corrects §10a**, which today records a deployed relay as an
   option for WP50/WP51: the Dispatcher's binding decision is that **the gate runs against a
   LOCAL relay started and stopped by the rig**; remote operation is a possible future
   **non-gating** matrix case and is not chartered.
   Contract **§11** ("File boundary for this batch (B9a)") is **B9a's** boundary and is a
   historical record — it is not edited, and it is not this batch's boundary. §2 below is.

---

## 2. File boundary for B9b — who may write what

| Path | Owner | Note |
|---|---|---|
| `plugin/esbuild.config.mjs` | **WP69, alone** | the `argv[2]` mode branch only |
| `plugin/package.json` | **WP69, alone** | exactly one added script; every existing script verbatim |
| `tools/obsidian_e2e/install.py` | **WP69, alone** | new |
| `tools/obsidian_e2e/relay.py` | **WP70, alone** | new |
| `tools/obsidian_e2e/ports.py` | **WP70, alone** | one added keyword argument on the modify path; the restore path and the marker's pinned field set are **not** touched |
| `tools/obsidian_e2e/constants.py` | **WP69 then WP70** | §1 above |
| `workflowArtifacts/canvas-v2/T3_SharedContract.md` | **WP69 then WP70** | §1.4 above |
| `plugin/src/testing/e2e-control.ts` | **WP51, alone** | `canvas.setFlag` and its runtime-flag map; WP7 may touch it **only** if the live run reveals a rig defect (its AC1) |
| `tools/MCPserver/liveshare_e2e_mcp_server.py` (**workspace repo**, `h:\My Code\AgenticWorkspace\`) | **WP50, alone** | see §3 |
| `tools/launch_liveshare_e2e.py`, `workflowArtifacts/e2e-infra/E2E_USAGE.md` | **WP7, alone** | self-identification / gate documentation |

**Out of bounds for every WP in this batch:** `server/**` (BUILD_SPEC §7 makes an edit outside
WP41 an **abort criterion** — the relay-binds-on-all-interfaces issue at `server/src/index.ts:236`
is **recorded and accepted for this run**, not repaired); `plugin/src/**` other than
`src/testing/e2e-control.ts`; `plugin/manifest.json` (broken symlink — neither read nor edited);
`%APPDATA%\obsidian\obsidian.json` (read-only, S3 — including its stray third registration, which
is user state); the owner's own plugin-dir backups `main.js.bak`, `main.js.0.5.9.bak`,
`manifest.json.bak` (never written, moved, renamed, deleted, or used as a restore point);
`docker/`, `deploy/`, any `.env`, any secret.

---

## 3. Cross-repo note — WP50's target does not live in this repository

`TaskCharter_WP50` names `tools/MCPserver/liveshare_e2e_mcp_server.py`. That path **does not
exist in this repository**. The file is
`h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` — the *workspace* repo,
which is a different git repository on a different branch. Consequences, binding:

- WP50's implementer edits the **workspace** copy, and the change is committed to the workspace
  repo, not to this one. The project repo's checkpoint commits must not attempt to stage it.
- The MCP driver is reached through the proxy as
  `mcp_execute_tool(server_id="liveshare-e2e", tool_name=…)`. It is registered `alwaysOn:false`,
  `lazy_load:true`.
- Nothing else in B9b crosses the repo boundary.

---

## 4. Credentials — absolute, no exception in this batch

`data.json` in both vaults holds **live credentials**: `encryptionPassphrase`, `encryptionSalt`,
`jwt`, `serverPassword`, `token`. No byte of either file, and no value read from either file, is
ever printed, logged, echoed into a report, handover, run record, commit message or error
message, or placed in a fixture. **Comparison is sha256-of-bytes only.**

Independent post-teardown restore baselines (`T3_PREFLIGHT.md`, taken before any gate work — the
rig did not produce them, which is the point):

| Vault | sha256 of `data.json` |
|---|---|
| `H:\Developement\_NeuralAngels\ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` |
| `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` |

The two hashes **differ**, which is correct — per-vault identity keys. They are never
"converged". The room token WP70 mints is not the owner's credential but it **is** a credential:
it lives in memory and in the provisioned file and is never printed either.

---

## 5. The data-safety precondition that gates the whole batch

Verified in the current tree and measured on this host:

```
manifest.ts:445   if (!this.settings.sharedFolder) return true;   ← empty ⇒ WHOLE VAULT shared
main.ts:471       guest role → cleanupStaleFiles()
main.ts:523-540   trashFile()s every shared local file absent from the host's manifest
```

**Both vaults currently have `sharedFolder = ""`.** A guest session started before WP70 has
narrowed the shared surface to the rig-owned `_e2e-rig` will trash the owner's files in vault B.

**Binding sequencing rule:** no matrix case, and no session of any kind against either real
vault, may start before WP70's `sharedFolder` narrowing holds. WP70 is a **safety precondition**,
not a convenience. "Expendable for testing" is not "expected to be destroyed": C47 AC3's
before/after vault fingerprint still governs, and a run that changes either vault outside its own
scratch artefacts is a **failed** run regardless of its functional result.

---

## 6. Verification discipline — the reason this project exists

Six distinct classes of "a green test that cannot fail" have been found in this run. The gate is
the worst possible place for a seventh.

- **Rule 11:** a perturbation that changes nothing is a **finding**, not a null result.
- **Rule 9:** a blind pass without an executed, non-zero collected count is **UNVERIFIED**, not a
  pass.
- **No deletion or weakening of any test without a named BUILD_SPEC §7 licence.** None of WP69,
  WP70, WP50, WP51 or WP7 appears on either licence list. An unenumerated deletion, skip, retitle
  or assertion rewrite is an **abort criterion** — escalate rather than edit a test.
- **Nothing in this batch may be reported as observed until it has run.** The gate has never run:
  no control endpoint has ever answered on this host, no E2E bundle has ever been built or
  installed, no relay has ever been started by any rig module, and no propagation between the two
  vaults has ever been observed.

---

## 7. WP69 AC2 — the measurement that had to be taken first, and was

WP69 AC2 requires the production `npm run build` sha256 from **before** the config change, and it
is only meaningful on a quiet tree. It was taken as the batch's first action, before any file in
this batch was edited:

| | |
|---|---|
| commit | `fcb229523d90d13b676059b8533ef1be6405a7de` |
| dirty entries at measurement | **0** |
| command | `npm run build` in `plugin/` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`), exit 0 |
| `plugin/main.js` sha256 | `58fda6f8a9f2534fb4c4d08d4b45ac3c4db6bfc8bd06b47ba84899e9f23946bc` |
| `plugin/main.js` size | 759 892 bytes |
| `__LS_E2E__` occurrences | **0** |

`plugin/main.js` is git-ignored (`.gitignore:10`), so producing it did not dirty the tree.

**Note for any reader comparing against `T3_PREFLIGHT.md`:** the *installed* bundles in both
vaults are 626 711 bytes, dated 2026-07-26. That is a different, older build of a different source
tree — it is **not** a discrepancy with the 759 892 bytes above, and it is not the comparand.
WP69 AC2's invariant is *before-vs-after of the config change on this tree*, and nothing else.
