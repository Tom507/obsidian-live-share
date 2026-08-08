# WP112 — S141 (the attestation and the file it names) + S142 (the guest arm's missing guard)

**Branch:** `fix-bugs-and-raceconditions` · **Base:** `6786938` · **Worker:** 3g, sole occupant of this tree

**Gate, bracketed:** `3092 tests / 414 files, 0 failed` (measured here on the quiet tree at
`6786938`, matching the Dispatcher's figure) → **`3112 tests / 416 files, 0 failed`**.
`tsc --noEmit` clean at both ends. `check_signal_register.py` **exit 0** ("clean - no NEW
violations", 228 files scanned, positive control passed). `.pre-v2-smoke` leftovers: **0**.
No signal numbers allocated. Nothing rebuilt, nothing deployed, no vault touched.

---

## PACKAGE A — S141

### A0. The charter is right, and one thing it did not say is the sharpest part of the finding

The charter's trace is correct in every particular and I found nothing to correct in it. What it does
not say is what the first measurement showed:

> **The empty-write floor REFUSED to truncate the host's own file, and the same three lines
> published `e3b0c442…` about the bytes it had just saved.**

```
host publishes honestly ......... {"hash":"68a95c72…","size":50}
host setActiveFile round ........ {"hash":"e3b0c442…","size":0}   ← the attestation
host's OWN disk ................. 50 bytes, untouched
host's empty-write ledger ....... {total: 1, byArm: {"doc-write": 1}}
```

`setActiveFile` calls `writeToDisk(oldActive, content, …)` and `updateFile(file, content)` with the
**same** `content`, two statements apart. The first is floored and refused. The second is not. So the
peer that publishes the falsehood is the one peer that can never observe its consequence, and the
floor's own firing is the proof that the content was known to be wrong at the moment it was
published. That is why this survived a live round with the floor in place.

A second detail the charter did not name: the entry's **`size` is wrong too** (`0` against 50
bytes). Every consumer field is derived from the same wrong object, not just the hash.

### A1. VERDICT: **DEMONSTRATED.** The executed write, the lost bytes, the floor active and silent

Row **A1** of `test_s141_…`, over the real in-process NeuralAngels relay, real `SyncManager`s, real
`ManifestManager`s, real `BackgroundSync`es, the real publication, the real `syncFromManifest` and
every real floor and ledger. Measured on `6786938` **before a production line was changed**:

| | reading |
|---|---|
| guest `syncFromManifest` | `synced: 1` |
| guest's disk at the named path | `""` — **truncated** |
| the write that did it | `["modify:_liveshare-test/attested.md"]` — executed, via `Vault.modify` |
| **`getEmptyWriteRefusals()`** | `{total: 1, byArm: {"doc-write": 1}}` — **`manifest-sync`: ZERO** |
| conflict copies | `{total: 0, byArm: {}, failed: 0, discarded: 1}` |
| the guest's bytes anywhere in the vault | **`false`** |

**The floor did not fail; it was told the truth about the wrong object.** Its evidence is
`hashContent(content) === entry.hash`, and `""` against `hash("")` is `true`. `decideEmptyWrite`
therefore returned `ALLOW` with the reason *"emptying 42 byte(s) is vouched for"*. S119's outcome,
through the guard built to stop S119.

**The mtime arm is set so the safety net does NOT catch it** (`mtime` inside the last session →
S125 `DISCARD`), because "the file went to a conflict copy" and "the bytes are gone" are different
claims and only the second one is data loss. `discarded: 1` — WP115's new counter — is what makes
that distinction readable at all, and this row is its first use outside its own package.

**"Absent" versus "deciding" is settled by measurement, not by reading** (S155). The same row's
post-repair half runs the identical scenario with the attestation repaired, and the **same floor on
the same line fires** (`manifest-sync: 1`) and saves the same bytes. The zero above is a decision.
Break row **W1** closes the loop from the other side: with the publish floor removed, A1 goes red
again.

### A2. The producer census — derived from source, not hand-listed

Every writer into the manifest `Y.Map`, and whether its content argument comes from **the bytes it
attests about**:

| # | producer | content derived from | verdict |
|---|---|---|---|
| 1 | `manifest.ts::publishManifest` | `vault.read(file)` / `vault.readBinary(file)`, in the loop | ✅ **the file** |
| 2 | `background-sync.ts:542 setActiveFile` → `updateFile` | **`docHandle.text.toString()`** | 🚨 **THE DOCUMENT** |
| 3 | `background-sync.ts:691 handleLocalTextModify` → `updateFile` | `vault.read(file)` | ✅ the file |
| 4 | `vault-events.ts:194` (create, host) → `updateFile` | `vault.read` / `readBinary` of that file | ✅ the file |
| 5 | `vault-events.ts:404` (binary modify) → `updateFile` | `vault.readBinary(file)` | ✅ the file |
| 6 | `control-handlers.ts:207` (remote create applied) → `updateFile` | `vault.read` / `readBinary` | ✅ the file |
| 7 | `control-handlers.ts:216` (remote binary modify) → `updateFile` | `vault.readBinary` | ✅ the file |
| 8 | `manifest.ts::addFolder` | `{hash: "", directory: true}` | ⚠️ not a content claim — see below |
| 9 | `manifest.ts::setCanvasGuid` | `{hash: "", size: 0, guid}` placeholder | ⚠️ not a content claim — see below |
| 10 | `manifest.ts::renameFile` | re-keys an existing entry object | ✅ carries the old path's derivation |

**Answer to the charter's question — how many are there:** **six** callers reach `updateFile` and
**exactly one** of them, `setActiveFile`, derives its content from something other than the file.
WP109 removed a different producer of the same class; this one is the survivor, and it is the one the
signal named.

Rows 8 and 9 publish `hash: ""` — the empty **string**, not the empty **digest** — so they are not
attestations of empty content. They are safe today for two positional reasons: `entry.directory`
routes 8 into its own branch, and `skipsAutoTextSync` routes 9 (`.canvas` only) out before the write
arm. Nothing in the entry *says* "this hash is not a claim about content"; if either ever reached the
text writer, the only thing standing there is that `""` is not `hash("")`, so the floor refuses.
Recorded, not fixed — see residual 4.

### A3. The fix — at the producer, at the funnel, and scoped to the destructive case

| # | file | change |
|---|---|---|
| **F1** | **`files/attestation-guard.ts`** (new, pure, no imports) | `decideAttestation({attestedLength, fileLength})` — a total function with four decisions: `PUBLISH_NOT_EMPTY`, `PUBLISH_VERIFIED_EMPTY`, `REFUSE_CONTRADICTED`, `REFUSE_UNVERIFIABLE`. Lengths, never content, so one decision serves the text and binary arms and no file content can reach the module or its log line. |
| **F2** | same | `AttestationLedger` with **one counter per branch plus a `total`**, `noteAttestation(...)` counting **before** any return, and `ATTESTATION REFUSED: path=… reason=…` to the debug log and the console — one spelling, S137's rule. |
| **F3** | `files/manifest.ts` | `updateFile` consults the floor **before it mutates anything** (ahead of the parent-folder deletion, so a refusal leaves the manifest byte-unchanged). `attestedFileLength(file, binary)` reads the named file and collapses **every** failure — a throw, a missing method, a non-string — to `null`, which refuses. |
| **F4** | `main.ts`, `testing/e2e-control.ts` | `getAttestationDecisions()` and the `sync.attestationDecisions` command, so the next live round can read it beside `EMPTY WRITE REFUSED`. |

**Why the funnel and not the one bad caller.** WP109 fixed a caller and the signal stayed open,
correctly, because *the path survives its producer*. A floor inside `updateFile` governs all six
present call sites and every future one; it is the same discipline `doWriteToDisk` already applies to
the write path, which is what the charter asked for.

**Why it is scoped to emptiness, stated rather than implied.** A general "the attestation must equal
the file's current bytes" rule cannot be enforced at this seam: `setActiveFile` issues its disk write
and its publication in the same tick, and the write is queued behind `BackgroundSync.writeQueue`, so
strict equality would refuse the legitimate publication of content that is about to land. Emptiness
is the case that is **destructive at the consumer**, the case S119 measured in the field, and the
only one a file read can settle without racing anything.

**The consumer is untouched, deliberately** (charter A3). Row **P1** asserts that
`decideEmptyWrite` still returns `ALLOW` for `{incoming: "", existing: <bytes>, intentional: true}`
and states why that is correct. Hardening it is what produced **S126** the last time a floor was
tightened at the reader.

**The ordinary publication does no disk I/O** — `decideAttestation` answers `PUBLISH_NOT_EMPTY`
without consulting `fileLength`, and `updateFile` only reads the file when the attestation is empty.
Row **A7** proves it by publishing non-empty content through a vault whose `read` throws; row **P5**
pins the branch ordering that makes the short-circuit safe, and break row **W11** shows what happens
if it is reordered (**15** rows red, including five of `manifest.test.ts`'s oldest).

### A4. Where else this codebase reads "the hashes match" as "the state is right"

**The list is the deliverable; none of these is fixed here.**

1. **`manifest.ts:721` — `syncFromManifest`'s empty-write evidence.** `intentional: hashContent(content) === entry.hash`. **THE S141 SITE.** Agreement between this peer's document and the host's attestation is taken as licence to destroy this peer's file. Correct as a question about agreement; it was never a question about the file.
2. **`manifest.ts:665/670` — `needsSync`.** A hash **mismatch** is read as "my copy is wrong and must be replaced". It is evidence only that the two differ; *which* is right is a question the manifest cannot answer. S125/S148's preservation seam is an acknowledgement of this bolted on top of the decision rather than expressed inside it.
3. **`utils.ts:142 matchRenamesByHash` + `manifest-removal-decision.ts:305` `hasContentPair`.** **The strongest one after S141:** hash agreement is taken as **file IDENTITY** — the verdict's own words are *"the removed key's local content hashes to the added key's manifest hash, so this is the same file re-keyed by a rename"*. Two distinct files with identical content are indistinguishable, and the extreme case is **empty files, which all hash to `e3b0c442…`**. `matchRenamesByHash` skips a *falsy* `oldHash` (which is what the directory and guid placeholders carry, `""`), but `hash("")` is a full 64-character digest, so **two empty notes are interchangeable to the pairer** and the destructive half acts only on the hash-matched target. WP95's comment already names the hostile version ("the attacker supplies the hash"); the benign collision is named nowhere.
4. **`manifest.ts:523` — `publishManifest`'s `if (existing && existing.hash === fileEntry.hash) continue;`.** Hash agreement is taken as "the entry is already correct", so a wrong `size`, `mtime` or `binary` flag on an entry whose hash happens to match is never corrected. Benign today, same shape.
5. **`background-sync.ts:867/880/899` (`lastWrittenContent.get(path) === content`, `existing === content`) and its four siblings — `canvas-sync.ts:3541/4903`, `canvas-persistence.ts:438`, `seed-refusal-store.ts:414/532`.** Content equality read as "nothing to do". Right about the bytes, silent about whether the bytes are right — and break row **W6** shows this exact line can be poisoned into "converged" while the file never converges.
6. **`e2e-control.ts:305 sameFileObservation` / `:1966 endpointChanged` — the RIG, not the product.** Two peers' `sha256` agreeing is scored as *converged*. **S119 is this project's own counter-example**: all three clients agreed perfectly on `e3b0c442…` while every `.md` in the share was destroyed. An oracle built on agreement cannot distinguish convergence from a shared loss, and this is a rig-correctness statement worth a signal of its own.

### A5. Break table — `workflowArtifacts/canvas-v2/wp112_break_table.py`

Baseline **192/192**, final green **192/192**, **0** copy-aside leftovers, **every** row restored
byte-identically (sha256). 13 rows over the two WP112 files plus the six neighbours this package
could re-open (`S119`, `S125`, `S126`, `S134`, `S148`, `S151`) and the two broad unit files.

| row | plant | RED |
|---|---|---|
| **W1** | the shipped defect verbatim — `updateFile` publishes what it is handed | **A1**, A2, A3, A4, A5, A6, A7 |
| W2 | the floor runs but stops reading the file it names | **A1**, A2, A4, A5 |
| W3 | an unreadable file is guessed empty instead of refused | A4, P4 |
| W4 | the floor over-reaches and refuses the TRUE empty case (S126's class) | A3, A5, P3, P6 |
| **W5** | S142's guest guard removed — **the pre-repair measurement** | **B1**, B3, B4, B7 |
| **W6** | the decline also sets `lastWrittenContent` — the subtle one | B3, B7 |
| W7 | S134's mistake reproduced: the guard moves to the top of the guest arm | B1, B4, B7 |
| W8 | the host arm's decline stops being counted (WP109's silence restored) | B5 |
| W9 | the decline is counted **and** the write happens anyway | B1, B3, B4, B7 |
| W10 | the ledger returns before its counters for every non-refusing decision | A3, A5, A6, A7 |
| W11 | the non-empty short-circuit is reordered away | **15 rows**, incl. 5 in `manifest.test.ts` |
| **W12** | **NEGATIVE CONTROL** — the attestation log line reworded | **nothing. 192/192** |
| W13 | the single-writer log line reworded | B6 only |

**W13 is reported rather than dropped.** The first cut of W12 bundled both rewordings and reddened
B6 — a negative control that reddens something is not a negative control. B6 exists to pin that
spelling on purpose (S137: a refusal nobody can grep for cannot be attributed), so the two edits are
now separate rows with separate expectations.

---

## PACKAGE B — S142

### B0. Answering the charter's question: **S142 is NOT closed, and WP115 did not change its shape**

WP115 routed this arm's write through the conflict-preservation seam. That decides **what happens to
the bytes it is about to replace**. It says nothing about **who may write**, and the write it added
is the same `adapter.write`, on the same line, for the same file the editor owns. Preserving a copy
of a file you must not be writing is a better outcome, not a different decision. The arm still had no
active-file guard at `6786938`.

### B1. The violation, measured

Break row **W5** disables this package's guard — which restores `6786938`'s behaviour exactly — and
reruns the file. A guest with the note **open**, joining through the real `startAll("guest")`:

- `writes` include **`adapter.write:_liveshare-test/open-in-the-editor.md`**;
- the guest's **disk becomes the host's text, underneath the open editor**;
- `getSingleWriterDeclines().byArm["subscribe-guest"]` is **`undefined`** — not a zero, no reading
  at all, which is what the absence of this invariant looked like from outside.

`adapter.write` goes straight past the `Vault` API, so Obsidian is not even told. The host arm has
forbidden exactly this since WP109; the guest arm never has, in the role where the editor owns the
disk copy just as much.

### B2. The fix, in WP109's shape and with WP109's blind spot closed

| # | file | change |
|---|---|---|
| **F5** | **`files/single-writer.ts`** (new, pure) | `SINGLE_WRITER_ARMS`, `noteSingleWriterDecline(arm, path, logger)` counting **first**, `getSingleWriterDeclines()`, and one fixed spelling: `SINGLE-WRITER DECLINE: arm=… path=… reason=…`. |
| **F6** | `files/background-sync.ts` | `subscribe()`'s guest arm gains an **explicit branch** — `if (remoteContent !== localContent && path === this.activeFile)` — that declines and counts. |
| **F7** | `files/background-sync.ts` | The **host** arm's empty `else if (isActive) {}` now calls the same recorder. WP109's branch was a thing a test can point at and a thing **no observer can distinguish from "never reached"**; both readings were `{}` . This is a fix to its blind spot, not to its logic. |
| **F8** | `main.ts`, `testing/e2e-control.ts` | `getSingleWriterDeclines()` and `sync.singleWriterDeclines`. |

**Placement is the whole of S134's lesson and it is asserted, not assumed.** The invariant is about
the **disk**, so the branch stands immediately in front of the write and nowhere earlier:
`awaitSeed`, `noteIfNonEmpty` (S119's tombstone evidence) and the local read all still run for the
active file, because none of them writes. Row **B2** asserts `observedNonEmpty.has(path)` after a
declined subscribe; break row **W7** reproduces S134's mistake in this role by moving the guard to
the top of the arm and reddens B1, B4 and B7.

**`collabBoundFile` is deliberately NOT part of the condition** — see "what I rejected".

### B3. Convergence — the risk this fix creates, and the one line that decides it

Guests do not seed. A guest that declines a write and has nothing else write it would keep a
divergent file for ever.

**`lastWrittenContent` must not be set in the decline branch.** `writeToDisk`'s first line is
`if (this.lastWrittenContent.get(path) === content) return;`, so recording the remote content as
"already written" would short-circuit the catch-up flush permanently. Row **B3** measures the
catch-up (the user switches away → `setActiveFile` flushes doc → disk → the file converges, and the
`adapter.write` appears *then*); break row **W6** plants exactly that one line and reddens B3 and B7.
That row is the reason this section is a measurement rather than an argument.

The invariant is also **scoped, not a blanket refusal**: row **B4** shows the same `startAll` pass
declining the open file and writing the unopened one.

### B4. Under the clamp

Nothing this package added is timer-scheduled in a load-bearing way — the decline branch consults no
timer and the catch-up write is immediate. Row **B7** runs the decline **and** the catch-up under
`support/timer-clamp.ts` at `floorMs: 1200, growthPerFireMs: 200, jitterMs: 20`, scoped to
`background-sync.ts`, and both are unchanged.

**The instrument is proved live on this exact file before anything is read from it** (S65/S113/S133):
`doWriteToDisk`'s settle window is a `background-sync.ts` timer, and under the clamp it is still open
long after the unclamped 250 ms would have closed it — `isRecentDiskWrite(NOTE)` reads **`true`**
where the unclamped control reads **`false`**. That is the clamp changing an observable outcome on
this path in this run, plus `assertClamped(1, /background-sync\.ts/)` and `maxAppliedMs ≥ 1200`.

---

## What I rejected, and why

- **Hardening the consumer's evidence test.** Explicitly forbidden by the charter and independently
  wrong: it is S126's exact shape, and it would make a legitimate emptying unsyncable. Row P1 pins
  the consumer's behaviour as correct instead.
- **A general "the attestation must equal the file" rule.** Refuses legitimate publications whose
  disk write is still queued. §A3.
- **Fixing `setActiveFile` alone.** That is what WP109 did to the previous producer, and the signal
  stayed open for the stated reason. The floor is at the funnel.
- **Including `collabBoundFile` in the guest guard.** The host arm expresses this invariant on
  `activeFile` alone; widening one arm and not the other would create a new asymmetry, and
  `collabBoundFile` is the racy value (`getCollabBoundFile` exists precisely so a failed bind can
  clear it), so a stale one would create a convergence hole of its own. Widening **both** arms is a
  separate decision — residual 3.
- **Making `preserveLocalVersion` run on the declined path.** A decline destroys nothing, so a copy
  would be litter — S125 AC6's ordering rule, applied to the third arm.
- **Editing another package's tests.** None were touched. `background-sync.test.ts`,
  `manifest.test.ts`, the S119/S125/S126/S134/S148/S151 files all pass unmodified, and four of them
  are in the break table precisely so a silent re-opening would have shown up.

---

## Residuals — everything I left

1. **The publish floor governs EMPTINESS only.** An attestation of the *wrong non-empty content* is
   still published unchallenged. The deeper property is that **the publication is unconditional while
   the write that would make it true is conditional**: `setActiveFile` issues `void writeToDisk(...)`
   — which can be refused by the empty floor, yielded by the `remoteSeq` staleness gate, or skipped
   by `lastWrittenContent` — and then publishes regardless, without ever learning which happened.
   Making the publication depend on the write's outcome is a real change to `writeQueue`'s contract
   and is not this package's.
2. **`ATTESTATION REFUSED` and `SINGLE-WRITER DECLINE` are new and have never been seen live.** The
   next live round should grep for both beside `EMPTY WRITE REFUSED` and `CONFLICT COPY SKIPPED`.
   `sync.attestationDecisions` and `sync.singleWriterDeclines` are on the e2e surface for it.
3. **`subscribe()`'s HOST arm still has no `collabBoundFile` guard either**, and neither arm covers
   the activation race window that the `Y.Text` observer *does* gate on. Both arms behave
   identically, which is the state I am leaving deliberately; whether the invariant should be
   expressed on `activeFile || collabBoundFile` everywhere is one decision, not two.
4. **`addFolder` and `setCanvasGuid` publish a `hash: ""` that is not a content claim**, and nothing
   in `FileEntry` says so. They are kept away from the text writer by `entry.directory` and
   `skipsAutoTextSync` — positional safety, not stated safety. A `FileEntry` that distinguished
   "hash of content" from "no content claim" would remove the class; §A4 item 4 is the same field
   read from the other end.
5. **A4 items 1–6 are NOT fixed** (the charter's instruction). Item 3 — hash equality as file
   identity in the rename pairer, with empty files as the degenerate case — is the one I would
   charter next; item 6 is a rig-correctness statement that deserves its own signal.
6. **`syncFromManifest`'s two traceless give-ups are still traceless** (WP115's residuals 1 and 2):
   a rejected `waitForSync` and a `null` `getDoc` both `continue` with no counter and no log. S141's
   producer is reachable through exactly that family of early return — row A2 drives one of them
   (`cancelSubscribe`) — so the silence and this defect share a cause.
7. **Not seen live.** Nothing in this package has run on the rig. The rig stays on build
   `1ddad2155341adbd`; nothing was rebuilt, deployed, or written into any of the three vaults.
8. **`S153` did not fire.** WP92's `no_collateral` stayed green on the full uncommitted run; noted
   because the charter predicted it might.

---

**Files changed:** `plugin/src/files/attestation-guard.ts` (new),
`plugin/src/files/single-writer.ts` (new), `plugin/src/files/manifest.ts`,
`plugin/src/files/background-sync.ts`, `plugin/src/main.ts`, `plugin/src/testing/e2e-control.ts`,
`plugin/src/__tests__/v2/wp112/{test_s141_…, test_s142_…}` (new),
`workflowArtifacts/canvas-v2/wp112_break_table.py` (new),
`workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md` (S141 and S142 status only), this report.
