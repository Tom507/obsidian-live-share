# Development Report — Canvas V2

**Subject:** everything that changed since `CONCEPT_V2.md`, the problems discovered while building it,
and the amendments the concept itself now needs.
**Date:** 2026-08-04 · **Branch:** `fix-bugs-and-raceconditions` · **Tree:** clean at `d8adb74`

---

## 0. Provenance — what in this report was independently verified, and what was not

This distinction is load-bearing, because this initiative's signature finding is that *a claim which
cannot be checked reads exactly like a claim that was checked*.

| Part | Provenance | Confidence |
|---|---|---|
| §1 Specification drift | **Independent analysis** by a dedicated agent reading `CONCEPT_V2.md` and `BUILD_SPEC_CanvasV2.md` in full, cited to file and line. Fragment: `_report_fragment_A_spec_drift.md` | High — primary sources, quoted |
| §2 Defect inventory | **The Dispatcher's own account.** A dedicated independent audit of the ~53 implementation reports and ~17 handovers was commissioned and **cancelled before completion**. | Medium — each entry was verified against the tree *when found*, but this list has **not** been re-derived from the primary artefacts and may be incomplete |
| §3 Proposed concept changes | Dispatcher judgement | Recommendations, not findings |
| §4 Governance deviation | Independent analysis (§A6 of Fragment A), ruling by the Dispatcher | High for the fact, Dispatcher's call for the ruling |
| §5 Current state | Measured today on a verified-quiet tree | High |

**§2 is the section to distrust.** It is almost certainly not exhaustive. An independent sweep remains
worth running.

---

## 1. Executive summary

CONCEPT_V2 specified a redesign in seven phases (P0–P6) and a test strategy (Teil 14). What was built is
that redesign, plus **three phases of machinery the concept does not describe at all**, because the
initiative repeatedly discovered that the ground the concept stood on was not where it thought.

Three findings dominate:

1. **CONCEPT_V2 contradicts itself about edge endpoints, and the stricter reading silently destroyed user
   data.** Teil 4 makes `side` mandatory; Teil 11's validity rule never mentions it; JSON Canvas says it is
   optional. Because the model could not *represent* a legal side-less edge, ingest refused it — and the
   refusal composed with the single-writer flush into deletion from the user's own `.canvas` file. This
   produced the only new invariant, **I11 REFUSAL NEVER DESTROYS**.
2. **The test rig the concept assumed exists, does not.** Teil 14 says `launch_liveshare_e2e.py`
   *"existiert und lief nie"* and treats running it as the remaining work. It is a **headless mock-host**
   rig that scopes real Obsidian out by design. Rebuilding the host layer is **20 work packages** — the
   single largest driver of 42 → 76.
3. **The concept's four convergence oracles cannot detect corruption.** Teil 14 names SEC, schema,
   byte-equality and shadow-consistency. Measured over a provably corrupt document across 200 scenarios ×
   10 windows, **all four are green** — SEC and byte-equality score zero in every row — while only the
   added intent-trace oracle fires, 2913 times. *"Convergence is not correctness"* went from an argument
   in the concept to a measured constraint.

**The state today:** 76 work packages chartered, 54 implemented (53 accepted), **303 test files / 1856
tests / 0 failed** on a verified-quiet tree. The original defect — the corruption cascade — is closed at
its root, along with five further data-loss or data-corruption bugs found on the way.

**And the honest headline: none of it has run in real Obsidian.** Every green is headless. That is not an
oversight; it is §4.

---

## 2. Part 1 — What changed since CONCEPT_V2

### 2.1 Superseded — the concept says something no longer true

