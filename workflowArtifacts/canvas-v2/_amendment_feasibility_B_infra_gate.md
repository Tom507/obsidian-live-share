# Amendment feasibility — Group B: epoch/GC, relay, security boundaries, verification regime

> **Scope:** Ä6, Ä7, Ä8, Ä9, Ä15 (epoch/sidecar/relay/security) and Ä11, Ä12, Ä13, Ä14, Ä16
> (the verification regime), from `CONCEPT_V2_AMENDMENTS.md`.
> **Method:** read-only, static, against the current tree at `f4846c2`
> (`fix-bugs-and-raceconditions`). No build, no test run, no vault read, no socket.
> Every line number below was read from the file, not recalled. Where this document's
> line numbers disagree with the dispatch prompt or `DISPATCHER_STATE.md`, the numbers
> here are the current ones and the drift is named.
> **Author's stance:** adversarial. Two of these ten are, as written, wrong.

---

## Summary of status assignments

| Ä | Status | Short reason |
|---|---|---|
| Ä6 | **CONTRADICTS SOMETHING BUILT** | WP25's `compact()` does exactly what Ä6 forbids, on a 5-minute timer |
| Ä7 | PARTIALLY SATISFIED | the checkpoint+truncation primitive and frame-type awareness exist; the two *couplings* do not, and rule 2 is unreachable in the built design |
| Ä8 | NEW WORK | the refusal correctly aborts adoption; there is no named state, no retry, no signature |
| Ä9 | PARTIALLY SATISFIED | 2 of 4 surfaces fully done; the other 2 have the *same* single hole (rename) |
| Ä15 | PARTIALLY SATISFIED (deny-list) / NEW WORK (fail-closed) | `.obsidian/**` is already denied at the main funnel; the rename funnel escapes it; fail-closed is entirely unbuilt and live |
| Ä11 | ALREADY SATISFIED in fact, NOT in the concept text | the correction is true and already recorded in three artefacts; `CONCEPT_V2.md:828` still carries the false sentence |
| Ä12 | ALREADY SATISFIED (oracle + reference model) — reach is the open question | `harness/fuzz/intent-trace.ts` is exactly the demanded independent model; it does not reach tombstone, epoch or precedence semantics |
| Ä13 | PARTIALLY SATISFIED as *charters*, NEW WORK as *code*; clause 2 silently substitutes a scenario | WP75/WP76 charter clauses 1 and 3; the four named suites are not the concept's four |
| Ä14 | **CONTRADICTS the Dispatcher ruling** (quietly weakens it) | the concept already says "release condition"; the new part narrows reopening to an enumerated list |
| Ä16 | NEW WORK | nothing mutation-related exists anywhere in the tree |

---

## Ä6 — Tombstone GC ≡ epoch bump

### Status — **CONTRADICTS SOMETHING BUILT**

The sentence Ä6 orders struck is not stale concept prose. It is **implemented, landed, wired,
timer-armed and under test** as WP25.

```text
plugin/src/files/canvas-sidecar-lifecycle.ts:77    SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS = 1000
plugin/src/files/canvas-sidecar-lifecycle.ts:61    SIDECAR_COMPACTION_PERIOD_MS = 300_000
plugin/src/files/canvas-sidecar-lifecycle.ts:252   .filter(entry => entry.suppressed && entry.t + horizonTicks <= newest)
plugin/src/files/canvas-sidecar-lifecycle.ts:262-277  doc.transact(() => { deleted.delete(id);
                                                       if (nodes.has(id)) nodes.delete(id);
                                                       else if (edges.has(id)) edges.delete(id); })
plugin/src/files/canvas-sidecar-lifecycle.ts:329   scheduler.setInterval(tick, periodMs)   ← armed at construction
```

`compact()` selects `on:true` tombstones older than the horizon and **physically deletes both the
tombstone and the record**, in one transaction, then checkpoints. That is the rule verbatim. The
timer is armed at lifecycle construction (`:329`), not at first attach, and `wireCanvasSidecar`
(`:460-487`) is the production wiring. So this is not a dormant capability.

Ä6 does not say "this is implemented and must be removed". It says "STREICHEN" of a concept
sentence, as though nothing depended on it. **That framing is the danger:** an implementer reading
Ä6 would delete a line of German prose and leave a live 5-minute GC loop running against a rule
that now forbids it.

### Is the amendment technically right?

On its central claim, **yes, and it is the sharpest thing in this amendment set**:

- `deleted.delete(id)` in Yjs is *not* physical removal. It marks the item deleted; the struct
  skeleton and the delete-set entry remain. `canvas-tombstone.ts:126-129` says so explicitly — the
  `TombstoneMap` seam deliberately exports no `delete`, with the comment *"a tombstone is never
  DELETED from the map (that would recreate the very absence-instead-of-value problem V2 exists to
  remove)"*. WP25 then reaches around that seam and calls `Y.Map.delete` directly. **The module
  that owns the semantics forbids the operation; the module that owns the schedule performs it.**
  That is a real, in-tree contradiction, and Ä6 is the first artefact to name it.
