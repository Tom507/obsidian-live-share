# CONCEPT_V2 Amendment Set A — Dispatcher Disposition

> **Status: RECORDED, NOT SCHEDULED.** Owner's direction 2026-08-04: *"note this down and continue the
> old WPs first."* Nothing in this file is chartered. It is the assessed disposition of
> `CONCEPT_V2_AMENDMENTS.md` (Ä1–Ä17), to be picked up **after** the existing work packages —
> the gate chain and the unbuilt phases — have run their course.
>
> **Evidence base:** two independent read-only assessments, each tracing the current tree rather than
> the concept or the development report:
>
> | Fragment | Scope | Commit |
> |---|---|---|
> | `_amendment_feasibility_A_datamodel.md` | Ä1–Ä5, Ä10, Ä17 — data model, capture, invariants, migration | `3e4bf3d` |
> | `_amendment_feasibility_B_infra_gate.md` | Ä6–Ä9, Ä11–Ä16 — epoch, relay, security, verification regime | `6031ea1` |
>
> Both were told to classify **against built code first** and to be adversarial about whether an
> amendment actually helps. Their line citations were spot-checked by the Dispatcher, not accepted on
> report — one spot-check found drift in **this project's own state file**, not in theirs.

---

## The single most important result

**Roughly half of the set is already true.** Six amendments are wholly or substantially satisfied by
code that landed *after* CONCEPT_V2 was written, in response to defects the concept did not anticipate:
Ä10 (both halves), Ä11, Ä12, the endpoint half of Ä1, surfaces 1–2 of Ä9, and `.obsidian/**` denial
in Ä15b.

That is not a criticism of the amendment set — it is the predictable consequence of amending a document
that the implementation has been outrunning for weeks. But it has a sharp practical edge:

- **An amendment transcribed in the future tense gets chartered as new work.** Ä10 would charter WP21 a
  second time. Every already-satisfied clause must be rewritten **past tense**, as documentation
  catching up, or it costs a work package to discover it costs nothing.
- **A partially-satisfied amendment marked "done" produces a false green.** Ä2 is enforced at **2 of its
  4** named boundaries; Ä9 at 2 of 4 surfaces. Those are the dangerous ones, and they are the ones a
  quick read most easily mistakes for complete.

---

## Verdict table

| Ä | Status vs. built code | Effort | Helps? | Disposition |
|---|---|---|---|---|
| Ä1 | endpoint half **satisfied** / TOTALITÄT new | S text + ~2 WP | yes | **adopt**, endpoint half past-tense |
| Ä2 | partial — **2 of 4** boundaries enforced | S text + 2–3 WP | yes | **adopt**; name the 2 open boundaries |
| Ä3 | **contradicts built** + new work | 4–6 WP | partly | **adopt journal half; reject "withhold replaced"** |
| Ä4 | partial — order-independence done, causality not | 5–7 WP | partly | **adopt option 2; option 1 only after WP39** |
| Ä5 | new; **justification factually wrong** | 1–2 WP | partly | **adopt amended** — see below |
| Ä6 | **contradicts running code** | 2 WP + §7 licence | partly | **adopt amended**, jointly with Ä7-1 |
| Ä7 | partial; **rule 2 unreachable** | 1–4 WP | partly | **adopt rule 1; record rule 2 as known-open** |
| Ä8 | new | 1–2 WP | **yes** | **adopt as written — clean win** |
| Ä9 | partial — surfaces 3+4 = WP68 | 1 WP | yes | **adopt**; reclassification is the payload |
| Ä10 | **already satisfied, both halves** | text only | doc | **adopt past-tense only** |
| Ä11 | true in fact; concept text still false | one sentence | yes | **adopt as written — clean win** |
| Ä12 | **already satisfied** | 0 to ratify | partly | **ratify; replace the criterion** — see below |
| Ä13 | c1+c3 = WP75/76; **c2 unproducible** | S / 2–3 WP | mixed | **adopt c1+c3; rework c2** |
| Ä14 | **contradicts the standing ruling** | 0 WP | **no as written** | **do not adopt unamended** — see below |
| Ä15 | 15a new and **live**; 15b = WP68 | 1 WP each | yes | **adopt**; symmetry clause mandatory |
| Ä16 | new | 1 WP | **yes** | **adopt as written — clean win** |
| Ä17 | partial; accepted regression, owner WP39 | text only | partly | **adopt as known-open promotion** |

---

## Rulings

### R1 — Ä14 is not adopted as written. It ratifies the outcome and weakens the rule.

Its "release condition, not phase-closure condition" half is **already** `CONCEPT_V2.md:828-831`, so it
adds nothing there. What it adds is a reopen trigger narrowed from a **severity class** to an
**enumerated list**, and the list is authored by the party whose phases would reopen. Under Ä14's letter,
a P0 the gate surfaces that is not on the list reopens nothing.

