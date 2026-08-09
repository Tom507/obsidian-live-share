# WP116 — Hash agreement is not identity, and it is not convergence

**Signals:** S158 (instrument, blocked the next live round) · S159 (data loss)
**Branch:** `fix-bugs-and-raceconditions` · **Base:** `2ae56e6` · **Worker:** sole occupant of the tree

Both packages came from WP112 §A4's census of every place this codebase reads *"the hashes match"* as
*"the state is right"*. The owner's sentence is the whole of it: **hash agreement is evidence of
agreement, not of correctness.** Reported separately below.

---

## Gate

| gate | figure |
|---|---|
| `npx vitest run` (baseline, quiet tree at `2ae56e6`) | **3112 passed / 416 files** — re-measured by this worker, matches the Dispatcher |
| `npx vitest run` (final, **uncommitted**) | **[3155 passed / 417 files] + [1 failed / 1 file]** |
| `npx vitest run` (final, **after `8585475`**) | **[3156 passed / 418 files], 0 failed** |
| the one uncommitted failure | `v2/wp92/test_tp06_no_collateral_visible` — **`S153`, the known trap, confirmed in both directions.** It asserts a file is absent from `git diff HEAD`, so it was red while this work was uncommitted and went green the moment it was committed, **unchanged**. **Not edited** (it is WP92's test). One more datum for S153: the suite figure is a function of the worker's git hygiene, not of the code. |
| `npx tsc --noEmit` | **clean, exit 0** |
| `check_signal_register.py` | **exit 0** |
| break table `wp116_break_table.py` | **15 rows**, baseline 247/247, final green 247/247, **0** `.pre-v2-smoke` leftovers, every row restored byte-identically by sha256 |
| net new tests | **+43** (24 for S158, 19 for S159) |

Not done, by charter: no rebuild, no deploy, no vault touched, no `biome check --write`, `git add` by
explicit path only, no signal numbers allocated.

---

# PACKAGE A — S158: the convergence oracle could not tell convergence from a shared loss

## A0. The charter's premise, corrected in one place

The charter and the register both cite **two** sites: `e2e-control.ts:305 sameFileObservation` and
`:1966 endpointChanged`. **Only the first is a convergence oracle.** `endpointChanged` compares a
`before` and an `after` reading of **the same endpoint on the same peer** (`endpointChanged(before[i],
after[i])` at the `fileop.inject` call site) — it is a temporal change detector answering *"did this
injected op mutate anything?"*, not a peer-to-peer comparison. It belongs to the same family (a digest
read as a statement about state) but it is not the thing that scored `converged`, and it is untouched
here. **One site, not two.**

Second correction, and it is in the project's favour: *"every `converged` verdict in every validation
report came from it"* is **too strong**. `ValidationReport_WP111_LiveW4c.md` §P1 — the sixteen readings
behind the four `converged 0.31–0.52 s` cells — waited for *"all three disk copies to be byte-identical
**and** to contain all three markers"*, and the three markers `[A] [B] [C]` were authored by the round
itself. That is a `contains`-shaped external reference point, arrived at by hand. What is true is that
the **rig has never had a durable one**: every round that wanted a reference point had to invent one,
and the only oracle the tree ships scored agreement alone. That is what this package repairs. §A4 below
lists which verdicts rest on which.

## A1. The oracle, and what its reference point is

New pure block in `plugin/src/testing/e2e-control.ts` (nothing else was moved or deleted):

```
judgeConvergence(peers: PeerFileObservation[], expected: ExpectedContent) -> ConvergenceJudgement
judgeFileAgainstExpectation(file, expected) -> ConvergenceClause[]     ← correctness, one peer
evaluatePeerAgreement(peers) -> { agree, peers, disagreeing }          ← ARRIVAL, kept askable (A3)
EMPTY_SHA256, CONVERGENCE_VERDICT
```