- WP25's own header comment claims the sweep is safe because *"a tombstone is only ever removed
  TOGETHER with the record it suppresses"* (`:37-38`). That argument holds for a replica that has
  the tombstone. It does **not** hold for a partitioned replica that has the *record* and never
  received the tombstone: on merge, its `nodes[id]` write is concurrent with the compactor's
  `nodes.delete(id)`. If the offline peer re-created the record (a fresh `Y.Map` at that key), the
  new item is not covered by the delete and the card **resurrects with no tombstone to suppress
  it** — the exact V1 defect the whole tombstone design exists to remove. Nothing in the visible
  suite can see this, because both replicas converge on the resurrected card and SEC, bytes and
  schema are all green over it (which is Ä12's finding one layer down).
- Ä6's "GC horizon = epoch lifetime" also removes a second, quieter divergence source: `newest` at
  `:246` is computed from the **local** `deleted` map, so two peers with different replication
  progress select different sets. They converge afterwards (the deletes are CRDT ops), but the
  *set that gets collected* is decided by whichever peer's timer fires while it is furthest ahead.
  Non-deterministic GC scope is not a correctness bug today, but it is an unfalsifiable one.

### Difficulty

Small, and it is mostly **deletion**, which is unusual and good.

- `plugin/src/files/canvas-sidecar-lifecycle.ts` — remove the sweep (`:233-278`), keep the
  checkpoint call (`:285-291`), keep the interval, delete `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS`
  (`:77`) and `horizonTicks` from `SidecarLifecycleOpts`/`SidecarCompactionResult`.
- `plugin/src/canvas/canvas-tombstone.ts` — no change; its comment at `:124` ("Sidecar GC of
  long-dead tombstones is WP25's") becomes stale and should be corrected.
- Tests: WP25's compaction suite asserts the sweep. Under §7 this is a **licensed deletion** of
  landed assertions, not a free edit. It needs the §7 register, a named licence and a
  demonstration. That is the real cost, not the code.
- `CONCEPT_V2.md:562-565` (Teil 7, "Kompaktion nutzt Yjs' eingebautes GC … plus die Tombstone-GC
  aus Teil 4") also needs the replacement text.

**≈2 WPs**: one to remove the sweep + amend the suite under a §7 licence, one to write the
epoch-bump GC path (below). Risky part: the §7 accounting, and the fact that WP25 is `DONE` — this
reopens a closed WP, which is the pattern §7 exists to police.

### Viability

Viable. Nothing structurally blocks it: the checkpoint half (`canvas-sidecar.ts:392-406`) is
already `Y.encodeStateAsUpdate(doc)` + truncate-after-write, i.e. it does not depend on the sweep.
Removing the sweep leaves compaction as pure Yjs GC + checkpoint, which is what Ä6 prescribes.

### Would it actually help — adversarial

**Yes, on correctness. But its cost claim is unpriced in one direction and overpriced in the other.**

- **Growth.** Ä6 leaves `deleted[id]` entries and record skeletons in the doc for an epoch's whole
  lifetime. At canvas scales this is small — a tombstone is `{t, by, on}`, tens of bytes, and Yjs
  compresses the delete set into ranges. The concept's own estimate (`CONCEPT_V2.md:564`, 10²–10³
  records) stands. **Growth is not the objection.**
- **Reachability of the epoch bump is the objection, and it is serious.** `bumpEpoch` has exactly
  one production caller: `plugin/src/files/canvas-import.ts:312`, inside the WP30 "Import from
  file" command, registered at `plugin/src/session/commands.ts:202`, gated by
  `activeCanvasPathForImport()` (`main.ts:1092`) and a confirmation dialog that names whose work is
  being overwritten (`canvas-import-command.ts:211`). So under Ä6, **physical GC happens only when
  a human deliberately runs a destructive overwrite command on the board they are looking at.**
  In practice: never. Ä6 should say so out loud — "GC is effectively never" is an acceptable
  answer, but it must be the *stated* answer, not an emergent one. The amendment's phrase
  "GC-Horizont = Epoch-Lebensdauer" reads as though epochs turn over; they do not.
- **Ä6's own text sets a trap for Ä7.** It says the bump mints epoch+1 "aus der Projektion (ohne
  Alt-Tombstones)". `adoptWinner` (`canvas-epoch.ts:605-620`) does exactly that — it *replaces*
  containers rather than merging. So an epoch bump already produces a doc whose containers share
  no causal history with the pre-bump state on a peer that has not adopted. Ä7 rule 1 is the
  mitigation for precisely this, and Ä6 is what makes it load-bearing. **Ä6 and Ä7-1 must land
  together or neither.**

### Recommendation

**Adopt, amended, and re-scoped from "concept edit" to "concept edit + WP".** Amendments:
1. State explicitly that WP25's Lamport-horizon sweep is **superseded and must be removed**, naming
   `canvas-sidecar-lifecycle.ts:233-278`. As written the amendment does not reach the code.
2. State explicitly that physical GC is expected to be **rare to never** under the current epoch
   surface, rather than implying a lifecycle.
3. Bind it to Ä7-1 as a joint landing.

---

## Ä7 — coupling: relay persistence × epoch × rotation

### Status — **PARTIALLY SATISFIED**, and rule 2 is unreachable in the built design

**Already built, contrary to the amendment's framing:**

- The relay is **already frame-type-aware**. `StoredFrame` carries `msgType`
  (`server/src/persistence.ts:106-110`), `handleCheckpoint` branches on `MUX_CHECKPOINT`
  (`server/src/ws-handler.ts:392-393`, handler at `:203-226`), and `BlobStore.checkpoint` is a
  distinct operation from `append` (`persistence.ts:112-128`).
- **Checkpoint ⇒ truncation already exists**, with the cut-off arithmetic already hardened:
  `truncationCutoff` (`persistence.ts:153-156`) refuses a non-finite or non-positive `upToSeq` and
  clamps so a checkpoint can never truncate itself. LevelDB implementation at `:318-330`.
- The **cleartext-header precedent already exists**: `encodeCheckpointBody` writes a leading
  varUint `upToSeq` followed by an opaque tail, and `server/src/mux-protocol.ts:51-56` documents it
  in exactly Ä7's language — *"the relay reads the varUint to decide what it may drop and never
  looks at the tail, which may be ciphertext."*

**Not built:**

- No epoch anywhere on the wire; the relay has no concept of one.
- No epoch-bump ⇒ checkpoint trigger. The three triggers are `sole-peer-sync`, `update-threshold`
  (64 updates, `plugin/src/sync/mux-protocol.ts:143`) and `release`
  (`plugin/src/sync/mux-protocol.ts:145`, `sync.ts:286/480/568`). An epoch bump emits nothing.
- No rotation event of any kind. The passphrase is read once at session start
  (`plugin/src/main.ts:759-760`); "rotation" is the user editing a settings field and restarting.

### The structural blocker for rule 2 — this is the finding

```text
plugin/src/sync/sync.ts:580   if (!doc || this.e2e?.enabled) return;
```

**A client in an encrypted room emits no checkpoint at all, ever.** `sendMux`'s comment at
`sync.ts:857-860` confirms the design: the checkpoint carries a plaintext Yjs update, so E2E rooms
are excluded rather than handed one.

So Ä7 rule 2 — "passphrase rotation ⇒ checkpoint under the new key ⇒ truncation" — **cannot be
implemented without first building a capability WP42 deliberately declined**: an encrypted
checkpoint payload. That is not a coupling rule; it is a new feature (encrypt the state update,
send it as the checkpoint tail, teach the relay nothing new because the tail is already opaque).
Ä7 presents it as a two-line constraint on an existing mechanism. It is not.

The *defect* rule 2 names is nevertheless real and currently live: an E2E room's blob store
accumulates ciphertext frames with **no truncation path whatsoever**, and after a rotation every
late joiner silently receives only post-rotation history. Ä7's diagnosis is correct; its
prescription is mis-sized.

### The unnecessary half of rule 1

Ä7 asks the relay to become **epoch-aware** and "discard all frames of a lower epoch". Two
objections:

1. **It is redundant.** The truncation Ä7 wants is already achievable content-blind: an
   epoch-bump-triggered checkpoint with `upToSeq = relayLastSeq` deletes every prior frame via the
   existing `truncationCutoff` path. The relay never needs to know what an epoch is. The only thing
   epoch-awareness buys is defence against a *client that bumps but fails to checkpoint* — and that
   client is under our control, unlike the relay.
2. **It costs a privacy property the content-blindness was buying.** `CONCEPT_V2.md:595-608` states
   the relay stores ciphertext "ohne ihn zu verstehen" and that this is what keeps the trust
   architecture unchanged. An epoch in a cleartext header is a **monotonic per-board counter of
   deliberate re-seeds**, visible to the relay operator, correlatable across rooms. It is small,
   but it is a real erosion of a property the concept names as load-bearing — and it is being spent
   on a guarantee obtainable without it. `upToSeq` is a *storage* number the relay assigns itself;
   an epoch is a *document* fact. They are not the same kind of leak.

### Difficulty

- **Rule 1, cheap form (recommended):** client-side only. Add a `"epoch-bump"` trigger reason to
  `CheckpointTriggerReason` (`plugin/src/sync/mux-protocol.ts:145`), have `bumpEpoch`'s caller
  (`canvas-import.ts:312`) notify `SyncManager`, force the checkpoint with `upToSeq = lastSeq`.
  **Zero relay change. 1 WP.** §7 permits it — `server/` stays untouched, which matters, because
  a `server/` edit outside WP41 is an abort criterion.
- **Rule 1, as written (epoch-aware relay):** `server/src/mux-protocol.ts`,
  `server/src/ws-handler.ts`, `server/src/persistence.ts` (new per-stream epoch state), plus the
  client encoder, plus the relay's 149-test suite. **2–3 WPs, and it requires a §7 exception for
  `server/`.**
- **Rule 2:** encrypted-checkpoint capability (`sync.ts:578-598`, `sync.ts:840-865`,
  `crypto.ts`), plus a rotation event that does not exist, plus the "rotation is not complete until
  the checkpoint is acknowledged" handshake (the relay currently acks nothing —
  `handleCheckpoint` at `ws-handler.ts:225` is fire-and-forget with a `.catch` that only logs).
  **3–4 WPs.**