It also names reopen-risks for **P0 and P1 only**. P2 (sidecar/epoch) and P6 (relay) get none — although
both are closed, both are unexercised, and **Ä6 and Ä7 in this very set assert that both are wrong.**

**Adopt only with all three:**
1. *"A phase reopens on any P0/P1-severity defect the gate surfaces, whether or not it appears in the
   reopen-risk field."*
2. Reopen-risk fields for **P2 and P6**.
3. Each entry a **checkable proposition**, not a topic.

Keep *"Vakuum-Läufe sind schlechter als kein Lauf"* **verbatim** — it is the only clause in Ä14 that
tightens anything, and it is the correct principle.

### R2 — Ä9(3), Ä9(4) and Ä15b are one defect, and it is already chartered as WP68.

The rename funnel admits on `control-handlers.ts:50` `paths.some(isSharedPath)` where every other op type
uses the strict all-paths form, and `file-ops.ts` then applies only traversal checking. One predicate,
one WP, one definer. `.obsidian/**` is **already denied** elsewhere (`exclusion.ts:12` + `manifest.ts:442`,
wired at `main.ts:343-345`) — only this funnel bypasses it, so Ä15b's premise that the deny-list is
missing is misleading.

**Ruling on ordering — narrower than the assessment proposed.** Assessor B argues the security
reclassification justifies moving WP68 **ahead of WP7**. Half right:

- **WP68 does NOT block WP7.** Both gate peers are ours. There is no hostile peer in a two-vault run we
  provision ourselves, so the inbound arm is not reachable *during the gate*.
- **WP68 DOES block release**, and it outranks the unbuilt phases. A peer-reachable write into
  `.obsidian/**` of an **Electron** process is a code-execution surface, not hygiene — and that is the
  amendment's real contribution, independent of the fourth-surface bookkeeping.

**So: WP68 stays behind WP7 and moves ahead of P3/P4/P5.** It is 1 WP.

### R3 — Ä6 must be re-scoped from a prose deletion to a code deletion, and must land with Ä7-1.

Its technical claim is **correct**: `canvas-tombstone.ts:126-129` forbids exactly the delete that
`canvas-sidecar-lifecycle.ts:233-278` performs on a 5-minute timer. But it is filed as `STREICHEN`
against a German sentence while the thing that must go is **running code**. An implementer would strike
the prose and leave the GC loop live, now violating the new rule — a spec/code divergence created *by*
the amendment.

Two hard conditions:
- Re-scope to name `canvas-sidecar-lifecycle.ts:233-278` explicitly, under a **§7 licence** (it reopens a
  `DONE` WP).
- **Land jointly with Ä7-1.** Ä6 makes the epoch bump the sole GC path; Ä7-1 is the only thing preventing
  the relay replaying pre-bump history into a post-bump doc. **Either alone is worse than neither.**
- Price the consequence honestly: `bumpEpoch`'s only caller is the manual import command
  (`canvas-import.ts:312` ← `session/commands.ts:202`), so under Ä6 physical GC becomes **effectively
  never** until something else bumps.

### R4 — Two amendments rest on premises that do not hold, and must not be adopted verbatim.

- **Ä5** — the gate **cannot fire against V1**: V1 builds carry no `meta` at all, so there is no foreign
  `schemaVersion` to detect. It protects against *future majors*, not the threat it names. Adopted
  verbatim, the project would believe it has a mixed-version protection it does not have. Its I11 safety
  also depends entirely on placing the refusal **before** `attachCanvasPersistence` (`main.ts:1376`),
  which the amendment does not say; the "stop syncing, keep persisting" reading is a genuine I11 violation.
- **Ä7 rule 2** — presupposes a checkpoint mechanism that `sync.ts:580` (`if (!doc || this.e2e?.enabled)
  return;`) switches **off in exactly the encrypted rooms it concerns**. A conformance test for it today
  asserts against an early return: a green that cannot fail, inside an amendment set written to abolish
  those. **Record as a known-open risk; do not charter as a coupling rule.**

### R5 — Ä12 is ratified, but its criterion is replaced with a stronger one already in the tree.

`harness/fuzz/intent-trace.ts` has **zero import statements** from `src/` and re-derives both the cascade
(`:363-387`) and the `(ord,id)` comparator (`:396-417`); `oracle.ts:265-413` plus WP23/tp04 are the
discrimination pin. So the oracle exists.

**"Independently authorised" is the wrong criterion** — it buys a governance ritual. The achievable and
stronger form is **mechanical and already satisfied**: independently *derived*, with a checkable
no-shared-code property. Amend Ä12 to demand that instead.

The genuine gap is exactly the three semantics Ä12 lists and the model does not cover: **tombstone
`(t,by)` stamps, epoch, and Ä4 precedence.** That is the real 2 WP.

### R6 — Ä15a is adopted, with a symmetry clause that is not optional.

