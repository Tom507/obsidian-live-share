# Report fragment A — Specification drift: CONCEPT_V2 versus what was built

> **Question answered:** what is true now that `CONCEPT_V2.md` does not say, and what does
> `CONCEPT_V2.md` say that is no longer true?
>
> **Sources, in priority order.** `workflowArtifacts/CONCEPT_V2.md` (902 lines, read in full);
> `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` (2669 lines, §§1–11 read; §5 read per
> component block); `workflowArtifacts/canvas-v2/DISPATCHER_STATE.md` (518 lines, read in full);
> `workflowArtifacts/canvas-v2/BlindVerificationLedger.md`; the 76 `TaskCharter_WP*.md` and 54
> `ImplementationReport_WP*.md` files; and direct measurement of the working tree.
>
> **Tree state at the time of writing:** branch `fix-bugs-and-raceconditions`, HEAD **`f3d2a1d`**,
> `git status --porcelain` **empty** (the tree is quiet — which it was *not* when
> `DISPATCHER_STATE.md` last recorded its measurements). No file was modified by this analysis
> except this fragment. No build and no test run was performed, so every figure below is either
> a **static** measurement of the tree or a **quoted, attributed** measurement from an artefact,
> and the two are labelled distinctly.
>
> **CONCEPT_V2 is German with English technical terms.** Quotations preserve its wording; the
> analysis is in English.

---

## Reading key — three states that are routinely conflated

This report uses these three words in exactly these senses, because the run itself has repeatedly
paid for conflating them (`DISPATCHER_STATE.md:418-447`, hard-won rules 1–12).

| State | Means | Evidence required |
|---|---|---|
| **chartered** | a `§5 C##` component block and a `TaskCharter_WP##` file exist | file present |
| **implemented** | an `ImplementationReport_WP##` exists and the source is in the tree | report + source |
| **verified** | measured against an oracle that could have failed, on the tree that is current | a blind-ledger row with a non-zero collected count, measured against *this* tree — or a green gate run |

**Nothing in this initiative is verified in the third sense at the level CONCEPT_V2 Teil 14
demands.** `DISPATCHER_STATE.md:518`: *"**Not yet true:** nothing has been exercised in real
Obsidian. All greens are headless."*

---

## A. Superseded — CONCEPT_V2 states something that is now false or was abandoned

### A1. `from`/`to` = `{node, side, end?}` — **found wrong**, and CONCEPT_V2 contradicts *itself*

**Concept says** (`CONCEPT_V2.md:395-396`, Teil 4 merge table):

> `| `from` = `{node, side, end?}` | ein LWW-Register | atomarer LWW | ein Edge-Endpunkt ist eine Einheit. […] |`
> `| `to` = `{node, side, end?}` | ein LWW-Register | atomarer LWW | dito; `from` ⊥ `to` […] |`

Only `end` is marked optional. `side` is written as a mandatory component of the endpoint value.

**Actually true:** `fromSide`/`toSide` are **optional in the JSON Canvas file format**. The corrected
shape is `{node, side?, end?}` (`BUILD_SPEC_CanvasV2.md:167-168`, `:170-176`, E1 ruling
2026-08-02, and §4.5 `:195`).

**This is the highest-value finding in section A, because CONCEPT_V2 is internally inconsistent
here and the inconsistency was load-bearing.** Teil 4 makes `side` mandatory; Teil 11's own
validity predicate never mentions it (`CONCEPT_V2.md:699`):

> `Edge  gültig ⟺ id ∧ from.node ∧ to.node`

The BUILD_SPEC states the resolution explicitly (`:172`): *"CONCEPT_V2 never cites the JSON Canvas
spec and **Teil 11's own validity predicate is `Edge gültig ⟺ id ∧ from.node ∧ to.node`** — `side`
was never in it. The corrected shape is therefore consistent with Teil 11 rather than a departure
from it."* It calls Teil 4's shape *"a transcription artefact of the torn-write argument, not a
format claim"*.

**Consequence, and why this is not cosmetic.** Because the endpoint model could not *represent* a
legal side-less edge, the ingest validator refused it, and the refusal composed with
`CanvasPersistence`'s single-writer flush into **silent deletion of the record from the user's own
`.canvas` file**. `DISPATCHER_STATE.md:489-491`: *"Silent `.canvas` data loss found and closed —
side-less edges are legal JSON Canvas, were refused at ingest, and were then deleted from the
user's file on flush."*

**Classification: found wrong.** Not a revision of intent — a factual error about the file format
in the authority document, which produced a data-loss path.

**Changed by:** the E1 ruling (2026-08-02); WP10 AC5 (endpoint representability), WP14 AC1/AC2
re-read, WP17 AC5 (serialisation), WP63 (the file guarantee). WP10, WP14 and WP17 were **reopened**
(`BUILD_SPEC_CanvasV2.md` §7 amendment ledger, WP10/WP14 entry).

**Second-order effect, verifiable:** `WP3 set1` was `CONFIRMED 56/56/0` and later re-measured
`56/55/1` *with the set untouched* — because *"`toV2Edge` keeps an edge's flat keys **only when the
endpoint register fails to build**, so before AC5 the assertion passed **because** a fully-connected
side-less edge was being read as not-an-endpoint. **The row was green on account of the very defect
AC5 was written to fix.**"* (`BlindVerificationLedger.md:21-31`).

---

### A2. `"text": ""` — **found wrong** (E1-b, the same class one field over)

**Concept says** (`CONCEPT_V2.md:698`, Teil 11):

> `Node  gültig ⟺ id ∧ type ∧ pos ∧ size ∧ typspezifisch (file→file, text→text, …)`

"typspezifisch … text→text" was implemented as *non-empty* `text`.

**Actually true** (`BUILD_SPEC_CanvasV2.md:196`): *"`"text": ""` is a legal JSON Canvas text node —
an empty card the user has not typed into yet, or one they cleared. Refusing it is refusing a legal
document, and under the pre-I11 coupling that refusal deleted the card."* `text` now accepts **any**
string including `""`. `file` and `url` keep their non-empty requirement.

**Classification: found wrong** — a reading of an under-specified concept clause that destroyed data.
Second independent instance of A1's class, which is why it produced an invariant rather than a patch
(see §D).

---

### A3. Teil 11's local/remote asymmetry left the **seed** unassigned — **filled by ruling, and the concept's own reason decided it**

**Concept says** (`CONCEPT_V2.md:694-705`, Teil 11): a single validation function at *"jeder
Schreibgrenze des Docs (Seed, `CAPTURE_OP`, `CAPTURE_NET`, Import)"*, then:

> *"Ungültige Records aus lokalen Quellen werden **abgewiesen** (mit Signatur) […] Remote-Deltas
> werden nicht abgewiesen (das würde Divergenz erzeugen: Replikat A akzeptiert, B lehnt ab)"*