### Would it help — adversarial

Rule 1 in its cheap form: **yes, clean win, and it is the mitigation Ä6 creates the need for.**
Rule 1 as written: **no — buy the same guarantee for free and keep the blindness.**
Rule 2: **the defect is real; the amendment as written is not implementable and understates the
work by an order of magnitude.** It also has no non-vacuous conformance test today: with
`e2e?.enabled` short-circuiting at `sync.ts:580`, any test asserting "rotation produced a
checkpoint" in an encrypted room asserts against a code path that returns early — a green that
cannot fail, in an amendment written to prevent exactly that.

### Recommendation

- **Rule 1 — adopt amended.** Require "epoch bump ⇒ checkpoint ⇒ truncation", specify it as a
  client-side trigger reusing the existing `upToSeq` truncation, and **strike the relay
  epoch-awareness requirement**, recording the reason (redundant; costs a named privacy property).
  If the owner wants defence-in-depth against a non-checkpointing client, that is a separate,
  later, justified decision.
- **Rule 2 — adopt as a *known-open risk*, not as a coupling rule.** Record in Teil 7: "in an
  encrypted room no checkpoint is emitted (`sync.ts:580`), therefore the relay blob is never
  truncated and a passphrase rotation silently truncates history for every late joiner. Closing
  this requires an encrypted checkpoint payload, which is unbuilt." That is honest, testable today
  (assert the early return exists and is documented), and does not charter 4 WPs of crypto work on
  a hypothesis.

---

## Ä8 — ADOPTION-BLOCKED as a named degraded state

### Status — **NEW WORK** (on a correct foundation)

The half Ä8 endorses is built and is good code:

```text
plugin/src/canvas/canvas-epoch.ts:722   await env.writeConflictCopy(archivedTo, content);
plugin/src/canvas/canvas-epoch.ts:725   adoptWinner(doc, winner, remoteEpoch);
```

The write is awaited before the adoption, and a rejection propagates out of
`resolveEpochConflict` — so the adoption does not happen (`:644-646` states this as the acceptance
criterion). I11-conformant, as `DISPATCHER_STATE.md` records.

The half Ä8 adds is entirely absent:

- No `ADOPTION-BLOCKED` state anywhere. The rejection is a thrown promise; whatever caught it
  (`canvas-sync.ts:2235`, `:2292`) decides, and nothing records that a replica knows of a higher
  epoch it did not follow.
- No block on further local writes into the old-epoch doc. After the throw the doc is untouched
  and **fully writable**, and capture keeps running.
- No retry, no backoff.
- No `EPOCH ADOPTION BLOCKED:` / `EPOCH ADOPTED:` signature pair. The one signature that exists is
  `EPOCH CONFLICT signature:` (`canvas-epoch.ts:543`), and it is emitted **only on a successful
  adoption** (`:727-728`) — after `adoptWinner`. **A blocked adoption produces no log line at all.**
  That is the precise shape of "standing silent divergence" the amendment names, and it is measured,
  not hypothetical.

### Difficulty

- `canvas-epoch.ts` — a second signature builder next to `epochConflictSignature` (`:522`), and an
  outcome variant (`EpochConflictOutcome` at `:568` currently cannot express "did not adopt because
  the archive failed" distinguishably from "did not adopt because epochs were equal": both give
  `adopted:false, signature:null`). **That conflation is itself a defect** — an
  `adopted:false` outcome is unreadable today.
- `canvas-sync.ts` — the state itself, the write block, the backoff, the notice. The two call
  sites are `:2235` and `:2292`.
- `main.ts` — nothing (wiring only).
- **1–2 WPs.** Risk: the write-block is a *refusal at a destructive boundary* and must be checked
  against I11 in the other direction — blocking local writes must not cause the user's own edits to
  be discarded. The safe shape is "the doc stops accepting capture; the file is not touched", not
  "capture is dropped". An implementer who blocks capture without also suspending the writer will
  reproduce the E2 cascade.

### Viability

Viable, and the seams exist. `EpochConflictEnv` (`:554-566`) already injects `notify` and `logger`,
so the notice and the signature need no new plumbing. The backoff needs a clock, which this module
is forbidden (`:74-76`) — so the retry belongs in `canvas-sync.ts`, not `canvas-epoch.ts`. The
amendment does not say this and an implementer could easily put it in the wrong module.

### Would it help — adversarial

**Yes, and it is the cheapest genuine defect-closure in this set.** The failure it prevents is
exactly the one WP28 already found once and named in its own words: *"the only symptom would be
that imports quietly stop winning."* Ä8 turns that symptom into a signature.

Cost the author may not have priced: the conflict-copy write is fail-closed *by design* (WP28 made
`writeConflictCopy` throw on a non-identical body at the same day-granular path), so
**ADOPTION-BLOCKED is reachable on an ordinary second-conflict-same-day**, not only on a disk
error. It will therefore actually fire. That is an argument *for* the amendment — the state needs
a name because it is not exotic — but the retry-with-backoff will retry a write that is
deterministically refused. **The backoff must distinguish transient (I/O) from permanent (name
collision) refusals**, or it becomes an infinite loop with a notice. The amendment does not say
this; Ä3's refusal-class taxonomy (representable-later vs. nie-gültig) is the right precedent and
should be cited.

Non-vacuously testable: yes — the discrimination test is "make `writeConflictCopy` reject, assert
no local write reaches the doc and the blocked signature is emitted", and it reddens if either
half is removed.

### Recommendation

**Adopt, amended.** Add: (a) the retry must classify refusals as transient vs. permanent, per Ä3;
(b) the write block suspends capture *without* suspending or truncating the file writer (I11);
(c) `EpochConflictOutcome` must distinguish "not adopted, equal" from "not adopted, blocked".

---

## Ä9 — sidecar exclusion on four surfaces

### Status — **PARTIALLY SATISFIED — 2 of 4 complete, and the 2 gaps are one defect**

| Surface | State | Evidence |
|---|---|---|
| (1) Manifest | ✅ **complete** | `manifest.ts:441` `isSidecarPath(path) → false` inside `isSharedPath`; `manifest.ts:406` guards the one writer that does not ask (`renameFile`, destination side); `manifest.ts:169` guards the reader `syncFromManifest` at the top of its loop |
| (2) Text/canvas sync detection | ✅ **complete** | `utils.ts:332-334` `skipsAutoTextSync = endsWith(".canvas") ‖ isSidecarPath`; the consumer list is enumerated and pinned at `utils.ts:255-270` |
| (3) File-op broadcast **outbound** | ⚠ **half** | create/delete/modify gated at `vault-events.ts:139`, `:172`, `:231` via `isSharedPath`. **Rename is not:** `vault-events.ts:190-194` admits the event when *either* side is shared, and `file-ops.ts:461-475` `onFileRename` emits with no path predicate at all |
| (4) File-op application **inbound** | ⚠ **half** | non-rename ops use the strict all-paths form (`control-handlers.ts:52`) → a sidecar path is rejected. **Rename uses `paths.some(...)`** (`control-handlers.ts:50`) → admitted if *either* side is shared; `file-ops.ts:179-181` then applies only `isPathSafe`, which is traversal-only (`utils.ts:48-52`) |

So the amendment's substantive content reduces to **one hole with two arms**, which is exactly
WP68's charter, `SPEC_COMPLETE`, unimplemented. Ä9's value is not in surfaces 1 and 2 — those are
documentation catching up. It is in **naming surface (4) as a security boundary**, which the code
comments currently do not.

### Is surface (4) really a security boundary?

