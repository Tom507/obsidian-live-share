# B4 / P2 — Worker 3 running notes

Scratch ledger kept during the batch so nothing is reconstructed from memory at handover time.
Everything here must end up in `Worker3Handover_B4_P2.md`.

---

## Baseline (measured, not quoted)

- Plugin suite before any B4 edit: **1346 passed / 0 failed / 587 suites** (vitest JSON reporter,
  `H:\tmp\liveshare_snap_B4_P2\baseline_b4.json`).
- Snapshot before first edit: `H:\tmp\liveshare_snap_B4_P2\snapshot_pre_B4.tgz`
  (`plugin/src` + `workflowArtifacts/canvas-v2`, 2.7 MB, taken at 10:59).
- Note on units: the baseline figure "587 suites" came from vitest's JSON `numTotalTestSuites`
  (which counts `describe` blocks). `--reporter=dot` reports **test files** (244 at that point).
  Only the pass/fail numbers are comparable across the two reporters.

---

## Per-WP status

| WP | Attempts | Visible | blind1 | blind2 | Status |
|---|---|---|---|---|---|
| WP24 | 1 | 76 / 76 | 67 / 67 | 78 / 78 | DONE |
| WP26 | 3 + 1 doc pass | 46 / 46 | 45 / 45 | 50 / 50 | DONE |
| WP27 | 1 + licensed amendments | 54 / 54 | 41 / 41 | 47 / 47 | DONE |
| WP25 | 1 + fixture repairs | 59 / 59 | 46 / 46 | 47 / 47 | DONE |
| WP28 | 2 | 104 / 104 | 62 / 62 | 67 / 67 | DONE |
| WP27 | — | — | — | — | not started |
| WP25 | — | — | — | — | not started |
| WP28 | — | — | — | — | not started |
| WP29 | — | — | — | — | not started |
| WP30 | — | — | — | — | not started |

---

## Deletion / amendment ledger

**Nothing deleted. No assertion amended. No licence claimed or used.**

**One test file WAS modified — type annotations only. Recorded because two earlier attempt reports
claimed "no test file altered", and that claim is no longer true.**

| File | What changed | Why it is not an amendment |
|---|---|---|
| `plugin/src/__tests__/v2/wp26/test_tp04_sync_from_manifest_visible.test.ts` — the `create`, `createFolder`, `waitForSync` mocks | Parameter **type annotations** added (`_path: string`, `_data: string`). `vi.fn(async () => ({}))` infers a zero-arity mock, so reading `mock.calls[i][0]` did not typecheck — 3 x `TS2493`. | Bodies, return values, call-site arity and every assertion unchanged; `vi.fn` records actual arguments regardless of declared signature; TS types are erased by esbuild, so the **executed program is literally identical**. `git diff` filtered for `expect` / `it(` / `describe(` / `toBe` / `toHaveBeenCalled` / `manifest.set` returns empty. Test counts unchanged (tp04 = 5, WP26 = 46). **Falsification re-verified after the change:** neutralising the `syncFromManifest` guard still reddens 3 of tp04's 5 tests. |

