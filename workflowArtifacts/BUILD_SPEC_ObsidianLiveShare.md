# BUILD SPEC — Obsidian Live Share

> **Status:** authoritative current-state specification
> **As-of:** 2026-08-07, branch `fix-bugs-and-raceconditions`, settled committed feature baseline through WP95
> **Authority rule:** this file is the single source of truth for intended behaviour, implemented feature level, release gates, and open product risks. `workflowArtifacts/canvas-v2/DISPATCHER_STATE.md`, `SIGNAL_REGISTER.md`, task charters, implementation reports, validation reports, development reports, `CONCEPT_V2.md`, and `BUILD_SPEC_CanvasV2.md` remain evidence and historical working documents. They do not override this file.
> **Active-investigation boundary:** S104–S113 are recorded in Section 1.1 as active-work notes. Their entries preserve the current investigation subjects but do not alter the settled feature, risk, or release verdicts elsewhere in this specification until the active batches finish.

## 1. Evidence and verdict policy

A statement is marked **implemented** only when the current tree contains the implementation and the associated test evidence is green. A statement is marked **live-verified** only when it was exercised through the two real Obsidian instances and the real relay or a deliberately local relay named by the test. Headless evidence alone is not described as live proof.

The accepted verdict vocabulary is:

- **Implemented:** present in the current code and covered by passing automated checks.
- **Live-verified:** demonstrated through the real product path.
- **Partial:** some acceptance criteria are met, but named criteria remain unmeasured or failed.
- **Open:** reproduced or statically established and not closed.
- **Deferred:** intentionally outside the current release decision.
- **Withdrawn:** the alleged product defect was falsified; no product fix is required for that claim.
- **Unverified:** plausible or argued, but not accepted as a fact.

Historical suite totals are evidence only for the exact clean commit on which they were measured. The latest fully bracketed clean-tree gate recorded for WP95 was **2792/2792 tests in 387/387 files, TypeScript clean, zero failures**, at commit `baa9aa0`. Later packages reported their own green gates, including B60 at **2805/2805 in 389/389 files**, but the present working tree contains unrelated uncommitted UI changes and therefore has no new authoritative whole-tree figure in this document.

### 1.1 Active work sidebar — S104–S113

> **Provisional by design.** This table records what the active bug-fix work is investigating. It is not a second status register, does not promote a provisional mechanism to fact, and does not change the release blockers in Section 13. When a batch settles, its reproduced and qualified verdict must be promoted into the applicable normative section and this sidebar entry retired or rewritten as historical context.

| Signal | Active-work note |
|---|---|
| **S104** | Logger wiring order: `FileOpsManager` received `this.logger` before the logger was constructed, leaving optional logger calls silent. Active work is verifying the production `onload()` wiring and the real sink rather than a manually wired test double. |
| **S105** | **Withdrawn product hypothesis:** ordinary inbound rename was injected with the wrong operation shape. The declared `{oldPath, newPath}` shape applies. Follow-up belongs to the instrument, not the rename implementation. |
| **S106** | Field relevance of WP93's lazy mute release: live observations showed the event-driven release rarely deciding before the ceiling. Active work is separating an implemented headless mechanism from its actual live contribution. |
| **S107** | Guest-held, pre-existing canvas participation: a guest edit was observed not reaching the host and later disappearing from disk. Data loss is reproduced; active work must establish the mechanism without inferring it from adjacency. |
| **S108** | **Burned signal number:** the alleged collision artefact was the owner's own file, not a product defect. It remains recorded so the withdrawn attribution and operator error cannot be silently reused or forgotten. |
| **S109** | Rename diagnostics could not name rename endpoints because they looked only for `path`; the outer catch also swallowed before a downstream catch could report. Diagnostic repair is recorded separately from functional rename behaviour. |
| **S110** | The debug file sink depends on `debugLogging`; live absence claims must first establish that the setting and sink are active. This is an evidence precondition, not by itself a product-functionality verdict. |
| **S111** | Harness wiring can hide production wiring-order defects: tests that call `setLogger` directly do not prove `onload()` constructs and attaches dependencies in the correct order. Active work is using the real lifecycle seam. |
| **S112** | The E2E file-operation endpoint reader accepts fields the production operation type ignores. A malformed rename therefore looked valid to the instrument and manufactured S105. Active work is tightening the instrument to the declared discriminated operation types. |
| **S113** | A bounded log poll ended before the measured renderer/flush clamp. Later lines existed on disk, so the in-arm silence was not evidence. Active work must use a proven watermark/flush horizon and positive control before interpreting absence. |

