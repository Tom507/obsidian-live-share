# BUILD_SPEC — Canvas CRDT V2 (Obsidian Live Share)

> **Authoritative architecture document** for the canvas-V2 initiative.
> Source of truth for scope: `workflowArtifacts/CONCEPT_V2.md` (2026-07-31).
> Structural basis: `workflowArtifacts/RepoMap.md` (2026-07-31, FALLBACK mode) + `ARCHITECTURE.md`.
> Created by Worker 2 (Spec & Task Architect), Atomic Orchestrator, Standard mode.
> Artifact root for this initiative: `workflowArtifacts/canvas-v2/`.

<!-- Updated: T3 real two-instance Obsidian orchestration chartered (WP43–WP54); the Teil-14 live gate is no longer satisfiable only in principle 2026-08-01 -->
**Status:** SPEC_COMPLETE · **Work packages:** 54 (WP1–WP54) · **Phases:** P0–P6 + Teil-14 test rig (incl. **T3**, WP43–WP54)
**worker4_mode:** `full`

---

## 1. Project Overview

- **Project name:** Obsidian Live Share — Canvas CRDT V2
- **Target vision:** Replace the semantic layer of the canvas synchronisation so that the two reported symptoms ("nodes float away from their arrows", "reloading from offscreen shreds first one version then the other") become *structurally impossible* rather than *less frequent* — by fixing what counts as intent, what counts as an atomic conflict unit, and what counts as durable truth.
- **Primary user group / consumers:** Obsidian users collaborating on `.canvas` files through the self-hosted Live Share relay; secondarily the plugin's own maintainers, who inherit a system whose convergence is provable by fuzzing rather than asserted by example.
- **Non-goals:**
  - Not a rewrite. I1–I5, the ownership seam, the single-writer, the `planReconcile` core, the awareness liveness design and the minimal text diff all stay.
  - No CRDT library swap. **Yjs stays** (CONCEPT_V2 Teil 3 policy decision).
  - No change to the relay's trust architecture — the relay stays content-blind, including in P6.
  - No real-time co-typing inside one card (blur-merge is the accepted honest state).
  - Byzantine-peer resistance is explicitly out of scope.
- **UI language / locale:** Plugin UI strings follow the existing convention in the repo. New user-visible strings introduced by this initiative (degraded-view banner, import-confirmation dialog, conflict-copy notice) are **German**, matching CONCEPT_V2's own wording for those surfaces; log signatures stay uppercase ASCII (`LOCK REVERT:` style), which is a machine contract, not UI.

---

## 2. Scope and Deliverables

### Must-have (P0 — the project fails without these)

All six migration phases of CONCEPT_V2 Teil 13 **plus** the complete Teil 14 test strategy. Per explicit user instruction, **P6 is in scope for this run** even though the concept marks it optional, and nothing in CONCEPT_V2 is deferred.

| Phase | Content | Schema impact |
|---|---|---|
| **P0** | Shadow-based intent diff + canonical serialisation (W1, W9) | none — no format change |
| **P1** | Data model V2: atomic registers, `ord`, tombstone map, ingest schema, quarantine auditor (W2, W3, W7) | `meta.schemaVersion = 2` (doc only, **not** the `.canvas` file) |
| **P2** | Sidecar CRDT history + GUID/epoch doc identity + explicit import (W4, R4, R5, rename hole) | new sidecar files; doc-id namespace change |
| **P3** | Room-level mode consensus + Receive-and-Persist (W5, R6, R10 door) | manifest doc gains `path → {mode, guid}` |
| **P4** | `Y.Text` node text + blur merge + `Y.UndoManager` (W8) | node `text` / edge `label` become `Y.Text` |
| **P5** | Op-capture promoted to primary source (R1 contract renewed) | none |
| **P6** | Relay blob persistence (empty-room case) | new relay storage; wire-level checkpoint frame |
| **T** | Teil 14: convergence fuzzer, chaos suites with discrimination variants, E2E rig as mandatory gate | none |
| **T3** | <!-- Updated: added 2026-08-01 --> Real two-instance Obsidian orchestration — the host layer the Teil-14 gate needs to exist at all, plus the empirical `CAPTURE_TRIGGERS` verification the P5 promotion is gated on (§5 PHASE T3, WP43–WP54) | none |

### Should-have (P1)

- Compaction period, fuzzer iteration count and sidecar checkpoint interval exposed as tunables with documented defaults rather than hard-coded constants.
- The degraded-view banner is dismissible and does not obstruct canvas interaction.

### Nice-to-have (P2)

- A user-facing command to force a sidecar compaction (debugging aid).
- Fuzzer counter-example minimisation (shrinking) beyond "freeze the raw failing sequence as a named regression test".

### Explicitly out of scope

Each entry is either explicitly excluded by CONCEPT_V2 or is a documented residual risk in its Teil 15. **Nothing from Teil 13 or Teil 14 appears in this list.**

1. **Inline-editor binding to Obsidian's private text editor** (CONCEPT_V2 Teil 6.2, Teil 15.2). The concept itself files this as a stretch goal and specifies blur-merge as the shipped behaviour. Not specifiable as an acceptance criterion because it depends on a private API surface the concept states does not currently permit a binding.
2. **Byzantine / malicious peers** (Teil 15.3). The concept declares BFT-CRDTs the documented path *if* the trust assumption ever falls, not now.
3. **Intent preservation on concurrent writes to the same atomic register** (Teil 15.1). V2 deliberately promises honest LWW here; specifying anything stronger would contradict the design.
4. **Merging edits made to a `.canvas` file by a non-participant tool during a session** (Teil 15.5). I3 forbids treating the file as an input while owned; the concept marks this a documented boundary. The *detection* half (compare mtime/content before our own write → Notice) is also excluded this round: it is described in the concept as "erkennbar, aber nicht mergebar" without a mechanism, and inventing one would be spec-by-guess.
5. **CRDT library evaluation / swap** — settled in Teil 3.
6. **Relay deployment, redeploy, or any change to the hosting stack.** P6 changes relay *source*; shipping it to the box is a separate, later operation. `docker/.env`, NPM config, and the deploy pipeline are untouched.
7. **Server-side subsystems other than the P6 blob store** — rooms, permissions, auth, audit-log stay untouched.

---

## 3. System Architecture

- **Graph basis:** **FALLBACK — no Graphify graph exists for this project.** `graphify_enabled=false`; no `graphify-out/` exists anywhere in the tree and none was attempted. The structural basis for this spec is `workflowArtifacts/RepoMap.md` (regenerated 2026-07-31, containing `## V2 Touchpoint Inventory` with exact `file:line` seams, `## Build & Test Commands`, and `## Test File Inventory`) plus `ARCHITECTURE.md` (repo root, 82 KB, untracked). Every `file:line` anchor in this spec and in the TaskCharters is taken from that inventory. **TaskCharter section 3 "Structure references" is left empty by Worker 2 by design** — there is no graph to reference; Worker 3 fills it after implementation.
- **Frontend stack:** TypeScript, Obsidian plugin API (public part typed; the Canvas view is private and untyped — adapter-only access), bundled with esbuild → `plugin/main.js`.
- **Backend stack:** Node + express + `ws` + Yjs + `level` (the relay, `server/`). In scope only for WP41.
- **Data storage:** Yjs `Y.Doc` per canvas (the shared replica); the `.canvas` file on disk (a projection); **new in V2:** per-doc sidecar files under `.obsidian/liveshare/state/`; **new in P6:** a per-`roomId:docId` blob store in the relay's LevelDB.
- **External integrations:** the Live Share relay over `wss` (`/ws-mux/<room>` binary Yjs, `/control/<room>` JSON). Unchanged.
- **Runtime environment:** Obsidian Electron renderer, one process per participant; relay a single Node process.
- **Key subsystems:** capture (`canvas-sync.ts`), reconcile (`reconcile-plan.ts` + `main.ts:reconcileLiveCanvas`), persistence (`canvas-persistence.ts` — the single disk writer), view isolation (`canvas-adapter.ts`), presence/locks (`canvas-presence.ts`), transport/doc registry (`sync.ts`), ownership fan-out (`vault-events.ts`), flag-gated binding (`canvas-binding.ts` + `canvas-model-bridge.ts`).
- **Central nodes / critical paths:** the `.canvas` ownership seam (`vault-events.ts:224` modify fan-out → `canvasOwned` → `handleLocalModify`), the single-writer path (`canvas-persistence.ts:470 attachCanvasPersistence` with its `coldOpen`-after-`waitForSync`-before-`start()` ordering), and the diff-basis seam (`canvas-sync.ts:520` `lastWrittenContent` — the exact line V2 replaces).

### Key architecture decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **The diff basis becomes a field-granular Surface-Shadow, not the disk snapshot.** | CONCEPT_V2 Teil 5. Disk can be arbitrarily ahead of a stale open view; diffing against it turns every Obsidian save into a revert machine. This is the single highest-value change and is a pure function over three states, so it is fully headless-testable. |
| D2 | **Values that are only jointly valid become one register** (`pos`, `size`, `from`, `to`); independently editable aspects stay separate registers. | I8 / Teil 4. Kills torn writes (chimera positions, geometrically impossible edges) at the model level rather than behind an advisory lock. |
| D3 | **Deletion is a tombstone flag, never key absence.** | I7 / Teil 4. Makes "not observed" structurally distinct from "deleted", and makes delete-undo lossless because field containers are never destroyed. |
| D4 | **Order is modelled explicitly as a fractional-index `ord` register**, never written to the `.canvas` file. | W7 / Teil 10. Array order carries it on disk; `(ord, id)` gives a total order so every replica serialises byte-identically. |
| D5 | **A doc is seeded from a file exactly once in its lifetime; its update history is persistent in a sidecar.** | I9 / Teil 7. Two docs seeded from two snapshots are formally unrelated replicas — the two-writer defect on the time axis. |
| D6 | **The doc id becomes `__canvas__:<guid>`; the path becomes an attribute.** All in-memory registries (adapter, presence, persistence, mute) **stay keyed by canonical path.** | Teil 7. This resolves rename-mid-session and R5 structurally while preserving every path-keyed contract the previous rounds proved (see §3.1 S6). |
| D7 | **Sync mode per path is shared, host-authorised state; a client that cannot meet it degrades to Receive-and-Persist and never forks into another mode.** | I10 / Teil 8. Removes the split-brain class where two unrelated CRDTs write the same file from different machines. |
| D8 | **Locks become pure UX.** The data seam (`canWriteEntity`, baseline-hold on denial, edge endpoint double-check) is removed; the awareness liveness machinery is kept unchanged. | W6 / Teil 9. A correctness property that only holds while a UX mechanism works is unsolved. Once D2 lands, the data model resolves same-register conflicts by honest LWW. |
| D9 | **Serialisation is canonical and deterministic**, so the echo-breaker becomes byte equality. | Teil 10. Cheaper and sharper than semantic comparison, kills normalisation ping-pong, minimises vault git diffs. |
| D10 | **Validation happens at the doc's write boundary, and repair happens in the doc.** Local invalid records are rejected; remote invalid records are quarantined by tombstone (never destroyed), reversibly. | Teil 11. Rejecting remote deltas would create divergence; quarantine is idempotent and LWW-convergent, so several clients may run it concurrently. |
| D11 | **Zero new runtime dependencies.** Fractional indexing, the shadow, the validator and the fuzzer are implemented in-repo. | Workspace npm policy (7-day publish-age rule) plus the three prior specs' "no new production dependency" constraint. Yjs already supplies `Y.Text`, `Y.UndoManager` and awareness — the three things V2 actually needs. |
| D12 | **Pure cores are separated from wiring** wherever the codebase already uses that seam pattern (`planReconcile` is the precedent). Pure cores are specified and implemented first; wiring WPs follow and depend on them. | Makes every V2 mechanism headless-testable and keeps `main.ts` (which has no test file) free of logic. |
| D13 | <!-- Updated: T3 2026-08-01 --> **The mock-host rig and the real-Obsidian rig are two separate entrypoints.** `tools/launch_liveshare_e2e.py` stays the fast headless rig and is renamed in its documentation to say so; the T3 rig gets its own entrypoint and is the only one that can satisfy the Teil-14 gate. | Conflating them is exactly how the false-pass risk arose (Worker 3 refused WP7 on precisely this ground). The headless rig is genuinely valuable — fast, CI-able, no vault — so it is kept and demoted in status, not replaced. |
| D14 | **Per-vault control ports come from the plugin's persisted per-vault setting, never from a process environment variable.** | Obsidian is single-instance: opening a second vault yields a second renderer *window* inside the same process tree. `resolvePort()` reads `process.env.LIVESHARE_E2E` first, which would hand both plugin instances the same port. `data.json` lives inside the vault, so the hidden `e2eControlPort` setting is the only channel that can differ between A and B. |
| D15 | **The rig attaches to an already-open vault window and launches only what it did not find; it never terminates a process or window it did not itself start.** | The two target vaults are the owner's live working vaults and are normally already open. A rig that closes them to get a clean start destroys unsaved user state, which is a worse failure than not running. |
| D16 | **Every run operates on a freshly created, uniquely named scratch canvas in a rig-owned folder, and removes it on teardown. No pre-existing note is ever an input or an output of a run.** A vault fingerprint before and after the run is an acceptance criterion, not a diagnostic. | Real-Obsidian runs are slow, stateful and irreversible. Data safety on the owner's working vaults is a property of the design, not a matter of care at run time. |
| D17 | **Convergence on real Obsidian is asserted on the `.canvas` file bytes as well as on the shared doc.** | On the lightweight host the doc *is* the whole system. With real Obsidian the doc, the view and the file are three projections (§4.7) and only the file is the durable one `CanvasPersistence` produces. A doc-only oracle passes green while the file diverges — the exact class of defect this initiative exists to close. |
| D18 | **Trigger verification drives the interaction, never the signal, and reports any interaction it cannot drive faithfully as operator-required rather than approximating it.** | The signal is the thing under test. A probe that synthesises `setDragging(false)` proves that the harness can call a function, not that Obsidian calls it — it would restate the R2 assumption in a green test. Only driving the input layer and observing which patched signal fires is an empirical answer, and where that is not faithfully possible the honest form is an operator-performed gesture with the tap recording, not a synthetic stand-in. |

### 3.1 Prior decisions this spec supersedes

<!-- Updated: I7 removal of deletion-by-key-omission splits across phases — S4 narrowed to its P1 boundaries, S14 added for the P0 regression it creates 2026-07-31 -->

The three earlier BUILD_SPECs (`BUILD_SPEC_ObsidianLiveShare.md`, `canvas-integrity/BUILD_SPEC_CanvasIntegrity.md`, `canvas-redesign/BUILD_SPEC_CanvasBinding.md`) cover **earlier, different scopes**. They are **not edited by this initiative**. Where CONCEPT_V2 contradicts them, the contradiction is recorded here and resolved in favour of CONCEPT_V2, which is the newer design authority. Implementors must treat this table as binding: **an earlier AC that appears in this table is superseded and its failure is not an abort criterion for this initiative.** Every other AC in those specs remains in force.

