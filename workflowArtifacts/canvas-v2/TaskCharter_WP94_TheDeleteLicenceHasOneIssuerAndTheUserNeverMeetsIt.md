# Task Charter — WP94: the delete licence has one issuer, and the user's own edit never meets it

<!-- Updated: chartered 2026-08-07 (B52, Worker 2) against **S78**, measured live by B50/W4 and recorded in `ValidationReport_B50_LiveW4.md` §4.1 and `SIGNAL_REGISTER.md` §3a. Re-verified independently against the tree per rule 12, on branch `fix-bugs-and-raceconditions` at `e1241a5`. **THE HANDED PREMISE IS CORRECTED IN THREE PLACES, AND EACH CORRECTION CHANGES THE REPAIR.** (1) **THE DEFECT IS NOT IN THE DIFF, NOT IN THE TOMBSTONE WRITE AND NOT IN THE PROJECTION.** `planIntentDiff` rule 4 (`canvas-shadow.ts:566-579`) computes the delete-candidate set correctly and then requires `surface.handedToView[kind].has(id)` (`:574`). That set has **exactly one production producer** — `main.ts:2589` `this.surfaceState.noteHandover(canonical, summary.handed)`, inside `reconcileLiveCanvas`, which is driven **only by a REMOTE delta** (`canvas-sync.ts:2978-2980` returns early for a local edit). A record that entered the doc through this client's own capture and was never re-delivered by a confirmed remote reconcile pass therefore has **no licence, ever**. `plan.deletes` is empty, `applyIntentPlan` (`canvas-sync.ts:3665`) is handed nothing to write, and the six-member `CAPTURE DECLINED:` reason set (`canvas-sync.ts:353-359`) is unreachable because all six branches sit **in front of** the diff (`:3191-3241`). That is the S78 signature exactly: `local modify` = 1, `declines` = 0. (2) **"NEVER CAPTURED" IS TRUE OF THE SHAPE MEASURED AND FALSE IN GENERAL, AND THE GENERAL RULE IS WHAT THE REPAIR MUST ADDRESS.** Vault A's own debug log carries **64 `deleted=[…]` telemetry lines across 1 048 `local modify` lines** — deletion works whenever the licence exists. The B50 `DELETE_A` rung deletes a marker **it created by a local whole-file write seconds earlier** (`liveshare_b50.py:466` creates, `:509` removes), which is precisely the class that can never hold a licence. The natural experiment is in the same log: at `live-share-debug.md:33803` the teardown deletes **35 ids in one pass**, and that list contains `b50-030055-04-M`, `-08-M`, `-12-M`, `-16-M` and `-20-M` — **the very markers the rungs reported as "never captured"** — while `-24-M`, whose rung was the last before teardown, is **absent from the list**. Same code, same path, same instance: the variable is whether a confirmed reconcile pass had re-delivered the id in between. (3) **THE GREEN THAT COVERED THIS IS NOT VACUOUS — IT PINS THE DEFECT AS THE SPECIFICATION.** `wp5v2/test_tp05_handover_and_close_visible.test.ts` T1 (`:152-183`) wires the **real** `createSurfaceStateStore` exactly as `main.ts` does (`:122-127`) and asserts that an omission without a hand-over receipt must **not** delete, citing I7. That argument is right about I7 and wrong about coverage, and this WP must amend a passing, deliberately-argued test rather than a hollow one. ⚠ **A FOURTH FINDING, AND IT IS THE REASON THE OBVIOUS REPAIR IS FORBIDDEN.** `parseCanvas` (`canvas-sync.ts:582-613`) catches **every** JSON error and returns `{nodes:{}, edges:{}}` — a truncated or mid-write read is byte-for-byte indistinguishable, at the diff, from a canvas the user genuinely emptied. Widening rule 4 without first giving it a completeness proof converts every partial read into a total destruction of a shared board. **The gate that causes S78 is currently the only thing standing between a truncated read and that outcome.** ⚠ **A FIFTH, on the seam the Dispatcher asked about.** `buildApplyReceipt`'s branch asymmetry is **real, is exactly where the standing finding says it is, and is NOT the cause of S78**: in the geometry branch an **edge** is `reloaded ? "applied" : "unchanged"` (`canvas-shadow.ts:821`) — always confirmed, always handed — while a **node** goes through `geometryNodeOutcome` (`:819`, `:764-772`) whose defaults are `"interacting"` and `"missing"`, neither confirmed. Node and edge deletions therefore have **different licence widths on the same pass**, which is why this charter refuses to charter only the measured node case. **VERIFIED BYTE-IDENTICAL between `e1241a5` and the working tree** (`git hash-object`): `canvas-sync.ts` `5fef347b`, `canvas-shadow.ts` `b6244c94`, `canvas-persistence.ts` `613d8282` — every line number for those three holds at both. **`main.ts` and `vault-events.ts` are LIVE under sibling B53** and their numbers are stale by construction: `main.ts` `faaede09` (HEAD) vs `f9354924` (tree), `vault-events.ts` `ce075da8` vs `3290f6f6`; `handleLocalModify`'s call site has already moved from `:278` to `:321` and `noteHandover` from `:2589` to `:2599`. No Obsidian was launched, no product file was edited, no `data.json` value was read, printed, hashed or fixtured, and no relay was contacted for this charter. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP94
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP2 (`DONE`) — rule 4 is the function being changed. WP5 (`DONE`) — the receipt seam is the producer set being widened; `advanceFromReceipt`'s field-advance semantics are **consumed unchanged**. WP19 (`DONE`) — every delete this WP licenses still lands as a tombstone through `applyTombstoneOp`; no key removal is added. WP29 (`DONE`) — the seed's removed delete-by-omission (`canvas-sync.ts:4023-4034`) **must not be reintroduced by the back door**. WP63/WP90 (`DONE`) — the refusal polarity in AC5. **MUST NOT be batched with B53/WP93** (`main.ts`, `vault-events.ts`, `file-ops.ts`, `canvas-sidecar.ts` live) — see §2 Ordering.
**W4 Test Targets:** `4`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a user who deletes a card or an arrow from a shared canvas sees it gone everywhere, or is told in a named, counted signature why it was not. Today the removal is **silently discarded on the deleting instance**: the vault event arrives, `handleLocalModify` runs to completion, nothing declines, the doc never learns, the peer keeps the record, and the peer's copy then propagates back over the user's own file.
- **The one-sentence statement of the defect:** *the authority to delete is issued by exactly one mechanism, that mechanism runs only when a peer changes something, and the record a user most often deletes is the one they just made themselves.*
- **What the substance of the work actually is — an AUTHORISATION famine, not an information famine, and the distinction decides the repair.** The brief's framing is that *"an absence is not treated as information"*. Measured, that is not what happens. Rule 4 (`canvas-shadow.ts:566-579`) computes the absence correctly: it walks the shadow's `present` records for the path, subtracts the ids the save mentions, and arrives at exactly the right candidate set. It then throws that set away because no candidate carries a licence. **The information is present and the authorisation is missing** — and that matters enormously, because the repair suggested by the "missing information" framing is *"treat absence as a delete"*, which is I11 inverted and is the defect WP80 and WP86 exist to prevent. The repair suggested by the correct framing is *"widen the set of things that can issue a licence, and make every licence a positive receipt about a record"*, which is I11 preserved.
- **Why the licence set is as narrow as it is, stated fairly, because the narrowing was deliberate.** `handedToView` was built by WP5 to answer one question: *did this record reach the surface this save came from?* It answers it correctly for the case it was designed for — a remote change applied to an open Obsidian canvas view. It was never given a producer for the other two cases in which the product **already knows the same fact**:
  - the client's own capture (`handleLocalModify`) upserts record X from file F, so F provably held X;
  - `noteExternalDiskWrite` (`canvas-sync.ts:4088-4100`) states in its own comment that *"with no open Obsidian canvas the FILE is the surface … what the single writer just put there provably reached it"* and already drives `advanceShadowFromContent(path, content, /*markMissingAbsent*/ true)` (`:4099`) on that basis.
  The second is the sharpest: the product has a written, implemented rule that the file is a surface, and rule 4 is gated on `surface.viewOpen` (`canvas-shadow.ts:567`) so that with the board **closed** the delete rule does not run at all. **A closed board therefore captures creations and mutations and never captures a deletion, of any record, ever.** That is a straightforward derivation from two lines, it is broader than anything B50 measured, and §4 AC7 makes it a falsifiable live row rather than a claim.
