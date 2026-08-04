# Amendment Feasibility — Set A: data model, capture, invariants, migration

**Scope:** Ä1, Ä2, Ä3, Ä4, Ä5, Ä10, Ä17 of `CONCEPT_V2_AMENDMENTS.md`.
**Method:** static reading of the working tree at branch `fix-bugs-and-raceconditions`
(`f4846c2`). No build, no test run, no source edit. Every status claim below is cited to
`file:line` in `plugin/src/`; where a claim rests on a document rather than on code, the
document is named. Nothing is inferred from `CONCEPT_V2.md`, from
`DEVELOPMENT_REPORT_CanvasV2.md` or from the amendment text itself.

**Given as measured (not re-verified here):** `useCanvasBinding` is `false` in both target
vaults, so the live capture path is `vault.on("modify")` → `handleLocalModify`
(`files/vault-events.ts:229-255`, `files/canvas-sync.ts:2736`). P0/P1/P2/P6/VI are built;
P3 (WP31–35), P4 (WP36–38) and P5 (WP39–40, WP52–54) are not. Every green is headless.

---

## Ä1 — Endpoint optionality + TOTALITÄT

### Status — **SPLIT: the endpoint half is ALREADY SATISFIED; the TOTALITÄT rule is NOT**

**Endpoint optionality — already satisfied, at four independent depths:**

- `canvas/canvas-registers.ts:448-452` — `EndpointRegister` declares `side?` and `end?`
  optional, with the JSON Canvas justification in the doc comment.
- `canvas/canvas-registers.ts:578-591` — `encodeEndpoint` throws only on a missing/empty
  `node`; `side`/`end` are normalised to *key omitted*, never `""`/`null`.
