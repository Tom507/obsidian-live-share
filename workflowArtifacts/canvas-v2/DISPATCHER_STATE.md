# Dispatcher State — Canvas V2 Atomic Orchestrator Run

> **Purpose:** resumable orchestration state. If the Dispatcher's context is compacted or lost,
> this file plus the BUILD_SPEC and the handovers are sufficient to continue the run.
> **Last updated:** 2026-08-02, during batch B4 (phase P2).

---

## Coordinates

| | |
|---|---|
| Project | `liveshareCollab` (workflow-memory project key) |
| Repo | `h:\My Code\AgenticWorkspace\Projects\_external\liveshareCollab\obsidian-live-share` |
| Real path | `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share` (junction) |
| Branch | `fix-bugs-and-raceconditions` (NOT a default branch — safe to commit) |
| Artifact folder | `workflowArtifacts/canvas-v2/` |
| Authority | `workflowArtifacts/CONCEPT_V2.md` → `canvas-v2/BUILD_SPEC_CanvasV2.md` |
| Workflow | `Coding/Workflows/AtomicAgentOrchestrator/AtomicOrchestratorWorkflow.md` |
| worker4_mode | `full` (BUILD_SPEC §7) |

**Commits so far:** `65fbb44` (V2 work, 870 files) · workspace repo `6440d02` (workflow checkpoints feature).

---

## Standing user decisions (do not re-ask)

- **Commit freely** whenever useful. Now built into the workflow as `commit_checkpoint_every` (default 2).
- **Both Obsidian vaults are free for testing** — `H:\Developement\_NeuralAngels\ObsidianOrga` and
  `…\ObsidianOrga - Kopie`. Nothing important in them; dev-build install permitted.
  Still binding: `data.json` holds live credentials → sha256-compare only, never printed/logged/fixtured.
- **Relay server may be deployed to the NeuralAngels box for testing** (via `ssh-deploy`).
  Constraints stand: compose `name: liveshare`, never `--remove-orphans`, `neural-angels-access`/`n8n` protected,
  no secret through any agent tool.
- **Max two W3/W2 workers in parallel.**
- Build everything from CONCEPT_V2 — nothing deferred, including "optional" P6.

---

## Phase status

| Phase | WPs | State |
|---|---|---|
| P0 — shadow diff + canonical serialization | WP1–WP7 | ✅ done (WP7 gate still unrun — see below) |
| P1 — data model | WP8–WP23 | ✅ done |
| P2 — sidecar / GUID / epoch / import | WP24–WP30 | 🔄 **in flight (batch B4)** |
| P3 — mode consensus, receive-and-persist | WP31–WP35 | ⬜ queued |
| P4 — Y.Text, blur merge, UndoManager | WP36–WP38 | ⬜ queued |
| P5 — op-capture promotion | WP39–WP40, WP52–WP54 | ⬜ queued (gated on the real-Obsidian gate) |
| P6 — relay blob persistence | WP41–WP42 | ✅ done |
| T3 — real-Obsidian rig | WP43–WP49 infra ✅ · WP50, WP51, WP7 ⬜ | infra done, **gate not yet run** |
| PHASE VI — verification integrity | WP55–WP58, WP62, WP64, WP67 | ✅ done |
| Open | WP59 ✅ · WP65 ⬜ · WP66 ⬜ | see queue |

**Chartered total: 67 WPs.**

---

## Immediate queue (in order)

1. **B4 returns** (P2) → commit → then:
2. **WP66** hollow-fixture suite-wide sweep — *held: needs a quiet tree*
3. **WP65** ledger provenance + intermittent register — *held: touches `_run_blind.py`*
4. **B9b — WP50, WP51, WP7** → the real two-vault Obsidian gate.
   **Recommended next after P2**, ahead of P3/P4: every green so far is headless.
5. **B5** P3 (WP31–35) · **B6** P4 (WP36–38)
6. **B7** P5 (WP39–40 + WP52–54) — promotion gated on WP54's `CaptureTriggerLedger.md`
7. **W4** integration & system testing (`worker4_mode = full`)
8. KC routing agents + `consolidate_memory(liveshareCollab)` + final report