## 2. Product purpose and supported deployment

Obsidian Live Share is a self-hosted Obsidian plugin and relay for real-time collaboration on Markdown files, canvases, file operations, presence, and session state.

The supported deployment is the NeuralAngels-hosted relay at `liveshare.neuralangels.de` with this access model:

- The credential landing page is protected by NeuralAngels Access.
- Obsidian connects directly to the WebSocket relay because Electron does not carry the browser SSO cookie.
- The relay authenticates the connection with the Live Share server password.
- Session payloads can use AES-GCM-256 with a PBKDF2-derived key carried by the session invite.
- The relay does not parse encrypted room payloads.
- The deployment is a trusted-share collaboration model, not Byzantine-peer protection.

The shared server password is a deployment credential, not a per-user authorization token. Credential values, vault `data.json` contents, encryption material, and tokens must never be printed, logged, copied into fixtures, or passed through an agent tool.

## 3. Product invariants

These invariants govern every implementation and test. A later work package may strengthen them but must not weaken them silently.

### I1 — One semantic owner per surface

- An open Markdown editor owns its active text surface.
- Canvas synchronization uses an explicit surface state, adapter lifecycle, and writer lifecycle.
- A remote apply must not overwrite an actively edited canvas record.
- A deferred apply must have a bounded, observable drain path.

### I2 — Convergence is necessary but not sufficient

Equal replicas are not proof if both replicas converged after deleting valid user intent. Tests must distinguish convergence, preservation, and authorization.

### I3 — Absence is not destructive authorization

Missing manifest entries, partial reads, rejected records, missing receipts, and stale views do not by themselves license deletion. A destructive transition requires explicit completeness evidence plus an applicable receipt or tombstone rule.

### I4 — Canonical serialization is deterministic

The `.canvas` file is a deterministic projection of the Yjs document. Replica-local protection may withhold a write, but must not make two replicas serialize the same document to different bytes.

### I5 — Fail closed without fabricating truth

Malformed, incomplete, or untrusted input is quarantined, refused, or withheld with an observable reason. The system must not translate uncertainty into deletion, reseeding, or silent success.

### I6 — Ephemeral state is not durable truth

Presence, cursor location, current editor state, and advisory interaction state use awareness or live adapter state. Document identity, sidecar history, tombstones, durable refusal state, and persisted canvas content use explicit durable stores.

### I7 — Receipts answer one question each

Whether values match, whether this pass delivered a record, whether a surface accepted it, and whether deletion is licensed are separate facts. One enum or boolean must not silently stand for all of them.

### I8 — The relay remains content-blind

Canvas V2 and relay checkpoint persistence may store or forward opaque frames. They must not require the relay to understand canvas records or decrypt session content.

## 4. Runtime topology

```text
Obsidian plugin A                         Obsidian plugin B
├── Markdown/editor binding              ├── Markdown/editor binding
├── Canvas capture/reconcile             ├── Canvas capture/reconcile
├── File operations + manifest           ├── File operations + manifest
├── Presence/awareness                    ├── Presence/awareness
└── Session + offline/link state          └── Session + offline/link state
             │                                         │
             ├── MUX WebSocket: Yjs sync + awareness ──┤
             └── CONTROL WebSocket: file ops/session ──┘
                               │
                         Live Share relay
```

The MUX and CONTROL links are independent. User-facing online state must be derived from measured link state, not from a historical connection latch. A connection failure must stop transmission and remain recoverable without deleting the room identity or clearing valid credentials.

## 5. Current document and storage model

### Markdown

- Each shared text document uses a Yjs `Y.Text` named `content`.
- CodeMirror collaboration owns the active-editor path.
- Background synchronization owns unopened text files.
- The single-writer and active-file guards from the first reliability round remain mandatory.

### Canvas CRDT V2

- A canvas is represented as per-record Yjs maps rather than as one whole JSON string.
- Node position and size fields are atomic registers.
- Edge endpoints are atomic registers.
- Ordering uses fractional `ord` values.
- Deletions use tombstones rather than omission alone.
- `meta.schemaVersion = 2` is document metadata and is not emitted into the user-facing `.canvas` file.
- Node text and edge labels use `Y.Text` internally and serialize explicitly to strings.
- Ingest validation quarantines or refuses invalid records before they can become document truth.
- Canonical serialization omits internal metadata and is deterministic across replicas.

