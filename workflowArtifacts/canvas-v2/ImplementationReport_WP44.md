# Implementation Report — WP44
Attempt: 1 (+ attempt 2 robustness pass, see below)

> **Provenance note.** WP44's coder sub-agent completed the implementation and reported its
> visible suite green (59/59) but was terminated by an account spend limit before it could write
> this report or advance the charter. This report was reconstructed by **Worker 3 Core** from the
> code on disk and from independently re-run test evidence — every number below was measured by
> Worker 3 Core directly, not carried over from the terminated agent.

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — port provisioned via the per-vault persisted setting, never `process.env`; reason recorded at the provisioning site (D14) | DONE | Provisioning writes the hidden loose `e2eControlPort` key into `<vault>/.obsidian/plugins/live-share/data.json`. The D14 rationale is recorded in `plugin/src/testing/e2e-control.ts` (4 textual matches): Obsidian is single-instance, a second vault is a second renderer window in the same process tree, so `process.env.LIVESHARE_E2E` would hand both plugin instances the same port; `data.json` lives inside the vault and is the only channel that can differ between roles A and B. |
| AC2 — prior settings captured and restored **byte-exactly**, including the no-prior-file case | DONE | Capture is raw-bytes; restore writes those bytes back verbatim and does **not** depend on the modify path. Verified against tab indentation, CRLF line endings, trailing-newline presence/absence, unusual key order and non-ASCII — all of which a `json.load`/`json.dump` round-trip destroys. Restore is verified by sha256 **and** exact byte length; a mismatch reports `SETTINGS_RESTORE_MISMATCH`. When no settings file existed beforehand, teardown leaves **no file behind at all** — not an empty file, not `{}`. |
| AC3 — idempotent; exactly one saved original; an earlier crashed run's original still restorable | DONE | Provisioning twice yields the same state and exactly one backup, and that backup is the **pre-first-provision** content — never the already-provisioned state. A backup left by an earlier crashed run is never overwritten by the current state; that case is handled deliberately as `PROVISION_CONFLICT`. |
| AC4 — `resolvePort` keeps its precedence, gains no new dependency; an unprovisioned vault starts no server | DONE | `resolvePort`'s logic, precedence and signature are unchanged: numeric `LIVESHARE_E2E` → loose `e2eControlPort` setting → truthy-non-numeric env → ephemeral `0` → otherwise `null` (server never listens). The only change to that file for WP44 is the D14 comment. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| none | — | — |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| none | — | — |

## Changes Made

- **Created** `tools/obsidian_e2e/ports.py` — per-vault control-port provisioning, byte-exact
  capture/restore, provisioning marker, idempotence and crash-recovery handling.
- **Modified** `plugin/src/testing/e2e-control.ts` — **comment only**, recording the D14
  rationale at the provisioning site. No logic, precedence or signature change.

No constant owned by `tools/obsidian_e2e/constants.py` (WP43) was redefined: `SETTINGS_PORT_KEY`,
`PLUGIN_ID`, `PLUGIN_DIR_REL`, `PLUGIN_DATA_REL`, `COMMUNITY_PLUGINS_REL`, `SETTINGS_BACKUP_REL`,
`PROVISION_MARKER_REL`, `PROVISION_MARKER_FIELDS`, `REAL_CONTROL_PORT_A/B`,
`SETTINGS_RESTORE_MISMATCH`, `PROVISION_CONFLICT` and `new_run_id()` are all imported.

## Test Results (re-measured by Worker 3 Core)

| Test Set | Tests | PASS | FAIL |
|---|---|---|---|
| visible | — | all | 0 |
| blind_set1 | — | all | 0 |
| blind_set2 | — | all | 0 |
| **WP44 total, all three sets** | **212** | **212** | **0** |

Command: `python -m pytest workflowArtifacts/canvas-v2/tests/{visible,blind_set1,blind_set2}/WP44 -q`
run from the repo root. WP44 required **no** fixes in the batch-wide attempt-2 robustness pass —
it was green on both blind sets on the first attempt, one of only two WPs in the batch to be so.

## Data Safety

- No write of any kind occurred inside `H:\Developement\_NeuralAngels\ObsidianOrga` or
  `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie`, nor inside `%APPDATA%\obsidian\`. All
  testing ran against fixture vaults under pytest `tmp_path`.
- The real `data.json` files contain **live production credentials** (`serverPassword`, `token`,
  `jwt`). No settings-file content was printed, logged, echoed into this report, or written into
  any fixture. Fixture settings files contain obviously-fake values.
- All settings comparisons use **sha256 of bytes** plus byte length. The provisioning marker
  records `originalSha256` — never the original content.
- Confirmed by the batch's before/after vault fingerprint: both vaults byte-identical, 0 files
  added, removed or changed.

## Summary for Worker 3

`ports.py` provisions each role's control port through the vault's own persisted plugin settings
rather than a process environment variable, which is the only channel that can differ between two
vault windows sharing one Obsidian process (D14). The safety-critical half is the restore path:
the prior file is captured as raw bytes and written back verbatim, so formatting artefacts that a
JSON round-trip would silently destroy survive intact, and the restore is *verified* by digest and
length rather than assumed. Provisioning is idempotent and crash-aware — an original saved by a
run that died is still the original on the next run, never overwritten by the already-provisioned
state, which is the property that stops a crashed run from permanently rewriting the owner's
settings. `resolvePort` was deliberately left untouched apart from the D14 comment.

Rough edge worth knowing: WP44's byte-exact restore was specified as a hard acceptance criterion
when the vaults were still treated as untouchable. The owner has since released both vaults for
unrestricted testing, which downgrades this to good hygiene — but the machinery is exactly what
lets batch B9b install an instrumented dev build into `.obsidian/plugins/live-share/` and put the
directory back as it found it, so it should be used there rather than bypassed.

### Knowledge Signals
Captured via `KC_SubagentTail` during the original implementation run.