- **Why this is P0 and why it is worse than "your delete did not sync".** The user's own instance shows the card gone — they deleted it — and the peer's instance still shows it. The peer's `CanvasPersistence` then projects the doc, which still holds the record, back onto the shared file, and the card **returns to the deleting user's disk**. It is not a failure to propagate; it is a silent revert of a destructive user intent by a peer that was never told. No signature fires on either side. The class is the run's dominant one (I11 / D2 / `S79`: an absence translated into the wrong action), running here in the *opposite* direction from WP80's — WP80 stopped an unlicensed deletion, this one restores a licensed deletion that was refused for lack of a licence nobody could issue.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C94** (work package **WP94**), and the section 9 row; section 4.6 (invariant → work-package traceability, **I7** and **I11**, which pull in opposite directions here and must both hold); section 10 (the signature register — this WP proposes one, see §6). **C94, the §9 row, the §10 row and the header arithmetic are PROPOSED in §6 of this charter and landed by the Dispatcher. This charter does not edit `BUILD_SPEC_CanvasV2.md` and allocates no signal number.**

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **at most two** production files:
    - `plugin/src/canvas/canvas-shadow.ts` — `planIntentDiff` rule 4 (`:566-579`), the `SurfaceState` shape, `createSurfaceStateStore` (`:1105-1130`), and the receipt→hand-over derivation in `advanceFromReceipt` (`:1048-1076`) / `advanceConfirmedLine` (`:886-907`) / `buildApplyReceipt` (`:795-831`). **Pure module: no import of Obsidian, no clock, no I/O, no host global — that contract is an abort criterion if broken.**
    - `plugin/src/files/canvas-sync.ts` — `handleLocalModify` (`:3175`), `planCapture` (`:3425`), `parseCanvas`'s degradation report (`:582-613`), the new withhold signature and its counters beside `declineCapture` (`:3156-3172`).
  - Responsibility: give the delete rule an **evidence criterion** it can satisfy from more than one producer without ever being satisfiable by an absence; make a withheld deletion **named and counted**; and settle the node/edge asymmetry so a single gesture cannot half-apply.
- **Out of scope / non-goals — each is an ESCALATE, not an implementation choice:**
  - **⚠⚠ `plugin/src/main.ts`, `plugin/src/files/vault-events.ts`, `plugin/src/files/file-ops.ts`, `plugin/src/files/canvas-sidecar.ts` — LIVE under sibling B53/WP93 at chartering time.** Four modified files in `git status`. **Every line number this charter gives for `main.ts` and `vault-events.ts` is stale by construction** and is given at `e1241a5` only so a reader can find the symbol; `handleLocalModify`'s call site has already moved `:278` → `:321` and `noteHandover` `:2589` → `:2599`. Re-locate by symbol name (rule 5). Under RULE 14 you do not revert, stash or check out over B53's work.
    - **If the repair appears to need a `main.ts` edit, stop.** It almost certainly does not: `main.ts:207-208` already constructs the store and `:1891` already installs the provider, so a widened producer set that lives **inside** `CanvasSync` and `canvas-shadow.ts` needs no new wiring. A conditional over canvas state written into `main.ts` violates §3.1 S11 and is an abort criterion. If a *pure wiring* line is genuinely required, that is an ESCALATE with the exact line, coordinated with B53 — not a unilateral edit.
  - **`applyIntentPlan`'s delete branch (`canvas-sync.ts:3785-3800`) and WP19's tombstone containers.** Untouched. Every delete this WP licenses still goes through `applyTombstoneOp` with one Lamport stamp per pass; `nodesMap.delete` / `edgesMap.delete` remain never called. Adding a key removal is an abort criterion and WP19's `observe` tripwire test must stay green **unmodified**.
  - **WP19 AC3's cascade — `buildCanvasData`'s `visibleNodeIds` suppression.** Untouched, and see AC4's vacuity note: it is the single most likely false green in this charter, because it makes an **uncaptured** edge deletion look identical to a captured one whenever the edge's node was deleted.
  - **The seed's non-deletion.** `seedFlatSpace` (`canvas-sync.ts:3996-4039`) removed WP29 AC2's record-level delete-by-omission and *"NOTHING REPLACES IT, deliberately"*. This WP must not reintroduce it, at one remove, by letting a seed's content act as a licence for a later save's omission. The seed is a **create-once upsert** and has no opinion about deletion; that stays true.
  - **WP63/WP90's withhold gate, `writeIsWithheld`, `SeedRefusalStore`, `SEED REFUSED:` / `SEED RESTORED:` behaviour.** Read-only facts in AC5. This WP is on the **capture** side; the withhold is on the **projection** side.
  - **WP4 AC2's byte echo breaker (`canvas-sync.ts:3239-3241`) and WP91's promotion of it.** Untouched. Widening, weakening or adding a tolerance to it re-opens WP4 and WP91 together.
  - **The `CAPTURE DECLINED:` reason set and its six members.** **Closed, and it stays closed.** All six fire *before* the diff and describe a whole pass that captured nothing; a per-record delete withhold inside a pass that **did** capture is a different event and gets a different signature (§6). Adding a seventh member is an abort criterion — it would make `declines` uncountable against `local modify`, which is exactly the correlation B50 used to characterise S78.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen; the flag stays `false`. Flipping it would route capture off the file path and **hide** this defect rather than fix it — the most tempting wrong answer here.
  - **`canvas.simulateEdit`.** Never called by any test for this WP: it writes straight into the `Y.Doc` (`testing/e2e-control.ts:995-1005`) and returns a hardcoded `applied: true` (`:1023`).
  - **`toCanonicalPath` and the path-identity question (S76).** Not touched, not depended on beyond what the current code already does.
  - **`server/**`, deployment, `docker/.env`, any secret, any `data.json` value.** Entirely out.
- **Known interfaces / dependencies:**
  - Input: one parsed save for one path, the Surface-Shadow, the tombstone view, and a **surface-evidence record** replacing today's `SurfaceState`
  - Output: an `IntentPlan` whose `deletes` are exactly the licensed, complete, positively-evidenced removals; plus a per-reason withhold ledger as **state**
  - Depends on: **WP5**'s receipt seam and **WP2**'s four rules, both consumed rather than replaced

### Ordering — what must NOT be batched together

1. **Not with B53/WP93.** Four files live, two of which (`main.ts`, `vault-events.ts`) this WP must be able to claim it did not touch. A shared batch makes that claim unverifiable by construction.
2. **Not with WP92.** Different subsystem (`SeedRefusalStore` keying) but it moves the same refusal vocabulary AC5 reads. Sequence, do not merge.
3. **Not with any other `canvas-shadow.ts` work.** This module is pure and is the classifier basis for both directions; two concurrent editors of it produce a diff nobody can attribute.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the tree (rule 12), 2026-08-07, branch `fix-bugs-and-raceconditions` at `e1241a5` — measured, given, do not re-derive

**`canvas-shadow.ts` (`b6244c94`), `canvas-sync.ts` (`5fef347b`) and `canvas-persistence.ts` (`613d8282`) are byte-identical between `e1241a5` and the working tree**, so every line number below holds at both. `main.ts` and `vault-events.ts` are **not** — they are live under B53 and their numbers are given at `e1241a5` for symbol location only.