It lists Seed among the validated boundaries but **never assigns it to either side of the
local/remote binary.**

**Actually true** (`BUILD_SPEC_CanvasV2.md:198`, E2 ruling): the seed is a **local** source and is
rejected. The argument used is the concept's own stated reason: *"The asymmetry is a **convergence**
rule, not a trust rule. Refusing a seed record diverges nothing."*

**And the spec then rejects quarantine as the alternative** (`:199`): *"a quarantined record is 'nie
serialisiert' (Teil 11) and `CanvasPersistence` writes `serialize(doc)` over the file — so
quarantining a seed record removes it from the user's file just as surely as refusing it does.
Quarantine protects the **doc**, not the **file**."*

**Classification: deliberately revised** — a genuine gap in the concept, closed by a ruling that
derived the answer from the concept's own rationale rather than overriding it. But the *composition*
it exposed is a found-wrong: see I11 in §D.

---

### A4. `color` / `label` clearing propagates — **abandoned as a deliberate, recorded regression**

**Concept says** (`CONCEPT_V2.md:394`, Teil 4): `color` is *"LWW-Register | LWW, löschbar |
reversibler Stil-Intent; Löschung = explizites Delete-Ereignis (I7), nicht Key-Abwesenheit."*

**Actually true** (`BUILD_SPEC_CanvasV2.md:127`, S14): *"**Superseded and removed (WP4, P0) — and
this is an accepted user-visible regression, recorded rather than absorbed.** […] Consequence from
P0 until WP39: **clearing a card's colour or an edge's label in Obsidian no longer clears it for
peers** — the value returns on the next reconcile."*

The reasoning is that under I7 the Obsidian-save capture path cannot distinguish "the user cleared
this field" from "the stale view omitted this field", and *"that indistinguishability *is* the
epistemic claim I7 makes"*. The concept's own Teil 5 diff rule (`CONCEPT_V2.md:453-470`) confirms
this by omission: it has cases for *field value differs*, *record missing*, and *record tombstoned* —
but **no case at all for a field absent from an otherwise-present record.**

**Classification: deliberately revised, with an owner and an end date.** Owner for closing it:
**WP39 AC5** (op-capture can observe the clear directly). WP39 is P5 and is **not implemented** —
so this regression is live in the current tree. A WP that "fixes" it by reintroducing key-absence
semantics on the capture path violates I7 and must ESCALATE.

---

### A5. `tools/launch_liveshare_e2e.py` is the Teil-14 rig — **found wrong**

**Concept says** (`CONCEPT_V2.md:828-830`, Teil 14):

> *"**2. Der E2E-Rig wird Pflicht-Gate.** `tools/launch_liveshare_e2e.py` existiert und lief nie
> (R2). Ab P0 ist ein grüner Zwei-Vault-Lauf mit echtem Obsidian Release-Bedingung"*

The concept assumes that file *is* the two-vault rig and that the only missing thing is running it.