| # | Concept says | Actually | Why |
|---|---|---|---|
| **A1** | `from`/`to` = `{node, side, end?}` (`:395`) | `side` is **optional**; `node` alone decides register presence | **Found wrong**, and the concept contradicts *itself* — Teil 11 (`:699`) defines validity as `id ∧ from.node ∧ to.node`. Caused silent data loss. |
| **A2** | `text` non-empty implies validity | `"text": ""` is a **legal empty card** | Same class, one field over. A legal record was refusable, and refusal deleted it. |
| **A3** | Teil 11 assigns local/remote asymmetry | The **seed** boundary was unassigned | Filled by ruling, using the concept's own reasoning |
| **A4** | `color`/`label` clearing propagates | Does not | **Deliberate, recorded regression** (§3.1 S14, owned by WP39) |
| **A5** | `launch_liveshare_e2e.py` is the Teil-14 rig | It is a **headless mock-host** rig | Found wrong. See §1.2 |
| **A6** | Green two-vault run is a release condition **from P0** | Four phases closed without one | **Standing deviation — see §4** |
| **A7** | Relay blob persistence "optional" | Built | Revised by user directive |
| **A8** | Phase order "nach Symptomdruck" | Superseded in practice | Verification debt outranked symptom pressure |
| **A9** | Three concept mechanisms | **Still absent from the tree** | P3/P4/P5 unbuilt |

### 2.2 Added — product behaviour with no basis in the concept

Six items. These change what a user or peer can observe.

- **P-1 · I11 REFUSAL NEVER DESTROYS** as an enforced runtime mechanism — a per-path refused set, a
  **withheld** `.canvas` write-back while it is non-empty, automatic lifting, and a `SEED REFUSED:` /
  `SEED RESTORED:` signature pair. *Every step was individually chartered and individually correct; the
  **composition** was not.*
- **P-2 · Fail-closed conflict-copy writing** — `conflictCopyPath` is day-granular, so a second conflict
  on the same board on the same day named the same file, overwriting **another loser's only copy**. Now
  idempotent-or-throw, and the refusal cancels the adoption.
- **P-3 · Epoch ceiling refusal** — `Number.isInteger` admits `2**53`, where `n+1 === n`, so the pinned
  *"strictly greater for every input"* was false and one corrupt cell would freeze a board's epoch
  **forever**, the only symptom being that imports quietly stop winning.
- **P-4 · Flat-vs-register precedence** — the concept has **no notion of a dual-vocabulary period**;
  Teil 4 presents registers as simply replacing flat fields. In P1 a doc legitimately holds both, and the
  collision was being resolved by `Y.Map` insertion order.
- **P-5 · Sidecar exclusion at the file-op channel, both directions** — Teil 7 describes one surface;
  there are four. **Chartered, not implemented (WP68).**
- **P-6 · The either-side asymmetry** — the rename branch is the only op gated with `paths.some(...)`
  rather than the strict all-paths form, and `isPathSafe` rejects traversal but **not** the config
  directory. Neither fact appears anywhere in the concept.

### 2.3 Added — verification and infrastructure

This is the bulk of the added volume and **none of it changes what a user sees**:

- **PHASE T3** (WP43–54) — the entire real two-instance Obsidian host layer.
- **The gate's own preconditions** (WP69–76) — each found by a batch that *tried to run the gate* and
  either could not, or could only have produced a false green.
- **PHASE VI** (WP55–67) — verification integrity, because the blind runner **could report a
  never-executed set as green**. The concept's Teil 14 assumes tests are trustworthy and asks only for
  more of them.
- **The intent-trace oracle and its fault-injection matrix** — the strongest single measurement produced.
- **§7 governance machinery** with no analogue in the concept: licensed-deletion and amendment ledgers, a
  strictness-may-not-fall rule, five fixture/assertion licence classes, the fenced-off-claim rule, *"a
  ledger row is a measurement, not a timeless fact"*, and an unfalsifiable-repair register.
- **Data-safety gates on the owner's live vaults**, including an independent second leg that may **not**
  consult the rig's own bookkeeping.

> **⚠ The product/verification boundary does not follow the source tree.** WP72/75/76 are verification by
> purpose but edit `plugin/src/testing/` — production source. It is tree-shaken out, but *the check that
> proved it was itself a check that could not fail*. **W4-1 is not discharged.** Until it is,
> "verification, therefore harmless to the product" is not a sound inference.

### 2.4 Deepened — right but incomplete

- **The Surface-Shadow**: one paragraph in the concept, ~1130 lines in the tree.
- **Canonical serialisation**: four bullets became a precedence problem.
- **Atomic registers**: the *migration* was the hard part, not the model.
- **Tombstones**: the undo argument survived; the GC clause did not receive the same care, and
  cross-replica behaviour after GC is addressed in **neither** document.