#### The path, end to end

```text
vault.on("modify")                       vault-events.ts:278 @e1241a5  (tree :321 — B53 live)
  └── canvasSync.handleLocalModify(path)          canvas-sync.ts:3175
        ├── 6 early returns, each → declineCapture()        :3191-3241   ← the whole CAPTURE DECLINED: set
        │     not-subscribed · read-only · no-doc ×2 · schema-major · no-file · echo
        ├── const surface = this.surfaceStateProvider(path)  :3259       ← the seam
        ├── const plan   = this.planCapture(save, surface, tombstones)   :3263
        │     └── planIntentDiff(shadow, save, tombstones, surface)      :3430
        │           ├── rules 1-3 (resurrect / staleness / intent)  canvas-shadow.ts:536-562
        │           └── RULE 4 — DELETE                                        :566-579
        │                 if (surface.viewOpen)                               :567   ← gate A
        │                   if (record.state !== "present") continue           :572
        │                   if (seen[kind].has(id))        continue            :573
        │                   if (!surface.handedToView[kind].has(id)) continue  :574   ← gate B  ◄── THE LOSS
        │                   plan.deletes.push(...)                             :575
        ├── doc.transact(() => this.applyIntentPlan(...))    :3323-3331
        │     └── plan.deletes → applyTombstoneOp            :3785-3800        ← never reached
        └── telemetry `local modify … -0 node(s)`            :3398-3404        ← the only trace left
```

#### Where `handedToView` comes from — the whole producer set, derived from source

| # | producer | site | reachable from a local edit? |
|---|---|---|---|
| **P1** | `this.surfaceState.noteHandover(canonical, summary.handed)` | `main.ts:2589` @`e1241a5` (tree `:2599`) | **NO.** Its only caller is `reconcileLiveCanvas` (`main.ts:2379`), whose only production entries are the remote observer (`main.ts:1900`), the WP37 drain (`:2668`) and two `initial: true` mounts (`:3030`, `:3109`). The observer returns early for a local edit — `canvas-sync.ts:2980` `if (this.recentLocalEdits.has(livePath)) return;` — and `recentLocalEdits` is held across the entire capture transaction (`:3322`/`:3332`) and across the host seed (`:2913`/`:2917`). |

**That is the complete list. One producer, and it is on the remote path.** `createSurfaceStateStore` (`canvas-shadow.ts:1105`) exposes `noteHandover`, `clearPath`, `clearAll`, `stateFor`; `clearPath` is called once, from the view-close sweep (`main.ts:2177`), and `clearAll` has no production caller on this path.

**And `noteHandover` REPLACES rather than accumulates** (`canvas-shadow.ts:1110-1115`, comment: *"it never accumulates"*). Consequence, derived and unowned: a **structural pass whose reload did not land** gives every line `outcome = "failed"` (`:817`), `advanceFromReceipt` confirms none (`:1064-1071`), `summary.handed` is empty, and `main.ts:2589` writes that empty set over the licence set for the whole path. **One failed reload silently voids every delete licence on that board, and nothing reports it.**

#### The branch asymmetry the Dispatcher asked about — established, and it is a SECOND defect, not this one

`buildApplyReceipt` (`canvas-shadow.ts:795-831`):

| pass | node | edge |
|---|---|---|
| structural | `reloaded ? "applied" : "failed"` (`:817`) | same line, same verdict |
| **geometry** | `geometryNodeOutcome(nodeOutcomes?.get(id), reloaded)` (`:819`) → `"interacting"` dominates, unreported ids degrade to `"missing"` (`:764-772`) — **neither is confirmed** | **`reloaded ? "applied" : "unchanged"` (`:821`) — both branches are confirmed** (`isConfirmed`, `:856-858`) |

`advanceFromReceipt` derives **both** the field advance and the hand-over from the *same* `isConfirmed` test (`:1065`, `:906`). So one `ApplyOutcome` is being asked two different questions:

- *did the surface take these VALUES?* — the right gate for advancing fields, and the reason `"interacting"` must not advance;
- *is this record ON the surface?* — the right gate for issuing a delete licence, and it is answered elsewhere already: `planReconcile` returns `"geometry"` only after `sameStringSet(canvasIds(desired.nodes), liveNodeIds)` **and** the same for edges (`reconcile-plan.ts:170-171`). Membership against the live view is a **precondition** of the geometry branch.

For edges the code silently takes the membership answer; for nodes it takes the value answer. **A card the user is holding therefore loses its delete licence, and every edge keeps its.** That is the asymmetry, it is exactly where the standing finding said it is, and it is **not** the cause of S78 — the B50 shape fails gate B for a record no pass of either kind ever carried. It is the reason AC4 exists.

#### The evidence the product already has and does not use

| fact the product asserts | site | today's effect | why it is a receipt |
|---|---|---|---|
| a confirmed reconcile apply put these ids on the open view | `main.ts:2589` | **issues the licence** | the only one wired |
| this client's capture upserted record X **read from file F** | `canvas-sync.ts:3344-3346` (`advanceField` per `applied.upserts`) | advances the shadow to `present`; **no licence** | F provably held X — that is a positive fact about a record, obtained from the same surface a later save of F comes from |
| *"with no open Obsidian canvas the FILE is the surface … what the single writer just put there provably reached it"* | `canvas-sync.ts:4093-4100`, driving `advanceShadowFromContent(path, content, true)` (`:4099`) | marks omitted records `absent` in the shadow; **no licence, and rule 4 is gated off anyway by `viewOpen`** | the comment states the receipt in words; the code implements half of it |
| the host seed pushed exactly this file into the doc | `canvas-sync.ts:2927`, `advanceShadowFromContent(path, content, false)` | advances the shadow; **no licence** | WP29 says a seed has no opinion about deletion — correct, and it must stay so (§2) |

#### Why the obvious repair is forbidden — `parseCanvas` degrades a truncated read into an empty canvas

```text
canvas-sync.ts:582   export function parseCanvas(content: string): CanvasData {
             :583     try { const parsed = JSON.parse(content); … }
             :608     catch {
             :609       // AC4: a JSON error yields EMPTY records rather than throwing.
             :611       return { nodes: {}, edges: {}, order: { nodes: [], edges: [] } };
```

`handleLocalModify` calls it at `:3256` and **never asks whether it degraded**. A mid-write observation, a half-flushed file, a zero-byte file and a canvas the user genuinely emptied all arrive at rule 4 as `save.nodes = []`. There is a second, quieter case on the same function: `:589` and `:599` guard with `Array.isArray(parsed.nodes/edges)`, so a document with **no `edges` key at all** is indistinguishable from one whose every edge was deleted.

**The naive repair — "records absent from the file are deleted from the doc" — is therefore a licence to tombstone an entire shared board on a partial read.** WP80 exists because the manifest purge's `if (manifest.size === 0) return;` guarded only the *completely empty* manifest and a **non-empty but partial** one licensed deletion (D3); WP86 exists because a manifest entry's disappearance was read as a delete licence. This is the same shape one level further down, and `parseCanvas`'s degrade-to-empty is what makes the "empty means empty" guard insufficient here too.

**Stated as plainly as it can be: gate B is currently the only thing standing between a truncated read and the destruction of a shared canvas. It must not be widened before the completeness proof exists.** The order of work in §7 is not negotiable for that reason.

#### The polarity table — a deletion and a refusal are mirror images and must never be confused