The file was authored **by this batch** (WP26's own unit-test sub-agent), not inherited, so no licence
was required — the §7 licence classes govern removing or rewriting *assertions*, and a compile-time-only
annotation is neither. Logged anyway: an unlogged test-file edit is indistinguishable from a hidden one.

> **Rule adopted batch-wide, to be applied by every remaining WP:**
> **"pre-existing" means pre-existing to the BATCH BASELINE, not to your own diff.** The WP26 coder
> first classified these three `tsc` errors as pre-existing because stashing *its own* edits reproduced
> them — but the batch baseline had a clean `tsc`, and the errors came from this batch's own test agent.
> Measuring staleness against your own edit rather than the baseline is the mistake B3c nearly made with
> the eight delete-oracle reds.

No WP in this batch is on the BUILD_SPEC §7 licensed-deletion list (`WP4, WP18, WP21, WP22, WP33`)
or the licensed-amendment list (`WP10, WP14, WP18, WP19, WP46, WP59, WP60, WP61`). Every WP in this
batch was briefed on that explicitly, and every coder was told to escalate rather than edit a test.

---

## Retry-budget accounting (be precise about this in the handover)

**WP26 used all 3 implementation attempts, plus 1 documentation-conformance pass that did NOT
consume an attempt.** The distinction is real and was declared before the pass ran, not after:

| Pass | What changed | Behaviour delta |
|---|---|---|
| Attempt 1 | initial guard set from the enumerated consumer list | production |
| Attempt 2 | AC1 generalization — found the `renameFile` manifest-writer leak | production |
| Attempt 3 | AC3 comment restructure + 3 test-file type annotations | production diff unchanged from a2 |
| Doc-conformance pass (**out of budget**) | de-named `vault-events.ts` in the contract comment | **executable diff EMPTY** |

The doc pass was necessary because the AC3 blind oracle extracts **every `*.ts` basename anywhere in
the contract comment** with one flat regex and requires each to be a real consumer — it has no notion
of a delimited block or a labelled exception, so attempt 3's (good) structural fix could not satisfy
it while the filename remained. Fix cost one noun: `vault-events.ts` is now named by role ("the VAULT
EVENT ROUTER … the CALLER of this seam"), with an explicit warning against a future editor restoring
the filename. Remaining basenames in the comment: `background-sync.ts` x2, `manifest.ts` x4 (real
consumers), `canvas-sidecar.ts` x2 (owner) — swept mechanically with the oracle's own extraction,
before and after, not by eye.

> **Reusable lesson, and it generalises past WP26:** *structural clarity for a human reader is not the
> same artifact as mechanical extractability.* Where an AC is checked by a regex over prose, run the
> oracle's own extraction before and after the edit instead of reasoning about whether the structure
> "reads unambiguously". The WP26 defect recurred **twice with two different filenames** before this
> was understood.

Deliberately **not** swept: ordinary explanatory comments in `background-sync.ts` (names `main.ts`)
and `manifest.ts` (names `vault-events.ts`). They are not the contract comment, not normative under
AC3 and not read by the oracle; de-naming them would cost clarity for no conformance gain. Recorded
in case a later oracle widens its scope.

---

## ESCALATE_TO_WORKER2 — WP27 amendment licence: **GRANTED and DISCHARGED**

**Ruling (Dispatcher):** M1 and K5 are **stale, not violated**. Amendment licensed for WP27, covering
exactly those two assertions in that one file and nothing else. §7 register entry is **Worker 2's to
write** — Worker 3 did not touch `BUILD_SPEC_CanvasV2.md`.

**Discharged under all five conditions. Enumerated in §7 form in `ImplementationReport_WP27.md`
("Licensed amendments (Dispatcher ruling)").**

| # | File · line | Was | Now | Post-amendment strictness |
|---|---|---|---|---|
| 1 | `w4-canvas-integrity.test.ts:1665` (M1) | `expect(reached, "setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete").toBe(true)` | `expect(reached, "…WP27 AC4's guard is gone").toBe(false)` **+** `expect(guardConsults.filter(c=>c.path===PATH).map(c=>c.verdict)).toEqual([true])` | **Stricter.** A bare `toBe(false)` would also pass if `getDoc` were never called for an unrelated reason (broken harness, renamed method, early return). The added assertion pins the **cause** — that `skipsAutoTextSync` was consulted for that path and returned the skip verdict. Title and message rewritten so neither still claims the hole is open (condition 3). |
| 2 | `w4-canvas-integrity.test.ts:1747` (K5) | same shape, *"CollabManager has NO internal .canvas guard"* | same two-assertion shape; title now *"…HAS an internal .canvas guard — protection no longer relies on main.ts's MarkdownView gate"* | as above |

**Falsification — four runs, every one isolated, no narrowing needed:**

| Perturbation | Result |
|---|---|
| F1 remove `skipsAutoTextSync` guard in `setActiveFile` | **1/46 red — M1 on its own pin** |
| F1b replace the shared predicate with a private `endsWith(".canvas")` | **1/46 red — M1 on the NEW assertion** (`expected [] to deeply equal [true]`); the negative stayed green |
| F2 remove the guard in `activateForFile` | **1/46 red — K5 on its own pin** |
| F2b private copy in `collab.ts` | **1/46 red — K5 on the NEW assertion** |

The `b` variants matter: they prove the *added* guard-consult assertion discriminates independently, so
the amendment did not merely invert a boolean. **No neighbour masking occurred** (the B13/B15 trap) —
each perturbation produced exactly one failure, and all 44 previously-green tests in that file stayed
green throughout. Test count **46 before, 46 after** (condition 2); full-suite total collected unchanged
at 1524, which independently rules out any added or deleted test.

Instrumentation note worth keeping: the guard-consult recorder is a `vi.hoisted` **plain array** fed by a
`vi.mock("../utils")` that delegates to the real `skipsAutoTextSync` — deliberately *not* a `vi.fn`,
because the file-wide `vi.restoreAllMocks()` in `afterEach` would otherwise disarm the oracle mid-file.
That is a live example of a green test that could not fail, avoided by construction.

---

## (superseded, kept for the record) Original escalation text

**This is the case the batch brief anticipated, and the answer was NOT assumed.**

Two pre-existing assertions in `plugin/src/__tests__/w4-canvas-integrity.test.ts` are **inverse
characterisations of WP27 AC4** — they were written by a W4 revalidation pass specifically to *document
that the defect exists*, and AC4 is chartered to fix it. They are now mutually exclusive with the spec:

| # | Location | Assertion | Why it is now unsatisfiable |
|---|---|---|---|
| 1 | `w4-canvas-integrity.test.ts` — `M1` (≈`:1597`) | `expect(reached).toBe(true)` where `reached` = "the unguarded `getDoc` was called with the `.canvas` path". Name: *"setActiveFile acquires a bare-path doc for a .canvas that was never subscribed"*; header calls it *"a SECOND unguarded bare-path getDoc"*. | WP27 AC4 requires that call site to be guarded. Guarded ⇒ `reached === false`. |
| 2 | `w4-canvas-integrity.test.ts` — `K5` (≈`:1666`) | same shape. Name: *"CollabManager has no internal .canvas guard — protection is main.ts's MarkdownView gate"*. | WP27 AC4 requires exactly that internal guard to exist. |

**Attribution verified, not assumed:** the WP27 coder stashed its own diff and re-ran — that file was
**46/46 green before the WP27 change**. So these two reds are caused by WP27 and by nothing else, and
they are not B16's.

**Why no licence was taken.** WP27 is on **neither** §7 list — not the licensed-deletion list
(`WP4, WP18, WP21, WP22, WP33`) nor the licensed-amendment list
(`WP10, WP14, WP18, WP19, WP46, WP59, WP60, WP61`). Both assertions were therefore **left untouched**.
The batch brief was explicit that the licence must not be assumed, and it has not been.

**Requested remedy — invert, do not delete.** These belong to §7's *licensed-amendment* class (a test
that survives but whose exact-shape assertion is restated because a chartered AC changed the shape it
pins), and they meet its two conditions: strictness does not fall and the test count does not change.
Inverted (`toBe(true)` → `toBe(false)`, with the message rewritten to state the guarded expectation),
they become a **second independent pin on AC4 from a file WP27 does not own** — strictly more valuable
than deletion, which would retire the only external check on that boundary.

**Requested of Worker 2:** add **WP27** to the §7 licensed-amendment list, scoped to exactly these two
assertions in this one file and nothing else.

**Blocking status: NOT blocking.** WP27's own three test sets are green and the remaining WPs do not
depend on this ruling, so the batch continues. If the licence is refused, WP27 AC4 and these two
assertions cannot both hold and Worker 2 must decide which is the spec.

---

## Fixture repairs — §7 third class ("could never have passed"), demonstrated not asserted

§7's third licensed class requires the unsatisfiability to be **shown, not claimed** — because
*"this test could never pass"* is exactly what a wrong implementation's author would say about a test
that just caught it. Both repairs below are in **fixture files with zero assertions**, authored by this
batch, and the mechanism is spelled out for each.

### WP25 visible `harness.ts` — two unsatisfiable fixtures (repaired by the WP25 coder)

Independently verified by Worker 3 before acceptance: `grep -c "expect(" harness.ts` → **0**. The file
is a pure fixture with no assertions, and is untracked (new this batch). Both repairs are one line each.

| # | Mechanism (demonstrated) | Repair |
|---|---|---|
| 1 | `FakeSyncManager.synced` was declared and documented as *"every id ever passed to `waitForSync`"* but **never written** — permanently `[]`. So `expect(sync.synced).toContain(canvasDocId(FIXED_GUID))` and `.toEqual([canvasDocId(FIXED_GUID)])` could not pass under **any** implementation. | one `synced.push(docId)` |
| 2 | `ManifestManager.connect` awaits `waitForSync("__manifest__")`, and `createManifest` runs it over the same traced fake during setup. `firstContaining(trace, "sync:waitForSync:start:")` therefore resolved to the **manifest's** sync at index ~1, so three ordering assertions compared the sidecar against the wrong event (`expected 15 to be less than 1`). tp01 even does `trace.length = 0` for this reason — but *before* `createManifest`, so the noise is re-added immediately after. | `createManifest` connects through `{ ...sync, waitForSync: async () => {} }`; the doc is still acquired through the real fake, so `docs` / `requested` / `sync:getDoc:` channels are unchanged — only the setup-time sync wait leaves the ordering channel |

Neither repair touches an assertion; both make the suite strictly stronger by letting four previously
unsatisfiable tests actually discriminate.

### WP25 blind sets — RESOLVED. Verdict: fixture contamination, NOT a real defect.

**The implementation was verified first, before anything was touched.** `CanvasSync.subscribe`
(`canvas-sync.ts:2207-2226`) does `sidecar.attach(guid, doc)` → `await sidecar.load(guid, doc)` →
`await syncManager.waitForSync(docId)`. The load is awaited, in the right place. **AC1 is satisfied.**

**Contamination mechanism (demonstrated):** `ManifestManager.connect` (`manifest.ts:74-80`)
unconditionally does `getDoc("__manifest__")` + `await waitForSync("__manifest__")`. In both blind tp01
fixtures that runs at setup, *before `CanvasSync` exists*, so it enters the observation channel first —
blind1 saw `seenAtSync.length === 2` with the manifest at index 0 (so the clientID pin was reading the
**manifest** doc's state vector); blind2 got `"__manifest__"` into `synced` before the subject ran.
Unsatisfiable for any implementation. The direction check held throughout: the channel contained the
manifest's id, **never** `__canvas__:<guid>`.

**Repair (a) — both tp01 files**, mirroring the visible fix:
`await manifest.connect(sync as never)` → `await manifest.connect({ ...sync, waitForSync: async () => {} } as never)`.
`getDoc` stays real, so `docs` and requested ids are unchanged.

**Repair (b) — blind2 tp01 only. This is the important one, and it is a LICENSED FIXTURE COMPLETION.**

After (a) both sets went green — but under falsification A, **set2 stayed 47/47 green**. Cause:
`resolveGuidForSubscribe` awaits `store.bind` → `readIndex()` → `io.exists(sidecarIndexPath())`, so a
blanket `hold("exists")` gate stalled the subscribe **inside identity resolution** — before `getDoc`,
before `waitForSync`, before the load. **Both blind2 ordering tests were vacuous, and that predates the
repair.** Fix, in the IO double only: `wait(op)` → `wait(op, path)` with
`path === sidecarIndexPath() ? undefined : gates.get(op)`, importing `sidecarIndexPath` from WP24
rather than re-spelling it.

> **DISPATCHER RULING: repair (b) ACCEPTED — do not revert.** It is the **fixture-completion class**
> already recognised in BUILD_SPEC §7 (the 4th class, currently WP18 + WP64): a fixture that cannot
> exercise its own subject, repaired without touching assertions, subjects, names or counts, with
> strictness strictly increasing. **§7's class is extended to WP25**, bounded explicitly to *the IO
> double's `wait` signature in `blind_set2/WP25/tp01` and nothing else*.
> **The §7 register entry is Worker 2's to write — Worker 3 did not edit `BUILD_SPEC_CanvasV2.md`.**
>
> **Demonstration, in the required before/after form:** *before (b), falsification A left set2 at
> 47/47 green; after (b), falsification A reddens it.* That is the proof the fixture now bites — the
> class requires the unsatisfiability shown, not asserted, and this is the showing.

**Falsification performed (recorded verbatim, not redone).** `canvas-sync.ts` was backed up **outside
the repo** — correctly never via `git checkout`, since the coder's work is uncommitted — restored and
sha256-verified after every run: `18a6929d…cecf8aa` identical before and after, zero `FALSIFY` markers,
`tsc` clean.

| Perturbation | Result |
|---|---|
| **A** — load moved after `waitForSync` | set1 43/46, set2 45/47 — five named pins reddened, each on its own subject |
| **B** — load issued but not awaited | set1 42/46, set2 45/47 — the same five plus blind1 *"the load is not a re-read of the vault file"* |

No masking; no narrowing needed. Two blind2 tests correctly stayed green under both (`lifecycle.load`
driven directly; corrupt-sidecar degradation) — neither is an ordering pin. In all four perturbation
runs the only reds were in tp01; tp02–tp10 stayed green in both sets, and the red lists account for the
whole difference each time.

> **REUSABLE TRAP — the sixth distinct "green test that cannot fail" this run has found, and the FIRST
> located in a *gate* rather than in an assertion:**
> **"a gate that blocks identity resolution instead of the load."** Any ordering oracle written against
> `subscribe` is exposed to it, because identity resolution touches the sidecar *before the doc exists*.
> An ordering oracle stalled at the wrong seam never reaches the ordering it claims to pin — and it
> reports green while doing so.

---

## (superseded) WP25 blind sets — in-progress notes

All 5 blind failures are confined to **tp01** (the AC1 ordering point); tp02–tp10 are green in both
sets. Three of the five show the literal `'__manifest__'` sitting in the observed ordering channel.

**Direction-of-evidence check, done because "the fixture is broken" is the perfect cover for a real
ordering bug:** the channel contains **the manifest's** sync id, not the canvas doc's. A genuine
early-peer-sync defect would put the *canvas doc id* in that channel. That asymmetry is what makes this
read as wrong-sample-point rather than wrong-implementation.

**Routed to the test AUTHOR, not the coder** — deliberate structural isolation, per the AgentBuilding
rule that an agent validating its own work confirms what it wrote rather than what works. The coder has
an incentive to conclude its own implementation is fine. Conditions imposed:
1. verify or refute independently; **if it is a real defect, change nothing and say so**;
2. repair the **fixture only** — assertions, subjects, names and collected counts (46 / 47) untouched;
3. **prove the repaired oracle can still fail** — perturb the implementation so the sidecar load runs
   *after* `waitForSync`, and separately so the probe is not awaited, and confirm each tp01 assertion
   reddens on its own pin. *An oracle that goes green because it lost the ability to observe is worse
   than the failure it replaced.*

---

## Amendments to blind tests AUTHORED BY THIS BATCH (not inherited)

| Set · file · assertion | Verdict | Strictness delta |
|---|---|---|
| `blind_set1/WP27/test_tp05_rename_creates_no_doc_and_no_orphan_blind1.test.ts:141` — *"clientID and state vector are unchanged across the rename"* | Oracle contradicted its own AC. AC2 mandates the rename update `meta.path`, which lives in the Yjs `meta` map, so the state vector **must** advance; observed delta was exactly 1 tick = exactly one write. No correct implementation could satisfy "unchanged". | Restated to pin the **exact** expected delta (and the pre-rename vector as an ancestor of the post-rename one) rather than "unchanged" — **stricter**: it now also catches an implementation that performs extra spurious writes or re-seeds the doc during the rename, neither of which "unchanged" could distinguish from correct behaviour. Falsification required on its own pin before acceptance. |

This blind test was written **by this batch's own WP27 unit-test sub-agent**, so §7's blind-set gate
(which forbids making an *inherited* blind set pass by relaxing it) is not the operative rule — but the
amendment is recorded here in full anyway, with its strictness delta, because an unlogged blind-test
edit is indistinguishable from one made to manufacture a green.

---

## Biome findings — re-measured against the TRUE baseline (Dispatcher flag, resolved)

The WP28 coder claimed `canvas-sync.ts`'s three Biome findings were pre-existing, verified **by stashing
its own diff**. That is the method rule 4 forbids — it measures staleness against your own edit, not
against the batch baseline, and it is the same mistake the WP26 coder made with the three `TS2493`
errors, which turned out to be *new* and authored by this batch.

**Re-measured properly, against `H:\tmp\liveshare_snap_B4_P2\snapshot_pre_B4.tgz` (taken before the
first B4 edit). The claim is CORRECT.**

| | Baseline (pre-B4) | Current | Verdict |
|---|---|---|---|
| `lint/style/useTemplate` | `:2054` | `:2815` | **same occurrence** — the two lines are byte-identical (`` `local modify ${path}: +${applied.created.length} …` + ``); shifted 761 lines by this batch's additions |
| `organizeImports` | present | present | pre-existing |
| `format` | present | present | pre-existing |
| **total** | **Found 3 errors** | **Found 3 errors** | **no new finding introduced by B4** |

Method: extracted the baseline file from the snapshot, copied it to the repo root as a probe so it
resolved the same `biome.json`, ran the real binary, then deleted the probe. Not a licence question
either way — Biome findings are not assertions.

> ### ⚠ MEASUREMENT TRAP FOUND WHILE DOING THIS — carries past this batch
> **`npx biome` in this repo resolves to an unrelated npm package `biome@0.3.3`, which produces no
> output and exits 0.** The real linter is `@biomejs/biome@1.9.4` at
> `plugin/node_modules/.bin/biome`. There is no `node_modules/.bin` at the repo root at all.
>
> So `npx biome check <anything>` reports a **silent all-clear on any input**, including deliberately
> broken code. Any past or future "Biome clean" claim made via `npx biome` is unverified — it measured
> nothing. This is a lint-side instance of the same class this run keeps finding on the test side: an
> instrument that cannot fail. Always invoke `plugin/node_modules/.bin/biome` or `npm run lint`.

---

## Open defects found but deliberately NOT patched

### D4 — a merged replica CANNOT prune to the winner's record set (ARCHITECTURAL — brief WP30)

- **Found by:** WP28. **Not a defect in WP28's code — a property of single-doc Yjs replication.**
- `SyncManager.getDoc` creates exactly one `Y.Doc` per doc id and all peer state arrives as updates
  into it. After the merge the doc holds `winner ∪ loser`, and shared record ids are in **both** sides,
  so **no local subtraction yields the winner's set**. The information needed to prune lives on the
  winner's side.
- Consequence: the "wins **completely**" half of AC1 must be executed by the **importer** and published
  as a wholesale replacement — CONCEPT_V2 Teil 7 (*"epoch++, Datei seeden, Peers folgen der
  Epoch-Regel"*), and charter §2 puts that import in **WP30**. WP28 exposes
  `CanvasSync.adoptEpochWinner(rawPath, winner)` as the seam.
- **Standing instruction:** if any later WP asserts *"every replica prunes independently after the
  merge"*, that assertion is **unsatisfiable** and must be escalated, not implemented.

### D5 — two latent defects WP28's generalization pass found (both FIXED, recorded as findings)

1. **`normalizeEpoch` used `Number.isInteger`, which admits `2 ** 53`** — and at that value
   `n + 1 === n`, so `nextEpoch`'s pinned *"strictly greater for every input"* was **false**. One
   corrupt cell would have frozen a board's epoch **permanently**, the only symptom being that imports
   quietly stop winning. Now `Number.isSafeInteger`; `nextEpoch` throws `RangeError` at the ceiling
   instead of returning an unbeatable value; `bumpEpoch` computes it *before* opening its transaction
   so a refusal cannot half-write `meta`. Found by asking the path-validation question of a **non-path**
   export — which is what made it a generalization rather than a patch.
2. **`conflictCopyPath` is deterministic and day-granular** (pinned by the tests), so a second conflict
   on the same board on the same day names the **same file** — and the file already there is another
   loser's only copy. `CanvasSync.writeConflictCopy` now never clobbers: an identical body is an
   idempotent re-run, anything else throws, and because the mechanism is fail-closed that **cancels the
   adoption**. Nothing is lost, rather than one copy traded for another. **Worker 4 should confirm the
   cancelled adoption leaves the user with a recoverable state and a notice, not a silent no-op** (I11).

Also retracted honestly by WP28: attempt 1's own comment claimed the `date` parameter could not carry a
`..`, while its charset `[A-Za-z0-9._-]+` admitted `..` and `.` outright, and `env.today()` is a
caller-supplied clock the module cannot audit. That was a **live path escape through the date
parameter**. A retracted false guarantee recorded as such is worth more than a quiet fix.

### D2 — WP27's `setIdentityStore` / `handleRename` have NO production caller (RESOLVED by WP25)

- **Found by:** WP27, attempt 1. **Deliberately not wired, and the reasoning is sound.**
- **What it means:** WP27 ships a **two-mode** design. *With* an identity store: guid doc ids, `meta`
  stamping, mixed-version refusal. *Without* one: the canonical path is the identity token and
  `canvasDocId()` reproduces the pre-WP27 doc id **byte-for-byte**. The second mode is why ~40
  pre-existing test files stayed green with zero test edits — but it also means **AC1 and AC2 are
  currently true of the module, not of the shipped plugin.**
- **Why WP27 correctly declined to wire it:** `createCanvasIdentityStore` needs a `SidecarIO` adapter
  that does not exist yet — WP24 shipped the *interface*, WP25 owns the *wiring*. Wiring it
  manifest-only would drop a guest that subscribes before the host's manifest entry replicates into the
  R10 text fallback **with no retry**, which is worse than the status quo. `main.ts` and
  `vault-events.ts` are also outside WP27's charter §6 file list.
- **Action:** **WP25 must call `setIdentityStore(...)` from `main.ts` and `handleRename(...)` from the
  vault rename handler.** This is now part of WP25's brief. Until then, treat WP27 AC1/AC2 as
  module-level only, and say so in the handover — this is exactly the kind of gap that reads as DONE
  and is not observable end-to-end.

### D3 — `CanvasIdentityStore.unbind` has no clean spelling (minor, informational)

Its dependency is pinned as `Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid">`, with no clear
method — so a **blank guid passed to `setCanvasGuid` clears the mapping**. Documented in WP27's report.
WP28 and WP30 need to know before they touch the mapping.

### D1 — `fileOpsManager.onFileRename` broadcasts a sidecar rename over the file-op channel

- **Found by:** WP26, attempt 2. **Not patched, correctly.**
- **Class:** exactly the leak class WP26 exists to close — local replica state escaping into shared state.
- **Mechanism:** `vault-events.ts:190-194` admits a rename when *either* side is shared:
  `if (!isSharedPath(file.path) && !isSharedPath(oldPath)) return;`
  A rename of an ordinary shared note *into* the sidecar directory therefore passes on the strength of
  `oldPath`. WP26 closed the manifest arm of this (`renameFile` no longer `set`s the destination key),
  but the **file-op broadcast arm is still open**: the rename is sent to peers, and a peer would
  recreate the move inside its own sidecar directory.
- **Why WP26 correctly declined it:** it is peer file-op broadcast, not manifest membership and not
  text-sync detection. It sits outside WP26's three charter-scoped files and no C26 acceptance
  criterion reaches it. Patching it would have been an unchartered widening.
- **Action required:** Worker 2 should charter this as a follow-up WP. It is a real, reachable leak,
  not a theoretical one.

---

## Corrections made to charters (recorded, not silent)

- **WP26 / AC3 enumeration.** The contract comment initially named `files/exclusion.ts` as a consumer
  of `isSidecarPath`. It neither imports nor calls it — a location reference that read as a consumer
  claim. Removed; `renameFile` added. Invisible to `tp09`, which pins only the forward direction of the
  enumeration (every real consumer is named) and not the reverse (only real consumers are named).
  Blind set 2 caught it.
- **WP26 / AC3 comment structure (keep this reasoning).** The AC3 defect recurred twice with two
  different filenames (`exclusion.ts`, then `vault-events.ts`) because the consumer list and its
  surrounding prose had **no delimiter** — a module named for context was indistinguishable from a
  module named as a consumer. Fixed structurally, not cosmetically: the list is now a bare four-row
  `<module>  <function>` block, the exhaustiveness claim is scoped explicitly to that block, per-seam
  reasoning moved to a following section keyed by function name only, and `vault-events.ts` is labelled
  in place as "the CALLER of the seam, calls neither predicate itself". The coder's own summary is the
  transferable lesson: **a delimiter survives future edits to the reasoning; care does not.**
- **WP26 / `setActiveFile` non-defect.** WP26 attempt 1 filed a bare-path `getDoc` in
  `BackgroundSync.setActiveFile` as an open defect. Attempt 2 traced it properly and retired it:
  `main.ts:909-912` only passes paths that already cleared `isSharedPath && isTextFile`, so a guard
  there would be unfalsifiable by construction. Recorded because a filed-then-retired defect is
  otherwise indistinguishable from one that was forgotten.

---

## Things that are pinned in prose but by no test

- **WP24 `SidecarStore` per-guid serialisation.** Required (without it an `append` can land between a
  checkpoint's encode and its truncate and be lost outright), implemented, and falsified by the coder
  with a throwaway probe — but the shipped test fakes preserve FIFO regardless, so **no test in any of
  the three sets catches its removal**. Flagged for Worker 4 as a priority probe target.

---

## Batch hygiene / concurrency

- Batch **B16 (WP64)** is live in the same tree, sweeping test oracles across pre-existing test files.
  It changes no production source. All foreign edits are reported, never fixed.
- Suite arithmetic stayed exactly accountable through WP26: 1346 (baseline) → 1424 after WP24 (+76 mine,
  +2 foreign) → 1470 after WP26 (+46 mine, +0 foreign in that window). 0 failed throughout.

---

## Open item for me (Worker 3), not for the handover

- `tsc --noEmit -skipLibCheck` now emits **3 × TS2493** in
  `plugin/src/__tests__/v2/wp26/test_tp04_sync_from_manifest_visible.test.ts:130,161,192`
  (`vi.fn(async () => ({}))` infers a zero-arity mock, so `mock.calls[i][0]` does not typecheck).
  The WP26 coder correctly reported these as pre-existing *relative to its own edits* — but they are
  **new relative to the batch baseline**, which had a clean `tsc`. They were authored by this batch's
  own WP26 unit-test sub-agent, so repairing the typing is not a licence question. Must be fixed
  without weakening the assertion before the batch closes.