### Surface Shadow

The Surface Shadow is the last known state accepted by the local surface, not merely the last disk file and not merely the current CRDT projection. Local intent is derived by comparing the observed surface/file state with this shadow. Shadow advancement requires the corresponding receipt; it must not advance past an apply the surface did not take.

### Sidecar, identity, and epoch

- Canvas CRDT history is stored under the local sidecar directory.
- Canvas identity uses a GUID rather than a path alone.
- Epoch rules prevent an older file or stale identity from silently becoming current truth.
- Rename handling follows GUID-backed sidecar and manifest identity.
- Explicit import is a user command and is not conflated with ordinary synchronization.
- Sidecar and durable safety stores are local-only and must never be shared or remotely writable.

### Durable seed-refusal protection

- A record refused during ingest cannot be projected away merely because a later session starts.
- The protection is durable, local-only, and keyed by document identity rather than by a host-specific path.
- Repair or re-seed may lift a refusal only through the specified validated path.
- Store writes have an awaitable idle boundary where durability is required.
- The version field of the refusal store is currently not enforced; this remains open as S103.

## 6. Implemented feature level

### Core collaboration — implemented

- Host and guest sessions, invites, permissions, room lifecycle, encrypted sessions, presence, user colors, file sharing, exclusions, rename/delete/create operations, binary transfer, and offline queuing.
- Markdown real-time collaboration through Yjs and CodeMirror.
- Canvas presence overlay, cursor position, peer identity, card interaction visibility, and canvas subscription.
- One-shot production and E2E builds, including `npm run build:e2e`.
- Per-vault E2E control ports and distinct vault identities.

### Canvas V2 foundations — implemented

- P0 shadow intent diff and canonical serialization, WP1–WP6.
- P1 schema V2, registers, tombstones, ingest validation, quarantine, and convergence tooling, WP8–WP23.
- P2 sidecar lifecycle, GUID identity, epoch handling, explicit import, and exclusion, WP24–WP30.
- P4 `Y.Text`, editing-aware deferral/blur merge, and UndoManager work, WP36–WP38.
- P6 relay blob/checkpoint persistence, WP41–WP42.
- Real-Obsidian rig infrastructure, WP43–WP49.

WP7 is a mandatory end-to-end gate and is not treated as complete merely because the P0 implementation exists.

### Reliability and data-loss repairs — implemented

- Host/guest role application and manifest publication were repaired after the live data-loss chain.
- Manifest cleanup now requires completeness evidence; an absent or partial manifest is not a delete instruction.
- Pre-existing shared canvases are materialized to a joining guest; live verification changed the measured result from 0/3 to 3/3.
- Raw shared-canvas content cannot bypass the Canvas V2 synchronization path.
- Canvas writer attachment and mirror decisions were separated from subscription so a subscription does not destroy or overwrite an existing file.
- Editing-aware view reconciliation protects a live inline editor from remote structural apply and blur-commit replacement.
- Session link exhaustion no longer destroys room identity as the normal recovery action.
- Canvas capture mute windows have bounded and observable release paths, including `MUTE OVERRUN:` counters.
- Whole-file deletion capture now requires completeness plus surface-matched receipt authorization.
- Failed or silent structural applies no longer wholesale-revoke the standing delete-license set.
- Apply receipts distinguish value outcome from delivery by the current pass.
- Protected-path admission covers `.obsidian/**` for all derived inbound file-operation arms. This is defence in depth under the owner's trusted-peer risk decision.
- Seed-refusal durability follows document identity across rename and has an explicit idle/durability boundary.

### Live-verified behaviours

The following verdicts have direct live evidence and may be relied on at the stated boundary:

- Canvas presence and card-touch visibility work when both peers are subscribed to the same canvas.
- A pre-session canvas reaches the guest after WP79.
- The original hostless/partial-manifest deletion chain is closed by the role and manifest-purge repairs.
- WP37 closes the reported dropped-keystroke symptom at the live view-reconciliation seam.
- WP91's capture path was live-verified, including a non-vacuous positive control.
- Durable seed refusal survived the live restart scenario after WP90/WP92; S81 is closed.
- WP94's delete arm passed live validation.
- Ordinary inbound rename works when the declared `{oldPath, newPath}` operation shape is used.