| case | in the DOC | in the FILE | correct action | live evidence |
|---|---|---|---|---|
| ordinary record | present | present | nothing | — |
| **DELETION** | **present** | **absent** | tombstone, **if licensed** | S78 |
| **REFUSED AT SEED** (`SEED REFUSED:`) | **absent** | **present** | withhold the projection write; **never a delete** | `ValidationReport_B50_LiveW4.md` §2.1 — fired live for the first time on 2026-08-07 |
| refused at capture (`INGEST REJECTED`, `boundary=capture-net`) | absent | present | do not upsert; **never a delete** | same run, `01:23:58.133` |
| never observed | absent | absent | nothing | — |

A repair keyed on *"the doc and the file disagree"* collapses rows 2 and 3 into one action. Row 3 stopped being theoretical on 2026-08-07.

**And there is a concrete mechanism by which row 3 manufactures a row-2 candidate, which nobody has recorded.** The host seed refuses records in `seedFlatSpace` (`canvas-sync.ts:3996-4039`) and then calls `advanceShadowFromContent(path, content, false)` (`:2927`) over the **whole file, refused records included** — `advanceShadowFromContent` (`:3829-3855`) parses the content and calls `advanceRecord` for every id with no ingest check of any kind. So the shadow holds `present` for a record **the doc never received**. Under a widened licence set, a later save that omits it becomes a delete candidate for a record that has no `Y.Map` — and `applyTombstoneOp` would write a tombstone for that id, which the resurrect block (`canvas-shadow.ts:544`) then makes **permanently uncreatable**. AC5 owns this.

**Why `noteExternalDiskWrite`'s arm is safe today, stated so the next reader does not break it:** its `content` is the in-memory string `CanvasPersistence.writeSnapshot` just serialised and passed to `onWritten` (`canvas-persistence.ts:461-475`), **not** a re-read of the file. It therefore cannot be truncated. Any change that makes that arm read from disk turns `markMissingAbsent = true` into a shadow-wide erase on a partial read.

#### The natural experiment — same code, same instance, opposite outcomes

From vault A's own debug log (`ObsidianOrga/.obsidian/live-share-debug.md`, 3.55 MB, historical-hit control: `local modify ` matches **1 048** lines, `deleted=[` matches **64**, so both patterns are proven matchable — rule 15):

| observation | reading |
|---|---|
| `:33803` — `local modify … -35 node(s) deleted=[b50-030055-01-M … 23-g]` | the delete rule **fires**, for 35 ids at once, on the same path and instance |
| that list **contains** `-04-M`, `-08-M`, `-12-M`, `-16-M`, `-20-M` | **the exact markers whose own `DELETE_A` rungs reported "never captured"** |
| that list **omits** `-24-M` | the last rung before teardown — no reconcile pass intervened |
| 64 `deleted=[` lines across the whole retained history | deletion is not broken; the **licence** is intermittent |

`b50_ladder_030055.json` records `n_modify: 1, n_declined: 0, declined_lines: []` for every one of those six rungs, on **both** bundles. The event arrived, nothing declined, and nothing was deleted — because at that instant no pass had handed the marker over.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **visible tests only** plus **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B). **Blind sets and ledger rows are discontinued** — none is owed. `canvas.simulateEdit` is **never** called. **Every local edit is driven by writing the `.canvas` file on disk.** No `data.json` value is read, printed, logged, hashed or fixtured — key names and boolean presence only. **State is the oracle; signatures are for humans.** **Any absence claim read from the debug log must first prove its pattern matches a known-present line (rule 15) AND must prove the log flushed past the action window** — under S65 the stamp-to-flush lag is **bimodal**, ~0.5 s normally and **60.00 s under S71's host clamp**, so a reader that has not proven its watermark advanced has measured nothing. **Note the roles have swapped since B50: A = guest (:39431), B = host (:39432)** — assert the role, never assume it.*

---

1. **The loss is REPRODUCED headless, through the real producer, before one line of it is repaired.**
   - **Why first:** every conclusion in this charter about severity and about the repair rests on the claim that the licence set has one producer. A RED that a fixture manufactures is worth nothing; a RED that the production wiring produces is the whole argument.
   - **Deliverable:** a fixture wired **exactly as `main.ts` wires it** — `createSurfaceStateStore(isViewOpen)` (`canvas-shadow.ts:1105`) handed to `cs.setSurfaceStateProvider` (`canvas-sync.ts:2336`) — in which the **only** way a hand-over can appear is `advanceFromReceipt` → `noteHandover`. The existing `wp5v2/test_tp05` `makePeer` (`:115-129`) is the precedent and must be reused, not re-invented.
   - **Observable (the RED, pre-repair):** record `X` is created by `handleLocalModify` over a file containing it; `X` is asserted **present in the doc** and **`present` in the shadow** in the same run. A second `handleLocalModify` over a file omitting `X`, with `viewOpen === true`, then produces: `isTombstoneSuppressed(readTombstoneEntry(deleted, "X"))` **`false`**, `X` still in `buildCanvasData(...)`'s projection, `captureDeclineCounts()` **unchanged in every one of its six members**, and the telemetry line reading `-0 node(s)`. That four-way conjunction is the S78 signature reproduced headless.
   - **Observable (the GREEN, post-repair):** the identical fixture, unchanged in any other respect, tombstones `X` and removes it from the projection — and the `CAPTURE DECLINED:` counters are **still** unchanged, because a licensed delete is not a decline.
   - **Vacuity risk — named.** **(a) The killer, and it is the class that hid this for the whole run:** a fixture that injects `handedToView` by hand at `setSurfaceStateProvider`. Every WP19, WP2 and WP15 delete test does exactly that — `wp19/test_tp01_…:97-102` passes `handedToView: { node: new Set(handedNodes) …}` as a literal — which manufactures a precondition production cannot reach for this record class. **The fixture must obtain its hand-over set only from `advanceFromReceipt`'s `summary.handed`, and the test must assert `stateFor(path).handedToView.node.size === 0` at the instant of the deleting save.** **(b)** Asserting "no tombstone" alone: true for free if the path was never subscribed, the doc handle is missing, or `canWrite` declined. The **create** half must be asserted to have landed in the same run, and all six decline counters asserted zero. **(c)** Using `nodesMap.has(id)` as the oracle: WP19 never removes a key, so it is `true` in **both** arms and the assertion cannot fail. The oracle is `readTombstoneEntry` + `isTombstoneSuppressed`, plus the `buildCanvasData` projection. **(d)** A RED that is red because the *file* write failed — assert the fixture vault's bytes before asserting the doc.