**Yes, and more than the amendment claims.** Traced:

1. A peer sends `{type:"rename", oldPath:"<shared>/x.md", newPath:".obsidian/liveshare/state/<guid>.ycheckpoint"}`.
2. `control-handlers.ts:50` — `some(isSharedPath)` is true on `oldPath`. **Admitted.**
3. `file-ops.ts:180-181` — `isPathSafe` on both: no leading `/`, no `.`/`..` segment. **Passes.**
   `.obsidian` is a *name*, not a dot-segment; `isPathSafe` was never written to exclude it.
4. `file-ops.ts:232-253` — `vault.rename(file, op.newPath)`, with `ensureFolder` creating the
   destination directory first (`:244`).

No local action is required by the victim. The amendment's phrasing is right.

Two refinements the amendment does not contain, both of which matter for scoping:

- **The `.obsidian/**` case is already largely denied at this funnel**, by a route the amendment
  does not mention: `ExclusionManager` prepends `${configDir}/**` (`exclusion.ts:12`), is wired
  with the *real* config dir at `main.ts:343-345`, and is consulted inside `isSharedPath`
  (`manifest.ts:442`). So for every op type *except rename*, a `.obsidian/**` destination is
  already refused. The rename `some()` is the only way through.
- **Overwrite of an existing config file is not reachable**, because `vault.rename` fails when the
  destination exists and the recovery branch (`file-ops.ts:248`) rethrows. What *is* reachable is
  creation of new paths under `.obsidian/` and removal of a file from the user's vault. That is a
  narrower blast radius than "remote code execution" but strictly wider than "hygiene".

### Difficulty

Small. The whole thing is the rename asymmetry:

- `plugin/src/sync/control-handlers.ts:48-53` — decide the rename rule deliberately. Note the
  `some()` is **not** an accident: `manifest.ts:389-405` documents why the *manifest* rename needs
  destination-only guarding (so an entry moved out of the shared tree is un-keyed rather than
  stranded). The inbound *application* gate has no such need and should be all-paths.
- `plugin/src/files/file-ops.ts:461-475` — an outbound predicate.
- `plugin/src/files/vault-events.ts:190-194` — or leave the event admission alone and guard in
  `onFileRename`; one definer, not two.

**1 WP — and it is already chartered as WP68.** Ä9 charters nothing new; it *renames* WP68's
subject from "leak" to "security boundary", which changes its priority, not its content.

Risk: the guard must not strand manifest entries. `manifest.ts:389-405` is a 17-line comment
explaining precisely which asymmetries are load-bearing. An implementer who "fixes the
inconsistency" by making all four sites strict will break the legitimate reverse direction.

### Would it help — adversarial

**Yes, but its stated form overstates what is missing.** Reported as "the exclusion paragraph must
be replaced by four surfaces", a reader concludes four surfaces are open. Two are closed with
enumerated, comment-pinned consumer lists. A charter written from Ä9's text would re-derive work
that WP26 and WP6 already did.

The one thing Ä9 gets that nothing else in the tree does: it makes surface (4) a **trust-boundary**
item rather than a correctness item, which is the difference between "fix when convenient" and
"fix before the gate". Given that WP68 is currently item 9 in the dispatcher queue — *behind* the
gate — that reclassification is the amendment's real payload.

### Recommendation

**Adopt, amended.** State which surfaces are already closed and cite them (`manifest.ts:441/406/169`,
`utils.ts:332`), so the amendment is a *ratification plus one gap* rather than four open items.
Keep the security-boundary language verbatim — it is the part that changes behaviour. Then move
WP68 ahead of the gate (see ordering, below).

---

## Ä15 — fail-closed defaults and config-dir deny-list

Two amendments in one. They have different statuses and different verdicts; they should be split.

### Ä15a — fail-closed share scope. Status: **NEW WORK, and the live instance is confirmed**

```text
plugin/src/types.ts:48         sharedFolder: ""            ← the shipped default
plugin/src/files/manifest.ts:443   if (!this.settings.sharedFolder) return true;
plugin/src/main.ts:495         guest branch → await this.cleanupStaleFiles()
plugin/src/main.ts:543-560     cleanupStaleFiles → this.app.fileManager.trashFile(file)  (:554)
```

*(Note: the prompt cites `manifest.ts:445` and `main.ts:471`. In the current tree they are `:443`
and `:495`. Same statements, drifted line numbers — `DISPATCHER_STATE.md:103-105` should be
refreshed.)*

The default is empty, empty means "share the whole vault", and the guest path trashes every shared
local file absent from the host manifest. Three further call sites of `cleanupStaleFiles` at
`main.ts:651`, `:684`, `:1805`. This is the correct reading of the hazard and it is live.

**Difficulty:** small in code, large in blast radius. One predicate at `manifest.ts:443`, one
startup check, one settings-validation surface (`ui/settings.ts:177-179` currently only strips
leading dots and `..`, and permits empty). Every one of ~1856 tests that constructs a settings
object with `sharedFolder: ""` and expects sharing to work would flip. **1 WP for the code; the
suite fallout is the cost, and it is not small.**

**Would it help — adversarial:**

The prompt asks whether "startup refusal" reproduces the project's central lesson that refusals
become deletions at the next destructive boundary. **Checked explicitly against I11: it does not,
provided the refusal is at the *session* boundary.**

- I11 governs a **record** refused at a validity boundary composing with a destructive write on
  the same file. A session that never starts performs no manifest publish, no `syncFromManifest`
  and no `cleanupStaleFiles`. The destructive boundary is never reached.
- `cleanupStaleFiles` is additionally self-guarded: `main.ts:545` `if (manifest.size === 0) return;`.

**But there is a real I11-shaped variant the amendment does not name, and it is the dangerous
one.** If the refusal is implemented **asymmetrically** — e.g. the host refuses to *publish* a
manifest while the guest still joins, or the host refuses and the guest does not — then the guest
sees a partial or empty-then-partial manifest and `main.ts:552` trashes everything not in it. **A
one-sided fail-closed is strictly worse than no fail-closed.** The amendment says "Startverweigerung"
without saying *whose* start, and that ambiguity is exactly the composition I11 was written to
forbid.

Cheaper alternative worth considering and rejecting: default `sharedFolder` to a sentinel and
refuse only the *destructive* consumer (`cleanupStaleFiles`) rather than the session. Rejected —
that leaves the whole vault published to peers, which is the confidentiality half of the same
defect. Refuse the session.

**Recommendation: adopt, amended.** Require that the refusal is **symmetric and pre-connection**:
no `SyncManager` connect, no manifest doc, on either role. Add a normative sentence: *"a
configuration refusal must abort before any manifest exists on either side; a refusal that leaves
one peer publishing and another consuming converts the refusal into a mass deletion
(`main.ts:552`)."* Without that sentence this amendment can be implemented into a vault-trashing
bug.

### Ä15b — config-dir deny-list. Status: **PARTIALLY SATISFIED**

`.obsidian/**` is **already denied** at the manifest membership gate (`exclusion.ts:12` +
`manifest.ts:442`, wired at `main.ts:343-345`), which covers every op type except rename — see Ä9.
`.obsidian/liveshare/**` is denied by `isSidecarPath` (`canvas-sidecar.ts:78-87`) at
`manifest.ts:441`, independently of `ExclusionManager`, and `manifest.ts:429-440` is a comment
explaining exactly why the two are kept separate.

So the amendment's premise — *"`isPathSafe` prüft Traversal — das genügt nicht"* — is **true of
`isPathSafe` and misleading about the system**. `isPathSafe` was never the only gate;
`isSharedPath` is. What Ä15b actually finds is that **one funnel bypasses `isSharedPath`**, and it
is the same rename funnel as Ä9(4).

