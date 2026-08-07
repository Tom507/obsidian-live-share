# Implementation Report — WP21

Attempt: 1 (+ a follow-up pass on Worker 3 Core's TC6 ruling)

## Status: DONE

All four ACs are met and all six WP21 visible test files are green. The suite's only
remaining failures are the 8 known pre-existing legacy V1 delete-oracle reds.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — `canWriteEntity` + baseline-hold gone; no capture path consults a lock | DONE | `canWriteEntity`, both injected predicates, both setters, the `denied` list and the three call sites are deleted. The echo baseline now advances unconditionally. TC1 (3/3) and TC2 (3/3) green. |
| AC2 — locks still work as UX | DONE | `canvas-presence.ts` untouched (git-clean, TC4 green without regenerating any digest). `LOCK REVERT:`/`revertCanvasNode`, `setOnLocalNodeChange`/`onDiffInferredChange`, deadline pulse, reconnect-reclaim defer and tiebreak all intact. TC3 (3/3) and TC4 green. |
| AC3 — `canWriteCanvasPath` preserved and still consulted | DONE | `setCanWrite((path) => this.canWriteCanvasPath(path))` and `canWrite: (p) => this.canWriteCanvasPath(p)` both survive; the `canWrite` guard in the capture path is untouched. TC5 (4/4) green. |
| AC4 — deleted tests enumerated; no test pins removed behaviour | DONE | Enumeration half: ledger below, all 8 named. Mechanical half: TC6 (3/3) green after Worker 3 Core corrected its predicate's polarity false positive — see **TC6 polarity correction**. |

---

## DELETION LEDGER (mandatory — AC4)

All 8 pre-authorised deletions were made, and only those 8. Line numbers are the
**pre-deletion** numbers from the authorisation table.

| # | File | Line | Test title | Why it pinned removed behaviour |
|---|---|---|---|---|
| 1 | `plugin/src/__tests__/canvas-sync.test.ts` | 481 | `canWriteNode=false drops a local node edit in the diff path` | Injects `setCanWriteNode` and asserts the node upsert is dropped — the removed node call site of `canWriteEntity`. |
| 2 | `plugin/src/__tests__/canvas-sync.test.ts` | 499 | `canWriteNode=false drops a brand-new local node` | Injects `setCanWriteNode` and asserts a brand-new record never reaches the doc — same removed gate on the create branch. |
| 3 | `plugin/src/__tests__/canvas-sync.test.ts` | 515 | `canDeleteNode=false blocks a local delete of a peer-held node` | Injects `setCanDeleteNode` and asserts a local delete is dropped — the removed delete call site. |
| 4 | `plugin/src/__tests__/canvas-sync.test.ts` | 560 | `drops an un-flushed local edit when a remote peer holds the node (US5 AC2)` | Injects `setCanWriteNode` and asserts the local edit is discarded in favour of the holder's value — the removed write denial. |
| 5 | `plugin/src/__tests__/canvas-sync.test.ts` | 774 | `edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)` | Injects `setCanWriteNode` and asserts the `LOCK DENIED:` emitter fires for `e1` — the removed both-endpoints edge gate. |
| 6 | `plugin/src/__tests__/canvas-sync.test.ts` | 849 | `a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)` | The baseline-hold-on-denial test in full: `LOCK DENIED:` counts, `lastWrittenContent` held across two passes, then released when the gate is re-opened. |
| 7 | `plugin/src/__tests__/canvas-sync.test.ts` | 1142 | `the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords` | Wires both removed setters from real `CanvasPresence` instances and asserts the loser's write is denied, its baseline held, and one `LOCK DENIED:` line emitted. |
| 8 | `plugin/src/__tests__/w4-canvas-integrity.test.ts` | 1228 | `G1 an edge whose ENDPOINT a peer holds is not written, and the baseline is HELD` | Injects `setCanWriteNode`, asserts the edge write is withheld, `LOCK DENIED:` fires, the baseline is held across an idempotent second pass, and the edit lands only after the gate re-opens. |

### Collateral removals (dead-only, no test behaviour)

| File | What | Why |
|---|---|---|
| `canvas-sync.test.ts` (old `1137–1153`) | `describe("CanvasSync + CanvasPresence loser-revert (US2 AC9)")` | Became empty after deletion #7 — removed as instructed. |
| `canvas-sync.test.ts` (old `1093–1135`) | The `WP4 — GAP-1 loser-revert seam` section header comment and the `makeAwarenessNetwork()` helper | Both existed **solely** for deletion #7. Verified by search: `makeAwarenessNetwork` had exactly one caller, and `CanvasPresence` / `AwarenessLike` were referenced only inside the deleted block. |
| `canvas-sync.test.ts:5` | `import { type AwarenessLike, CanvasPresence } from "../canvas/canvas-presence";` | Became unreferenced with the block above. |
| `canvas-sync.ts:70` | `getRecordFields` import | Its only two call sites were the `previous` reads feeding `canWriteEntity`. |

### No 9th test was deleted

Nothing outside the 8 authorised deletions (and the dead-only collateral above) was
removed, skipped, `.only`'d, retitled, weakened or softened. `canvas-sync.test.ts:791`
(`edge write is allowed while both endpoint nodes are free`) is **byte-untouched,
including its line 803**, as ruled.

---

## Corrections to Worker 3 Core's authorisation table

Two points where the survey table did not match the corpus. Both were escalated
rather than resolved unilaterally; Worker 3 Core has since ruled on both.

### 1. `w4-canvas-integrity.test.ts:1215`'s `describe` does **not** become empty

The table stated that the `describe` at `w4-canvas-integrity.test.ts:1215`
(`W4 L4 — WP4 lock seam and baseline hold`) becomes empty after deletion #8 and
should be removed. **It does not.** That `describe` also contains `G2`, `G3`, `G4`
and `G5` (per-key merge, remote delete-wins, `MAX_WAIT_MS` cap, dangling-edge prune)
plus the shared `lockFixture()` helper all four use.

**I deleted only G1** and left the `describe`, its helper and its four surviving
tests intact. I also left the `describe` **title** unchanged — retitling would be an
amendment, and WP21 is not on the licensed-amendment list. Worker 3 Core has
confirmed the table was wrong and this handling was right.

### 2. TC6 had a polarity false positive on the ruling-protected line — corrected

Worker 3 Core's Ruling 1 protects `canvas-sync.test.ts:791` **including line 803**:

```ts
expect(warns.filter((m) => m.startsWith("LOCK DENIED:"))).toHaveLength(0);
```

TC6's original scan matched the literal substring `LOCK DENIED:` regardless of what
the assertion claimed, so it condemned that line and stayed red at exactly one
offender. I escalated rather than delete an unenumerated test or amend an assertion
without a licence.

**Ruling: the defect was in TC6, not in the protected line, and TC6 — authored by
Worker 3 Core's own Unit Test Sub-Agent in this batch — was theirs to refine.** AC4
forbids a test "asserting a behaviour that no longer exists"; line 803 asserts the
signature occurs **zero** times, which is an *absence* claim that WP21 makes
permanently and structurally true. It states the removal rather than pinning it.
Ruling 1 stands unchanged and the line remains byte-untouched.

**What I changed (predicate refinement only — no deletion, no test-count change).**
See **TC6 polarity correction** below.

---

## TC6 polarity correction

`plugin/src/__tests__/v2/wp21/test_tp06_no_test_pins_removed_denial_visible.test.ts`,
plus its two blind counterparts. Still 3 `it` blocks each; **no test was added or
removed**, so the suite count is unchanged.

### The corrected predicate — two halves, because the two residues are not alike

**Half 1 — removed SYMBOLS. Exact, unforgiving, no exemptions.**
`\bsetCanWriteNode\b`, `\bsetCanDeleteNode\b`, `\bcanWriteEntity\b`, `\.denied\b`.
These name code that no longer exists, so no assertion form makes them legitimate.
This half is now *stronger* than before: the old patterns were `.`-anchored
(`\.setCanWriteNode\s*\(`) and so missed a bare mention, a comment or a
`cs["setCanWriteNode"](…)` bracket call. All four now bite anywhere in the file.

**Half 2 — the `LOCK DENIED:` SIGNATURE, read by POLARITY.**

- A **positive** claim (`toHaveLength(n>0)`, `toContain`, `toMatch`, `toBe(true)`,
  `toBeGreaterThan`, …) pins removed behaviour → **offender**.
- An **absence** claim (`toHaveLength(0)`, `toEqual([])`, `toBe(false)`, `.not.…`,
  `toBeUndefined`, `toBeFalsy`) states the removal → **not flagged**.

Three properties of this half were deliberate, and each answers one of the ruling's
"do not weaken it" constraints:

1. **The `LOCK DENIED:` half was kept, not deleted.** It still catches every positive
   form; only the polarity classification is new.
2. **No filename, path or line-number exemption anywhere.** The predicate is about
   *what the assertion claims*, never *where it lives*, so `canvas-sync.test.ts`
   remains fully visible to the scan and a real future offender in that same file is
   still caught.
3. **Fail-closed, not allow-listed.** An occurrence is an offender **by default** and
   is exonerated only by an explicitly recognised absence form. An assertion shape
   nobody anticipated stays red rather than slipping through silently. *(This is a
   deliberate strengthening of the ruling's wording — the ruling described half 2 as
   "flag a positive expectation"; matching positives would have failed **open** on an
   unrecognised shape. Same required outcome, strictly harder to slip past.)*
4. **Assertions are matched as paren-balanced UNITS, not lines.** This repo writes
   annotated assertions across four lines, and the deleted G1 was exactly that shape:

   ```ts
   expect(
     t.warns.some((m) => m.startsWith("LOCK DENIED:")),
     "the baseline advanced — the divergence became invisible",
   ).toBe(true);
   ```

   A line-local classifier never sees the `toBe(true)` that makes this an offender.
   A `LOCK DENIED:` occurrence inside **no** assertion at all (a harvesting helper)
   is also flagged — fail-closed, since such a helper exists only to feed one.

### Blind counterparts

| File | Change | Angle preserved |
|---|---|---|
| `blind_set1/WP21/test_tp06_…_blind1.test.ts` | Same polarity rule, same fail-closed exemption, same paren-balanced assertion units. `\bdenied\b` tightened to `\.denied\b`; `canWriteEntity` added; `baseline …HELD` kept unconditional (a HELD-baseline claim is positive under any polarity). Its third `it` now pins **both** directions via `MUST_BITE` and `SURVIVORS`. | Unchanged — blind1 still hunts by the **CLAIM** an assertion makes (held baseline, `denied` list, signature), not by the setter it calls. |
| `blind_set2/WP21/test_tp06_…_blind2.test.ts` | **No predicate change was needed** — and that is a finding, not an omission. blind2's oracle is **reachability** (does the setter a test calls still exist on `CanvasSync`?), and an assertion about a log line calls nothing, so the absence form is *structurally* out of range rather than exempted. I added explicit pins proving that immunity in both polarities, plus one proving the removed setter is still caught, so the property is demonstrated rather than assumed and the file states the corrected contract in the same terms as its counterparts. | Unchanged — blind2 still asks the **class** what it exposes, not the corpus what it says. |

Both blind files were copied into `src/__tests__/v2/wp21/`, run green (3/3 each), and
removed again; the tree was verified clean afterwards.

---

## No-surviving-caller proof

Every search was run over `plugin/src` **and** `server/src`, excluding only
`__tests__/v2/wp21/` (WP21's own files name the removed symbols deliberately, to
assert their absence). Type-checking was **not** relied on as the oracle — `tsc` is
reported separately below.

| Symbol / signature searched | Command | Result |
|---|---|---|
| `canWriteEntity` | `grep -rn canWriteEntity plugin/src server/src` | **0 hits** — gone from code *and* from comments (TC1 scans the raw source, not the comment-stripped source, for this name). |
| `setCanWriteNode` | `grep -rn setCanWriteNode plugin/src server/src` | **0 hits.** |
| `setCanDeleteNode` | `grep -rn setCanDeleteNode plugin/src server/src` | **0 hits.** |
| `LOCK DENIED` | `grep -rn "LOCK DENIED" plugin/src server/src` | **1 hit** — `canvas-sync.test.ts:698`, the ruling-protected **absence** assertion. **0 hits in any non-test source**, i.e. the emitter itself is gone and nothing can ever produce the signature again. |
| `applied.denied` / `.denied` | `grep -rn "applied.denied" / "\.denied"` | **0 hits.** |
| `denied` (whole word, in `canvas-sync.ts`) | `grep -n denied src/files/canvas-sync.ts` | **0 hits in code.** One occurrence remains inside a `/** */` block comment that TC1's `codeOf()` strips before matching; reworded anyway so the word is absent. |
| `canWriteNode` / `canDeleteNode` (survivor audit) | `grep -rn "canWriteNode\|canDeleteNode" plugin/src --include=*.ts` (non-test) | **11 hits, all legitimate survivors**: `canvas-presence.ts:361,365` (+ its header comment) — the UX lock's own API, AC2 keeps it; `canvas-binding.ts:56,58,152,153,174,175,270,271` — the frozen binding's own optional options, owned by WP22. **Zero hits in `canvas-sync.ts` and zero in `main.ts`.** |
| `getRecordFields` (orphan check) | `grep -n getRecordFields src/files/canvas-sync.ts` | Both call sites were the `previous` reads feeding the gate; import removed, 0 hits remain. |
| `makeAwarenessNetwork`, `CanvasPresence`, `AwarenessLike` in `canvas-sync.test.ts` | `grep -n` before deleting the collateral block | Each had callers **only** inside the deleted loser-revert block; `applyRemoteCanvasDelta` had 9 other callers and was **kept**. |

`canvas-binding.ts`'s `canWriteNode` / `canDeleteNode` options are declared `?:` with
`?? (() => true)` defaults, so dropping main.ts's two mirrors is type-safe and
behaviour-preserving for the (still `false`) `useCanvasBinding` path.

---

## Changes Made

### `plugin/src/files/canvas-sync.ts`

- Deleted the private `canWriteEntity(...)` method entirely, replaced by a comment
  explaining that the seam is removed and why there is no replacement.
- Deleted the `canWriteNode` / `canDeleteNode` private fields and their
  `setCanWriteNode` / `setCanDeleteNode` setters.
- Deleted `AppliedIntent.denied` and its initialiser in `applyIntentPlan`.
- **Call site 1 (node/edge upsert):** removed the `opts` object, the `previous`
  shadow read and the `canWriteEntity` guard. `onLocalNodeChange` (the UX lock
  claim) is untouched and still fires for every node group.
- **Call site 2 (node delete):** removed the `canDeleteNode` guard; the branch now
  only records the node id for the GAP-5 cascade/telemetry.
- **Call site 3 (edge delete):** removed the `previous` read and the
  `canWriteEntity` guard; the `if/else` collapsed to
  `if (del.kind === "node") applied.deletedNodeIds.push(del.id);` with both kinds
  falling through to the unchanged `applyTombstoneOp` (WP19 contract intact).
- **Baseline hold:** the `if (applied.denied.length > 0) { warn("LOCK DENIED: …") }
  else { lastWrittenContent.set(...) }` branch is now an unconditional
  `this.lastWrittenContent.set(path, content);`.
- Removed the now-unused `getRecordFields` import.
- `applyIntentPlan`'s `saved: SaveIndex` parameter became dead (its only reader was
  the gate) and was dropped, along with the argument at the single call site.