2. **The evidence criterion is EXPLICIT, PURE, and the only cell of its truth table that deletes is the one that carries a positive receipt.**
   - **The criterion this charter fixes, and it is the hardest requirement in it.** A record may be deleted **only** when all four hold, and the four are independent:

     > `Delete(X)` ⇔ `Receipt(X, surface)` ∧ `Complete(save)` ∧ `Present(X, shadow, path)` ∧ `¬Seen(X, save)`

     - **`Receipt(X, surface)` — a POSITIVE, PER-RECORD fact that `X` was on the surface this save came from.** The producer set is widened from one to three, and each new member is a fact the product already asserts (§3): **P1** the confirmed reconcile apply (today's, unchanged); **P2** this client's own capture of `X` **from this same path**, which proves the file held `X`; **P3** `noteExternalDiskWrite`'s content, whose comment already states that with the view closed *the file is the surface*. **Receipts are per-surface and the surface must match the observation** — a P1 receipt (the open view) does not license a deletion observed in a file the view never wrote, and a P2/P3 receipt (the file) does not license one observed on the view. That pairing is what stops the widening from degenerating into *"any past knowledge licenses any future absence"*.
     - **`Complete(save)`** — AC3 owns it in full.
     - **`Present`** and **`¬Seen`** — unchanged from today (`canvas-shadow.ts:572`, `:573`).
   - **Why it cannot be inverted into a delete licence, stated as the invariant the implementor must be able to recite:**

     > **Absence never authorises. A receipt authorises; absence only selects which authorised record to spend it on.**
     > Delete the `¬Seen` conjunct and **nothing** is deleted. Delete the `Receipt` conjunct and **everything** is. Only one of the four is a licence, and it is the only one that is a positive fact about a record having been *seen*. The naive rule — *"records absent from the file are deleted from the doc"* — is this same expression with `Receipt` and `Complete` both hard-wired to `true`. **WP80 and WP86 are two subsystems that shipped exactly that substitution.**

     Every failure of the evidence channel therefore **fails closed**: an unknown parse, an unstable read, a missing kind container, a voided receipt set, a refused ingest ⇒ **zero candidates**, named and counted (AC6).
   - **Deliverable:** the predicate is a **pure exported function in `canvas-shadow.ts`**, taking its four facts as arguments, callable without Obsidian and without `CanvasSync`. Rule 4 calls it; it takes no decision of its own.
   - **Observable:** the truth table driven **exhaustively** over {receipt: P1 / P2 / P3 / none / wrong-surface} × {complete: yes / no} × {shadow state: present / absent / unknown} × {seen: yes / no}, with the delete outcome asserted for **every** cell, and the **four corner cells driven end-to-end through `handleLocalModify`** rather than through the predicate alone.
   - **Observable (the widening is real, not cosmetic):** the AC1 fixture — local create, then delete, `handedToView` empty — must go GREEN **through P2 specifically**, asserted by the withhold counters staying zero rather than by the absence of a log line.
   - **Vacuity risk — named.** **(a)** A truth table asserted against the implementation's own enum instead of against behaviour — a table that is a restatement of the code cannot fail; the corner cells must be driven. **(b)** A table with a cell no fixture reaches: any unreachable combination must be **removed from the type**, not left as decoration (the WP91 AC3 rule). **(c)** The `wrong-surface` row omitted, which is the one row that distinguishes this criterion from *"any receipt, ever, licenses any absence"* — without it the AC is satisfied by a strictly weaker rule. **(d)** `Complete` stubbed to `true` in this AC's fixtures, which makes AC2 green and AC3 unreachable; `Complete` is supplied by the real producer in at least the four corner cells.

3. **A truncated, partial or unparseable observation yields ZERO delete candidates — and a genuinely emptied canvas still deletes.**
   - **Why this is the most important AC in the charter:** `parseCanvas` (`canvas-sync.ts:582-613`) catches every JSON error and returns `{nodes:{}, edges:{}}` (`:611`), and `handleLocalModify` (`:3258`) never asks whether it degraded. Under a widened licence set, a mid-write read of a shared board becomes an instruction to tombstone every record on it. **Today gate B is the only thing preventing that.** Widening gate B before this AC lands would ship a destruction path.
   - **Deliverable:** a completeness verdict per save, with **all** of these conjuncts, each independently testable:
     1. the parse **did not degrade** — `parseCanvas` must **report** it. Its degrade-never-throw contract is preserved for every existing caller; the report is **additive** and its absence must not change any other call site's behaviour.
     2. the read is **stable** — the same bytes on a confirming re-read, so a mid-write observation is excluded rather than guessed at.
     3. **no record of this save was refused at the capture boundary** — a non-empty `applied.rejected` (`canvas-sync.ts:3337-3339`) means the save is not a full picture of the writer's intent.
     4. the **kind container was present in the source** — `parseCanvas:589`/`:599` make a missing `nodes`/`edges` key indistinguishable from an empty array; a document with no `edges` key is **not** evidence that every edge was deleted.
   - **Observable (the inversion guard):** for a path whose shadow holds **N** `present` records, **each with a valid receipt**, drive: (i) JSON truncated at 25 %, 50 % and 75 % of its bytes; (ii) the prefix `{"nodes":[`; (iii) the empty string; (iv) `{"nodes":[]}` with **no `edges` key**. Deletes must be **0** in every one, and the withhold counter for `incomplete-observation` must advance by exactly the number of candidates suppressed.
   - **Observable (the DISCRIMINATION, and it is what makes this AC a measurement):** case (v) — `{"nodes":[],"edges":[]}`, a canvas the user genuinely cleared — must delete **N**. **If (iii) and (v) cannot be told apart, the product either loses every wipe or destroys on every truncation, and there is no third option.** The test must show they are told apart, in the same run, over the same fixture.
   - **Observable (the parse report is load-bearing, not decorative):** a unit-level assertion that `parseCanvas` reports degradation for each of (i)-(iii) and **no** degradation for (iv) and (v) — because (iv) is well-formed JSON and is excluded by conjunct 4, not by conjunct 1.
   - **Vacuity risk — named.** **(a)** Every case being invalid JSON, where `JSON.parse` does the work for free and conjunct 1 alone passes the AC — **(iv) and (v) are mandatory** and are the two that can fail. **(b)** "0 deletes" asserted where 0 deletes is also the **unfixed** behaviour: case (v) returning **N** is the paired positive and neither may be reported without the other. **(c)** The fixture having no receipts, so nothing was deletable anyway — receipts asserted non-empty in the same run. **(d)** Conjunct 2 tested with a real clock and a real file, where "the bytes did not change" is true for free; drive it with an I/O seam that returns different bytes on the two reads, and show the same fixture with equal bytes goes green. **(e)** `noteExternalDiskWrite`'s arm quietly changed to re-read from disk while implementing conjunct 2 — that would convert `markMissingAbsent = true` (`canvas-sync.ts:4099`) into a shadow-wide erase on a partial read. Assert it still receives the writer's in-memory string.

4. **EDGE deletion and NODE+EDGE deletion are chartered, driven, and a single gesture cannot half-apply.**
   - **Why the measured case is not enough:** rule 4 walks both kinds through one gate (`canvas-shadow.ts:570`), but the **producer** does not treat them alike. In the geometry branch an edge is `reloaded ? "applied" : "unchanged"` (`:821`) — **always** confirmed, **always** handed — while a node goes through `geometryNodeOutcome` (`:819`, `:764-772`), whose `"interacting"` and `"missing"` are **not** confirmed. **After a geometry pass, every edge on the board holds a delete licence and a card the user is holding does not.**
   - **The consequence, derived and required to be driven:** the user deletes a card **and its arrow** in one gesture while that card is `"interacting"`. The **edge is tombstoned and the node is not**. The card returns from the peer — **without its arrow**. Neither peer asked for that state, and the two halves of one gesture landed in opposite directions.
   - **Deliverable:** the receipt must stop answering two questions with one value. *Did the surface take the VALUES* (gates the field advance, `"interacting"` must not advance) and *is the record ON the surface* (gates the licence) are separated. The membership fact already exists upstream: `planReconcile` reaches the geometry branch **only** after `sameStringSet` holds for **both** kinds against the live view (`reconcile-plan.ts:170-171`), so the licence half is available for nodes too and is simply not recorded.
   - **Observable:** six arms — {edge-only, node-only, node+edge} × {licensed, unlicensed} — each asserting the tombstone state of **every** id it touches. The node+edge arm must be **all-or-nothing** post-repair, and the **mixed pre-repair outcome must be shown reachable** as the RED control.
   - **Observable (the licence-void hole, same AC):** a structural pass with `reloaded === false` gives every line `"failed"` (`canvas-shadow.ts:817`), so `summary.handed` is empty and `noteHandover` (`:1110-1115`) writes that over the whole path. Drive it: a failed reload followed by a legitimate deletion must **not** silently lose the licence, and if voiding is retained it must be **named and counted** (AC6), never a side effect of an empty summary.
   - **Vacuity risk — named.** **(a) The single most likely false green in this charter:** an edge-delete arm whose edge disappeared from `buildCanvasData` through WP19 AC3's `visibleNodeIds` cascade (`canvas-sync.ts:3802-3818`) because its **node** was deleted — the projection then looks identical whether or not the edge was captured. **The oracle for every edge row is `readTombstoneEntry(deleted, edgeId)?.on`, never the projection**, and at least one edge arm must delete an edge **whose endpoints both survive**. **(b)** A node+edge arm in which the node's licence is missing too, so both fail and "no divergence" is true for free — the licensed/unlicensed split must be **per kind**, asserted. **(c)** A fixture in which `planReconcile` never returns `"geometry"`; the branch must be asserted taken, because the asymmetry exists only there. **(d)** Asserting the failed-reload row by reading `reloaded` rather than by observing the licence set before and after.

5. **A record refused at ingest is never a delete candidate — and the seed's own shadow advance does not manufacture one.**
   - **The polarity, and it stopped being theoretical on 2026-08-07.** A **refused** record is *absent from the doc and present in the file*; a **deleted** record is *present in the doc and absent from the file*. `SEED REFUSED:` fired live for the first time in this project during B50 (`ValidationReport_B50_LiveW4.md` §2.1), so both rows of the table in §3 are now occupied by real events.
   - **The mechanism that connects them, which no document in this run records.** `seedFlatSpace` (`canvas-sync.ts:3996-4039`) refuses records and returns them, and the host-seed branch then calls `advanceShadowFromContent(path, content, false)` (`:2927`) over the **whole file**, refused records included — `advanceShadowFromContent` (`:3829-3855`) performs no ingest check of any kind. **The shadow therefore holds `present` for a record the doc never received.** Under a widened licence set that becomes a delete candidate for a record with no `Y.Map`, and the tombstone written for it would make the id **permanently uncreatable** through the resurrect block (`canvas-shadow.ts:544`).
   - **Deliverable:** the refused set is subtracted from the delete-candidate set **and** the shadow advance is made consistent with what the doc actually received. **Which of the two is the fix is a decision this WP must take and write down** — they are not equivalent, and the choice changes what a later repair of the file does.
   - **Observable:** the B50 fixture exactly — a canvas carrying two valid nodes and one edge with `fromNode` and **no** `toNode`, so `validateEdgeIngest` yields `MISSING_TO` with `reject: true`. Seed it on the host; assert the refusal **as state**, not from the log. Then save the file **without** the bad edge and assert: **no tombstone** for that id; the withhold counter for `refused-at-ingest` advanced by exactly one; `SEED REFUSED:` / `SEED RESTORED:` behaviour byte-unchanged; and — the row that proves the resurrect block did not swallow it — the id **can still be created** once the file is repaired.
   - **Vacuity risk — named.** **(a)** A fixture that never produced a refusal, making every assertion true for free: the refused set is asserted **non-empty as state** before anything else is read. Under S65/S71 an `INGEST REJECTED` grep is not admissible for this. **(b)** "No tombstone" asserted on a path where nothing was licensed anyway — the licensed control (a normal record deleted in the same run) must go green beside it. **(c)** Driving this arm live: B50 §2.5 showed Obsidian's own canvas view **normalises a `toNode`-less edge away** when the board is open, so a live arm cannot distinguish the product from the host application. **This AC is headless only**, and that is a decision, not an omission.

6. **A withheld deletion is NAMED and COUNTED. Silence stops being an outcome of this path.**
   - **Why this outranks the fix itself:** S78 survived the whole run because the withhold produced **nothing at all** — no signature, no counter, no receipt, and a telemetry line reading `-0 node(s)` that is identical to "the user deleted nothing". The observable is what would have found this in B44, and it is what will find this WP's own regression.
   - **The decision, and the argument, because the brief asked for one.** It is **a new signature with its own closed reason set, plus state-readable counters** — **not** a new `CAPTURE DECLINED:` reason and **not** a bare counter.
     - **Not a `CAPTURE DECLINED:` reason.** All six existing members (`canvas-sync.ts:353-359`) describe a **whole pass that captured nothing**, and all six fire *before* the diff (`:3191-3241`). A delete withhold happens **inside a pass that did capture** and is **per record**. Folding it in would break the closed-set property, make `declines` uncountable against `local modify` — the exact correlation B50 used to characterise S78 — and destroy the one instrument that currently distinguishes this defect from WP91's.
     - **Not a counter alone.** A counter cannot say *which* record was refused, and the user-facing question is always about one card.
     - **Both, because of S65 and S71.** The debug log's stamp-to-flush lag is bimodal — ~0.5 s normally, **60.00 s ± 0.02 under a host clamp**. A test that greps for the line has not measured anything until it proves the log flushed past the action window. **The counters are the oracle; the line is for the human.**
   - **Deliverable:** one signature, **exactly one production emitter**, a **closed** reason set, and a read-only accessor returning per-reason counts — on the precedent `captureDeclineCounts()` (`canvas-sync.ts:3171`) and WP68/WP88 set. Proposed name, format and reason set are in §6; **the Dispatcher registers it in BUILD_SPEC §10 — this WP does not edit that file.**
   - **Observable (state):** each reason driven at least once; its counter asserted to advance by **exactly one**; **every other reason asserted unchanged in the same assertion**. Ids and reason names only — **never a field value, never node text, never a filename in the counter payload** (US6).
   - **Observable (live, W4):** the counters readable **synchronously** through the e2e control surface, so a live row never depends on the log at all.
   - **Vacuity risk — named.** **(a) The B44 `[06]` class, and this AC sets the trap for itself:** after the repair `no-receipt` becomes rare, so any assertion of the form *"zero withholds"* is **true for free**. The primary observable is a **positive non-zero** on a driven reason; no zero is asserted as primary evidence anywhere in this AC. **(b)** A reason incremented on a branch no fixture reaches — a reason with no fixture is **removed from the enum**, not left as decoration. **(c)** The signature asserted by **absence** from the debug log: inadmissible under S65, and the counters exist precisely so no absence claim is needed. **(d)** A counter that counts **passes** rather than **records**, which would report `1` for a save that withheld thirty deletions — the count is per record and a multi-record fixture proves it.

7. **The closed board — the derivation that is wider than anything measured, and it is a falsifiable prediction.**
   - **The prediction, from two lines:** rule 4 is gated on `surface.viewOpen` (`canvas-shadow.ts:567`) and `viewOpen` is `this.canvasAdapters.get(path)?.isAvailable() === true` (`main.ts:207-208` @`e1241a5`), which requires an **open canvas leaf**. Rules 2 and 3 consult no surface state at all. **Therefore, on an instance whose board is closed, creations and mutations capture normally and deletions never capture — of any record, ever, at any delta.** This is broader than the shape B50 measured and it was derived, not observed.
   - **Observable (live, W4, and it is the cheapest decisive row in this charter):** with the board **closed** on the writing instance and the path still subscribed, write the `.canvas` with (i) a node **added** and (ii) a node **removed**, in separate steps. Pre-repair, (i) must reach the writer's own doc and (ii) must not. That asymmetry — **create works, delete does not, same instance, same second, same file** — is the measurement. Post-repair both land, through the **P3** receipt.
   - **Observable (headless companion):** the same pair with `isViewOpen` returning `false`, asserting the pre-repair asymmetry and the post-repair symmetry.
   - **Observable (the board really is closed):** `canvas.state` is subscribed and answering **and** no adapter is attached for the path, asserted before the writes — because `canvas.open` subscribes **without opening a leaf** (S45), which is exactly how a rig accidentally measures the open-board case while believing it measured the closed one.
   - **Vacuity risk — named.** **(a)** Reporting the closed-board delete as lost when the path was **not subscribed** at all, in which case `handleLocalModify` returns at `not-subscribed` and the whole row is about a different mechanism — the six `CAPTURE DECLINED:` counters must be read and shown unmoved. **(b)** The E2E suite's non-idempotence: a node left by an earlier run makes a presence check true for free — per-run ids and a reset are mandatory. **(c)** Quoting the bundle without pinning it: `S57(installer)` and S67 both apply, `LS_EXPECT_SHA256` on every install, digest stated in every live row. **(d)** Concluding "delete lost" from an absent log line under an active clamp — the write's own arrival in the writer's file is asserted first, and the flush watermark is proven advanced.

8. **No collateral. The three-state shadow, WP19's containers, WP29's non-deleting seed and the `CAPTURE DECLINED:` set all survive intact.**
   - **Observable (behavioural, driven in the same run, never read from a diff):**
     - `nodesMap.delete` / `edgesMap.delete` are **still never called** by any capture path — WP19's `observe` tripwire (`wp19/test_tp01_…:151-175`) green and **unmodified**;
     - the host seed still performs **no** record-level delete-by-omission (`canvas-sync.ts:4023-4034`, WP29 AC2) — driven with a stale host file that omits records the peers created, asserting they survive;
     - `advanceShadowFromContent`'s `markMissingAbsent = true` arm (`:4099`) is **not** a delete path — it still writes only the shadow;
     - all six `CAPTURE DECLINED:` reasons still fire and still count, each driven once;
     - `advanceFromReceipt`'s **field** semantics are byte-unchanged for `"interacting"`: an interacting record still advances **no field** (WP37/WP87 depend on it), even where AC4 gives it a membership licence.
   - **Observable (structural):** `plugin/src/main.ts`, `plugin/src/files/vault-events.ts`, `plugin/src/files/file-ops.ts` and `plugin/src/files/canvas-sidecar.ts` are **not in this WP's diff at all** — asserted by running the diff, not by prose. **B53/WP93 owns all four concurrently** and a WP94 line in any of them is unattributable by construction.
   - **Observable (purity):** `canvas-shadow.ts` still imports nothing from Obsidian, holds no clock, performs no I/O and reads no host global — asserted by the existing purity test, unmodified.
   - **Vacuity risk — named.** **(a)** "Unchanged" asserted by reading the diff; the five behaviours are **driven**, and each is shown to redden if its guard is removed. **(b)** A full-suite green quoted in place of naming the affected files and their counts — and **S74** makes the full-suite figure unquotable without a caveat anyway (`wp5/latency.test.ts` US6 AC1 fails 2 of 3 full-suite runs on a wall-clock RTT band while 364 files run in parallel, green 11/11 in isolation, **pre-existing**). Name it or do not quote the figure. **(c)** Attributing a red to a sibling without measuring it: B53's edits are live in all four files this WP must prove it did not touch. **(d)** Tripping **S70** — `wp88/test_ac1_route_census_derived_visible.test.ts` pins a whole-test-tree property (exactly one file under `plugin/src/__tests__/` may contain the literal `endSession`) and fails **under WP88's name** when a new suite adds a stub. If this WP's new suites redden it, that is S70, not a WP94 regression, and it is reported as such.

**Definition of Done:** a deletion is captured whenever the product can positively evidence that the record was on the surface the save came from and that the save is a complete observation of it; it is withheld — **named and counted** — whenever it cannot; no absence, however total, is ever by itself a licence to destroy; and a node and its edge cannot land in opposite directions.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed; use the default or `--reporter=dot`. Budget **≥90 s** for any automated `npm test` (a deliberate 33.5 s sleeper in `wp5/latency.test.ts` makes ≈41 s the floor, not a hang). `workflowArtifacts/RepoMap.md` is the structural map.
- **🚨 RULE 14 — the working tree is shared.** `git status` before every stage and every commit; stage **explicit paths only**; never revert, stash or `checkout` over a sibling's changes. **B53/WP93 is live in `plugin/src/main.ts`, `plugin/src/files/vault-events.ts`, `plugin/src/files/file-ops.ts` and `plugin/src/files/canvas-sidecar.ts` at chartering time.** If a coder believes this WP requires editing any of the four, that is an **ESCALATE**, not an implementation choice.
- **⚠ Every `main.ts` and `vault-events.ts` line number in this charter is stale by construction.** Given at `e1241a5` for symbol location only; the tree has already moved `noteHandover` `:2589` → `:2599` and `handleLocalModify`'s call site `:278` → `:321`. **Re-locate by symbol name (rule 5).** The three files this WP may edit — `canvas-shadow.ts`, `canvas-sync.ts`, `canvas-persistence.ts` — are byte-identical between `e1241a5` and the tree (`b6244c94`, `5fef347b`, `613d8282`) and their numbers hold at both.
- **⚠ ORDERING WITHIN THE WP IS NOT NEGOTIABLE.** AC3's completeness proof lands **before** AC2's widened receipt set. Gate B is currently the only barrier between a truncated read and the destruction of a shared board; widening it first, even for one commit, ships that path. A coder who reverses the order has committed the defect this WP exists to avoid, in the WP that exists to avoid it.
- **The bundle under measurement is contended, and two signals govern it.** **S67** — the repo's committed `plugin/main.js` is not the installed bundle; anyone running `liveshare_e2e_install.py` without `LS_EXPECT_SHA256` **silently changes the code under measurement**. **`S57(installer)`** — installed bytes are not loaded bytes. Both apply to every live row and they compose. **State the bundle sha256 in every live row.**
- **S65 and S71 govern every log-based claim.** Stamp-to-flush lag is **bimodal**: ~0.5 s normally, **60.00 s ± 0.02 under a host wake-up clamp**, with two independent timers clamping together. **Log absence is not evidence.** Every reader must prove its pattern matches a known-present line **and** that the watermark advanced past the action window. AC6's counters exist so that no AC in this charter needs an absence claim at all.
- **S80** — the withhold requires an open leaf on the host, and an open leaf makes Obsidian's own canvas view a second writer to the same `.canvas`. AC5 is headless for that reason, and any live row that opens a board must expect the host application to rewrite records it does not like (B50 §2.5).
- **The E2E suite is not idempotent by default.** Nodes persist between runs and make presence checks true for free. Per-run ids and an explicit reset are mandatory for every live row.
- **Roles have swapped since B50** — A = guest (:39431), B = host (:39432), by server designation. Assert the role through `session.info`; never assume it from a document.
- **The existing test that must change, and it is not a hollow one.** `wp5v2/test_tp05_handover_and_close_visible.test.ts` **T1** (`:152-183`) asserts that an omission without a hand-over receipt must not delete, wired through the **real** store, arguing I7. It is correct about I7 and incomplete about coverage. **Amending it is in scope and requires a written argument in the implementation report** for why the new criterion still satisfies I7 — the criterion in AC2 is that argument and it must be quoted, not paraphrased. **T2, T3, T4 and T5 must survive unchanged**, and T3 in particular ("an interacting record is never handed over, so it cannot be deleted") interacts with AC4: if AC4's node/edge repair changes T3's outcome, that is an ESCALATE with the reasoning, not a silent edit.
- **What must NOT be done to make this easier, each an abort criterion:**
  - deleting by key removal instead of tombstone (WP19);
  - reintroducing the seed's delete-by-omission (WP29 AC2) as a "receipt";
  - adding a seventh `CAPTURE DECLINED:` reason (§2);
  - making `parseCanvas` throw (it has callers that depend on degrade-never-throw);
  - flipping `useCanvasBinding`;
  - writing a canvas-state conditional into `main.ts` (§3.1 S11).

---

## 6. Definition of Done Artifacts

- `ImplementationReport_WP94.md` — the trace, the criterion as implemented, the truth table with every cell's driven evidence, the amended `test_tp05` T1 with its I7 argument in full, and the AC7 closed-board result stated as confirming or falsifying the prediction.
- Visible tests per §7, all green, with the pre-repair RED controls recorded as having been observed before the repair.
- A live validation pass by W4 against two Obsidian instances covering the four W4 targets in §7b, every row carrying its bundle digest and its rule-15 + flush-watermark controls.

### Proposed for the Dispatcher to land — this charter does not edit `BUILD_SPEC_CanvasV2.md`

**§9 row (append after WP93):**

```
| **WP94** | **P0** | **The delete licence has one issuer, and the user's own edit never meets it** | `planIntentDiff` rule 4 (`canvas-shadow.ts:566-579`) computes the delete-candidate set correctly and then requires `surface.handedToView[kind].has(id)` (`:574`). **That set has exactly ONE production producer** — `main.ts:2589` `noteHandover`, inside `reconcileLiveCanvas`, reachable **only from a REMOTE delta** (`canvas-sync.ts:2980` returns early for a local edit). A record this client created and no peer re-delivered therefore holds **no licence, ever**: `plan.deletes` is empty, `applyIntentPlan` writes nothing, and all six `CAPTURE DECLINED:` reasons are unreachable because they fire in front of the diff — **`local modify` = 1, `declines` = 0, S78 exactly.** Derived and wider than measured: rule 4 is gated on `viewOpen`, so **a closed board never captures a deletion of any record, ever**, while creations and mutations capture normally. Scope: an explicit, pure **evidence criterion** — `Receipt(X, surface) ∧ Complete(save) ∧ Present(X) ∧ ¬Seen(X, save)`, in which **absence never authorises and a receipt does** · the producer set widened from one to three, each a fact the product already asserts, **per-surface and surface-matched** · **the completeness proof lands FIRST** because `parseCanvas` degrades every JSON error to an empty canvas (`canvas-sync.ts:608-611`), so a widened gate ahead of it turns every truncated read into a total board destruction — **I11 inverted, the WP80/D3 shape one level down** · the `SEED REFUSED:` polarity kept distinct (refused = absent from doc, present in file; deleted = present in doc, absent from file) **and** the host seed's own shadow advance over refused records (`canvas-sync.ts:2927` over `:3996-4039`'s refusals) stopped from manufacturing a candidate for a record with no `Y.Map` · **`buildApplyReceipt`'s branch asymmetry settled**: geometry gives edges `"unchanged"` (`:821`, always confirmed, always handed) and nodes `geometryNodeOutcome` (`:819`, defaults unconfirmed), so **node and edge deletions have different licence widths and one gesture can half-apply** · a failed structural reload's empty `summary.handed` **silently voiding every licence on the path** (`:817` → `:1110`) made explicit, named and counted · **a withheld deletion NAMED and COUNTED** under its own signature with its own closed reason set — **not** a seventh `CAPTURE DECLINED:` reason, which would break that set's closure and make `declines` uncountable against `local modify`. **WP19's tombstone containers, WP29's non-deleting seed, WP4's byte echo breaker and `canvas-shadow.ts`'s purity all byte-unchanged, each with a driven control.** | **WP2, WP5, WP19 (`DONE`), WP29, WP63/WP90** | **planned** |
```

**Header arithmetic (BUILD_SPEC line 21):** currently `**Work packages:** **92** live (WP1–WP83, WP85–WP93; **WP84 withdrawn — see §9, the number is not re-used**)`. **92 + WP94 = 93 live.** Proposed replacement: `**Work packages:** **93** live (WP1–WP83, WP85–WP94; **WP84 withdrawn — see §9, the number is not re-used**)`. WP84 remains a withdrawn row counted zero and its number is still not re-used.

**§10 signature row (append to the table at BUILD_SPEC `:2768`):**

```
| `DELETE WITHHELD:` | new | WP94 — `canvas-sync.ts` `handleLocalModify`, ONE production emitter. `DELETE WITHHELD: <path> <n> record(s) absent from the save were not deleted: <kind>/<id> reason=<no-open-surface|no-receipt|incomplete-observation|refused-at-ingest>, … (withheld=<n per reason>)`. **Kinds, ids, reasons and counts only — never a field value and never node text (US6).** Per RECORD, inside a pass that DID capture — deliberately NOT a seventh `CAPTURE DECLINED:` reason, whose six members all describe a whole pass that captured nothing and all fire in front of the diff. Paired with a state accessor on the WP91 `captureDeclineCounts()` precedent, because under S65/S71 the log is not an oracle. |
```

**Naming note for the Dispatcher.** `DELETE WITHHELD:` is proposed for its symmetry with two signatures the project already has: `SEED REFUSED:` withholds a **write** because a record is malformed, `CANVAS WRITE HELD:` withholds a **write** because the moment is wrong, and this withholds a **delete** because the evidence is thin. All three are I11 refusals and none destroys. **The signal number for the closed-board derivation in AC7 is NOT allocated here** — it is described and handed to the Dispatcher: *rule 4's `viewOpen` gate means an instance with no open canvas leaf captures creations and mutations and never captures a deletion, of any record, at any delta; derived from `canvas-shadow.ts:567` and `main.ts:207-208`, not yet observed live.*

---

## 7. Visible Test Cases / Producer Artifacts

**Order is mandatory** — AC3 before AC2, for the reason in §5.

| # | file | covers | the RED it must show first |
|---|---|---|---|
| 1 | `wp94/test_ac1_local_origin_delete_is_lost_visible.test.ts` | AC1 | production-wired store, `handedToView` empty, create lands and delete does not, all six decline counters unmoved |
| 2 | `wp94/test_ac3_incomplete_observation_deletes_nothing_visible.test.ts` | AC3 | truncated / prefix / empty / missing-key ⇒ 0 deletes, **paired with** a genuinely cleared canvas ⇒ N deletes |
| 3 | `wp94/test_ac2_delete_evidence_truth_table_visible.test.ts` | AC2 | every cell, four corners driven end-to-end, `wrong-surface` row present |
| 4 | `wp94/test_ac4_edge_and_combined_delete_visible.test.ts` | AC4 | mixed node+edge outcome reachable pre-repair; edge oracle is the tombstone, never the projection |
| 5 | `wp94/test_ac5_refused_at_ingest_is_not_a_delete_visible.test.ts` | AC5 | refusal asserted as state; no tombstone; the id remains creatable |
| 6 | `wp94/test_ac6_withhold_is_named_and_counted_visible.test.ts` | AC6 | each reason +1, all others unchanged, per-record not per-pass |
| 7 | `wp94/test_ac7_closed_board_create_works_delete_does_not_visible.test.ts` | AC7 | headless companion to the live row |
| 8 | `wp94/test_ac8_no_collateral_visible.test.ts` | AC8 | five driven guards, each shown to redden when removed |

**Amended, not new:** `wp5v2/test_tp05_handover_and_close_visible.test.ts` **T1 only**. T2–T5 unchanged.

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

Four live rows, each stating its bundle sha256, its role assignment read from `session.info`, its rule-15 historical-hit control and its proven flush watermark:

1. **The S78 shape, repaired** — B50's `DELETE_A` rung: create a node on the writing instance by a whole-file write, wait for it to reach the peer, then remove it. Pre-repair `0/N` captured at every delta; post-repair `N/N`, with the peer's copy gone from the peer's **file**. Oracle is the writer's own doc through `canvas.state` (tombstone-suppressed by `getCanvasSnapshot`, `canvas-sync.ts:2449-2467`) plus the peer's file.
2. **The closed board (AC7)** — board closed, path subscribed, no adapter attached; add a node, then remove one. **Create works, delete does not** pre-repair; both land post-repair.
3. **Edge and node+edge (AC4)** — an edge deleted with both endpoints surviving, and a node+edge deleted together; assert all-or-nothing and that the arrow does not return alone.
4. **The withhold is visible (AC6)** — the per-reason counters read **synchronously** through the control surface, non-zero on a driven reason, with no dependence on the debug log.

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*(empty — filled at implementation time)*

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*(empty — filled at implementation time)*

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*(empty — filled at implementation time)*