- `canvas/canvas-registers.ts:645-659` — `encodeEndpointFromFile`: "`The *Node key ALONE
  decides whether a register is built`". A malformed `*Side` is dropped, not escalated to
  voiding the endpoint.
- `canvas/canvas-registers.ts:677-682` / `:758-760` — `isEndpointRegister` and
  `hasBothEndpoints` decide presence on `node` alone.
- `canvas/canvas-ingest-schema.ts:277-290` — `validateEdgeIngest` is exactly
  `id ∧ from.node ∧ to.node`, and asks `hasBothEndpoints` rather than re-deriving it.

The `"text": ""` half of the Teil 11 replacement is also landed:
`canvas/canvas-ingest-schema.ts:169-172` accepts any string including `""`, and
additionally the future `Y.Text` object shape. `file` and `url` keep non-empty with a
stated reason (`canvas-ingest-schema.ts:193,195`; ruling recorded at
`BUILD_SPEC_CanvasV2.md:484`) — which is precisely the "explicit, named reason" Ä1
demands for an extra restriction, so that is compliant, not a violation.

Unknown node types carry **no** type-specific requirement rather than being refused
(`canvas-ingest-schema.ts:190-196`), which is the forward-compatible reading TOTALITÄT
wants.

**The concept text is still wrong and still needs the edit:** `CONCEPT_V2.md:395-396`
still reads `from = {node, side, end?}` with `side` unmarked. `CONCEPT_V2.md:698-699`
(Teil 11) was already correct. The contradiction the report calls A1 is therefore live in
the document and closed in the code.

**TOTALITÄT is NOT satisfied — two representation gaps found, both destructive by
construction, neither protected by the I11 machinery:**

1. `files/canvas-sync.ts` `parseCanvas` reads **only** `parsed.nodes` and `parsed.edges`.
   `buildCanvasData` emits **only** `{nodes, edges}`. Any other top-level key in the
   `.canvas` document — JSON Canvas does not forbid them and Obsidian has shipped
   documents carrying extra top-level attributes — is dropped at parse and written out of
   the user's file at the next flush. There is no refusal, therefore no signature, no
   ledger entry and no withhold: the key simply never exists in the doc.
2. `parseCanvas` drops any node/edge whose `id` is falsy (`if (node.id)`), silently and
   **before** the ingest gate. Ä3 names exactly this class ("id-los") as the recovery
   journal's subject. Composed with the single writer, an id-less record in the user's
   file is deleted on the first flush, and the withhold cannot arm because no refusal was
   ever recorded.

These are the model bugs TOTALITÄT would have named. They are real and currently open.

### Difficulty

- **Concept text:** S — two lines in `CONCEPT_V2.md` (`:395-396`), one normative
  paragraph each in Teil 4 and Teil 11. Zero code.
- **Closing the two gaps:** M — ~2 WPs. Gap 1 touches `parseCanvas`, `buildCanvasData`
  and `toCanonicalFileRecord` (a doc-level "carry-through" container in `meta`, or a
  verbatim passthrough of unknown top-level keys); it interacts with C17 AC3
  (cross-replica byte equality), because a carried-through key must be part of the
  canonical projection or two replicas will disagree. Gap 2 touches `parseCanvas` plus
  whatever journal Ä3 lands.
- **Risk:** gap 1 is the riskier one — the canonical serializer is the byte oracle for
  eight WP17 tests and for the fuzzer's byte-equality family. A change there is a change
  to the thing the suite measures with.

### Viability

Fully viable. Nothing structurally blocks it; the endpoint half is proof that the
architecture already accommodates this shape of correction.

### Would it help

The endpoint half already helped — it is the fix for the E2 cascade, landed. Restating it
in the concept helps only future readers, but that is not nothing: the concept is the
artefact a new worker is handed, and it currently contains the exact self-contradiction
that cost user data.

TOTALITÄT as a **rule** earns its place independently of the endpoint case, because it
found two live gaps that the endpoint fix did not touch and that no invariant currently
forbids. That is the test of a good rule: it fires somewhere its author was not looking.

Sharpest objection: TOTALITÄT is stated as absolute ("must represent every legal JSON
Canvas document") and the build already, correctly, deviates for `file: ""` / `url: ""`.
Ä1 anticipates this with the "explicit, named reason" clause, so it survives — but the
clause must not be dropped when the text is transcribed, or the amendment converts a
deliberate, reasoned restriction into a spec violation.

### Recommendation

**Adopt as written**, and additionally charter the two representability gaps as work.
They are the amendment's own first two findings and should not be lost in the
documentation edit.

---

## Ä2 — I11 REFUSAL NEVER DESTROYS + the general composition rule

### Status — **PARTIALLY SATISFIED (mechanism), NEW (as concept text and as a general rule)**

**Satisfied.** I11 exists as an enforced runtime mechanism, not merely as a slogan:

- `files/canvas-sync.ts:1269-1292` — the doctrine, stated at the site.
- `files/canvas-sync.ts:1301-1365` — `SeedRefusal` / `SeedRefusalLedger`, refusal as data.
- `files/canvas-sync.ts:1380-1391` — `isSeedRefusalResolved`, the lift, asking the same
  gate the refusal came from.
- `files/canvas-persistence.ts:313-331`, `:341-343`, `:363-393` — the withhold guard
  ahead of the serializer, per path, self-lifting on the write trigger, `SEED REFUSED:` /
  `SEED RESTORED:` signatures.
- `files/canvas-persistence.ts:141` — the discrimination seam (`withholdOnSeedRefusal`),
  defaulted armed.

**Not satisfied — I11 is enforced at two of the four boundaries the concept names.**
Teil 11 lists Seed, `CAPTURE_OP`, `CAPTURE_NET`, Import. Measured:

| Boundary | Refusal possible? | Destructive write downstream? | I11 wired? |
|---|---|---|---|
| host seed | yes (`canvas-sync.ts:3199-3213`) | yes | **yes** — ledger reset + noted |
| cold-open seed | yes (`canvas-sync.ts:1583-1624`) | yes | **yes** — `refusalsOut` |
| `CAPTURE_NET` | yes (`canvas-sync.ts:2943`+) | no (file already holds it) | n/a, correctly |
| **import** | yes | **yes** | **NO** |
| **`parseCanvas` pre-gate drop** | n/a (silent) | **yes** | **NO** |

`files/canvas-import.ts:307` calls
`seedRecordsIntoYMaps(winner, decodeCanvasDataToFlat(source), CANVAS_IMPORT_SEED_ORIGIN)`
— **without** the `refusalsOut` argument, and the returned signature array is discarded
as an expression statement. So at the one boundary where the user has explicitly said
"this file is the truth", a refused record is dropped with **no signature, no ledger, no
withhold**, the winner doc is adopted, and the writer projects it over the user's
`.canvas`. That is the E2 composition, unrepaired, at WP30 (P2, implemented).

**A second, worse hole: I11's protection is session-scoped and expires.** The ledger is
in-memory (`canvas-sync.ts:1842`, `Map<string, SeedRefusalLedger>`), documented as
per-session (`canvas-sync.ts:1313-1321`). On the next session a guest arrives with a
non-empty doc (sidecar replay), so `coldOpen` takes the `doc-wins` branch
(`canvas-persistence.ts:476-485`), **never reads the file**, and flushes the projection
over it. The refused record is absent from the doc *because it was refused last session*,
so the deletion is a consequence of the refusal — deferred by exactly one session. The
host is accidentally safe because it re-seeds from the file on every subscribe
(`canvas-sync.ts:2500-2523`) and re-arms the ledger; the guest is not.

Ä2's **general form** — "a validity boundary and a destructive write may never compose
without an explicit decision about what happens between them" — is exactly the rule that
would have caught both of these. It is not in any document.

### Difficulty

- **Concept text:** S — one invariant block after I10 (`CONCEPT_V2.md:335-347`) plus one
  paragraph of general form. Zero code.
- **Making the general form bite:** M — ~2–3 WPs: wire the import boundary
  (`canvas-import.ts:307`) to the ledger, and give the ledger durability or make
  `doc-wins` non-destructive when a prior refusal exists. The second is the harder one:
  `doc-wins` is deliberate (I9/WP29) and must not become "the file wins".
- **Risk:** low for the text; moderate for the durable ledger, because a persisted refusal
  that never lifts is itself a data-loss class ("a canvas stuck withheld stops persisting
  the user's real edits" — `canvas-persistence.ts:350-362` already reasons about this).

### Viability

Fully viable. The invariant already has 11 source files referencing it and 12 enforcement
sites claimed; adding it to Teil 3 is documentation catching up. The two gaps are ordinary
wiring, not architecture.

### Would it help

Yes, and it is the highest value-per-effort item in this set. The reason is not that I11
is new — it is that the **general form** is the only statement in the amendment set that
is a *rule about compositions*, and every defect in this project's inventory is a
composition defect whose individual steps were each correct. It is the one amendment that
would have found something its author was not already looking at, and in this review it
did: two open I11 holes.

Adversarially: is it redundant given Ä1 and Ä3? No, and the three are not one fix stated
three times. Ä1 removes the *reason* to refuse (fewer refusals). Ä2 forbids the
*composition* (refusal ⇒ deletion). Ä3 changes the *mechanism* at one boundary. Ä1 and Ä2
are genuinely independent — Ä1 alone leaves every future refusal destructive, Ä2 alone
leaves the endpoint model broken. Ä3 is the one that is largely redundant given Ä2 (see
below).

Testability: non-vacuous. The existing WP63 discrimination seam (`withholdOnSeedRefusal`,
file bytes as the oracle) is the template, and it is a genuinely falsifiable one — it runs
the same scenario through both settings and compares bytes.

### Recommendation

**Adopt as written.** Highest priority of the seven. Charter the import-boundary wiring
and the cross-session hole as its first two consequences.

---

## Ä3 — Seed/Import: pass-through instead of refusal; recovery journal; classes; teardown

### Status — **CONTRADICTS SOMETHING BUILT** (one clause), **NEW WORK** (the rest)

The amendment declares the withhold mechanism "conceptually replaced". That mechanism is
WP63, landed, and its charter **considered and explicitly rejected** the pass-through
design Ä3 now mandates:

> `TaskCharter_WP63_NonDestructiveSeedBoundary.md` §3: "Do **not** implement it by
> re-injecting refused records into the projection: that would make the file stop being a
> deterministic projection of the doc (C17 DoD) and would break cross-replica byte
> equality (C17 AC3), since only one replica ever saw those records."

The same objection is restated at the implementation site, `files/canvas-sync.ts:1289-1292`.
This is not a smoothable difference. Ä3 as written **repeals C17 AC3**: verbatim
re-injection of records only one replica has seen makes two replicas' `.canvas` files
differ by construction. C17 AC3 is pinned by two WP17 tests (`tp10`, `tp11`) and is one of
the fuzzer's four oracle families. The amendment does not mention this and does not say
what replaces the byte-equality oracle.

Clause-by-clause:

| Clause | Status | Evidence |
|---|---|---|
| TOTALITÄT covers the normal case | already true | see Ä1 |
| PASS-THROUGH (verbatim re-injection, position-stable) | **contradicts C17 AC3** | WP63 charter §3; `canvas-sync.ts:1289-1292` |
| "no state in which the writer withholds the file as a whole" | contradicts WP63 | `canvas-persistence.ts:313-331` |
| RECOVERY journal | **NEW WORK, and the strongest clause** | nothing at `.obsidian/liveshare/recovery/` exists |
| KLASSEN (representable-later vs never-valid) | NEW, small | ledger has `reason` (`canvas-sync.ts:1305`) but no class |
| TEARDOWN | NEW | `canvas-persistence.ts:584-607` `destroy()` performs **no** final flush at all |

**The three criticisms Ä3 levels at the withhold, judged individually:**

1. *"negiert den Existenzgrund des Writers"* — overstated. The withhold is per path
   (`canvas-persistence.ts:341-343`), non-fatal, and self-lifts on the next write trigger
   (`:363-378`). It is a degrade, not a shutdown.
2. *"hat keinen Teardown-Pfad"* — **correct, and worse than stated.** `destroy()` cancels
   timers and unobserves; it never flushes. But the real teardown defect is the one found
   under Ä2: the withhold does not survive the session, and the next `doc-wins` cold open
   completes the deletion. Ä3 identified the right symptom for the wrong reason.
3. *"schützt bei offenem View nicht (Obsidian schreibt selbst)"* — **correct, and this is
   the decisive argument for the RECOVERY clause.** With the canvas open, Obsidian's own
   `importData`/`requestSave` round-trips the file from its own in-memory model. Our
   withheld write protects nothing against a writer we do not own. Only a copy taken
   *before* any writer runs survives that, and that is precisely the recovery journal.

**Cost the author has not priced — the journal's on-disk location.**
`.obsidian/liveshare/recovery/` is **not** covered by the existing sidecar predicate.
`files/canvas-sidecar.ts:42` sets `SIDECAR_DIR = ".obsidian/liveshare/state"` and
`:78-87` `isSidecarPath` is a strict prefix test on `".obsidian/liveshare/state/"`. Every
one of the exclusion call sites (`files/manifest.ts:169,406,441`,
`files/background-sync.ts:339`, `utils.ts:333`) asks that predicate. A journal at
`.obsidian/liveshare/recovery/` is therefore excluded from **none** of them unless the
predicate is widened to `.obsidian/liveshare/` or a second predicate is added at all five
sites. `ExclusionManager` (`files/exclusion.ts:12`) covers `${configDir}/**` for the
manifest only, and `manifest.ts:427-441` documents that this is not relied on because
`configDir` may be non-default. Ä9's fourth surface (file-op broadcast, both directions) is
chartered-not-implemented (WP68), so the journal would land in a directory whose exclusion
is 3/4 done, in a build where the inbound arm is peer-reachable. That is a security
surface, not hygiene — and Ä15's `.obsidian/**` deny-list is also unbuilt.

Second unpriced cost: a `.jsonl` under `.obsidian/` is inside the directory that Obsidian
Sync, Syncthing, `obsidian-git` and every other engine treats as config. Append-only files
there conflict badly with engines that do whole-file replacement.

### Difficulty

- **Recovery journal alone:** M — ~2 WPs. New store module (append-only, guid-keyed),
  one hook at `parseCanvas`/seed, plus a widening of `isSidecarPath` (or a sibling
  predicate) and its five call sites. Retention/GC needs an answer or the journal grows
  without bound.
- **Pass-through:** L — ~4–6 WPs, and it re-opens C17. It requires the writer to read the
  last known file version before every write (it does not today — `flushToDisk` is a pure
  doc projection), a position-stable merge, and a replacement for the byte-equality
  oracle. High risk.
- **Classes + teardown:** S — ~1 WP, additive to the ledger.

### Viability

Recovery journal: viable. Classes and teardown: viable. **Pass-through: structurally
blocked** by C17 AC3/DoD unless that AC is explicitly retired, which the amendment does
not do and which would remove one of the four oracle families the project already knows
are weak.

### Would it help

Split verdict, and it must be split or the good half dies with the bad half.

- **RECOVERY: yes, clear win.** It is the only clause that survives the open-view case,
  and it is the only protection for the pre-gate drops found under Ä1 (id-less records,
  unknown top-level keys) which no refusal-based mechanism can ever see, because no
  refusal occurs.
- **PASS-THROUGH: no — reject as written.** It buys, over the withhold, exactly one
  property: the rest of the file stays live while a refused record is held. That is worth
  something, but it is bought by repealing byte-equality and by making the writer a
  file-reader. The same property is available far more cheaply: make the withhold
  *per-record* rather than per-path by having the serializer re-emit the last known file
  bytes only for the refused ids — which is the same repeal. Or: accept the withhold and
  spend the effort on the cross-session hole instead, which is where the actual remaining
  data loss is.
- **"Withhold replaced": no.** The withhold is the only thing standing between a refusal
  and a deletion today, and Ä3 offers no migration path — a concept that declares it
  replaced while pass-through is unbuilt leaves the mechanism un-owned and invites its
  removal before its replacement exists.

Testability: the recovery journal is testable non-vacuously (does the file exist, does it
contain the record, byte-compare). Pass-through's conformance test is the dangerous one:
its natural oracle is "the file still contains the record", which is *already green under
the withhold*. A test that cannot distinguish the two mechanisms is the tenth instance of
this project's signature failure.

### Recommendation

**Adopt amended, and split into three:**

1. **Adopt** RECOVERY, KLASSEN and TEARDOWN. Move the journal to
   `.obsidian/liveshare/recovery/` **only after** `isSidecarPath` is widened to
   `.obsidian/liveshare/`; otherwise place it under `.obsidian/liveshare/state/` where
   the exclusion already holds.
2. **Reject** the "withhold is conceptually replaced" sentence. Replace it with: the
   withhold stands; its known limits are (a) it does not survive the session and (b) it
   does not protect against Obsidian's own writer with the view open — and the recovery
   journal is the answer to (b).
3. **Defer** PASS-THROUGH pending an explicit decision on C17 AC3. If C17 AC3 is kept,
   pass-through is rejected, not deferred.

---

## Ä4 — Dual-vocabulary period and precedence rule

### Status — **PARTIALLY SATISFIED, and the amendment's premise is inverted**

**Satisfied — the order-independence half.** `files/canvas-sync.ts:580-634`
(`decodeV2RecordToFlat`) resolves the collision in two explicit passes with a named rule:
**the flat key wins**. The insertion-order defect is closed and pinned by
`__tests__/v2/wp17/test_tp15_flat_over_register_precedence_is_insertion_order_independent_visible.test.ts`,
which asserts *insertion-order independence* rather than the resulting value — a
non-vacuous discrimination test (it builds the same logical record twice, differing only
in insert order). Ä4's "container accidents are forbidden as a decision basis" is
therefore satisfied.

**Not satisfied — the causality half, and neither option 1 nor option 2 is built.**
`migrateV1ToV2` is deliberately additive (`canvas/canvas-schema.ts:443-450`, rationale at
`:37-50`): it never deletes a flat key, for two stated reasons — a Yjs `delete()` puts the
whole delete set into every later update and destroys WP8 AC3's zero-delta property, and
the P1 capture path still reads and writes the flat keys.

**The premise inversion — this is the finding that matters.** Ä4 (and Teil 4) assume
registers are the live vocabulary and flat keys are the legacy residue. In the built P1
system it is the exact opposite:

- The capture path parses the file, converts registers **back to flat**
  (`canvas-sync.ts:2799`, `decodeCanvasDataToFlat`), and upserts flat field names
  individually into the record's `Y.Map` (`applyIntentPlan`, per-field
  `existing.set(upsert.field, ...)`).
- The Surface-Shadow is keyed by flat field names (`canvas-sync.ts` `advanceShadowFromContent`
  comment: "the shadow is keyed by flat field names until WP18 wires the registers").
- Both seed boundaries write the flat shape (`canvas-sync.ts:1558-1571`,
  `canvas-persistence.ts:510-513`).
- `syncRegistersFromFlat` (`canvas-sync.ts:1457-1492`) only keeps an **already-present**
  register in step with the flat keys; it never introduces one.
- The serializer prefers flat over register (`canvas-sync.ts:621-633`).

Consequence, and it is not recorded in the report's §2: **in the shipped P1 build the
atomic registers are inert.** The merge unit for geometry on the live capture path is
still the pair of independent keys `x` and `y`, so two peers dragging the same card can
still merge per key and produce a coordinate nobody submitted — and because the serializer
prefers flat, that torn value is what reaches disk. I8 is satisfied in the *model*
(`canvas-registers.ts`) and not in the *live path*. The vocabulary switch is owned by
WP22/WP39 (`BUILD_SPEC_CanvasV2.md:2392,2416`); WP39 is P5 and unbuilt.

This means Ä4 option 1 — "the first V2 write deletes the record's flat keys in the same
transaction" — is **not a migration cleanup**. There is no "first V2 write" today, because
no production path writes a register as a primary value. Option 1 is a request to promote
the registers to the write vocabulary, i.e. WP39, in P1.

### Difficulty

- **As the amendment reads it (a migration rule):** M on paper, ~2 WPs.
- **As the tree requires it (registers become the write vocabulary):** L — ~5–7 WPs.
  Capture path, shadow keying (WP15's register-granularity comparison finally gets a
  consumer), both seed boundaries, the serializer's precedence, and every `w4`/`wp17`
  fixture that spells geometry flat.
- **Risk of option 1 specifically, as the prompt asks:** deleting flat keys is a **write
  on a migration/read path** with three costs the amendment does not price.
  (a) A Yjs `delete()` makes `encodeStateAsUpdate` carry the whole delete set forever,
  which permanently retires WP8 AC3's zero-delta property — stated at
  `canvas-schema.ts:41-44`. (b) A peer still on the current build reads flat keys; after
  the delete it reads nothing, and `syncRegistersFromFlat` will not help because the
  register-only record has no flat keys to sync from — that peer's serializer would emit
  a node with no `x`/`y`, which `validateNodeIngest` then refuses, which composes with the
  writer into the E2 cascade again. **This is the amendment re-arming the defect the rest
  of the set exists to abolish.** (c) Undo: a `Y.UndoManager` (WP38, P4, unbuilt) tracking
  a transaction that both writes a register and deletes four keys will restore all five on
  undo, which is correct, but the transaction is now cross-vocabulary and its undo is
  observable to a non-migrated peer as a resurrection of the flat keys.

### Viability

Option 1 is viable **only after** the write boundaries move to registers, i.e. it is a
consequence of WP39, not a precondition. Attempting it in P1, with the current flat-first
capture path, would break non-migrated peers as described.

Option 2 (compare Yjs item IDs `(client, clock)`) is viable but reaches into Yjs
internals: `Y.Map` does not expose the item ID of the winning value through its public
API. It would need `map._map.get(key).id`, which is private and version-fragile, in a
module (`canvas-sync.ts`'s serializer) that other components rely on being a pure
projection.

### Would it help

**The order-independence requirement: already helped, keep it in the concept.**

**Option 1 as the normative choice: no — it is currently harmful.** It is the one
amendment in this set I would call dangerous as written, for reason (b) above: in the
shipped build it would produce records that a peer's own validator refuses, and refusal is
this project's documented route to deletion. It is safe only once registers are the write
vocabulary everywhere, at which point "coexistence is transient" is true by construction
and the deletion is unnecessary anyway.

**What is genuinely missing and is worth stating:** the concept has no notion that flat is
the *live* vocabulary in P1 and register is the derived one. That is the true precedence
fact, it is the reason "flat wins" is causally correct today, and it is the thing a reader
of Teil 4 cannot currently learn.

### Recommendation

**Adopt amended.** Keep the dual-vocabulary section and the order-independence
requirement. Replace the normative ranking: state that in P1 the flat key is the live
authored vocabulary and the register is its translation, so "flat wins" **is** the causal
rule (the two are written in the same transaction by `syncRegistersFromFlat`), and that
option 1 becomes normative **at the phase in which the write boundaries move to
registers** (WP39/P5), not before. Do not adopt option 1 as a P1 obligation. Record
separately that I8's atomicity is not in force on the live capture path until that move —
that is a bigger finding than the precedence rule and it is currently unwritten.

---

## Ä5 — schemaVersion gate before P1 exposure

### Status — **NEW WORK, and the mechanism does not detect the threat it names**

What exists: `canvas/canvas-schema.ts:278-285` `isSchemaMajorMismatch`, consulted at
exactly one site — `files/canvas-sync.ts:2761-2767`, inside `handleLocalModify`. Its
effect is narrow and deliberately so: **local capture off for that path, persistence
continues, every other path unaffected**. Ä5 asks for something strictly stronger:
"refuses to participate ... (Notice, no sync of this doc)".

**The threat Ä5 names cannot be detected by the mechanism Ä5 specifies.** Ä5's stated
motivation is "a V1 client writing flat keys concurrently with register writes". Measured:

- `plugin/src/canvas/canvas-schema.ts` does not exist on `main` (verified:
  `git show main:plugin/src/canvas/canvas-schema.ts` returns nothing). A V1 build writes
  no `meta` and no `schemaVersion` at all.
- `isSchemaMajorMismatch` returns `false` when `meta` is absent **and** when `meta`
  carries no version (`canvas-schema.ts:280-282`), by design and correctly — an unstamped
  doc is a migration subject, not a conflict.
- Once any V2 client migrates the shared doc, `meta.schemaVersion = 2`
  (`canvas-schema.ts:447`), which equals `SUPPORTED_SCHEMA_MAJOR` (`:149`). No mismatch.
- A V1 client ignores `meta` entirely, so it would not honour the gate even if one fired.

So the gate is one-sided by construction: it can only ever fire against a **future** major
(v3+), never against V1. Against V1 the protection is zero, and the V1 peer keeps writing
regardless. Worse, the gate is honoured only by builds that contain it — a protection
against old peers that only new peers obey is not a protection.

Separately: the real V1/V2 mixed-version hazard is **not** the flat/register collision
(flat wins, and a V1 peer authoring flat keys is therefore honoured correctly — see Ä4).
It is the tombstone vocabulary: a V2 delete writes only to the `deleted` map
(`canvas-sync.ts` `applyIntentPlan`, `applyTombstoneOp`), which a V1 client cannot read,
so a deleted card stays visible on the V1 peer and is re-seeded from its file. A
`schemaVersion` gate does not see that either.

**The I11 check the prompt asks for, explicitly.** Ä5's refusal is safe **only if it is
placed before the writer is attached.** Today the order in `main.ts` is: `subscribe` →
then `attachCanvasPersistence` (`main.ts:1376-1390`). A refusal placed there — before the
writer exists — writes nothing and touches nothing, so I11 holds: no file, no doc, no
shadow is modified. A refusal placed **after** the writer is attached, or a "stop syncing
but keep persisting" reading of "kein Sync dieses Docs", is a genuine I11 violation: the
writer would keep flushing a doc that is no longer receiving peer state over the user's
file — a stale or empty projection, silently, exactly the composition Ä2 forbids. The
amendment does not say which, and the difference is the whole safety argument.

### Difficulty

- S–M — ~1–2 WPs. `isSchemaMajorMismatch` exists and is pure; the work is one new
  guard in the subscribe/attach path, one Notice, one signature, and the placement
  discipline above. It does not require P3 (WP31/32).
- **Risk:** the placement. Also: a "refuse to participate" that a user cannot see the
  reason for is indistinguishable from the plugin being broken, so the Notice is
  load-bearing, not cosmetic.

### Viability

Viable, and cheaper than the amendment implies (it does not need the room-mode consensus
of WP31). The structural requirement is that the gate must run before
`attachCanvasPersistence`, which the current wiring permits.

### Would it help

**Partly — and less than it claims.** It is a correct forward-compatibility guard against
a future major, and it is worth having for that reason alone: a v3 doc arriving at a v2
client today gets `isSchemaMajorMismatch === true` but only capture is disabled, so the
writer continues to project a doc this build cannot read into the user's file. That is a
real, currently-open hazard and Ä5 closes it.

But it does **not** deliver the protection its own text promises, because the V1 client it
names does not stamp a version. If the amendment is adopted with its stated justification
intact, the project will believe it has a mixed-version protection it does not have. That
is the more expensive error.

The second sentence — "a phase may not outrun its own protection condition" — is the more
valuable half of Ä5 and costs nothing.

Cheaper way to get the same guarantee against the *actual* V1 risk: there isn't one at the
data layer; the honest answer is a **build-level** statement (all peers must run ≥ the
build that introduced `meta`), enforced at the room/handshake level, which is WP31's
subject. Ä5 should say that rather than imply the doc-level check covers it.

Testability: non-vacuous for the v3 case (stamp a foreign major, assert no write reaches
the file, assert the doc is not subscribed). **Vacuous for the V1 case** — no fixture can
construct a V1 doc that trips the gate, because such a doc has no version to trip it.
Flag: if a conformance test for Ä5's V1 claim is written, it will necessarily test
something other than what it says.

### Recommendation

**Adopt amended.** Keep the gate and keep "a phase may not outrun its own protection
condition". Correct the justification: the gate protects against **foreign/future majors
and unreadable version cells**, not against V1 peers; the V1 case is a build-version
question for P3/WP31. Add the normative placement: the refusal must occur **before the
persistence writer is attached**, and must never be a state in which sync stops while the
writer keeps flushing.

---

## Ä10 — Lock seam: phase assignment + interim rule

### Status — **ALREADY SATISFIED, both halves. Pure documentation.**

**Phase assignment.** The removal of the write-denial machinery is not merely assigned to
P1 — it is **done** in P1. `BUILD_SPEC_CanvasV2.md:2391` lists WP21 (P1, "REMOVAL: lock
write-denial seam — `canWriteEntity`, baseline-hold, `LOCK DENIED:`"), and it is
implemented: `canWriteEntity`, `setCanWriteNode` and the `LOCK DENIED:` emitter are absent
from `plugin/src/` (the only hits are the WP21 removal tests asserting their absence, e.g.
`__tests__/v2/wp21/test_tp01_write_gate_seam_removed_visible.test.ts:134-142`, which
grep the source text of `canvas-sync.ts`). `canvas-sync.ts:2845-2850` records the
consequence: "It used to be withheld whenever the lock seam refused a write ... There is
no such refusal left — locks are pure UX."

**Interim rule — "the shadow advances only on an accepted upsert".** Implemented, on the
live path, exactly as written:

- `files/canvas-sync.ts:2835-2843` — the shadow advances only over `applied.upserts` and
  `applied.deletes`, i.e. over what the transaction actually wrote.
- `files/canvas-sync.ts` `applyIntentPlan` — a record refused by `admitRecordIngest`
  `continue`s before any `applied.upserts.push`, and a `type` write rejected by the
  write-once guard likewise pushes nothing. So a denial writes nothing and does not touch
  the shadow.
- The "deliberately held shadow" is forbidden in practice: the old baseline-hold is gone
  (`canvas-sync.ts:2845-2850`) and the echo baseline now advances unconditionally.

Ä10 is documentation catching up to a landed decision. The concept text (Teil 9,
`CONCEPT_V2.md:631`+, Teil 13 `:778`+) still lacks both statements, so the edit is still
worth making for future readers — but there is no work behind it.

### Difficulty

S. Two paragraphs in `CONCEPT_V2.md`. Zero code. Zero risk.

### Viability

Trivially viable — it describes the tree.

### Would it help

Yes, cheaply, and with one caveat worth stating plainly: **the amendment risks creating a
work package that is already done.** "Assign the removal of the write-denial machinery to
P1" reads as future work; it is past work. If this goes into a phase plan verbatim,
someone will charter WP21 twice. The concept edit should be written in the past tense or
explicitly marked as recording a completed decision.

The interim rule is worth keeping in the text anyway, even though the seam it governs is
gone, because it states the *property* that makes the shadow correct ("it must not diverge
from what the user demonstrably saw") — and that property is still live and still
load-bearing for the reconcile receipt path.

### Recommendation

**Adopt as written, marked as recording completed work.** Zero-cost, and it closes a real
gap in the concept's phase plan.

---

## Ä17 — Clearing is intent

### Status — **PARTIALLY SATISFIED — and the "propagates like any other intent" clause contradicts I7 on the built capture path**

Measured, per field:

| Clearing action | File effect | Captured today? | Evidence |
|---|---|---|---|
| empty a text card (`text: ""`) | key present, value `""` | **YES** | `canvas-shadow.ts:543-561` — the key is in `record.fields`, `fieldValueEquals("", <old>)` is false → upsert. `canvas-ingest-schema.ts:169-172` admits `""`. |
| remove a node's `color` | key **omitted** | **NO** | `canvas-shadow.ts:504-508`: "A field the shadow holds but the save does not mention produces nothing: a save is a PARTIAL observation, never a removal (I7)." |
| remove an edge's `label` | key **omitted** | **NO** | same |

So one third of Ä17's own examples already works and two thirds do not — and the two that
do not fail for a *stated, deliberate* reason, not an oversight:

- `BUILD_SPEC_CanvasV2.md:129` (§3.1 **S14**) records this as an **accepted, user-visible
  regression**: "clearing a card's colour or an edge's label in Obsidian no longer clears
  it for peers — the value returns on the next reconcile." Owner for closing it: **WP39
  AC5** (`BUILD_SPEC_CanvasV2.md:1072`), P5, unbuilt.
- The same entry states the escalation rule: "a WP that 'fixes' it by reintroducing
  key-absence semantics on the capture path violates I7 and must ESCALATE."
- The reason is epistemic, not lazy: on the save-diff path (`CAPTURE_NET`, the only live
  path) "the user cleared this field" and "the stale view omitted this field" are the same
  observation. That indistinguishability *is* I7's claim.

**Therefore Ä17's operative sentence — "propagates like any other intent" — is not
achievable on the built capture path and is not achievable before P5.** `CAPTURE_OP`
(`captureLocal` on `CanvasBinding`) is the path that can distinguish them, and it is
switched off and frozen off until P5.

**What Ä17 does add that is real:** its last sentence. "Deliberate regressions of this
rule are admissible only as **known-open, user-reachable** — not as a silent footnote."
That is currently violated: `DEVELOPMENT_REPORT_CanvasV2.md:303` lists exactly two
known-open user-reachable items (WP68 and the `BorrowState` credential leak). **S14 is not
among them**, even though it is user-visible, user-reachable and shipped. It lives only in
a BUILD_SPEC table cell and one report row. Ä17 promotes it correctly.

Note also: the concept **already says this**. `CONCEPT_V2.md:394` — "`color` ... reversibler
Stil-Intent; Löschung = explizites Delete-Ereignis (I7), nicht Key-Abwesenheit." So Ä17 is
not a concept change for `color` at all; it is a generalisation to `label`/`text` plus the
known-open rule.

### Difficulty

- **As documentation (the known-open promotion + generalising `:394` to `label`):** S —
  ~0 WPs, two edits.
- **As behaviour:** L, and it is **WP39** — already chartered, P5, with AC5 written. No
  new WP is needed; nothing should be chartered for it now.
- **Risk of doing it early:** high and explicitly fenced. Any attempt to implement Ä17 on
  `handleLocalModify` re-introduces deletion-by-key-omission, which is the W3/A.2-15-18
  class and which `PROTECTED_KEYS` could only ever narrow, never fix.

### Viability

Documentation: fully viable. Behaviour: viable only via `CAPTURE_OP` in P5. Structurally
blocked before that by I7 — correctly.

### Would it help

**Yes for the known-open promotion; no for anything else.** Ä17's argument ("a capture
path that silently discards a legal intent class reproduces the self-revert experience V2
exists to abolish") is true as far as it goes, and the counter-argument is already on
record and stronger: the alternative reintroduces an invisible, self-amplifying corruption
class in exchange for a visible, self-correcting single-field staleness. That is the same
trade Teil 5 makes explicitly for ABA. The build made the right call.

Where Ä17 is genuinely right is that the trade was recorded as a spec footnote rather than
as a user-facing known limitation. A user who clears a colour and watches it come back has
no way to learn that this is intentional. That is worth fixing and costs nothing.

Testability: the documentation half is not testable and does not need to be. The behaviour
half is testable once `CAPTURE_OP` exists (WP39 AC5 already specifies the discriminating
property: an explicit field-clear must be distinguishable from a non-observation).

### Recommendation

**Adopt amended.** Adopt the last sentence (known-open, user-reachable) and generalise
`CONCEPT_V2.md:394` to `label` and to emptying `text`. **Explicitly annotate that the rule
is satisfied for `text: ""` today and deferred to WP39/P5 for `color`/`label`**, and carry
the I7 escalation warning into the concept so a future reader does not "fix" it on the
save-diff path. Do not charter work. Do add S14 to the known-open register.

---

## Cross-cutting findings

Four things surfaced while checking these seven that are not in `DEVELOPMENT_REPORT` §2
(which §0 flags as probably not exhaustive). Each was verified in the tree.

**F1 — I11's protection is session-scoped; the next cold open completes the deletion.**
The refusal ledger is in-memory and per-session (`canvas-sync.ts:1842`, `:1313-1321`). On
a guest's next session the doc arrives non-empty from the sidecar, `coldOpen` takes the
`doc-wins` branch (`canvas-persistence.ts:476-485`) which never reads the file, and
flushes the projection — without the record that was refused last session. The host is
accidentally safe (it re-seeds every subscribe, `canvas-sync.ts:2500-2523`). **The
deletion I11 exists to prevent still happens, one session later, on guests.**

**F2 — the import boundary has no I11 wiring at all.** `files/canvas-import.ts:307` calls
`seedRecordsIntoYMaps` without `refusalsOut` and discards the returned signatures. A
record refused during "Import from file" is dropped with no signature, no ledger, no
withhold, and the adopted winner doc is then projected over the user's file. Teil 11 names
Import as one of the four gated boundaries; it is the only one where a refusal is both
possible and destructive and where nothing catches it.

**F3 — two pre-gate drops in `parseCanvas` that no refusal mechanism can ever see.**
(a) records with a falsy `id` are dropped silently; (b) every top-level key other than
`nodes`/`edges` is dropped at parse and absent from `buildCanvasData`'s output, so it is
written out of the user's file on the first flush. Neither produces a refusal, so neither
arms the withhold. These are the concrete TOTALITÄT violations, and (a) is exactly the
class Ä3's RECOVERY clause names.

**F4 — I8 atomicity is not in force on the live capture path.** The registers exist and
are correct in `canvas-registers.ts`, but every live write path authors flat keys
(`canvas-sync.ts:2799` → `applyIntentPlan` per-field `set`), the shadow is keyed flat, and
the serializer prefers flat over register (`canvas-sync.ts:621-633`). The geometry merge
unit is therefore still `x` and `y` as independent LWW keys, which is W2 — the defect
WP9/WP10 were built to make unrepresentable. The move is owned by WP39 (P5, unbuilt). This
is the single most consequential thing found in this review and it is not recorded
anywhere I could find.

---

## Value per unit of effort

| Rank | Ä | Status | Effort | Helps | Why this rank |
|---|---|---|---|---|---|
| 1 | **Ä2** | partially satisfied | S (text) + M (2–3 WPs) | **yes** | Cheapest text edit in the set, and the only rule about *compositions*. It found F1 and F2 in this review. |
| 2 | **Ä10** | already satisfied | S (text only) | yes | Zero-cost; closes a real hole in the phase plan. Must be written past-tense. |
| 3 | **Ä17** | partially satisfied | S (text only) | partly | The known-open promotion is free and correct. Behaviour is WP39, already chartered. |
| 4 | **Ä1** | endpoint done, TOTALITÄT not | S (text) + M (2 WPs) | **yes** | The rule fires where its author was not looking (F3). The endpoint text edit is required regardless — the concept still self-contradicts. |
| 5 | **Ä3 (RECOVERY/KLASSEN/TEARDOWN only)** | new work | M (2–3 WPs) | yes | The only clause that survives the open-view case and the only one that can see F3(a). Blocked on widening `isSidecarPath`. |
| 6 | **Ä5** | new work | S–M (1–2 WPs) | partly | Real forward-compat guard; wrong stated justification; must be placed before the writer attaches. |
| 7 | **Ä4** | precedence done, causality not | M as read / L as required (5–7 WPs) | partly | Order-independence already landed. Option 1 is a P5 vocabulary switch wearing a migration rule's clothes. |
| — | **Ä3 (PASS-THROUGH)** | contradicts C17 AC3 | L (4–6 WPs) + repeals an oracle | **no** | Reject or defer pending an explicit C17 AC3 decision. |

---

## Ordering constraints (prerequisites)

- **Ä2 before Ä3, Ä1 and Ä5.** Ä2's general form is the rule under which the other three
  are judged. Adopting Ä3's mechanism change before the rule exists means re-deciding the
  composition question per boundary.
- **Ä1 (TOTALITÄT) before Ä3.** TOTALITÄT reduces the population Ä3's mechanism must
  handle. Sizing Ä3's journal and pass-through against today's refusal rate over-sizes
  both. Ä3's own text says this ("TOTALITÄT deckt den Normalfall").
- **Ä9 (`isSidecarPath` widened to `.obsidian/liveshare/`) before Ä3's RECOVERY journal.**
  Hard blocker, not a preference: the journal's proposed path is excluded from none of the
  five call sites today, and the fourth exclusion surface (WP68) is unimplemented.
- **Ä5's placement decision before any P1 exposure.** Ä5 is about exposure, so it must be
  settled before P1 is declared usable — but the gate must be wired *before*
  `attachCanvasPersistence` (`main.ts:1376`) or it becomes an I11 violation of its own.
- **WP39 (registers become the write vocabulary) before Ä4 option 1 and before Ä17's
  behaviour half.** Both amendments are consequences of that move, not preconditions for
  it. Ä4 option 1 executed before it would produce records that a non-migrated peer's own
  validator refuses — the E2 cascade, re-armed.
- **Ä10 has no prerequisites and blocks nothing.** It can land immediately.
- **F1 and F2 should be chartered as Ä2's first consequences**, ahead of any Ä3 work:
  they are the same invariant, at boundaries that are already built and already shipping.