### 2.5 Invariants

The concept defines I1–I10. The current set is **11**. There is no I12 — verified by exhaustive grep.

**I11 — REFUSAL NEVER DESTROYS.** A record the system refuses to ingest must never be removed from the
user's file as a consequence of that refusal. Forced by the E2 ruling; enforced at 12 sites.

---

## 3. Part 2 — Problems discovered

> **Provenance warning (see §0):** this is the Dispatcher's account, not an independent audit. Each entry
> was verified against the tree when found. The list is **probably not exhaustive.**

### 3.1 Product defects — a user could have hit these

| # | Defect | What a user would lose | Status |
|---|---|---|---|
| 1 | **Corruption cascade** — capture diffed against `lastWrittenContent` (disk), so a stale view pushed a revert | The reported symptom: reloading offscreen shreds first one version, then the other | **Closed** (P0) |
| 2 | **Side-less edge deletion** — legal JSON Canvas edges refused at ingest, then deleted on flush | Edges silently vanish from their own `.canvas` file | **Closed** at three depths + I11 |
| 3 | **`"text": ""` refusal** — a legal empty card treated as invalid | An emptied card deleted | **Closed** |
| 4 | **Insertion-order corruption** — flat-vs-register collisions resolved by `Y.Map` insertion order | A moved card snaps back, **with both replicas agreeing on the wrong value** — byte-equality provably cannot detect it | **Closed** |
| 5 | **Manifest sidecar leak** — `renameFile` wrote to the manifest without consulting `isSharedPath` | A sidecar key published to every peer | **Closed** (WP26) |
| 6 | **Permanent epoch freeze** — `Number.isInteger` admits `2**53` | A board's epoch frozen forever; imports silently stop winning | **Closed** (WP28) |
| 7 | **Conflict-copy clobber** — day-granular naming | Another loser's only copy overwritten | **Closed** (WP28) |
| 8 | **File-op rename broadcast leak** — peers recreate a sidecar move in their own sidecar dir | Local replica state escapes into shared state | **⬜ Chartered, not implemented (WP68)** |

### 3.2 "A green test that cannot fail" — nine-plus instances

The initiative's signature finding. Each is a distinct *mechanism*, not a repeat.

| # | Instance | Mechanism |
|---|---|---|
| 1 | Vacuous blind runner | A never-executed set reported green |
| 2 | Unfalsifiable assertions | Assert something no implementation could violate |
| 3 | Oracles vacated by a semantic change | The chartered AC retired the state the assertion pinned |
| 4 | Global perturbation falsely certifying | A broad injection reddens *something*, taken as proof the specific pin bites |
| 5 | A prior batch's amendment masking a later falsification | Site B sits behind amended site A in the same test body |
| 6 | **WP25's ordering gate stalled at the wrong seam** | Gated on `hold("exists")`, but identity resolution touches the sidecar *before the doc exists* — the gate stalled ahead of the thing it meant to order. **First instance found in a gate rather than an assertion.** |
| 7 | **`_run_case` discarding `applied`** | An unapplied gesture leaves both snapshots equal → recorded **pass**. Eleven sites, five of them setup; `delete-node-edge`'s oracle is satisfied by the node *never having been created* |
| 8 | **`simulateEdit` returns a constant** | The real host can never report `applied:false`, so C73 AC1 is **unfalsifiable against the build the gate will run** — the first instance to **hollow a work package already reported closed** |
| 9 | **The file oracle over two absent files** | `sameFileObservation` returns `true` for two `{exists:false}` observations → `fileConverged: true` over **two files that do not exist**. **First instance caught *before* it landed** |

Plus: five `tp29` tests that had never executed their assertion at all (a `KeyError` in a fixture helper),
found by WP70 inside its own hidden set.

### 3.3 Gate defects — what a green run would have "proven"

