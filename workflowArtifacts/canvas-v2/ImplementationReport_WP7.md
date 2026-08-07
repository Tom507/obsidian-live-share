# Implementation Report — WP7
Attempt: 1 (assessment only — no coder sub-agent was spawned)

## Status: BLOCKED

WP7 was assessed by Worker 3 Core rather than implemented, because the assessment established that the work package's central acceptance criteria cannot be satisfied in this environment *or* by the rig they name. No sub-agent was spawned, and the rig was deliberately **not** run — see "Why the rig was not simply executed".

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — a two-vault run against a **real Obsidian** executes end to end, recorded with command/environment/outcome | **BLOCKED** | Obsidian is not installed; and the named rig does not drive real Obsidian |
| AC2 — the run demonstrates node move both ways, node create + delete, and a stale-view save producing no revert on the peer | **BLOCKED** | Depends on AC1 |
| AC3 — the gate is documented as a release condition from P0 onward and the "never executed" status is corrected | **BLOCKED** | Cannot honestly correct a "never executed" status to "executed" without AC1 |
| AC4 — the production build still tree-shakes the whole `src/testing/` module out of `main.js` (`__LS_E2E__` false in production) | **PASS** | Verified directly, see below |

## AC4 — verified PASS

After `npm run build` from `plugin/` (which ran `tsc -noEmit -skipLibCheck` + the esbuild production bundle, both clean), the produced `plugin/main.js` was scanned for the testing-module symbols:

| Symbol | Occurrences in production `main.js` |
|---|---|
| `e2e-control` | 0 |
| `__LS_E2E__` | 0 |
| `createE2EControlServer` | 0 |
| `LIVESHARE_E2E` | 0 |
| `e2eControl` | 0 |

The whole `src/testing/` module is tree-shaken out of the production bundle. The rebuild also introduced no diff to the tracked `main.js`.

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| AC1/AC2 — real two-vault Obsidian run | **(1) Environmental:** Obsidian is not installed on this host. Checked `%LOCALAPPDATA%\Obsidian\Obsidian.exe` and `C:\Program Files\Obsidian\Obsidian.exe` specifically, plus a recursive scan of `C:\` and `H:\` to depth 4. No hit. | None — an install is an owner action, not an agent action |
| AC1/AC2 — real two-vault Obsidian run | **(2) Structural, and the decisive one:** `tools/launch_liveshare_e2e.py` is not a real-Obsidian rig and was never intended to be. It bundles the plugin with esbuild, **aliases the `obsidian` import to the mock** (`--alias:obsidian=src/__mocks__/obsidian.ts`), and boots two *lightweight plugin hosts* in one node process against an in-process relay. | None possible within this WP — see below |
| AC3 — document the gate as a release condition | Cannot be honestly written while AC1 is unmet | None |

## Why the rig was not simply executed

The batch instruction was explicit that a genuine blocker should be recorded precisely rather than faked or silently downgraded. Running `python tools/launch_liveshare_e2e.py` would very likely have produced *a* green run — and it would have proven nothing about AC1 or AC2, because the rig never loads real Obsidian. Reporting such a run as satisfying "a two-vault run against a real Obsidian" would have been a false pass on the single most important verification gate in the initiative.

The rig's own usage document (`workflowArtifacts/e2e-infra/E2E_USAGE.md`) states the scope limit directly:

> Scope: the **lightweight plugin host** model (BUILD_SPEC §5 A2) — NOT two full Obsidian instances. Real full-Obsidian orchestration is T3 and out of scope.

So WP7 as chartered asks the existing rig to do precisely what its own build spec deliberately excluded. This is a second, independent spec problem from the WP4 contradiction, and it is not resolvable by fixing the rig "rather than working around it" (WP7 AC1's own instruction), because there is no defect to fix — the rig is behaving as designed.

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| — | — | none |

## Changes Made

None. No production source, test, or rig file was modified by WP7. The only side effect is the regenerated `plugin/main.js` from the `npm run build` quality gate, which is byte-identical to what was already tracked.

## Decision required from Worker 2 / the owner

Either:

- **(a)** Charter the T3 real-Obsidian orchestration rig as its own work package and make WP7 depend on it. Honours CONCEPT_V2 Teil 14's intent that a two-vault run is a mandatory gate from P0 onward, at the cost of new scope; or
- **(b)** Rewrite WP7's ACs to target the lightweight two-host rig that actually exists. Cheap and immediately executable, but a materially weaker gate than Teil 14 intends — and it would leave the R2 verification debt open while appearing to close it.

Until one is chosen, the BUILD_SPEC §7 project-level Definition of Done clause *"a green two-vault E2E run recorded (WP7)"* cannot be honoured as written.

## Summary for Worker 3

WP7 is blocked for two independent reasons, either of which alone would block it: Obsidian is not installed on this host, and the rig named by the charter is by design a mock-backed lightweight-host harness rather than a real-Obsidian one. AC4 was separately verifiable and passes — the production bundle contains none of the `src/testing/` module. The R2 verification debt that this work package exists to discharge remains fully outstanding, and nothing in phase P0 has been validated against a real Obsidian.