**The reference point is `ExpectedContent`: a statement of what the bytes are supposed to be, supplied
as a second input.** No amount of care applied to the peers' readings can recover information that is
not in them, so the repair is a second input, not a cleverer comparison. Four clauses, any combination:

| clause | what it states | why it is offered |
|---|---|---|
| `exists` | the file is / is not supposed to be there | absence and emptiness are different states |
| `sha256` | the exact expected digest | a pre-recorded expectation, the strongest form |
| `contains` | markers that must survive | **WP111 §P1's own method, made durable** — the gesture's intended content |
| `atLeastBytes` | a floor on the size | the cheapest clause to record before a round (`stat`), and the one that catches a truncation without knowing the exact bytes |

Plus one **mandatory, non-optional** field and one **structural** clause:

- **`origin` (required, non-empty).** The one way to defeat an expectation oracle is to derive the
  expectation from a peer. The cheapest defence is to make the caller write down where it came from; an
  expectation with no stated origin is `UNJUDGEABLE`. This is a discipline, not a proof — see §A6.
- **`emptiness-must-be-asserted`.** Always evaluated, never optional. An **existing file holding zero
  bytes is a FAILURE unless the expectation says in so many words that it should be empty**
  (`sha256: EMPTY_SHA256`, or `atLeastBytes: 0`). This is what makes the repair survive a lazy caller,
  and it is the direct transcription of `S119`: a run whose expectation was only *"the file should still
  be there"* would have passed clauses 1–4 alone. The cost — one explicit clause on a legitimately empty
  file — is paid and shown payable in `tp02c`.

Four verdicts, and **`CONVERGED` is the only green one**:

| verdict | when |
|---|---|
| `CONVERGED` | peers agree **and** every stated clause is satisfied |
| `AGREED_ON_WRONG_BYTES` | **the S119 class.** Perfect agreement on a state the expectation forbids |
| `DIVERGED` | the peers do not agree. No claim about which of them is right |
| `UNJUDGEABLE` | <2 peers, no `origin`, or no clause. **Never green** — a question that could not be asked is not a pass |

**There is deliberately no path to `converged: true` that does not pass an expectation.** The weak
reading is unreachable through this function rather than merely discouraged (`tp05e`).

The precedent was already in the tree and is cited in the header: WP23's `intent-trace` family in
`__tests__/harness/fuzz/oracle.ts` is exactly this move for the headless fuzzer, and its header carries
the same sentence — *AGREEMENT BETWEEN REPLICAS IS NECESSARY BUT NOT SUFFICIENT*. The live rig simply
never got it.

**Reachable from the live rig.** `routeCommand` gained `convergence.judge` — **pure, touching no host
method at all**, because the readings arrive in the request. The live rounds are driven from Python and
the alternative was a second implementation of the rule on the driver side, which is how a rig ends up
with two oracles that disagree. One rule, one implementation, pinned by the unit tests, reachable by
whatever drives the round. `tp07d` runs the payload through `JSON.parse(JSON.stringify(...))` first, so
the wire is asserted to be the same rule.

## A2. THE ACCEPTANCE TEST — demonstrated, not argued

`plugin/src/__tests__/v2/wp116/test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts`, rows
`tp01a`–`tp01e`. The input is `S119` transcribed: `hello.md` held 49 bytes at the pre-round census; all
three clients read `exists:true, sha256:e3b0c442…, size:0, content:""`.

| row | subject | result |
|---|---|---|
| **tp01a** | **THE DEFECT, EXECUTED.** `evaluateCanvasConvergence` on the truncated readings | `converged: true`, `fileConverged: true`, `reason: null` — and it returns the **identical verdict** for the intact run, which is the defect stated as an identity |
| tp01b | the peers really do agree | `agree: true`, `disagreeing: []` — so `tp01c` is not passing for want of agreement |
| **tp01c** | **ACCEPTANCE.** `judgeConvergence(threePeers(TRUNCATED), CENSUS_BEFORE)` | **`AGREED_ON_WRONG_BYTES`**, `converged: false`, `peersAgree: **true**`, `matchesExpectation: false`, `violations: ["atLeastBytes"]` |
| **tp01d** | the same input under a **lazy** expectation (`exists: true` and nothing else) | still **`AGREED_ON_WRONG_BYTES`**, `violations: ["emptiness-must-be-asserted"]` |
| tp01e | `EMPTY_SHA256` is the real digest of zero bytes | verified against `node:crypto`, so the rows above are about the real signature |