---

## Open items that must not be lost

- **`fileOpsManager.onFileRename` leak** — broadcasts a rename over the file-op channel under the same
  either-side gate WP26 fixed; a peer would recreate the move inside its own sidecar directory.
  Real, reachable, outside WP26's charter. **Needs chartering by Worker 2.**
- **Hollow-fixture class** — WP66. Literal grep is a *screen, not an oracle*: `text: ""` is valid,
  `remoteRecord(...)` takes accept-then-quarantine. Scope by measurement, not by the suspected list.
- **WP7 / T3 gate never executed.** Plugin builds in both vaults are production (`__LS_E2E__=false`) and
  cannot host the control server — WP50/WP51 must install a dev build.
- **`wp5/latency.test.ts` RTT flake** — owned by WP65, accepted with a falsifiable threshold
  (>1 failure in 10 consecutive runs, or co-occurrence with another `wp5` assertion, voids acceptance).
- **W4-1**: C46 production-bundle counter-check (confirm `src/testing/` tree-shakes out, else WP60 reopens).

---

## Hard-won rules (apply to every future batch)

1. **A green test may be unable to fail.** Five classes found this run: vacuous blind runner; unfalsifiable
   assertions; oracles vacated by a semantic change; global perturbation that falsely certifies; a prior
   batch's amendment masking a later falsification.
2. **Falsify with a *targeted* injection of the exact class**, confirm the row fails on **its own** pin, and
   record whether neighbouring pre-existing oracles stayed green. Narrow when masked.
3. **Convergence is not correctness.** WP23's fuzzer demonstrated SEC, schema, byte-equality and shadow
   oracles all green over a provably corrupt document; only the **intent-trace** oracle caught it.
4. **Pre-existing means pre-existing to the batch baseline**, not to your own diff.
5. **A ledger row is a measurement, not a timeless fact.** Old rows are not passes.
6. **A cited contract must be re-read, not recalled** — especially after its WP was reopened.
7. **Run the oracle's own extraction** rather than reasoning about whether prose "reads unambiguously".
8. **CRDT assertion trap:** assert a specific value only when it has a single author or a causal predecessor
   chain. Concurrent same-key writes tie-break on `clientID` = `random.uint32()` → ~50% pass rate.
9. **Ledger discipline:** no deletion or weakening without a named §7 licence; every amendment enumerated by
   file · line · why-stale · post-amendment strictness. Blind pass without an executed count = UNVERIFIED.
10. Two agents independently choosing incompatible constants has cost this run a batch. One WP defines,
    the others read.

---

## Measured state (last quiet measurement)

| | |
|---|---|
| Plugin suite | **1470 tests / 1470 pass / 0 fail** (253 files) |
| Server suite | 149 / 149 |
| `tsc --noEmit` | clean |
| `npm run build` | PASS |
| Blind-verification ledger | 58 rows · 58 CONFIRMED · 0 DIVERGENT · 0 VACUOUS |
| Unlicensed deletions, whole run | **0** |

---

## Substantive results

- **The reported corruption cascade is closed at its root** — capture now diffs against the per-field
  surface shadow instead of `lastWrittenContent` (disk), so a stale view can no longer push a revert.
- **Silent `.canvas` data loss found and closed** — side-less edges are legal JSON Canvas, were refused at
  ingest, and were then deleted from the user's file on flush. Closed at three depths (WP10/WP14
  representability, WP17 projection, WP63 invariant **I11 REFUSAL NEVER DESTROYS**).
- **Insertion-order corruption found and closed** — `decodeV2RecordToFlat` resolved flat-vs-register
  collisions by `Y.Map` insertion order; a moved card could snap back with **both replicas agreeing on the
  wrong value**, so byte-equality provably cannot detect it.
- **Manifest sidecar leak found and closed** (WP26) — `renameFile` wrote to the manifest without consulting
  `isSharedPath`, publishing a sidecar key every peer would then hold.

**Not yet true:** nothing has been exercised in real Obsidian. All greens are headless.