The defect is live and confirmed: `types.ts:48` `sharedFolder: ""` → `manifest.ts:443` returns `true`
(whole vault shared) → `main.ts:495` guest → `main.ts:554` `trashFile`.

**"Startverweigerung" does not say *whose* start, and a one-sided fail-closed is strictly worse than
none.** If the host refuses to publish while the guest still joins, the guest sees a **partial** manifest
and trashes everything absent from it. Note `main.ts:545` already guards the *empty* manifest
(`if (manifest.size === 0) return;`) — so the destructive case needs a manifest that is **non-empty but
partial**, which is precisely what an asymmetric refusal produces.

**Required normative sentence: the refusal is symmetric and pre-connection on both roles.**

### R7 — Ä4 option 1 is not adopted. Option 2 is.

"The first V2 write deletes the flat keys in the same transaction", executed in **P1**, produces records
with no flat geometry. A peer still on this build reads that as a node with no `x`/`y`,
`validateNodeIngest` refuses it, and the refusal composes into deletion — **the amendment re-arms the
exact cascade the rest of the set abolishes.** It is safe only after WP39, at which point it is
unnecessary. Adopt the causal-stamp form (option 2), which is what the concept's own
"determinism from causality" requirement actually asks for.

### R8 — Ä3 splits. The journal is adopted; "the withhold is conceptually replaced" is rejected.

Pass-through repeals **C17 AC3** (cross-replica byte equality) and C17's DoD — which **WP63's charter
considered and rejected in writing**. Ä3 does not acknowledge that and offers no replacement oracle.
Declaring the withhold replaced while its replacement is unbuilt leaves the only live protection
**unowned**. The conformance test would also be vacuous: the natural oracle ("the file still holds the
record") is *already green under the withhold*.

**But Ä3's diagnosis is under-stated, not wrong.** It names three weaknesses of the withhold. There is a
**fourth**, found independently and since confirmed by the Dispatcher against the tree: **the withhold
does not survive a restart** (see the confirmed P0 in `DISPATCHER_STATE.md`). So *"keep the withhold,
reject pass-through"* is **not a complete answer** — the withhold owes durability either way, and that is
now a defect with no owner rather than an amendment question.

---

## Adopt-as-written, clean wins (cheapest value in the set)

**Ä8** (ADOPTION-BLOCKED as a named state — `canvas-epoch.ts:722/725` correctly aborts adoption but emits
**no signature at all**, blocks no local writes, has no retry, and `EpochConflictOutcome:568` cannot even
distinguish *"not adopted, equal"* from *"not adopted, blocked"*) · **Ä16** (mutation score for the six
pure decision cores — zero tooling in tree today, cores genuinely pure, viable if scoped to those six and
kept **out of `npm test`**) · **Ä11** (one sentence; `CONCEPT_V2.md:828` still says the launcher *"lief
nie"*, and the correct statement is that the layer **is** built and is plan-only **by design**, so the
gate is agent-mediated — WP71 — not blocked on construction) · **Ä2** (cheapest edit in the set, the only
rule in the concept about *compositions*, and it located both open I11 holes).

---

## Carried up — findings that are NOT amendment questions

Recorded here so they are not lost with the amendment work they surfaced from. **None is owned.**

1. **I11's protection expires with the session — CONFIRMED P0.** Full evidence in `DISPATCHER_STATE.md`.
2. **The import boundary has no I11 wiring at all.** `files/canvas-import.ts:307` calls
   `seedRecordsIntoYMaps` **without `refusalsOut`** and discards the signatures → silent drop → adopted
   winner → projected over the user's file.
3. **Two pre-gate drops no refusal mechanism can see.** `parseCanvas` drops falsy-`id` records; it reads
   only `nodes`/`edges` while `buildCanvasData` emits only `{nodes, edges}` — **any other legal top-level
   JSON Canvas key is written out of the user's file on first flush.**
4. **I8 atomicity is not in force on the live capture path.** Every live path authors flat keys
   (`canvas-sync.ts:2799` → `applyIntentPlan`), the shadow is keyed flat, and the serializer prefers flat
   (`:621-633`). Geometry still merges as independent `x`/`y` LWW registers — **the exact defect WP9/WP10
   exist to make unrepresentable.** Owned by WP39 (P5, unbuilt); recorded nowhere before now.
   *Assessor A's judgement: the most consequential item it found.*
5. **WP73's repair landed one seam short.** `_was_applied` was hardened to reject truthy stand-ins and
   default-true reads — while the host it reads returns a **literal `true`** at `e2e-control.ts:1023`.
   WP75 charters this; the framing is what matters: **the driver was made honest about a host that cannot
   lie in the other direction.**
6. **Ä13 c2 substitutes a suite silently.** It replaces the concept's fourth chaos suite
   *"Fallback-Client neben Owned-Client"* (`CONCEPT_V2.md:839`) with *"Mixed-Version-Peer"* without
   saying so, and demands discrimination variants a **production** bundle cannot host (`src/testing`
   tree-shakes out).