- Comments that named the removed seam were rewritten, not left as stale prose.

### `plugin/src/main.ts` (wiring only — no logic added)

- Removed the `setCanWriteNode(...)` and `setCanDeleteNode(...)` injections
  (old `:800–807`).
- Removed the binding-side mirrors `canWriteNode:` / `canDeleteNode:` from the
  `new CanvasBinding(...)` options (old `:1312–1313`).
- **Kept, verbatim:** `setCanWrite((path) => this.canWriteCanvasPath(path))`,
  `canWrite: (p) => this.canWriteCanvasPath(p)`, `setOnLocalNodeChange(...)`,
  `canWriteCanvasPath` itself (incl. `minimatch`), `revertCanvasNode` and the
  `onRevert:` wiring, `onReconnect`, `setSurfaceStateProvider`.

### Test files

The 8 deletions + collateral above. **Nothing else.**

### Not touched

`canvas-presence.ts` (git-clean, byte-identical), `canvas-binding.ts`,
`canvas-model-bridge.ts`, `server/`, `docker/`, `deploy/`, `plugin/main.js`,
`plugin/manifest.json`, `package.json`. No version bump. No new dependency.
`GEOMETRY_KEYS` unchanged and still exported.

---

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_write_gate_seam_removed_visible` | **PASS** (3/3) | Was RED (3 failing). Instance + prototype absence, source scan of both files, and all five over-deletion neighbour assertions. |
| TC2 `test_tp02_peer_lock_does_not_deny_local_write_visible` | **PASS** (3/3) | Was RED (3 failing). Node upsert, edge re-route and node delete all land while two real `CanvasPresence` peers hold the record; baseline advances in all three; zero `LOCK DENIED:`; UX lock still held afterwards. |
| TC3 `test_tp03_lock_ux_rings_and_view_revert_visible` | **PASS** (3/3) | Preservation — still green. |
| TC4 `test_tp04_awareness_liveness_unchanged_visible` | **PASS** | Preservation — still green. `canvas-presence.ts` byte-identical; **no digest was regenerated**. |
| TC5 `test_tp05_read_only_permission_still_refuses_visible` | **PASS** (4/4) | Preservation — still green. |
| TC6 `test_tp06_no_test_pins_removed_denial_visible` | **PASS** (3/3) | Was RED. Green after the polarity correction; still 3 `it` blocks, offender list empty. |

---

## Falsification Results

| AC | Mutation applied | Test that went RED | Restored green? |
|---|---|---|---|
| AC3 (read-only permission is load-bearing) | `canvas-sync.ts:1921` — neutralised the real capture-path guard: `if (!this.canWrite(path)) return;` → `if (!this.canWrite(path)) { /* MUTANT */ }` | TC5: `a globally read-only client still cannot push a local canvas edit` **and** `a guest is refused inside a host-designated read-only glob and allowed outside it` (2 of 4) | Yes — 4/4 after restore. |
| AC2 (the UX lock claim beside the deleted gate is load-bearing) | `canvas-sync.ts:2151` — removed the diff-inferred claim: `if (kind === "node") this.onLocalNodeChange?.(path, id);` → comment | TC3: `the diff-inferred lock claim still fires from a local save` | Yes — 3/3 after restore. |
| AC2 (the view-revert path is load-bearing) | `main.ts` — renamed `revertCanvasNode` → `revertCanvasNodeMUTANT` | TC1: `main.ts wires no per-node lock gate on either capture path` (its `revertCanvasNode` survival assertion) | Yes — restored, TC1 3/3. |
| AC4 (the corrected TC6 still bites a POSITIVE claim) | Scratch file `src/__tests__/_scratch/positive_signature.test.ts` containing a **multi-line** `expect(\n warns.some(m => m.startsWith("LOCK DENIED:")),\n "…",\n).toBe(true);` | TC6: `no test file outside WP21 still reaches for the removed lock write-denial seam` → offender `_scratch/positive_signature.test.ts:6 — asserts the removed denial signature IS emitted` | Yes — scratch removed, TC6 3/3. |
| AC4 (the corrected TC6 still bites a REMOVED SYMBOL) | Scratch file `src/__tests__/_scratch/removed_symbols.test.ts` re-introducing `setCanWriteNode` (call **and** bare mention), a `canWriteEntity` reference **inside a comment**, and `applied.denied` | TC6: same test → **4** offenders, one per symbol pattern, at lines 4, 5, 6 and 8 | Yes — scratch removed, TC6 3/3. |
| AC4 (the corrected TC6 does NOT bite an ABSENCE claim) | None — the untouched `canvas-sync.test.ts:698` `toHaveLength(0)` left in place as the only `LOCK DENIED:` occurrence in the tree | TC6 **GREEN**, offender list `[]` | n/a — this is the target state. |

**Note on the TC3 falsification.** TC3's *view-revert* half is driven by
`canvas-presence.ts`, which is a hard invariant I may not modify, and its `onRevert`
is a fixture mirror of `main.ts::revertCanvasNode`, not a call into it. No mutation
inside my blast radius can falsify that half. I therefore falsified the part of TC3
that TC3's own charter entry names as "the likeliest casualty" — the
`setOnLocalNodeChange` → `onDiffInferredChange` claim, which sits immediately beside
the deleted gate — and covered `revertCanvasNode`'s survival via TC1 instead.
`canvas-presence.ts` was never edited, not even transiently.

---

## Full-suite gate

Run from `plugin/`, Vitest 4.0.18, `npm test -- --reporter=dot`.

|  | Test Files | Tests | Failing |
|---|---|---|---|
| **Before** (baseline, this run) | 8 failed / 207 passed (215) | 1293 passed (1308) | **15** |
| **After removal** | 6 failed / 209 passed (215) | 1291 passed (1300) | **9** |
| **After the TC6 polarity correction** | 5 failed / 210 passed (215) | 1292 passed (**1300**) | **8** |

**Test-count delta: −8 overall, fully accounted for** — exactly the 8 enumerated
deletions. No file dropped out of the run (215 files throughout), because both
edited files retain other tests. **The TC6 correction changed the count by 0**
(1300 → 1300): it is a predicate refinement inside 3 existing `it` blocks, not a
deletion and not an addition.

**Failure-set delta: 15 → 9 → 8.** Seven failures cleared: TC1 (3) + TC2 (3) from the
removal, TC6 (1) from the polarity correction. The remaining 8 are exactly the known
pre-existing legacy V1 delete-oracle reds:

- `canvas-sync.test.ts` — `genuine local delete removes the node from the Y map`
- `canvas-sync.test.ts` — `prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)`
- `canvas-sync.test.ts` — `a genuine local DELETE of a whole record is still honoured (protection is per-key only)`
- `w4-canvas-integrity.test.ts` — `A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS`
- `v2/wp4/test_tp01_intent_basis_visible.test.ts` — `T4 …the delete still happens`
- `v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` — `T2 …the same omission is a deletion`
- `v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` — `T3 an interacting record is never handed over…`
- `v2/wp6/chaos_degraded_adapter.test.ts` — `D2 seam advanceFromReceipt(…, { perFieldReceipt: false })…`

This is the target end state: **the only remaining failures are the 8 known
pre-existing reds.** Both files that carry them were edited by me; I verified by name
that the four legacy **delete-oracle** failures in them are byte-identical to their
baseline form and were not among my deletions.

**Scratch-file hygiene.** The two falsification scratch files and the two temporary
blind-set copies were deleted; `find src -name "*blind*" -o -name "_scratch"` returns
nothing and `src/__tests__/v2/wp21/` holds exactly its six `*_visible.test.ts` files.

- `npx tsc --noEmit` → **PASS**, 0 errors.
- `npm run build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`) → **PASS**.

---

## Summary for Worker 3

**WP21 is DONE.** All four ACs met, all six visible test files green, and the suite's
only remaining failures are the 8 known pre-existing legacy V1 delete-oracle reds.
`npx tsc --noEmit` PASS, `npm run build` PASS, test count 1300 (−8 overall, exactly
the enumerated deletions; the TC6 correction moved it by 0).

The removal is complete and clean. `canWriteEntity`, both injected predicates, both
setters, the `denied` list, the baseline-hold and the `LOCK DENIED:` emitter are gone
from `canvas-sync.ts`; the two `main.ts` injections and the two binding-side mirrors
are gone from the wiring. Searches — not `tsc` — prove zero surviving callers in
`plugin/src` and `server/src`. Locks are now pure UX: `canvas-presence.ts` is
byte-identical, the view-revert and the diff-inferred claim still work, and the
liveness machinery is untouched. `canWriteCanvasPath` is preserved and provably still
consulted — a mutation that disables its refusal turns TC5 red.

**On your TC6 ruling.** Applied as directed, and it is now green with 3 `it` blocks
and no test-count change. Two things worth your eye:

1. **I made half 2 fail-closed rather than positive-matching.** Your wording was
   "flag a positive expectation"; matching positives would fail **open** on an
   assertion shape nobody listed. Instead an occurrence is an offender by default and
   only an explicitly recognised *absence* form exonerates it. Same required outcome —
   line 803 spared, every positive form caught — but strictly harder to slip past. Say
   the word if you want the literal positive-matching form instead.
2. **Half 2 is evaluated over paren-balanced assertion UNITS, not lines.** The deleted
   G1 was a four-line `expect(\n …,\n "…",\n).toBe(true);`, which is this repo's house
   style for annotated assertions — a line-local classifier would have gone blind to
   exactly the offender class you most care about. Falsified with a multi-line scratch
   file: TC6 caught it at the right line and went red.

**blind2 needed no predicate change, and that is a finding rather than an omission.**
Its oracle is reachability (does the setter a test calls still exist on the class?),
so an assertion about a log line — of either polarity — is structurally out of range
rather than exempted. I added pins proving that immunity in both directions plus one
proving the removed setter is still caught, so the property is demonstrated and the
file now states the corrected contract in the same terms as its counterparts. blind1
took the full correction, keeping its CLAIM-based angle.

**Authorisation-table correction recorded** under its own heading, as asked:
`w4-canvas-integrity.test.ts:1215`'s `describe` does **not** become empty — G2–G5 and
the shared `lockFixture()` live there. I deleted **only G1** and left the block, its
helper and its title alone.
