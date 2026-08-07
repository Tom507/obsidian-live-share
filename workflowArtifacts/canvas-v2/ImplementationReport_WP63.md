# Implementation Report — WP63

Attempt: 1
Charter: `TaskCharter_WP63_NonDestructiveSeedBoundary.md`
Invariant: **I11 — REFUSAL NEVER DESTROYS**

## Status: DONE

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — a seed refusal withholds the file write for that path; the file stays byte-identical; `SEED REFUSED:` names path, id and reason | DONE | Guard sits in `CanvasPersistence.flushToDisk`, ahead of `serializeCanvas`. Covered for BOTH boundaries: cold-open seed (writer-owned ledger) and host seed (ledger shared with `CanvasSync`). |
| AC2 — per path and non-fatal (I5 DEGRADE) | DONE | The refused set is per path. A withheld flush resolves normally (no throw), the observer/debounce/CRDT keep running, remote deltas still land, unrelated canvases persist untouched. |
| AC3 — lifts automatically when the refused set empties; first write after the lift is the ordinary canonical projection; distinct signature | DONE | Lift is re-checked on **every write attempt** (same trigger as the write, never a timer). `SEED RESTORED:` on lift. |
| AC4 — discrimination: disarmed → the record is removed from the file; armed → byte-identical | DONE | Oracle is **file bytes before vs. after a real flush**, on both the cold-open and the host composition. Disarmed leg asserts the loss positively and that the write really landed. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| — | — | — |

## Tools Created

| Tool | Type | Purpose |
|---|---|---|
| — | — | — |

---

## Changes Made

**Production (both files named in charter §6):**

- `plugin/src/files/canvas-sync.ts`
  - `IngestAdmission` gains `reason?: IngestReasonCode` — the refusal as data next to the sentence, so the withhold never re-parses a signature.
  - New WP63 section: `SeedRefusal` (boundary/kind/id/reason), `SeedRefusalLedger` (per-path refused set: `note` / `reset` / `hasRefusals` / `list` / `describe` / `prune`), and `isSeedRefusalResolved(doc, refusal)` — the lift predicate, which re-asks the **same gate** on the record as the doc holds it.
  - `seedRecordsIntoYMaps(doc, data, seedOrigin, refusalsOut?)` — optional 4th out-param; existing callers are unchanged.
  - `CanvasSync`: per-path `seedRefusalLedgers`, public `seedRefusalLedger(rawPath)`, host seed (`applyCanvasToYMaps` / `seedFlatSpace`) now resets the path's ledger and records its refusals; `unsubscribe`/`destroy` release the *reference* (never `reset()` — a live writer must stay withheld).
- `plugin/src/files/canvas-persistence.ts`
  - `CanvasPersistenceOpts.seedRefusals` (shared ledger; defaults to a private one) and `CanvasPersistenceOpts.withholdOnSeedRefusal` (BUILD_SPEC §8 discrimination seam, **default `true`**, no production caller).
  - `flushToDisk` calls `writeIsWithheld()` **before** `serializeCanvas`, so `lastQueuedContent` never advances past an unwritten snapshot.
  - `writeIsWithheld()` — prunes resolved refusals (AC3), emits `SEED RESTORED:` on the lift, `SEED REFUSED:` at warn on arming/change and at debug on every subsequent withheld flush (never silent, never spam).
  - Public `isWriteWithheld()` and `seedRefusals()` — the degraded state is observable.
  - `seedDocFromCanvasData` resets the ledger before a re-seed and records the cold-open refusals.
- `plugin/src/main.ts` — **wiring only, one option**: `seedRefusals: this.canvasSync?.seedRefusalLedger(canonical)`.

**Tests (new, none modified, none deleted/skipped):**

- `plugin/src/__tests__/v2/wp63/harness.ts` — in-memory `PersistenceIO` whose `files` map is the disk, plus vault/sync-manager doubles.
- `test_tp01_seed_refusal_withholds_the_write_visible.test.ts` (AC1, both boundaries + a no-refusal control)
- `test_tp02_withhold_is_per_path_and_non_fatal_visible.test.ts` (AC2)
- `test_tp03_withhold_lifts_when_refused_set_empties_visible.test.ts` (AC3 + early-lift negative + re-seed reset)
- `test_tp04_discrimination_seam_visible.test.ts` (AC4, T1–T4)