**Actually true** (`BUILD_SPEC_CanvasV2.md:99`, D13; C7's T3 note): that script *"aliases the
`obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts; a green run
there says nothing about AC1 or AC2."* It is a **headless mock-host rig that scopes real-Obsidian
orchestration out by design.** The real rig had to be built from nothing as **PHASE T3**.

**Classification: found wrong** — a factual claim about the repository that was inverted. It is the
single largest driver of scope growth in this run (see §F).

**Cost, measured:** T3 is WP43–WP54 plus WP69–WP76 = **20 work packages**, none of which exists in
CONCEPT_V2 in any form. Worker 3 correctly returned WP7 `BLOCKED` on precisely this ground
(`BUILD_SPEC_CanvasV2.md` C7 T3 note).

---

### A6. "Ab P0 ist ein grüner Zwei-Vault-Lauf … Release-Bedingung" — **stated, retained in spec, and violated in practice**

**Concept says** (`CONCEPT_V2.md:830`): the green two-vault run with real Obsidian is a release
condition **from P0 onward**.

**BUILD_SPEC retains it verbatim** — C7 AC3 requires *"the gate is documented as a release condition
from P0 onward"*, and §7 names the T3 entrypoint as *"**this is the gate**"*.

**Actually true:** P0, P1, P2, P6 and PHASE VI are all recorded `✅ done`
(`DISPATCHER_STATE.md:46-54`) while `WP7 ⬜` and *"the gate not yet run"*. `DISPATCHER_STATE.md:518`
states it plainly: *"nothing has been exercised in real Obsidian. All greens are headless."*

**⚠ Flagged prominently, per the brief.** This is **not** reconciled by any ruling I could find. It
is not a contradiction between the two documents — both say the same thing — it is a **standing
divergence between the specification and the execution**, and it is the one place where the
initiative has proceeded past the concept's own stopping condition four phases in a row.

Mitigating and recorded: the reason the gate has not run is that seven separate blockers were found
each time a batch tried, all of which would have produced a **false green**
(`DISPATCHER_STATE.md:59-78`). Holding the gate rather than running it vacuously is defensible; but
shipping four phases under a concept clause that forbids it is a drift that should be named
explicitly rather than carried as a footnote.

---

### A7. Relay blob persistence is "optional" — **deliberately revised by user directive**

**Concept says** (`CONCEPT_V2.md:798`, Teil 13): `P6  Relay-Blob-Persistenz  (optional;
leerer-Raum-Fall)`. Teil 7 (`:593`) likewise: *"Relay-Persistenz (optional, E2E-kompatibel)"*.

**Actually true:** in scope and **done**. `BUILD_SPEC_CanvasV2.md:34`: *"Per explicit user
instruction, **P6 is in scope for this run** even though the concept marks it optional, and nothing
in CONCEPT_V2 is deferred."* `DISPATCHER_STATE.md:38`: *"Build everything from CONCEPT_V2 — nothing
deferred, including 'optional' P6."* `DISPATCHER_STATE.md:52`: `P6 … ✅ done`.

**Classification: deliberately revised**, by the owner, before the run started.

---

### A8. Phase order "nach Symptomdruck" — **superseded in practice**

**Concept says** (`CONCEPT_V2.md:781`): *"Reihenfolge nach Symptomdruck"*, then P0→P1→P2→P3→P4→P5→P6.

**Actually true:** completed order is P0 → P1 → **P6** → P2 → PHASE VI (interleaved) → T3 (in
progress). P3, P4 and P5 remain queued (`DISPATCHER_STATE.md:46-56`). The concept's optional last
phase shipped before three of its mandatory ones.

**Classification: deliberately revised.** Consequence worth stating: the concept's promise that
*"Jede Phase ist einzeln shipbar, einzeln testbar und lässt das System in einem besseren Zustand
zurück als davor"* (`:780`) is **partly unmet in the current tree** — see A9.

---

### A9. Three concept mechanisms are still absent from the shipped tree (measured)

These are not spec drift so much as **schedule reality**, but they matter because a reader of
CONCEPT_V2 alone would believe they exist. All four measured directly against the tree at `f3d2a1d`:

| CONCEPT_V2 claim | Measured state |
|---|---|
| Teil 8 (`:610-627`): *"Der R10-Text-Fallback **entfällt ersatzlos**"* | **Still live.** `CANVAS TEXT FALLBACK:` is emitted at `plugin/src/files/vault-events.ts:75`. The W5 split-brain door is open. (WP33, P3, chartered, not implemented.) |
| Teil 8 / §10: `MODE:` signature, host-authorised mode | **No production emitter.** Zero non-test files in `plugin/src` contain `MODE:`. (WP31/WP32, P3.) |
| Teil 9 (`:648-657`): `Y.UndoManager` per client and doc, `trackedOrigins = {CAPTURE_OP, CAPTURE_NET}` | **Not present.** (WP38, P4.) |
| Teil 5 (`:493-503`): op-capture as the *"primäre, latenzarme Quelle"* | **Off.** `useCanvasBinding: false` at `plugin/src/types.ts:65`, frozen there by S10 until WP40. |

**Conversely, confirmed retired:** `LOCK DENIED:` has **zero** occurrences in non-test `plugin/src`
— WP21 landed as Teil 9 specified.

---

## B. Added — implemented behaviour with no basis in CONCEPT_V2

**This section is split on the axis the brief names as most important. The split is by *what the
work is for*, not by *where the file lives* — and §B3 records why those two are not the same thing
in this codebase.**

### B1. PRODUCT behaviour with no basis in CONCEPT_V2

Behaviour a user or a peer can observe, that the concept does not describe.

| # | Addition | Why it was added | Where |
|---|---|---|---|
| **P-1** | **I11 REFUSAL NEVER DESTROYS** as an enforced runtime mechanism: a per-path *refused set*, a **withheld** `.canvas` write-back while that set is non-empty, automatic lifting when it empties, and the `SEED REFUSED:` / `SEED RESTORED:` signature pair. | Refusal at a seed boundary composed with the single-writer flush into permanent, silent deletion from the user's own file (E2 ruling). Every step was individually chartered and individually correct; the **composition** was not. | Spec: `BUILD_SPEC_CanvasV2.md:193` (§4.5), C63 `:722-743`, §10 signature table. Source: `plugin/src/files/canvas-persistence.ts:120`, `:173`, `:315`, `:334`, `:568`; `plugin/src/files/canvas-sync.ts:1188`, `:1270-1283`, `:1579`, `:1839`, `:3216`; `plugin/src/main.ts:1125`, `:1383`. |
| **P-2** | **Fail-closed conflict-copy writing.** `conflictCopyPath` is deterministic and day-granular, so a second conflict on the same board on the same day names the same file. Now: identical body = idempotent re-run; anything else **throws**, and the refusal **cancels the adoption** so nothing is lost. | The concept (`:581-584`) specifies *that* the loser archives `<name>.conflict-<datum>.canvas`; it does not consider two conflicts in one day, where the file already there is another loser's only copy. | `DISPATCHER_STATE.md:513-516`; `plugin/src/files/canvas-import.ts:78`, `:319`. |
| **P-3** | **Epoch ceiling refusal.** `normalizeEpoch` moved from `Number.isInteger` to `Number.isSafeInteger`; `nextEpoch` **throws** at the ceiling rather than returning an unbeatable value; `bumpEpoch` computes it *before* opening its transaction so a refusal cannot half-write `meta`. | `Number.isInteger` admits `2**53`, where `n + 1 === n`. `nextEpoch`'s pinned *"strictly greater for every input"* was therefore **false**, and one corrupt cell would freeze a board's epoch forever — *"the only symptom being that imports quietly stop winning"*. The concept assumes monotonicity as a given (`:578`). | `DISPATCHER_STATE.md:505-511`; `plugin/src/canvas/canvas-epoch.ts` (731 lines). |
| **P-4** | **The flat-vs-register precedence rule.** In P1 a doc legitimately holds **both** spellings of the same fact (the V1→V2 migration is deliberately additive, and every live writer still authors flat keys). Precedence is now an explicit, phase-scoped rule — **the flat key wins** — plus a named regression test asserting *insertion-order independence*, not merely the value. | `decodeV2RecordToFlat` resolved the collision by `Y.Map` insertion order. CONCEPT_V2 has **no concept of a dual-vocabulary period at all**: Teil 4 presents the register model as simply replacing the flat fields. | `BUILD_SPEC_CanvasV2.md` C17 AC5 + the normative block at `:537-545`. |
| **P-5** | **Sidecar exclusion at the file-operation channel, in both directions**, with a receiver that refuses independently of the sender. | Teil 7 (`:555-557`) says only *"Ausgeschlossen aus Manifest und Sync … und aus jeder Text-Sync-Erkennung."* That turned out to be three surfaces, not one: WP26 closed the manifest arm; the **file-op broadcast arm** (`file-ops.ts:461-475` outbound, `control-handlers.ts:48-53` inbound) is a fourth. The inbound arm is *"unconditionally reachable: any peer can put the op on the wire and today's gate admits it"*. | `BUILD_SPEC_CanvasV2.md` C68 `:909`; `DISPATCHER_STATE.md:496-498`. **Chartered, NOT implemented** (WP68 ⬜). |
| **P-6** | **The either-side asymmetry note.** `control-handlers.ts:49-50` uses `paths.some(isSharedPath)` while every other op type uses the strict all-paths form; and `isPathSafe` rejects traversal only — it does **not** exclude the config directory. | Neither fact appears anywhere in CONCEPT_V2. Both are standing traps for any newly added op type. | `DISPATCHER_STATE.md:180-184`. |

### B2. VERIFICATION / INFRASTRUCTURE with no basis in CONCEPT_V2

Nothing here changes what a user sees. This is the bulk of the added volume.

| # | Addition | Why it was added |
|---|---|---|
| **V-1** | **PHASE T3 — the entire real two-instance Obsidian host layer** (WP43–WP54: vault registry, per-vault control-port provisioning, launch/attach lifecycle, readiness + identity handshake, scratch-canvas data safety, teardown/orphan reclaim, real quiescence + file-level oracle, run matrix, stale-view surface, adapter interaction tap, gesture driver, `CAPTURE_TRIGGERS` verdict ledger). | A5: the rig CONCEPT_V2 assumed existed does not. |
| **V-2** | **The T3 gate's own preconditions** (WP69–WP76): a one-shot `e2e` esbuild mode that terminates; instrumented-build install; settings provisioning + rig-owned local relay; agent-mediated run plan; the `canvas.setFlag` borrow-clobber; and four separate repairs to the matrix driver's own signal handling. | Each was found by a batch that **tried to run the gate** and could not, or could only have produced a false green. |
| **V-3** | **PHASE VI — verification integrity** (WP55–WP62, WP64–WP67): the blind-set execution gate; retro-application of that gate to every prior blind claim via `BlindVerificationLedger.md`; the tombstone-blind instrument sweep; the hollow-fixture sweep; falsifiability pins for repairs that were not falsifiable. | The blind runner **could report a never-executed set as green**. CONCEPT_V2's Teil 14 assumes tests are trustworthy and only asks for more of them. |
| **V-4** | **The C23 AC5 intent-trace oracle** and its **fault-injection matrix** (200 scenarios × 10 windows per row). | See §C1 — this is the strongest single measurement the project produced. |
| **V-5** | **A body of §7 governance machinery that CONCEPT_V2 has no analogue for**: the licensed-deletion ledger; the amendment ledger with a strictness-may-not-fall rule; **five** distinct fixture/assertion licence classes; the fenced-off-claim rule; the *"a ledger row is a measurement, not a timeless fact"* rule; the named-intermittent register; the unfalsifiable-repair register; concurrent-batch attribution. | Every one was added after a specific incident, each named in its own `<!-- Updated -->` comment. |
| **V-6** | **Data-safety gates on the owner's live vaults**: D16 (fresh uniquely-named scratch canvas per run, vault fingerprint before/after as an *acceptance criterion*), plus an **independent second leg** — two `data.json` sha256 values recorded in §7 that must match post-teardown, *"and the comparison must not consult the rig's `data.json.e2e-original`, its `.e2e-provision.json` marker or any other rig bookkeeping"*. | The gate would otherwise run against real working vaults. `DISPATCHER_STATE.md:93-107` records the confirmed live hazard: `sharedFolder = ""` in **both** vaults means the whole vault is shared, and a guest's `cleanupStaleFiles` would `trashFile` everything absent from the host's manifest. |
| **V-7** | **The hard-won-rules register** (`DISPATCHER_STATE.md:418-447`), twelve rules, each traceable to a specific failure in this run. | Not in CONCEPT_V2 in any form. |

### B3. ⚠ The product/verification boundary does **not** coincide with the source-tree boundary

This is worth stating explicitly because it is the one place the clean split above can mislead.

WP72, WP75 and WP76 are **verification** work by purpose, but they modify **`plugin/src/testing/`**,
which is production *source*. It is tree-shaken out of the production bundle — but the mechanism
that proves it is tree-shaken was itself found to be a check that could not fail:

> *"`__LS_E2E__` occurs **zero times in the e2e bundle too**: esbuild's `define` substitutes the
> identifier at compile time […] A count of zero is consistent with every build."*
> (`DISPATCHER_STATE.md:322-331`)

The distinguishing signature is now the marker triple (`e2eControlPort`, `LIVESHARE_E2E`,
`e2e-control`) — production **0/0/0**, e2e **1/1/2** — plus the size difference (626 711 B vs
~3.6 MB). Consequence, recorded: **W4-1 is NOT discharged** and must be re-established against a
freshly built bundle.

**Reading rule for anyone using this report:** "verification, therefore harmless to the product" is
only sound once the tree-shake claim is re-established. Today it is not.

---

## C. Deepened — the concept was right but incomplete

### C1. "Convergence is not correctness" — argued in the concept, **measured** in the run

**The concept states the principle** (`CONCEPT_V2.md:193-194`, W3): *"sonst konvergieren alle
Replikate korrekt auf einen ungültigen Zustand ('convergence is not correctness', das eigene Problem
2, konsequent zu Ende gedacht)"* — and it says so as an argument, in one clause.

**What turned out to be necessary:** a **fifth assertion family** for the fuzzer, and a measurement
proving the other four are blind. `BUILD_SPEC_CanvasV2.md` C23 AC5 plus the fault-injection matrix
at `:672-720`:

| Injected fault | intent-trace | SEC | schema | bytes | shadow | I7 |
|---|---|---|---|---|---|---|
| none (control) | 0 | 0 | 0 | 0 | 0 | 0 |
| **1. insertion-order flat-vs-register** | **2913** | **0** | **0** | **0** | **0** | 0 |
| 2. delete suppression broken | 854 | 0 | **863** | 0 | 0 | 0 |
| 3. partial capture removes an unmentioned field | 31221 | 0 | 0 | 0 | 0 | **2587** |
| 4. a replica pushes a stale field | 339 | 0 | 0 | 0 | **372** | 0 |

Row 1: over a *provably corrupt* document, **SEC, schema, byte equality and shadow consistency are
all four green** and only the intent-trace oracle fires. The SEC and byte-equality columns are zero
in **every** row. Two consequences are now binding rather than advisory: AC5 *"may not be retired"*,
and *"**no convergence oracle may be the *only* oracle on a correctness property, anywhere in this
spec**"*.

**What the concept assumed:** that property-based fuzzing over interleavings (Teil 14.1,
`:814-826`) would suffice, listing exactly four assertions — SEC, schema invariants, byte equality,
shadow consistency. All four are in the table above and all four are **zero on row 1**.

### C2. The Surface-Shadow — one paragraph in the concept, ~1130 lines in the tree

**Concept** (Teil 5, `:430-447`) describes the shadow in three lines of pseudo-table plus four diff
rules, and calls it *"das existierende `canvasApplied`, erweitert auf Feld-Granularität"*.

**What was necessary** (measured, `plugin/src/canvas/canvas-shadow.ts` = **1130 lines**):
- a **three-state** per-record presence model — *present with known fields*, *known-absent*,
  *unknown (never observed on this surface)* — which the concept does not distinguish at all, but
  which its own rule 3 silently requires (`:462-467`: delete-intent only if the record *"im letzten
  Apply an den View übergeben wurde"*);
- discarded-staleness as an **explicit output category**, not a silent drop (C2 AC1) — otherwise
  the mechanism has no observable and no discrimination test;
- `surfaceState` as a fourth input to the pure function, carrying *which records were handed to the
  view in the last apply* (C2 interfaces);
- per-field apply receipts such that an `"interacting"` skip leaves exactly the affected record's
  fields un-advanced (C5 AC2) — the concept says this in one sentence (`:530-532`), and it turns out
  to be the thing that makes shadow and reconcile provably **one** structure with no drift (C5 AC1).

### C3. Canonical serialisation — the concept's four bullets became a precedence problem

Teil 10 (`:661-688`) gives four rules. What turned out to be necessary beyond them:
- **omission** semantics for optional keys — never `null`, never `""`, *"including via the verbatim
  flat-key pass"*, so a file with side-less edges *"must survive parse → doc → serialize
  **byte-identically**, so such a file does not churn on its first write"* (C17 AC5);
- the **flat-vs-register precedence rule** (P-4 above) — a whole vocabulary-collision problem the
  concept does not know exists;
- a regression test asserting **insertion-order independence** rather than the value, because
  *"asserting only the value would let the bug back in"*.

### C4. Atomic registers — the *migration* was the hard part, not the model

Teil 4's argument (`:389-397`) is about granularity and is correct. What it does not address: the
V1→V2 migration is **deliberately additive** (C8 AC2 — flat keys explicitly not removed), so both
spellings coexist for the whole of P1 and beyond. Everything in C3 above follows from that.

### C5. Tombstones — the concept's undo argument survived, its GC clause did not get the same care

Teil 4 (`:399`) is right that *"Undo eines Delete = `on:false` + kein Datenverlust, weil die
Feldcontainer nie zerstört wurden"*, and the same line then says *"Records mit `on:true` älter als
der Kompaktionshorizont werden bei der Sidecar-Kompaktion physisch entfernt."*

Implemented as `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS`, *"tombstones are removed together with
their records and never when `on:false`"* (`ImplementationReport_WP25.md:217`), with C25 AC3
requiring that *"a compaction never changes the doc's observable state"*.

**⚠ Unverified concern, raised not asserted.** After physical removal, the container the undo
argument depends on is gone; and a peer that has not compacted still holds both the record and its
tombstone. Neither CONCEPT_V2 nor BUILD_SPEC states what the composition is (I searched for
`resurrect` and `horizon` across the spec, the WP25 charter and its report; the four hits are all
about capture-side resurrect-blocking, not about cross-replica GC). It is plausible that Yjs' own
delete-set makes this a non-issue — **I could not establish that either way without running
anything, so this is recorded as an open question, not a defect.**

### C6. The Teil-14 gate — the concept named the debt, the run discovered its depth

Teil 14.2 asks for the run and for empirical `CAPTURE_TRIGGERS` confirmation. What was actually
required before a run could mean anything (each found by a batch that tried):

- **D18**: the probe must drive the **input layer**, never synthesise the signal — *"a probe that
  synthesises `setDragging(false)` proves that the harness can call a function, not that Obsidian
  calls it — it would restate the R2 assumption in a green test."*
- **D17**: convergence must be asserted on the **`.canvas` file bytes** as well as on the doc,
  because with real Obsidian there are three projections and *"a doc-only oracle passes green while
  the file diverges."*
- **D14**: Obsidian is single-instance; two vaults are two *windows* in one process tree, so ports
  must come from the per-vault `data.json`, never from `process.env`.
- Then WP73/WP74/WP75/WP76, four separate repairs to the gate's *own* driver.

### C7. The one concept claim that turned out to be more load-bearing than it looks

Teil 5 (`:503`): *"V2 funktioniert vollständig ohne private API auf dem Capture-Pfad."*

This survived and is now the reason the gate is testable at all. `DISPATCHER_STATE.md:80-91`
(ruling): both vaults have `useCanvasBinding = false`, so the live capture path is
`vault.on("modify")` → `handleLocalModify` — *"and that is where CONCEPT_V2's surface-shadow repair
actually lives"* (`canvas-sync.ts:2736`, `:2792-2801`). The Dispatcher records having got this
wrong itself: it had told Worker 2 the fix lives on `captureLocal`, which belongs to
`CanvasBinding` and is switched off — *"A WP scoped that way would have chartered a repair for the
**switched-off path**."*

---

## D. Invariants — the current full set

CONCEPT_V2 Teil 3 (`:325-352`) does **not** define I1–I10. It defines **I6–I10** and states
*"I1–I5 bleiben unverändert"* — I1–I5 live in `ARCHITECTURE.md` §"The five invariants" and are
restated in `BUILD_SPEC_CanvasV2.md:191`.

**The current full set is I1–I11. Eleven, not ten.** I searched `workflowArtifacts/` and
`plugin/src/` for `I12` and found **zero occurrences**, so I11 is the only addition.

| # | Statement | Status |
|---|---|---|
| I1–I5 | ONE OWNER · ONE WRITER · DOC IS TRUTH · NO LOOPBACK · DEGRADE | preserved unchanged (`BUILD_SPEC_CanvasV2.md:191`) |
| I6–I10 | INTENT IS SHADOW-RELATIVE · OBSERVATION NEVER DELETES · ATOMIC IS WHAT BELONGS TOGETHER · HISTORY IS THE TRUTH · ONE MODE PER ROOM | from CONCEPT_V2 Teil 3, binding (`:192`) |
| **I11** | **REFUSAL NEVER DESTROYS** | **new, added during the run** |

### I11 — REFUSAL NEVER DESTROYS

**Statement** (`BUILD_SPEC_CanvasV2.md:193`, verbatim):

> *"A record refused at ingest is not admitted to the shared state; it must not, *by that refusal*,
> be removed from the source it was read from. Where the source is a user file and the doc is the
> writer of that file, the **write-back is withheld** rather than the record dropped. Rejection and
> deletion are different acts, and no composition of correct steps may silently perform the second
> while intending only the first."*

**What forced it.** The E1 ruling (A1) found that a legal side-less edge was refused at the seed;
the refusal then composed with `CanvasPersistence`'s flush and **deleted the edge from the user's
own `.canvas` file**. C63's rationale is explicit that this is not a bugfix: *"Every step in the
loss path was individually correct and individually chartered: C18 AC1 refuses invalid local
records; C14 judges validity; C17 projects the doc to the file; `CanvasPersistence` is the single
writer (I3). The defect is in the **composition**."*

**Its derivation from CONCEPT_V2** is recorded (`:193`): Teil 7's *"Destruktion wird von einem
Timing-Nebeneffekt zu einer informierten Entscheidung."* (`CONCEPT_V2.md:590-591`). I11 generalises
that sentence from the *host re-seed* to *every refusal*.

**Where it is enforced.** Owner: **WP63** (implemented; `ImplementationReport_WP63.md` present).
Verifying WPs per `§4.6:216`: WP20, WP23, WP7 (real-vault fingerprint / §7 data-safety gate).

Enforcement sites measured in the tree at `f3d2a1d`:

| Site | Role |
|---|---|
| `plugin/src/files/canvas-persistence.ts:120`, `:173`, `:315`, `:334` | the per-path refused set, the withhold guard placed **ahead** of the write, and the "is this path suspended" predicate |
| `plugin/src/files/canvas-persistence.ts:568` | the ledger that records refusals for the write path |
| `plugin/src/files/canvas-sync.ts:1188`, `:1270-1283`, `:1579`, `:1839`, `:3216` | the machine-readable refusal signature; the host-seed refused set; the optional caller-side withhold hook |
| `plugin/src/main.ts:1125`, `:1383` | the withholding `SeedRefusalLedger` wiring |
| `plugin/src/files/canvas-import.ts:78`, `:319` | fail-closed, legible import + archive channel |
| `plugin/src/session/commands.ts:213` | user notification on refusal |
| `plugin/src/testing/e2e-control.ts:416`, `:457` | the control surface must not half-apply |

**I11 has since propagated as a design principle beyond its owning WP** — it is cited as a binding
constraint in charters written *after* it: WP68 (`TaskCharter_WP68:64`, `:93` — a refused rename
costs no file at either end), WP75 (`:102`, `:145`, `:175`, `:221` — a truthful refusal must be
distinguishable from a fault), WP76 (`:142`, `:224`), and it is invoked by the Dispatcher as the
governing instinct in an unrelated ruling: *"a rewrite that changes nothing semantically can still
change bytes […] it is the same instinct as I11: do not touch what you do not need to touch"*
(`DISPATCHER_STATE.md:240-244`).

**Test coverage present in the tree:** `plugin/src/__tests__/v2/wp63/harness.ts`,
`v2/wp30/test_tp09_refusals_are_fail_closed_visible.test.ts`,
`v2/wp18/test_tp03_capture_boundary_rejects_invalid_new_record_visible.test.ts`,
`wp72/test_tp1_*`, `wp72/test_tp3_*`. Blind sets exist for WP63 in both sets and carry **CONFIRMED**
ledger rows (backfilled by B13, `BlindVerificationLedger.md:199-203`).

**Not a twelfth invariant, but worth flagging as a candidate.** The C23 fault-injection matrix's
binding consequence — *"no convergence oracle may be the only oracle on a correctness property,
anywhere in this spec"* — has invariant force and invariant scope, but is recorded as a §5
consequence rather than as an invariant with a number. If the final report wants a complete
invariant register, this is the one item that arguably belongs in it and is not there. **Stated as
an observation; I found no ruling either way.**

---

## E. Structural / architectural changes — concept versus specified versus built

Legend: **C** = what CONCEPT_V2 describes · **S** = what BUILD_SPEC specified · **B** = what is in
the tree at `f3d2a1d`.

### E1. Doc identity — GUID + epoch

- **C** (Teil 7, `:569-591`): doc id becomes `__canvas__:<guid>`, path becomes an attribute;
  `meta.epoch` monotone and host-incremented; higher epoch wins completely, loser archives
  `<name>.conflict-<datum>.canvas`. Closes R4, R5 and the rename hole.
- **S**: **narrowed on one axis the concept did not distinguish.** D6 (`:92`) and S6 (`:119`): only
  the **Y.Doc id** becomes GUID-based. *"Every registry, the ownership predicate, the mute registry,
  `noteExternalDiskWrite(rawPath, …)`, and the **awareness field shape including `canvasPath`** stay
  path-keyed and unchanged."* This preserves every path-keyed contract prior rounds proved. C27 AC4
  additionally requires the two unguarded bare-path `getDoc` call sites be closed *"verified by an
  explicit test rather than by a reachability argument"*.
- **B**: implemented (WP27, WP28). `plugin/src/canvas/canvas-epoch.ts` (731 lines) —
  **substantially more than the concept's one paragraph**, because of P-3 (the safe-integer
  ceiling) and P-2 (fail-closed conflict copies). `EPOCH CONFLICT:` has a production emitter.
- **Drift worth naming:** the concept treats "higher epoch wins" as a total order over a scalar. The
  implementation had to add a **refusal state** (`nextEpoch` throws) that the concept has no place
  for — because the concept's monotonicity assumption is false at the float ceiling.

### E2. The sidecar update log

- **C** (Teil 7, `:541-567`): `.obsidian/liveshare/state/<guid>.yhistory` append-only,
  `<guid>.ycheckpoint` periodic compaction, `index.json` mapping. *"Ausgeschlossen aus Manifest und
  Sync … und aus jeder Text-Sync-Erkennung."* Corrupt/missing sidecar is the defined degradation.
- **S**: paths unchanged. C24 adds an ordering constraint the concept does not state — *"truncates
  the history only after the checkpoint is durably written — **never the reverse order**"* — and
  requires all file I/O injected, importing neither Obsidian nor `node:fs`. C25 AC1 sharpens "load
  before sync" into a **sequencing** requirement. C26 requires the exclusion be *"one predicate with
  one definition"* asserted *"at each of the exclusion consumers, not only at one"*.
- **B**: `plugin/src/files/canvas-sidecar.ts` (464 lines) + `canvas-sidecar-lifecycle.ts`
  (491 lines). `SIDECAR:` has a production emitter.
- **Drift:** the concept's one-bullet exclusion is **three surfaces**, and the third is still open.
  WP26 closed the manifest arm; the **file-op channel** (P-5) is chartered as WP68 and **not
  implemented**. Its inbound arm is *"unconditionally reachable"*. Two implementation facts the
  concept could not have anticipated are recorded in `ImplementationReport_WP25.md`: the sidecar is
  loaded only when an identity store is present (otherwise the identity token is the canonical path
  and *"naming sidecar files after a path would leak `.canvas` into the sidecar directory and lose
  the history at the first rename"*), and `CanvasSync.destroy()` detaches docs but does not destroy
  the shared lifecycle.

### E3. Seed-once

- **C** (Teil 3 I9, `:342-346`; Teil 7 `:558-560`): a doc is seeded from a file exactly once in its
  life; `coldOpen` seeds only when **neither** sidecar **nor** any peer knows the doc.
- **S**: C29 restates it, and adds two constraints the concept omits: AC3 (*"A host rejoining with
  an older local file does not remove any peer's records"* — stated as an assertable property, not a
  consequence) and AC4 (`ColdOpenResult` outcomes stay observable **and** the
  `coldOpen`-after-`waitForSync`-before-`start()` ordering is preserved — a prior-rounds contract
  the concept never mentions).
- **B**: implemented (WP29). `plugin/src/files/canvas-seed-decision.ts` — **79 lines**, i.e. the one
  place where the concept's design turned out to be *exactly* as small as advertised.

### E4. The import command

- **C** (Teil 7, `:586-591`): *"'Aus Datei importieren' (I9): epoch++, Datei seeden, Peers folgen der
  Epoch-Regel — mit Bestätigungsdialog, der sagt, wessen Arbeit das überschreibt."*
- **S**: C30 adds the exclusivity claim (AC1: it is *"the **only** way a file overwrites an
  already-living doc"*), a cancel-writes-nothing criterion (AC3), and an availability rule the
  concept does not state (AC4: unavailable for a path the client does not own or is degraded on).
  §6 records it as the initiative's **one** new user command; §1 fixes its UI string as **German**.
- **B**: implemented (WP30). `plugin/src/canvas/canvas-import-command.ts` (256 lines) +
  `plugin/src/files/canvas-import.ts` (360 lines). Beyond spec: the fail-closed archive channel
  (P-2) and the I11 refusal notification at `session/commands.ts:213`.

### E5. Relay blob persistence

- **C** (Teil 7, `:593-606`): optional; content-blind blob store per `roomId:docId`; ciphertext
  stored without being understood; replayed before live traffic; client checkpoint frame allows
  truncation. *"Beides komponiert, keines ist Voraussetzung des anderen."*
- **S**: mandatory this run (A7). C41 AC4 adds an explicit **no-collateral** criterion (*"no other
  relay subsystem (rooms, permissions, auth, audit) changes behaviour"*); C42 AC3 adds
  **backward compatibility** with a relay that has no blob support — *"the client detects the
  absence and falls back to the sidecar + peer path with no error surfaced to the user"* — which the
  concept does not consider at all. S12 lifts the "do not touch `server/`" freeze for WP41/WP42
  **only**, and §7 makes any other `server/` edit an abort criterion.
- **B**: implemented (WP41, WP42). `server/src/persistence.ts` present.
- **⚠ Open, undecided** (`DISPATCHER_STATE.md:218-220`): *"**Relay binds on all interfaces** —
  `server.listen(port)` with no host argument (`server/src/index.ts:236`). Accept for the run, or
  charter a `server/` change under a WP permitted to touch it […] **Undecided.**"*

### E6. Mode consensus

- **C** (Teil 3 I10 `:347-351`; Teil 8 `:610-627`): mode per path is shared, host-authorised state
  in the manifest (`path → {mode, guid}`); the R10 text fallback *"entfällt ersatzlos"*; a client
  that cannot meet the mode degrades to Receive-and-Persist.
- **S**: C31–C34 restate it and add one unification the concept does not make — C32 AC4: *"The
  schema-major-mismatch degradation from WP8 is unified into this single mode — there is **one**
  degradation state, not two."* CONCEPT_V2 Teil 12 (`:773`) treats the mixed-version case
  separately. C34 AC4 adds that the banner must not obstruct canvas interaction (also §2
  should-have).
- **B**: **chartered only. Not implemented.** Measured: `MODE:` has zero production emitters;
  `CANVAS TEXT FALLBACK:` is still emitted at `plugin/src/files/vault-events.ts:75`.
- **Consequence for any reader of the concept:** W5 (split-brain: *"zwei unverwandte Dokumente im
  selben Raum, für dieselbe Datei, auf verschiedenen Clients"*) is the one W-number from Teil 2 that
  is **entirely unaddressed in the shipped tree**.

---

## F. Numbers — concept scope versus measured reality

**Method note, per the brief.** `DISPATCHER_STATE.md` itself warns that *"A ledger row is a
measurement, not a timeless fact"* (`:426`) and that a recorded figure is not a current one. I
therefore separate **(a)** figures I measured statically against the tree at `f3d2a1d` today from
**(b)** figures quoted from artefacts, and I flag where they disagree. I did **not** run the test
suite (read-only constraint), so no vitest-collected count in this report is my own.

### F1. Work packages

| Figure | Value | Source |
|---|---|---|
| Phases in CONCEPT_V2 Teil 13 | **7** (P0–P6) | `CONCEPT_V2.md:783-799` |
| Phases actually chartered | **10** — P0–P6 **+ T (Teil-14 suites) + T3 + PHASE VI** | `BUILD_SPEC_CanvasV2.md:36-46`, §5 headings |
| Worker 2's original decomposition target | 20–35 WPs | §9 *"On the count"* |
| Worker 2's first honest result | **42** | §9 *"the honest result is 42"* |
| Count after T3 | 54 | §9 amendment 2026-08-01 |
| Count after PHASE VI | 58 | §9 amendment 2026-08-01 |
| … 63 (WP63/I11) → 66 → **68** (a *"wrong by one"* correction: WP65 had a §5 component and a §9 row throughout but was never counted) → 69 → 70 → 73 → 74 → 75 → **76** | **76** | §9 amendment chain, 2026-08-02 → 2026-08-04 |
| **Chartered, measured** | **76** — `TaskCharter_WP*.md` files present, numbered WP1–WP76 with **no gaps** | my count, tree `f3d2a1d` |
| **Implemented, measured** | **54** `ImplementationReport_WP*.md` files: WP1–30, 41–49, 55–64, 67, 69, **70**, 72, 73 | my count |
| **Implemented and accepted** | **53** — the Dispatcher's own list omits WP70, which is `⚠ attempt 2 done, RISKY` with two escalated blind failures | `DISPATCHER_STATE.md:57`, `:65` |
| **Not implemented** | **23** — WP7, 31–40, 50–54, 65, 66, 68, 71, 74, 75, 76 | derived; consistent with `DISPATCHER_STATE.md:46-56` |

**⚠ Verifiable internal inconsistency in the BUILD_SPEC.** Its own header (`:10`) still reads:

> **Status:** SPEC_COMPLETE · **Work packages:** 54 (WP1–WP54) · **Phases:** P0–P6 + Teil-14 test rig (incl. **T3**, WP43–WP54)

That is **stale by 22 work packages**. §7's project-level Definition of Done was carried forward
correctly and reads *"all **76** WPs DONE"*; §9's amendment chain also lands on 76. So the document
disagrees with itself in its own status line, which is the first thing a reader sees. This is a
report finding, not something I changed.

### F2. Invariants

| Figure | Value | Source |
|---|---|---|
| Defined in CONCEPT_V2 Teil 3 | **5** new (I6–I10), *"I1–I5 bleiben unverändert"* | `CONCEPT_V2.md:327-352` |
| Total set the concept describes | 10 | I1–I5 in `ARCHITECTURE.md` |
| **Total set now** | **11** | `BUILD_SPEC_CanvasV2.md:193`, §4.6 `:216` |
| I12 or beyond | **none** — zero occurrences across `workflowArtifacts/` and `plugin/src/` | my grep |

### F3. Tests — and this is where the recorded figures have already expired

| Figure | Value | Source | Status |
|---|---|---|---|
| Concept's stated baseline | *"Die aktuellen **674** Tests"* | `CONCEPT_V2.md:311` (W10) | historical |
| Concept's historical warning | *"der Two-Writer-Defekt überlebte **526** grüne Tests"* | `CONCEPT_V2.md:309-310` | historical |
| BUILD_SPEC §7 baseline | **674 tests / 35 files** (plugin), **122 / 10** (server) | `BUILD_SPEC_CanvasV2.md` §7 | the spec's floor |
| Dispatcher, "last **quiet**" measurement | **1470 / 1470 pass / 0 fail, 253 files**; server **149/149** | `DISPATCHER_STATE.md:466-474` | pre-B4 |
| Dispatcher, latest recorded | **1687 passed / 0 failed, 283 files**, reported at WP28 attempt 2, tree **not quiet** | `DISPATCHER_STATE.md:450-457` | **expired** |
| **Test *files* present now (static)** | **303** `*.test.ts` under `plugin/src`; **18** under `server/src` | my count, `f3d2a1d` | **+20 files beyond the 283 recorded** |
| **`it(`/`test(` occurrences (static)** | **≈1753** in `plugin/src` | my count | **approximate only** — a lexical count, not a vitest-collected count; `it.each` expands and comment/string matches are included. Directionally it confirms the 1687 figure is now low. |
| Blind-set test files | **540** `*.test.ts` + **210** `*.py` under `workflowArtifacts/canvas-v2/tests/` | my count | — |

**Conclusion for the report: do not quote 1687/283.** Both figures were taken on a tree that was
explicitly *not quiet*, four commits and at least one batch ago. The tree is quiet **now**
(`git status --porcelain` empty at `f3d2a1d`), so a clean measurement is available for the first
time in a while and has not been taken. Rule 5 applies to the Dispatcher's own numbers.

### F4. Verification coverage — the gap the ledger's own tally cannot show

| Figure | Value | Source |
|---|---|---|
| Ledger tally | **58 rows · 58 CONFIRMED · 0 DIVERGENT · 0 VACUOUS · 0 UNRUNNABLE** | `BlindVerificationLedger.md:46-53`; matches `DISPATCHER_STATE.md:474` |
| Coverage claimed | 26 of **31** WP folders; 5 named uncovered (WP19–WP23) | `BlindVerificationLedger.md:166-176`, `:220-228` |
| Directory state when that was written (2026-08-02) | **31** folders per set = **62** `(WP,set)` pairs | ledger, B13 measurement |
| **Directory state now (static, `f3d2a1d`)** | **42** folders per set (identical sets) = **84 pairs** | my count |
| **Pairs carrying no ledger row** | **26** | derived: 84 − 58 |

New folders that appeared after the ledger's last update, measured: **WP24, WP25, WP26, WP27, WP28,
WP29, WP30, WP51, WP69, WP70, WP72** (11 per set). **None of them is in the ledger.** The ledger's
own note anticipated exactly this — *"The folder count moved again during B13 (27 → 31) […] This is
now the third consecutive charter to find the filesystem ahead of it"* — and it is now the fourth,
fifth and sixth time.

**Also material:** WP73's blind sets are **not in this repository at all**. Its subject
(`liveshare_e2e_mcp_server.py`) lives in the AgenticWorkspace repo, so *"WP50's and WP73's changes
land in a second repository, outside this branch and outside §7's commit/abort accounting"*
(`DISPATCHER_STATE.md:361-367`). §7's accounting was extended to cover it; the ledger was not.

### F5. The "green that cannot fail" tally — the run's own most repeated finding

`DISPATCHER_STATE.md` and §9 count the instances explicitly. Reconstructed:

| # | Instance | Where |
|---|---|---|
| 1–5 | five classes named in hard-won rule 1 | `DISPATCHER_STATE.md:418-421` |
| 6 | WP25 blind2 tp01: an ordering oracle stalled at the wrong seam — **first located in a *gate* rather than an assertion**; found because *"a perturbation that changes nothing is a finding, not a null result"* | rule 11, `:435-443` |
| 7 | `_run_case` discards `applied` at all call sites — **in the gate's own driver** | WP73, `:394-396` |
| 8 | `_open` / `_wait_both` discard their results | WP74, `:308-313` |
| 9 | `simulateEdit` returns a literal `{applied:true}`; `session.info` discarded — **first to hollow a WP already reported as closed** | WP75, §9 |
| — | **WP76 is explicitly NOT another instance** — it is *"the prior question"*: `simulateEdit` writes straight into the shared `Y.Doc`, so the matrix measures `doc → relay → doc` and nothing else, while the driver's own docstring claims the capture path | §9 WP76 block |

CONCEPT_V2 Teil 14 anticipates **one** verification failure mode — that example tests check ∃ where
convergence needs ∀ (`:316-318`). The run found a second, orthogonal one it does not name: **a test
that runs and reports green while being structurally unable to fail.** That class produced **at
least 9 chartered work packages** (WP55–58, WP64, WP66, WP67, WP73, WP74, WP75) and one whole phase.

---

## Summary of contradictions and unverified items

### Open contradictions (no ruling reconciles them)

1. **BUILD_SPEC's status line (`:10`) says 54 WPs; its own §7 and §9 say 76.** Internal, mechanical,
   and the first line a reader sees.
2. **CONCEPT_V2 Teil 14 makes a green real-Obsidian run a release condition from P0; four phases
   have been closed without one.** BUILD_SPEC does not weaken the clause — it restates it — so this
   is a spec-versus-execution divergence, acknowledged at `DISPATCHER_STATE.md:518` but never ruled
   on as a deviation.

### Contradiction *inside* CONCEPT_V2, since ruled

3. **Teil 4 (`:395-396`) makes `side` a mandatory endpoint component; Teil 11 (`:699`) omits it from
   edge validity.** Resolved by the E1 ruling in favour of Teil 11 — but only after the stricter
   reading had already deleted user data.

### Marked unverified — I could not establish these without running anything

- **Cross-replica behaviour after tombstone GC** (§C5). Whether physical removal at the compaction
  horizon can be reverted, or resurrected, by a peer that has not compacted. Not addressed in
  CONCEPT_V2, BUILD_SPEC, the WP25 charter or its implementation report.
- **The current true test count.** ~1753 lexical `it(`/`test(` sites across 303 files is a static
  approximation, not a collected count.
- **Whether `plugin/src/testing/` is genuinely tree-shaken out of the production bundle.** The
  original check (`__LS_E2E__` count) provably cannot fail; the replacement (marker triple) has not
  been run against a freshly built bundle. **W4-1 is not discharged.**
- **The outbound arm of the WP68 sidecar rename leak.** Depends on Obsidian emitting a vault rename
  whose destination is under `.obsidian/` — *"never observed, cannot be until the gate runs"*
  (`DISPATCHER_STATE.md:175-178`).
- **Whether `TaskCharter_WP64` and `TaskCharter_WP59` are correctly `SPEC_COMPLETE` while apparently
  closed.** `DISPATCHER_STATE.md:226-227` flags both as needing *"a sweep, not a guess"*; I did not
  perform that sweep.

---

*Fragment A ends. Read-only analysis; no file outside this fragment was created or modified.*