## 7. Incomplete planned features and gates

The following are not presented as implemented or release-verified:

| Area | Work packages | Current verdict |
|---|---|---|
| Room-mode consensus and receive-and-persist | WP31–WP35 | Open / not implemented as a complete phase |
| Operation capture promoted to primary source | WP39–WP40, WP52–WP54 | Open / not implemented as a complete phase |
| Real-host matrix and stale-view release gate | WP50, WP51, WP7 | Gate not completed |
| Gate correctness chain | WP74, WP75, WP76, WP71 | Still required before WP7 can be accepted |
| External-write premise cleanup and live drag row | WP89 | Partial: static premise/route work landed; live AC1/AC4 remain unmeasured |

The release gate must exercise the real capture path. With `useCanvasBinding = false`, that path is a real `.canvas` file write observed by `vault.on("modify")` and handled by `handleLocalModify`. Direct mutation through `canvas.simulateEdit` changes the Yjs document and is not evidence that capture works.

The matrix must prove all of the following before WP7 can pass:

- Both real Obsidian instances are distinct and identify different vaults.
- Both instances loaded the intended instrumented build.
- Both instances subscribed to and opened the intended canvas through their own workspace.
- Every gesture reports whether it was applied and which production path it exercised.
- Quiescence is an observed result on both peers; a timeout is inconclusive, not convergence.
- The local relay and rig-owned shared folder are provisioned safely and restored byte-exactly.
- No scenario inherits records from a previous run; the suite is idempotent or creates unique isolated state.

### Guest canvas creation — REQUIRED, owner decision 2026-08-07

**A guest must be able to create or import a `.canvas` in the shared folder and have it become real for
every peer.** The owner has ruled this a required capability, not an optional one: *"this is a big
limitation if it doesn't work."*

**Current behaviour (`S122`, open):** a guest-created `.canvas` reaches **nobody** and enters **no client's
manifest, including its own.** Three doors close at once and none of them is individually wrong:

| Door | Refusal | Deliberate |
|---|---|---|
| manifest write | **at the CALL SITES in `vault-events.ts`, not in `updateFile`** | yes — the host is the only manifest writer, **but see the correction below** |
| content push | `skipsAutoTextSync` | yes — WP83; raw character-merge corrupts a canvas |
| **guid mint** | `role !== "host" → null` | **this is the owner of the hole** |

**⚠ CORRECTION (WP117, 2026-08-08), measured and pinned.** This table previously said the manifest door is `updateFile`'s own `role === "host"` test. **`ManifestManager.updateFile` has no role test at all** — it checks only `this.manifest` and `isSharedPath`. A guest's `updateFile`, called directly, lands the entry; that was measured, not reasoned about. **The invariant still holds** because no guest *calls* it — the gate is one layer further out, at the call sites. **This matters for anyone adding a new caller**, and host-mediated creation adds exactly one (on the host). A test now pins the correction so it cannot go stale.

Without a guid the guest opens no canvas document at all, so its canvas has no CRDT identity, no manifest
entry, and the mirror pass cannot see the path.

#### The sanctioned design — host-mediated creation

The guest sends the **whole canvas** to the host over the control channel with a request to materialise it;
the host validates, creates it in the shared space, mints the guid, and seeds the document.

**This preserves canvas seed authority rather than changing it, and that is the reason it is the sanctioned
design.** An earlier content-free variant (announce the path, let the originating guest seed from its own
file) was declined twice on the grounds that it moves seed authority to guests — which interacts badly with
the open residual below. Under host-mediated creation the host remains the **sole seeder**, so:

- **WP83 holds** — the handoff is a one-shot structured transfer over the control channel, never the
  character-merge text path. A `.canvas` is still never synced as raw text.
- **Host-only manifest authority holds** — the host still mints and still writes the manifest.
- **The single-writer rule holds** — exactly one peer seeds, and it is the same peer that always did.

Requirements on the implementation:

1. The host validates the request before acting: `isPathSafe`, `isSharedPath`, `isProtectedPath`, and a size
   bound. A guest naming a path outside the share, or inside `.obsidian/`/`.git/`, is refused.
