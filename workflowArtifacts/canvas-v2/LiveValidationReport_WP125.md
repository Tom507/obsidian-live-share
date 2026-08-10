# WP125 Live Validation Report

**Date:** 2026-08-10

**Release:** `0.7.1`

**Overall status:** `OPERATOR_RELOAD_REQUIRED`

## Verdict

The WP125 release bundle is independently verified as installed byte-for-byte in authorized vaults A, B, and C. All three manifests report `0.7.1`.

Live validation cannot be claimed. The official real-Obsidian rig and the `liveshare-e2e` control client both found ports `39431`, `39432`, and `39433` closed. Existing Obsidian processes are operator-owned, and the rig had no console backend with which to dispatch owned replacement instances. No process was terminated, restarted, reclaimed, or ambiguously attached.

## Independent installation verification

The following SHA-256 values were recomputed directly from each deployed `.obsidian/plugins/live-share` directory and match `DeploymentReport_WP125.md` exactly in A, B, and C:

| Artifact | Expected and observed SHA-256 |
|---|---|
| `main.js` | `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615` |
| `manifest.json` | `63C1533A72C101BF72AB203E6951F80D74FAE0B734A4405B31D9855E598132E2` |
| `styles.css` | `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453` |

| Vault | Manifest version | Bundle result |
|---|---|---|
| A - `ObsidianOrga` | `0.7.1` | PASS |
| B - `ObsidianOrga - Kopie` | `0.7.1` | PASS |
| C - `ObsidianOrga - W4TestC` | `0.7.1` | PASS |

## Protected-file hash-only audit

`data.json` contents were never opened, printed, parsed, copied, or modified. W4 computed current SHA-256 digests only for all three copies. The deployment report records W3's before/after equality, but intentionally does not contain the exact prior digests. Therefore W4 can confirm current hashability and existence, but cannot independently prove equality to the earlier W3 values. W3's recorded before/after equality remains deployment evidence, not independent W4 evidence.

The named canvas files were also accessed only through `Get-FileHash`; their contents were not read. Current digest inventory:

| Vault and path | Current SHA-256 |
|---|---|
| A `_liveshare-test/SyncTesting.canvas` | `F933F8BF521CEC7B43106685364175AD9C86A87934BC9DDA29AF34FF6955142D` |
| A `_liveshare-test/second-011125.canvas` | `38B1E6E990EB187945D0F88E2C61DD7B09A9E4B09F58CF04BF1A1F7BE6B48362` |
| B `_liveshare-test/second-011125.canvas` | `38B1E6E990EB187945D0F88E2C61DD7B09A9E4B09F58CF04BF1A1F7BE6B48362` |
| C `_liveshare-test/SyncTesting.canvas` | `358244066B3B4D88F56847ABE718BE41380E13C5FDF35F8FA5D5F7BDCA9B8B32` |
| C `_liveshare-test/second-011125.canvas` | `38B1E6E990EB187945D0F88E2C61DD7B09A9E4B09F58CF04BF1A1F7BE6B48362` |

No exact pre-validation canvas oracle was available in the supplied reports, so these values are an inventory rather than an independent unchanged-since-deployment assertion.

## Endpoint and rig evidence

`liveshare-e2e.e2e_connect` was run against A/B and A/C:

| Endpoint | Result |
|---|---|
| A `127.0.0.1:39431` | REFUSED - WinError 10061 |
| B `127.0.0.1:39432` | REFUSED - WinError 10061 |
| C `127.0.0.1:39433` | REFUSED - WinError 10061 |

The official `tools/launch_obsidian_e2e.py` rig was then run in read-only, `--no-reclaim`, plan-only mode for A/B and C:

- A, B, and C are registered vaults.
- Live Share is present, enabled, and E2E-capable in all three.
- Obsidian is already running.
- None of the three endpoints answered.
- The rig classified all three as `planned_mode: launch`, but `console_backend: none` prevented an owned launch.
- `launched_by_rig` was false for every role.
- `terminated` and `stopped_pids` were empty; reclaim was not performed.

Because no real endpoints or gestures were available, no session identity/role check, canvas open/read, structural edit, `reloadCanvasData` exercise, paint/model/doc/file comparison, occluded/background arm, convergence check, separated structural/sweep counters, or live negative control was executed. `LIVE_VALIDATION_PASS` is therefore forbidden.

## Operator reload required

Reload the already-open Obsidian application windows for these exact test vaults so they evaluate the installed `0.7.1` bundle:

- A: `H:\Developement\_NeuralAngels\ObsidianOrga`
- B: `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie`
- C: `H:\Developement\_NeuralAngels\ObsidianOrga - W4TestC`

Use Obsidian's application reload/restart for each window; do not change Live Share settings or credentials. After reload, confirm the three windows correspond to A/B/C and leave them open. W4 can then rerun once ports `39431`, `39432`, and `39433` answer.

## Canvas mutation disclosure

No canvas was opened through the control API and no canvas mutation was performed by this W4 run.