| # | Prior decision (source) | V2 resolution |
|---|---|---|
| S1 | *"Per-property (per-key) LWW on canvas node maps — never whole-object overwrite"* (root spec §4) and per-key diff *"(keep)"* (§5). | **Superseded for composite values only.** V2 keeps per-key LWW as the mechanism; it changes the *granularity* of what a key is (I8). Independent aspects (`pos` vs `size`, `color` vs `text`) remain separate keys and still commute. |
| S2 | *"`GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported"* (canvas-integrity WP5 AC5, WP4 AC9). | **Retained with a narrowed meaning, not deleted.** `GEOMETRY_KEYS` stays exported with exactly those four members and continues to describe the **`.canvas` file schema** (serializer expansion, reconcile geometry classification, `RECONCILE_GEOMETRY_KEYS` drift guard). It stops being the *doc register* set. Any WP that would change its membership or remove its export must ESCALATE. |
| S3 | *"Reads/writes only `nodes`/`edges` map-of-maps; no other top-level keys"* (CanvasBinding WP1 AC2). | **Superseded.** V2 adds exactly two top-level containers: `meta` and `deleted` (Teil 4). No others. Mixed-version safety is handled by `meta.schemaVersion` (WP8), not by shape-freezing. |
| S4 | *"`writeRecordMinimal` … delete keys absent from `next`"*, required to match `applyKeyDiff` (CanvasBinding §3 D4, WP1 AC4). | **Superseded and removed (WP22).** This exact behaviour is R1, the critical rollout blocker. I7 replaces it: partial observation produces upserts only. **Phasing correction (2026-07-31):** deletion-by-key-omission exists at *three* write boundaries, not one, and they retire in different phases. (i) The **Obsidian-save capture path** (`applyLocalDiffToYMaps` / `applyKeyDiff`, guarded by `PROTECTED_KEYS`) retires in **P0 with WP4** — not by a separate removal step but structurally: C4 AC1 routes every capture write through the C2 intent plan, and that plan has no field-removal category (CONCEPT_V2 Teil 5's diff rule annotates its only write case with "(I7)"). (ii) The **seed boundaries** (`CanvasSync.subscribe` host seed and `CanvasPersistence` cold-open, both via `applyToYMap`) retire in **P1 with WP18** (C18 AC3). (iii) The **binding path** (`writeRecordMinimal`) retires in **P1 with WP22**, as this row already states. `PROTECTED_KEYS` therefore stays exported and live after P0 — it guards (ii) only, and WP4 must not remove it. |
| S5 | The lock write-denial data seam: *"a denied write does not advance `lastWrittenContent`"*, hold-the-baseline, `LOCK DENIED:` emitter, `canWrite`/`canWriteNode`/`canDeleteNode` consulted in the diff path (canvas-integrity P0-4 + WP4 AC1–7; CanvasBinding WP1 AC9 / T8; root spec WP3 AC5/AC7). | **Superseded and removed (WP21).** Locks remain in awareness, keep colouring rings and keep driving the *view* revert; they lose all write authority. The `LOCK DENIED:` signature retires with its mechanism (see S9). `canWriteCanvasPath` (read-only permissions and guest globs) is **not** affected — that is authorisation, not locking, and stays. |
| S6 | Path-keyed doc identity: `__canvas__:<path>`, `canvasOwned(path)`, awareness field carrying `canvasPath` with WP2 AC6 asserting the shape *"matches exactly"* (canvas-integrity §4/§6, root spec §4/§6). | **Not a contradiction once split.** Only the **Y.Doc id** becomes GUID-based. Every registry, the ownership predicate, the mute registry, `noteExternalDiskWrite(rawPath, …)`, and the **awareness field shape including `canvasPath`** stay path-keyed and unchanged. WP27 must preserve the awareness shape assertion. |
| S7 | Hard-delete semantics: node delete cascade-prunes its edges in the CRDT; `buildCanvasData` drops dangling edges (canvas-integrity §4). | **Superseded in mechanism, preserved in observable behaviour.** Cascade and dangling-drop still happen; they are expressed as tombstones + a serialisation suppression rule instead of key removal, which additionally makes them undoable. |
| S8 | R10 raw-text fallback is an accepted, *designed* state; D7 requires *"never neither while it is shared"*; `CANVAS TEXT FALLBACK:` is a required log emitter. | **Superseded (WP33).** Receive-and-Persist replaces it and satisfies "never neither" better: the path always has exactly one owner (`CanvasSync`), and the degraded client is read-only rather than a second, unrelated writer. |
| S9 | *"Ten fixed uppercase log prefixes … each needs a production emitter"* (canvas-integrity §10/US6). | **Amended.** Two signatures retire with their mechanisms: `LOCK DENIED:` (WP21) and `CANVAS TEXT FALLBACK:` (WP33). V2 adds `QUARANTINE:`, `EPOCH CONFLICT:`, `SIDECAR:`, `MODE:` and `SHADOW STALE:`. The rule "every declared signature has exactly one production emitter" stays in force for the amended list (§10). |
| S10 | `useCanvasBinding` default `false` is an abort criterion; `canvas-binding.ts` / `canvas-model-bridge.ts` are *"frozen"*; a production import outside the flag-gated branch aborts (canvas-integrity D1 + abort criteria). | **Held until P5, then explicitly retired.** The freeze and the default stay binding for WP1–WP38. WP39 unfreezes the two files; WP40 is the only WP permitted to flip the default, and only after WP7's and WP40's E2E verification gates are green. Any earlier WP touching those files must ESCALATE. |
| S11 | *"`plugin/src/main.ts` — hard constraint … ESCALATE rather than edit"* (canvas-integrity WP3) and D6 *"wiring may live here; logic may not"*. | **Narrowed, not lifted.** V2 requires `main.ts` wiring changes (WP5, WP34, WP37, WP38, WP40). D6 stays absolute: **no logic in `main.ts`.** Every mechanism lives in a headless module; `main.ts` may only construct, inject and forward. A WP that finds itself writing a conditional over canvas state inside `main.ts` must move it into a module. |
| S12 | *"Do not touch `server/` source"* (canvas-integrity). | **Lifted for WP41 only.** WP41 and WP42 are the sole WPs permitted to modify relay source; deployment stays out of scope (§2). |
| S13 | Test-count floors (`≥ 526` / `≥ 32 files`; older `≥ 440`) and version pinned at `0.6.0`. | **Restated in §7.** The floor becomes the *current measured* baseline with an explicit deletion ledger, because WP21/WP22/WP33 legitimately delete tests that pin removed behaviour. Version: **do not bump.** The tree already carries an uncommitted 0.6.1 against a handover asserting 0.6.0 — this initiative changes neither and records the discrepancy as pre-existing. |
| S14 | *"A genuine OPTIONAL-key deletion (`color` / `label`) expressed by omitting the key from a save still reaches the CRDT"* (pinned by `A4` in `plugin/src/__tests__/w4-canvas-integrity.test.ts`). | **Superseded and removed (WP4, P0) — and this is an accepted user-visible regression, recorded rather than absorbed.** Under I7 the Obsidian-save capture path cannot distinguish "the user cleared this field" from "the stale view omitted this field"; that indistinguishability *is* the epistemic claim I7 makes, so no receipt available to `CAPTURE_NET` can license the removal. Consequence from P0 until WP39: **clearing a card's colour or an edge's label in Obsidian no longer clears it for peers** — the value returns on the next reconcile. Accepted because the alternative is the Symptom-2 cascade class (an invisible, self-amplifying corruption traded against a visible, self-correcting single-field staleness — the same trade CONCEPT_V2 Teil 5 makes explicitly for the ABA case). **Owner for closing it: WP39 AC5** — op-capture (`CAPTURE_OP`) observes the user action itself and can emit an explicit field-clear, which the save-diff net structurally cannot. Until then this is a known limitation, not a defect: a WP that "fixes" it by reintroducing key-absence semantics on the capture path violates I7 and must ESCALATE. |

### 3.2 Terminology note — the two R10s

`ARCHITECTURE.md`'s risk register numbers **R10 = committed build output**, while its own prose (and CONCEPT_V2 throughout) uses **"the R10 text fallback"** for the `subscribeCanvasWithHandover` failure door at `vault-events.ts:113` → `backgroundSync.subscribe`. This spec resolves the collision by name, never by number: **"the R10 text fallback"** always means that raw-text door. Where a risk number is used without a name, it follows `ARCHITECTURE.md` Part IX (R1 = `useCanvasBinding` off, R2 = nothing verified behaviourally, R3 = `main.ts` untested, R4 = destructive host re-seed, R5 = unguarded `getDoc`, R6 = orphaned `Y.Text`, R7 = no lock epoch, R8 = retained dead code, R9 = release hygiene).

---

## 4. Data Architecture

### 4.1 Primary data sources

1. The Yjs doc (authoritative — I3).
2. The `.canvas` file on disk (a projection; an input **only** at the one-time seed and at an explicit user import — I9).
3. Obsidian's in-memory canvas model, observed via `requestSave` snapshots and (from P5) patched adapter ops.
4. **New:** the sidecar update log (the doc's own durable history).
5. **New (P6):** the relay blob store (opaque ciphertext frames).

### 4.2 Core data model (V2)

```text
Y.Doc  "__canvas__:<guid>"
├── meta    : Y.Map                        schemaVersion, guid, epoch, path
├── nodes   : Y.Map<id, Y.Map<field, value>>
├── edges   : Y.Map<id, Y.Map<field, value>>
└── deleted : Y.Map<id, {t: lamport, by: clientID, on: boolean, q?: boolean}>
```

Containers are **created once and never replaced.** Record creation is a single transaction carrying a complete, schema-validated record; afterwards only field updates and the tombstone flag exist. `parent.set(id, new Y.Map())` on an existing id is a **forbidden operation**, not an avoided mistake.

### 4.3 Field-by-field merge policy

| Field | CRDT type | Merge | Note |
|---|---|---|---|
| `pos` = `[x, y]` | one LWW register (array as a single value) | atomic LWW | A position is a point, not a coordinate pair with separate authors. |
| `size` = `[w, h]` | one LWW register | atomic LWW | Separate from `pos` so move ⊥ resize commute. |
| `type` | write-once | set once, immutable at ingest afterwards | Turns "protected key" into "impossible operation". |
| `text` (text node), edge `label` | nested `Y.Text` | YATA sequence merge | Captured through the existing minimal-diff mechanism incl. surrogate snapping. |
| `file`, `url`, `subpath` | LWW register | LWW | Genuine single values. |
| `color` | LWW register | LWW, deletable | Deletion is an explicit delete event, never key absence. |
| `from` = `{node, side, end?}` | one LWW register | atomic LWW | An edge endpoint is one unit. |
| `to` = `{node, side, end?}` | one LWW register | atomic LWW | `from` ⊥ `to`; re-routing both ends commutes. |
| `ord` | LWW register, fractional-index string | LWW; allocation uses jitter + `(clientID)` suffix as tiebreak | Never written to the `.canvas` file. |
| groups (`type:"group"`) | as normal nodes | — | Obsidian groups are geometric, not hierarchical. No tree CRDT. Multi-node drags are captured as **one transaction**. |
| deletion | `deleted[id] = {t, by, on}` | LWW on `on` (Lamport `t`, tiebreak `by`) | `on:true` suppresses the record everywhere; undo is `on:false` and is lossless. GC on sidecar compaction. |

### 4.4 Normalisation rules

- Geometry is rounded to whole pixels **before** the register write, so rounding can never appear as intent.
- Numbers are serialised in Obsidian's format (integers without decimal places).
- Object keys are emitted in Obsidian-canonical order (`id`, `type`, `pos`→`x`/`y`, `size`→`width`/`height`, …).
- Records are emitted sorted by `(ord, id)`.
- Paths continue to be canonicalised through `toCanonicalPath(normalizePath(p))` at every subsystem boundary (unchanged from prior rounds).

### 4.5 Consistency and integrity rules

- **I1–I5 remain binding, unchanged** (`ARCHITECTURE.md` §"The five invariants"): I1 ONE OWNER, I2 ONE WRITER, I3 DOC IS TRUTH, I4 NO LOOPBACK, I5 DEGRADE.
- **I6–I10 are new and binding** (CONCEPT_V2 Teil 3): I6 INTENT IS SHADOW-RELATIVE, I7 OBSERVATION NEVER DELETES, I8 ATOMIC IS WHAT BELONGS TOGETHER, I9 HISTORY IS THE TRUTH, I10 ONE MODE PER ROOM.
- Ingest schema: `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific (file→file, text→text, …)`; `Edge valid ⟺ id ∧ from.node ∧ to.node`.
- Invalid records from **local** sources are rejected with a signature. Invalid records arriving as **remote deltas** are never rejected (that would diverge); they are quarantined by the auditor.
- `CanvasPersistence` remains the **single** CRDT→disk writer; a remote delta still produces exactly one disk write; `CanvasPersistence` still emits **zero** CRDT writes.
- `coldOpen` still runs **after `waitForSync` and before `start()`**.

### 4.6 Invariant → work-package traceability

<!-- Updated: I7 is phased, not P1-only — its capture-path half lands in P0 with WP2/WP4 2026-07-31 -->

Every new invariant is traceable to at least one WP (a hard requirement of this initiative):

| Invariant | Owning WPs | Verifying WPs |
|---|---|---|
| **I6** Intent is shadow-relative | WP1, WP2, WP4, WP5, WP15 | WP6, WP23 (shadow-consistency assert) |
| **I7** Observation never deletes | **P0 (capture path): WP2, WP4** · P1 (remaining write boundaries + tombstone model): WP12, WP14, WP18, WP19, WP22 | WP6 (discrimination variants), WP20, WP23 |
| **I8** Atomic is what belongs together | WP9, WP10, WP15 | WP23 (torn-write assert) |
| **I9** History is the truth | WP24, WP25, WP27, WP29, WP30 | WP35 |
| **I10** One mode per room | WP31, WP32, WP33 | WP35 |
| I1–I5 (preserved) | all wiring WPs | WP7 (E2E), WP34 (I5 for correctness, not just availability) |
| <!-- Updated: T3 2026-08-01 --> **R2** (nothing verified behaviourally — the debt Teil 14 exists to discharge) | WP43–WP51 (the host layer that makes verification possible) | WP7 (P0 mechanisms on real Obsidian), WP54 (`CAPTURE_TRIGGERS` measured), WP40 (promotion licensed by that measurement) |

**Why I7 spans two phases.** The original table read as if I7 arrived whole in P1. It does not, and the earlier reading is what produced the WP4 contradiction escalated on 2026-07-31. I7 is not a guard that some WP switches on; it is a property that follows from the shape of each write boundary, and this spec has three of them (§3.1 S4). The **capture path** acquires it in P0 as an unavoidable consequence of C4 AC1 + C2 — routing capture through an intent plan that has no field-removal category *is* I7 for that boundary, and CONCEPT_V2 Teil 5 already writes "(I7)" on that rule. The **seed** and **binding** boundaries still delete absent keys after P0 and acquire it in P1 (WP18, WP22). A P1 WP that finds field-deletion already gone from `canvas-sync.ts` is therefore seeing the expected state, not a scope collision.

### 4.7 Data flow (V2)

```text
                       ┌──────────── SHADOW (field-granular, per surface) ────────┐
User interaction ───► Adapter ops ───► [ingest schema] ───► Y.Doc ◄── Peers (mux)  │
                       ▲  (P5, upsert-only)                │  ▲                    │
Obsidian requestSave ──┘                                   │  └── Sidecar log      │
   │                                                       │      (.yhistory)      │
   └──► parse ──► SHADOW DIFF (I6) ──► real intents only ───┘                       │
              staleness: discarded ──► (reconciler pulls the view up)               │
                              ┌── Reconciler ───► Live view ── advances ────────────┤
                    Y.Doc ────┤   (plan vs shadow, busy ⊃ editing)                  │
                              └── Serializer (canonical, (ord,id)-sorted)           │
                                       └─► CanvasPersistence ──► Disk ── advances ──┘
```

---

## 5. Component Map

Format per the blueprint. **Every AC below is copied verbatim into the owning TaskCharter's section 4.**

Conventions used in this section:
- **Fuzzer link** — required by this initiative on every WP that changes merge or serialisation behaviour: the op class and assertion in WP23 that must reach this WP's mechanism.
- **Schema impact** — the `meta.schemaVersion` implication and the mixed-version behaviour per CONCEPT_V2 Teil 12.

---

### PHASE P0 — Shadow diff + canonical serialisation (no format change)

#### C1 — Surface-Shadow core
- Change type: create (`plugin/src/canvas/canvas-shadow.ts`, new headless module)
- Responsibility: hold, per subscribed canvas, the last version of each field that provably reached the surface Obsidian's save comes from.
- Interfaces:
  - Input: field-granular record updates from three sources (confirmed view apply, captured local edit, persistence write when the view is closed)
  - Output: a readable field-granular snapshot plus per-record presence information
- Acceptance Criteria:
  1. The module exports a shadow structure keyed by canonical path, then record kind (`node`/`edge`), then record id, then field name, and it has **no** import of Obsidian, no clock, no DOM and no file I/O.
  2. Advancing a single field leaves every other field of the same record untouched, and advancing a field of one record leaves other records untouched.
  3. The shadow distinguishes three states for a record: present with known fields, known-absent (it was handed to the surface and is not there), and unknown (never observed on this surface) — and a caller can read which state applies.
  4. Clearing a path removes all of its shadow state and leaves other paths intact.
- Definition of Done: a headless module whose entire state can be constructed, advanced and read without any Obsidian or filesystem access.
- Assigned to work package: **WP1**

#### C2 — Shadow-relative intent diff
- Change type: create (pure function in the shadow module)
- Responsibility: decide, per field, whether a parsed Obsidian save expresses intent or merely staleness — the four rules of CONCEPT_V2 Teil 5.
- Interfaces:
  - Input: `(shadow, parsedSave, tombstoneView, surfaceState)` where `surfaceState` says whether the view is open and which records were handed to it in the last apply
  - Output: an intent plan — a list of field upserts, a list of delete intents, and a list of explicitly-discarded staleness observations
- Acceptance Criteria:
  1. A field whose value in the save equals the shadow value produces **no** intent, **even when the CRDT value differs from the shadow** — this case must be represented as a discarded-staleness entry, not silently dropped.
  2. A field whose value in the save differs from the shadow produces exactly one upsert intent and no deletion of any other key of that record.
  3. A record missing from the save that exists in the shadow produces a delete intent **only** when the view is open **and** that record was handed to the view in the last apply; in every other case it produces no intent.
  4. A record present in the save whose id is tombstoned with `on:true` produces no intent at all (resurrect block).
  5. The function is pure: same inputs → same output, no I/O, no clock, no randomness.
- Definition of Done: the four rules of Teil 5 are each observable as a distinct output category from a single pure call.
- Assigned to work package: **WP2**
- Fuzzer link: WP23 "stale-save simulation" ops; the shadow-consistency assertion ("no replica ever pushed a stale field") is the W1 discriminant and must exercise this function.

#### C3 — Canonical form core
- Change type: modify (`plugin/src/files/canvas-sync.ts` — `buildCanvasData` `:98–130`, `serializeCanvas` `:132–137`) + create (canonicalisation helpers)
- Responsibility: produce byte-identical output on every client from the same doc state, and round geometry on the capture side so rounding can never read as intent.
- Interfaces:
  - Input: node/edge record collections
  - Output: a canonical JSON string (tab-indented, as today) and a canonical-rounding helper usable by the capture path
- Acceptance Criteria:
  1. Two independently ordered inputs describing the same records serialise to **byte-identical** strings.
  2. Object keys are emitted in the Obsidian-canonical order and numbers in Obsidian's format (integers without decimal places); no field gains or loses a value through canonicalisation.
  3. The capture-side rounding helper maps geometry to whole pixels and is idempotent (rounding a rounded value changes nothing).
  4. Record order is deterministic in P0 without requiring `ord` (which does not exist until P1), and the existing tab indentation and overall file shape are unchanged.
- Definition of Done: the same doc state, serialised on two different clients, produces identical bytes.
- Assigned to work package: **WP3**
- Fuzzer link: WP23 "identical canonical serialisation (byte equality)" assertion.
- Schema impact: none. The `.canvas` file format is unchanged; only the byte-level determinism of our own output improves.

#### C4 — Capture path re-based on the shadow
<!-- Updated: WP4 structurally lands I7 for the capture path, so it must also carry the deliberate retirement of the three probes that pinned the old behaviour 2026-07-31 -->
- Change type: modify (`plugin/src/files/canvas-sync.ts`: `handleLocalModify` `:496–619`, baseline reads `:520–521`, echo breaker `:526–538`, `applyLocalDiffToYMaps` `:620–704`, `noteExternalDiskWrite` `:856–879`)
- Responsibility: replace `lastWrittenContent` as the diff basis with the Surface-Shadow, make the echo breaker byte-based, and advance the shadow for the closed-view surface.
- Interfaces:
  - Input: a vault `modify` event for an owned, unmuted `.canvas` path
  - Output: CRDT upserts and delete intents derived from the intent plan only
- Acceptance Criteria:
  1. The three-way diff against `lastWrittenContent` no longer decides what is written to the CRDT; the intent plan from C2 does. `lastWrittenContent` may remain only as an echo/telemetry aid and must not be read as the intent basis at `:520–521`.
  2. A save that is byte-identical to the last written content is recognised as an echo and produces zero CRDT writes.
  3. When the view is closed, the content of the last persistence write advances the shadow, so a subsequent Obsidian save of that path yields no intent.
  4. A save that is stale for a peer's field (the field equals the shadow while the CRDT has moved on) produces **zero** writes for that field, and the discarded staleness is observable in the debug log under a dedicated signature.
  5. The three pre-existing probes that pin deletion-by-key-omission on this path — `A4`, `A9` and `A10` in `plugin/src/__tests__/w4-canvas-integrity.test.ts` — are deleted deliberately and enumerated by name in the implementation report against the §7 deletion-ledger entry. No surviving test is weakened, skipped, `.only`'d or relaxed to make the suite green, and no test is left asserting a behaviour that no longer exists.
  6. The discrimination coverage those probes provided is **relocated, not dropped**: `PROTECTED_KEYS` keeps its membership and its export and is not removed by this WP, because it still guards the seed boundaries (`applyToYMap`) until WP18. An equivalent discrimination pair asserts, at a boundary where the guard is still live, that disarming it for `fromNode` / `toNode` loses the endpoint while the intact guard preserves it — so the guard stays falsifiable for the rest of the initiative.
- Definition of Done: the Symptom-2 cascade cannot start — a stale save produces no outbound delta.
- Assigned to work package: **WP4**
- **I7 note (2026-07-31):** this WP is a P0 owner of I7 for the capture boundary (§4.6, §3.1 S4). That is a consequence of AC1 + C2, not additional scope: the C2 intent plan has no field-removal category, so field-deletion-by-omission cannot survive AC1. AC5/AC6 exist so the consequence is recorded in the ledger rather than discovered as three red tests. The user-visible cost is recorded as §3.1 **S14** and owned by WP39 AC5.
- Fuzzer link: WP23 stale-save simulation + shadow-consistency assertion.

#### C5 — Per-field apply receipt in the reconcile path
- Change type: modify (`plugin/src/main.ts`: `canvasApplied` `:114`, `reconcileLiveCanvas` `:1046–1175`, apply-ok writes `:1110`, `:1146`, deletes `:1029`, `:1425`)
- Responsibility: turn `canvasApplied` from a record snapshot into the field-granular shadow, and advance it per field only on a confirmed apply.
- Interfaces:
  - Input: the reconcile plan result and the adapter's apply outcome
  - Output: shadow advances scoped to exactly the fields that were confirmed applied
- Acceptance Criteria:
  1. `canvasApplied` is replaced by the shadow from C1 as the single structure serving both reconcile classification and capture basis; there is no second, parallel shadow.
  2. An `"interacting"` skip leaves exactly the fields of the affected record un-advanced and advances every other record's confirmed fields.
  3. A failed or partial apply advances no field of the affected record.
  4. `main.ts` gains wiring only — construction, injection and forwarding. No canvas decision logic is added to this file.
- Definition of Done: reconcile classification and capture basis are provably one structure with no drift between them.
- Assigned to work package: **WP5**

#### C6 — Chaos suite I (P0 scenarios)
- Change type: create (test infrastructure and named scenario suites)
- Responsibility: make the two P0-relevant symptom triggers reproducible, each with a discrimination variant.
- Interfaces:
  - Input: injected seams (delayed apply, unavailable adapter) over the existing two-peer harness and canvas double
  - Output: named, deterministic suites
- Acceptance Criteria:
  1. A scenario "view apply artificially delayed + Obsidian save" reproduces the cascade deterministically and passes under V2.
  2. A scenario "adapter unavailable + open view + remote deltas" runs without the open view leaking stale values into the shared state.
  3. Each scenario has a discrimination variant: with the V2 mechanism disabled through its injected seam, the scenario **fails**. The variant is part of the suite, not a manual procedure.
  4. Both scenarios are deterministic — no wall-clock sleeps, no timing constants, seeds fixed.
- Definition of Done: the reported symptoms exist as reproducible, self-discriminating tests.
- Assigned to work package: **WP6**

#### C7 — E2E rig promoted to a mandatory gate
<!-- Updated: the gate is now satisfiable — the T3 host layer (WP43–WP51) exists, so WP7 depends on it and gains an anti-false-pass AC and a data-safety AC; AC1–AC4 unchanged 2026-08-01 -->
- Change type: modify (`tools/launch_liveshare_e2e.py`, `plugin/src/testing/e2e-control.ts`, `workflowArtifacts/e2e-infra/E2E_USAGE.md`)
- Responsibility: execute the never-run two-vault rig for the first time and make a green run a release condition from P0 onward.
- Interfaces:
  - Input: two Obsidian hosts against one local relay room (ports 39421/39422)
  - Output: a recorded, reproducible green run plus a documented invocation
- Acceptance Criteria:
  1. A two-vault run against a real Obsidian executes end to end and is recorded with its command, environment and outcome; any blocker found is fixed in the rig rather than worked around.
  2. The run demonstrates at least: a node move propagating both ways, a node create and delete, and an Obsidian save on a deliberately stale view producing no revert on the peer.
  3. The gate is documented as a release condition from P0 onward, with the exact invocation, and the previously "never executed" status is corrected in the rig's usage document.
  4. The production build still tree-shakes the whole `src/testing/` module out of `main.js` (`__LS_E2E__` false in production).
  5. The run is performed by the real-Obsidian rig, and a run performed by the headless mock-host rig cannot be recorded as satisfying this gate: the record names the entrypoint that produced it and the two distinct vault identities it drove, and the mock rig's own documentation and banner state that it is not the gate.
  6. The run leaves both vaults unchanged apart from its own scratch artefacts, which are removed; this is established by the before/after vault fingerprint, and a fingerprint mismatch fails the gate rather than being reported as a caveat.
- Definition of Done: the R2 verification debt is discharged for the P0 mechanisms and the rig is a standing gate.
- Assigned to work package: **WP7**
- **T3 note (2026-08-01):** Worker 3 returned this WP `BLOCKED` and was right to. `tools/launch_liveshare_e2e.py` aliases the `obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts; a green run there says nothing about AC1 or AC2. The response is **not** to weaken these ACs to the rig that exists but to build the rig they describe: §5 **PHASE T3** charters the host layer (WP43–WP51) and WP7 now depends on WP50 and WP51. AC5 exists so this substitution can never be made silently again.

---

### PHASE P1 — Data model V2 (`meta.schemaVersion = 2`)

> **Schema impact for the whole phase:** the **doc** format changes; the `.canvas` **file** format does not. Every WP in P1 writes or reads `meta.schemaVersion = 2`. Mixed-version behaviour (Teil 12): a client whose major schema version differs from the doc's goes to Receive-and-Persist rather than guessing. In P1 that degradation is local (capture disabled, persistence continues); WP32 later unifies it with the room-level mode.

#### C8 — `meta` map, schema version, and the V1→V2 doc migration
- Change type: modify (`plugin/src/files/canvas-sync.ts`, doc setup sites `:334`, `:348`, `:367`, `:493`, `:504`) + create (migration module)
- Responsibility: introduce the `meta` container, stamp the schema version, detect major mismatches, and migrate an existing V1 doc in place.
- Interfaces:
  - Input: a `Y.Doc` that is either fresh, V1-shaped (`x/y/width/height`, `fromNode/fromSide/toNode/toSide`, no `meta`), or already V2
  - Output: a V2-shaped doc with `meta.schemaVersion = 2`
- Acceptance Criteria:
  1. `meta` is created once per doc and carries `schemaVersion`, and (from P2) `guid`, `epoch` and `path`; it is never replaced by a new container.
  2. A V1 doc is migrated in a single transaction: `x/y` → `pos`, `width/height` → `size`, endpoint keys → `from`/`to`, an `ord` is assigned to every record, and no record loses a value in the process.
  3. Migration is idempotent: running it on an already-migrated doc changes nothing and produces no delta.
  4. A doc whose `schemaVersion` major differs from this client's supported major is detected, and the client disables local capture for that path while persistence continues — it never writes a guess into the shared state.
- Definition of Done: an existing V1 canvas doc opens as a valid V2 doc with no data loss and no second migration on reopen.
- Assigned to work package: **WP8**
- Fuzzer link: WP23 must be able to seed replicas from a migrated V1 doc as well as a fresh V2 doc.

#### C9 — Atomic `pos` / `size` registers
- Change type: create (pure register module) + modify (record shape types)
- Responsibility: make a position one value and a size one value, so concurrent moves cannot produce a coordinate no one set.
- Interfaces:
  - Input/Output: encode/decode between the file's `x`,`y`,`width`,`height` and the doc's `pos`, `size`; equality comparison; rounding integration
- Acceptance Criteria:
  1. `pos` and `size` each round-trip losslessly to and from the `.canvas` file representation for integer geometry.
  2. Two concurrent moves of the same node converge to exactly one of the two submitted positions on every replica — never a mixture of one author's `x` with another's `y`.
  3. A concurrent move and resize of the same node both survive: the winner of `pos` and the winner of `size` are decided independently.
  4. `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported, now describing the file schema (see §3.1 S2).
- Definition of Done: torn geometry writes are unrepresentable in the doc.
- Assigned to work package: **WP9**
- Fuzzer link: WP23 `move` / `resize` ops + the torn-write assertion.

#### C10 — Atomic `from` / `to` endpoint registers
- Change type: create (pure register module) + modify (record shape types)
- Responsibility: make an edge endpoint one value, so concurrent re-routing cannot produce a geometrically impossible edge.
- Interfaces:
  - Input/Output: encode/decode between `fromNode`/`fromSide`/`fromEnd` (and the `to` counterparts) and the composite `{node, side, end?}`
- Acceptance Criteria:
  1. `from` and `to` each round-trip losslessly to and from the `.canvas` file representation, including the optional `end` component.
  2. Two concurrent re-routes of the same endpoint converge to exactly one submitted endpoint on every replica — never one author's `node` with another's `side`.
  3. Concurrent re-routing of `from` on one replica and `to` on another leaves both changes intact.
  4. An endpoint register is either wholly present or wholly absent; a partially populated endpoint cannot be constructed through the module's API.
- Definition of Done: the "arrow points at a side where nothing hangs" class is unrepresentable.
- Assigned to work package: **WP10**
- Fuzzer link: WP23 `reroute` op + the schema invariant "no endpoint-less edge".

#### C11 — Write-once `type` guard
- Change type: create (pure guard, consumed by the ingest boundary)
- Responsibility: turn `type` loss from a protected key into an impossible operation.
- Interfaces:
  - Input: a proposed field write for `type` on a record
  - Output: accept (first write) or reject-with-signature (any later change)
- Acceptance Criteria:
  1. The first write of `type` on a record is accepted; every subsequent write with a different value is rejected and produces a signature in the log.
  2. A subsequent write with the **same** value is a no-op and produces no delta and no signature.
  3. A record can never reach the doc without `type` through any local write path.
- Definition of Done: `type` cannot change or vanish after record creation.
- Assigned to work package: **WP11**

#### C12 — Tombstone map core
- Change type: create (pure module for the `deleted` container semantics)
- Responsibility: model deletion, undo and quarantine as a converging flag rather than as key absence.
- Interfaces:
  - Input: delete / undelete / quarantine / release-quarantine operations with `(t, by)`
  - Output: a suppression predicate consumed by reconcile, serialisation and capture
- Acceptance Criteria:
  1. `deleted[id]` carries `{t, by, on}` and optionally `q`; concurrent operations on the same id converge by LWW on `on` using `t` with `by` as tiebreak, identically on every replica.
  2. `on:true` suppresses the record in all three consumers — reconcile output, serialisation and capture resurrect-blocking — through one shared predicate, not three copies.
  3. Undo of a delete (`on:false`) restores the record with **all** its field values intact, because field containers were never destroyed.
  4. Quarantine (`q:true` with `on:true`) is distinguishable from a user delete, and releasing quarantine restores the record without a user-visible delete/undelete event.
- Definition of Done: delete, undo and quarantine are one converging mechanism with a single suppression rule.
- Assigned to work package: **WP12**
- Fuzzer link: WP23 `delete` / `undo` ops; the SEC assertion must cover concurrent delete-vs-edit and delete-vs-undelete.

#### C13 — Fractional `ord` allocator
- Change type: create (pure module)
- Responsibility: model order as data, with collision-free concurrent allocation.
- Interfaces:
  - Input: the neighbouring `ord` values (either may be absent, meaning "at the start"/"at the end") plus the local `clientID`
  - Output: a new fractional-index string strictly between them
- Acceptance Criteria:
  1. An allocated value sorts strictly between its two neighbours under the module's comparison, including at the head and tail of the sequence.
  2. Two clients allocating between the *same* pair of neighbours produce **different** strings (jitter + `clientID` suffix), and the resulting total order `(ord, id)` is identical on every replica.
  3. Repeated allocation between ever-closer neighbours terminates and stays correct — the string grows rather than colliding or losing precision.
  4. An allocated value is immutable: the module offers no operation that rewrites an existing `ord` in place, only allocation of new values.
- Definition of Done: `(ord, id)` is a total order that all replicas compute identically.
- Assigned to work package: **WP13**
- Fuzzer link: WP23 `reorder` op + the byte-equality assertion.

#### C14 — Ingest schema validator
- Change type: create (pure module)
- Responsibility: express the schema invariants as a type barrier at the replica's boundary rather than as a filter at serialisation.
- Interfaces:
  - Input: a proposed record (node or edge) and its origin class (`local` | `remote`)
  - Output: valid, or invalid with a machine-readable reason
- Acceptance Criteria:
  1. `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific requirement` and `Edge valid ⟺ id ∧ from.node ∧ to.node` are both implemented exactly as stated, with the type-specific requirement covering at least `file`→`file` and `text`→`text`.
  2. A record that is missing a key and a record whose key is present but empty/ill-typed are both invalid, and their reasons are distinguishable.
  3. For origin `local`, the verdict is reject; for origin `remote`, the function reports invalidity but never signals rejection — this asymmetry is explicit in the API, not left to callers.
  4. The module is pure and has no knowledge of Yjs, Obsidian or the filesystem.
- Definition of Done: "an edge has two endpoints" is a type constraint at the boundary, not a downstream filter.
- Assigned to work package: **WP14**

#### C15 — Shadow and intent diff at atomic-register granularity
- Change type: modify (the C1/C2 module)
- Responsibility: lift the shadow and the intent diff from V1 keys to V2 registers, so staleness detection compares whole registers.
- Interfaces:
  - Input: V2-shaped records
  - Output: intent plans expressed in V2 registers
- Acceptance Criteria:
  1. The shadow stores `pos`, `size`, `from` and `to` as single fields; a change to one component of a composite marks the whole register as intent.
  2. A save in which only the rounding of a coordinate differs produces **no** intent, because the capture-side rounding is applied before comparison.
  3. The delete-intent rule and the resurrect block from C2 operate against the tombstone view rather than against key absence.
  4. No V1 key names (`x`, `y`, `width`, `height`, `fromNode`, `fromSide`, `toNode`, `toSide`) remain as shadow field keys.
- Definition of Done: I6 and I8 hold together — staleness is judged per atomic register.
- Assigned to work package: **WP15**
- Fuzzer link: WP23 shadow-consistency assertion under the V2 model.

#### C16 — `parseCanvas` V2 and the conservative `ord` capture policy
- Change type: modify (`plugin/src/files/canvas-sync.ts:74–94`) + extend
- Responsibility: read a `.canvas` file into the V2 record shape and derive order changes conservatively.
- Interfaces:
  - Input: `.canvas` file content
  - Output: V2-shaped records plus an order observation
- Acceptance Criteria:
  1. Parsing produces V2 records (`pos`, `size`, `from`, `to`) and preserves array order as an explicit observation instead of discarding it.
  2. `ord` is reassigned **only** when the relative order of existing ids in the save has demonstrably changed; appending new records allocates new `ord` values at the end and touches no existing record's `ord`.
  3. When a reorder is detected, the number of reassigned `ord` values is minimal for the observed change.
  4. The existing failure behaviour is preserved: a JSON error yields empty records rather than throwing, and entries without an `id` are dropped.
- Definition of Done: order round-trips through the file without churn on unchanged documents.
- Assigned to work package: **WP16**
- Fuzzer link: WP23 `reorder` op.

#### C17 — Canonical serializer V2
- Change type: modify (`buildCanvasData` `:98–130`, `serializeCanvas` `:132–137`; re-exported at `canvas-persistence.ts:388`, called at `:229`)
- Responsibility: expand V2 registers back into the exact Obsidian file schema, sorted by `(ord, id)`, with `ord` itself never written.
- Interfaces:
  - Input: the doc's V2 record state plus the tombstone view
  - Output: the canonical `.canvas` file content
- Acceptance Criteria:
  1. Records are emitted sorted by `(ord, id)`; `pos`/`size`/`from`/`to` are expanded into `x`/`y`/`width`/`height` and the endpoint keys exactly as Obsidian expects; `ord` does not appear in the file.
  2. Records suppressed by the tombstone predicate (deleted or quarantined) are not emitted, and an edge whose endpoint record is suppressed is not emitted either.
  3. Two replicas with the same doc state produce byte-identical files, including after a reorder.
  4. Round-trip stability: parse(serialize(state)) yields the same records and the same relative order.
- Definition of Done: the file is a deterministic projection of the doc on every client.
- Assigned to work package: **WP17**
- Fuzzer link: WP23 byte-equality assertion (this is its primary target).

#### C18 — Ingest validation and create-once transactions at every write boundary
- Change type: modify (seed path `canvas-sync.ts:388–401`, `seedDocFromCanvasData` `canvas-persistence.ts:363–387`, the capture writer `applyLocalDiffToYMaps` `:620–704`, and the import path from WP30)
- Responsibility: wire the validator in at every doc write boundary and make record creation a single validated transaction.
- Interfaces:
  - Input: proposed records from seed, `CAPTURE_NET`, and import (and, from P5, `CAPTURE_OP`)
  - Output: validated writes, or rejection with a signature
- Acceptance Criteria:
  1. Every local write boundary consults the validator before writing; an invalid local record never reaches the doc and produces a rejection signature naming the boundary and the reason.
  2. Record creation happens in one transaction carrying a complete record; no code path calls `set(id, new Y.Map())` for an id that already exists.
  3. Partial observation produces upserts only — no local write path deletes a doc key that is merely absent from the incoming record (I7).
  4. Remote deltas are never rejected at ingest; they are left to the quarantine auditor.
- Definition of Done: the doc cannot be brought into an invalid state by any local source.
- Assigned to work package: **WP18**
- Fuzzer link: WP23 schema-invariant assertion.

#### C19 — Tombstone semantics wiring
- Change type: modify (capture delete path, reconcile output, serialisation suppression, edge cascade `pruneEdgesForDeletedNodes` `:723–739`)
- Responsibility: replace delete-by-diff-logic with the tombstone flag throughout.
- Interfaces:
  - Input: delete intents from the intent plan; remote tombstone deltas
  - Output: `deleted[id]` writes and suppression everywhere
- Acceptance Criteria:
  1. A user delete writes a tombstone; no record's field container is destroyed by any delete path.
  2. Delete-wins and no-resurrect still hold observably: a local upsert for a tombstoned id does not resurrect it, and the reconciler removes it from the view.
  3. Deleting a node still causes its edges to disappear from the view and the file (cascade preserved), expressed through tombstones or the suppression rule rather than key removal.
  4. A delete followed by an undo restores the record with every field value it had before the delete.
- Definition of Done: deletion is reversible without data loss and still converges delete-wins.
- Assigned to work package: **WP19**
- Fuzzer link: WP23 `delete`/`undo` ops + SEC assertion.

#### C20 — Quarantine auditor
- Change type: modify (`auditCanvasState` `:880–948`, `scheduleCanvasAudit` `:814–855`, call site `:444`)
- Responsibility: raise the auditor from detection to idempotent, convergent self-repair.
- Interfaces:
  - Input: the doc state
  - Output: quarantine and release-quarantine tombstone writes, plus signatures
- Acceptance Criteria:
  1. A record in the doc that violates the ingest schema is quarantined (`on:true, q:true`) rather than logged only; it is never serialised and never rendered, and its field containers are preserved.
  2. When a later delta restores the missing fields, the auditor releases the quarantine automatically and the record reappears.
  3. The operation is idempotent and convergent: several clients auditing concurrently reach the same end state, and repeated audits of an unchanged doc produce no further deltas.
  4. An endpoint-less edge can no longer reach disk, and each quarantine/release emits a distinct signature.
- Definition of Done: self-healing replaces signature-only detection; the A.2/16 class is repaired, not merely reported.
- Assigned to work package: **WP20**
- Fuzzer link: WP23 schema-invariant assertion + a fault-injection op that writes an invalid record directly into a replica.

#### C21 — REMOVAL: the lock write-denial data seam
- Change type: delete (`canWriteEntity` `:705–722` and its three call sites `:642`, `:660`, `:688`; the baseline-hold on denial; the `LOCK DENIED:` emitter `:576`; the injected `canWriteNode`/`canDeleteNode` write-gates and their `main.ts` wiring `:796–806`, and the binding-side mirrors `main.ts:1279–1285`)
- Responsibility: remove the machinery that made a UX mechanism carry correctness, now that the data model resolves same-register conflicts.
- Interfaces:
  - Input: none (removal)
  - Output: a capture path with no write-authorisation branch
- Acceptance Criteria:
  1. `canWriteEntity` and its baseline-hold behaviour no longer exist; no capture path consults a lock before writing, and no code path holds a diff baseline because a write was denied.
  2. Locks still work as UX: rings still colour, the loser's **view** revert still happens, and the awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) is **byte-unchanged** — `canvas-presence.ts` is not modified.
  3. `canWriteCanvasPath` (read-only permission and guest globs) is preserved and still consulted — authorisation is not locking.
  4. Tests that pinned the removed denial behaviour are deleted deliberately and enumerated by name in the implementation report; no test is left asserting a behaviour that no longer exists.
- Definition of Done: R7 is moot — there is no write permission left for an epoch to protect.
- Assigned to work package: **WP21**
- Fuzzer link: WP23 must show that removing the write gate does not change convergence — concurrent writes to the same register converge by honest LWW on every replica, with no baseline-hold artefact and no held-back local state.

#### C22 — REMOVAL: `writeRecordMinimal` key deletion
- Change type: modify (`plugin/src/canvas/canvas-binding.ts:126–143`; the mirrored shape in `plugin/src/testing/e2e-control.ts:338–355`)
- Responsibility: make binding-side writes upsert-only, closing R1 at its root.
- Interfaces:
  - Input: an observed partial record
  - Output: upserts only
- Acceptance Criteria:
  1. `writeRecordMinimal` no longer deletes doc keys that are absent from the incoming record; capturing `{id}` over an existing edge leaves its endpoints intact.
  2. Deletion is possible only through an explicit delete trigger that writes a tombstone.
  3. The `upsertRecord` mirror in the E2E control server is changed to the same semantics, so the rig cannot reproduce the old behaviour.
  4. `useCanvasBinding` remains `false` and the binding stays dormant in production after this change (the flag is not flipped here).
- Definition of Done: the R1 mechanism no longer exists, independent of the flag.
- Assigned to work package: **WP22**
- Fuzzer link: WP23 "partial capture" op — a capture that observes only a subset of a record's fields must never remove any other field on any replica (the I7 assertion).

#### C23 — Convergence fuzzer
- Change type: create (property-based test harness)
- Responsibility: replace ∃-style example tests with the ∀-style check that convergence actually requires.
- Interfaces:
  - Input: a seed, a replica count (3–5), an op registry, and a scenario budget
  - Output: pass, or a minimal reproducible failing sequence frozen as a named regression test
- Acceptance Criteria:
  1. The fuzzer runs **3–5** simulated replicas (never 2), applying random op sequences from a **pluggable op registry** that initially covers create, move, resize, reroute, relabel, delete, undo and reorder, with random partitions, delta reordering and delta duplication, plus randomised Obsidian-save simulations using a deliberately stale view model.
  2. After quiescence it asserts on **every** replica: identical doc state (SEC), the schema invariants (no endpoint-less edge, no record without `pos`), identical canonical serialisation (byte equality), and shadow consistency (no replica ever pushed a stale field — the W1 discriminant).
  3. Runs are reproducible from their seed, and any discovered counter-example is frozen as a named regression test that fails before the fix and passes after it.
  4. The op registry is open for extension so later phases can add ops without modifying the fuzzer core, and every WP in this spec that changes merge or serialisation behaviour is reachable through at least one registered op.
- Definition of Done: convergence of the V2 model is checked over interleavings, not examples.
- Assigned to work package: **WP23**

---

### PHASE P2 — Sidecar history, GUID/epoch identity, explicit import

#### C24 — Sidecar store core
- Change type: create (headless module with injected I/O)
- Responsibility: give each doc a durable, append-only update history outside the shared vault scope.
- Interfaces:
  - Input: encoded Yjs updates; injected file I/O
  - Output: `.obsidian/liveshare/state/<guid>.yhistory`, `<guid>.ycheckpoint`, and an `index.json` mapping
- Acceptance Criteria:
  1. The module appends encoded updates to `<guid>.yhistory`, writes a full-state checkpoint to `<guid>.ycheckpoint`, and truncates the history only after the checkpoint is durably written — never the reverse order.
  2. Loading reconstructs a doc from checkpoint + history such that its state equals the state before unload, and loading is idempotent.
  3. A missing, truncated or corrupt sidecar is a defined degradation: loading yields an empty-but-valid result and reports the degradation, never throws and never leaves a partially applied doc.
  4. All file I/O is injected; the module imports neither Obsidian nor `node:fs` directly.
- Definition of Done: a doc's causal history survives the process.
- Assigned to work package: **WP24**
- Fuzzer link: WP23 "replica restart" op — a replica that unloads and reloads from its sidecar must converge identically to one that stayed online for the whole run.

#### C25 — Sidecar lifecycle wiring, compaction and tombstone GC
- Change type: modify (`CanvasSync.subscribe` `:360–467`, `unsubscribe` `:468–495`) + wire the store
- Responsibility: load history before sync, capture every update, and compact periodically.
- Interfaces:
  - Input: doc lifecycle events and update notifications
  - Output: a persistently backed doc
- Acceptance Criteria:
  1. On subscribe the sidecar is loaded **before** peer sync begins, so the subsequent exchange is between related replicas.
  2. Every local and remote update is appended to the history exactly once; no update is lost across a clean unsubscribe/resubscribe cycle.
  3. Compaction runs on a documented, tunable period, uses Yjs' built-in GC, and physically removes tombstones with `on:true` older than the compaction horizon; a compaction never changes the doc's observable state.
  4. `coldOpen`'s existing ordering contract is preserved: it still runs after `waitForSync` and before `start()`.
- Definition of Done: a returning client resumes a related replica instead of reseeding an unrelated one.
- Assigned to work package: **WP25**
- Fuzzer link: WP23 "compaction" op — a compaction at an arbitrary point in the run must leave every assertion of the run unchanged (state, schema, byte equality, shadow consistency).

#### C26 — Sidecar exclusion from manifest, sync and text-sync detection
- Change type: modify (`plugin/src/utils.ts:258` `skipsAutoTextSync` and its consumers `background-sync.ts:72`, `:195`, `:248`, `manifest.ts:174`)
- Responsibility: guarantee the sidecar files are treated as local replica state, never as shared content.
- Interfaces:
  - Input: vault paths
  - Output: exclusion verdicts
- Acceptance Criteria:
  1. No file under `.obsidian/liveshare/state/` is ever added to the manifest, subscribed for sync, or handled by any text-sync path — asserted at each of the exclusion consumers, not only at one.
  2. Creating, renaming into, or modifying a sidecar path triggers no sync activity and no doc creation.
  3. The exclusion is expressed as one predicate with one definition, in the same style as the existing `.canvas` exclusion, and its consumers are enumerated in the code comment.
  4. Existing `.canvas` exclusion behaviour is unchanged.
- Definition of Done: local replica state cannot leak into shared state.
- Assigned to work package: **WP26**

#### C27 — GUID doc identity, path mapping and rename
- Change type: modify (`CANVAS_DOC_PREFIX` `:16` and the five doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`; `manifest.ts`; `sync.ts:200–252`) + fix `background-sync.ts:173` and `collab.ts:62`
- Responsibility: make identity independent of the path, so a rename is metadata and a bare-path `getDoc` cannot collide with a canvas doc.
- Interfaces:
  - Input: a canonical path
  - Output: the doc id `__canvas__:<guid>`, with `path` an attribute in `meta` and in the manifest
- Acceptance Criteria:
  1. Canvas docs are addressed by `__canvas__:<guid>`; `meta.path` and the manifest carry the `path → guid` mapping, and a client that knows only the path can resolve the guid from the manifest or from peers.
  2. A rename mid-session updates `meta.path`, the manifest mapping and `index.json` without creating a new doc and without orphaning the old one; edits continue to flow across the rename.
  3. All in-memory registries (adapter, presence, persistence, mute registry), the ownership predicate `canvasOwned`, and the **awareness field shape including `canvasPath`** remain path-keyed and unchanged.
  4. The two unguarded bare-path `getDoc` call sites (`background-sync.ts:173`, `collab.ts:62`) can no longer create or reach a canvas doc, verified by an explicit test rather than by a reachability argument.
- Definition of Done: R5 and the rename hole are closed structurally.
- Assigned to work package: **WP27**

#### C28 — Epoch rule and conflict archiving
- Change type: create (epoch comparison + archive helper) + modify (subscribe/merge path)
- Responsibility: make unrelated histories detectable and named instead of silently merged or silently lost.
- Interfaces:
  - Input: two replicas claiming the same guid with different `meta.epoch`
  - Output: the higher epoch wins; the loser archives a conflict copy
- Acceptance Criteria:
  1. `meta.epoch` is monotonic and host-incremented; when two replicas share a guid but differ in epoch, the higher epoch wins completely on every replica.
  2. The losing side writes its state to `<name>.conflict-<date>.canvas` before adopting the winner, and the user is notified with a message naming the file.
  3. Equal epochs merge normally as related replicas — the archive path does not trigger.
  4. A distinct log signature records every epoch conflict with both epoch values.
- Definition of Done: the W4 divergence class is named and archived rather than silent.
- Assigned to work package: **WP28**
- Fuzzer link: WP23 "epoch" scenario — replicas with equal epochs converge normally; replicas with unequal epochs all resolve to the higher epoch's state, and no replica silently merges the two histories.

#### C29 — Seed-once-per-lifetime and REMOVAL of the destructive host re-seed
- Change type: modify (`CanvasPersistence.coldOpen` `:310–327`) + delete (`CanvasSync.applyCanvasToYMaps` `:776–813` destructive semantics, the R4 path)
- Responsibility: enforce I9 — a doc is seeded from a file exactly once in its life — and stop a returning host from discarding peer work.
- Interfaces:
  - Input: doc state, sidecar presence, peer availability
  - Output: a seed decision
- Acceptance Criteria:
  1. Seeding from file happens only when **neither** a sidecar **nor** any peer knows the doc; in every other case the client loads/merges instead of seeding.
  2. The destructive re-seed that deleted doc entries absent from the host's local file no longer exists; a host rejoin is an ordinary related-replica merge.
  3. A host rejoining with an older local file does not remove any peer's records.
  4. The `ColdOpenResult` outcomes remain observable and the `coldOpen`-after-`waitForSync`-before-`start()` ordering is preserved.
- Definition of Done: R4 is eliminated; destruction is only ever an explicit user action.
- Assigned to work package: **WP29**
- Fuzzer link: WP23 "host rejoin" op — a replica that rejoins carrying an older local file must not remove any record held by the other replicas.

#### C30 — Explicit "Import from file" command
- Change type: create (command + confirmation modal)
- Responsibility: give the user the named, informed action that replaces the old implicit destructive re-seed.
- Interfaces:
  - Input: user command on an owned canvas
  - Output: `epoch++`, doc seeded from the file, peers follow the epoch rule
- Acceptance Criteria:
  1. The command exists, is reachable from the canvas context, and is the **only** way a file overwrites an already-living doc.
  2. Executing it increments `meta.epoch`, seeds the doc from the file, and causes peers to adopt it through the epoch rule while archiving their state as a conflict copy.
  3. A confirmation dialog is shown first, naming what will be overwritten and whose work is affected; cancelling performs no write of any kind.
  4. The command is unavailable for a path the client does not own or is degraded on.
- Definition of Done: overwriting is an informed decision, never a timing side effect.
- Assigned to work package: **WP30**

---

### PHASE P3 — Mode consensus and degradation without forking

#### C31 — Room-level mode consensus
- Change type: modify (`plugin/src/files/manifest.ts`)
- Responsibility: make the sync mode of a path shared, host-authorised state.
- Interfaces:
  - Input: the manifest doc
  - Output: `path → {mode: "canvas" | "text", guid}` observed by all clients
- Acceptance Criteria:
  1. The manifest carries `path → {mode, guid}`; the host is the only writer of `mode`, and every client reads it before deciding how to handle a path.
  2. No client decides a mode locally: a client that cannot meet the announced mode reports it and degrades (C32), and never subscribes the path in a different mode.
  3. Mode changes propagate to already-connected clients without a reconnect.
  4. The existing manifest replay behaviour and its `.canvas` guard are preserved.
- Definition of Done: two clients can no longer hold the same path in two different modes.
- Assigned to work package: **WP31**

#### C32 — Receive-and-Persist degradation mode
- Change type: create (degradation state) + modify (`vault-events.ts`, `canvas-sync.ts` subscribe path)
- Responsibility: define the worst case as "temporarily read-only for one file" instead of "two unrelated truths".
- Interfaces:
  - Input: a failure to reach full canvas mode (waitForSync timeout, doc error, schema-major mismatch)
  - Output: a read-only-but-persisting subscription with periodic retry
- Acceptance Criteria:
  1. A client that cannot reach full mode still subscribes the canvas doc read-only and `CanvasPersistence` keeps writing it to disk; no private API is required for this mode.
  2. Local edits to that path are refused with a user-visible notice, or overwritten by the next persistence write, and never captured into the shared doc.
  3. A periodic retry attempts full mode again and, on success, resumes normal operation without a reconnect and without data loss.
  4. The schema-major-mismatch degradation from WP8 is unified into this single mode — there is one degradation state, not two.
- Definition of Done: a degraded client is a reader, never a second writer.
- Assigned to work package: **WP32**
- Fuzzer link: WP23 "degraded replica" op — a replica in Receive-and-Persist emits **zero** updates for the run while still converging to the same state as every other replica.

#### C33 — REMOVAL: the R10 text fallback door
- Change type: delete (`warnCanvasTextFallback` `vault-events.ts:67–79` and its reset `:80–83`, the fallback branch in `subscribeCanvasWithHandover` `:113`, the `else` fallback in the modify fan-out, the deliberate `BackgroundSync.subscribe` `:88` door, the `CANVAS TEXT FALLBACK:` emitter) + release the orphaned `Y.Text` (R6)
- Responsibility: remove the split-brain door, now that Receive-and-Persist replaces it.
- Interfaces:
  - Input: none (removal)
  - Output: a `.canvas` path can never be handled by the text path
- Acceptance Criteria:
  1. No code path routes a `.canvas` path into `BackgroundSync` — the door at `BackgroundSync.subscribe` is closed and `skipsAutoTextSync` is consulted there too, making it the fifth consumer.
  2. A failed canvas subscribe results in Receive-and-Persist, never in a raw-text subscription; the `CANVAS TEXT FALLBACK:` signature and its emitter are removed together.
  3. Any `Y.Text` doc previously created for a canvas path is released rather than orphaned (R6), and a handover leaves no doc behind.
  4. Exactly one owner is preserved at all times (D7): the path is always owned by `CanvasSync`, in full or degraded mode. Tests pinning the removed fallback are deleted deliberately and enumerated by name.
- Definition of Done: the split-brain class is unreachable.
- Assigned to work package: **WP33**

#### C34 — Honest degraded reconcile mode
- Change type: modify (`main.ts:reconcileLiveCanvas` adapter-availability gate `:1053`, view mounting) + create (banner)
- Responsibility: make I5 apply to correctness, not just availability — a view that cannot be reconciled says so.
- Interfaces:
  - Input: adapter availability
  - Output: a marked view, a banner, and an `initial` reconcile on reopen
- Acceptance Criteria:
  1. When the private API is unavailable, the open view is marked non-reconcilable and a banner states that the live view is paused while the file stays in sync.
  2. Capture continues in that state and, thanks to the shadow, pushes nothing stale — the old structural revert machine of this mode does not occur.
  3. Reopening the view triggers an `initial` reconcile that brings it fully up to date.
  4. The banner appears only in this state, disappears when the adapter returns, and does not obstruct canvas interaction.
- Definition of Done: a degraded view is visibly paused rather than silently wrong.
- Assigned to work package: **WP34**

#### C35 — Chaos suite II (P2/P3 scenarios)
- Change type: create (named scenario suites)
- Responsibility: pin the session-boundary and mode scenarios with discrimination variants.
- Interfaces:
  - Input: injected sidecar and mode seams
  - Output: named deterministic suites
- Acceptance Criteria:
  1. A "host rejoin with an older sidecar" scenario shows the rejoin merging as related replicas with no peer work lost.
  2. A "fallback client beside an owned client" scenario is shown to be **impossible** after P3 (the degraded client is read-only), and the same scenario is shown to be **detected** in the pre-P3 configuration.
  3. Each scenario has a discrimination variant that fails when the mechanism is disabled through its injected seam.
  4. Both scenarios are deterministic — no wall-clock sleeps, seeds fixed.
- Definition of Done: the session-boundary and mode classes are covered by self-discriminating tests.
- Assigned to work package: **WP35**

---

### PHASE P4 — `Y.Text` node text, blur merge, undo

#### C36 — `Y.Text` for node text and edge labels
- Change type: modify (record shape, capture and apply paths)
- Responsibility: give the content that most needs sequence merging the only merge type that provides it.
- Interfaces:
  - Input: text changes from Obsidian saves (and, from P5, adapter ops)
  - Output: nested `Y.Text` updates via minimal diff
- Acceptance Criteria:
  1. A text node's `text` and an edge's `label` are nested `Y.Text` instances inside the record map, created once with the record and never replaced.
  2. Capture uses the existing minimal-diff mechanism including surrogate snapping; an unchanged text produces no update.
  3. Two clients typing concurrently into the same card converge character-wise on every replica, with no total loss of either side's input.
  4. Serialisation renders `Y.Text` back into a plain string in the file, and round-trips without change.
- Definition of Done: concurrent card editing merges instead of one side vanishing.
- Assigned to work package: **WP36**
- Fuzzer link: registers a `text-edit` op in WP23's op registry; SEC and byte-equality assertions must cover it.

#### C37 — `isBusy()` extended with inline editing, deferred apply and blur merge
- Change type: modify (`canvas-adapter.ts:isBusy` `:87`/`:572`, `main.ts:reconcileLiveCanvas` busy gate `:1054–1059`)
- Responsibility: stop structural reloads from destroying an active inline editor, without freezing the rest of the canvas.
- Interfaces:
  - Input: an "inline editor focused" signal
  - Output: per-record deferral with merge on blur
- Acceptance Criteria:
  1. `isBusy()` includes "inline editor focused" as a signal, and the existing drag watchdog behaviour and `DRAG_WATCHDOG_MS` default are unchanged.
  2. Structural applies for the record being edited are queued and applied on blur; applies for all other records continue immediately.
  3. Remote `Y.Text` changes to the record being edited are merged on blur, positionally correct, with no loss of locally typed characters.
  4. The queue cannot grow unboundedly and is drained on blur, on view close and on teardown.
- Definition of Done: typing is never interrupted, and nothing is lost by deferring.
- Assigned to work package: **WP37**

#### C38 — `Y.UndoManager` per client and doc
- Change type: create (undo wiring) + modify (`main.ts` command registration)
- Responsibility: give each client selective undo of its own actions, including lossless delete-undo.
- Interfaces:
  - Input: local undo/redo commands
  - Output: undo restricted to this client's own origins
- Acceptance Criteria:
  1. One `Y.UndoManager` exists per client and canvas doc with `trackedOrigins` limited to `CAPTURE_OP` and `CAPTURE_NET`.
  2. Undo reverts only this client's own last action, never a peer's, even when the peer's edit happened in between.
  3. Undo of a delete restores the record and all its field values through the tombstone flag, with no data loss.
  4. A drag burst is bundled into a single undo step via `captureTimeout`, and a multi-node drag is one step because it is captured as one transaction.
- Definition of Done: undo is per-client, selective and lossless.
- Assigned to work package: **WP38**
- Fuzzer link: registers an `undo` op in WP23's op registry.

---

### PHASE P5 — Op-capture as the primary source

#### C39 — Op-capture contract V2
<!-- Updated: AC5 appended — WP39 owns closing the optional-key-clear regression that I7 creates in P0 (§3.1 S14) 2026-07-31 -->
- Change type: modify (`canvas-binding.ts` `captureLocal` `:260–309`, `canvas-model-bridge.ts` `CAPTURE_TRIGGERS` `:88–93`, geometry helpers `:97–136`)
- Responsibility: renew the R1 contract under I7/I8 so op-capture becomes safe to use.
- Interfaces:
  - Input: patched adapter signals
  - Output: schema-validated upserts on atomic registers, stamped `CAPTURE_OP`
- Acceptance Criteria:
  1. Captures emit only observed fields, as upserts on atomic registers, and never delete a doc key; geometry is rounded before the register write.
  2. Every capture passes the ingest validator before writing; an invalid capture is rejected with a signature instead of reaching the doc.
  3. Captures advance the shadow, so the `CAPTURE_NET` safety net sees no diff for the same change — deduplication is structural, not timing-based.
  4. Both capture sources are distinguishable by transaction origin (`CAPTURE_OP` vs `CAPTURE_NET`), and the binding still performs no file I/O and imports nothing from Obsidian.
  5. Clearing an optional field (`color`, `label`) is expressible again: op-capture emits an **explicit field-clear** for the observed user action, which removes the value on every peer, and it is distinguishable from a mere non-observation — a capture that simply does not report the field still leaves it untouched (AC1). This closes the regression recorded as §3.1 **S14**, which P0 accepted knowingly because the save-diff net cannot make that distinction.
- Definition of Done: the mechanism that made R1 a blocker cannot recur.
- Assigned to work package: **WP39**
- Fuzzer link: the fuzzer's op registry must be able to drive capture through both origins and assert identical resulting doc state.

#### C40 — Promotion of op-capture to primary, gated on E2E verification
<!-- Updated: the verification AC1 demands is now a chartered WP (C54/WP40 dependency) and the owner's decision is that the gate can go green — promotion is real, not flag-off shipping; AC1–AC4 unchanged, AC5 added 2026-08-01 -->
- Change type: modify (`plugin/src/types.ts:65` default, `main.ts:814`, `main.ts:1262`)
- Responsibility: make op-capture the low-latency primary source — but only after the inferred trigger table is empirically confirmed.
- Interfaces:
  - Input: a green E2E verification of every `CAPTURE_TRIGGERS` assumption
  - Output: `useCanvasBinding` default `true`, with the net as the fallback layer
- Acceptance Criteria:
  1. Every `CAPTURE_TRIGGERS` assumption is confirmed empirically against a live Obsidian canvas — single move, **each** resize handle, multi-select drag, paste, text-node content edit, node add/delete, edge add/delete — and each result is recorded individually; an unconfirmed trigger blocks promotion.
  2. Only after that verification is `useCanvasBinding` defaulted to `true`; the `CAPTURE_NET` shadow diff remains active as the safety net and still catches anything the patched signals miss.
  3. With the flag on, a full two-vault E2E run is green, including the stale-view scenario from WP7.
  4. The abort criterion "`useCanvasBinding` default is no longer `false`" from the previous round is explicitly retired in this WP's report, with the verification evidence that justifies it.
  5. The evidence for AC1 is the trigger verdict ledger produced by WP54 and nothing else: this WP does not re-derive, re-interpret or partially accept it. A ledger containing any `UNCONFIRMED` entry blocks promotion and this WP stops with that entry named; a ledger containing a `CORRECTED` entry may license promotion only once the corrected mapping is the one `CAPTURE_TRIGGERS` actually carries.
- Definition of Done: the R2 verification debt is discharged at its most expensive point before it is relied upon.
- Assigned to work package: **WP40**
- **Promotion posture (owner decision, 2026-08-01):** the gate is expected to go green, and this WP is the real promotion — `useCanvasBinding` defaults to `true` once WP54's ledger is clean. Shipping P5 behind a permanently-off flag is explicitly **not** the intended outcome; that would preserve R1 under a different name. What the gate protects against is promoting on an *unverified* trigger table, not promoting at all.

---

### PHASE P6 — Relay blob persistence (in scope this run)

#### C41 — Relay per-`roomId:docId` blob store
- Change type: modify (`server/src/persistence.ts`, `server/src/ws-handler.ts`, `server/src/mux-protocol.ts`)
- Responsibility: let a room survive the absence of all peers without changing the trust model.
- Interfaces:
  - Input: incoming `MUX_SYNC` frames (possibly encrypted) and client checkpoint frames
  - Output: replay of stored frames to a later subscriber before live traffic
- Acceptance Criteria:
  1. Frames are appended per `roomId:docId` and stored **opaquely** — the relay never parses, decrypts or interprets frame contents, and encrypted frames are stored as received.
  2. A newly subscribing client receives the stored frames before any live traffic, and the resulting state equals that of a client that was present throughout.
  3. A client checkpoint frame allows truncation of everything it supersedes, and truncation never loses an update that the checkpoint does not contain.
  4. Replay is idempotent and order-insensitive: duplicated or reordered replays leave the client state unchanged, and no other relay subsystem (rooms, permissions, auth, audit) changes behaviour.
- Definition of Done: an empty room retains its docs without the relay learning anything.
- Assigned to work package: **WP41**
- Fuzzer link: WP23 "replay" op — duplicated and arbitrarily reordered replay of stored frames leaves every replica's state unchanged (idempotent, commutative delivery — the CRDT property the relay design relies on).

#### C42 — Client-side checkpoint frame and replay handling
- Change type: modify (`plugin/src/sync/mux-protocol.ts`, `plugin/src/sync/sync.ts`)
- Responsibility: emit checkpoints and consume replays on the client side.
- Interfaces:
  - Input: doc state and relay replay frames
  - Output: a checkpoint frame; a doc brought up to date before live traffic
- Acceptance Criteria:
  1. The client can emit a checkpoint frame carrying the full state as one update, on a documented trigger, and the frame is wire-compatible with the existing mux protocol (no breaking change to existing frame types).
  2. Replayed frames are applied before live traffic is processed, and the client's resulting state is identical whether it received a replay or synced from a live peer.
  3. A relay without blob support (older deployment) still works: the client detects the absence and falls back to the sidecar + peer path with no error surfaced to the user.
  4. Sidecar and relay persistence compose — either alone is sufficient, and both together produce no duplicate application.
- Definition of Done: "a brand-new client enters an empty room" is covered, and neither persistence layer depends on the other.
- Assigned to work package: **WP42**
- Fuzzer link: WP23 "replay + sidecar" composition — a replica restored from a replay, from a sidecar, or from both must reach the same state, with no update applied twice in effect.

---

### PHASE T3 — Real two-instance Obsidian orchestration (the Teil-14 live gate)

<!-- Updated: new phase — the owner decided to build T3 rather than weaken WP7; this section is the host layer the Teil-14 gate always presupposed 2026-08-01 -->

> **Why this phase exists.** CONCEPT_V2 Teil 14 makes "ein grüner Zwei-Vault-Lauf mit echtem Obsidian" a release condition from P0 onward, and from P5 additionally the empirical confirmation of every `CAPTURE_TRIGGERS` assumption. Neither was buildable: the earlier e2e-infra initiative deliberately scoped real-Obsidian orchestration out (*"T3 real-Obsidian CDP automation is OUT OF SCOPE this run"*, `e2e-infra/BUILD_SPEC_CanvasE2EInfra.md`), and `tools/launch_liveshare_e2e.py` therefore aliases the `obsidian` module to the headless mock and boots two lightweight plugin hosts. This phase builds the missing layer.
>
> **What already exists and is not rebuilt here.** The control protocol (HTTP on `127.0.0.1`, `POST /command` + `GET /events` SSE), its command set, the `E2EPluginLike` structural interface — which the real `LiveSharePlugin` already satisfies, so the *host* changes and the protocol does not — the `main.ts` `__LS_E2E__` bootstrap, the `setCanvasBindingInstrument` seam, and the `liveshare-e2e` MCP driver with its seven tools. T3 is a **host-launch, identity, safety and oracle** layer, not a new protocol.
>
> **Phase tags.** WP43–WP51 carry phase `P0` because they gate WP7, which is P0; WP52–WP54 carry phase `P5` because they gate WP40. They are grouped here because they are one body of work with one risk profile, not because they run together.
>
> **Verified environment facts for this phase — given, not to be re-derived.** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json`; the two target vaults are `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (note the spaces); the built plugin is already installed in the first. These are the owner's **live working vaults** — D16 applies without exception.
>
> **Test surface note for this phase.** The Python side of the rig has no vitest coverage and must not pretend to: its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, run through `visible-console` `run_python` with an absolute path. The `plugin/` vitest gate remains in force for every TypeScript change in this phase.

#### C43 — Vault registry and Obsidian instance discovery
- Change type: create (`tools/obsidian_e2e/vaults.py`, new read-only probe module)
- Responsibility: resolve the two target vaults and the state of anything already serving them, before the rig touches, starts or writes anything.
- Interfaces:
  - Input: the Obsidian vault registry (`%APPDATA%\obsidian\obsidian.json`) and the configured pair of vault paths
  - Output: one resolved instance descriptor per role (`a`, `b`) carrying vault path, registry identity, plugin-install state and whether Obsidian is already running on the host
- Acceptance Criteria:
  1. A configured vault path resolves to its registry entry for paths containing spaces and for paths differing only by case or a trailing separator; a configured vault that is absent from the registry produces an explicit named failure rather than a fallback guess.
  2. Per role the module reports whether the built plugin is present in that vault and whether it is enabled, and "present but disabled" is a distinct named state rather than a variant of missing.
  3. The module reports whether Obsidian is running on the host, and it never attributes a running process to a specific vault by process inspection — vault attribution is claimed only through the control endpoint (C46).
  4. The module performs no writes of any kind and this is structural rather than incidental: it exposes no write operation, opens no file for writing and starts no process.
- Definition of Done: the rig can state, before touching anything, exactly which two vaults it will drive and what already exists there.
- Assigned to work package: **WP43**

#### C44 — Per-vault control-port provisioning
- Change type: create (`tools/obsidian_e2e/ports.py`) + modify (`plugin/src/testing/e2e-control.ts` — `resolvePort` `:462–473`)
- Responsibility: give the two vault windows distinct control ports through the only channel that can distinguish them, and return each vault's plugin settings to exactly their prior state afterwards.
- Interfaces:
  - Input: the two resolved instance descriptors and the desired port pair (defaults 39421 / 39422)
  - Output: a provisioned per-vault port plus a restorable record of the exact prior settings state
- Acceptance Criteria:
  1. Each role's control port is provisioned through the plugin's per-vault settings file and not through a process environment variable, and the reason is recorded at the provisioning site: both vault windows may live in one Obsidian process, so `process.env` cannot differ between them (D14).
  2. The prior settings file is captured byte-exactly before modification and restored byte-exactly on teardown, including the case where no settings file existed before — in which case the rig's addition is removed and no file is left behind.
  3. Provisioning is idempotent: running it twice yields the same state and exactly one saved original, and an original saved by an earlier crashed run is still restorable on the next run rather than being overwritten by the current state.
  4. `resolvePort` keeps its existing precedence and gains no new dependency, and a vault with no provisioned port still starts no control server at all.
- Definition of Done: two plugin instances inside one process are independently addressable, and the owner's plugin settings survive every run unchanged.
- Assigned to work package: **WP44**

#### C45 — Real-Obsidian launch and attach lifecycle
- Change type: create (`tools/obsidian_e2e/lifecycle.py`, `tools/launch_obsidian_e2e.py` — the real-rig entrypoint) + modify (`tools/launch_liveshare_e2e.py` — self-identification as the headless rig)
- Responsibility: bring both vault windows into a state where their control endpoints are reachable, attaching to what is already open and launching only what is not.
- Interfaces:
  - Input: the two provisioned instance descriptors
  - Output: two reachable control endpoints plus a per-role record of whether the rig attached or launched
- Acceptance Criteria:
  1. Per role the rig attaches to an already-open vault window when its control endpoint answers and launches Obsidian for that vault only when it does not; which of the two happened is recorded per role in the run record.
  2. The rig never terminates, closes or restarts a process or window it did not itself start; a run that would require restarting an already-open vault stops with an explicit instruction to the operator instead of doing it (D15).
  3. Launching resolves the executable path rather than assuming it and opens the vault by URI with the vault name URL-encoded, so a vault path containing spaces is handled correctly.
  4. Every long-running or interactive process the rig starts is started through the workspace `visible-console` tools (`run_python` / `run_command`, then `await_console`) and never as a detached background shell process; the rig entrypoint is a Python script invoked by absolute path.
- Definition of Done: both roles reach a reachable control endpoint without the owner losing an open window or unsaved state.
- Assigned to work package: **WP45**

#### C46 — Readiness and instance-identity handshake
- Change type: modify (`plugin/src/testing/e2e-control.ts` — the `session.info` command `:122–144`, `buildPluginHost` `:356`) + create (`tools/obsidian_e2e/readiness.py`)
- Responsibility: replace "the port answered" with a positive identification of which vault, which build and which room each endpoint is, before any edit is issued.
- Interfaces:
  - Input: the two control endpoints
  - Output: a readiness verdict carrying both identities, or a named refusal
- Acceptance Criteria:
  1. `session.info` additionally reports the vault identity the instance serves, the plugin build identity and whether a canvas view surface is available; the added fields change nothing in production and the whole `src/testing/` module still tree-shakes out.
  2. Readiness requires, within a bounded timeout, that both endpoints answer, report **different** vault identities, and report the **same** room; any of the three failing aborts the run under a distinct named reason and no edit is issued.
  3. Readiness is a positive assertion rather than an absence of error: a timeout, a partially initialised instance, or an endpoint reporting a vault that is not one of the two configured ones each prevent the run from proceeding.
  4. The same check is re-runnable mid-run and is reused by teardown to confirm the endpoints are gone.
- Definition of Done: it is structurally impossible for a run to drive one vault twice, or to drive a vault nobody intended.
- Assigned to work package: **WP46**

#### C47 — Scratch canvas lifecycle and vault data safety
- Change type: create (`tools/obsidian_e2e/scratch.py`) + modify (`plugin/src/testing/e2e-control.ts` — scratch-canvas create/remove commands)
- Responsibility: give every run its own disposable canvas and establish that the two working vaults are left exactly as they were found.
- Interfaces:
  - Input: the two ready instances and a run identifier
  - Output: one scratch canvas path per vault plus a before/after vault fingerprint pair
- Acceptance Criteria:
  1. Each run creates a uniquely named `.canvas` file inside a rig-owned folder in each vault, and at no point of a run is any pre-existing note, canvas or attachment opened for writing.
  2. The scratch file and the rig-owned folder are removed on teardown, including after a failed, aborted or interrupted run.
  3. A vault fingerprint taken before the run equals the one taken after teardown apart from the scratch artefacts, and a mismatch fails the run — this comparison is part of the run's verdict, not an optional diagnostic (D16).
  4. The scratch name is derived so two concurrent runs cannot collide, and a stale scratch artefact left by an earlier crashed run is detected and removed at start-up rather than reused.
- Definition of Done: the owner's two working vaults are provably unchanged by any run, including a failed one.
- Assigned to work package: **WP47**

#### C48 — Teardown, crash recovery and orphan reclaim
- Change type: create (`tools/obsidian_e2e/teardown.py`) + modify (`tools/launch_obsidian_e2e.py`)
- Responsibility: make a real-Obsidian run end in a known state whatever happens, including when Obsidian hangs, crashes or is closed by the owner mid-run.
- Interfaces:
  - Input: whatever the run acquired — provisioned settings, scratch artefacts, started processes
  - Output: a released state plus a run verdict that a partial run cannot report as green
- Acceptance Criteria:
  1. Teardown runs exactly once on every exit path — success, assertion failure, exception and interruption — and performs the same steps in the same order: restore provisioned settings, remove scratch artefacts, stop only rig-started processes.
  2. Every wait in the rig is bounded and names the condition it was waiting for when it expires; no wait can block a run indefinitely.
  3. An endpoint that stops answering mid-run fails the run under a named reason and still completes teardown, and the run's exit status is non-zero — a partially executed run can never be reported as a green gate result.
  4. Artefacts of a previous crashed run — a provisioned port setting, a scratch file, a bound but dead port — are detected at start-up and reclaimed, and reclaiming is idempotent.
- Definition of Done: a crashed run costs a re-run and never a dirty vault, a lost setting or a stuck port.
- Assigned to work package: **WP48**

#### C49 — Real quiescence and file-level convergence oracle
- Change type: modify (`plugin/src/testing/e2e-control.ts` — `sync.waitQuiescent` `:438–451`, the activity `bump` seam `:507`, `canvas.state` `:...`)
- Responsibility: make "settled" and "converged" mean something on a host where edits also arrive from the user, the relay and the disk writer.
- Interfaces:
  - Input: doc activity from every origin, and the canvas content the plugin's own writer produced
  - Output: a quiescence signal that reflects real activity, and a file-level convergence oracle alongside the doc-level one
- Acceptance Criteria:
  1. Quiescence observes actual document activity from any origin rather than only control-initiated commands; an update arriving from the peer or from a user interaction keeps the instance non-quiescent until it settles.
  2. Convergence can be asserted on the serialised `.canvas` file content of both vaults in addition to the doc state, and a run that converges in the doc but not on disk fails (D17).
  3. The file-level read-back reports the content the plugin's own writer produced and does not itself write, touch, re-serialise or normalise the file — the single-writer invariant is not weakened by an oracle.
  4. Both oracles are reachable through the existing control protocol, with no new transport and no new runtime dependency.
- Definition of Done: a green run means the two vaults hold the same canvas on disk, not merely the same doc in memory.
- Assigned to work package: **WP49**

#### C50 — Run matrix bound to the real hosts
- Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_wait_both` `:134`, `assert_converged` `:280`, `run_matrix` `:402`)
- Responsibility: let the existing MCP driver run its matrix against two real Obsidian instances without carrying assumptions that only held for the mock host.
- Interfaces:
  - Input: the two real endpoints and the run's scratch canvas
  - Output: a per-case verdict naming the oracle that decided it
- Acceptance Criteria:
  1. The driver settles on the C49 quiescence signal and asserts on the C49 file-level oracle in addition to the doc oracle, and carries no assumption that only held for the lightweight host.
  2. Each matrix case runs against the run's scratch canvas and leaves the doc in a state no later case depends on, so a case failure localises to that case rather than cascading.
  3. Each case reports which oracle decided its verdict, and a case whose oracles disagree or whose gesture did not take effect is reported as inconclusive rather than as a pass.
  4. The existing tool surface and argument shapes are unchanged for existing callers, and no new runtime dependency is introduced.
- Definition of Done: `run_matrix` becomes a statement about two real Obsidian instances.
- Assigned to work package: **WP50**

#### C51 — Stale-view scenario surface
- Change type: modify (`plugin/src/testing/e2e-control.ts` — `canvas.setFlag` `:425–436` and its runtime-flag map)
- Responsibility: make the one scenario WP7 must demonstrate — an Obsidian save on a deliberately stale view — reproducible as a command sequence on a real instance.
- Interfaces:
  - Input: a named instance and the run's scratch canvas
  - Output: a stale-view state that can be entered, observed and left, and a save performed by the instance itself
- Acceptance Criteria:
  1. A control command puts a named instance into a state where its canvas view is deliberately not advanced by incoming remote changes, a second command returns it to normal, and the current state is observable through the protocol.
  2. A control command causes the instance to perform an Obsidian save of the scratch canvas while in that state, with the rig never writing the file itself.
  3. A runtime flag the control server accepts is actually read by the code path it names; a flag no path consults is rejected at the command boundary rather than silently stored.
  4. The scenario reuses the injected seams the chaos suite already requires and adds no test-only branch to any production canvas module.
- Definition of Done: WP7 AC2's third demonstration is a command sequence, not a manual procedure.
- Assigned to work package: **WP51**

#### C52 — Adapter interaction tap over the control protocol
- Change type: modify (`plugin/src/testing/e2e-control.ts` — instrument install `:501–505`, SSE emission `:259–271`; `plugin/src/canvas/canvas-adapter.ts` — `onNodeInteractionStart` / `onNodeInteractionEnd` `:107–109`, patched signal set `:240–245`)
- Responsibility: make the patched Obsidian signals themselves observable, so the trigger table can be measured instead of inferred.
- Interfaces:
  - Input: the adapter's patched signals and the binding's capture counters
  - Output: an ordered, path-scoped event stream over the existing SSE channel
- Acceptance Criteria:
  1. Every fire of a patched adapter signal is emitted as a control event carrying which signal fired, the entity ids it concerned and a monotonically increasing sequence number, so a gesture's signal sequence can be reconstructed in order.
  2. Binding-counter events carry the canvas path they belong to, so events originating from two open canvases are distinguishable.
  3. The tap adds nothing when it is not installed: with the control module absent the adapter's signal paths are unchanged in the production bundle and `src/testing/` still tree-shakes out.
  4. Emitting a tap event cannot cause, suppress, delay or reorder a capture — the observation is passive, and this is asserted rather than assumed.
- Definition of Done: what Obsidian actually fires is recorded rather than assumed.
- Assigned to work package: **WP52**

#### C53 — Gesture driver for the trigger set
- Change type: modify (`plugin/src/testing/e2e-control.ts` — a new input-gesture command family)
- Responsibility: perform, on a real Obsidian canvas, each interaction the trigger table makes a claim about.
- Interfaces:
  - Input: a named instance, its scratch canvas and a gesture description
  - Output: a per-gesture report of what the gesture did to the model, kept separate from what signals it produced
- Acceptance Criteria:
  1. The driver can perform on the scratch canvas of a named instance each interaction the trigger table makes a claim about: a single node move, a resize on **each** individual handle, a multi-select drag, a paste, a text-node content edit, a node add, a node delete, an edge add and an edge delete.
  2. Each gesture is driven at the input layer of the real view — the interaction is performed, never the signal it is supposed to produce — so whichever signal Obsidian fires is a measurement rather than an input of the run (D18).
  3. Each gesture reports whether it actually took effect (the model changed as the gesture intended) separately from which signals it produced, so a gesture that silently did nothing can never be read as "this interaction fires no trigger".
  4. A gesture that cannot be driven faithfully from inside the renderer is reported as operator-required rather than approximated, and the run carries an explicit protocol for the operator to perform it while the tap records.
- Definition of Done: every claim the trigger table makes has a gesture that can produce it, or an honest statement that only a human can.
- Assigned to work package: **WP53**

#### C54 — `CAPTURE_TRIGGERS` empirical verification and verdict ledger
- Change type: create (`workflowArtifacts/canvas-v2/CaptureTriggerLedger.md`, the verification run) + modify (`plugin/src/canvas/canvas-model-bridge.ts` — `CAPTURE_TRIGGERS` `:88–93` and its assumption warning)
- Responsibility: execute the trigger verification CONCEPT_V2 Teil 14 demands and record a per-trigger verdict WP40 can be gated on.
- Interfaces:
  - Input: the C52 tap stream and the C53 gestures against two real instances
  - Output: a per-interaction verdict ledger and, where the measurement disagrees with the assumption, a corrected `CAPTURE_TRIGGERS`
- Acceptance Criteria:
  1. For every interaction in the trigger table — single move, each resize handle individually, multi-select drag, paste, text-node content edit, node add, node delete, edge add, edge delete — the run records by name which patched signal or signals fired, in which order, whether a capture followed, and the resulting verdict.
  2. Each interaction's verdict is exactly one of CONFIRMED (the assumed signal fired and capture followed), CORRECTED (a different signal is the committing one, and the corrected mapping is stated) or UNCONFIRMED (no signal observed, or the gesture could not be performed), and an UNCONFIRMED entry blocks promotion.
  3. The ledger records for each entry how it was produced — driven gesture or operator-performed — together with the run environment, and re-running the verification either reproduces the verdicts or the difference is itself recorded as a finding.
  4. Where a corrected mapping is found, `CAPTURE_TRIGGERS` is updated to the measured set and its "inferred, not certified" warning is replaced by the measurement and its date; where an interaction fires neither patched signal, that is recorded as the explicit reason promotion cannot proceed for it.
  5. The ledger is the sole evidence WP40 AC1 consults, and it is complete or it is not evidence: a partial ledger is not a weaker pass but a blocked gate.
- Definition of Done: the trigger table is measured rather than inferred, and the P5 gate has one auditable evidence artefact.
- Assigned to work package: **WP54**

---

## 6. API and Interfaces

- **Tool surfaces / commands:** one new user command, "Aus Datei importieren" (Import from file, WP30), plus the existing canvas commands unchanged.
- **Wire protocol:** unchanged through P5. P6 adds a checkpoint frame type to the mux protocol; existing frame types keep their meaning and encoding, and an older relay must remain usable (WP42 AC3).
- **Doc-level interfaces:** `meta`, `nodes`, `edges`, `deleted` (§4.2). Doc id `__canvas__:<guid>` from P2.
- **Manifest interface:** gains `path → {mode, guid}` (WP31) and the `path → guid` mapping (WP27).
- **Sidecar interface:** `.obsidian/liveshare/state/<guid>.yhistory`, `<guid>.ycheckpoint`, `index.json` (`path → guid → epoch`).
- **Authentication / authorisation:** unchanged. `canWriteCanvasPath` (read-only permission, guest globs) stays; the *lock* write-gates are removed (§3.1 S5). Relay auth is untouched, including in P6.
- **Error cases and expected responses:**

| Case | Expected behaviour |
|---|---|
| Invalid record from a local source | rejected at ingest with a signature; never enters the doc |
| Invalid record arriving as a remote delta | accepted into the doc, then quarantined by the auditor; released automatically when repaired |
| Sidecar missing or corrupt | client behaves as a fresh peer; state from peers, or an epoch-aware seed if alone |
| Same guid, different epoch | higher epoch wins; loser archives `<name>.conflict-<date>.canvas` and notifies |
| Schema major mismatch | Receive-and-Persist; the client never guesses a translation |
| Private API unavailable | view marked non-reconcilable + banner; capture continues; `initial` reconcile on reopen |
| Cannot reach full canvas mode | Receive-and-Persist with periodic retry; never a text-mode fork |
| Relay without blob support | client falls back to sidecar + peers, no user-visible error |

- **Persistence behaviour:** `CanvasPersistence` remains the single CRDT→disk writer; a remote delta produces exactly one disk write; `CanvasPersistence` emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`. Worst-case data loss remains one debounce window (`MAX_WAIT_MS = 500`).

---

## 7. Quality Gates

<!-- Updated: WP4 added to the licensed-deletion list with its three named tests, so P0 can close green without an unexplained drop 2026-07-31 -->

- **Lint / typecheck / test commands** (from `plugin/`, per RepoMap `## Build & Test Commands`):
  1. `npm run build` — `tsc -noEmit -skipLibCheck` + esbuild production bundle. Must PASS.
  2. `npm test` — `vitest run`. Must be 0 failed.
  3. `npm run lint` — `biome check .`. Advisory locally, **gating in CI**.
  - From `server/` (WP41 only): `npm run build` (`tsc`) then `npm test` (`vitest run`).
  - Headless mock-host rig (fast, no vault, **not the gate**): `python tools/launch_liveshare_e2e.py` from the repo root.
  - <!-- Updated: T3 2026-08-01 --> Live real-Obsidian rig (WP7, WP40, WP54 — **this is the gate**): the T3 entrypoint `tools/launch_obsidian_e2e.py`, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap makes any other invocation unreliable on this host), then `await_console`. Never a Bash background process.
- **Execution order:** build → test → lint. A build failure aborts before tests are attempted.
- **Runner facts implementors must not re-derive:**
  - Vitest **4.0.18**. The `basic` reporter was removed in Vitest 4 — `--reporter=basic` fails with `ERR_LOAD_URL`. Use the default reporter or `--reporter=dot`.
  - `wp5/latency.test.ts` deliberately sleeps 33.5 s. Total wall time ≈41 s is a floor, not a hang. Budget **≥90 s** for any automated invocation.
  - `vitest.config.ts` sets `test: {}` — every `*.test.ts` under `src/` runs, including `e2e/two-host.test.ts`. The only config that matters is the `obsidian` → `src/__mocks__/obsidian.ts` alias.
  - CI runs `npm ci && npm run lint && npm run build && npm test` for both packages on node 20.x and 22.x.
- **Test baseline and the deletion ledger** (supersedes the earlier `≥ 526` floor, §3.1 S13): the measured baseline is **674 tests / 35 files, 0 failed** (plugin) and **122 tests / 10 files** (server). The gate is **0 failed**, plus: the suite may only shrink through deletions that a WP enumerates by name in its implementation report as pinning a deliberately removed behaviour (WP21, WP22, WP33 are the only WPs expected to delete tests). An unexplained drop in test count is an abort criterion.
- **Deletion ledger — amendment 2026-07-31 (supersedes the parenthetical above).** The licensed-deletion list is **WP4, WP21, WP22, WP33**. WP4 was missing because §4.6 originally traced I7 to P1 only; it in fact lands I7 for the capture boundary in P0 (§3.1 S4, §4.6), which retires the probes that pinned the opposite behaviour. Everything else about the ledger is unchanged — a deletion is licensed only when the WP enumerates it by name in its implementation report, and an unenumerated drop is still an abort criterion.

  | WP | Tests deleted | File | Reason | Replacement coverage |
  |---|---|---|---|---|
  | WP4 | `A4`, `A9`, `A10` | `plugin/src/__tests__/w4-canvas-integrity.test.ts` | They assert that a save omitting a field deletes that field from the CRDT. I7 forbids exactly that on the capture path from P0 (C4 AC1 + C2). A9/A10 are additionally **unfalsifiable** after WP4, not merely failing: they disarm `PROTECTED_KEYS`, and that guard is no longer read anywhere on `handleLocalModify`, so mutating it cannot change the outcome they assert. | C4 AC6 relocates the endpoint-discrimination pair to a boundary where the guard is still live. A4 has **no** replacement — that is the accepted regression recorded as §3.1 S14, owned by WP39 AC5. |
  | WP21 | (enumerated at implementation time) | — | C21 AC4 | — |
  | WP22 | (enumerated at implementation time) | — | C22 | — |
  | WP33 | (enumerated at implementation time) | — | C33 | — |

  **Expected arithmetic for the P0 close:** the plugin baseline of 674 becomes **671** after WP4's three deletions; the P0 batch's own additions and the concurrent WP41/WP42 additions sit on top, and the gate remains **0 failed**. A P0 handover reporting three failures in `w4-canvas-integrity.test.ts` is now a stale run, not a passing state.
- **Abort criteria:**
  - `npm run build` fails, or `npm test` reports any failure.
  - Test count drops without a matching entry in the deletion ledger.
  - `GEOMETRY_KEYS` changes membership or loses its export (§3.1 S2) — ESCALATE instead.
  - `canvas-presence.ts` is modified (WP21 AC2 requires it byte-unchanged) — ESCALATE.
  - Logic (not wiring) is added to `main.ts` (§3.1 S11) — ESCALATE.
  - Any WP before WP39 modifies `canvas-binding.ts` / `canvas-model-bridge.ts` outside WP22's narrow removal, or any WP before WP40 flips `useCanvasBinding` — ESCALATE.
  - A new **runtime** dependency is proposed (D11), or any dependency whose published version is **less than 7 days old** is introduced (workspace npm policy). Use `npm ci` in build/deploy contexts, never `npm install`.
  - `server/` source is touched by any WP other than WP41.
  - The plugin version is bumped (it stays as found; the pre-existing 0.6.0/0.6.1 discrepancy is recorded, not resolved, here).
- **Definition of Done (project-level):** <!-- Updated: 54 WPs; the two live gates now name their evidence artefacts 2026-08-01 --> all 54 WPs DONE; build + tests green with the deletion ledger accounted for; the convergence fuzzer green over its configured budget with every registered op class exercised; both chaos suites green including their discrimination variants; a green two-vault run against **real Obsidian** recorded by the T3 entrypoint (WP7, incl. its vault-fingerprint check); and a complete `CaptureTriggerLedger.md` with no `UNCONFIRMED` entry (WP54) licensing the promotion in WP40.
- **Data-safety gate (new, 2026-08-01):** every real-Obsidian run is subject to the before/after vault fingerprint of C47 AC3. A run that leaves either of the owner's two working vaults changed outside its own scratch artefacts is a **failed** run regardless of its functional result, and is an abort criterion for the WP that performed it.
- **Test framework and test runner:** Vitest 4.0.18, pure-function + injected-seam style, discrimination tests as the established pattern.
- **worker4_mode:** `full`
  - Rationale: the project has a real UI surface (the Obsidian canvas view, the degraded-mode banner, the import confirmation dialog) and, more decisively, CONCEPT_V2 Teil 14 promotes the two-vault E2E rig to a mandatory release gate from P0 onward. Level 1–2 alone would repeat exactly the W10 verification gap this initiative exists to close.

---

## 8. Validation and Test Strategy

- **Test levels:**
  - **Unit / pure-function** — every pure core WP (WP1, WP2, WP3, WP9–WP17, WP23's own harness logic, WP24). This is the bulk, and the pure-core/wiring split exists to make it possible.
  - **Integration with injected seams** — every wiring WP, using the existing two-peer harness, canvas double and interaction driver.
  - **Property-based convergence fuzzing** — WP23, across 3–5 replicas.
  - **Chaos scenarios with discrimination variants** — WP6 and WP35.
  - **Live E2E** — WP7 (gate from P0) and WP40 (trigger verification before promotion). <!-- Updated: T3 2026-08-01 --> The host layer both depend on is WP43–WP51; the trigger measurement itself is WP52–WP54. The Python side of that rig is verified by standalone `python tools/test_<name>.py` scripts (workspace convention), not by vitest — every TypeScript change in the phase still goes through the `plugin/` vitest gate.
- **Test data sources:** deterministic generators seeded explicitly (fuzzer), fixed fixtures for parse/serialize round-trips, the existing harness doubles. No ad-hoc or LLM-generated data; no wall-clock sleeps in new tests.
- **Acceptance criteria:** referenced from §5, restated verbatim in each TaskCharter's section 4.
- **Discrimination requirement:** every new mechanism ships at least one test that fails when the mechanism is disabled through its injected seam. This is the repo's most valuable existing pattern and is mandatory for V2 mechanisms.
- **Known flaky areas / patterns to avoid:**
  - Timing-based echo suppression. V2's echo breaker is byte equality; no new `setTimeout`-based waits, no new timing constants.
  - Wall-clock sleeps in tests (the existing 33.5 s sleeper is legacy, not a pattern to copy).
  - Two-peer-only reasoning: interleaving classes from three peers upward are demonstrably distinct — the fuzzer must never run with 2 replicas.
  - Asserting on log strings as the primary oracle; logs are signatures for humans, state is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat to "fix" it.

---

## 9. Work Package Breakdown

Ordered list — this is a valid topological order and is the sequence the Dispatcher hands to Worker 3.

| WP | Phase | Title | Scope summary | Depends on | Status |
|---|---|---|---|---|---|
| WP1 | P0 | Surface-Shadow core | new headless field-granular shadow module | — | planned |
| WP2 | P0 | Shadow-relative intent diff | pure 4-rule intent/staleness classifier | WP1 | planned |
| WP3 | P0 | Canonical form core | canonical serialisation + capture-side rounding | — | planned |
| WP4 | P0 | Capture re-based on the shadow | replace the `lastWrittenContent` diff basis; byte echo breaker | WP1, WP2, WP3 | planned |
| WP5 | P0 | Per-field apply receipt | `canvasApplied` → field shadow; per-field advance | WP1, WP2 | planned |
| WP6 | P0 | Chaos suite I | cascade + degraded-mode scenarios with discrimination | WP4, WP5 | planned |
| WP7 | P0 | E2E rig as mandatory gate | first green two-vault run; gate documented | WP4, WP5 | planned |
| WP8 | P1 | `meta` + schemaVersion + V1→V2 migration | doc metadata, version gate, in-place migration | WP4 | planned |
| WP9 | P1 | Atomic `pos`/`size` registers | composite LWW geometry | WP8 | planned |
| WP10 | P1 | Atomic `from`/`to` registers | composite LWW endpoints | WP8 | planned |
| WP11 | P1 | Write-once `type` guard | immutable type after creation | WP8 | planned |
| WP12 | P1 | Tombstone map core | `deleted` container, LWW flag, suppression predicate | WP8 | planned |
| WP13 | P1 | Fractional `ord` allocator | jitter + clientID tiebreak, total order | WP8 | planned |
| WP14 | P1 | Ingest schema validator | node/edge validity, local-vs-remote asymmetry | WP9, WP10, WP11 | planned |
| WP15 | P1 | Shadow at register granularity | shadow + intent diff lifted to V2 registers | WP2, WP9, WP10 | planned |
| WP16 | P1 | `parseCanvas` V2 + `ord` capture | V2 parse; conservative minimal reordering | WP9, WP10, WP13 | planned |
| WP17 | P1 | Canonical serializer V2 | `(ord,id)` sort, register expansion, `ord` not written | WP3, WP9, WP10, WP13 | planned |
| WP18 | P1 | Ingest + create-once wiring | validation at every write boundary; single-transaction creation | WP14, WP16, WP17 | planned |
| WP19 | P1 | Tombstone wiring | delete/undo/resurrect/cascade via tombstones | WP12, WP15, WP18 | planned |
| WP20 | P1 | Quarantine auditor | audit log-only → idempotent repair | WP12, WP14, WP19 | planned |
| WP21 | P1 | REMOVAL: lock write-denial seam | `canWriteEntity`, baseline-hold, `LOCK DENIED:` | WP9, WP10, WP19 | planned |
| WP22 | P1 | REMOVAL: `writeRecordMinimal` deletion | binding writes become upsert-only | WP14, WP18 | planned |
| WP23 | P1 | Convergence fuzzer | 3–5 replicas, pluggable ops, four assertion families | WP17, WP19, WP20 | planned |
| WP24 | P2 | Sidecar store core | append/checkpoint/truncate/load, corrupt tolerance | WP8 | planned |
| WP25 | P2 | Sidecar lifecycle + compaction | load-before-sync, update capture, GC | WP24 | planned |
| WP26 | P2 | Sidecar exclusion | excluded from manifest, sync, text-sync detection | WP24 | planned |
| WP27 | P2 | GUID identity + rename + `getDoc` guards | doc id by guid; path stays the registry key | WP8, WP24 | planned |
| WP28 | P2 | Epoch rule + conflict archive | higher epoch wins; loser archives a copy | WP27 | planned |
| WP29 | P2 | Seed-once + REMOVAL of destructive re-seed | I9 seeding rule; R4 eliminated | WP25, WP27 | planned |
| WP30 | P2 | "Import from file" command | epoch++, confirmation dialog | WP28, WP29 | planned |
| WP31 | P3 | Room-level mode consensus | manifest `path → {mode, guid}`, host-authorised | WP27 | planned |
| WP32 | P3 | Receive-and-Persist mode | read-only degradation with retry; unifies version mismatch | WP31 | planned |
| WP33 | P3 | REMOVAL: R10 text fallback door | fallback + R6 orphaned `Y.Text` removed | WP32 | planned |
| WP34 | P3 | Honest degraded reconcile mode | non-reconcilable marking + banner + reopen reconcile | WP32 | planned |
| WP35 | P3 | Chaos suite II | host rejoin, fallback-coexistence, with discrimination | WP29, WP33 | planned |
| WP36 | P4 | `Y.Text` node text and edge labels | nested sequence CRDT + minimal diff | WP18, WP19 | planned |
| WP37 | P4 | `isBusy` + deferred apply + blur merge | editing-aware busy predicate, per-record queue | WP36 | planned |
| WP38 | P4 | `Y.UndoManager` | per-client selective undo, lossless delete-undo | WP19, WP36 | planned |
| WP39 | P5 | Op-capture contract V2 | upsert-only, atomic registers, validated, rounded | WP15, WP18, WP22 | planned |
| WP40 | P5 | Promote op-capture to primary | trigger verification then `useCanvasBinding` default on | WP7, WP39 | planned |
| WP41 | P6 | Relay blob store | opaque per-`roomId:docId` append + replay + truncate | WP25 | planned |
| WP42 | P6 | Client checkpoint + replay | checkpoint frame, replay-before-live, graceful fallback | WP41 | planned |
| WP43 | P0 | Vault registry + instance discovery | read-only resolution of the two vaults and what already serves them | — | planned |
| WP44 | P0 | Per-vault control-port provisioning | per-vault settings port, byte-exact capture and restore | WP43 | planned |
| WP45 | P0 | Real-Obsidian launch + attach lifecycle | attach to open windows, launch only what is missing | WP43, WP44 | planned |
| WP46 | P0 | Readiness + instance-identity handshake | positive identification of vault, build and room | WP45 | planned |
| WP47 | P0 | Scratch canvas + vault data safety | disposable canvas per run, before/after vault fingerprint | WP43, WP46 | planned |
| WP48 | P0 | Teardown, crash recovery, orphan reclaim | one teardown path, bounded waits, reclaim of stale state | WP45, WP46 | planned |
| WP49 | P0 | Real quiescence + file-level oracle | activity-based quiescence; convergence asserted on disk | WP46 | planned |
| WP50 | P0 | Run matrix bound to real hosts | MCP driver on real endpoints, per-case oracle verdict | WP47, WP48, WP49 | planned |
| WP51 | P0 | Stale-view scenario surface | deliberate stale view + instance-performed save | WP6, WP47, WP49 | planned |
| WP52 | P5 | Adapter interaction tap | ordered, path-scoped signal events over the control protocol | WP39, WP46 | planned |
| WP53 | P5 | Gesture driver for the trigger set | real input-layer gestures for every claimed trigger | WP47, WP52 | planned |
| WP54 | P5 | `CAPTURE_TRIGGERS` verification + ledger | per-trigger verdict ledger; corrected mapping if measured | WP7, WP39, WP52, WP53 | planned |

<!-- Updated: WP7 and WP40 dependencies extended onto the T3 layer 2026-08-01 -->
**Amended dependencies (2026-08-01).** Two existing rows above are superseded by this line and nothing else about them changes:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5 | WP4, WP5, **WP50, WP51** |
| WP40 | P5 | Promote op-capture to primary | WP7, WP39 | WP7, WP39, **WP54** |

**On the count.** The decomposition target given for this run was 20–35 work packages; the honest result is 42. The drivers are structural, not stylistic: P6 is in scope (2 WPs), the Teil 14 test strategy is three separate deliverables split across the phases that make them meaningful (4 WPs), three removals are chartered separately by requirement (WP21, WP22, WP33), and the pure-core/wiring split mandated by D12 roughly doubles P1. Compressing to 35 would require re-merging pure cores with their wiring, which is exactly the property that makes these units headless-testable. The count is reported rather than hidden.

<!-- Updated: T3 amendment 2026-08-01 -->
**On the count, amended (2026-08-01).** The count is now **54**. The twelve added WPs are the T3 host layer (§5 PHASE T3). They were not an oversight in the original decomposition: the original spec assumed `tools/launch_liveshare_e2e.py` was the rig CONCEPT_V2 Teil 14 refers to, and it is not — it is a headless mock-host rig that scopes real-Obsidian orchestration out by design. WP7 was therefore chartered against a rig that did not exist, and Worker 3 correctly refused to run the substitute. The twelve WPs are the honest cost of the gate the concept always specified; they are fine-grained because a real-Obsidian run is slow and stateful, so a failure must localise to one layer (discovery, provisioning, launch, identity, safety, teardown, oracle, driver) rather than to "the rig".

---

## 10. Operational Rules

- **Logging — the declared signature set after V2.** Every signature has exactly one production emitter.

| Signature | Status | Owner |
|---|---|---|
| `SCATTER:` / `DETACH:` / `NO TYPE:` | kept | quarantine auditor (WP20) |
| `LOCK REVERT:` | kept | `main.ts:revertCanvasNode` |
| `AWARENESS GAP:` | kept | `sync.ts` |
| `DRAG WATCHDOG:` / `ADAPTER PATCH:` | kept | `canvas-adapter.ts` |
| `CANVAS WRITER:` | kept | `canvas-persistence.ts` |
| `LOCK DENIED:` | **retired** | removed with WP21 |
| `CANVAS TEXT FALLBACK:` | **retired** | removed with WP33 |
| `SHADOW STALE:` | new | WP4 — a discarded staleness observation |
| `QUARANTINE:` | new | WP20 — quarantine set / released |
| `SIDECAR:` | new | WP24/WP25 — load, compaction, degradation |
| `EPOCH CONFLICT:` | new | WP28 — with both epoch values |
| `MODE:` | new | WP31/WP32 — mode announcement and degradation |

- **Monitoring:** the debug ring buffer plus the optional file sink remain the only observation channel; no telemetry is added. No per-frame logging in hot paths.
- **Recovery / backups:** the sidecar is the client-side recovery path; the conflict copy (`<name>.conflict-<date>.canvas`) is the user-visible archive; the relay blob store (P6) is the room-side recovery path. None of the three is a prerequisite of another.
- **Security and access rules:** the relay stays content-blind — P6 stores opaque frames and must not parse or decrypt them. No secret ever passes through an agent tool or a command string. `SERVER_PASSWORD`, `docker/.env` and the deploy stack are out of scope and must not be read. The protected NA infrastructure (`neural-angels-access`, `n8n`) is never touched.
- **Dependency policy:** zero new runtime dependencies (D11). Any dependency change requires a publish date ≥7 days old, verified with `npm view <pkg>@<version> time.created`. `npm ci` in all build/deploy contexts; `npm install` only for a deliberate local add.
- **Build output:** `plugin/main.js` and `server/dist/` are committed build artifacts — never hand-edited, always regenerated with `npm run build`. `plugin/manifest.json` is a broken symlink; the real manifest is the repo-root one. Do not read or edit the symlink.

---

## 11. Repeated-Action Signals and Automation Candidates

Filled in progressively as Worker 3 runs telemetry reviews.

| Repeated action | Tool / command | Frequency | Friction / failure | Automation candidate |
|---|---|---|---|---|
| | | | | |

---

## Architect Checklist (Worker 2)

- [x] Project overview and non-goals aligned with the user's stated intent (all of P0–P6 incl. P6, all of Teil 14, nothing deferred)?
- [x] All components in scope defined with interfaces and ACs (C1–C42)?
- [x] Every AC observable and testable without asking the author?
- [x] Architecture decisions documented with rationale (D1–D12) and prior-decision conflicts resolved explicitly (S1–S13)?
- [x] Data models and flows complete (§4, incl. the field-by-field merge policy)?
- [x] Invariants I1–I5 preserved and I6–I10 each traceable to at least one WP (§4.6)?
- [x] API surfaces specified (§6)?
- [x] Work package breakdown defined in a valid topological order (§9)?
- [x] Quality gates, abort criteria and `worker4_mode = full` documented (§7)?
- [x] Out-of-scope items each carry a reason (§2)?
- [x] Graph basis (FALLBACK, RepoMap) noted (§3)?
- [x] BUILD_SPEC saved as `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md`?