2. **A refusal must reach the guest and be visible to the user.** A silently dropped creation is `S114`'s
   shape — the user made a canvas, nothing happened, and nothing said why.
3. Large canvases must not be assumed small. The existing binary transfer chunks to 50 MB; the shared boards
   in this project's own test vault reach 45 KB, and an imported canvas can be far larger.
4. The originating guest must converge onto the host's document rather than keeping a private one. Its local
   file already exists, so the mirror's `SKIP_LOCAL_FILE` verdict is wrong for this case and must be
   replaced by an adopt path.
5. Import is explicitly in scope — the owner named *"new or imported"* canvases together.

### Full convergence is PRIORITY 1 - owner decision 2026-08-08

**Every peer's file must always be fully in sync. This outranks everything else in this document.**

The owner's words: *"the files should always be fully in sync, that's prio 1. Of course the host's file
should change when the guest edits it. Only if the guest and host edit the file at the same time at the
same place, the host might be preferred in some way."*

Three consequences, and they are requirements, not preferences:

1. **A guest's edit MUST reach the host's file.** A rule that leaves a host's copy untouched while peers
   move on is wrong by this ruling, whatever its original justification. `WP79`'s *"a host's file is never
   rewritten by a pass"* must be re-examined against it rather than cited as settled.
2. **Host preference is scoped to true conflict only** - the same file, the same place, at the same time.
   It is a tie-break, **not** a general precedence, and it may not be used to justify divergence in the
   ordinary case.
3. **Divergence is never acceptable as a steady state**, including divergence that is *"only"*
   serialisation. Two stable byte forms of one logical canvas (`S150`) is a defect under this ruling even
   if every record matches, because nothing downstream can tell that case apart from a real one.

**Sequencing, also the owner's:** prove functionality first, then build large-canvas support
(`S167` chunking) as the **last** step, then sweep the remaining small items into a **known-issues
catalogue** rather than fixing them one at a time.

#### Open residual that must be closed with it

`canvas-sync.ts` computes `peerKnowsDoc` as *"did bytes arrive across the await"*, which under `NO_PEERS`
(see `S131`) is `false`, and `decideSeed` can then return `SEED_FROM_FILE`. **Blast radius:** a guest holding
a *stale* local canvas that wins the subscribe race seeds its stale content into the shared document; the
host's later subscribe sees a non-empty document, `doc-wins`, and **the host's canvas is overwritten.** Real
data loss, narrow reachability.

It is listed here rather than under §8 because the two decisions are the same decision: **if guests never
seed, this residual closes with it.** Implementing guest canvas creation as host-mediated is what makes the
residual closable rather than worse.

## 8. Open product and reliability risks

Only demonstrated or statically closed findings are listed as facts. Historical signals that were falsified are excluded or explicitly marked withdrawn.

### High impact

- **S76 — canonical path identity collision:** the Windows canonicalizer can map a real fullwidth-character filename and a Windows-illegal ASCII spelling onto one identity, while another platform keeps them distinct. This is an open wire-format and primary-key risk.
- **S92/S93 — refusal protection depends on reachable lifecycle/UI state:** record and restore paths were mutually exclusive in the measured shape, and protection of an existing file could depend on a host leaf/writer being attached. S81's specific durability verdict is closed, but these broader lifecycle risks remain open.

### Reliability and liveness

- **S71/S72:** renderer timers have shown approximately 60-second clamp gaps. Awareness and timer-based guarantees must not assume nominal scheduling. S72 remains an undiagnosed question because the existing inbound-message opportunity did not fire in the observed clamp window.
- **S89:** at least one additional mute-release timer is passed as an injected callback and was missed by name-based census work. Timer/capability inventories must follow types or runtime flow, not grep a function name.
- **S64:** a final hard-kill window may still lose the newest asynchronous local store write unless the owning lifecycle awaits its idle boundary.
- **S40 residue:** the offline queue has no general retention/cap policy; session teardown is no longer accepted as its accidental bound.

### Instrument and observability risks