**The failure is reported as a failure of correctness, not of agreement**, and both facts are on the
verdict. That distinction is the deliverable: `peersAgree: true` and `converged: false` in one object
is the sentence *"everyone lost the same bytes"* said out loud.

**Negative controls, because an oracle that only ever fails detects nothing** (`tp02a`–`tp02d`): the
honest green is still green; an exact-digest + markers + size expectation is *satisfiable*, not merely
refusable; a legitimately empty file passes when somebody asserts the emptiness; an absent file expected
absent is `CONVERGED` and the emptiness clause is inert for it (`detail` says so).

## A3. Nothing the rig could express was removed

- `evaluateCanvasConvergence` and `sameFileObservation` are **byte-unchanged**. `tp04b` pins all three
  of WP49's cases with `toStrictEqual` on the whole verdict object, so the D17 contract is still live.
- What changed around it is a header that names `S158`, states that the function answers **arrival**,
  and points at the new one. It is no longer *the* thing called convergence; it is one of two named
  questions.
- `evaluatePeerAgreement` gives the arrival question its own N-peer entry point (`tp04a`).
- `judgeFileAgainstExpectation` gives single-peer **correctness** its own entry point, so a one-peer
  read is judgeable without dressing it up as a convergence claim (`tp04c`).

## A4. What this does to the existing reports — **no report was edited**

They are the record of what was believed on a day and they stay that way.

| record | what its greens rested on |
|---|---|
| `ValidationReport_WP111_LiveW4c.md` §P1 — the four `converged 0.31–0.52 s` cells, 16 readings | **Byte-identity across three peers PLUS all three authored markers `[A][B][C]` present.** The marker check is an external reference point. **These greens do not rest on the weak oracle** and a later reader should not discount them. The charter's *"every verdict"* is corrected here. |
| `ValidationReport_B56_LiveW4.md` (l. 467–470) — *"vault A is byte-identical to …", "the pre-run 8 files"* | **Mixed.** Cross-peer byte-identity is the weak reading; *"holds its pre-run 8 files"* is a count against a pre-round census — a real but **coarse** external reference (a count cannot see a truncation). Read the byte-identity claims as *agreement*, and the file-count claims as the only correctness statement in them. |
| `ValidationReport_B50_LiveW4.md` (l. 201) — *"bytes byte-identical (sha256 compared)"* at a rename destination | **Weak reading, but low exposure**: it compares the destination to the **pre-move source recorded before the arm**, which is a pre-round census, not a peer. Effectively a hand-rolled `sha256` clause. |
| `ImplementationReport_WP49.md` and the `wp49/tp6–tp8` rows | These are tests **of** the oracle, not verdicts produced by it. Unaffected. |
| Everything the **fuzzer** ever scored (`WP18`–`WP36`, `v2/wp23`) | Already had `intent-trace`. Unaffected, and the model this package copied. |

**The operative statement for a later reader:** before this package, the rig shipped **no oracle that
could fail a run in which every peer agreed**. Any green in a live report that is stated purely as
*"all three peers matched"* proves agreement and nothing more — including, by construction, the three
data-loss repairs the next round exists to validate. That round can now assert against
`ExpectedContent`, and `S119`'s exact shape is a FAILURE.

---

# PACKAGE B — S159: hash equality read as file identity

## B1. The mispairing, and the charter's question answered