| Defect | A green gate would have proven… |
|---|---|
| The E2E build never terminates | *(nothing — the batch would hang and misread it as a slow build)* |
| WP7 named the **mock rig's** ports | …that the headless mock converges. Never touching Obsidian |
| `sharedFolder = ""` | …nothing, after trashing the owner's vault |
| Wrong plugin dispositioned (`lan-vault-sync` vs **`obsidian-git`**, `autoPullOnBoot: true` on dirty trees with remotes) | …a result contaminated by a git pull that ran before any Canvas V2 code |
| The rig has **no launch backend** | *(the gate cannot start)* |
| The driver cannot tell **two vaults from one** | …that one vault syncs with itself. Every case converges trivially |
| **The matrix never traverses the capture path** | …that **Yjs converges** — which was never in doubt — and nothing about P0 or P1 |

That last one is the most serious finding of the entire gate effort: `simulateEdit` writes directly into
the shared `Y.Doc`, so the gate would have validated the **transport** and said nothing about the fix.

### 3.4 Security-relevant

| Finding | Status |
|---|---|
| Minted room token reachable via `repr` | **Closed** — a `Secret` wrapper unrenderable **by type** (redacting `__repr__`/`__str__`/`__format__`, refused `__bytes__`/`__iter__`, `reveal()` sole accessor, `__deepcopy__` returning the wrapper so `asdict()` cannot unwrap it) |
| **`ports.BorrowState` is a dataclass holding `data.json` bytes** — its generated `repr` renders live credentials | **⬜ OPEN, unowned.** Fix shape already proven above |

*A type is a guarantee where a call-site audit is only a promise.*

### 3.5 Process findings, including the Dispatcher's own

- **Twice I specified a check that cannot fire** — the `__LS_E2E__` count (zero in *both* bundles), and
  "a production build refuses to start the run" (a production build has no control port at all).
- **I mislocated the capture path** — told a worker the fix lives on `captureLocal`; it lives on
  `handleLocalModify`. `captureLocal` belongs to `CanvasBinding`, which is **off by default**. A WP scoped
  my way would have repaired the switched-off path.
- **I committed while a sibling batch had work staged** — `git commit` takes the whole **shared index**, so
  explicit `git add` is not protection. 94 foreign files swept into one commit.
- **Blind sets authored after implementation** in one batch — independently re-derived, but not evidence
  of non-overfitting. Disclosed unprompted by the batch.
- **An independent defect audit was cancelled mid-run**, which is why §3 carries a provenance warning.

---

## 4. Part 3 — The governance deviation, and my ruling

**CONCEPT_V2 Teil 14 (`:830`) makes a green two-vault run with real Obsidian a release condition from P0
onward. BUILD_SPEC retains this verbatim. P0, P1, P2, P6 and Phase VI all closed without one.**

No ruling reconciles this. It is not a contradiction between documents — both say the same thing — it is a
**standing divergence between the specification and the execution**, four phases running.

**Ruling.** The deviation is **acknowledged, not retroactively authorised.** Holding the gate was correct:
seven separate blockers were found each time a batch tried, and every one would have produced a *false
green*. Running it vacuously would have been worse than not running it — a green gate that proves nothing
is precisely the failure mode this initiative exists to eliminate, and it would have been committed in the
one artefact the project is measured by.

But the concept's clause was written for a reason, and shipping four phases past it is a real cost: **the
phases are closed against headless evidence only, and if the gate surfaces a defect in P0 or P1
mechanisms, those phases reopen.** That risk is live and unquantified.

**Recommended amendment** (see §5, item 5): the concept should distinguish *"the gate must be green before
release"* from *"the gate must be green before each phase closes"*, and state what a phase closure means
in the interim. As written, the initiative has been in violation since its first phase.

---

## 5. Part 4 — Proposed changes to CONCEPT_V2

These are amendments to the **concept**, not the spec. Ordered by consequence.

### 1. Resolve the endpoint contradiction — Teil 4 vs Teil 11 *(critical, caused data loss)*
Teil 4 (`:395`) writes `from = {node, side, end?}`; Teil 11 (`:699`) writes `Edge gültig ⟺ id ∧ from.node ∧
to.node`. **Amend Teil 4** to mark `side` and `end` explicitly optional, and state that **`node` alone
decides register presence**. Add a line noting that the model must be able to *represent* every legal JSON
Canvas document, because a representability gap becomes a refusal, and a refusal became a deletion.