**Not touched:** `server/`, `docker/`, `deploy/`, `manifest.json`, `package.json`, `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-registers.ts`, `decodeV2RecordToFlat`, the E3 migration origin/call site, `GEOMETRY_KEYS`, `PROTECTED_KEYS`, the plugin version, and every existing test and fixture. `plugin/main.js` was regenerated only by the mandated `npm run build`.

---

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| tp01 COLD-OPEN seed: a real flush leaves the file byte-identical | PASS | file bytes oracle + `SEED REFUSED:` secondary |
| tp01 HOST seed: refusal reaches the writer through the shared ledger | PASS | real `CanvasSync` + `doc-wins` cold open |
| tp01 no refusal, no withhold | PASS | control |
| tp02 a refusal on one path never suspends another | PASS | per-path |
| tp02 the withheld canvas keeps syncing; no flush ever throws | PASS | I5 DEGRADE |
| tp03 once repaired, the next write is the ordinary projection | PASS | compared against `serializeCanvas(...)` |
| tp03 a still-invalid record does not lift the withhold | PASS | no early lift |
| tp03 a re-seed resets the refused set | PASS | stale verdict cannot outlive its file |
| tp04 T1 cold-open: armed byte-identical / disarmed deletes | PASS | AC4 |
| tp04 T2 host: armed byte-identical / disarmed deletes | PASS | AC4 on the production composition |
| tp04 T3 the armed mode is the default | PASS | seam cannot ship off |
| tp04 T4 a clean canvas writes under both settings | PASS | the seam is refusal-scoped |

**Suite totals (from `plugin/`, `npm test -- --reporter=dot`, two paired runs):**

- Before: `24 failed | 1235 passed (1259)`
- After: `24 failed | 1247 passed (1271)`
- Failure set **identical** to baseline (`diff` empty). No test changed state GREEN → RED. The 12 new passes are exactly this WP's probes. The `wp5/latency.test.ts` flake did not fire in either run.

**Gates:** `npx tsc --noEmit` clean · `npm run build` PASS.

**AC4 falsification (bytes, cold-open leg):**

```text
withholdOnSeedRefusal=false → BEFORE 182 bytes / AFTER 154 bytes · IDENTICAL: false · contains n-bad: false   ← the record is LOST
withholdOnSeedRefusal=true  → BEFORE 182 bytes / AFTER 182 bytes · IDENTICAL: true  · contains n-bad: true    ← byte-identical
```

Source-level falsification: with `writeIsWithheld()` forced to `return false`, 9 of the 12 WP63 probes fail; the 3 that stay green are exactly the no-refusal control legs, which must be insensitive to the guard. Restored and re-verified green.

---

## Summary for Worker 3

`CanvasPersistence` now refuses to overwrite a `.canvas` file whose path has an outstanding seed refusal. The condition is a property of the path, held in a `SeedRefusalLedger`: the cold-open seed fills the writer's own ledger, and the host seed fills one owned by `CanvasSync` and handed to the writer through `attachCanvasPersistence` (the host seed runs before the writer exists, which is why the ledger is shared rather than writer-private). The guard sits in `flushToDisk` ahead of the serializer, so no refused record is ever re-injected into the projection — the file stays a deterministic projection of the doc, C17 AC3 is untouched, and WP18 AC1 is unchanged: nothing new is admitted.

To trigger it: open a `.canvas` holding a record the ingest gate refuses (e.g. a node with no `type`) and force a flush — the file is left byte-identical and a `SEED REFUSED:` line names the path, each refused id and its reason. Repair the record (a peer delta or a local edit that the capture net ingests) and the next write attempt lifts the withhold, emits `SEED RESTORED:` and writes the ordinary canonical projection.

Rough edges worth naming: the lift predicate is "the doc holds this id and the gate admits it", so a refusal is only resolvable while the record can still appear in the doc. If a user deletes the refused record from the file outright while the session is live, the ledger keeps that path withheld until the path is re-seeded (re-subscribe / new session), because lifting on that case would require the writer to read the file back — which the single-writer design deliberately forbids outside cold open. The charter's stated lift condition is implemented exactly as written; this residual case is flagged for W4 rather than solved by widening the design.

### Knowledge Signals

Load and follow: Maintenance/KC_SubagentTail.md
@Maintenance/KC_SubagentTail.md