**It is not empty content only. It is ANY duplicate.** `hash("")` is a full 64-character digest and
nothing in `matchRenamesByHash` treated it specially; `tp01b` shows two **ordinary** notes with
identical bytes — a shared template, the commonest thing in a vault — producing the identical
mispairing as two empty ones (`tp01a`). **Empty content is not the defect; it is the most abundant
supply of it**, and `S119` left eighteen zero-byte `.md` files in one live vault. This raises the
severity: the trigger is not a post-incident vault state, it is a normal one.

The mechanism, exactly: the old loop walked `removed` in array order and, for each key, took the
**first** `added` key whose manifest hash matched, then `break`. It decided per key **while walking**,
so when a rival carrying the same bytes was still in the future it could not see that it had made a
choice at all.

**What the destructive half then does — stated precisely, because it is not what one first assumes.**
A tie requires equal bytes, so a wrong pair **cannot corrupt the destination's content**. What it does
instead, all three executed in `tp02`/`tp03` against the shipped `processManifestChange`:

1. **`vault.rename` moves the wrong file.** In Obsidian the path *is* data: wikilinks resolve by name,
   folder-scoped queries by parent, and ctime follows the file object. An irreversible move chosen by a
   coin flip on arrival order.
2. **The file the room did *not* delete is the one that gets trashed, and the one it did delete
   survives.** A key consumed by a rename is excluded from `actuallyRemoved`; the loser is not, so it
   goes `decideManifestRemoval` → `DELEGATED` → the gated `cleanupStaleFiles` → `trashFile`. The
   outcome is exactly inverted. `tp02b` executes the whole chain — real `cleanupStaleFiles`, real
   `trashFile` — and `tp02c` is its vacuity guard: the same reconcile in the same rig with the
   evidence withdrawn trashes **nothing**, so the floor demonstrably opens and closes.
3. **The answer depended on arrival order**, so two peers handed the same manifest event with the keys
   in a different order moved **different files** and diverged permanently and silently. `tp03a`.

## B2. The fix — content equality alone can never establish identity

New pure, **zero-import** module `plugin/src/files/rename-identity.ts` (the `files/protected-paths.ts`
precedent, and it lives there so `manifest-removal-decision.ts` can share its accepted-basis list
without importing `utils.ts`, which imports `obsidian` on line 1).

```
pairRenamesByIdentity(removed, added, removedHashOf, addedHashOf) -> { pairs, ledger }
matchRenamesByHash(...)  ← unchanged signature, delegates. THE MEANING CHANGED, NOT THE SHAPE.
RENAME_PAIRING, IDENTITY_BASES, basenameOf
```

The rule, in order:

1. A digest carried by **exactly one removed key and exactly one added key** is identity evidence —
   in this event nothing else could have gone anywhere else. `paired-unique-content`.
2. When more keys share the digest, content has said nothing about *which* went *where*, so the pairer
   looks for evidence that is **not content**: a **path relationship**. If exactly one added candidate
   inside that digest class keeps this removed key's **basename**, and no rival removed key claims that
   basename either, the file kept its name and changed folder.
   `paired-unique-basename-within-content-class`. This rescues the ordinary *"drag three identical
   stubs into a subfolder"* gesture (`tp01d`, and live in `tp04e`).
3. Otherwise **REFUSE**. `refused-ambiguous-content-identity`. **I11 — a refusal never destroys.**

Both rules are **order-independent by construction** (`tp01f`): neither reads a path's position.

**What a refusal costs, stated so the trade is visible rather than assumed.** An unpaired removed key
falls to `decideManifestRemoval` → `DELEGATED` → the **gated** `cleanupStaleFiles`; an unpaired added
key falls to `syncFromManifest` / `backgroundSync.onFileAdded`. The end state is the same bytes at the
same new path. **What is lost is the move** — ctime, and the difference between *moved* and *trashed
then re-fetched*. The primary rename route (a real rename op over `file-ops.ts`, carrying an explicit
old→new pair and needing none of this) is untouched, and it is the one users actually see; this arm is
the manifest-diff fallback behind it.

**The second site the charter named**, `manifest-removal-decision.ts` `hasContentPair`:

- The `RENAME` verdict's **reason string was the defect written out in prose** — *"the removed key's
  local content hashes to the added key's manifest hash, **so** this is the same file re-keyed by a
  rename"*. That `so` is the false inference, and it is the sentence the destructive half acted on. It
  now states what the evidence actually is.
- New optional field `identityBasis`, checked fail-closed against `IDENTITY_BASES` (`tp05b`).
  **Ambiguity is not decidable in this core** — it sees one pairing and ambiguity is a property of the
  whole event — which is why the rule had to live in the pairer. `tp02b` proves this by executing the
  old answer through the shipped core and showing it is admitted.
- The field is **optional**, deliberately, so that **no WP86 test needed editing**. The residual that
  creates — a future call site that forgets it — is closed by an instrument rather than by hope:
  **`tp05c` derives every `decideManifestRename` call site in `main.ts` from the tree and requires each
  to state an `identityBasis`**, in the `v2/wp86` census idiom, with its own positive control. Break
  row **W13** proves it detects a stripped call site.

**S155's rule is obeyed.** `pairRenamesByIdentity` returns a `ledger` with **one row per removed key in
every branch**, including all three refusals and the do-nothing ones, each with a populated reason.
`main.ts` logs every row and puts them on `ManifestChangeDisposition.renamePairing`, so *"ran and
refused"* can never again read byte-identically to *"never ran"*. Break row **W14** reddens three tests.

## B3. Ordinary renames still follow — asserted in both states

All five rows drive the shipped `processManifestChange` end to end.

| row | gesture | result |
|---|---|---|
| tp04a | same-folder rename of a **non-empty** note | moved: `draft.md → final.md`, basis `paired-unique-content`, nothing trashed |
| tp04b | **cross-folder** move of a non-empty note (`S135` stays repaired) | moved: `inbox/idea.md → archive/2026/idea.md` |
| **tp04c** | ordinary rename of an **EMPTY** note — the second state the charter asks for | **moved**: `Untitled.md → Meeting.md`. One of each, digest unique on both sides ⇒ identity holds. **Emptiness is not treated as a disqualifier; AMBIGUITY is.** |
| tp04d | Bug E's original case — two concurrent renames, handed in the crossed order | both pair by identity: `A→B`, `C→D` |
| tp04e | three identical stubs dragged into a subfolder | all three follow, via the basename rescue; nothing trashed |

## B4. WP95's hostile case is still pinned

`tp05a`. The hostile publication removes a shared key and adds
`.obsidian/plugins/live-share/main.js` with the **same content**, so the pair is **unambiguous and the
S159 fix admits it** — which is the point: the refusal must not depend on the pairer. The
protected-destination floor runs **first**, ahead of every other test, and refuses with *"the
destination lies under the protected tree"*; `vault.rename` is never reached. The row asserts the
pairer paired them (`paired-unique-content`) **and** that nothing moved, so a future change to the
pairer cannot silently re-open WP95. The entry is planted straight into the shared `files` map rather
than published, which is not a shortcut but the accurate model: our own `passesLocalSafetyFloors`
refuses to publish under `.obsidian/**`, so such a key can only ever arrive from a peer not running our
publisher. WP95's own three test files are in the break-table's neighbour set and stayed green in all
15 rows.

---

## Break table — `workflowArtifacts/canvas-v2/wp116_break_table.py`

Baseline **247/247**, final green **247/247**, **0** copy-aside leftovers, **every** row restored
byte-identically (sha256). 15 rows over the four edited production files plus ten neighbour files
(WP49 ×4, WP72, `utils`, `manifest`, `regression`, WP86 ×2, WP95 ×3).