### 2. Elevate I11 to Teil 3 *(critical)*
**REFUSAL NEVER DESTROYS** belongs with I1–I10, not as a downstream discovery. Its general form is worth
stating as a design rule: *a validity boundary and a destructive write must never compose without an
explicit decision about what happens between them.* Every step in the cascade was individually chartered
and individually correct.

### 3. Correct Teil 14's rig premise *(critical, 20 WPs of consequence)*
Teil 14 says the rig *"existiert und lief nie"*. It does not exist. Amend to state that the real-Obsidian
host layer is **unbuilt**, and that the existing launcher is a headless mock that deliberately scopes real
Obsidian out. This single wrong assumption is the largest driver of the work-package growth.

### 4. Add the intent-trace oracle to Teil 14's oracle set *(high)*
The four named oracles — SEC, schema, byte-equality, shadow-consistency — are **all green over a provably
corrupt document**, measured. Add the intent-trace oracle and record the measurement, so the next reader
inherits the finding rather than the assumption. Amend *"convergence is not correctness"* from a remark to
a specification requirement.

### 5. Split the release condition from the phase-closure condition *(high — see §4)*

### 6. Add the dual-vocabulary period to Teil 4 *(medium)*
The concept presents registers as replacing flat fields. In P1 both exist simultaneously and legitimately.
State the precedence rule and require that collision resolution be **order-independent**.

### 7. Extend Teil 7's sidecar exclusion to all four surfaces *(medium)*
It describes exclusion from manifest, sync and text-sync detection — three surfaces. The file-op broadcast
channel is a fourth, in both directions, and the inbound arm is reachable by any peer without local action.

### 8. Address tombstone GC across replicas *(medium, currently unaddressed anywhere)*
The concept's undo-is-lossless argument and its physical-removal clause are in tension, and **neither
document resolves it**. Flagged as unverified by the drift analysis.

### 9. State what the E2E rig actually measures *(medium)*
A rig that injects into the CRDT tests the transport, not the capture path. The concept should require the
gate to exercise **the path the fix lives on**, and to produce **positive evidence of which path ran** —
not an assertion that it did.

---

## 6. Part 5 — Current state

| | |
|---|---|
| Chartered | **76** WPs (WP1–WP76, no gaps — measured) |
| Implemented | **54** · accepted **53** (WP70 is `RISKY`, two escalated blind failures) |
| Not implemented | **23** — WP7, 31–40, 50–54, 65, 66, 68, 71, 74, 75, 76 |
| Plugin suite | **303 files / 1856 tests / 0 failed** (verified-quiet tree, 43.6 s) |
| `tsc --noEmit` | clean |
| Real-Obsidian gate | **never run** |
| Unlicensed test deletions, whole run | **0** |

**Unbuilt product work:** P3 (mode consensus, receive-and-persist), P4 (Y.Text, blur merge, UndoManager),
P5 (op-capture promotion) — roughly a quarter of the redesign.

**Before the gate can run:** WP70 (safety — currently the only thing standing between a run and the
owner's vault contents), WP74, WP75, WP76, WP71, then WP50/51, then WP7.

**Known-open, user-reachable:** WP68 (rename broadcast leak) and the `BorrowState` credential-`repr` leak.

---

## 7. Closing assessment

The redesign works, as far as headless evidence can show: the reported corruption cascade is closed at its
root, and five further data-loss or data-corruption defects were found and closed on the way — four of
which no user had reported and which byte-equality could not have detected.

The uncomfortable part is that **the majority of this initiative's effort went into discovering that its
own evidence was not evidence.** Nine distinct ways a test could pass without being able to fail; a rig
that could not launch; a gate that would have tested the wrong code path; and a specification that
contradicted itself in the exact place where the contradiction cost user data.

That is a real result, not an overhead. But it means the correct statement of current status is narrow:
**the redesign is verified to the limit of headless testing, and not one step further.** Whether it works
in real Obsidian is unknown, and the machinery to find out is specified but not finished.