Two genuine residual gaps, neither of which the amendment names:

1. `ExclusionManager.isExcluded` is reached through `this.exclusionManager?.` (`manifest.ts:442`)
   — **optional**. A `ManifestManager` constructed without one (every test double, and any future
   wiring path) denies nothing. The amendment's "at **every** funnel" is the right instinct; the
   fix is to make the deny-list non-optional, not to add a second list.
2. `minimatch(".obsidian", ".obsidian/**")` is false — `a/**` does not match `a` itself. A
   `folder-create` op with `path: ".obsidian"` is admitted by the pattern (it is refused by other
   means today, but the pattern is not the reason). Any deny-list must be a **prefix predicate**
   like `isSidecarPath`, not a glob.

**Difficulty:** small — one predicate, non-optional, applied at `control-handlers.ts:48-53` and
`file-ops.ts:179-181`. **Merges with WP68 into 1 WP.** Do *not* charter it separately; two
independently-authored path predicates is rule 10's failure mode and this codebase has already
paid for it once.

**Would it help — adversarial:** the *rule* is right and cheap. The *justification* ("`isPathSafe`
is insufficient") will mislead an implementer into hardening `isPathSafe`, which is the wrong
module: `isPathSafe` is deliberately a vault-escape test with a documented single responsibility
(`utils.ts:42-47`), and widening it would silently change six other call sites
(`background-sync.ts:116/282/455`, `canvas-sync.ts:2178/2377/2708/3515`,
`canvas-persistence.ts:669`).

**Recommendation: adopt, amended.** Rewrite the justification as *"`isSharedPath` is the deny gate;
one funnel (inbound/outbound rename) bypasses it"*, and add the two residual gaps above. Explicitly
forbid modifying `isPathSafe`.

---

## Ä11 — correct the rig premise

### Status — **ALREADY SATISFIED in fact; the concept text still needs the edit**

The false sentence is at `CONCEPT_V2.md:828`. The correction is already recorded, three times, in
prose the amendment was derived from:

- `tools/launch_liveshare_e2e.py:2-12` — the launcher's own docstring: *"**THE HEADLESS MOCK RIG**
  … it aliases the `obsidian` module to `plugin/src/__mocks__/obsidian.ts` … no real Obsidian
  process, no real vault, no real Canvas view is involved anywhere in a run … it may never be
  recorded as satisfying WP7, WP40 or WP54."*
- `tools/obsidian_e2e/lifecycle.py:318` — `class PlanOnlyConsole`, the only console backend.
- `DEVELOPMENT_REPORT_CanvasV2.md:§1 finding 2` — "Rebuilding the host layer is **20 work
  packages** — the single largest driver of 42 → 76."

### Difficulty

**Trivial. One sentence in `CONCEPT_V2.md`. 0 WPs** — it is a documentation edit, not work.

### Would it help — adversarial

**Yes, unambiguously, and it is the highest value-per-effort item in this set.** The cost of *not*
making it is already measured: this exact misreading was, by the development report's own
accounting, the single largest driver of the work-package explosion. Leaving the false sentence in
the authoritative document guarantees the next reader repeats it.

One sharpening: Ä11's replacement text says *"Das Pflicht-Gate aus diesem Teil erfordert den Bau
dieses Layers"*. That is now understated. The layer is built (WP43–49 `DONE`) and is **plan-only by
design** — `lifecycle.py`'s only backend is `PlanOnlyConsole` and C45 AC4 forbids adding a spawn
backend. So the gate is not "blocked on building the layer"; it is **agent-mediated by
construction**, which is WP71. The replacement text should say so, or it creates a second false
premise where it removes the first.

### Recommendation

**Adopt, amended** — add one clause: *"the host layer is now built (WP43–49) and is plan-only by
design; the gate run is therefore agent-mediated (WP71), not rig-executed."* Land it before
anything else in this set: it is free and it stops the misreading propagating further.

---

## Ä12 — intent-trace oracle + reference-model obligation

### Status — **ALREADY SATISFIED**, more completely than the amendment assumes

Both halves exist, landed as WP23:

```text
plugin/src/__tests__/harness/fuzz/intent-trace.ts        the reference model
plugin/src/__tests__/harness/fuzz/oracle.ts:42-49        AssertionFamily includes "intent-trace"
plugin/src/__tests__/harness/fuzz/oracle.ts:265-413      checkIntentTrace
plugin/src/__tests__/harness/fuzz/oracle.ts:416-428      checkAllFamilies runs it first
```

And it satisfies the **independence** requirement mechanically, not by assertion:

- `intent-trace.ts` **has no import statements at all.** Verified by grep across the whole `fuzz/`
  directory: every other module imports something; this one imports nothing. It cannot borrow the
  implementation because it cannot reach it.
- It **re-derives** the two things it would have been tempting to import: the node→edge visibility
  cascade (`:363-387`, with the reason stated at `:366-370`) and the `(ord, id)` comparator
  (`:396-417`, *"written here rather than imported from `canvas-ord.ts` … an oracle that borrows
  the comparator under test cannot disagree with it"*).
- `oracle.ts:33` imports `serializeCanvas` — but as the **subject** (`:56` *"This is the SUBJECT,
  never the basis"*), and `checkSchema`'s `hasWholePosition` is likewise re-derived (`:135-150`).
- The circularity rule Ä12 states in German is stated in English at `intent-trace.ts:21-24`,
  verbatim in substance.

`WP23/test_tp04_agreement_is_not_sufficient_visible.test.ts` is the discrimination test: it
constructs a hand-populated `IntentTrace`, asserts the other four families stay green
(`:110`) and that intent-trace fires (`:117`). That is the measured claim the amendment cites,
already pinned as a test.

### What is genuinely open — the reach, which the amendment does not measure

The reference model covers: field values, record visibility (with cascade), record order,
atomic-register tuple contests (I8). It does **not** model:

- **Tombstone `(t, by)` Lamport arbitration.** `TracedRecord.visible` (`intent-trace.ts:156`) is a
  boolean the harness sets; there is no independent LWW-over-stamps model. A defect in
  `mergeTombstoneEntries` (`canvas-tombstone.ts:239`) is therefore invisible to the oracle.
- **Epoch comparison.** Not modelled at all.
- **The Ä4 precedence rule.** `RecordShape: "dual"` exists (`:119`) but the harness *only authors
  the flat spelling* on a dual record (`:113-116`), so it never creates the collision the
  precedence rule arbitrates.
- **Anything outside the fuzzer.** The oracle exists in the headless property harness; it has no
  presence in the real-Obsidian gate, where `assert_converged` is a byte/record diff between two
  hosts (`liveshare_e2e_mcp_server.py:301`) with no intent basis at all.

The amendment's own list is *"LWW über Stempel, Tombstone-Regel, Präzedenzregel aus Ä4"* — **all
three of which are the parts that do not exist.** So Ä12 is not wrong; it is *right about the gap
and wrong about the baseline*, and its wording ("MUSS ein Intent-Trace-Orakel enthalten") will read
to an implementer as "build one" rather than "extend the one at `harness/fuzz/intent-trace.ts`".

### Difficulty

- Extending the model to tombstone/epoch/precedence: `intent-trace.ts` + `standard-ops.ts` +
  `oracle.ts`. **2 WPs.** Constraint: the extension must keep the zero-import property, which means
  re-deriving the Lamport merge — a second implementation of `rankEntries`. That is the point, and
  it is also the cost.
- Carrying it into the real gate: this is not a 2-WP extension, it is a different problem. The gate
  driver would need a per-gesture intent log, which is precisely Ä13(3)'s provenance trace. **Do
  not scope it here.**

### Would it help — adversarial

**The obligation as a spec requirement: yes, ratify it.** It is the one oracle with an independent
basis and the concept must say so.

**"Independently authorised" is the part that is not achievable as written, and the amendment
should stop pretending otherwise.** `intent-trace.ts` was written by the WP23 batch — the same
run, the same instructions, arguably the same mind — as the code it judges. What makes it
non-circular is *mechanical*: zero imports, re-derived comparator, re-derived cascade, and a
discrimination test that proves the other four families go green where it fires. **That is the
achievable form of independence, and it is stronger than "a different author", because it is
checkable.** An amendment that demands independent *authorisation* invites a governance ritual that
provides no additional guarantee; an amendment that demands independent *derivation with a
mechanical no-shared-code property* gets the real thing. Rewrite the obligation in those terms.

Vacuity check: the model itself could go vacuous (an expectation that is always `undefined` asserts
nothing — see `expect()` returning `undefined` at `:347`, and `checkIntentTrace:314`
`if (expectation === undefined) continue`). **A conformance test for Ä12 must assert a minimum
non-`undefined` expectation count**, or the oracle silently degrades to nothing while staying
green. That is a real risk in the extension work and the amendment does not mention it.

### Recommendation

**Adopt, amended, and re-pointed.** (a) Record that the oracle and the reference model exist, cite
`harness/fuzz/intent-trace.ts` and `oracle.ts:265`. (b) Replace "unabhängig von der Implementierung
autorisiert" with the mechanical criterion: no import from `src/`, comparators and cascades
re-derived, discrimination test showing the other families green. (c) Name the three uncovered
semantics (tombstone stamps, epoch, Ä4 precedence) as the open obligation. (d) Require a
non-vacuity floor on expectation count.

---

## Ä13 — gate path obligation, chaos suites, path evidence

Three clauses, three different statuses.

### Clause 1 — path obligation. Status: **NEW WORK as code, already chartered as WP76. The premise is confirmed exactly.**

```text
plugin/src/testing/e2e-control.ts:978-1005   simulateEdit → doc.getMap("nodes") / doc.getMap("edges")
                                              → upsertRecord inside doc.transact()
plugin/src/testing/e2e-control.ts:1023       return { applied: true };
```

**The gate's only gesture writes straight into the `Y.Doc`.** It does not touch the editor, the
canvas view, `requestSave`, `handleLocalModify`, the surface shadow, the reconcile plan or the
serializer. Ä13's sentence *"Ein Rig, das ins CRDT injiziert, testet den Transport — dessen
Konvergenz nie in Frage stand — und nichts über P0/P1"* is a literal description of `:996-1005`.

And the second half of clause 1 is even more precisely true than stated: `:1023` returns the
**literal `true`**. So `_was_applied` in the driver
(`liveshare_e2e_mcp_server.py:126-137`) — which WP73 carefully hardened to reject truthy stand-ins
and default-true reads — is reading a constant. WP73 made the *driver* honest about a *host* that
cannot lie in the other direction. That is worth saying plainly: **the repair landed one seam
short of the defect.**

WP76's charter (`TaskCharter_WP76_CapturePathExerciseAndPathEvidence.md`, `SPEC_COMPLETE`) charters
this, correctly, and explicitly declines to re-point `simulateEdit` (it is the legitimate
remote-apply origin). WP75 charters the `applied` constant.

### Clause 2 — chaos suites as gate scenarios. Status: **NEW WORK — and the amendment silently substitutes one of the four**

`CONCEPT_V2.md:836-842` names four: delayed view-apply + Obsidian save; adapter unavailable + open
view + remote deltas; host rejoin with older sidecar; **"Fallback-Client neben Owned-Client"**.

Ä13 names four: the first two identically, "Host-Rejoin mit älterem Sidecar", and
**"Mixed-Version-Peer"**.

**The fourth is not the same scenario.** Fallback-client-beside-owned-client is the R10 raw-text
fallback running concurrently with `CanvasSync` — the two-writer race `utils.ts:236-241` and
`vault-events.ts:242-255` exist to prevent. Mixed-version-peer is the `meta.schemaVersion` class
from Teil 12 and Ä5. Ä13 replaces one with the other without saying so, and it does it in an
amendment whose own subject is "a gate result without evidence is not a result".

Current coverage: suites 1 and 2 exist headless with discrimination variants
(`plugin/src/__tests__/v2/wp6/chaos_cascade.test.ts:389/514`,
`chaos_degraded_adapter.test.ts:427/578` — both carry `D1`/`D2` seam-disable variants, which is
exactly the demanded pattern). Suites 3 and 4 are WP35, `SPEC_COMPLETE`, phase **P3**, unimplemented
and behind the gate. **None of the four runs in the real gate.**

### Clause 3 — positive path evidence. Status: **NEW WORK, chartered as WP76 AC4**

The technical claim is right: Yjs transaction origins are transaction-local. The codebase's own
origins (`SIDECAR_LOAD_ORIGIN` at `canvas-sidecar.ts:131`, `CANVAS_EPOCH_ADOPT_ORIGIN` at
`canvas-epoch.ts:312`) are `unique symbol`s consumed inside a handler and never persisted. Nothing
in the tree records per-edit provenance.

The dispatcher has already found the sharper form of this: `bindingInstrument`'s four counters are
**permanently zero when `useCanvasBinding=false`**, which both vaults are. So "counters moved ⇒ the
path ran" is unavailable *and* "counters did not move ⇒ the path did not run" is meaningless. Ä13's
"mitgeschrieben, nicht behauptet" is the right requirement and the existing counter surface cannot
satisfy it.

### Difficulty

- Clause 1: **WP76, chartered, ~1 WP**, two repos (`e2e-control.ts` + the AgenticWorkspace driver).
  Blocked on WP50 (file ownership) and WP74/WP75 (seam ownership).
- Clause 2: suites 3 and 4 are WP35 in **P3**, which is queued behind the gate. Making them *gate
  scenarios* inverts that ordering. **2–3 WPs and a phase-ordering decision**, not a documentation
  edit. Ä13 does not acknowledge this.
- Clause 3: **WP76 AC4, ~0 additional WPs** if it lands with clause 1.

### Would it help — adversarial

**Clause 1: yes. It is the single most valuable amendment in Group 2, and it is the only one that
changes what a green gate means.** Without it WP7 measures Yjs.

**Clause 3: yes, and it is the anti-vacuity mechanism this project has been missing.** The prompt
asks whether Ä13 solves the vacuity problem or relocates it. Honest answer: **it relocates it one
level, and that level is worth buying.** A provenance trace can itself be forged — a host that
stamps `path: "capture"` on a doc injection is exactly the `__LS_E2E__` mistake again. What makes
clause 3 *not* purely a relocation is that WP76 requires the evidence to come from the plugin's own
wiring rather than from the driver's assertion, plus a case that cannot name its path being
`inconclusive` rather than `pass`. **The residual risk must be stated in the amendment:** the trace
must be produced by the production path, not by the control command, or it is the same defect with
a longer name.

**Clause 2: partially, and it is the one clause I would push back on.** Running the four suites in
the real gate is expensive (they are deterministic headless suites with injected seams; a real
Obsidian instance has none of those seams, so they must be *re-authored*, not *relocated* — the
discrimination variants `D1`/`D2` disable a mechanism through a test seam that does not exist in a
production build). The demand "jede mit ihrer Discrimination-Variante" is therefore **not
satisfiable in a production build by construction**: a production bundle tree-shakes `src/testing/`
out, and the seam-disable calls (`setShadowRebaseEnabled(false)`) are test-only. **As written,
clause 2 charters a green that cannot be produced.**

### Recommendation

- **Clause 1 — adopt as written.** It is correct and already chartered.
- **Clause 3 — adopt, amended.** Add: the trace must be emitted by the production capture/apply
  path, never by the control command, and a case that cannot name its path is `inconclusive`.
- **Clause 2 — adopt amended, or defer.** Fix the fourth suite name (decide deliberately between
  "Fallback-Client neben Owned-Client" and "Mixed-Version-Peer"; do not substitute silently), and
  **drop the "each with its discrimination variant" requirement for the real gate** — a
  discrimination variant needs a test seam that a production build does not contain. Replace with:
  *"each suite's discrimination variant runs headless; the real gate runs the positive scenario
  only, with path evidence."*

---

## Ä14 — release condition vs. phase closure

### Status — **CONTRADICTS the Dispatcher ruling. It ratifies the outcome and quietly weakens the rule.**

This is a process amendment, so judge it on incentives.

**Half of Ä14 is already the concept.** `CONCEPT_V2.md:828-831` already says: *"Ab P0 ist ein
grüner Zwei-Vault-Lauf mit echtem Obsidian **Release-Bedingung**"*. The distinction Ä14 presents as
new is in the authoritative text. What is genuinely new is (a) the label "headless-verifiziert,
real-offen" and (b) the mandatory reopen-risk field.

**The Dispatcher's standing ruling** (`DISPATCHER_STATE.md:259-261`): four phases closed without
the gate are *acknowledged but not retroactively authorised*, and **"P0–P2 reopen if the gate
surfaces a P0/P1 defect."**

Compare:

| | Dispatcher ruling | Ä14 as written |
|---|---|---|
| Trigger for reopening | **any** P0/P1-severity defect the gate surfaces | refutation of the **named assumptions** in the reopen-risk field |
| Status of the closures | acknowledged, **not authorised** | given a legitimate name and a compliant procedure |
| Coverage | P0, P1, P2 (and P6 by implication) | names reopen-risks for **P0 and P1 only** |

Three consequences, all in the same direction:

1. **It narrows the reopen trigger from a severity class to an enumerated list.** A gate that finds
   a P0-severity defect *not on the list* does not, under Ä14's letter, reopen anything. The list
   is written by the same party whose phases would reopen. That is the incentive problem in one
   sentence: **Ä14 lets the closer choose the conditions of its own reopening.**
2. **It retroactively authorises what the Dispatcher explicitly declined to authorise.** "A phase
   closed without the gate means exactly *headless-verified, real-open*" converts an
   acknowledged deviation into a compliant state with a name. That is the substance of retroactive
   authorisation regardless of the word used.
3. **Its coverage is incomplete in a way that matters.** It names reopen-risks for P0
   (`CAPTURE_TRIGGERS`, requestSave timing) and P1 (migration precedence). **P2 and P6 get none** —
   yet P2 is the sidecar/GUID/epoch phase, whose entire compaction behaviour is what Ä6 says is
   wrong, and P6 is the relay persistence whose checkpoint path is what Ä7 says is uncoupled. Both
   are closed. Both are unexercised in real Obsidian. Under Ä14 as written, neither carries a
   reopen risk at all.

The last paragraph of Ä14 — *"Vakuum-Läufe sind schlechter als kein Lauf"* — is correct and should
be kept verbatim. It is the only part of the amendment that tightens anything.

### Difficulty

Zero code. `CONCEPT_V2.md` Teil 13 + Teil 14, plus a per-phase field in `BUILD_SPEC` /
`DISPATCHER_STATE`. **0 WPs.** The difficulty is entirely governance.

### Would it help — adversarial

**Not as written. As written it lowers the bar and should not be adopted in that form.**

The reason is not that the closures were wrong — closing headless-verified phases and labelling
them honestly is the right call, and the Dispatcher's own note (`DISPATCHER_STATE.md:259-261`)
gives the correct reason: building P3–P5 first would multiply what has to reopen. The problem is
that Ä14 conflates *labelling the state honestly* (good, adopt) with *pre-committing the set of
findings that may reopen it* (bad, reject). Those are separable and the amendment does not separate
them.

There is also a smaller, structural point: a "reopen-risk field" whose entries are *assumptions*
rather than *observations* is unfalsifiable in the same way a green test can be. "CAPTURE_TRIGGERS
real behaviour" is not an assumption whose refutation is checkable — it is a topic. The field needs
to name, per phase, **a checkable proposition** ("`vault.on('modify')` fires within N ms of a
canvas drag on a real host") whose negation is observable in the gate transcript.

### Recommendation

**Adopt amended, with two hard changes:**

1. **The reopen-risk field is a floor, not a ceiling.** Add verbatim: *"a phase reopens on any
   P0/P1-severity defect the gate surfaces, whether or not it appears in the reopen-risk field.
   The field enumerates the risks known at closure; it does not bound them."* This restores the
   Dispatcher's ruling.
2. **Every closed phase carries the field, including P2 and P6.** Name P2's (sidecar compaction
   behaviour under a real vault adapter; epoch adoption under a real Obsidian file writer) and
   P6's (checkpoint emission against a live relay; the E2E-room checkpoint suppression at
   `sync.ts:580`).

Additionally: require each entry to be a **checkable proposition**, not a topic.

Keep "Vakuum-Läufe sind schlechter als kein Lauf" exactly as written.

---

## Ä16 — mutation-test score

### Status — **NEW WORK.** Nothing mutation-related exists in the tree — no Stryker, no harness, no
score, no mention outside the amendment file itself (grep across `*.md`, `*.json`, `*.ts` returns
only `CONCEPT_V2_AMENDMENTS.md` lines 35 and 367-376).

### Difficulty

The named targets are the right ones and they are the *only* place this is cheap, because they are
genuinely pure:

| Target | File | Purity |
|---|---|---|
| shadow diff | `plugin/src/canvas/canvas-shadow.ts` (1130 lines) | pure |
| reconcile plan | `plugin/src/canvas/reconcile-plan.ts` (185) | pure, cited as the purity precedent |
| precedence rule | not yet built (Ä4) | — |
| epoch comparison | `plugin/src/canvas/canvas-epoch.ts:335-395` | pure |
| tombstone evaluation | `plugin/src/canvas/canvas-tombstone.ts` (337) | imports nothing |
| path gates | `plugin/src/utils.ts:48`, `canvas-sidecar.ts:78` | pure |

Toolchain: the project is on **vitest 4** (`plugin/package.json`), so StrykerJS with the vitest
runner is the obvious choice — one dev dependency, one config, one npm script.

**Runtime is the objection and it is serious.** Stryker's cost is roughly *(mutants) × (test time
of the covering subset)*. The full suite is **303 files / 1856 tests**, plus 540 test files under
`workflowArtifacts/canvas-v2/tests/`. A naive whole-suite run per mutant is hours. Mitigations that
this codebase happens to make easy: (a) restrict `mutate` to the six pure modules — a few hundred
mutants, not thousands; (b) per-test coverage analysis, which vitest supports; (c) run it as a
**separate, non-blocking job**, not in `npm test`.

**1 WP** for the harness + config + a first baseline score. **~0 ongoing** if it is not in the
default test path.

### Viability

Viable, and this codebase is unusually well suited: the six targets import nothing (the purity
contract is stated and enforced by test — `canvas-tombstone.ts:76-84`,
`canvas-sidecar.ts:29-32`). Mutation testing is cheapest exactly where a module has no I/O, no
clock and no randomness. Every one of these does.

### Would it help — adversarial

**Yes, and the amendment's own argument is the strongest one available:** nine hand-found
"green test that cannot fail" instances is empirical evidence that the systematic form is cheaper
than the tenth hand search. I would go further — five of the eleven hard-won rules in
`DISPATCHER_STATE.md:568-598` are restatements of "an assertion did not pin what its title said",
and a surviving mutant is the mechanical detector for exactly that.

The prompt asks whether Ä16 solves the vacuity problem or relocates it. **It genuinely solves it,
within its scope, and its scope is narrow — and the amendment already says so** (*"Das
Discrimination-Muster bleibt für Kompositionen"*). That is the honest boundary and it is correctly
drawn. A surviving mutant is an unfakeable finding: the code changed, the tests did not notice.
There is no "mutation score that cannot fail".

Two costs the author may not have priced:

1. **Equivalent mutants.** A fraction of surviving mutants are semantically identical to the
   original (e.g. mutating `<=` to `<` in `truncationCutoff`'s `upToSeq <= 0` guard where the `0`
   case is separately unreachable). Each needs human adjudication, and there is no automated
   answer. Budget a triage pass, and **do not set a numeric score threshold as a gate condition on
   the first run** — a threshold chosen before the equivalent-mutant rate is known becomes either
   trivially met or permanently unmet.
2. **It will find things, and they will be real.** `canvas-shadow.ts` is 1130 lines of decision
   logic. A first run producing 30 surviving mutants is a plausible outcome and each one is a
   claim about a test that cannot fail. That is the *point*, but it is a work queue nobody has
   budgeted.

Cheaper alternative? No. The existing discrimination pattern is the manual form of the same idea
and has been applied six times exhaustively; the sixth pass found the current three items and
Worker 2's own read is that a seventh would return nothing
(`DISPATCHER_STATE.md:409-411`). **The manual method is declared exhausted. That is precisely the
condition under which the automated form pays.**

### Recommendation

**Adopt as written, with one addition:** the score is a **reported metric with a triage
obligation**, not a numeric gate condition, until a baseline and an equivalent-mutant rate exist.
Scope to the six named cores; keep it out of `npm test`.

---

## Value per unit of effort

| Rank | Ä | Value | Effort | Ratio | Note |
|---|---|---|---|---|---|
| 1 | **Ä11** | high | ~0 (one sentence) | **highest** | free; already-measured misreading cost 20 WPs once |
| 2 | **Ä13 clause 1+3** | highest in the set | 0 additional (WP76 chartered) | very high | without it WP7 measures Yjs, not this project |
| 3 | **Ä15b + Ä9** (merged) | high (security boundary) | 1 WP (= WP68, chartered) | very high | one hole, two arms, one predicate |
| 4 | **Ä8** | medium-high | 1–2 WP | high | closes a state that will actually occur |
| 5 | **Ä12** (as ratification + reach) | medium-high | 0 to ratify, 2 WP to extend | high | ratification is free; extension is optional |
| 6 | **Ä15a** | high (prevents vault trashing) | 1 WP code + large suite fallout | medium-high | the fallout is the cost, not the code |
| 7 | **Ä16** | medium-high | 1 WP + an unbudgeted triage queue | medium | the manual method is declared exhausted; that is when this pays |
| 8 | **Ä6** | medium-high (real defect) | ~2 WP + a §7 licence + reopening a `DONE` WP | medium | reopens WP25; must land with Ä7-1 |
| 9 | **Ä7 rule 1 (cheap form)** | medium | 1 WP, client-only | medium | as written (epoch-aware relay): low ratio, reject that form |
| 10 | **Ä14** | **negative as written** | 0 | — | adopt only with the two amendments; otherwise it lowers the bar |
| — | **Ä7 rule 2** | diagnosis valuable, prescription unimplementable | 3–4 WP | low | record as known-open, do not charter |
| — | **Ä13 clause 2** | low as written | 2–3 WP + phase-order inversion | low | demands a discrimination variant a production build cannot host |

---

## Ordering constraints

### Must land BEFORE the real-Obsidian gate run (WP7)

1. **Ä15a (fail-closed share scope)** — or its operational equivalent. WP70 pins `sharedFolder` to
   `_e2e-rig` for the run, which mitigates *the gate*. It does not mitigate the shipped default.
   The gate is not the only thing that runs against these vaults. **Do not let WP70's pin be
   mistaken for Ä15a being satisfied.**
2. **Ä9 + Ä15b (the merged rename/deny-list predicate, = WP68)** — currently item 9 in the
   dispatcher queue, i.e. **behind** the gate. Ä9's reclassification of surface (4) as a security
   boundary is the argument for moving it ahead. A gate run is a live two-instance session over a
   relay; running one with an open inbound-write funnel is the wrong order.
3. **Ä13 clause 1 (= WP76)** — already the gate's own required order (WP50 → WP74 → WP75 → WP76 →
   WP51 → WP71 → WP7). Nothing changes; Ä13 ratifies it.
4. **Ä13 clause 3 (= WP76 AC4)** — same WP, same landing.
5. **Ä11** — free, and it prevents the gate's own charters being written from the false premise
   again. Land it first, today.
6. **Ä14, amended** — must be settled *before* the gate, not after, because it decides what a P0/P1
   finding does to four closed phases. Settling it after the gate finds something is settling it
   with a known answer in hand, which is the incentive problem in its worst form.

### Must NOT land before the gate

1. **Ä6** — it removes a landed mechanism (WP25's sweep) and reopens a `DONE` WP under a §7 licence.
   Doing that while WP50/74/75/76 are in flight puts a semantic change under four work packages
   that are restructuring the gate's own driver and control surface. **After the gate.**
2. **Ä7 (either rule)** — rule 1's cheap form touches `sync.ts`, which the gate exercises; the
   full form touches `server/`, which §7 makes an abort criterion outside WP41, and
   `DISPATCHER_STATE.md:336` already records an undecided `server/` question (the all-interfaces
   bind). **After the gate.** Note the WP77 warning: work touching `ports.py`/relay wiring must not
   land mid-run.
3. **Ä16** — a mutation harness runs the suite hundreds of times. `plugin/main.js` is untracked,
   shared and last-build-wins (`DISPATCHER_STATE.md:430-442`); a mutation run concurrent with any
   other batch's build is exactly the collision B10b already recorded. Needs a **quiet tree**, same
   precondition as WP66. **After the gate, or in a dedicated quiet window.**
4. **Ä12's extension** (tombstone/epoch/precedence in the reference model) — it edits the fuzz
   harness, which several blind sets depend on. Ratification of the existing oracle is free and can
   land now; the extension should wait.
5. **Ä13 clause 2** (chaos suites as gate scenarios) — two of the four suites are WP35 in P3,
   which is queued behind the gate by deliberate decision. Landing this clause inverts a phase
   ordering that was chosen for a stated reason.

### Joint-landing constraints

- **Ä6 and Ä7-1 land together or not at all.** Ä6 makes the epoch bump the sole GC path; Ä7-1 is
  what stops the relay replaying pre-bump history into a post-bump doc. Ä6 alone changes GC
  semantics with the relay hazard unmitigated. Ä7-1 alone is a checkpoint for an event that
  currently does almost nothing.
- **Ä9 and Ä15b land as one predicate, one WP, one definer.** Two independently-authored path
  predicates is rule 10's failure mode, and this run has already paid for that once.
- **Ä11 and Ä13 clause 1 are complementary:** Ä11 corrects what the rig *is*, Ä13 corrects what the
  gate *must do*. Landing Ä11 alone leaves a reader believing that building the host layer is the
  remaining work, when the remaining work is making the gate exercise the right path.