- **S65:** debug-log flush lag can exceed short bounded polling windows. Absence from a log is not evidence until the sink, setting, watermark, flush horizon, and positive control are established.
- **S66:** a link-break command that auto-reconnects is not a valid negative control.
- **S67:** the committed plugin bundle and installed bundle may differ unless installation pins and verifies the expected hash.
- **S74/S85/S86/S87:** the legacy latency suite contains tests that can fail for unrelated scheduling, pass before their subject acts, enforce a second inconsistent bound, or test a helper used by no production subject. These rows must not support release claims until repaired or deprecated with a method-preserving replacement.
- **S88/S99/S100:** derived checks must read a pinned commit, not a moving `HEAD` or sibling-edited working tree, and must attribute by structure rather than prose tokens.
- **S97/S98:** source-text regex/comment stripping is not a parser and has produced false import/call inventories.

### Bounded or owner-accepted risk

- The owner explicitly accepts trusted collaborators and does not treat malicious-peer resistance as a release requirement. WP95's `.obsidian/**` protection remains implemented defence in depth.
- An absent encryption passphrase currently means the session is not encrypted rather than throwing. Normal session creation generates the passphrase; reachability of an unintended empty value has not been demonstrated and remains unverified.
- `readiness.RawAnswer.body` can render externally supplied bytes in diagnostics. It is not known to carry credentials in the current probe and is low severity.

### Latency-triggered defects — fixed in code, NOT reproducible on the project's own live rig

A family of four data-loss defects shares one cause (`S128`): `SyncManager.waitForSync` resolved on a
signal meaning *"the relay has nothing more to say right now"*, which six call sites read as *"the data has
arrived"*. `sync.ts` set `synced = true` whenever `peerCount === 0`, and for a **document id nobody has
subscribed yet that is the common case, not an edge case** — so the await returned instantly on an empty
document.