| row | plant | RED |
|---|---|---|
| **W1** | **A's defect verbatim** — the oracle stops consulting the expectation | **tp01c (ACCEPTANCE)**, tp01d, tp07a, tp07d |
| W2 | the emptiness clause is always satisfied | **tp01d**, tp04c, tp07d |
| W3 | `atLeastBytes` compares nothing | tp01c, tp03b, tp04c |
| W4 | `UNJUDGEABLE` is reported as green | **5 rows**, all of tp05 |
| W5 | the `origin` requirement is dropped | tp05 (origin) |
| W6 | a clause-free expectation is accepted | tp05 (no clause), tp05e |
| **W7** | **NEGATIVE CONTROL (A)** — a clause `detail` nobody asserts is reworded | **nothing. 247/247** |
| W8 | peer agreement hardcoded true, so `DIVERGED` is unreachable | tp03a, tp03b, tp04a |
| **W9** | **B's defect verbatim** — first candidate in array order wins again | **10 rows**, incl. `utils.test.ts` and the live `tp02a`/`tp02b`/`tp03a` |
| W10 | the basename rescue accepts an ambiguous basename | tp01e |
| W11 | the bijection guard is disabled | **nothing** — reported, not dropped: see the residual below |
| W12 | the core stops checking the stated basis | tp05b |
| W13 | `main.ts` stops stating the basis | tp05c |
| W14 | the ambiguous refusal stops being ledgered (S155) | tp01a, tp01c, tp02a |
| **W15** | **NEGATIVE CONTROL (B)** — the no-content-match reason is reworded | **nothing. 247/247** |

**W11 is reported rather than deleted.** With rules 1 and 2 in force, a digest class is either 1×1 or
resolved by a basename unique within it, so no added key can be claimed twice and the guard is
currently unreachable. A guard nothing can redden is a guard nobody should trust; it is kept as a cheap
invariant on a code path whose whole history is "somebody assumed a choice had already been made", and
its untestability is stated here rather than papered over.

---

## What I rejected, and why

1. **Deleting or rewriting `evaluateCanvasConvergence`.** A3 forbids it and A3 is right: *"did this
   reach B?"* is a real question. Kept byte-unchanged, renamed in prose, given a sibling.
2. **Normalising anything in `sameFileObservation` to make the new oracle easier.** WP49's header
   already says normalisation is what would hide the divergence it exists to catch. Untouched.
3. **Making the expectation optional with a permissive default.** That reproduces S158 behind a new
   API. `UNJUDGEABLE` is never green, and `tp05e` asserts there is no input at all that yields
   `converged: true` without a clause.
4. **Cryptographically preventing an expectation derived from a peer.** Not possible inside a pure
   function. Chose the mandatory `origin` (a discipline that leaves a trace) over a false guarantee.
   Named as a residual, not sold as a fix.
5. **Re-implementing the convergence rule in Python for the live driver.** Two implementations is how
   a rig gets two oracles that disagree. Exposed the one implementation over the existing control
   envelope instead, with a JSON round-trip test.
6. **Treating the empty digest as a special disqualifier in the pairer.** It is the intuitive fix and
   it is wrong twice: it would break the ordinary rename of an empty note (`tp04c`) and it would leave
   the far commoner duplicate-content case wide open. **Ambiguity is the defect; emptiness is a
   symptom.**
7. **Making `identityBasis` a required field on `decideManifestRename`.** It would have reddened three
   rows in WP86's `tp02` and forced me to edit another package's test to assert something different.
   Chose optional-but-validated plus a **tree-derived census** (`tp05c`) that fails on a call site
   without it.
8. **Guessing under ambiguity with any content-derived tie-break** (longest common path prefix, mtime,
   size). Every one of them is a guess dressed as evidence, and the answer under ambiguity is REFUSE.
   The basename rule was admitted only because a filename is a **path fact**, not a content fact.
9. **Editing any `ValidationReport_*.md`.** They are the record. §A4 says what they rest on instead.
10. **Touching WP92's `no_collateral`.** `S153`, another package's test, red only because this work was
    uncommitted.

---

## Residuals — everything I left