| Signal | What it destroyed | Status |
|---|---|---|
| `S119` | every `.md` in the share truncated to 0 bytes, once per manifest entry, on restart | fixed — empty-write floor on both write arms |
| `S123` | a new canvas never materialised on a peer, for the rest of the session | fixed — the mirror re-arms on an event, not a one-shot probe |
| `S126` | *(regression introduced by `S119`'s first fix)* a legitimate delete refused on any peer that had not opened the note | fixed — evidence is the document's tombstones, not this peer's session history |
| `S129` | opening a shared note could bind an empty `Y.Text` over the editor buffer and Obsidian would persist it | fixed — the bounded wait's expiry refuses instead of falling through to bind |

`waitForSync` now reports **why** it resolved (`PEER_STATE` / `NO_PEERS` / `ALREADY_SYNCED`) without changing
when it resolves.

#### The trigger, in closed form (`S131`)

Measured deterministically, 0/4 either side of the boundary, no flapping:

```text
NO_PEERS  ⟺  seederDelay > subscribeGap + readerDelay
```

**In plain terms: a peer on a slower link than yours loses the race to seed, and you are told the document
is new.** This is not a rare race. Any mixed-latency session — one peer on mobile, on a VPN, or on another
continent, the other on fibre — puts the faster peer on the wrong side of the cliff for **every** document
the slower peer seeds.

#### Why the live rig cannot reproduce it, and why that is not a matter of effort

**A symmetric latency knob cannot widen this window at all.** Delay applied equally to every client still
leaves the second peer reaching the relay `gap` after the first, however large the delay. Measured: the
symmetric sweep shut the window at a **10 ms** subscribe gap under **40 ms** of one-way delay.

The project's live rig runs **two or three Obsidian instances on one machine** against a remote relay. The
network delay is real, but it is **the same for every client** — which is precisely the configuration that
cannot produce the trigger. **The live setup has the same structural blind spot the test suite had**, for
the same reason, and adding more instances or more waiting does not change it. Reproduction requires two
peers at *genuinely different distances* from the relay.

This is recorded so nobody re-derives it: *"we did not test it live"* would be the wrong summary. **The
single-machine rig is not capable of it.**

#### If a user reports these symptoms — diagnostic steps

Symptoms that point at this family:

- a shared note opens **empty** on one peer while another peer sees it with content
- a note in the shared folder goes to **0 bytes**, and `.canvas` files in the same folder are untouched
- a newly created canvas **never appears** on one peer while appearing on another
- a deletion does not propagate to a peer that **did not have the note open**

Steps, in order:

1. **Ask which peer is on the slower connection.** The symptom lands on the *faster* peer, describing the
   *slower* peer's documents. Asymmetry, not absolute latency, is the variable.
2. **Enable Debug logging** (Settings → Live Share → Debug). The file is at `.obsidian/live-share-debug.md`
   — inside the config folder, **not** among the notes. "Debug log location" shows the resolved path, the
   lines written this session, and any write failure; an enabled sink that is failing looks exactly like an
   empty log.
3. **Read the refusal ledgers rather than inferring.** `emptyWriteRefusals` counts refused empty writes by
   arm; `conflictCopies` counts preserved local versions. A **non-zero** empty-write count on a peer showing
   stale content means the floors are working and the document genuinely never arrived — that is `S128`'s
   trigger, not a new defect.
4. **Check `LOG SINK:` and `MUTE OVERRUN:` lines.** The latter (`S120`) is an unrelated defect with a
   similar presentation: a file op issued within ~1 s of that file arriving from a peer is dropped silently
   and permanently, with no retry and no self-healing.
5. **Reproducing it requires asymmetric latency.** Two machines on genuinely different links, or a traffic
   shaper on one of them. `plugin/src/__tests__/wp5/` contains a per-socket asymmetric latency harness and a
   cold-arrival scenario that produce the condition deterministically; that is the cheaper route.

#### Validation status, stated exactly

- **Demonstrated in the harness**, through a real subscribe race against a live in-process relay driven to
  the far side of the `S131` cliff, with a control that binds normally when the seeder is on the near side.
- **Argued, not demonstrated:** `yCollab`'s own reconciliation of a CodeMirror document against an empty
  `Y.Text`. What is pinned is whether the binding is reached.
- **Not validated in a real Obsidian setup**, for the structural reason above. `S119`'s *pre-fix* behaviour
  was observed live (18 zero-byte files, 14 of them inside 75 ms); the *fixes* have not been.

## 9. File-operation contract

All inbound and outbound file operations must use the declared discriminated operation shape. A rename is `{type, oldPath, newPath}` and has no generic destination `path` field.

Every inbound arm must apply these checks before any vault call:

- Path normalization and containment.
- Shared-surface membership.
- Protected-path rejection for all of `.obsidian/**`.
- Sidecar/local-state exclusion.
- Permission and role rules.
- Operation-specific source/destination checks.

A refusal must be observable without exposing file contents or secrets. A caught exception must name the applicable endpoint(s); `unknown` is not acceptable where the operation type provides `oldPath` and `newPath`.

## 10. Canvas capture and reconcile contract

### Local capture

1. Observe the local surface or file state.
2. Parse with an explicit completeness result; parse failure must not become an empty canvas.
3. Compare against the Surface Shadow to derive user intent.
4. Validate and quarantine/refuse invalid records.
5. Apply authorized creates, updates, and deletions in one Yjs transaction where atomicity is required.
6. Advance the shadow only from a matching receipt.
7. Persist through the single writer, respecting durable withholds and mute/echo boundaries.

### Remote reconcile

1. Build a field-level plan from document state and the current surface.
2. Apply geometry without rebuilding unrelated live editor state.
3. Defer structural apply for the record being edited and drain it on blur, view close, or teardown.
4. Keep other records live where safe.
5. Emit a receipt that separates outcome, delivery, and handover.
6. Advance delete authorization only for records actually handed to the applicable surface.
7. Write the canonical projection without feeding projection-only omissions back as user intent.

### Delete criterion

For a record `X`, deletion is allowed only when all required terms are true:

`Delete(X) ⇔ Receipt(X, surface) ∧ Complete(save) ∧ Present(X) ∧ ¬Seen(X, save)`

Absence selects among records already authorized by a surface receipt; absence does not create the authorization.

## 11. Presence, awareness, and canvas interaction

- Text and canvas presence are awareness state, not persisted document content.
- Heartbeats send full local awareness state often enough to remain below the nominal stale-prune horizon, while correctness must also tolerate host timer clamps.
- Reconnect uses one stable client identity and does not create ghost presence.
- Canvas overlays are mounted independently of `useCanvasBinding`; the flag gates binding/follower behaviour, not cursor visibility.
- Presence success requires both peers to subscribe to the same canvas. A visible cursor test that never established shared subscription is vacuous.
- Real-time co-typing inside one canvas card is not promised as a server-enforced lock protocol. Current correctness comes from `Y.Text`, editing-aware deferral, blur merge, and explicit reconcile rules.

## 12. Session and connection behaviour

- CONTROL and MUX health are measured separately and combined into an explicit sharing/link state.
- A stale historical latch must not report a disconnected client as connected.
- Exhausting a retry chain must stop or seal new transmission, announce the state once, preserve valid room identity and credentials, and offer recovery.
- A transient network outage must not call destructive room/session teardown as its automatic recovery path.
- Host election/role assignment is authoritative from the server response and must be applied on join/rejoin.
- Manifest publication and guest cleanup require a live, valid authority path and completeness evidence.

## 13. Build, test, and release gates

### Commands

- Plugin typecheck/build: `cd plugin && npm run build`
- Instrumented one-shot build: `cd plugin && npm run build:e2e`
- Plugin tests: `cd plugin && npm test`
- Plugin lint: `cd plugin && npm run lint`
- Server build/tests: run the scripts declared by `server/package.json`
- Signal register: `python workflowArtifacts/canvas-v2/check_signal_register.py`

### Evidence requirements

- Every acceptance criterion must name its observable and its vacuity risk.
- For every criterion, plant the protected regression, show the relevant check red, restore byte-identically, and show it green.
- A planted break that reddens nothing is a finding and must be explained.
- Demonstrated and argued conclusions must be reported separately.
- Every quoted figure must be re-run after the change it covers, on a tree bracketed by identical `git status` output.
- A test result from a tree being edited by a sibling is void unless the subject is pinned to an explicit commit.
- A measurement that lost its positive control is not a result.
- **Latency applied equally to every client is not a latency test.** It cannot widen the first-arrival
  window (`S131`), which is where the `S128` family lives. Asymmetric per-peer delay is required, and a
  green run under symmetric delay must not be quoted as covering it.
- Live suites that share the same two Obsidian instances must run serially.

### Release blockers

Release is blocked while any of these remain true:

- WP7's real-host gate has not passed with the gate-correctness chain in Section 7.
- A current build can translate incomplete manifest/read/refusal state into destructive deletion.
- The installed bundle cannot be proven to be the intended build.
- A test or E2E instrument used for the release verdict cannot demonstrate that it fails when its subject is broken.

Owner-accepted malicious-peer risk is not a release blocker, but protected-path defence must not regress.

## 14. Work-package disposition summary

This is the current normative status summary. Detailed task charters and reports are supporting evidence, not competing specifications.

| Group | Verdict |
|---|---|
| WP1–WP6 | Implemented Canvas V2 P0; WP7 live gate still owed |
| WP8–WP23 | Implemented P1 data model and integrity foundation |
| WP24–WP30 | Implemented P2 sidecar/GUID/epoch/import foundation |
| WP31–WP35 | Open P3 |
| WP36–WP38 | Implemented P4; principal editing-loss symptom live-verified closed |
| WP39–WP40, WP52–WP54 | Open P5 |
| WP41–WP42 | Implemented P6 source-level relay persistence |
| WP43–WP49 | Implemented real-Obsidian rig infrastructure |
| WP50, WP51, WP71, WP74–WP76, WP7 | Required gate chain not complete |
| WP69, WP70, WP72, WP73, WP77–WP83, WP85–WP88 | Implemented supporting and reliability packages; WP84 withdrawn and never reused |
| WP89 | Partial |
| WP90–WP95 | Implemented; the broader residual signals in Section 8 remain open where stated |

No work-package number, suite count, signal number, or status may be changed here from a task report alone. The verdict must be reproduced against the current code or backed by an already accepted Dispatcher verification with its qualification preserved.

## 15. Non-goals

- No Yjs replacement.
- No Byzantine-peer or hostile-collaborator protocol.
- No server-side understanding of canvas records.
- No claim that awareness/presence is durable.
- No claim that headless convergence proves live-editor intent preservation.
- No deployment-stack change as part of Canvas V2 source work.
- No silent amendment of inherited acceptance criteria to fit current code.
- No deletion or rewriting of the historical working documents; they remain the audit trail for how this specification was reached.

## 16. Maintenance rule

Going forward, feature intent, current implementation status, accepted limitations, release blockers, and final verdicts are updated here first. Working papers may explore hypotheses and collect evidence, but they must link back to the relevant section here and must not introduce a competing current-state contract.

When evidence changes a verdict:

1. Reproduce or re-derive it against the current tree.
2. Preserve whether it is headless, live, argued, partial, or withdrawn.
3. Update this file and the supporting evidence record in the same change window.
4. Do not erase the superseded working-paper record.