| # | residual | severity |
|---|---|---|
| R1 | **The oracle cannot verify that `ExpectedContent` was not read back off a peer.** `origin` is a stated provenance, not a proof. WP23's `intent-trace` solves the equivalent problem structurally by populating from the harness's own op log; the live rig has no op log to populate from. **The next live round must record its expectations *before* the gesture**, and `origin` is where it says so. | discipline |
| R2 | **`convergence.judge` is not yet called by any live driver.** The rule and the transport exist and are tested; wiring it into `tools/e2e/*.py` is the next round's work, not this package's (no rebuild, no deploy). | wiring |
| R3 | **Only the `canvas.file` projection is judged.** The doc projection (`canvasState`) still has only the peer-to-peer `sameRecordSet`. Same class, one level up; not chartered here. | open, same family |
| R4 | **`endpointChanged` (`e2e-control.ts`, the `fileop.inject` arm) is untouched.** It reads "digest unchanged" as "the op was refused", which is a different but related inference. §A0 explains why it was out of scope. | open, named |
| R5 | **WP112 §A4 items 1, 2, 4, 5 remain unfixed** — `syncFromManifest`'s empty-write evidence, `needsSync`'s mismatch-means-replace, `publishManifest`'s skip-on-equal-hash, and the five `lastWrittenContent`-style equality reads. Item 3 (this package) and item 6 (this package) are closed. | open, census stands |
| R6 | **W11's bijection guard is unreddenable** under the current rules. Kept, and its untestability is stated rather than hidden. | cosmetic |
| R7 | **`utils.test.ts`'s `"does not reuse an added path for two removed paths"` row was rewritten**, and this is the one existing test whose assertion this package changed. It pinned the defect — *first removed key in array order wins* — so it could not survive the fix. The row's second half (*C is left unmatched*) is unchanged; the change is that A is now unmatched too, and a new order-independence row was added beside it. Called out here so it is not discovered later as an unexplained edit. | disclosed |
| R8 | **The mispairing cannot corrupt the destination's bytes**, because a tie requires equal bytes. The damage is wrong-file destruction, path/ctime identity loss, and cross-peer divergence. I looked for a byte-loss story and did not find one; reporting the mechanism I could demonstrate rather than the one that would have read better. | scope of claim |
| R9 | **`main.ts`'s `orderedAdded` fallback still exists** (`preferred ? [preferred, ...rest] : added`). It is inert for the destructive branch — `decideManifestRename` refuses anything but the preferred target — but the loop still *iterates* unpreferred candidates and can take the non-destructive `!oldFile && newFile` bookkeeping branch on one. Untouched; WP86's shape, not S159's. | open, named |
| R10 | The harness's vault double does not exercise Obsidian's link rewriting, file cache, real trash semantics, or case-insensitive path collision. Stated in `harness.ts`'s header per the no-partial-doubles rule; nothing asserted here depends on any of them. | disclosed |

---

## Files

**Production**

- `plugin/src/testing/e2e-control.ts` — the S158 oracle block + `convergence.judge`; `evaluateCanvasConvergence` byte-unchanged, header amended
- `plugin/src/files/rename-identity.ts` — **new**, pure, zero imports
- `plugin/src/files/manifest-removal-decision.ts` — `identityBasis` floor, corrected `RENAME` reason, amended header
- `plugin/src/utils.ts` — `matchRenamesByHash` delegates to the new pairer
- `plugin/src/main.ts` — uses `pairRenamesByIdentity`, states `identityBasis`, logs the ledger
- `plugin/src/types.ts` — `ManifestChangeDisposition.renamePairing`

**Tests**

- `plugin/src/__tests__/v2/wp116/test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts` (24)
- `plugin/src/__tests__/v2/wp116/test_s159_hash_equality_is_not_file_identity.test.ts` (19)
- `plugin/src/__tests__/v2/wp116/harness.ts`
- `plugin/src/__tests__/utils.test.ts` — one row rewritten (R7), one row added

**Artifacts**

- `workflowArtifacts/canvas-v2/wp116_break_table.py`
- `workflowArtifacts/canvas-v2/ImplementationReport_WP116.md`
