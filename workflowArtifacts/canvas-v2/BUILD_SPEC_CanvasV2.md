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
| `from` = `{node, side?, end?}` | one LWW register | atomic LWW | An edge endpoint is one unit. **`node` alone decides presence; `side` and `end` are optional components carried inside the one value.** |
| `to` = `{node, side?, end?}` | one LWW register | atomic LWW | `from` ⊥ `to`; re-routing both ends commutes. Same optionality. |

<!-- Updated: E1 ruling — `side` marked optional; the endpoint model could not represent a legal side-less JSON Canvas edge and refusal at the seed then deleted it from the user's file 2026-08-02 -->

**Endpoint optionality (E1, 2026-08-02) — normative.** `fromSide`/`toSide` and `fromEnd`/`toEnd` are **optional** in the JSON Canvas file format. The earlier shape `{node, side, end?}` in this table and in CONCEPT_V2 Teil 4 marked only `end` optional; that was a transcription artefact of the torn-write argument, not a format claim. CONCEPT_V2 never cites the JSON Canvas spec and **Teil 11's own validity predicate is `Edge gültig ⟺ id ∧ from.node ∧ to.node`** — `side` was never in it. The corrected shape is therefore consistent with Teil 11 rather than a departure from it.

**This does not weaken I8.** Teil 4's atomicity argument is about *granularity* — "die Granularität eines Registers definiert die atomare Einheit der Konfliktauflösung" — and the chimera it forbids is `fromNode` from author A combined with `fromSide` from author B. `{node, side?, end?}` remains **one** LWW register holding **one** value: a re-route replaces the whole endpoint or none of it. Optionality is a property of the *value's shape*, not of the *write granularity*. Splitting the pair back into separate keys would reintroduce W2 and is forbidden; making a component of the single value optional does not.

**Two absences must stay distinguishable at the register level:** a register that is *absent* (no endpoint — the edge is dangling, and `Edge valid` fails) versus a register that is *present with no side* (the edge is attached to a node, side unspecified — legal, valid, and must round-trip). Reading the second as the first is the exact defect E1 corrects.
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
- <!-- Updated: E2 ruling — I11 added; refusal at the seed composed with flush into silent deletion of the user's own file, which no AC ever authorised 2026-08-02 --> **I11 is new and binding — REFUSAL NEVER DESTROYS.** A record refused at ingest is not admitted to the shared state; it must not, *by that refusal*, be removed from the source it was read from. Where the source is a user file and the doc is the writer of that file, the **write-back is withheld** rather than the record dropped. Rejection and deletion are different acts, and no composition of correct steps may silently perform the second while intending only the first. → owned by **WP63**, derived from CONCEPT_V2 Teil 7: *"Destruktion wird von einem Timing-Nebeneffekt zu einer informierten Entscheidung."*
- Ingest schema: `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific (file→file, text→text, …)`; `Edge valid ⟺ id ∧ from.node ∧ to.node`.
  - <!-- Updated: E1 ruling 2026-08-02 --> **`side` is not a validity conjunct.** `Edge valid` reads `from.node` and `to.node` and nothing else about the endpoints. An endpoint register that carries a `node` and no `side` is **valid** and must be admitted. This is a restatement of the predicate as it was always written, not a relaxation of it.
  - <!-- Updated: E1-b, second instance of the same class 2026-08-02 --> **The type-specific requirement is presence and correct type, and for `text` it is not non-emptiness.** `"text": ""` is a legal JSON Canvas text node — an empty card the user has not typed into yet, or one they cleared. Refusing it is refusing a legal document, and under the pre-I11 coupling that refusal deleted the card. `text` accepts **any** string including `""` (and, forward-compatibly, the `Y.Text` object shape). `file` and `url` keep their non-empty requirement: an empty path or URL addresses nothing, and under I11 a misjudgement there is no longer destructive.
- Invalid records from **local** sources are rejected with a signature. Invalid records arriving as **remote deltas** are never rejected (that would diverge); they are quarantined by the auditor.
  - <!-- Updated: E2 ruling — the seed's side of Teil 11's line, decided explicitly 2026-08-02 --> **The seed is a local source.** Teil 11 names Seed on the list of validated write boundaries but never assigns it to either side of the local/remote binary, so this spec decides it. The decisive test is Teil 11's own *stated reason* for the asymmetry — remote deltas are not rejected because *"das würde Divergenz erzeugen: Replikat A akzeptiert, B lehnt ab"*. The asymmetry is a **convergence** rule, not a trust rule. Refusing a seed record diverges nothing: the file is read by one replica, and every replica agrees the record is absent. The seed therefore sits with `CAPTURE_NET` and Import on the **local, rejected** side, and C18 AC1 stands.
  - **Quarantine is not the alternative it appears to be.** A quarantined record is *"nie serialisiert"* (Teil 11) and `CanvasPersistence` writes `serialize(doc)` over the file — so quarantining a seed record removes it from the user's file just as surely as refusing it does. Quarantine protects the **doc**, not the **file**, and it is only non-destructive for records that live in shared state where a repair delta can reach them. It is the right instrument for C20's job (records already in the doc) and the wrong instrument at the seed. **The file guarantee is I11's job and is independent of the refuse-vs-quarantine choice.**
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
| <!-- Updated: E2 ruling 2026-08-02 --> **I11** Refusal never destroys | **WP63** | WP20, WP23, WP7 (real-vault fingerprint, §7 data-safety gate) |
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
  - <!-- Updated: PORTS CORRECTED — 39421/39422 are HEADLESS_RIG_PORT_A/B, the headless MOCK rig's ports; this line named them for the real gate and an implementor following it would have driven the mock, the exact substitution AC5 exists to prevent 2026-08-04 --> Input: two **real** Obsidian hosts, each answering on `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B` (`tools/obsidian_e2e/constants.py`), against one room on the **rig-started local relay** whose port C70 defines as a constant. The two pairs are deliberately disjoint (D13). **Import the constants; spell no port literal.**
  - Output: a recorded, reproducible green run plus a documented invocation — <!-- Updated: the rig has no launch backend, so a run is agent-mediated and "reproducible" is carried by a recorded plan, not by one console transcript 2026-08-04 --> where, the gate run being **agent-mediated** (C71), "the invocation" is the ordered execution plan the rig emits plus the per-step outcomes fed back to it, not a single command whose exit status is the verdict.
- Acceptance Criteria:
  1. A two-vault run against a real Obsidian executes end to end and is recorded with its command, environment and outcome; any blocker found is fixed in the rig rather than worked around.
  2. The run demonstrates at least: a node move propagating both ways, a node create and delete, and an Obsidian save on a deliberately stale view producing no revert on the peer.
  3. The gate is documented as a release condition from P0 onward, with the exact invocation, and the previously "never executed" status is corrected in the rig's usage document.
  4. The production build still tree-shakes the whole `src/testing/` module out of `main.js` (`__LS_E2E__` false in production).
  5. The run is performed by the real-Obsidian rig, and a run performed by the headless mock-host rig cannot be recorded as satisfying this gate: the record names the entrypoint that produced it and the two distinct vault identities it drove, and the mock rig's own documentation and banner state that it is not the gate.
  6. The run leaves both vaults unchanged apart from its own scratch artefacts, which are removed; this is established by the before/after vault fingerprint, and a fingerprint mismatch fails the gate rather than being reported as a caveat.
  7. <!-- Updated: AC7 appended — the rig has no launch backend, so AC1's "executes end to end" cannot mean one command that returns a verdict; without this criterion the only honest reading of AC1 is unsatisfiable 2026-08-04 --> **The run is executed against a recorded plan, and every step of it is attributable.** The gate is **agent-mediated** (C71): the rig plans, an agent executes each planned call through `visible-console`, and the outcome of each call is fed back so the rig — not the agent — renders the verdict. Satisfying AC1 therefore requires all four of: the complete ordered plan the rig emitted, retained as a run artefact; the executed outcome of **every** planned step, with the steps that were **not** executed named rather than omitted; a statement that no step was improvised, substituted or re-ordered by the mediating agent, since an improvised step is precisely what makes a mediated run unrepeatable; and a verdict computed by the rig from the fed-back outcomes. **An agent's own narration of what it did is not an outcome.** A run in which any planned step has no recorded outcome is an incomplete run reported under a named reason — never a green gate with a caveat.
- Definition of Done: the R2 verification debt is discharged for the P0 mechanisms and the rig is a standing gate.
- Assigned to work package: **WP7**
- **T3 note (2026-08-01):** Worker 3 returned this WP `BLOCKED` and was right to. `tools/launch_liveshare_e2e.py` aliases the `obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts; a green run there says nothing about AC1 or AC2. The response is **not** to weaken these ACs to the rig that exists but to build the rig they describe: §5 **PHASE T3** charters the host layer (WP43–WP51) and WP7 now depends on WP50 and WP51. AC5 exists so this substitution can never be made silently again.
- <!-- Updated: three corrections entered from the B9b measurements — the second sync engine was the wrong plugin, the rig has no launch path, and the "no endpoint has answered" claim is now measured rather than inherited 2026-08-04 --> **Corrections entered 2026-08-04 (measured, not inferred). AC1–AC6 stand verbatim; AC7 is new.**
  1. **The second sync engine to disposition is `obsidian-git`, not `lan-vault-sync`, and its disposition is a *precondition*, not a choice.** `community-plugins.json` is Obsidian's **enabled** list; it is byte-identical in both vaults and contains exactly `obsidian-git` and `live-share`. **`lan-vault-sync` is installed but NOT enabled and cannot run** — it is recorded here only so a later reader does not rediscover it as a hazard. `obsidian-git` is enabled in both vaults with **`autoPullOnBoot: true`**, on real git working trees with `origin` remotes that are already dirty (13 and 14 entries), and it fires at exactly the moment the gate launches Obsidian. An auto-pull onto a dirty tree can merge, conflict or check out over local state *before any Canvas V2 code runs*, and the resulting failure would look like a sync bug without being one. **Ruling (Dispatcher, binding): `obsidian-git` is disabled in both vaults for the duration of the gate run and restored afterwards, and the disposition — including the evidence of restoration — is recorded with the run.** `autoSaveInterval` and `autoPushInterval` are both `0`, so nothing is pushed; the boot-time pull alone is disqualifying. A result obtained with an undispositioned second engine writing the same files is not evidence, whatever the result was.
  2. **Standing lesson — "installed" is not "enabled".** The false claim above was produced by reading the plugins **directory listing** and reporting it as the enabled set. The enabled set is `community-plugins.json` and nothing else. Read it, per vault, and record what it contained.
  3. **No endpoint has ever answered on this host — now measured, not inherited.** Both real control ports were probed free with nothing listening. Combined with the production bundles in both vaults (zero `__LS_E2E__`), this is a measurement of the current state and a restore baseline; it is not evidence that any part of the rig works.

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
  5. <!-- Updated: E1 ruling — the model could not represent a legal side-less JSON Canvas edge, and the seed then deleted it from the user's file 2026-08-02 --> **A side-less endpoint is a first-class, representable endpoint.** `side` and `end` are optional components of the single register value (§4.3); `node` alone decides the register's presence. Specifically: an endpoint may be constructed from a `node` with no `side`; a register carrying a `node` and no `side` reads back as **present**, not absent; and it round-trips to the file as `fromNode`/`toNode` with the `fromSide`/`toSide` key **absent** — never `null`, never `""`. A register with no `node` is not a register.
- Definition of Done: the "arrow points at a side where nothing hangs" class is unrepresentable, **and every edge legal under the JSON Canvas format is representable.**
- Assigned to work package: **WP10**
- Fuzzer link: WP23 `reroute` op + the schema invariant "no endpoint-less edge".

<!-- Updated: E1 ruling — AC4's meaning restated because WP10 implemented it as "all three components mandatory" 2026-08-02 -->
> **Reading of AC4 (normative, added 2026-08-02).** AC4 was implemented as *"all components must be present"*, which is what made a legal side-less edge unrepresentable. That is not what it says. AC4 is a rule about **write granularity**: the register is written and replaced as one value, so no author's `node` can ever combine with another author's `side` (Teil 4's chimera, W2). "Wholly present or wholly absent" refers to the **register**, whose presence is decided by `node`; it does not make every component obligatory. AC4 and AC5 are consistent and both binding: the module must offer **no** API that mutates one component of an existing register in place, and must accept a `node` with no `side` as a complete construction.

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

<!-- Updated: E1 + E1-b rulings — the validator refused two shapes that are legal JSON Canvas, and refusal was destructive 2026-08-02 -->
> **Amendment (2026-08-02) — two shapes the validator must stop refusing. No AC is replaced; AC1 and AC2 are read as follows.**
>
> 1. **AC1's edge rule is exactly `id ∧ from.node ∧ to.node`.** WP14 delegates to WP10's `hasBothEndpoints`, so WP10's over-constraint (a register required a `side`) leaked into WP14 as `MISSING_FROM` on a fully-connected edge. The rule itself was never wrong and does not change; it becomes correct automatically once C10 AC5 lands. **WP14 must additionally pin it directly** — a validator test over an edge whose `from` register carries a `node` and no `side` must return valid, so the two modules cannot drift apart again.
> 2. **AC2's "present but empty is invalid" is per-field, and `text` is exempt.** `"text": ""` is a legal JSON Canvas text node (an untyped-into or cleared card). The type-specific requirement for `text` is **presence and correct type**, and any string — including `""` — satisfies it; the tolerant object form for the future `Y.Text` shape stays. `file` and `url` keep non-empty, because an empty path or URL addresses nothing. AC2's real subject — that a missing key and a present-but-ill-typed key produce **distinguishable** reasons — is untouched and still binding.
>
> Both are the same class as E1: a rule that refuses a legal document, composed with a write-back that then deletes it. Under I11 the composition is no longer destructive, but the rules are corrected here regardless — I11 is the safety net, not the excuse.

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
  5. <!-- Updated: E1 ruling + the flat/register precedence bug found by Worker 3's coder 2026-08-02 --> **Optional keys are omitted, and the flat-vs-register collision has an explicit rule.**
     - An endpoint register with no `side` emits its `fromNode`/`toNode` and **omits** the `fromSide`/`toSide` key entirely — never `null`, never `""`. Same for `fromEnd`/`toEnd`. A `.canvas` file containing side-less edges must survive parse → doc → serialize **byte-identically**, so such a file does not churn on its first write.
     - No serialisation path may emit `null` or `""` for an optional endpoint or geometry key, **including via the verbatim flat-key pass**. A junk value already sitting in the doc under a flat key is dropped, not carried to disk.
     - The flat-vs-register precedence is an explicit, phase-scoped rule (§4.3), never an artefact of `Y.Map` insertion order.
- Definition of Done: the file is a deterministic projection of the doc on every client, **decided by stated rules rather than by container ordering**.
- Assigned to work package: **WP17**
- Fuzzer link: WP23 byte-equality assertion (this is its primary target) **+ the AC5 intent-trace oracle, which is what actually covers the collision class**.

<!-- Updated: real corruption bug found and fixed in passing by Worker 3's WP18 coder; recorded here so it is owned rather than incidental 2026-08-02 -->
> **The flat-vs-register precedence rule (2026-08-02) — normative, and it needs a named regression test.**
>
> A P1 doc legitimately holds **both** spellings of the same fact: `migrateV1ToV2` is deliberately additive (C8 AC2, WP18 TC9 — the flat keys are explicitly *not* removed), while the capture path and every peer on this build still author the **flat** keys. `decodeV2RecordToFlat` resolved that collision by **`Y.Map` insertion order**, which is not a rule: whichever spelling happened to be written first silently decided the file, so a moved card could snap back to its pre-move coordinate on disk.
>
> **This is the most dangerous defect class this project has found, because both replicas agree on the wrong value — byte-equality across replicas provably cannot detect it.** It is the same class WP17 met from the other direction, and it is why C23 AC5 exists.
>
> **The rule: in P1 the flat key wins.** It is the vocabulary every live writer authors in; a register is only ever a translation of it. A record carrying only the register (anything the V2 cold-open seed wrote) is unaffected — there is no flat key to override it. **When the write boundaries move to the registers (WP22 / WP39) the flat keys stop being written and the precedence becomes moot rather than inverted** — the transition must be made deliberately in that WP and must not be assumed to have happened.
>
> **WP17 owns a named regression test for this**, asserting that a record holding a stale register *and* a fresh flat key serialises the flat value, and that the outcome does not change when the two keys are inserted into the `Y.Map` in the opposite order — insertion-order independence is the actual property, and asserting only the value would let the bug back in. If `decodeV2RecordToFlat` is relocated out of the serializer's module, the AC and the test move with it and WP16's charter carries them instead; the owner is the module, not the file.

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

<!-- Updated: E1/E2 rulings — two clarifications so WP20 does not re-introduce the over-constraint or over-reach into I11's territory 2026-08-02 -->
> **Two clarifications (2026-08-02), no AC changed.**
> 1. **"Endpoint-less" in AC4 means `from.node` or `to.node` absent.** A side-less endpoint is a *complete* endpoint (C10 AC5) and its edge is valid; quarantining it would re-create the E1 data loss inside the auditor. AC4's target is the genuinely dangling edge.
> 2. **Quarantine is not a file-safety mechanism and must not be used as one.** A quarantined record is never serialised, so quarantining a record that exists only in the user's file *removes it from that file*. WP20's scope is records **already in the doc**, where shared state and (from P2) the sidecar keep them recoverable and a repair delta can lift the quarantine. Protecting the file at the seed boundary is I11 / WP63 and is a different mechanism at a different boundary.
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

<!-- Updated: the C21 fuzzer-link obligation is DISCHARGED — recorded here because WP21's entire premise rests on it and a handover is not a durable home for it 2026-08-02 -->

> **Fuzzer-link obligation: DISCHARGED by B3c (2026-08-02). Owner: WP23, TC9.**
> WP21's premise — *locks become pure UX because the data model now carries correctness* — is an
> argument, and "no test pins the removed denial" is **not** evidence for it. The evidence exists and
> is named: `plugin/src/__tests__/v2/wp23/test_tp09_write_gate_removal_does_not_change_convergence_visible.test.ts`
> (seeded PRNG, base seed `0x230009`, **32 concurrent interleavings**) asserts all four required
> properties on every replica:
> ```text
> ├── NO DENIAL       ← after each of two concurrent authors saves, that author's OWN doc
> │                     holds the value it just wrote (under the removed gate the loser's
> │                     write never reached its own doc at all)
> ├── NO BASELINE-HOLD ← replaying the identical content immediately after produces ZERO Yjs
> │                     updates; the echo baseline advanced with the write (under the removed
> │                     gate it was WITHHELD, replaying the whole file as intent — Symptom-2)
> ├── CONVERGENCE     ← every replica ends on the same value, and
> └── LWW-CONSISTENCY ← that value is one somebody actually wrote
> ```
> **What it deliberately does not assert is which author won** — Yjs tie-breaks a concurrent same-key
> write on `clientID = random.uint32()`, so pinning the winner would be flaky about half the time, and
> a fuzzer that is flaky half the time is worse than no fuzzer. The **atomic-register** half is
> stronger than per-field LWW-consistency and is checked separately: `pos` is one register holding
> `[x, y]`, so the winner must be one author's **whole pair** — a merged `(A.x, B.y)` is a coordinate
> **nobody submitted**, and checking `x` and `y` separately cannot see it, because each half is
> individually a value somebody wrote.
>
> **This obligation is therefore closed, not open.** If TC9 is ever deleted, weakened, or made
> non-deterministic, WP21's justification reverts to an unevidenced argument and the removal must be
> re-litigated — treat that as an abort criterion, not a test-maintenance decision.

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
  5. <!-- Updated: byte-equality provably cannot catch the flat/register collision class — the oracle needs an independent basis 2026-08-02 --> **An intent-trace oracle, independent of the implementation's own merge.** For every field the op sequence touched, the converged value on every replica must equal the value written by the **last op on that field under the run's total order**, as computed by the harness from its **own op log** — never read back from the implementation's merge result. **Agreement between replicas is necessary but not sufficient: a run in which all replicas agree on a value that no op ever wrote is a FAILURE, not a pass.** The op registry must include at least one op class that produces a record carrying **both** the flat and the register spelling of the same fact, and one that varies the insertion order of those two keys.
- Definition of Done: convergence of the V2 model is checked over interleavings, not examples, **and correctness is checked against intent rather than against consensus**.
- Assigned to work package: **WP23**

<!-- Updated: AC5 rationale — the WP18 batch found a real corruption bug that every existing assertion family was structurally blind to 2026-08-02 -->
> **Why AC5 exists.** AC2's four families — SEC, schema invariants, byte equality, shadow consistency — share a blind spot: all four are satisfied when every replica converges on the *same wrong value*. The `decodeV2RecordToFlat` insertion-order bug (C17) is exactly that shape: a moved card snapped back to its pre-move coordinate on **every** replica, so SEC held, the schema held, the bytes were identical everywhere, and the shadow agreed. Four green assertion families over a corrupted document. Byte equality is a *convergence* oracle and can never be a *correctness* oracle — "convergence is not correctness" (CONCEPT_V2 Teil 2, W3) applied to the fuzzer's own instruments. AC5 supplies the missing independent basis.

<!-- Updated: the B3c fault-injection matrix promoted from a handover into the spec — it is the empirical justification for AC5 existing at all, and it must outlive the handover that produced it 2026-08-02 -->

##### C23 fault-injection matrix — the measured justification for AC5 (B3c, 2026-08-02)

**AC5's rationale above was an argument. This is the measurement, and it is the strongest single
piece of evidence this project has produced.** It is recorded here, not only in
`Worker3Handover_B3c_P1Remainder.md`, because a handover is an episodic artefact and this result
is a standing architectural fact: it is *why* AC5 exists, and it is the answer to any future
proposal to drop the intent-trace oracle as redundant with SEC or byte equality.

Method: **200 scenarios × 10 windows** per row; each fault injected into production, then production
restored and `cmp`-verified byte-identical after every injection. Cell values are oracle hits.

| Injected fault | intent-trace | SEC | schema | bytes | shadow | I7 |
|---|---|---|---|---|---|---|
| none (control) | 0 | 0 | 0 | 0 | 0 | 0 |
| **1. insertion-order flat-vs-register (the WP18/C17 class)** | **2913** | **0** | **0** | **0** | **0** | 0 |
| 2. delete suppression broken | 854 | 0 | **863** | 0 | 0 | 0 |
| 3. partial capture removes an unmentioned field | 31221 | 0 | 0 | 0 | 0 | **2587** |
| 4. a replica pushes a stale field | 339 | 0 | 0 | 0 | **372** | 0 |

**Row 1 is the whole argument, measured.** Over a *provably corrupt* document — the known C17
insertion-order corruption, deliberately re-injected — **SEC, schema, byte equality and shadow
consistency are all four green**, and the intent-trace oracle alone fires, 2913 times. Four
independent assertion families agreeing on a document that is wrong is not a hypothetical failure
mode of convergence oracles; it is the observed behaviour of *these* oracles on *this* codebase.

**Read the SEC and byte-equality columns down.** They are zero in **every** row, including the three
rows where a real defect was injected and other families did fire. That is not weak sampling — it is
structural: every replica commits the same projection defect, so a *convergence* oracle cannot
distinguish "all replicas agree because the system is correct" from "all replicas agree because they
are identically wrong". **Convergence is not correctness (CONCEPT_V2 Teil 2, W3), demonstrated rather
than argued.**

Consequences that are now binding rather than advisory:

- **AC5 is not redundant and may not be retired.** Any future proposal to drop the intent-trace
  oracle on the grounds that SEC or byte equality "already covers it" is refuted by row 1 and must
  be rejected without further analysis.
- **No convergence oracle may be the *only* oracle on a correctness property, anywhere in this
  spec** — not in the fuzzer, not in a chaos suite, not in a WP's own test set. A property that
  matters needs a basis independent of the implementation's own merge.
- **The matrix is a regression gate on the fuzzer itself.** It is what proves the fuzzer *bites*;
  a fuzzer whose budget is reduced without re-running it is a fuzzer of unknown power (see the
  `FUZZ_TEST_TIMEOUT_MS` note in §7 — do not shrink the scenario budget without re-measuring).
- **Row 3's I7 column is a second, independent confirmation** that the partial-capture defect this
  whole initiative exists to close is now caught by two families rather than argued about.

#### C63 — Non-destructive seed boundary (I11)

<!-- Updated: new component from the E2 ruling — refusal at the seed composed with flush() into silent, permanent deletion from the user's own .canvas file 2026-08-02 -->

- Change type: modify (`CanvasPersistence` write path; the refusal branches of the two seed boundaries in `canvas-sync.ts` / `canvas-persistence.ts`)
- Responsibility: make ingest refusal non-destructive at the one boundary where the input is the user's only copy — decouple "not admitted to the doc" from "removed from the file".
- Interfaces:
  - Input: the refusal signatures already produced by C18 AC1 at the two seed boundaries, keyed by canvas path
  - Output: a withheld file write plus a signature, instead of a write that drops the refused records
- Acceptance Criteria:
  1. When any record read from a `.canvas` file is refused at a seed boundary (host seed or cold-open seed), `CanvasPersistence` **withholds the file write for that path** and the file on disk stays **byte-identical**. A `SEED REFUSED:` signature names the path, each refused id and its reason.
  2. The withhold is **per path and non-fatal** (I5 DEGRADE): other canvases persist normally, and the affected canvas continues to sync, render and receive remote deltas — only its write-back is suspended. It is never a silent no-op and never an exception that breaks the session.
  3. The withhold lifts automatically when the refused set for that path becomes empty — because a later delta or a user repair made every previously-refused record valid — and the first write after lifting is the ordinary canonical projection. Lifting emits a distinct signature.
  4. **Discrimination:** with the withhold seam disarmed, a seed refusal followed by a flush removes the record from the file; with it armed, the file is byte-identical. This is the test that would have caught the E1 loss, and it must fail when the mechanism is disabled.
- Definition of Done: no refusal, present or future, correct or mistaken, can delete data from a file the user did not create with this plugin.
- Assigned to work package: **WP63**
- Fuzzer link: WP23 — a fault-injection op that seeds a replica from a file containing a record invalid under the current rules must leave that file unchanged.

> **Why this is a component and not a bugfix.** Every step in the loss path was individually correct and individually chartered: C18 AC1 refuses invalid local records; C14 judges validity; C17 projects the doc to the file; `CanvasPersistence` is the single writer (I3). The defect is in the **composition**, and no AC anywhere owned it — which is precisely why it survived review and landed on a path that touches real user files. I11 names the missing constraint so the composition can be tested rather than reasoned about.
>
> **Scope boundary against WP20.** WP63 protects the **file** at the **seed**; WP20 protects **records already in the doc** via quarantine. They are not alternatives and neither subsumes the other — see the C20 clarification.

#### C64 — Tombstone-blind test-instrument sweep

<!-- Updated: new component from the B3c/WP19 escalation ruling — AC1 made "the record survived" unfalsifiable wherever a test proves it by raw key presence, and the class is wider than WP19's licence 2026-08-02 -->

- Change type: modify (test instruments only — **no production source is touched by this WP**)
- Responsibility: restore falsifiability to the survival oracles that WP19 silently vacated outside WP19's own licensed scope.
- Interfaces:
  - Input: the residual list in §7's WP19 entry ("Not covered by this licence, and deferred to WP64")
  - Output: tombstone-aware readings in the named test helpers and call sites; no assertion weakened, no test added or removed
- Acceptance Criteria:
  1. Every `docRecords()`-style helper that iterates the raw `nodes`/`edges` map without consulting `deleted` either becomes tombstone-aware or gains a tombstone-aware sibling used by every **survival** assertion (`w4-canvas-integrity.test.ts:132`, `v2/wp5v2/test_tp01:99`, `v2/wp5v2/test_tp05:87`, `v2/wp5v2/test_tp06:94`). Helpers used only for **field-value** reads may stay as they are, and the report states which is which.
  2. Every remaining **2-arg** `serializeCanvas` / `buildCanvasData` call site in the test tree is either converted to the 3-arg `(nodes, edges, deleted)` form or carries a one-line comment stating why suppression is deliberately not wanted there. A 2-arg call used as a "the record is gone / still there" oracle is a defect.
  3. Each test in §7's WP19 residual list gains a suppression pin alongside its existing field-level oracle, so that it fails both when the container is destroyed **and** when the record survives only as a suppressed tombstone. **Strictness rises on every site; no assertion is relaxed, retitled, skipped or deleted, and the test count does not change.**
  4. **Discrimination:** with delete suppression inverted (the C23 fault-injection matrix row 2 perturbation), every test touched by this WP goes **RED**. A test that stays green under that perturbation has not been made falsifiable and does not satisfy AC3.
- Definition of Done: no test in the tree proves a record survived by an oracle that a tombstone can satisfy.
- Assigned to work package: **WP64**
- Fuzzer link: C23 fault-injection row 2 (delete suppression broken) is the falsification instrument for AC4.

> **Why this is a component and not cleanup.** It is the second half of a change that already happened. WP19 moved deletion from an absence to a value; §7's WP19 licence repairs the oracles that went **red**, which are self-announcing. This WP repairs the ones that went **green**, which are not. An unfalsifiable data-safety test is worse than a missing one, because it is counted as coverage — the same reasoning that produced the blind-set execution gate in §7 and AC5 in C23.

<!-- Updated: C66 added by the B16 escalation ruling — the third independent sighting of a test asserting over an empty record set because its own fixture was refused at ingest 2026-08-02 -->

#### C66 — Hollow-fixture detection sweep

- Change type: modify (test fixtures only — **no production source, no assertion, no test instrument is touched by this WP**)
- Responsibility: find, by measurement, every test in the tree that asserts over a record set its own fixture never put into the doc, and make the scenery real without changing what the test is about.
- **Why now.** This is the **third** independent sighting of one class. B14 measured it at row 4 (`w4-canvas-integrity:352` was never red — its record was refused at the host seed with `MISSING_TYPE_SPECIFIC`). B16 measured it again at `w4-canvas-integrity` **A1** — `PROBE_A1 nodes=[] edges=["e1"] deleted=[]`, a test named *"a stale disk read cannot delete fromNode/toNode"* running against an **empty node map** — and found the same incomplete literal **13×** in that file. Two sightings are a coincidence; three are a mechanism. **Tightening ingest validation (C18 AC1) silently hollowed out an unknown number of fixtures that pre-date it**, and each one is a test that passes while asserting nothing. The number is unknown *because nobody has measured it*, which is precisely what this component exists to fix.
- Interfaces:
  - Input: the whole `plugin/src/__tests__/` tree; the C18 AC1 refusal path (`canvas-ingest-schema.ts`) and its refusal signatures; B16's `PROBE_A1` technique (read the doc's record set at the moment of assertion)
  - Output: a measured population of hollow and partially-hollow fixtures, each completed or dispositioned; an enumerated ledger; no assertion changed and no production source touched
- Acceptance Criteria:
  1. **The population is established by measurement over the whole suite, not by the suspected list.** For every test that asserts over a record set derived from a canvas doc, the sweep measures the record set **actually under assertion** (node ids, edge ids) at the moment of assertion and compares it to the set the fixture literal declares. A fixture is **hollow** when the measured set is empty and **partially hollow** when it is materially smaller than its literal declares. `w4-canvas-integrity` **A2, A3, A5, A6** are known starting points and are **neither the boundary nor the expected total** — the measured population is reported as measured, with the same estimate-vs-measurement discipline that turned B16's "~10 call sites" into 57. **Literal-shape matching is a screen, not the oracle**, and the report states how many screen hits the measurement rejected: `text: ""` is *valid* (the refusal test is `storedSpecific === undefined` and nothing else), and a `remoteRecord(...)` fixture takes the accept-then-quarantine path rather than the refusal path, so both would be false positives of a grep.
  2. **Every hollow fixture is either completed under §7's fifth licence or dispositioned with a measured reason** why an empty record set is that test's intended state. Each completion is enumerated by **file · line · test title · which declared record ids were absent from the doc · which keys were added · why the completion is faithful to the test's original subject**. **Completing a fixture must not change what the test asserts:** no assertion, matcher, title or strictness is touched, no `skip`/`only`, the test count does not change, and no id, coordinate, edge topology or any value an assertion reads is altered.
  3. **Falsification per completed site**, by the method B14 and B16 established: a **targeted injection of the exact class the test claims to catch** — never a global perturbation — with confirmation that the test goes **red on its own named assertion** rather than on a neighbour's, and a note on whether the pre-existing oracles stayed green under the same injection. **Where a prior batch's amendment in the same file masks the falsification** (B15's finding), the injection is narrowed until the failure is attributable to the site under test, and the narrowing is recorded. Every perturbed file is restored and hash-verified.
  4. **A verdict change on completion is an escalation, not a fix.** A fixture that has asserted nothing for some time may be concealing a genuine regression that surfaces the moment real records reach the doc. If completing a fixture makes its test **fail**, that failure is a candidate real defect: it is left red, reported with the measured before/after, and handed back for its own charter. Repairing it by weakening the assertion, by reverting the completion, or by treating it as fixture noise is an **abort criterion**.
- Definition of Done: no test in the tree passes by asserting over a record set that its own fixture never put into the doc — and for every one that was, the record says whether completing it revealed a defect.
- Assigned to work package: **WP66**
- Fuzzer link: none. The instrument here is the ingest refusal signature, not the op fuzzer.

> **Why this is a component and not a follow-up chore.** C64 removed oracles a tombstone could satisfy. This removes oracles *nothing at all* reaches — one level further down, and strictly worse: a vacated oracle still runs against real state, while a hollow fixture means the entire scenario never happened. Both are counted as coverage. The recurrence is the finding: a validation boundary that is tightened correctly invalidates fixtures written against the looser rule, and those fixtures fail **silently and greenly** rather than loudly, so no gate in §7 catches them. C66 exists because the class has now been found three times by accident and never once by design.

<!-- Updated: C67 added by the B16 ruling — WP64 repaired two helpers whose repair is not falsifiable today, and an unverifiable repair carried as verified is the same error class the project keeps finding 2026-08-02 -->

#### C67 — Falsifiability pins for the unfalsifiable WP64 helper repairs

- Change type: modify (two test files under `plugin/src/__tests__/v2/wp5v2/` — **additive pins only**)
- Responsibility: give the two WP64 helper repairs that are behaviour-preserving no-ops today a measurement, so that "repaired" is a claim the record can support.
- **Why now.** B16 repaired the `docRecords()` helpers at `v2/wp5v2/test_tp01:99` and `test_tp06:94` to be suppression-aware, then declined to count them as AC4 reds and said why: **those fixtures contain no tombstones, so the repair is not currently falsifiable.** That was the correct call — and it leaves a repair in the tree whose only evidence is that the *same form* was proven at `test_tp05` (repaired **RED**, raw helper **GREEN**, identical injection). Two sites therefore carry a verified-looking change with no measurement behind them. The project's standing rule is that an unverified claim is not made true by being plausible.
- Interfaces:
  - Input: the two suppression-aware helpers as WP64 left them; WP12's `isTombstoneSuppressed` / `readTombstoneEntry`; B16's A/B method from `test_tp05`
  - Output: one direct pin per helper plus the A/B measurement that shows it discriminates
- Acceptance Criteria:
  1. Each of the two helpers gains a **direct pin on the helper itself** — a test asserting that it omits a suppressed id and retains an unsuppressed one — rather than a tombstone added to the existing fixtures. **The existing fixtures and every existing assertion in both files stay byte-identical.** Adding a tombstone to fixtures whose subjects are the single-shadow reload and the discrimination seam would change what those tests are about, which AC2 of C66 and §7 both forbid; the helper is the thing under test here, so the helper is what gets pinned.
  2. Each new pin is measured **A/B on an identical injection**: red against the pre-WP64 raw helper form, green against the repaired form — the measurement B16 recorded at `test_tp05` and could not take at these two sites. The test count rises by exactly the number of pins added, each is enumerated by file and name, and no existing test changes state in either direction.
- Definition of Done: no WP64 helper repair is carried in the record as verified without a measurement behind it.
- Assigned to work package: **WP67**

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

<!-- Updated: C68 added — WP26 closed the MANIFEST arm of the either-side rename gate; the FILE-OP BROADCAST arm is still open and moves a peer's own file into the peer's own sidecar directory 2026-08-02 -->

#### C68 — Sidecar exclusion at the file-op rename boundary

- Change type: modify (`plugin/src/files/file-ops.ts` `FileOpsManager.onFileRename` `:461–475`; `plugin/src/sync/control-handlers.ts` the `file-op` rename admission gate `:48–53`)
- Responsibility: extend C26's guarantee — local replica state is never shared content — to the **file-operation channel**, which C26 did not reach, in **both** the outbound and the inbound direction.
- **Why now, and what is actually open.** WP26 re-derived its consumer set from the manifest **writers** and found `ManifestManager.renameFile`, which re-keys an entry without consulting `isSharedPath`. It closed that arm with a destination-only `isSidecarPath` guard (`manifest.ts:333`). The **root** it named is unchanged and remains deliberately so: the vault `rename` handler admits an event when **either** side is shared (`files/vault-events.ts:190–194`), because both `BackgroundSync.onFileRenamed`'s teardown and `renameFile`'s stale-key deletion must still run. What C26 never reached is the statement one line above `renameFile` in the same handler — `fileOpsManager.onFileRename(file, oldPath)` (`vault-events.ts:205`) — which emits a `rename` file-op with **no path-class guard of any kind**: its only conditions are the two mute checks and the presence of a sender. The receiving peer's admission gate is the **same either-side shape** (`control-handlers.ts:49–50`, `paths.some(isSharedPath)`), so the op is admitted there on the strength of the shared endpoint, `isPathSafe` does not reject a sidecar path (it contains no `.` or `..` segment), and `applyRemoteOpInner`'s `rename` case then runs `ensureFolder` + `vault.rename` and moves **the peer's own copy of a shared note into the peer's own sidecar directory**. Traced end to end; **no downstream guard neutralises it.** The manifest consequence on the receiving side *is* already covered — the `afterApply` hook's `renameFile` carries WP26's destination guard — which is exactly why this is a separate component: the arm that is closed and the arm that is open sit two lines apart and look identical.
- Interfaces:
  - Input: a local vault `rename` whose two endpoints straddle the sidecar boundary; and a `rename` `FileOp` arriving over the control channel with the same shape
  - Output: no file-op emitted outbound; no vault mutation inbound; both endpoints left exactly as they were
- Acceptance Criteria:
  1. `FileOpsManager.onFileRename` emits **no** `rename` file-op when **either** endpoint is a sidecar path, in either direction (shared → sidecar and sidecar → shared). Observed on the injected op sink **and** on the offline queue, so a client that is offline at the time cannot deliver it on reconnect. The membership test is `isSidecarPath` imported from `files/canvas-sidecar.ts`.
  2. The **receiver refuses independently of the sender**, and this is asserted with no sender-side guard in the picture — by handing a hand-built `rename` `FileOp` straight to the inbound path, because a peer on an older or hostile build is precisely the case the receiver has to survive. A `rename` whose `oldPath` or `newPath` is a sidecar path performs **zero vault mutation**: no `rename`, no `createFolder`/`ensureFolder` under the sidecar directory, no `create`, no `modify` — even though its other endpoint is shared and today's gate admits it on that basis.
  3. **I11 REFUSAL NEVER DESTROYS.** A refused rename costs no file, at either end. The file at `oldPath` is still present and byte-identical afterwards; `trashFile`, `delete` and `modify` are called for neither endpoint; and no sidecar file is unlinked or truncated by the refusal. Degrading the refusal to a delete, to a delete-then-recreate, or to "the file left the shared tree so drop it" is the defect this criterion exists to forbid, not an acceptable simplification. **WP26's manifest behaviour is explicitly untouched and must stay so:** `ManifestManager.renameFile` still deletes the old key and still declines a sidecar destination. This criterion governs **the file on disk**, not manifest membership, and a WP that "simplifies" the two into one has broken C26.
  4. **No collateral.** Every rename with neither endpoint under the sidecar directory behaves exactly as it does today, outbound and inbound — including a `.canvas`, a deep path, the backslash spelling a Windows or remote caller produces, and the prefix-sharing near miss `.obsidian/liveshare/stateful/…`, which is **not** a sidecar path. The per-path bookkeeping is unchanged for admitted renames and is not left unbalanced by a refusal: `sendQueues`/`opQueues` acquire and release as before, and every `mutePathEvents` still has its matching `unmutePathEvents`. A refusal that strands a mute count is a silent freeze of that path.
  5. **One predicate, one definition** (the C26 AC3 rule, extended to these two boundaries). Both guards consult `isSidecarPath` from `files/canvas-sidecar.ts`; no module re-spells `SIDECAR_DIR`, writes its own prefix or suffix test, or introduces a second constant, and the guard is placed at the two named boundaries rather than duplicated per op type. Verified against the source, in the same style and with the same discipline as C26 AC3 — the claim is checked by running an extraction over the source, not by reading it.
- Definition of Done: no rename can carry a path into, or out of, a client's local replica state over the file-op channel — in either direction, from either end of the link — and no refusal of one costs any peer its file.
- Assigned to work package: **WP68**
- Fuzzer link: none. The instrument here is the file-op channel and the vault, not the doc merge; C23 has no op that models a vault rename.

> **Why this is a component and not a WP26 follow-up chore.** WP26's charter named three files and four criteria, none of which reaches the file-op channel; its coder found this, traced it, and **declined to patch it** because patching it would have been an unchartered widening. That was the right call and it is why the defect is documented rather than lost. Chartering it separately also keeps the two arms distinguishable in the record: WP26 owns manifest **membership**, WP68 owns the **peer-visible file operation**, and the vault-event gate they share is deliberately left as it is because two other landed behaviours depend on the event still arriving.
>
> **Reachability, stated honestly.** The **inbound** arm is reachable by construction and needs nothing unusual: any peer can put such an op on the wire, and today's gate admits it. The **outbound** arm depends on Obsidian emitting a vault `rename` event whose destination lies under `.obsidian/`; that is asserted by WP26's own landed contract comment and by C26's ledgered reasoning, but it has **not** been observed in a real Obsidian instance, and it cannot be until the T3 gate (WP7/WP50/WP51) runs. AC1 is therefore written against `onFileRename` directly rather than against a vault event, so it is falsifiable today at the seam it actually guards, and the unverified step is confined to how that seam gets called.

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
> **Phase tags.** WP43–WP51 <!-- Updated: WP69 joins the P0 group — it gates WP7 exactly as they do 2026-08-02 --> **and WP69** carry phase `P0` because they gate WP7, which is P0; WP52–WP54 carry phase `P5` because they gate WP40. They are grouped here because they are one body of work with one risk profile, not because they run together.
>
> **Verified environment facts for this phase — given, not to be re-derived.** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json`; the two target vaults are `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (note the spaces); <!-- Updated: install state corrected against the measured pre-flight — both vaults, production build, and the plugin id is `live-share` 2026-08-02 --> **the built plugin is installed and enabled in *both* vaults, and in both it is a *production* build** (`main.js`, 626 711 bytes, dated 2026-07-26, **zero** `__LS_E2E__` occurrences), so neither installed instance can host a control endpoint whatever port is provisioned — see C69. The install directory is `<vault>\.obsidian\plugins\**live-share**\`; `obsidian-live-share` is the repo folder name and is **not** the plugin id. The earlier reading "already installed in the first [vault]" is superseded by measurement (`T3_PREFLIGHT.md`, 2026-08-02) and must not be re-derived. These are the owner's **live working vaults** — D16 applies without exception.
>
> **Test surface note for this phase.** The Python side of the rig has no vitest coverage and must not pretend to: its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, run through `visible-console` `run_python` with an absolute path. The `plugin/` vitest gate remains in force for every TypeScript change in this phase.
>
> <!-- Updated: two phase-wide corrections from the B9b measurements — the enabled-plugin set was read from the wrong source, and the rig has no launch backend 2026-08-04 -->
> **⚠ Two phase-wide corrections (measured 2026-08-04). Every component below inherits them.**
>
> **(a) The enabled second sync engine is `obsidian-git`, and `lan-vault-sync` is not enabled at all.** `community-plugins.json` — Obsidian's **enabled** list — is byte-identical in both vaults and contains exactly `obsidian-git` and `live-share`. `lan-vault-sync` is **installed but NOT enabled** and cannot run; it is named here once, in that form, so it is not rediscovered as a hazard. `obsidian-git` carries **`autoPullOnBoot: true`** in both vaults, over real git working trees with `origin` remotes that are already dirty (13 and 14 entries), firing at the moment the gate launches Obsidian — an auto-pull onto a dirty tree can merge, conflict or check out over local state before any Canvas V2 code runs, and the failure would look like a sync bug without being one. **Dispatcher ruling, binding on every T3 component: `obsidian-git` is disabled in both vaults for the duration of a gate run and restored afterwards, and the disposition and its restoration are recorded with the run.** This is a **precondition**, not one of two permitted dispositions. `autoSaveInterval` / `autoPushInterval` are `0`, so nothing is pushed; the boot-time pull alone is disqualifying. **Standing lesson: "installed" is not "enabled" — read `community-plugins.json`, never the plugins directory listing.** The original error was produced by exactly that substitution.
>
> **(b) The rig has no launch backend, so a gate run is agent-mediated.** `tools/obsidian_e2e/lifecycle.py` exposes **`PlanOnlyConsole` as its only console backend**, and there is **no `subprocess`, `Popen` or other process spawn anywhere in `tools/obsidian_e2e/`**. This is not a defect of WP43–WP49: C45 AC4 requires every long-running process the rig starts to go through `visible-console`, the rig is a plain Python process with no MCP client, and a direct spawn would violate that criterion — `PlanOnlyConsole` is the honest consequence, and it already emits the exact MCP payloads a client would send. WP43–WP49 delivered what they were chartered to deliver. What was never chartered is the **mediation** that turns those payloads into an executed, reproducible run; that gap is **C71/WP71**. Until it lands, no component below may be read as claiming that an entrypoint runs the gate end to end and returns a verdict.

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
  - <!-- Updated: the default pair named here was HEADLESS_RIG_PORT_A/B, i.e. the MOCK rig's; what landed reads REAL_CONTROL_PORTS, so this line was stale against its own implementation and misnamed the real rig's defaults 2026-08-04 --> Input: the two resolved instance descriptors and the desired port pair (defaults `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B`, `tools/obsidian_e2e/constants.py` — **not** `HEADLESS_RIG_PORT_A`/`_B`, which belong to the mock rig and are deliberately disjoint, D13)
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
  5. <!-- Updated: AC5 appended — widening `session.info` is the literal content of AC1, so the two exact-shape assertions that pinned the pre-WP46 4-key payload are stale and are licensed for amendment 2026-08-01 --> The two assertions that pin the pre-WP46 four-key `session.info` payload with an exact-shape `toEqual` are amended to the nine-key payload, named individually in the implementation report against the §7 amendment-ledger entry. Each amended assertion stays a whole-object `toEqual` over all nine keys — no `toMatchObject`, no subset match, no destructuring away of the added fields, no `skip`/`only`. Nothing is deleted: the test count does not change, and the four legacy fields keep their names, defaults and semantics verbatim (C46 AC1, pinned by TC2).
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
<!-- Updated: AC5 and AC6 appended from the measured T3 pre-flight — a second sync engine is live in both vaults, and the restore check now has an independent baseline the rig did not produce; AC1–AC4 unchanged 2026-08-02 -->
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
  5. <!-- Updated: AC5 appended — the pre-flight measured a second sync engine enabled in both vaults, and an undecided one can move files underneath the run 2026-08-02 --> **Host preconditions are dispositioned before the first case runs, not discovered by a failure.** Per role the driver establishes and records, before any gesture is issued: that the endpoint it holds belongs to an E2E-capable build (C69) rather than to the production build the vaults carry today; that the run's scratch canvas is inside the surface both instances actually share, so a convergence verdict is about the mechanism and not about two files nobody is syncing; and the **explicit disposition of every other sync engine enabled in the two vaults**. <!-- Updated: the engine named here was wrong — community-plugins.json is the ENABLED list and lan-vault-sync is not in it; the enabled, never-dispositioned engine is obsidian-git, and its disposition is a precondition rather than a choice 2026-08-04 --> **That engine is `obsidian-git`, not `lan-vault-sync`.** The enabled set is `community-plugins.json`, it is byte-identical in both vaults, and it contains exactly `obsidian-git` and `live-share`; **`lan-vault-sync` is installed but NOT enabled and cannot run** — stated here so it is not rediscovered as a hazard. `obsidian-git` is enabled in both vaults with **`autoPullOnBoot: true`**, over real git working trees with `origin` remotes already dirty (13 and 14 entries), firing exactly when the gate launches Obsidian; an auto-pull onto a dirty tree can merge, conflict or check out over local state before any Canvas V2 code runs. **The disposition is therefore fixed and is a precondition, not one of two permitted decisions: `obsidian-git` is disabled in both vaults for the duration of the run and restored afterwards, and both the disabling and the restoration are recorded with the run.** A run that produces case verdicts without that record has produced verdicts obtained with an undispositioned second engine writing the same files, and they are not evidence. Any precondition unestablished refuses the run under a named reason instead of producing case verdicts, and a case that converges because nothing was shared is reported **inconclusive**, never as a pass.
  6. <!-- Updated: AC6 appended — the pre-flight supplies a restore baseline that the rig did not produce 2026-08-02 --> **Restore is verified against a baseline the rig did not produce.** After teardown the run compares each vault's `.obsidian/plugins/live-share/data.json` against the independent sha256-of-bytes baseline recorded in `T3_PREFLIGHT.md` — `ObsidianOrga` = `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162`, `ObsidianOrga - Kopie` = `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` — and against the sha256 C69 recorded for the production `main.js` it displaced. A mismatch **fails the run**. The check consults neither the rig's restore bookkeeping nor its provisioning marker: the point is that it does not trust the code under test. The two `data.json` hashes differ between vaults, which is correct — they carry per-vault identity keys — and must never be "converged". Comparison is **sha256-of-bytes only**: `data.json` holds live credentials, and neither its bytes nor any value read from it is ever printed, logged, echoed into a report or handover, or placed in a fixture.
- Definition of Done: `run_matrix` becomes a statement about two real Obsidian instances.
- Assigned to work package: **WP50**
- <!-- Updated: measured host constraints from T3_PREFLIGHT.md 2026-08-02 --> **Host constraints this component inherits and does not re-derive.** (a) Vault B's path contains **spaces** and this host has a recorded `run_command` nested-quote trap, so the entrypoint is invoked through `run_python` with an **absolute** script path (§7). (b) `%APPDATA%\obsidian\obsidian.json` registers a **third** entry — vault B's own `.obsidian` folder — which is `open: false`, harmless and **user state**: it is explicitly out of scope, and "cleaning it up" is forbidden, because a rig that rewrites the vault registry is a rig that can destroy the owner's vault list (S3). (c) Both plugin directories already contain the owner's own backups — `main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`. They are **not ours**: never written, moved, renamed or deleted. The rig's backup namespace is `data.json.e2e-original` / `.e2e-provision.json` (and C69's own `main.js` backup), and nothing else.

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

<!-- Updated: C69 added — the T3 pre-flight measured that the only E2E-capable build is the only build that never terminates, so the gate has no way to produce the bundle it needs; C69 sits at the end of the PHASE T3 block but executes before WP7 2026-08-02 -->

#### C69 — One-shot E2E build mode and instrumented-build installation

- Change type: modify (`plugin/esbuild.config.mjs` — the `process.argv[2]` mode branch; `plugin/package.json` — one added script) + create (`tools/obsidian_e2e/install.py` — install and restore of the E2E bundle in the two vault plugin directories)
- Responsibility: produce an E2E-capable plugin bundle with a build that **terminates**, and place it in the two vaults reversibly — without altering one byte of what `npm run build` ships.
- **The measured blocker this closes.** `plugin/esbuild.config.mjs:4` branches on `process.argv[2] === "production"`. The production branch calls `ctx.rebuild()` then `process.exit(0)`; **every other invocation calls `await ctx.watch()` and never returns**. `define.__LS_E2E__` is `"false"` in production and `"true"` otherwise. So the only build that can host the control server (`npm run dev`) is the only build that never exits: a `run_python` / `await_console` on it blocks to timeout, and the obvious diagnosis — "the build is slow" — is wrong. Both vaults today carry the production bundle with **zero** `__LS_E2E__` occurrences, which is the correct production signature and simultaneously the reason no real endpoint can ever answer (`T3_SharedContract` §1.1, `readiness.py` `PLUGIN_NOT_E2E_CAPABLE`). §1.1 assigned the installation step to "WP50/WP51", but neither charter's scope, ACs or Definition-of-Done artefacts ever reached it — the step was named and never owned. This component owns it.
- Interfaces:
  - Input: the plugin source tree and the two resolved vault plugin directories
  - Output: an E2E-capable `main.js` whose capability is verified before installation; per vault a recorded restore point; and the recorded sha256 of the displaced production bundle and of the production bundle rebuilt after the config change
- Acceptance Criteria:
  1. `esbuild.config.mjs` gains **one** explicit third mode, selected by `process.argv[2] === "e2e"`, which builds **once** and exits — `ctx.rebuild()` then `process.exit(0)` — and whose build options are identical in every field to the existing default (watch) branch, including `__LS_E2E__: "true"` and `sourcemap: "inline"`. The only difference between the two is one-shot versus watch. Both existing branches are **unchanged in behaviour**: `production` still rebuilds once, folds `__LS_E2E__` to `"false"` and exits `0`; an invocation with no `argv[2]`, or with any other value, still enters watch mode and still never returns. A failed e2e build exits **non-zero**. The mode is reachable through exactly one added `package.json` script; `dev`, `build`, `test`, `lint` and `format` keep their current definitions verbatim, and no dependency is added.
  2. **The production build's output is provably unchanged.** `npm run build` is run before and after the config change and the two emitted `main.js` files are **byte-identical**, established by sha256 of both and recorded in the implementation report. The post-change production bundle additionally contains **zero** occurrences of `__LS_E2E__` and zero of each E2E build marker (`e2eControlPort`, `LIVESHARE_E2E`, `e2e-control`), i.e. `src/testing/` still tree-shakes out — the same property C7 AC4 asserts, now re-established against a bundle built from the edited config rather than inherited from one built before it. A byte difference of any size is an **abort**, not a diff to explain: a build config is exactly the kind of file that silently changes what ships to users.
  3. **The E2E bundle is verified capable and complete before it is installed anywhere.** Success is decided by the build process's exit status **and** by finding all three E2E build markers in the emitted `main.js` — never by the file existing, by its mtime moving, or by a watcher having been killed at a plausible moment. A failed or interrupted build leaves the previous `main.js` in place, so "a file is there" proves nothing. The E2E bundle is **substantially larger** than the 626 711-byte production bundle because the dev configuration emits an inline sourcemap; that size difference is expected and is recorded as such, so no later reader mistakes it for corruption.
  4. **Installation is exactly reversible and touches nothing that is not ours.** Exactly one file per vault is written — `<vault>/.obsidian/plugins/live-share/main.js` — and `manifest.json`, `styles.css`, `data.json`, `community-plugins.json` and the vault's own pre-existing backups (`main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`) are never written, moved, renamed or deleted. The displaced production bundle is captured under the rig's **own** backup namespace with its sha256 recorded, restoration runs on every exit path including failure, abort and interruption, and after restore each vault's `main.js` sha256 equals the recorded production value. An install that cannot establish its restore point does not install. The plugin version is not bumped and `plugin/manifest.json` in the repo is neither read nor edited (broken symlink) — the vaults already carry a valid `manifest.json` for the unchanged version.
- Definition of Done: the gate can build, in one terminating command, the only bundle that can host it — and both the shipped bundle and the owner's vaults are provably where they were.
- Assigned to work package: **WP69**
- Fuzzer link: none. Build configuration and file installation are outside the doc-merge instrument C23 models.

> **Why this is its own work package and not a fifth AC on WP50.** Four reasons, in descending weight.
>
> 1. **Blast radius.** WP50 modifies one Python driver that reads endpoints and renders verdicts; the worst outcome of a WP50 defect is a wrong verdict in a test run. C69 edits the file that decides **what ships to users**, and the failure mode is silent: a production bundle that carries the control server, or a `define` that flips, is not visible in any test this project runs. AC2 exists exactly for that, and an acceptance criterion whose subject is "the shipped artefact is byte-identical" does not belong inside a WP whose Definition of Done is "`run_matrix` becomes a statement about two real Obsidian instances".
> 2. **Failure localisation is the stated design rule of this phase.** §9 records that PHASE T3 was decomposed fine-grained *"because a real-Obsidian run is slow and stateful, so a failure must localise to one layer (discovery, provisioning, launch, identity, safety, teardown, oracle, driver) rather than to 'the rig'"*. Build-and-install is such a layer, and it is the one the pre-flight found missing. Folding it into the driver would put the phase's newest and least-verified step inside the WP whose failures are hardest to attribute.
> 3. **Precedent, three times in this run.** WP63 was split from WP18, WP67 from WP66 and WP68 from WP26, each on the same argument: *folding a change into the WP whose charter did not reach it leaves the new behaviour with no criterion of its own.* WP50's charter never reached the build or the install; T3_SharedContract §1.1 pointed at "WP50/WP51" in prose and no AC followed. That is the precise shape those three splits exist to prevent.
> 4. **Sizing.** WP50 already carries four ACs and gains two more from the pre-flight (C50 AC5/AC6). A build-mode AC, a byte-identity AC, an artefact-integrity AC and an install/restore AC would take it to eight across two unrelated domains — a split condition under the charter sizing rule, not a judgement call.
>
> **The alternative was evaluated and rejected.** Fire-and-forget `npm run dev`, poll for `plugin/main.js`, kill the watcher: it needs no config change, and that is its only advantage. It is a race with no completion signal — mtime can move when a write begins, esbuild's watch rebuilds on any subsequent source change, and a watcher killed mid-write can leave a truncated bundle which is then **installed into the owner's vaults**. That is the "a green that cannot fail" class this run exists to eliminate, wearing a different hat. It would be admissible only with an integrity check on the emitted file — which is AC3, and once AC3 is required anyway the race buys nothing and costs the ability to name the exact command in the WP7 record (C7 AC1 requires the command to be recorded and reproducible). The explicit mode is auditable by reading five lines of config; the polling harness's correctness is not auditable at all.
>
> **Unverified, and stated as such.** Nothing here has been executed. The pre-flight established preconditions, not results: the `e2e` mode does not exist yet, no E2E bundle has been built or installed, no control endpoint has ever answered on this host, and the gate has not run. The 626 711-byte figure, the zero-`__LS_E2E__` count and the two `data.json` hashes are measurements of the **current** state, taken 2026-08-02, and are restore baselines — not evidence that any part of the rig works.

<!-- Updated: C70 added — WP44 provisions one settings key and WP47 places the scratch canvas, but nothing establishes that the scratch folder is inside the shared surface or that a relay exists at all; without both, every matrix case can converge trivially and the release gate goes green having proved nothing 2026-08-02 -->

#### C70 — Gate settings provisioning and local relay lifecycle

- Change type: modify (`tools/obsidian_e2e/constants.py` — the pinned values this component introduces; `tools/obsidian_e2e/ports.py` — one generalised splice reached through one added keyword argument; `workflowArtifacts/canvas-v2/T3_SharedContract.md` — the matching contract entries) + create (`tools/obsidian_e2e/relay.py` — build-or-verify, start, readiness, room creation, stop and release of the rig-owned local relay)
- Responsibility: give the gate a sync path the rig owns end to end — a relay it starts and stops, a room it mints, and a shared surface it **establishes** rather than trusts — so a converged case is a statement about Canvas V2 and not about two files nobody was syncing.
- **The hole this closes.** Two connected gaps, both previously unowned. **(a)** WP44 provisions exactly one key, `e2eControlPort` (`constants.py:83`), and WP47 places the scratch canvas at `<vault>/_e2e-rig/e2e-scratch-<run_id>.canvas` (`constants.py:119–121`, `:168–170`) — vault-relative and rig-owned. Nothing established that `_e2e-rig` is inside the shared surface, or that the two vaults agree on `roomId` / `serverUrl` / `sharedFolder`. If `sharedFolder` does not cover `_e2e-rig`, the scratch canvas is never synced, every matrix case converges trivially, and the release gate goes green while proving nothing — a vacuous green in the most consequential position this initiative has. **(b)** WP7 §2 scopes deployment out and states that the gate "runs against a local relay", but nothing under `tools/obsidian_e2e/` starts one and no rig module reads either vault's `serverUrl`. **C50 AC5 is the *detector* for (a); C70 is the *provisioner*.** They are deliberately distinct, and the provisioner must not be able to satisfy the detector by reading back its own write.
- Interfaces:
  - Input: the two resolved vault descriptors (C43), a run identifier, and the scratch folder scheme C47 owns
  - Output: a running local relay with a pinned port and a minted room; per vault one borrow carrying the full provisioned key set; an enforced and recorded ordering; a released port and a removed store directory
- Acceptance Criteria:
  1. **Every setting the gate depends on is provisioned through WP44's single borrow, and no second mechanism touches `data.json`.** The provisioned key set is pinned once in `constants.py` and is exactly: `e2eControlPort`, `serverUrl`, `roomId`, `token`, `role`, `permission`, `sharedFolder`, `excludePatterns`, `autoReconnect`, `debugLogging` — every one an existing member of `LiveShareSettings`, no key invented, and `encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword` neither read nor written. They are written in **one** capture-and-splice, by the existing borrow, into the existing backup namespace (`data.json.e2e-original`, `.e2e-provision.json`), reached through **one** added keyword argument; the marker's pinned field set is unchanged, and the restore path is not modified at all. Provisioning the port alone still produces byte-identical output to the pre-change implementation, and every byte outside the spliced members survives the round trip — the file keeps its own indentation, line endings, key order and encoding. `debugLogging` is provisioned `false` for the duration and restored, because a debug log written to `debugLogPath` inside the vault is a vault write that the C47 AC3 fingerprint would report as a mismatch. A run that cannot establish its borrow provisions nothing.
  2. **The shared surface is established by the rig, not trusted, and it is narrowed rather than widened.** `sharedFolder` is provisioned to the rig-owned scratch folder C47 already owns, so the run's scratch canvas is inside the shared surface **by construction** and nothing else in either vault is; `excludePatterns` is provisioned empty so no owner-side pattern can exclude the scratch folder from a surface that now contains only it. The rig states this positively in its run record — which folder is shared, in both vaults — rather than inferring it from a successful sync. The reason is data safety, not convenience: `isSharedPath` treats an **empty** `sharedFolder` as *the whole vault shared* (`plugin/src/files/manifest.ts:422–450`), `resumeSession` publishes the host's manifest with `purge: true` (`plugin/src/main.ts:465–489`), and the guest's `cleanupStaleFiles` **trashes every shared local file absent from that manifest** (`:523–540`) — so a run against an unconstrained shared surface can destroy the owner's files in the second vault. The two vaults' stored values have never been read and the rig must not assume they agree, are empty, or are equal to each other; it establishes the state and records what it established. C50 AC5 remains the independent detector, and satisfying it must require the instances' own view of what they share — never a read-back of the file this criterion wrote.
  3. **The relay is built if needed, started, proven ready, and provably released — by the rig, on every exit path.** Its port is a new constant in `constants.py`, disjoint from `39421`/`39422` and `39431`/`39432`, mirrored into `T3_SharedContract.md`, and spelled as a literal nowhere else. Before start, an occupied port is a **named refusal**, never an adoption and never a kill: the rig may not attach to a relay it did not start — a stale relay carries a stale room and would let a run go green against a peer that is not there — and it may not terminate a process it did not start (D15/S2). The server build is verified present and current and is built with the terminating `tsc` build when it is not; there is no watch trap on this side, unlike C69's. Readiness is a **positive probe of `GET /healthz` reporting `ok`** (`server/src/index.ts:73–81`), bounded, naming the awaited condition on expiry — never a sleep, and never the mere fact that a process was spawned. All three of the relay's cwd-relative LevelDB stores (`BLOB_STORE_PATH` → `./data/frames`, room persistence → `./data/yjs-docs`, audit log → `./data/audit`) are pointed at a run-scoped directory outside the repository and outside both vaults, and that directory is removed at teardown, so no run writes a store into the tree and no run inherits a previous run's rooms. Stop runs on success, failure, abort and interruption, and "stopped" means the **port no longer accepts a connection**, verified by a bounded probe — not that a terminate call returned. An orphaned listener at the end of a run is a failed run.
  4. **The gate's start-up and teardown order is stated, enforced and recorded, not implied.** Start-up: the E2E-capable bundle is verified and installed (C69) → the relay port is free → the relay is started and ready → the room is minted on that relay → **then** each vault is provisioned, with the room's own `id` and `token`, while its Obsidian instance is **not running** → then Obsidian is launched or attached (C45) → then readiness and identity (C46) → then the scratch canvas (C47) → then the first matrix case (C50). Teardown reverses it, and runs to completion even when a step fails. Provisioning into a vault whose plugin is already loaded is refused under the existing `RESTART_REQUIRED_OPERATOR` reason rather than performed: the settings are read once at load (`plugin/src/main.ts:408–417`), so a late write is not read — and worse, any later `saveSettings()` in that live instance writes its in-memory copy back over the rig's file, silently reverting the provisioning and corrupting the borrow the restore depends on. Each ordering constraint is enforced by the code, not only documented, and the run record states which steps ran in which order.
  5. **A change made in vault A is demonstrated to reach vault B *through the relay*, and that demonstration is distinguishable from every other way the content could have arrived.** This is the single most important criterion in this component: it is what converts the whole T3 layer from "two vaults ended up with the same file" into evidence about Canvas V2. It requires **two independent facts**, at least one of which is a fact about the relay or about a peer that is not connected: a **positive relay-side observation** that the run's canvas document carried traffic between two distinct clients in the rig's own room — the relay is hermetic and no other engine is connected to it, so its own accounting (`GET /healthz`'s document and client counts, and the frames its store retained for the room) is evidence no file-copying engine can manufacture — and a **negative control** in which the same gesture, performed while the relay-mediated path is provably not in place, does **not** produce the change in vault B within a window at least as long as the positive leg needed. Content appearing in vault B is **not** sufficient on its own and may not be recorded as satisfying this criterion. <!-- Updated: the second engine named here was wrong — lan-vault-sync is installed but NOT enabled; the enabled engine is obsidian-git, and its disposition is now a precondition rather than one of two choices, which strengthens rather than weakens this criterion 2026-08-04 --> **The second engine is `obsidian-git`** — enabled in both vaults, `autoPullOnBoot: true`, over dirty git working trees with `origin` remotes — and it can bring content into either vault by a path that has nothing to do with the relay. **`lan-vault-sync` is installed but NOT enabled and cannot run**; it is named here in that form only so it is not rediscovered. C50 AC5 now fixes `obsidian-git`'s disposition as a **precondition** (disabled for the run, restored afterwards, both recorded) rather than one of two permitted choices — and this criterion must hold **anyway**, because a precondition is a claim about what was configured and this criterion is a claim about what the relay observed. The two are independent on purpose: if satisfying this criterion required trusting that the disabling actually took effect, the disposition record would have become the evidence, which is exactly the substitution this criterion exists to refuse. A run in which the positive leg passes and the negative control also "passes" (the change appears anyway) is a **failed** run reported under a named reason, not a stronger result.
- Definition of Done: the gate has a sync path the rig owns from the relay to the shared folder, and a green case can no longer mean that two vaults were never connected.
- Assigned to work package: **WP70**
- Fuzzer link: none. Process lifecycle and settings provisioning are outside the doc-merge instrument C23 models.

> **The relay decision — recorded, not re-litigated.** **The gate runs against a LOCAL relay, started and stopped by the rig.** A release gate must be hermetic. `server/package.json` builds with `tsc` and starts with `node dist/index.js` — ordinary process control, and unlike the plugin's dev build (C69) **both commands terminate**, so there is no watch trap on this side. A local relay is therefore cheap and deterministic. The owner has *authorised* deploying the relay to the NeuralAngels box for testing (`T3_SharedContract` §10a), but that is permission, not a requirement, and a network dependency would inject exactly the flake this run has spent its whole length eliminating from its own signals. **Remote-relay operation may later be recorded as a future, non-gating matrix case; it is not part of this gate and is not chartered.**
>
> **Why the rig rewrites `roomId` / `serverUrl` / `sharedFolder` rather than requiring the owner to have set them.** Three reasons, the first of which is decisive and is a fact rather than a preference.
>
> 1. **Requiring is impossible for `roomId` and `token`.** `POST /rooms` mints `id: randomUUID()` and `token: nanoid(24)` server-side (`server/src/rooms.ts:83–115`); a client cannot dictate either. A hermetic local relay starts with an empty room set, so **no pre-existing setting in either vault can match a room that does not exist until the rig starts the relay.** "Require the owner to have configured it" would mean requiring configuration for a room minted after the requirement is checked.
> 2. **Rewriting `sharedFolder` is a data-safety requirement, not a convenience.** See AC2: empty `sharedFolder` means the whole vault is shared, the host publishes with `purge: true`, and the guest trashes every shared local file the manifest lacks. Pinning the shared surface to the rig-owned scratch folder simultaneously *provides* non-vacuity and *removes* the blast radius. A "require" design would have to verify the same property anyway and would then refuse on state only a human can fix — a gate that cannot start itself.
> 3. **The two vaults are literal copies of each other and may already share a `roomId`. Nobody has read the values** (`T3_PREFLIGHT.md` open question 3), and the spec must not assume either way. A rewrite makes agreement a construction; requiring makes it a hope about unmanaged state, and an accidental agreement inherited from a copy is indistinguishable from a deliberate one until it silently stops being true.
>
> **What rewriting costs, and how it is paid.** It touches the owner's settings. That cost is already carried and already solved: WP44 borrows `data.json` byte-exactly, restores it verbatim on every exit path, and its restore is checked at teardown against an **independent** baseline the rig did not produce (C50 AC6, §7). C70 adds members to that one borrow rather than opening a second — the marker's pinned field set and the restore path are untouched — precisely so that two mechanisms can never race over one file. If ten provisioned keys do not restore as byte-exactly as one did, the restore was broken, and the §7 baselines will say so.
>
> **Unverified, and stated as such.** Nothing here has been executed. Every fact cited above was read from source or measured as static state on 2026-08-02. No relay has ever been started by any rig module, no setting beyond `e2eControlPort` has ever been provisioned, no control endpoint has answered on this host, and no propagation between the two vaults has been observed. The `sharedFolder` / `purge` / `trashFile` path is a claim about what the code **would** do, not a report of anything that happened.

<!-- Updated: C71 added — WP43–WP49 delivered a plan-only rig by design (C45 AC4 forbids the rig spawning processes), so the mediation that turns its plan into an executed, reproducible run was never chartered and WP7's AC1 is unsatisfiable without it 2026-08-04 -->

#### C71 — Agent-mediated gate execution: the run plan, its outcomes and its replay

- Change type: create (`tools/obsidian_e2e/mediation.py` — the plan/outcome artefact and the console seam that consumes it) + modify (`tools/launch_obsidian_e2e.py` — emit the whole-run plan and render the verdict from fed-back outcomes; `workflowArtifacts/canvas-v2/T3_SharedContract.md` — the matching contract entry)
- Responsibility: make a gate run that no process can start end to end nevertheless **reproducible** — by turning the rig's planned calls into one ordered artefact an agent executes verbatim, and by making the rig, not the agent, render the verdict from what came back.
- **The gap this closes, and what it is *not*.** `tools/obsidian_e2e/lifecycle.py` exposes `PlanOnlyConsole` as its **only** console backend, and there is **no `subprocess`, `Popen` or other process spawn anywhere in `tools/obsidian_e2e/`**. Measured 2026-08-04. **This is not a failure of WP43–WP49.** C45 AC4 requires every long-running process the rig starts to be started through the workspace `visible-console` tools; the rig runs as a plain Python process with no MCP client, so it *cannot* make those calls itself, and a direct spawn would have violated the criterion it was built under. `spawn_through_console` is the single sanctioned seam and `PlanOnlyConsole` already emits, per planned call, the exact `{server_id, tool_name, arguments}` payload a client would send. Every one of WP43–WP49's deliverables — discovery, port provisioning, launch planning, readiness, scratch safety, teardown, the oracles — is real and is not re-scoped by this component. **What was never chartered is the mediation itself:** nobody owns the artefact that carries a whole run's plan, nobody owns feeding the outcomes back, and nobody owns the statement that the executed sequence was the planned one. Consequently `launch_obsidian_e2e.py` plans launches and cannot run a gate, and C7 AC1's "executes end to end" has no satisfiable reading. This component supplies the missing capability.
- **Why a real spawn backend is the wrong answer — decided, not left open.** Adding a `subprocess`-based console backend would be a smaller change and is rejected on three grounds, the first decisive. **(a) It contradicts a landed acceptance criterion.** C45 AC4 is `DONE` and says every long-running process the rig starts goes through `visible-console` and never a detached background process; a spawn backend does not satisfy it, so shipping one silently reopens WP45's AC rather than adding capability — the precise move §7 exists to make impossible. **(b) It removes the only structural guarantee protecting the owner's vaults.** The console is *injected*, which is what makes it impossible for a test, a dev loop or a mistaken import to reach the real `Obsidian.exe` and the owner's live working vaults by accident (D16). A default-constructed spawn backend converts that structural property into a convention. **(c) It buys less reproducibility than it appears to.** Even with a spawn backend the run would still be started, watched and adjudicated by an agent, so the artefact this component defines would still be required; the spawn would merely hide *which* steps a human or an agent had improvised. The mediated design makes that visible by construction, which is the property §7 and C7 AC1 actually need. **Consequence recorded honestly: an agent-mediated gate is harder to make reproducible than a single command, and this component's whole burden is to pay that cost in an artefact rather than in trust.**
- Interfaces:
  - Input: the rig's planned calls for a complete run — install (C69), relay (C70), provisioning (C44/C70), launch or attach (C45), readiness (C46), scratch (C47), matrix (C50), scenario (C51), teardown (C48) — plus the outcomes an agent returns for them
  - Output: one ordered, machine-readable run-plan artefact; one outcome record per planned step; a rig-computed verdict; and a replay statement that names any divergence between planned and executed
- Acceptance Criteria:
  1. **The plan is complete, ordered, machine-readable and emitted before anything is executed.** Every call the run will make is a numbered step carrying the verbatim `{server_id, tool_name, arguments}` payload and the argv list as a **list**, never a rendered command string — both target vault paths contain spaces and a rendered line is a re-parsed launch vector. The plan is written to a run-scoped artefact under `workflowArtifacts/canvas-v2/` before the first step is executed, so a plan that was truncated or revised mid-run is detectable rather than invisible. The ordering constraints C70 AC4 enforces are expressed *in the plan*, not merely honoured by whoever reads it.
  2. **Every planned step has exactly one recorded outcome, and a missing outcome is a named failure rather than an omission.** An outcome carries the step number, the console id, the exit status or the structured result, and it is supplied by the console surface — **an agent's narration of what it did is not an outcome, and no criterion may be discharged by one.** A run whose outcome record is incomplete reports `INCOMPLETE` under the name of the first step that lacks one; it may not report a verdict, and it may not be recorded as green with a caveat.
  3. **The rig renders the verdict, not the mediating agent, and improvisation is refused rather than tolerated.** The verdict is computed only from fed-back outcomes. An executed step that does not correspond to a planned step, a planned step executed out of order, and a planned step executed with arguments that differ from the planned payload are each detected and each fail the run under a distinct named reason. The replay statement records, positively, that the executed sequence was the planned sequence — a run that cannot state that has not been reproduced and cannot claim to be reproducible.
  4. **Mediation adds no process-spawn capability anywhere in the rig, and this is structural rather than incidental.** After this component lands there is still no `subprocess`, `Popen`, `os.system` or equivalent under `tools/obsidian_e2e/`; the console remains injected; `spawn_through_console` remains the single seam; and C45 AC4 is satisfied unchanged. A backend that starts a process directly is out of scope and adding one is an ESCALATE, not a judgement call.
- Definition of Done: a gate run nobody can start with one command can nevertheless be replayed step by step from a committed artefact, and no step of it rests on an agent's account of itself.
- Assigned to work package: **WP71**
- Fuzzer link: none. Run orchestration is outside the doc-merge instrument C23 models.
- **Unverified, and stated as such.** Nothing here has been executed. `PlanOnlyConsole` has never had its payloads consumed by a real `visible-console` call, no plan artefact exists, and no control endpoint has ever answered on this host — the latter now **measured** (both real control ports probed free, nothing listening), not inherited.

<!-- Updated: C72 added — canvas.setFlag rewrites data.json from the live in-memory copy for any name that is an existing settings key, which can silently destroy the borrow C70 depends on; verified against the current tree 2026-08-04 -->

#### C72 — `canvas.setFlag`: the borrow-clobber and the inert flag map

- Change type: modify (`plugin/src/testing/e2e-control.ts` — `setFlag` in `buildPluginHost` and the `runtimeFlags` map it writes)
- Responsibility: stop a control command from rewriting the settings file the gate's restore depends on, and stop it reporting success for a flag nothing consumes.
- **Verified against the current tree (rule 12), 2026-08-04.** `setFlag(name, value)` tests `Object.prototype.hasOwnProperty.call(plugin.settings, name)`. **Two distinct defects share the one function, and only one of them is chartered anywhere.**
  - **(a) Borrow-clobber — chartered by no WP, and it is the dangerous one.** On the true branch it assigns into the live `plugin.settings` object and calls `plugin.saveSettings?.()`, which rewrites the whole of `<vault>/.obsidian/plugins/live-share/data.json` **from the in-memory copy**. C70 AC1 borrows that exact file byte-exactly and restores it verbatim, and C70 AC4 already records the general form of this hazard — *"any later `saveSettings()` in that live instance writes its in-memory copy back over the rig's file, silently reverting the provisioning and corrupting the borrow the restore depends on"* — but attributes it to late provisioning, not to a control command the gate itself issues mid-run. `setFlag` is that command. Every canvas-relevant settings key the gate cares about (`useCanvasBinding`, `showCanvasPresence`, `showCanvasCursors`, `sharedFolder`, `roomId`, `serverUrl`) is an existing key, so the natural use of this command takes the true branch. The blast radius is the run's own restore and, through C50 AC6, the gate's verdict: a `data.json` that does not hash back to its baseline **fails the run**, and the cause would look like a restore bug in WP44.
  - **(b) Inert map — the vacuity C51 AC3 already targets, restated here only as the boundary it shares with (a).** On the false branch the value goes into `runtimeFlags` (`plugin/src/testing/e2e-control.ts:803`), which is **written at exactly one site and read by nothing in `plugin/src`** — grep-verified. The function returns `{ set: true }` for **any** name whatsoever, so a caller cannot distinguish a flag that was applied, a flag that was stashed where nothing will read it, and a flag that does not exist. **C51 AC3 owns the rejection rule and is not restated or weakened here**; this component owns the file-write behaviour of the true branch and the truthfulness of the return value, which C51 AC3 does not reach.
- Interfaces:
  - Input: a control `canvas.setFlag` command naming a flag and a value
  - Output: a disposition the caller can act on — applied, refused, or refused-because-inert — and, on the applied path, a bounded and reversible effect on the instance that never rewrites the borrowed settings file
- Acceptance Criteria:
  1. **A control command cannot rewrite the borrowed settings file.** `setFlag` performs no `saveSettings()` and no other write to `data.json`, by any path, for any name, including names that are existing settings keys. The behaviour that made this possible is removed rather than guarded by a caller-supplied option: a flag whose effect requires persistence is refused at the command boundary under a distinct named reason. This is demonstrated, not asserted — with the file's sha256 taken before and after a `setFlag` of an existing settings key and shown unchanged, per the credential rule of hash-only comparison.
  2. **An in-memory settings override, where one is still wanted, is explicitly scoped to the session and is reversible.** Any value the command applies to the live instance is applied to the in-memory state only, is recorded so the instance can be returned to its prior in-memory value through the protocol, and does not survive the instance. Nothing in the applied path may reach a persistence call, and a plugin whose `saveSettings` is invoked by an unrelated code path must still restore to the borrowed bytes.
  3. **The return value distinguishes the outcomes it currently conflates.** `{ set: true }` is returned only when the named flag was applied to a path that consumes it. A name that is refused, and a name accepted only into a store nothing reads, are each reported as their own outcome and never as success. The criterion is falsified by calling `setFlag` with a name in each class and showing the three responses differ — a single response shape for all three is the defect, not a simplification.
  4. **No production canvas module gains a branch, and the production bundle is unchanged.** The whole of `src/testing/` still tree-shakes out of the production `main.js` (`__LS_E2E__` false), and no file outside `plugin/src/testing/` is modified.
- Definition of Done: the gate's own control surface can no longer destroy the settings borrow its verdict is checked against, and it can no longer report success for a flag that does nothing.
- Assigned to work package: **WP72**
- Fuzzer link: none. Control-surface behaviour is outside the doc-merge instrument C23 models.
- **Relationship to C51, stated so the two cannot be merged by a later reader.** C51 AC3 is the *rejection rule* — a flag no path consults is refused at the command boundary. C72 is the *file-write and truthfulness* rule. They meet in one function and are separable: C51 AC3 can be satisfied in full while `setFlag` still rewrites `data.json` for every accepted name, which is precisely the state the tree is in today. Folding C72 into C51 would leave the borrow-clobber with no criterion of its own — the same argument that separated WP63 from WP18, WP67 from WP66, WP68 from WP26 and WP69 from WP50.

<!-- Updated: C73 added — the matrix driver discards the `applied` flag its own control protocol returns, so an unapplied gesture leaves both snapshots equal and the case records a pass; this is the SEVENTH instance in this run of a green that cannot fail, and the first inside the gate's own driver 2026-08-04 -->

#### C73 — Matrix driver: an unapplied gesture must be impossible to record as a pass

- Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_run_case` and the `_simulate` wrapper it calls)
- Responsibility: make the driver's own verdict depend on the gesture having taken effect, so a case cannot pass by both peers agreeing about nothing having happened.
- **Verified against the current tree (rule 12), 2026-08-04, and the count in the original report is corrected.** `canvas.simulateEdit` returns `{applied}`; `_simulate` returns that result verbatim; the `edit` tool surfaces it as `{"applied": bool(...)}`. **`_run_case` discards the return value at every call site.** The original description said six; the measured number is **eleven `_simulate` calls across the six cases** (`initial-sync` 1, `multi-edge-move` 2, `bidirectional-drag` 3, `add-node-edge` 2, `delete-node-edge` 2, `file-node` 1) — six is the case count, not the call-site count, and a repair scoped to six sites would leave five gestures unchecked. Every case then decides on `_converge_and_check`, which compares the two snapshots: **if the gesture never applied, both snapshots are equal and `converged` is `True`.** For `initial-sync` that is the entire verdict, so the case records `pass` having demonstrated nothing. The four cases that add a content predicate (`moved`, `both`, `has_node`/`has_edge`, `node_gone`, `file_ok`) are protected against the *final* gesture silently failing but not against an unapplied *setup* gesture, and `delete-node-edge`'s `node_gone` is **satisfied by the node never having been created** — an unapplied setup makes its own oracle vacuously true.
- **This is the seventh instance in this run of "a green test that cannot fail", and it is inside the gate's own driver.** The six before it were: the vacuous blind runner; unfalsifiable assertions; oracles vacated by a semantic change; a global perturbation that falsely certifies; a prior batch's amendment masking a later falsification; and WP25's ordering gate stalled at the wrong seam. **That history is the argument for this component, not decoration around it.** The class has never once been found by the mechanism that was supposed to catch it, and the instrument that renders the release gate's per-case verdicts is the last place in the project where it may survive. C50 AC3 already forbids exactly this outcome — *"a case whose oracles disagree or whose gesture did not take effect is reported as inconclusive rather than as a pass"* — and the driver as it stands cannot honour it, because it throws away the only datum that says whether the gesture took effect. **C73 is the mechanism C50 AC3 names and never had.**
- Interfaces:
  - Input: the per-gesture `{applied}` the control protocol already returns
  - Output: a per-case verdict in which an unapplied gesture is `inconclusive` and is attributed to the gesture that failed
- Acceptance Criteria:
  1. **Every gesture's `applied` is consumed, at every call site, and an unapplied gesture cannot reach a pass.** All eleven `_simulate` call sites in `_run_case` — setup gestures included — are checked. A gesture reporting `applied: false`, or a response from which `applied` is absent, terminates the case as **`inconclusive`** naming the case, the gesture and the instance; it never falls through to a snapshot comparison, and `inconclusive` is never counted as a pass by `run_matrix`'s `allPass`. A missing `applied` key is treated as unapplied, not as `True`: a default-true read is the same defect wearing a default.
  2. **The verdict names the oracle *and* the gesture, so a vacuous convergence is attributable.** Per C50 AC3 each case already reports which oracle decided it; a case terminated under AC1 additionally reports which gesture failed to apply, so "both snapshots were equal" can never again be reported without saying whether anything was ever done to them.
  3. **The repair is falsified by injecting exactly the condition it fixes.** With the driver otherwise unchanged, a control endpoint is made to return `applied: false` for one gesture and the affected case must move from `pass` to `inconclusive`; the same injection against the unrepaired driver must produce `pass`, and both results are recorded. The injection is targeted at the single gesture, not global (hard-won rule 2), and the report states whether neighbouring cases stayed green. **A repair to a "green that cannot fail" that is not demonstrated to redden under its own class is not a repair** — it is the sixth instance's lesson: a perturbation that changes nothing is a finding, not a null result.
  4. **The existing tool surface, argument shapes and case names are unchanged, and no runtime dependency is added.** `run_matrix` keeps its signature and its six `MATRIX_CASES` identifiers; `inconclusive` is expressed within the existing per-case result shape rather than by a new tool; the driver remains standard-library only.
- Definition of Done: the driver that renders the release gate's per-case verdicts can no longer report a case in which nothing happened as a case that passed.
- Assigned to work package: **WP73**
- Fuzzer link: none. Driver verdict logic is outside the doc-merge instrument C23 models.
- **⚠ Location note the implementor must not re-derive, and the Dispatcher must rule on.** `tools/MCPserver/liveshare_e2e_mcp_server.py` **does not exist in this repository.** It lives in the AgenticWorkspace repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`. C50 and this component both name it as a repo-relative path, which it is not. **The line references are accurate and are not the problem** — checked against that file: `_wait_both` `:134`, `assert_converged` `:280` (decorator; `def` at `:281`), `run_matrix` `:402` (decorator; `def` at `:403`), `_run_case` `:321`, `_simulate` `:122`, `_converge_and_check` `:304`. Only the *repository* is wrong. The practical consequences are that the change lands outside this project's branch and outside §7's commit and abort accounting, and that this WP's Python verification script cannot live beside the file it verifies under the usual convention. **Unverified: whether the Dispatcher intends the edit to be made in the workspace repo or the file to be vendored into this one.** Nothing here presumes an answer.

<!-- Updated: C74 added — the same class one seam over from C73: `_open`'s results are discarded at the only two opens the matrix performs, and `_wait_both` discards both `{quiescent}` answers, so a case can be decided against a canvas nothing is subscribed to and a wait that TIMED OUT is read as a settle; verified against the driver at AgenticWorkspace `50b0cf4`, i.e. after C73 landed 2026-08-04 -->

#### C74 — Matrix driver: the never-opened canvas and the timed-out wait

- Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_wait_both`, `_converge_and_check`, `run_matrix`'s pre-case open, and the `open_canvas` tool's verdict)
- Responsibility: make the driver's own verdict depend on the canvas having been subscribed and on the settle having actually settled, so a case cannot be decided about a document nothing was attached to, and a timeout cannot be read as convergence.
- **Verified against the current driver (rule 12), 2026-08-04, at AgenticWorkspace `50b0cf4` — i.e. AFTER C73 landed. C73 moved neither seam. Every count below was walked from the module's AST, not taken from the report that raised the defect.** **Two distinct defects share one component, they do not subsume each other, and the tempting simplification of treating them as one is wrong.**
  - **(a) `_open` — the run may proceed against a canvas neither instance is subscribed to.** `_open` has **four** call sites. **Two are the only opens the matrix ever performs** (`run_matrix` `:509`, `:510`) and both are statements whose return value is **discarded entirely**; `_run_case` opens nothing, so every case inherits whatever those two calls did or did not achieve. The other two (`open_canvas` `:238`) return `{opened, subscribed}` verbatim but derive **no verdict** from them, so the tool answers `status: "ok"` for a canvas neither instance opened — surfaced-without-a-verdict, which is a different defect from discarded and must be repaired as one. **The oracle cannot recover from this**: the control server's `canvasState` returns `{nodes: [], edges: []}` whenever `getCanvasSnapshot` returns `null`, and that happens in **four** distinct situations — not subscribed, no resolvable doc id, no doc handle, **or an empty shared doc** — all of which reach the driver as the same value, and `_compare` of two empty snapshots is `converged: True`. **The driver's convergence oracle therefore cannot distinguish "both peers agree" from "neither peer has anything to say", and `{opened, subscribed}` is the only datum in the protocol that can.** `subscribed` is the load-bearing field, not `opened`: `{opened: false}` arises only when the instance has no canvas surface at all and is already fail-closed downstream through C73's gesture checkpoint, whereas the reachable dangerous state is the **mixed** one, `{opened: true, subscribed: false}`, which nothing downstream refuses.
  - **(b) `_wait_both` — a wait that timed out is indistinguishable from a settle, and this is the worse of the two.** `_wait_both` (`:148-151`) calls `_wait` for both instances and **returns `None`**; both `{quiescent}` answers are dropped. One structural site — `_wait` is called from nowhere else and `_wait_both` from nowhere but `_converge_and_check` (`:326`) — but that function is reached **ten** times in a full matrix run (`initial-sync` 1, `multi-edge-move` 2, `bidirectional-drag` 2, `add-node-edge` 2, `delete-node-edge` 2, `file-node` 1), so **twenty** answers are discarded per run. **The settle decomposition 1/2/2/2/2/1 is NOT C73's gesture decomposition 1/2/3/2/2/1** — `bidirectional-drag` issues three gestures and settles twice — and copying one into the other is a mistake with a specific shape. **Why (b) is worse:** `waitQuiescent` answers `false` in exactly one situation, activity still landing for the whole timeout, which is the signature of stalled or slow relay deltas — **the signature of the sync defect the gate exists to catch.** The driver then reads both snapshots immediately, two peers that have not yet diverged *because the delta reached neither* compare equal, and the case records `pass`. **The condition that manufactures the false green is the condition a real sync bug produces**, so this seam does not merely fail to detect that class — it inverts the verdict on it.
  - **The two are complementary and neither substitutes for the other.** `lastActivity` is advanced only through a doc observer registered in `canvasOpen` and in `simulateEdit`, so a canvas nothing observes has it frozen at host construction and the **first** poll already reports `{quiescent: **true**}`. A never-opened canvas therefore reports quiescent **true**, not false: consuming `quiescent` does not detect (a), and checking `subscribed` does not detect (b).
- **The generalisation, stated before the instances, because the instances are not the point any more.** Every seam in this driver that returns a status **nobody checks** has turned out to read as success. WP73 closed one (`applied` discarded at eleven gesture sites) and, in closing it, found a second **outside its own eleven**: the `edit` MCP tool read `result.get("applied", True)`, so an **absent** key was reported to the caller as *applied*. That is the identical shape — a missing signal defaulting to success — one level up in the tool surface. C74's two seams are the same shape again at `canvas.open` and `sync.waitQuiescent`, and the sweep below finds it a fourth time at `session.info`. **The class is not "the driver forgets one flag"; it is "a response field with no reader reads as success."** That is why C74 carries AC5, an inventory of the whole response surface, in addition to the two repairs.
- **This is the eighth instance in this run of "a green test that cannot fail", and the second found inside the gate's own driver — one seam over from the seventh.** C73 closed `_run_case`'s discarded `applied`; these two seams were out of its charter and survived it. **The pattern is the finding**: the class has now been located one seam over from where it was last fixed twice in succession, in the same file, within one working day. C50 **AC1** requires that *"the driver settles on the C49 quiescence signal"* — settling on a signal whose answer is thrown away is not settling on it — and C50 **AC5** requires that *"a case that converges because nothing was shared is reported inconclusive, never as a pass"*, which is seam (a) verbatim. **C74 is to C50 AC1 and AC5 what C73 is to C50 AC3: the mechanism those criteria name and have never had.** It must land **before the gate run**, not merely before the project closes — nothing about the gate has been executed, and this is the difference between finding an unfalsifiable green before the run and discovering it in the one artefact the project is measured by.
- **On whether C73's shape transfers — decided here, because the answer is not uniform.** C73's solution is *route every site through one checkpoint and assert that structure from the AST so a future call site cannot skip it by construction.* It transfers to **(b)** and is easier there: the funnel already exists, so the invariant is *no `_wait` call outside `_wait_both`, and no `_wait_both` call whose result is discarded.* It does **not** transfer to **(a)**, for three structural reasons: the call sites live in functions with different contracts, and `open_canvas`'s `{a, b}` shape is frozen by C50 AC4 and C73 AC4; an unopened canvas is a property of the **run**, not of a case, so reporting it as six `inconclusive` cases would attribute a run-level precondition failure to six oracles that never ran — **the exact mis-attribution C73 AC2 exists to prevent, reintroduced by copying C73's mechanism where its semantics do not fit**; and the datum is two booleans on two instances whose dangerous state is the mixed one, which a truthiness checkpoint passes. **The AST-assertion half applies to both seams; the raises-per-case half applies to (b) only, and (a) is a run-level precondition refusal** — which is also literally what C50 AC5 already demands of every other precondition.
- Interfaces:
  - Input: the `{opened, subscribed}` `canvas.open` already returns and the `{quiescent}` `sync.waitQuiescent` already returns
  - Output: a run that refuses to begin against an unsubscribed canvas, and a per-case verdict in which a timed-out settle is `inconclusive` and is attributed to the instance whose wait expired
- Acceptance Criteria:
  1. **The run refuses to begin against a canvas the instances are not subscribed to, and the refusal is a run-level verdict rather than six case verdicts.** Both `{opened, subscribed}` results the matrix's pre-case opens obtain are consumed, on both instances; `subscribed` must be `True` on each, `opened` alone does not satisfy it, and a response from which either key is absent counts as **not subscribed** rather than as subscribed. Failure terminates the run **before the first case** as **`inconclusive`**, naming the instance and the field that failed, carrying `allPass: false`, and fabricating **no** per-case verdicts — a run-level precondition failure attributed to six oracles that never ran is the mis-attribution C73 AC2 exists to prevent. The `open_canvas` tool keeps its `{a, b}` shape unchanged for existing callers and additionally reports a verdict a caller can act on, so it can no longer answer `status: "ok"` for a canvas neither instance subscribed to.
  2. **A wait that timed out can never be read as a settle, and it is `inconclusive` rather than `fail`.** Every `{quiescent}` the settle path obtains is consumed — both instances, at all **ten** `_converge_and_check` reachings — and a `quiescent: false` from either instance, or a response from which `quiescent` is absent, terminates the case as **`inconclusive`** naming the case, the instance and the wait. It never falls through to a snapshot read or to `_compare`, and it is not routed into the generic driver-exception path that renders `fail`: a case that could not be decided is not a case that failed, and collapsing the two loses exactly the information the gate needs. `inconclusive` is never counted as a pass by `run_matrix`'s `allPass`.
  3. **Each seam is falsified separately, by injecting exactly its own condition, one at a time.** Two injections against fake endpoints with the driver otherwise unchanged: **(i)** an instance returning `subscribed: false` from `canvas.open` while every other command answers normally, and **(ii)** an instance returning `quiescent: false` from `sync.waitQuiescent` for one wait in one case. Each must be recorded as **not a pass** under the repaired driver and must be shown to produce a **`pass`** against a byte copy of the pre-repair driver under an identical harness; both results are recorded for both injections. Injections are targeted, never global (hard-won rule 2), and the report states whether neighbouring cases stayed green. **`initial-sync` must be among the cases falsified by (ii)** — it carries no content predicate, so `converged` is its entire verdict and it is the case that today records `pass` on a settle that never settled. Injection (i) must be shown to **refuse the run**, not to fail or to inconclusive six cases. **A repair to a "green that cannot fail" that is not demonstrated to redden under its own class is not a repair**, and a single falsification covering both seams demonstrates one of them.
  4. **The tool surface, argument shapes and case names are unchanged, no runtime dependency is added, and C73's machinery is not touched.** `run_matrix` and `open_canvas` keep their signatures and argument shapes; `MATRIX_CASES` keeps its six identifiers; the run-level refusal is expressed inside the existing result shape (`status` / `allPass` / `inconclusive`) rather than by a new tool; the driver remains standard-library only; and `_was_applied`, `gesture()` and `GestureNotApplied` are not modified, relaxed or routed around.
  5. **The class is closed by an inventory, not by this WP's two repairs — every control-protocol response field the driver receives is either read or registered as deliberately unread, and the inventory is asserted from the AST.** For each command the driver issues (`session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `sync.waitQuiescent`), every field of the documented response shape is classified exactly once as **consumed** (some code path reads it and can act on it) or as **deliberately unread** (named, with the reason, and with the WP that owns it if it is somebody's criterion). A field in neither class fails this criterion. The classification is asserted structurally — the same technique C73 used to pin its checkpoint, generalised from one call site to the whole response surface — so that **adding a protocol field, or a new call site that drops one, fails the assertion rather than passing silently.** This is the criterion that distinguishes closing the class from repairing its latest two instances: the class has now been located one seam over from its previous repair **three** times in this one file, and each repair so far has been scoped to the instance in front of it.
- Definition of Done: the driver that renders the release gate's per-case verdicts can no longer decide a case against a canvas no instance is subscribed to, can no longer read a wait that timed out as a settle, and can no longer receive a protocol field that nobody has decided what to do with.
- Assigned to work package: **WP74**
- Fuzzer link: none. Driver verdict logic is outside the doc-merge instrument C23 models.
- **Cross-repo, and settled rather than open.** `tools/MCPserver/liveshare_e2e_mcp_server.py` lives in the **AgenticWorkspace** repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, on branch **`toms_branch`** (not that repo's default). C73's location note left the disposition unverified; **WP73 resolved it in practice** — it committed the workspace-repo change separately at `50b0cf4` and recorded both commit hashes in its implementation report, because §7's commit and abort accounting assumes one repository. WP74 follows that precedent, and its standalone Python verification script sits beside the file it verifies under the usual `tools/test_<name>.py` convention, which is honourable in that repo.
- **⚠ Sweep finding S1, out of C74's scope and named by no charter — ESCALATED, not folded in.** While the driver was open it was swept as a whole, because this class has now been found one seam over from its last repair twice running. The finding is on the plugin side: **`applied` is a constant on the real host.** `simulateEdit` returns the literal `{applied: true}` on every path that returns at all and *throws* rather than reporting `applied: false`; and its transaction skips any record whose `id` is not a string while deleting an absent key from a `Y.Map` is a silent no-op, **so a change spec that alters nothing still returns `applied: true`.** `applied` is an *accepted-the-command* flag, not a *the-edit-happened* flag. **C73's repair is correct, necessary and structurally sound, and its falsifications are real — but all of them are decided against fake endpoints that can return `applied: false`, and no real endpoint can.** Against the build the gate will actually run, C73 AC1's guard is presently unfalsifiable, and `delete-node-edge`'s vacuous `node_gone` — the case C73 named as the subtle one — is closed only as far as `applied` is informative, which against the real host is not at all. This is the same class a **third** time, in the same driver, one seam further again, this time across the protocol boundary in `plugin/src/testing/e2e-control.ts`. C74 may not touch `plugin/**` and does not; the item is escalated to the Dispatcher as candidate new scope.
- **⚠ Sweep finding S6 — the THIRD instance, in the entry point, found by applying the generalisation above rather than by looking where the last one was.** `e2e_connect` issues `session.info` to both instances and **stores the whole response without reading a single field of it.** Its `connected` is set `True` unless the call *raised*, so it means **"the port answered"**, not "the instance is connected" — and the response's own `connected` field, which is the plugin's report of whether its mux and control channels are actually up, is never consulted. Neither are the four identity fields WP46 added, and two of them matter to criteria that already exist:
  - **`pluginBuild`** carries the `e2e` build marker, and WP46 created it *for exactly this check* — *"so a rig can tell an e2e-capable build from a production build by looking at the answer rather than at the port."* **C50 AC5 requires the driver to establish that its endpoint belongs to an E2E-capable build**; the datum arrives in `e2e_connect` and is discarded. **Owner: C50 AC5**, not C74 — flagged, not annexed.
  - **`vaultId` / `vaultName`** are never compared **between** a and b. Per D14 Obsidian is single-instance: a second vault is another window in the same process tree, one control server wins the bind, and **the rig can drive one vault twice while believing it drove two — with a green-looking run.** WP44 provisions per-vault ports precisely to prevent this; nothing in the driver verifies it worked. **Owner: a Dispatcher ruling** — D14 identity distinctness is named in no acceptance criterion of any WP.
  - **`connected` and `canvasSurface`** are pure instances of this component's own class — a returned status with no reader — and are the two fields C74 AC5's inventory forces a decision on without widening into anyone else's criterion.
  **This is the third time the class has been found one seam over from its last repair, and the first time it has been found by looking for the *shape* rather than for the *place*.** It is also the earliest seam of the three: `e2e_connect` runs before every open, every gesture and every settle.
- **Four further sweep items, recorded so they are not rediscovered as findings, and none repaired here.** **S2** — `_compare` silently drops records without an `id`, so two snapshots differing only in id-less records compare equal, while the TypeScript twin of that comparison deliberately falls back to a positional key *"so an unidentifiable record can never silently match a different one"*. **S3** — the settle asks instance a, then instance b, so *"both quiescent"* is never simultaneous; AC2 makes each answer honest and no artefact of this WP may claim more. **S4** — four mid-case settles discard their whole return tuple including `converged`; defensible (a mid-case settle is a barrier, not an oracle) but by omission rather than by decision, so promoting it later must be chartered. **S5** — a driver exception renders `fail` rather than `inconclusive`; fail-closed, so not a false green, and re-classifying it changes C50's per-case verdict semantics and belongs to WP50 if it is taken at all.

<!-- Updated: C75 added — S1 and S6 from C74's sweep, both verified against the current tree by the Dispatcher and re-verified independently here (rule 12): `simulateEdit` returns the literal `{applied:true}` on the real host, and the driver discards the whole `session.info` payload including `pluginBuild` and the two vault-identity fields. This is the NINTH instance of the class in this run and the FIRST that hollows a WP already reported as closed 2026-08-04 -->

#### C75 — Real-host signal fidelity and gate validity: `applied` is a constant on the real host, and the driver cannot tell two vaults from one

- Change type: modify, in **two repositories** — `plugin/src/testing/e2e-control.ts` (this repo, `buildPluginHost.simulateEdit`) and `tools/MCPserver/liveshare_e2e_mcp_server.py` (**AgenticWorkspace** repo, branch `toms_branch` — `e2e_connect`, `run_matrix`'s pre-case region, the module docstring).
- Responsibility: make the two signals the gate's verdict rests on true **on the real host** — the per-gesture `applied` the real endpoint returns, and the `session.info` payload the driver receives and today discards whole.
- **Why this component is separate from C73 and C74, in one sentence:** C73 and C74 close the class where it lands on the **driver**; C75 closes the two places where it lands on the **real host**, i.e. where the gate could pass while proving nothing *against the actual build it will run*.
- **Verified by the Dispatcher against the current tree and re-verified independently here (rule 12), 2026-08-04 — liveshare `b8a541e` for the plugin side, AgenticWorkspace `50b0cf4` for the driver. Both findings hold; the additions below were measured, not carried over.**
  - **(A) `applied` is a constant on the real host — C73 AC1 is presently unfalsifiable against the real build.** The interface at `:285` declares `simulateEdit(path, change): Promise<{ applied: boolean }>`. `buildPluginHost.simulateEdit` (`:978-1024`) is the **only** implementation outside `__tests__`, and its single return, at `:1023`, is the literal `return { applied: true };`. Five conditions change nothing and are not reported: no canvas surface (**throws**, `:980`); no resolvable doc handle (**throws**, `:982`); a record whose `id` is not a string (**silently skipped**, `:1000`/`:1004`); a `removeNodes`/`removeEdges` id the `Y.Map` does not hold (**silent no-op**, `:1002`/`:1006`); and an upsert whose every field already holds the given value (`upsertRecord` skips unchanged keys, `:753-762`). **`applied` is an accepted-the-command flag, not a the-edit-happened flag.** Traced end to end: `routeCommand`'s catch (`:523-525`) turns a throw into a 400, the driver's `_command` raises, `gesture()` does not catch it, and `run_matrix`'s generic handler records **`fail`** — so against the real host **`applied: false` cannot occur, `GestureNotApplied` cannot be raised, and `status: "inconclusive"` from `reason: "gesture-not-applied"` is structurally unreachable.** `delete-node-edge`'s `node_gone` — the case C73 named as the subtle one, because it is satisfied by the node never having been created — is protected exactly as far as `applied` is informative, and row four above is literally that case's delete path. **WP73 is DONE and its charter was satisfied; its guard is structurally correct and every falsification of it was real — but all of them used fake endpoints that can return `applied: false`, and no real endpoint can. This is the ninth instance of the class in this run and the first that hollows a work package already reported as closed. C73 AC1 becomes meaningful when C75 lands and not before; WP73 is NOT re-opened.**
  - **(B) The gate cannot tell two vaults from one.** `buildPluginHost.sessionInfo()` (`:939-957`) returns **nine** keys — `clientId`, `role`, `roomId`, `connected`, `vaultId`, `vaultName`, `vaultPath`, `pluginBuild`, `canvasSurface`. `e2e_connect` (driver `:194-225`) stores each instance's whole response and reads **not one field of it**; its own `connected` is `True` unless the call *raised*, so it means **"the port answered"**, not "the instance is connected", and the response's own `connected` — the plugin's report of whether its mux and control channels are up — is never consulted. Confirmed by search: `vaultId`, `vaultName`, `vaultPath`, `pluginBuild` and `canvasSurface` appear **nowhere** in that file. Its docstring (`:13`) still describes the **pre-WP46 four-key** payload — a contract that changed two WPs ago, in the gate's own entry point, which is the recall-not-re-read pattern (rule 6). Two consequences, and the second is the severe one: **(1)** `pluginBuild` carries the `e2e` build marker WP46 created *for exactly the check C50 AC5 demands*, and nothing reads it, so the gate cannot prove it is driving an instrumented build at all; **(2)** `vaultId` / `vaultName` are never compared **between** roles `a` and `b`, and per **D14** both vault windows may live in one Obsidian process with one control server winning the bind — **so the rig can drive ONE vault twice, believe it drove two, and pass every case.** A two-vault gate that is one vault syncing with itself: every case converges trivially and correctly, with real gestures that really applied, reporting a full green.
- **Ruling: vault distinctness is a gate-validity precondition and gets its own criterion here, not a line inside C50 AC5.** If it fails, **no result from the run means anything, including the cases that passed** — which is a different category from a case-level check, and a different category from the other C50 AC5 preconditions. `pluginBuild` is **cross-referenced** to C50 AC5, which states the requirement; the **consuming** of it belongs here with the rest of the payload, because splitting one payload's consumption across two work packages is how the field was lost in the first place.
- **⚠ One correction to how the `pluginBuild` check is usually phrased, verified here.** "A production build answering the port" is **not** the reachable hazard, and a check written for it cannot fire: the control server exists only inside `main.ts:444`'s `__LS_E2E__` branch and `src/testing/` tree-shakes out of a production bundle entirely, so **a production build has no control port to answer on.** The check is *positive identification of an instrumented build* — require the marker, refuse its absence — which is strictly stronger and covers the hazards that are reachable: a stale e2e bundle, the **headless mock rig** (deliberately disjoint ports per D13, but a mis-provisioned port is exactly the substitution WP7 AC5 exists to prevent), or a control server that won the bind from the wrong window. Same shape as the `__LS_E2E__` count that could not fail and was briefly recorded as discharging W4-1.
- Interfaces:
  - Input: the `canvas.simulateEdit` change spec and the five conditions under which it presently throws or silently does nothing; the nine-key `session.info` payload `e2e_connect` already receives in full
  - Output: an `applied` that means *the edit happened*, a fault distinguishable at the driver from a truthful refusal, a consumed `connected`, a checked `pluginBuild` marker, and a vault-distinctness precondition that refuses the run
- Acceptance Criteria:
  1. **`applied` reports whether the edit happened, on the real host, for every condition under which it does not.** `buildPluginHost.simulateEdit` returns `applied: false` — not a throw, not `true` — for each of: a path with no resolvable doc handle (unsubscribed, no doc id, or no handle); an instance with no canvas surface; a node or edge record whose `id` is not a string; a `removeNodes` / `removeEdges` id the map does not hold; and a change spec that leaves every addressed field at the value it already held. The declared return type at the interface is unchanged and the field stays a boolean. **I11 REFUSAL NEVER DESTROYS is binding: reporting `false` deletes, truncates and mutates nothing** — not the refused record, not the records that did apply, not the `.canvas` file — and a rollback implemented as a delete is the composition I11 forbids. The disposition of a **partially** applicable spec is an architecture decision the implementor makes and records explicitly; either answer is acceptable only if no destructive step is introduced to reach it.
  2. **A genuine fault stays a throw, and a thrown fault is distinguishable at the driver from a truthful `applied: false`.** Faults — a malformed request, an internal error, a condition the host cannot classify — continue to surface as the control server's structured 400, which the driver raises and `run_matrix` records as `fail`. A truthful refusal surfaces as a 200 carrying `applied: false`, which C73's `gesture()` turns into `GestureNotApplied` and `run_matrix` records as `inconclusive`. **The two must not collapse into one another in either direction**, and the implementation report must state which conditions were routed to which and why. Today the distinction exists in the driver and has no reachable producer on the real host: `applied: false` cannot occur, so `inconclusive` from `gesture-not-applied` is structurally unreachable against the real build, and every genuine non-application arrives as `fail` or does not arrive at all. **C73 AC1 is presently unfalsifiable against the real build; this criterion is what makes it meaningful, and no artefact may describe WP73 as having failed.**
  3. **`session.info` is read, not stored — its own `connected` is consumed and its `pluginBuild` is checked for the e2e marker, and an unmarked build refuses the run rather than failing a case.** `e2e_connect` consumes the response's `connected` field rather than inferring connectedness from the call not having raised; a response reporting `connected: false`, or one from which the key is absent, is **not connected**. `pluginBuild` is checked to carry the `E2E_BUILD_MARKER`; an absent, empty or unmarked `pluginBuild` **refuses to start the run** under a named reason, carrying `allPass: false` and fabricating no case verdicts — it is a precondition, not a case failure. The check is **positive identification of an instrumented build**, not detection of a production build. `e2e_connect` leaves no half-registered connection whose failure nothing reads. **The module docstring is corrected to the real nine-key payload**; a docstring describing a payload that changed two WPs ago, in the gate's own entry point, is the recall-not-re-read pattern rule 6 exists for. `pluginBuild`'s check is cross-referenced to **C50 AC5**, which states the requirement; this criterion supplies the consumption.
  4. **Vault distinctness is a gate-validity precondition, checked before case 1, and a match aborts the run.** Before the first case the driver compares `vaultId` and `vaultName` between roles `a` and `b`; **both must differ.** A match on either, or a value absent or empty on either side, terminates the run as **`inconclusive`** naming the reason and the field, carrying `allPass: false`, fabricating **no** per-case verdicts. **Never a pass, never a silent skip, never downgraded to a warning.** Two empty values are a match, not "distinct-unknown": `resolveVaultId` and `resolveVaultName` both degrade to `""`, so an implementation that skips the comparison when a value is missing passes precisely the case in which the driver knows least. Per **D14** both vault windows may live in one Obsidian process and one control server may win the bind, so the rig can drive **one vault twice while believing it drove two** — and every case then converges trivially and correctly, with real gestures that really applied, reporting a full green. **This is a run-validity precondition and not a case-level check: if it fails, no result from the run means anything, including the cases that passed.** The sequential-call limitation recorded as sweep item S3 does not apply here, because vault identity is static across the two calls.
  5. **Each of the four repairs is falsified separately, by injecting exactly its own condition, and the plugin-side repair is falsified against the REAL endpoint rather than a fake.** Four injections, one at a time, the rest unchanged, each recorded as **not a pass** under the repaired code and shown to produce a **`pass`** (or, for AC3/AC4, a started run) against a byte copy of the pre-repair code under an identical harness: **(i)** a `removeNodes` id absent from the map, driven through `buildPluginHost` against a real `Y.Doc` — **not** a hand-rolled fake host — which must yield `applied: false` and carry `delete-node-edge` to `inconclusive` where before it yielded `applied: true` and a `pass`; **(ii)** a record whose `id` is not a string, likewise against the real host; **(iii)** an endpoint answering `pluginBuild` without the marker, which must refuse the run; **(iv)** two endpoints answering the same `vaultId`, which must abort the run before case 1. Injections (i) and (ii) are the criterion this component is judged on: **falsifying them against a fake host that can already return `applied: false` demonstrates nothing, because that is exactly what WP73 already demonstrated and exactly why C75 exists.** Injections are targeted, never global (rule 2), and the report states whether neighbouring cases stayed green.
- Definition of Done: the two signals the gate's verdict rests on are true on the real host — `applied` reports whether the edit happened, and the driver knows that the instances answering it are instrumented, connected and two.
- Assigned to work package: **WP75**
- Fuzzer link: none. Control-surface truthfulness and driver preconditions are outside the doc-merge instrument C23 models.
- **Cross-repo, and this is the first component in the run whose own two halves land in two repositories.** Part A is `plugin/src/testing/e2e-control.ts` in this repo on `fix-bugs-and-raceconditions`; Part B is `tools/MCPserver/liveshare_e2e_mcp_server.py` in the **AgenticWorkspace** repo on `toms_branch`. WP73 set the precedent — separate commits, **both** hashes recorded in the implementation report, because §7's commit and abort accounting assumes one repository. For C75 that record is not a formality: a report carrying one hash has recorded half the work package.
- **⚠ Rule-10 file overlap, declared rather than discovered.** **WP51 (`planned`) names `plugin/src/testing/e2e-control.ts` as its sole required changed file**, and Part A edits the same file at a different function. Neither depends on the other. If they share a batch, the batch's shared-ownership contract must name who writes which block — the same discipline the WP69/WP70 `constants.py` overlap required.
- **⚠ Sweep finding S7, NEW, found while verifying (B) — recorded and escalated, not chartered.** The `edit` tool's docstring (driver `:261`) reads *"Inject a canvas edit on ONE instance through its **real capture path**."* **It does not.** `simulateEdit` writes directly into the shared `Y.Doc` via `upsertRecord`, which is the *remote-apply* side of the binding, not `captureLocal`. The matrix therefore measures **doc → relay → doc** convergence; it does not establish that a user gesture reaches the doc, nor that a remote delta reaches the canvas view or the file. `canvas.binding`'s four counters (`applyRemote`, `captureLocal`, `rePush`, `originUpdates`) are the only protocol datum that could show which binding path ran, and `run_matrix` **never calls `binding_stats` at all**. **D17 already records the doc-versus-file half of this limitation; the capture-path half is recorded nowhere, and the driver's own docstring asserts the opposite of it.** Two separable items: the **false claim** is a one-line honesty fix, deliberately not folded into AC3 because AC3's docstring clause is scoped to the `session.info` payload; the **substantive question** — whether the matrix should assert on binding counters — belongs to **WP50** (per-case oracle verdicts) or **WP52** (which makes the counters path-scoped; they are module-global today and their SSE events carry `path: ""`).
- **S2–S5 carried forward from C74's sweep, none repaired here, and one of them constrains what the gate's own report may claim.** **S2** — `_compare` drops id-less records while its TypeScript twin (`sameRecordSet`, `:192`) deliberately falls back to a positional key *"so an unidentifiable record can never silently match a different one"*; the two are divergent and one of them is the gate's oracle. **Owner: WP50** if taken, as an oracle redesign. **S3 — the settle asks instance a, then instance b, so "both quiescent" is NEVER simultaneous, and no artefact of C75, C74, C50 or C7 may claim otherwise.** The defensible claim is *"each instance reported quiescent when asked, in sequence"*; the artefact most likely to overclaim it is the gate's own run report, which is why this is recorded in the imperative. C75 AC4's identity comparison is explicitly **not** constrained by it — vault identity is static across two calls. **S4** — four mid-case settles discard their whole return tuple including `converged`; defensible as a barrier rather than an oracle, but unread by omission, so promoting it must be chartered. **Owner: none assigned.** **S5** — a driver exception renders `fail` rather than `inconclusive`; fail-closed, so not a false green. **Owner: WP50** if taken. **C75 AC2 interacts with S5 and does not resolve it:** it moves a named set of conditions off the exception path onto a truthful `applied: false`; what remains keeps its present classification.

---

### PHASE VI — Verification integrity (the blind-set gate itself)

<!-- Updated: new phase — the shared blind runner was found able to report a never-executed set as green, which puts every prior blind claim in question 2026-08-01 -->

<!-- Updated: concealment mechanism corrected — vitest 4.0.18 exits 1 on zero discovery, so the old runner failed loudly; the defect is reproducibility, not a silent green 2026-08-01 -->

> **Why this phase exists.** Blind sets are this project's primary defence against a coder sub-agent shaping tests to fit its implementation. Worker 3 established on 2026-08-01 that `workflowArtifacts/canvas-v2/_run_blind.py` stages blind files by copying their filenames verbatim; WP46's TypeScript blind files are named `test_*_blind1.ts`, which does **not** match vitest's default `**/*.{test,spec}.?(c|m)[jt]s?(x)` discovery glob, so those sets could not execute at all.
>
> **Correction (2026-08-01, WP55/WP57 re-verification).** The original text of this phase said vitest "prints *No test files found* and **exits 0**", and that the runner reported that as a pass. **That does not reproduce and is withdrawn.** Vitest 4.0.18 exits **1** on zero discovery and neither vitest config sets `passWithNoTests`, so the old runner propagated a **loud red**, not a silent green. The three staging defects below are real *as causes* — the affected sets genuinely could not execute — but the concealment mechanism was mis-stated. What actually happened is that batches produced their green counts through an **unrecorded** rename-and-retarget mechanism (by hand or throwaway script) that no committed tool could reproduce. **The debt is one of reproducibility, not of execution.** The executed-count gate in §7 and C55 AC1 remain in force unchanged; they are now **defence-in-depth** against a class of silent pass that this codebase happened not to have, rather than the fix for an open hole.
>
> **The standing lesson, restated in its corrected form:** a claim that no committed instrument can reproduce is unverifiable at the moment it is made, however true it later proves to be. All 52 ledger rows executed; none is VACUOUS.
>
> **This is not a one-line fix, for two reasons.** First, the runner has more than one way to no-op: beyond the filename glob, its staging depth is hardcoded while sets differ in what their own relative imports require, and its target package is hardcoded to `plugin/` while WP41's blind set imports `../../mux-protocol` and belongs to `server/`. Second, the defect is retroactive: **no blind-set pass claimed by any batch that used this runner could be reproduced by committed tooling**, including batches already closed. Repairing the runner without re-establishing which historical claims were real would leave the project's verification story resting on evidence nobody has checked.
>
> <!-- Updated: measured staging facts replace the estimated ones — depth is per-set and the Python sets must not be staged at all 2026-08-01 --> **Measured staging facts (authoritative — supersede the estimates above).** Anyone re-staging blind sets must use these, not the earlier guesses:
>
> - **WP1–WP16 and WP5 are depth 3** and were not disturbed. WP5 is the proof that depth cannot be guessed: it mixes `../../../canvas/…` with `../../harness/…`, and only depth 3 satisfies both.
> - **WP47 and WP49 TypeScript halves need depth 2.** The old runner never used depth 2; these two were broken by the depth defect alone.
> - **WP44 is depth 3 and was *not* depth-affected.** The WP55 charter listed it as affected — that is wrong. The charter also **omitted WP49 entirely**.
> - **Python sets must run in place and must never be staged.** 60 Python blind files pin `parents[5]/"tools"` to locate the rig package; moving them changes the parent count and silently breaks the import. Staging a Python set is a defect, not a fix.
> - **Undiscoverable-file count: 38, not 46.** WP41 16 + WP42 14 + WP46-TS 8 = 38. The per-set counts were right; only the sum was wrong.
>
> **What the evidence already shows.** The bug is not hypothetical: when Worker 3 ran WP46 blind_set1 through a throwaway runner that staged correctly, a real, deterministic failure appeared that every prior "green" had hidden — `test_probe_side_effect_free_blind1.ts > does not disturb an edit that follows it`, where `expect(bump).toHaveBeenCalledTimes(1)` receives **2** after a single `canvas.simulateEdit`. Reproduced across three runs. That is a genuine C46 acceptance-criterion violation (C58), not a harness artefact.
>
> **Standing rule established by this phase.** A recorded executed-test count is the evidence a blind set passed. An exit code is not. See §7.

#### C55 — Blind-set execution integrity

- Change type: modify (`workflowArtifacts/canvas-v2/_run_blind.py`)
- Responsibility: make it structurally impossible for the shared blind runner to report a set as passing that it did not execute.
- Interfaces:
  - Input: a WP number and a set selector, plus the set's files exactly as authored in `tests/blind_set{1,2}/WP<N>/`
  - Output: a per-set verdict carrying an executed-test count, or a named hard failure
- Acceptance Criteria:
  1. A run that collects **zero** test cases is a hard failure under a distinct named reason and can never be reported as a pass. Every reported PASS carries a recorded executed-test count greater than zero, and a zero or absent count is treated as a failure of the run rather than as an absence of problems. A process exit code of 0 is not by itself accepted as evidence that a set passed.
  2. Staging normalises each blind file's **name** to the target framework's discovery pattern, and the normalisation is name-only: content, assertions, imports, skips and test counts are byte-identical to the authored artefact. No assertion is edited, relaxed, skipped or removed to make a set run. A file the runner cannot make discoverable is named individually and fails the run rather than being silently excluded from it.
  3. Staging depth and target package are derived **per set** from that set's own relative import specifiers rather than hardcoded: a set importing `../../x` and a set importing `../../../x` both resolve, and a set whose imports resolve into `server/` is staged and run against the server package rather than the plugin. An import that fails to resolve is a hard, named failure — never a collection error reported as a pass and never a silent zero-collection.
  4. The Python blind path is covered by the same runner under the same zero-collection rule, so "no tests ran" cannot pass on either side. The existing guarantee that the staging directory is always removed — on success, on failure, and on interrupt — is preserved unchanged, because a leftover staging directory leaks blind tests to the next coder sub-agent and breaches context isolation.
  5. The runner emits, per set, a machine-readable record of `(WP, set, framework, files staged, tests collected, tests passed, tests failed, exit code, verdict)` suitable for direct transcription into the C56/C57 ledger without re-running or re-interpretation.
- Definition of Done: a never-executed blind set and a fully passing blind set are no longer indistinguishable from the runner's output.
- Assigned to work package: **WP55**

#### C56 — Blind re-verification: previously discoverable sets

- Change type: create (`workflowArtifacts/canvas-v2/BlindVerificationLedger.md`)
- Responsibility: establish, for the blind sets whose files were already framework-discoverable, whether the green claims made about them are real.
- Interfaces:
  - Input: the repaired C55 runner; the blind sets under `tests/blind_set{1,2}/`; the claims recorded in `Worker3Handover_B1_P0.md`, `Worker3Handover_B8_P6.md`, `Worker3Handover_B9a_T3infra.md` and the `ImplementationReport_WP*.md` files
  - Output: one ledger artefact with one row per `(WP, set)` re-run
- Acceptance Criteria:
  1. Every blind set whose files already carried a framework-discoverable name — the TypeScript sets for WP1–WP16 and WP49, and no others — is re-run under C55, and each produces one ledger row carrying: the previously-claimed result with the artefact and line that claimed it, the number of tests actually collected, the numbers passed and failed, and a verdict.
  2. The verdict vocabulary is exactly **CONFIRMED** (the set executed a non-zero count and the result matches the prior claim), **VACUOUS** (the prior claim rests on a run that executed zero tests), **DIVERGENT** (the set executed but the result contradicts the prior claim) or **UNRUNNABLE** (the set cannot be executed even under the repaired runner, with the obstruction named). No other verdict is admissible, and no row may be left blank.
  3. Every WP whose blind claim is found VACUOUS or DIVERGENT is named explicitly in the ledger and in the implementation report, together with the handover artefact whose claim it invalidates. The ledger states plainly, in its own text, that a VACUOUS or DIVERGENT verdict invalidates the corresponding claim in an already-closed handover.
  4. The ledger states its own coverage boundary: which `(WP, set)` pairs this work package re-ran, which are deferred to C57, and which have no blind set at all — so a reader can distinguish a set that passed from a set nobody looked at. Absence of a row is never readable as a pass.
  5. No blind test file is edited, renamed in place, deleted or weakened by this work package. Re-verification observes; it does not repair. A blind test found to be itself defective is recorded as a finding and left unmodified.
- Definition of Done: for every previously-discoverable blind set, the project can say whether its green was real.
- Assigned to work package: **WP56**

#### C57 — Blind re-verification: non-discoverable and cross-package sets

- Change type: modify (`workflowArtifacts/canvas-v2/BlindVerificationLedger.md` — append)
- Responsibility: establish the truth for the blind sets that the broken runner provably could not have executed, which is where vacuous claims are expected to concentrate.
- Interfaces:
  - Input: the repaired C55 runner and the C56 ledger
  - Output: the same ledger, extended to complete coverage of every blind set in the project
- Acceptance Criteria:
  1. Every blind set not covered by C56 is re-run under C55 and recorded to the C56 row schema and verdict vocabulary. The scope is: the TypeScript sets whose filenames match no discovery pattern (**WP41**, **WP42**, and the TypeScript half of **WP46**), the TypeScript files inside the otherwise-Python sets (**WP44**, **WP47**), and the Python sets (**WP43**–**WP48**).
  2. For **WP41** and **WP42** the ledger resolves an explicit contradiction rather than merely restating it: `Worker3Handover_B8_P6.md` claims 44 and 73 executed tests for sets whose files, as stored, no framework glob can discover. The ledger records whether those counts are reproducible under C55 and, if they are not, states that the claimed counts cannot be attributed to the stored artefacts.
  3. For the Python sets the ledger records the executed counts and confirms or corrects `Worker3Handover_B9a_T3infra.md` §4.1's claim of 647 blind tests with 2 failures, including whether the two known failures are the same two.
  4. On completion the ledger covers **every** blind set present in `tests/blind_set{1,2}/` with no gaps, and it says so with a count that a reader can check against the directory listing.
  5. No blind test file is edited, renamed in place, deleted or weakened by this work package, and the known-defective `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` remains unmodified and is recorded as a finding rather than repaired.
- Definition of Done: the ledger is complete, and every blind claim in the project is either confirmed or named as unverified.
- Assigned to work package: **WP57**
- <!-- Updated: AC2's premise falsified — the WP41/WP42 counts reproduce exactly; recorded as CONFIRMED 2026-08-01 --> **Outcome of AC2 (recorded, ACs unchanged).** The contradiction AC2 was written to resolve is **resolved in favour of B8/P6**. All four claimed quantities reproduce exactly under the repaired runner: WP41 24+20 = **44** across **16** files, WP42 28+45 = **73** across **14** files. Worker 2's earlier ruling that "both statements cannot both be true" was a sound inference on the evidence then available and is now **falsified**; `Worker3Handover_B8_P6.md:54` and `:87` are **CONFIRMED**, not vacuous. The residual finding is a **process** one, not a correctness one: B8/P6 staged via a rename-and-retarget mechanism it never recorded, so a true claim was nevertheless unverifiable when made. This is the reproducibility debt, and it is what the §7 executed-count gate now prevents recurring.

#### C58 — Readiness probe side-effect freedom

- Change type: modify (`plugin/src/testing/e2e-control.ts` and/or `tools/obsidian_e2e/readiness.py`, whichever owns the observed side effect)
- Responsibility: make the readiness handshake genuinely free of side effects on the edit path, which C46 AC2 and AC4 already require and which the blind set shows is not the case.
- Interfaces:
  - Input: a readiness probe issued against a live control endpoint, followed by an ordinary canvas edit
  - Output: the same readiness verdict, with the subsequent edit accounted exactly once
- Acceptance Criteria:
  1. Issuing the readiness probe does not cause, duplicate, suppress, delay or reorder any subsequent capture: after a probe followed by a single canvas edit, the capture counter advances by exactly one. The currently observed behaviour is an advance of two, deterministically across repeated runs.
  2. The C46 property "any of the three failing aborts the run under a distinct named reason and **no edit is issued**" holds observably and not merely structurally: the probe's effect on the edit path is asserted by test, not inferred from the absence of an outbound edit request.
  3. The C46 property "the same check is re-runnable mid-run and is reused by teardown to confirm the endpoints are gone" holds without accumulating side effects: N consecutive probes followed by one edit still advance the capture counter by exactly one, for N greater than one.
  4. The fix is verified under the repaired C55 runner with a recorded non-zero executed count for both WP46 blind sets, and the failing blind test `test_probe_side_effect_free_blind1.ts > does not disturb an edit that follows it` is fixed by changing the implementation, not the test. No blind or visible assertion is edited, and the WP46 test count does not change.
  5. C46's existing acceptance criteria and its §7 amendment-ledger entry are not reopened, reworded or re-litigated; WP46 remains `DONE` and this work package carries the defect forward under its own charter.
- Definition of Done: the readiness probe can be issued as often as the rig needs without perturbing what the rig is trying to measure.
- Assigned to work package: **WP58**
- <!-- Updated: WP58 outcome — the symptom was real but the attributed cause was not the probe 2026-08-01 --> **Outcome (recorded, ACs unchanged).** The double bump was real and deterministic, but it was **not caused by the probe**. `sessionInfo()` is inert and C46 AC2's structural argument is correct. The duplicate came from a trailing `markActivity()` in `simulateEdit`: WP49 moved the activity seam onto the doc (`observeDoc` registered before the transaction), so `doc.transact` already marks activity — and the pre-WP49 explicit call counted it a second time. It fired twice on **every** `simulateEdit`, probe or no probe. Fixed by deleting the redundant call; **WP49 AC1 is preserved exactly** (the seam still never inspects origin) and no assertion was touched. Do not carry forward the belief that the readiness probe mutates the edit path — it does not.

<!-- Updated: PHASE VI extended — the four DIVERGENT rows adjudicated and WP17's uncovered set chartered 2026-08-01 -->

> **Adjudication of the four DIVERGENT ledger rows (Worker 2, 2026-08-01).** All four rule as **stale expectations or defective tests, not product defects** — but the ruling was made per-row against quoted code, not by defaulting to the cheaper answer, and three qualifications ride with it:
>
> 1. **WP3 set2 is provisional on B2.** The evidence was gathered against a tree B2 is still editing (`canvas-sync.ts`, +643/−65 uncommitted). C59 requires re-measurement after B2 closes and escalation if the failure changes shape.
> 2. **The WP49 timing cluster is a stale test over a *real* behavioural change.** A zero-budget `waitQuiescent(0)` probe now costs one 20 ms poll instead of returning synchronously. The test is wrong; the behaviour change is real, is chartered by WP49 AC1, and is recorded rather than waved past.
> 3. **Two failures are neither stale nor defective-implementation — they are tests that could never have passed.** They are only visible now because these sets had never executed. §7 gains a third amendment class for them.

#### C59 — WP3 round-trip blind amendment

<!-- Updated: licence extended to the two `edges.bare` pins in both sets; AC3's claim that `edges.bare` "passes" was false — it was unreachable, and its stated reason described the pre-AC5 defect as a guarantee 2026-08-02 -->

- Change type: modify (`workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts`, `workflowArtifacts/canvas-v2/tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts`)
- Responsibility: make WP3's value-preservation blind set pin WP16's V2 reader shape through the decode bridge, without weakening what it asserts.
- Interfaces: input is the WP16 reader (`parseCanvas` → `toV2Node`/`toV2Edge`) and its exact inverse `decodeCanvasDataToFlat`; output is two amended assertions plus a ledger row
- Acceptance Criteria:
  1. The two named assertions are amended to assert the round trip **through the decode bridge** (`decodeCanvasDataToFlat`, and `decodeEndpointToFile` where an endpoint is involved), so the property under test is unchanged: a node's and an edge's full key set survives `serialise → parseCanvas → decode` with nothing added and nothing lost. The subject — value preservation — is preserved exactly; only the shape the assertion reads is corrected.
  2. Strictness does not fall. Each amended assertion remains a whole-collection exact `toEqual` over the complete sorted key list — no `toMatchObject`, no `objectContaining`, no subset, no key-count check, no `skip`/`only`, no destructuring away of the register keys. The amended form is **stricter**: it additionally pins the invertibility of the V2 register bridge, which nothing pinned previously.
  3. The test count in the file does not change, and the remaining tests still pass unmodified. <!-- Updated: the original AC3 asserted `edges.bare` "passes because `encodeEndpointFromFile` refuses to build a half endpoint". Both halves were false — it was UNREACHABLE (masked by the `:76` failure in the same test body), and the refusal it credited as a data-preservation guarantee is the pre-AC5 over-constraint WP10 AC5 exists to remove. Superseded by AC5/AC6 2026-08-02 -->
  4. Both amendments are entered in the §7 amendment ledger with file, line and reason, and `WP3 set2` is re-run under C55 with a recorded non-zero collected count.
  5. **The `edges.bare` pin in each set is amended the same way** (set2 `:103`, set1 `:79`), reading the round trip through `decodeCanvasDataToFlat` / `decodeEndpointToFile`. The subject of each — *a bare, side-less edge round-trips with its endpoints intact and gains no key* — is unchanged and is now actually **reachable**.
  6. **Strictness rises on the property AC5 is actually about:** each amended site pins with an exact whole-object `toEqual` that a side-less endpoint decodes to its `*Node` key and **no** `*Side`/`*End` key — never `null`, never `""`. Test counts unchanged in both files, and both WP3 ledger rows are re-measured.
- Definition of Done: both WP3 sets are green because the round trip genuinely preserves every value, not because an assertion was loosened.
- Assigned to work package: **WP59**
- **Sequencing constraint:** must not start until batch **B2** is closed; the ruling is provisional on B2's final state and must be re-measured first.
- **Ruling on the escalation (Worker 2, 2026-08-02) — stale expectation, NOT a defect in WP10 AC5, and this was measured rather than argued.** The stakes were explicit: AC5 is the fix for the silent `.canvas` data-loss class, so a defect in its presence semantics would be the worst regression this project has found. Four independent checks, all confirming:
  1. `decodeEndpointToFile` (`canvas-registers.ts:615-626`) **always** emits `fromNode`/`toNode` and emits `fromSide`/`fromEnd` only when the register carries them — exactly the JSON Canvas contract, where `*Node` is mandatory and `*Side` optional.
  2. `decodeCanvasDataToFlat`'s two passes (`canvas-sync.ts:413-439`) reconstruct a bare edge as exactly `{fromNode, toNode, id}` — three keys, none invented, none lost.
  3. **The old green was produced by the bug.** `toV2Edge` (`:263-299`) folds the flat keys **only when the register was built**, and keeps them verbatim otherwise. Pre-AC5, a side-less endpoint failed to build, so the flat keys survived and `parsed.edges[…].fromNode` was readable. AC5 makes the register build, so the fold now happens — correctly. The assertion passed *because* a fully-connected edge was being read as not-an-endpoint.
  4. **Measured at the level of file bytes:** `plugin/src/__tests__/v2/wp17/test_tp13_sideless_edge_file_byte_identical_round_trip_visible.test.ts` is green 5/5 (run 2026-08-02) and pins that a `.canvas` file with side-less edges survives `parse → doc → serialize` byte-identically through both doc vocabularies, emits no `null`/`""` for an omitted optional key, and yields `{id, fromNode, toNode}` from `buildCanvasData`.
  Ruling the other way would have required reverting AC5, which would restore the behaviour where a side-less edge reads as dangling, is refused at ingest, and is written out of the user's file.

#### C60 — WP44 import-surface pin amendment

- Change type: modify (`workflowArtifacts/canvas-v2/tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts`)
- Responsibility: align the node-builtin import pin with the sanctioned import surface of `e2e-control.ts`, so it still catches a genuinely new dependency and stops failing on one the spec mandates.
- Interfaces: input is the text of `plugin/src/testing/e2e-control.ts`; output is one amended assertion plus a ledger row
- Acceptance Criteria:
  1. The assertion is amended to pin the node-builtin import set to exactly `{node:crypto, node:http}`, and the test title and file preamble are corrected to match, so the file no longer asserts one thing in prose and another in code.
  2. Strictness does not fall: the assertion remains a whole-set exact `toEqual`. No subset match, no `arrayContaining`, no "at least" check, no filtering `node:crypto` out before comparing, no `skip`/`only`. A future import of `node:net` or `node:child_process` must still fail it.
  3. The test count does not change and the four currently-passing tests still pass unmodified, including the behavioural no-server check and the bare-specifier pin — which are what WP44 AC4 actually protects.
  4. The amendment is entered in the §7 amendment ledger, and `WP44 set2` (TS) is re-run under C55 with a recorded non-zero collected count.
- Definition of Done: the pin discriminates a real new dependency from a Node built-in the shared contract requires.
- Assigned to work package: **WP60**
- **Rationale note:** `node:crypto` has one use site — the `canvas.file` sha256 that `T3_SharedContract.md` §6.1 mandates — and adds no port, socket or listener. WP44 AC4's subject is `resolvePort` and server/port behaviour, and its dependency language is about **runtime packages**. The visible counterpart's allow-list already skips every `node:` specifier. The one way this could be a real violation is bundle growth, which C46 AC1 forecloses and `W4-1` measures; if `W4-1` ever returns a non-zero match count, this amendment is revisited.

#### C61 — WP49 quiescence blind amendments

- Change type: modify (five files under `workflowArtifacts/canvas-v2/tests/blind_set{1,2}/WP49/`; one statement in `T3_SharedContract.md` §6)
- Responsibility: resolve the five failing tests across WP49's two TypeScript blind sets, and state the `timeoutMs = 0` semantics that two artefacts currently read incompatibly.
- Interfaces: input is `waitQuiescent` (`e2e-control.ts:997-1018`), the router (`:394-398`) and `sessionInfo()` (`:832-850`); output is five amended tests, one contract statement and two ledger rows
- Acceptance Criteria:
  1. **Class A** (`test_tp4_…_blind1`, `test_tp1_…_blind2`) — each test's fake-timer advance is increased to cross at least one full poll interval so the awaited promise can settle. Every `toEqual` verdict assertion is kept **verbatim**, because those verdicts are what the tests exist to pin and the implementation already produces them. The named subject — that `timeoutMs: 0` does not collapse to the 2000 default — is preserved and still fails if it ever does.
  2. **Class B** (`test_tp3_…_blind2`) — the four-key exact-shape `toEqual` on `session.info` is amended to the full nine-key payload in the form WP46 AC5 mandates: whole-object `toEqual` over all nine keys with this fixture's honest-degradation values. No `toMatchObject`, no subset, no `objectContaining`, no key-count check, no destructuring away of the five added fields.
  3. **Class C** (`test_tp2_…_blind2`, `test_tp10_…_blind2`) — each is repaired under §7's third amendment class, named by file, line and the reason it could not pass. `test_tp10`'s assertion becomes a direct exact assertion on the value, **stricter** than the substring check it replaces; `test_tp2`'s fixture is retimed so the edit lands strictly inside the pending wait, with its `{quiescent: false}` assertion kept verbatim. Neither repair changes what the test is about.
  4. The `timeoutMs = 0` semantics are stated once in `T3_SharedContract.md` §6 as the single authority: `0` means "expire at the earliest opportunity — answer after the first poll, never from pre-call history", it is forwarded rather than defaulted, and the answer costs one poll interval.
  5. Strictness does not fall anywhere and the test count does not change across both sets; all 30 currently-passing tests still pass unmodified; each of the five changes carries its own §7 ledger entry.
  6. Both WP49 TypeScript sets are re-run under C55 with recorded non-zero collected counts, and the findings table's "2-key" description of the `session.info` pin is corrected to "4-key".
- Definition of Done: WP49's blind sets are green because the quiescence oracle behaves as chartered, not because the tests stopped asking.
- Assigned to work package: **WP61**
- **Hard constraints:** WP49 AC1 is untouchable — the activity seam must never inspect origin. `waitQuiescent` must not be made to evaluate before its first sleep; that restores exactly the pre-call-history defect WP49 exists to remove. The tests move to the implementation's clock, never the reverse.

#### C62 — WP17 blind-set coverage

- Change type: modify (`workflowArtifacts/canvas-v2/BlindVerificationLedger.md` — append)
- Responsibility: close the one coverage gap the C56/C57 sweep declared, so that no `(WP, set)` pair that exists on disk is without a verdict.
- Interfaces:
  - Input: the repaired C55 runner; `tests/blind_set{1,2}/WP17/` (12 TypeScript files each); WP17's prior claim if one exists
  - Output: the same ledger, extended by two rows, with its coverage-boundary section corrected
- Acceptance Criteria:
  1. `tests/blind_set1/WP17/` and `tests/blind_set2/WP17/` are each run under the repaired C55 runner, and each produces one ledger row in the C56 schema carrying: the previously-claimed result with the artefact and line that claimed it (or an explicit "no prior claim" marker), the number of tests actually collected, the numbers passed and failed, and a verdict from the C56 vocabulary. A row with a zero or absent collected count is a failure of the run, not a pass.
  2. The ledger's coverage-boundary section is corrected so that the folder count it states matches the directory listing a reader takes at that moment, and the "One set is deliberately NOT covered: WP17" carve-out is replaced by the rows themselves. On completion the ledger covers **every** blind set present in `tests/blind_set{1,2}/` with no gaps, and says so with a count the reader can check.
  3. No blind test file is edited, renamed in place, deleted or weakened. A blind test found to be itself defective is recorded as a finding and left unmodified, naming the file and the failing assertion.
  4. If either set is DIVERGENT, the finding is recorded in the ledger's findings table with the failing test named, and is handed back for its own charter rather than repaired here. The verdict is reported as measured even when it invalidates a claim in a closed B2 handover.
- Definition of Done: every `(WP, set)` pair that exists on disk carries a verdict, and the ledger's own coverage claim is checkable against the filesystem.
- Assigned to work package: **WP62**
- **Sequencing constraint:** must not start until batch **B2** is closed — WP17 lives in `plugin/src/canvas/**`, where B2 is live. Measuring a set whose implementation is mid-edit produces noise, not evidence.

<!-- Updated: C65 added by the B13 escalation ruling — a CONFIRMED ledger row silently expired, and the record it rests on cannot say when or against what it was measured 2026-08-02 -->

#### C65 — Ledger row provenance and the named-intermittent register

- Change type: modify (`workflowArtifacts/canvas-v2/_run_blind.py`, `workflowArtifacts/canvas-v2/_gen_ledger.py`, `workflowArtifacts/canvas-v2/BlindVerificationLedger.md`)
- Responsibility: make every blind measurement carry the tree state it was taken against, so a ledger row can be recognised as expired instead of being read as a standing fact — and give the one observed intermittent a name, an owner and a falsification threshold.
- **Why now.** WP3 set1 was CONFIRMED 56/56/0 by WP56 and re-measured 56/55/1 by B13 with the set untouched: WP10 AC5 landed in between and retired the shape the row pinned. WP56's measurement was correct when taken. The row could not say so, because `_blind_records/*.json` records `(wp, set, framework, files_staged, tests_collected, tests_passed, tests_failed, exit_code, verdict, reason, package, depth, detail)` and **nothing about when or against what**. File mtime is the only signal and every re-run overwrites it. This is a gap in the artefact that certifies the project's verification, not a bookkeeping nicety.
- Interfaces:
  - Input: the C55 runner and the `_gen_ledger.py` transcription script; `git rev-parse HEAD` and `git status --porcelain` for the tree state
  - Output: an extended blind-record schema, a ledger with a provenance column, and the intermittent register in §7 reflected in the ledger
- Acceptance Criteria:
  1. **Every blind record is self-dating.** `_run_blind.py` writes at minimum `measured_at` (ISO-8601 UTC) and `tree_rev` (the `git rev-parse HEAD` short sha, plus an explicit dirty marker when `git status --porcelain` is non-empty) into each `_blind_records/*.json`. Existing fields keep their names and meanings — this is additive, and no consumer of the current schema may break.
  2. **Every ledger row shows its provenance,** transcribed by `_gen_ledger.py` from those fields exactly as the counts already are — never retyped by hand. A row whose record predates the schema carries an explicit `provenance: unknown (pre-C65)` marker rather than a blank or a guessed value; a blank would be indistinguishable from a fresh measurement, which is the failure mode this WP exists to remove.
  3. **The ledger states its own semantics.** `BlindVerificationLedger.md` says in its verdict section that a CONFIRMED row is evidence for the tree it was measured against and is never readable as a current pass, with WP3 set1 named as the worked example — including the part that makes it instructive: the row was green *because of* the defect WP10 AC5 later fixed.
  4. **The named-intermittent register is live.** §7's register (currently one row: `wp5/latency.test.ts`'s 50–150 ms RTT band, owner WP65) is reflected in the ledger so a batch meeting an intermittent finds it already named. The acceptance threshold is recorded with it and is falsifiable: more than one failure in ten consecutive full-suite runs, or any failure co-occurring with another `wp5` assertion, voids the acceptance and escalates it as a real defect.
- Definition of Done: a reader of any ledger row can tell what tree it was measured against without archaeology, and the one known intermittent has an owner and a threshold rather than a footnote.
- Assigned to work package: **WP65**
- **Explicitly out of scope:** re-measuring the existing 58 rows. Backfilling provenance for rows measured before this schema existed is not possible and must not be faked; those rows carry the `unknown (pre-C65)` marker and are re-measured only when a batch has its own reason to. No blind test file and no production file is touched.

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
<!-- Updated: amendment ledger added as a second licensed class (WP46) — an exact-shape assertion restated because a chartered AC changed the shape it pins, with strictness and test-count held constant 2026-08-01 -->

- **Lint / typecheck / test commands** (from `plugin/`, per RepoMap `## Build & Test Commands`):
  1. `npm run build` — `tsc -noEmit -skipLibCheck` + esbuild production bundle. Must PASS.
  2. `npm test` — `vitest run`. Must be 0 failed.
  3. `npm run lint` — `biome check .`. Advisory locally, **gating in CI**.
  - From `server/` (WP41 only): `npm run build` (`tsc`) then `npm test` (`vitest run`).
  - Headless mock-host rig (fast, no vault, **not the gate**): `python tools/launch_liveshare_e2e.py` from the repo root.
  - <!-- Updated: T3 2026-08-01 --> <!-- Updated: corrected — the rig has no launch backend, so this line's implication that one await_console yields the gate verdict is false; the run is agent-mediated per C71 2026-08-04 --> Live real-Obsidian rig (WP7, WP40, WP54 — **this is the gate**): the T3 entrypoint `tools/launch_obsidian_e2e.py`, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap makes any other invocation unreliable on this host), then `await_console`. Never a Bash background process. **⚠ That invocation runs the rig; it does not run the gate.** `lifecycle.py`'s only console backend is `PlanOnlyConsole` and there is no process spawn anywhere under `tools/obsidian_e2e/` (measured 2026-08-04), so the entrypoint **plans** and never starts Obsidian. A gate run is **agent-mediated** (C71): the agent executes each planned `visible-console` payload and feeds the outcome back, and the verdict is rendered by the rig from those outcomes. Until C71/WP71 lands, no `await_console` on this entrypoint may be read — in a report, a handover or a ledger row — as a gate result.
  - <!-- Updated: the build the gate needs is the only build that never exits — measured 2026-08-02 --> **⚠ Build modes — `npm run dev` does not terminate.** `plugin/esbuild.config.mjs` branches on `process.argv[2] === "production"`: production rebuilds once and `process.exit(0)`s; **every other invocation calls `ctx.watch()` and never returns**, and `__LS_E2E__` is `"false"` only in production. An `await_console` on `npm run dev` therefore blocks to timeout and reads as a slow build. The one-shot E2E build is **C69/WP69** work and does not exist yet; until it lands, no batch may attempt to produce an E2E-capable bundle by running `npm run dev`. After it lands, the E2E bundle is built by that one added script and nothing else, and `npm run build` remains the production command with byte-identical output (C69 AC2).
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
  | WP18 | ``T1 DISCRIMINATION `fromNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it``, ``T2 DISCRIMINATION `toNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` (the file's only two tests; whole file removed) | `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` | Pure discrimination pairs that require the **disarmed** run to LOSE the endpoint. C18 AC3 abolishes absent-key deletion at the seed, so both runs agree and the pair proves nothing — unsatisfiable exactly as WP4's `A9`/`A10` became, and for the same reason. Verified before deletion: no blind counterpart exists (WP4's blind sets stop at `tp07`) and there is no artefact source-of-truth copy. | `PROTECTED_KEYS` membership stays pinned by WP18 TC12, `w4-canvas-integrity` A8 and WP3 `blind_set1/test_geometry_keys_drift`. **Replacement coverage for the boundary itself is now positive, not absent:** C10 AC5's side-less round-trip pin, C14's direct side-less-edge validator pin, C17 AC5's byte-identical side-less file round-trip, and **C63 AC4's discrimination test** — which pins the seed boundary's *non-destructiveness*, a strictly more valuable property at that boundary than the retired guard ever pinned. |
  | WP21 | (enumerated at implementation time) | — | C21 AC4 | — |
  | WP22 | (enumerated at implementation time) | — | C22 | — |
  | WP33 | (enumerated at implementation time) | — | C33 | — |

  <!-- Updated: WP18 ratified onto the licensed-deletion list; its own charter ordered the retirement by name but the list was never updated 2026-08-02 -->
  **Ratification (2026-08-02).** The licensed-deletion list is now **WP4, WP18, WP21, WP22, WP33**. WP18's deletion is **ratified as performed** — the WP18 charter §4 amendment note ordered exactly this retirement by name, the implementation report enumerated both tests verbatim, and §7's operative licensing condition (enumeration by name) was satisfied; only the *list* lagged. The file stays deleted. **WP18's licence covers exactly those two tests in that one file and nothing else** — it is not a general licence to delete, and any further WP18 deletion is an abort criterion as before.

  **Checked before ratifying, because the irony is real:** those tests pinned `PROTECTED_KEYS` discrimination *on the seed path*, which is the very boundary the E1/E2 rulings are about. They do **not** pin any E1 or E2 property — they pin that a delete guard is live, and after AC3 there is no delete at the seed for a guard to shield. The E1/E2 properties had **no** coverage anywhere before this ruling; the replacement column above creates it. Retiring the pair therefore removes nothing that would catch an E1/E2 regression, and the four new pins are what will.

  **Expected arithmetic for the P0 close:** the plugin baseline of 674 becomes **671** after WP4's three deletions; the P0 batch's own additions and the concurrent WP41/WP42 additions sit on top, and the gate remains **0 failed**. A P0 handover reporting three failures in `w4-canvas-integrity.test.ts` is now a stale run, not a passing state.

- **Amendment ledger — new class, 2026-08-01 (WP46).** <!-- Updated: WP46 widened session.info from 4 to 9 keys per its own AC1, making two exact-shape toEqual assertions unsatisfiable; licensed as amendments, not deletions 2026-08-01 --> The ledger above governs tests that *disappear*. A second, narrower class is now recognised: a test that survives but whose **exact-shape assertion is restated** because a WP's chartered AC changed the shape it pins. The licensing rule is the same — the WP names each amended assertion by file, line and reason in its implementation report — with two additional conditions that do **not** apply to deletions:

  1. **Strictness may not fall.** The amended assertion stays an exact whole-object `toEqual` over the full new shape. Relaxing to `toMatchObject`, a subset match, a key-count check, `expect.objectContaining`, `skip`/`only`, or destructuring the added fields away is a **weakening** and is an abort criterion, not an amendment. An amendment that no longer fails when the payload drifts is worse than the failure it replaced.
  2. **The test count does not change.** An amendment that moves the count is a deletion or an addition wearing the wrong label.

  <!-- Updated: licensed-amendment list extended to the four DIVERGENT-row WPs 2026-08-01 --> <!-- Updated: WP18 added by the E3 ruling — one instrument over-specifies its subject 2026-08-02 --> <!-- Updated: WP10 and WP14 added by the E1/E1-b rulings — both WPs are REOPENED and their new ACs retire the shapes several assertions pinned 2026-08-02 --> <!-- Updated: WP19 added by the B3c escalation ruling — AC1 turns deletion from an ABSENCE into a VALUE, retiring the V1 key-removal oracle 2026-08-02 --> <!-- Updated: WP64 added by its own charter — the residual tombstone-blind instrument class WP19's licence deliberately excluded 2026-08-02 --> <!-- Updated: WP27 added by the B4 escalation-1 ruling — AC4 closes exactly the two bare-path `getDoc` holes that M1 and K5 were written to characterise as open 2026-08-02 --> The licensed-amendment list is **WP10, WP14, WP18, WP19, WP27, WP46, WP59, WP60, WP61, WP64** (and **WP62** only if its run surfaces the same class). An unenumerated assertion rewrite is an abort criterion exactly as an unenumerated deletion is.

  **WP10 / WP14 entry (2026-08-02, E1 + E1-b rulings).** Worker 2 **reopened** both WPs: WP10 gains AC5 (a side-less endpoint is a first-class, representable endpoint; `node` alone decides register presence) and WP14's AC1/AC2 are re-read (`side` is not a conjunct of edge validity; `"text": ""` is a legal empty card). The amended assertions below pinned the **retired** reading — they are stale, not violated, and each of their own subjects (atomicity, the missing-vs-ill-typed distinction) is untouched and still enforced. This is the same shape as the WP46 rows: a chartered AC deliberately replaced the shape the assertion pinned. **Both amendment conditions hold on every row: strictness does not fall, and the test count does not change** — the new coverage that the rulings require (WP10 AC5, WP14's direct side-less pin, WP17 AC5, WP63 AC4) lands as **additional** tests, enumerated separately in the batch handover, never by repurposing an existing one.

  <!-- Updated: WP27 entry added by the B4 escalation-1 ruling; the measured rows are entered from B4's post-amendment implementation report, not from this entry 2026-08-02 -->

  **WP27 entry (2026-08-02, B4 escalation-1 ruling).** **Licence GRANTED to WP27 as an amendment**, covering exactly two assertions in one file — `plugin/src/__tests__/w4-canvas-integrity.test.ts` `M1` (`:1597`) and `K5` (`:1666`), both `expect(reached).toBe(true)`, where `reached` means *"`getDoc` was called with the `.canvas` path"* — **and nothing else**. Both were green at B4's baseline (46/46) and are red under WP27.

  **Why stale rather than violated.** Both are **inverse characterisations of the defect WP27 AC4 exists to close**, and their own messages read as findings rather than as specifications: *"setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete"* and *"CollabManager has NO internal `.canvas` guard … currently unreachable ONLY because main.ts gates on `getActiveViewOfType`"*. They were written by W4's revalidation to say *this hole is still open and nothing covers it*. **The direction check was done adversarially, because that is the only thing separating this from a real defect:** a genuine violation here would be an assertion still true under AC4 — a path that *should* reach `getDoc` no longer doing so. These assert the opposite, that an **unguarded** path *is* reached, which is precisely what AC4 forbids. Both are therefore the stale kind, and inverting them turns them into a second, independent pin on AC4 from a file WP27 does not own — strictly more valuable than deleting them.

  **Conditions imposed with the licence, all binding:**

  1. **Strictness may not fall — and a bare inversion is not sufficient.** Each site is re-pointed to `toBe(false)` **plus** an assertion that the `skipsAutoTextSync` predicate was consulted and returned the skip verdict. A bare `toBe(false)` would also pass if `getDoc` were simply never called for an unrelated reason, which would make the amended assertion unable to fail for the right reason — the exact class hard-won rule 1 names.
  2. **The test count does not change**: 46 before, 46 after.
  3. **Titles and messages are updated** so that neither continues to assert the hole is open. An amended assertion whose message still describes the defect is a trap for the next reader.
  4. **Both sites are enumerated in B4's implementation report** by file · line · why-stale · post-amendment strictness, and **each is falsified individually**, with the masking check B13/B15 established — confirm the row goes red on **its own** named assertion and record whether neighbouring pre-existing oracles stayed green.
  5. The licence covers **these two assertions in this one file**. It is not a general licence to amend, and any further WP27 rewrite of a **pre-existing / inherited** assertion is an abort criterion exactly as an unenumerated deletion is. <!-- Updated: condition 5 QUALIFIED by the D-1 ruling — as originally written ("any further WP27 assertion rewrite") it was over-broad: it would make a batch's revision of a test the same batch authored an abort. Every §7 licence class governs *inherited* tests — removing or rewriting an assertion the batch did not write. A batch revising a test it authored during the same batch is authoring, not amending. Narrowed to pre-existing/inherited, which is what it was always meant to govern. Same precedent B4 already recorded for the WP26 type-annotation edit. The original wording is preserved in this note. 2026-08-04 -->
     - **Inline qualification, stated so it cannot be mis-read as a loosening:** "pre-existing" carries hard-won rule 4's meaning — *pre-existing to the batch baseline*, not to the batch's own diff. A test that did not exist at the batch baseline is the batch's own work; a test that did is inherited and is fully inside condition 5. The abort criterion is **unchanged in strength** for every inherited assertion; it simply no longer reaches work the batch authored. Batch-authored rewrites are still **logged** (see the D-1 note below) — an unlogged test-file edit is indistinguishable from a hidden one.

  **Row status — deliberately not written yet.** At the time this entry was made, B4's `ImplementationReport_WP27.md` records the escalation and states that both assertions were **left exactly as they are** pending the licence, so no post-amendment strictness, falsification result or executed count exists to record. Writing the measured row now would be speculation about work not yet done. The row is entered from B4's **post-amendment** report, by a single owner, in the same two-step this register already used for WP10/WP14 (entry at the ruling, rows entered by the batch afterwards) — and by **one** owner only: a batch and a Worker 2 both applying the same register change earlier in this run cost a reconciliation.

  <!-- Updated: WP27's measured rows entered from ImplementationReport_WP27.md §"Licensed amendments" + Worker3Handover_B4_P2.md §A after P2 closed; the paragraph above is kept verbatim and discharged rather than rewritten, per "a ledger row is a measurement" 2026-08-04 -->

  **Rows entered (2026-08-04) — the paragraph above is DISCHARGED, not rewritten.** The rows below are taken from what B4 **did** (`ImplementationReport_WP27.md` §"Licensed amendments", corroborated by `Worker3Handover_B4_P2.md` §A), not from the grant language above, and each condition is evidenced rather than restated:

  | Condition | Evidence |
  |---|---|
  | 1 — strictness may not fall; a bare inversion is **not** sufficient | Each site is `toBe(false)` **plus** `expect(guardConsults.filter(c => c.path === PATH).map(c => c.verdict)).toEqual([true])` — a whole-collection exact `toEqual` pinning that `skipsAutoTextSync` was **consulted for that exact path** and returned the skip verdict. `F1b`/`F2b` are what prove this is load-bearing rather than decorative: with the shared predicate replaced by a private `endsWith(".canvas")` copy the guard still works and `reached` is still `false`, yet each site reddens **on the new assertion** (`expected [] to deeply equal [ true ]`) — a class a bare `toBe(false)` cannot see at all. No `toMatchObject`, `objectContaining`, subset match, key-count check, `skip`/`only` or destructuring at either site; re-verified against the current tree. |
  | 2 — the test count does not change | **46 before, 46 after** (the file went 44 green / 2 red → 46 green). The whole-plugin collected total was unchanged at **1524**, which independently rules out an addition or a deletion anywhere in the tree. Re-counted in the current tree: 46 `it(` in the file. |
  | 3 — titles and messages rewritten | Both titles inverted (`"…acquires a bare-path doc…"` → `"…GUARDS the bare-path getDoc…"`; `"CollabManager has no internal .canvas guard"` → `"CollabManager HAS an internal .canvas guard — protection no longer relies on main.ts's MarkdownView gate"`), and both assertion messages rewritten to describe the **R5 damage a missing guard would cause** instead of reporting the guard's absence as a finding. The `W4 REVALIDATION M` header block and a new comment above `K5` record in place that the original finding was correct **when written** and that AC4 closed it, so the surviving narrative cannot be mistaken for a live finding. |
  | 4 — each site falsified individually, with the masking check | Four runs, one per site per class. **Every run produced exactly 1 red of 46, on its own named assertion, and all 44 other tests in the file stayed green in every run** — no neighbouring pre-existing oracle reddened, so no narrowing was required. |
  | 5 — bounded to these two assertions in this one file | No other assertion in `w4-canvas-integrity.test.ts` was touched, and no production source was modified by the amendment: `background-sync.ts`, `collab.ts` and `canvas-sync.ts` were perturbed only inside falsification runs and restored (guard lines inspected, zero `FALSIFY` markers). **But see the divergence note below — a third assertion, in a different file, was restated by the same WP and is NOT covered by this licence.** |

  **The grant's line numbers are the stale ones — the measured lines are different, and that is expected.** The entry above names `M1` at `:1597` and `K5` at `:1666`; those are pre-amendment. The amendment adds a `vi.hoisted` guard-consult recorder and a `vi.mock("../utils", …)` delegation at `:68-77`, plus two in-place comment blocks, which shift both sites down. Measured and verified in the current tree: **`M1` at `:1665`** (`.toBe(false)` at `:1670`, consult pin at `:1673-1678`) and **`K5` at `:1747`** (`.toBe(false)` at `:1752`, consult pin at `:1756-1761`).

  | WP | Assertion amended | File · line | Why it is stale rather than violated | Strictness after |
  |---|---|---|---|---|
  | WP27 (A1) | `M1 setActiveFile GUARDS the bare-path getDoc for a .canvas that was never subscribed` — the `expect(reached, …).toBe(true)` conjunct, where `reached` = *"`getDoc` was called with the `.canvas` path"* | `plugin/src/__tests__/w4-canvas-integrity.test.ts:1665` (grant-time `:1597`) — **pre-existing at the B4 baseline**, authored by W4's revalidation pass, green at 46/46 before WP27 | An **inverse characterisation of the defect WP27 AC4 exists to close**, not a violated contract. Its own message read as a finding rather than a specification — *"setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete"* — i.e. it was written to record that the hole was still open. It was **true when written**; AC4 made it false by requiring precisely this call site to be guarded, and charter §7.0(c) names the same site. The direction check is the thing separating this from a real defect: a genuine violation would be an assertion still true under AC4 (a path that *should* reach `getDoc` no longer doing so); this asserts that an **unguarded** path *is* reached, which is exactly what AC4 forbids. | `toBe(false)` **plus** a new whole-collection `toEqual([true])` over the recorded `skipsAutoTextSync` verdicts for that path. **Stricter than before, in a way the bare inversion is not:** a lone `toBe(false)` is also satisfied by a broken harness, a renamed method or an unrelated early return, and the consult pin is red in every one of those cases. Nothing removed, no matcher softened. **Falsified (F1):** removing `if (skipsAutoTextSync(oldActive)) return;` from `BackgroundSync.setActiveFile` → **exactly 1 of 46 red — `M1`, on its own pin** (`expected true to be false`); zero neighbour reddening. **Falsified (F1b):** replacing the shared predicate with a private `oldActive.endsWith(".canvas")` copy — guard still works, `reached` still `false` → **exactly 1 of 46 red — `M1`, on the NEW assertion** (`expected [] to deeply equal [ true ]`). That is the regression class this module has already grown twice. |
  | WP27 (A2) | `K5 CollabManager HAS an internal .canvas guard — protection no longer relies on main.ts's MarkdownView gate` — same `expect(reached, …).toBe(true)` shape | `plugin/src/__tests__/w4-canvas-integrity.test.ts:1747` (grant-time `:1666`) — **pre-existing at the B4 baseline**, same authoring pass | Same class. Its message read *"CollabManager has NO internal `.canvas` guard … currently unreachable ONLY because main.ts gates on `getActiveViewOfType(MarkdownView)`, which no test covers"* — the reachability argument AC4 rejects in as many words. WP27 added the guard the message says does not exist, so the assertion characterises a hole that is now closed. | Identical treatment: `toBe(false)` plus the predicate-consult `toEqual([true])`. Same no-weakening constraints observed. **Falsified (F2):** removing the `if (skipsAutoTextSync(filePath)) { … }` block from `CollabManager.activateForFile` → **exactly 1 of 46 red — `K5`, on its own pin**; no neighbour reddened. **Falsified (F2b):** private `filePath.endsWith(".canvas")` copy → **exactly 1 of 46 red — `K5`, on the NEW assertion.** |

  **How the guard became observable, and why the instrument is the way it is.** The file now mocks `../utils` through a `vi.hoisted` recorder that **delegates to the real `skipsAutoTextSync`** and appends `{path, verdict}` to a plain array — behaviour byte-identical for every other test in the file, all 44 of which stayed green through every amendment and falsification run. The recorder is a plain array rather than a `vi.fn` **precisely so the file-wide `vi.restoreAllMocks()` in `afterEach` cannot silently disarm the oracle**; each consumer clears it immediately before driving its site. `skipsAutoTextSync` is the correct thing to instrument because it is the one predicate both AC4 sites consult, and `F1b`/`F2b` are what keep it that way.

  <!-- Updated: divergence recorded at row-entry time rather than smoothed over — a third WP27 assertion rewrite exists outside this licence 2026-08-04 -->
  <!-- Updated: RULED ON the same day (D-1) — no licence was required, because the file was authored by B4 itself and every §7 licence class governs INHERITED tests. The divergence block is kept verbatim below the ruling; the ruling and the recorded restatement follow it. 2026-08-04 -->

  > **✅ DIVERGENCE D-1 — RULED 2026-08-04: no licence was required. NOT an abort criterion.** The rewrite is **not** an abort criterion, for the reason the divergence itself isolated: **the file was authored by B4**, so it is not *pre-existing* in the sense every §7 licence class is written for. The classes govern **inherited** tests — removing or rewriting an assertion the batch did not write. A batch revising a test it authored during the same batch is **authoring, not amending**. This is the established precedent in this run, not a new one: B4 recorded exactly the same reasoning for the WP26 type-annotation edit — *"the file was authored by this batch, not inherited, so no licence was required … logged anyway: an unlogged test-file edit is indistinguishable from a hidden one."* Same treatment applied here: **no licence row, but a logged note** (immediately below), plus a **qualification to WP27 licence condition 5** (above) so its over-broad wording can no longer make a batch's revision of its own new test an abort. **The divergence text is kept verbatim below** — it is the record of what was flagged and why; read it as the state before this ruling.
  >
  > **⚠ DIVERGENCE — recorded, unresolved, and NOT licensed by the entry above.** WP27 restated a **third** assertion, in a file this licence does not name: `workflowArtifacts/canvas-v2/tests/blind_set1/WP27/test_tp05_rename_creates_no_doc_and_no_orphan_blind1.test.ts:141` (assertion now at `:194`). The old form was one opaque `expect(Array.from(Y.encodeStateVector(after))).toEqual(vectorBefore)` — *"nothing happened"* — which AC2 makes unsatisfiable for **any correct implementation**, since AC2 mandates the rename write `meta.path` into the Yjs `meta` map. `ImplementationReport_WP27.md` §"Blind-oracle strengthening" and `Worker3Handover_B4_P2.md` §D both **demonstrate** the mechanism (exactly one `Y.Map` item created ⇒ exactly one clock tick, observed `…,19]` → `…,20]`) and both falsify the replacement — a spurious extra `meta.set` reddens on `expected 2 to be 1`, a full record re-seed on `expected 17 to be 1`, each 1 of 41, count **41 collected / 41 passed before and after**. Three facts make this a divergence rather than a row:
  >   1. **It is outside condition 5.** The WP27 licence covers *"these two assertions in this one file"* and makes *"any further WP27 assertion rewrite … an abort criterion"*. This is a further WP27 assertion rewrite.
  >   2. **It has the third class's shape but no third-class grant.** It is *unsatisfiable as authored*, demonstrated not asserted, strictness raised, count unchanged — i.e. it satisfies every condition of the third class — but §7 records no grant for it, and no owner was told to write a row.
  >   3. **The test's title was not updated** and now contradicts its own assertion: it still reads *"clientID and state vector are unchanged across the rename"* while the assertion pins a delta of **exactly `RENAME_CRDT_WRITES = 1`**. That is the trap WP27 licence condition 3 exists to prevent, occurring at the one site the licence does not reach.
  >
  > Mitigating, and stated so the Dispatcher can weigh it: the file was **authored by B4 itself**, so it is not *pre-existing* in the rule-4 sense the amendment class is written for, and the strengthening is real (it now rejects spurious extra writes and rename-time re-seeding, two classes `"unchanged"` could not distinguish from correct behaviour). **Whether that means "no licence was required" or "a third-class grant is owed retroactively" is a Dispatcher ruling, not Worker 2's to assume.** Recorded here so the next §7 reader does not find an unregistered rewrite and read it as an unlicensed edit. **Unverified:** who performed this restatement (test author vs. coder) is not stated in either artefact; the author/coder split is recorded only for the WP25 `tp01` fixture repairs.

  <!-- Updated: D-1 note added — a LOG of a batch-authored test restatement, deliberately NOT a licence row, per the WP26 precedent 2026-08-04 -->

  **NOTE (2026-08-04) — batch-authored test restatement, logged, NOT a licence row.** Recorded under the D-1 ruling above. This is a **log entry**, not a grant: it confers nothing, it extends no class, and it must not be read or cited as a licence.

  | | |
  |---|---|
  | File | `workflowArtifacts/canvas-v2/tests/blind_set1/WP27/test_tp05_rename_creates_no_doc_and_no_orphan_blind1.test.ts` — **authored by B4**, in the same batch that restated it |
  | Old form | one opaque assertion: `expect(Array.from(Y.encodeStateVector(after))).toEqual(vectorBefore)` — *"nothing happened"* — which **no correct implementation** can satisfy, since AC2 mandates the rename write `meta.path` into the Yjs `meta` map |
  | New form | **four assertions** over the decoded state vector, pinning `RENAME_CRDT_WRITES = 1` (`:170` in the current tree): **(1)** `:172-176` no client entry vanished or was invented (sorted key-set `toEqual`); **(2)** `:177-183` every pre-rename clock is `toBeGreaterThanOrEqual` its old value — history extended, never replaced; **(3)** `:184-188` no **peer's** clock moved (`toBe(clock)`) — the rename authors nothing on anyone else's behalf; **(4)** `:189-194` this replica advanced by **exactly** `RENAME_CRDT_WRITES` (`toBe`) |
  | Mechanism, demonstrated not asserted | exactly one `Y.Map` item created ⇒ exactly one clock tick; observed `…,19]` → `…,20]`. Sources: `ImplementationReport_WP27.md` §"Blind-oracle strengthening" and `Worker3Handover_B4_P2.md` §D |
  | Falsifications | a spurious extra `meta.set` reddens on `expected 2 to be 1`; a full record re-seed reddens on `expected 17 to be 1` — each **1 of 41** |
  | Counts | **41 collected / 41 passed before and after** — unchanged |
  | Strictness | **raised.** `"unchanged"` was red against *both* a correct implementation and a re-seeding one, so it could not distinguish them; the new form rejects spurious extra writes and rename-time re-seeding while admitting exactly AC2's one write |
  | Why no licence was required | **batch-authored, not inherited.** Every §7 licence class governs a test the batch did **not** write. See the D-1 ruling above and the WP26 precedent it cites. |

  <!-- Updated: outstanding correction recorded, NOT performed — §7 is Worker 2's; the test tree is not, and B9b owns the tree while this is written 2026-08-04 -->

  **⬜ OUTSTANDING CORRECTION OWED — assigned to a Worker 3 batch. Recorded here, deliberately not performed.** The restated test's **title still asserts the opposite of its own assertion**. This is the trap that bit WP26/AC3 **twice**, with two different filenames, and hard-won rule 6 (*a cited contract must be re-read, not recalled*) is what makes a lying title dangerous rather than merely untidy. Everything a Worker 3 batch needs is here; nothing below needs re-deriving.

  | | |
  |---|---|
  | File | `workflowArtifacts/canvas-v2/tests/blind_set1/WP27/test_tp05_rename_creates_no_doc_and_no_orphan_blind1.test.ts` |
  | Site | **line 134** — `it("clientID and state vector are unchanged across the rename", async () => {` (verified by re-reading the current tree on 2026-08-04, not recalled) |
  | Defect | the title says **"unchanged"**; the assertion at `:189-194` pins a delta of **exactly `RENAME_CRDT_WRITES = 1`**. A title asserting the opposite of its own assertion. |
  | Required change | replace the title string with one that states what the test now pins — the history is **extended by exactly AC2's one write**, never replaced. Suggested, not mandated: `"clientID is unchanged and the state vector advances by exactly AC2's one write"`. Any wording is acceptable **provided it does not say the vector is unchanged**. |
  | Hard bound | **title / message text only.** No assertion, no matcher, no expectation, no fixture, no import, no `it`/`describe` structure, no test count. The count stays **41 collected / 41 passed**. Anything beyond the string is outside this order and needs its own grant. |
  | Also permitted, same bound | the file-header block at `:11-12` still reads *"The `clientID` is compared to ITSELF … "* — that remains true and needs **no** change. The `STRENGTHENED (this batch, self-correction)` header block at `:14-20` already explains the delta correctly and must be **left standing**; it is what keeps the correction legible. |
  | Why not done here | Worker 2 owns §7; it does not own the test tree, and **B9b holds that tree** while this is written. A §7 register recording an order it also executed is a register auditing itself. |

  > **Minor, non-blocking:** `ImplementationReport_WP27.md:62` quotes the licensed-amendment list as *"WP10, WP14, WP18, WP19, WP46, WP59, WP60, WP61"* — missing **WP64** and (at that moment, correctly) **WP27**. It is a stale recall of a §7 list, harmless in context because WP27 acted on it *conservatively* (it concluded it held no licence and left both assertions untouched), but it is the same stale-recall pattern already noted for `_B4_P2_running_notes.md:56`, and rule *"a cited contract must be re-read, not recalled"* applies.

  <!-- Updated: D-5 ruling — third instance of the stale-recall pattern; the rule is stated once here rather than by correcting each historical artefact 2026-08-04 -->
  > **Standing rule, stated once (D-5, 2026-08-04): the lists and classes in §7 are AUTHORITATIVE, and any quotation of them anywhere else — implementation report, handover, running notes, charter, this file's own prose — is a SNAPSHOT, not a source.** A quotation is correct only as of the moment it was taken and confers nothing; where a quotation and §7 disagree, **§7 wins and the quotation is stale by definition.** Three instances of this pattern are now on record (`_B4_P2_running_notes.md:56`, `ImplementationReport_WP27.md:62`, and the two-step WP10/WP14 row entry), which is exactly what hard-won rule 6 exists for. **Completed implementation reports are historical artefacts and are NOT to be rewritten to match** — correcting them would destroy the record of what a batch actually believed when it acted, which is often the load-bearing fact. Re-read §7 instead.

  <!-- Updated: third amendment class added — the re-verification surfaced tests that could never have passed against any implementation 2026-08-01 -->

  **Third class, 2026-08-01 — *unsatisfiable as authored*.** The two classes above govern a test that *disappears* and a test whose *exact-shape assertion is restated*. The C56/C57 re-verification surfaced a third, which neither covers: **a test that could never have passed against any implementation**, because the assertion itself is malformed rather than because the expectation is out of date. These were invisible until the repaired runner executed sets that had never run. Two are known:

  | Test | Why it cannot pass | Class | Status |
  |---|---|---|---|
  | `tests/blind_set2/WP49/test_tp10_absent_file_not_created_blind2.test.ts:64` | `expect(result.content).not.toContain("stale")` on a `null` receiver. Vitest's `toContain` skips its string/array handling for `null` and delegates to chai's `include`, whose `default` branch **throws** `AssertionError: the given combination of arguments (null and string) is invalid` — regardless of `.not`. The preceding line already asserts the value is exactly right. | TypeScript | **REPAIRED by WP61** — mechanism demonstrated against the installed libraries (see the §7 row); now `toBeNull()` |
  | `tests/blind_set2/WP49/test_tp2_user_origin_blocks_quiescence_blind2.test.ts:84` | <!-- Updated: second TypeScript instance of the third class, found by WP61 2026-08-01 --> The fixture contradicts its own subject. After 400 ms of idle the wait is started, then the timers are advanced by exactly `pollMs` (20 ms) *before* the user edit is delivered — so the first poll observes 420 ms of idle and resolves `{quiescent: true}` on the same tick, before the `put` on the next line runs. With the chartered `pollMs = 20` / `quietWindowMs = 50` no implementation can answer `false`, and the pre-WP49 evaluate-before-sleeping ordering resolves `true` even earlier. | TypeScript | **REPAIRED by WP61** — arithmetic demonstrated; fixture retimed so the edit lands at t0+10, strictly inside the pending wait |
  | `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` (2 points) | Double `pytest.raises` — structurally unsatisfiable. Recorded by WP57 as a finding and deliberately left unrepaired, because that batch was forbidden to touch assertions. | Python | OPEN — needs its own charter; WP61 §2 explicitly leaves it out of scope |

  The licensing rule is the same as for the other two classes — the WP names each repaired test by file, line and reason in its implementation report — plus **both** conditions of the amendment class (strictness may not fall; the test count does not change) and one more that is specific to this class:

  3. **The unsatisfiability must be demonstrated, not asserted.** The implementation report must show the mechanism — the library code path that throws, or the arithmetic proving the fixture contradicts itself. *"This test could never pass"* is precisely what a coder sub-agent would claim about a test that has found a real bug, so the claim is only licensed when it is shown. Without the demonstration, the failure is treated as a **real defect** and escalated.

  A repair under this class must make the assertion *assert something true and strict* — never delete it, never replace it with a tautology. A repaired test that cannot fail is worse than the error it replaced.

  | WP | Assertion amended | File · line | Why it is stale rather than violated | Strictness after |
  |---|---|---|---|---|
  | WP46 | `buildPluginHost > sessionInfo maps settings + connection state` | `plugin/src/__tests__/e2e-control.test.ts:197` — **pre-existing baseline test**, part of the 674 baseline, from the prior e2e-infra initiative | C46 AC1 states `session.info` "**additionally** reports" vault, build and canvas-surface identity — widening the payload from 4 to 9 keys is the literal content of the AC, not a side effect of it. The assertion pins a payload the spec has deliberately replaced. Its own subject (settings + connection-state mapping) is untouched: the four legacy fields keep their names, defaults and semantics verbatim, which C46 TC2 pins independently. | Whole-object `toEqual` over all nine keys, including the honest-degradation values for this fixture (`vaultId: ""`, `vaultName: ""`, `vaultPath: null`, `canvasSurface: true`). **Stricter than before** — it now also pins the AC3 degradation contract, which nothing pinned previously. |
  | WP46 | `WP44 AC4 — resolvePort precedence … > binds the numeric LIVESHARE_E2E port (order 1)` | `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:140` (untracked staged copy) **and its source of truth** `workflowArtifacts/canvas-v2/tests/visible/WP44/test_tp11_resolveport_precedence_visible.test.ts` | Intra-batch ordering artefact of B9a: a WP44 visible test staged before WP46 extended the payload. Its subject is *port precedence*; the payload appears only as proof that a real control server owns the port, so the added keys are incidental to what it verifies. | Whole-object `toEqual` on the `{ok, result}` envelope with all nine `result` keys (`canvasSurface: false` for this fixture — it has no `canvasSync`). **Both copies must be amended identically**; amending only the staged copy silently reverts on the next restage from the artefact folder. |

  <!-- Updated: B13 — WP59 (2 rows) amendments entered 2026-08-02 -->
  | WP59 | `AC2 — a full round trip loses no field and no character > returns every node byte-for-byte through serialise → parseCanvas` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts:53-54` (binding + key-set assertion; the value loop at `:55-57` follows the same binding), import at `:4` | **Re-measured first, on a quiet tree, exactly as C59 §5 required** — the ruling was provisional on B2 closing. The failure reproduced in precisely the recorded shape: `expected [ 'id', 'pos', 'size', 'text', 'type' ] to deeply equal [ Array(7) ]`, i.e. 5 keys vs 7. Stale, not violated: the `.canvas` **bytes are unchanged** (`serializeCanonicalCanvas` still emits flat keys; `canonicalizeRecord` adds and removes nothing), while the **reader** moved by charter — WP16 AC1 collapses `x,y` → `pos` and `width,height` → `size` via `toV2Node` (`canvas-sync.ts:226-252`). Nothing is lost: `decodeCanvasDataToFlat` (`:466-476`) is the exact inverse and is applied at every internal `parseCanvas` call site. The identical breakage in the **visible** twin was escalated by WP16 and already amended the same way (`plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts`). | Whole-collection exact `toEqual` over the complete sorted key list, **unchanged in form** — only the subject is read through `decodeCanvasDataToFlat`. **No** `toMatchObject`, subset, `objectContaining`, key-count check, `skip`/`only` or destructuring. **Stricter than before:** the per-key value loop at `:55-57` was previously *unreachable* (the test died at `:54`) and now executes, pinning every value through the register bridge, and the assertion additionally pins the bridge's invertibility, which nothing pinned previously. Test count unchanged (4 before, 4 after). Falsified: making `decodePos` drop `y` turns this assertion red (6 vs 7 keys) and no other test in the file (P1); `canvas-registers.ts` restored byte-clean, sha256 verified identical. |
  | WP59 | `AC2 — a full round trip loses no field and no character > preserves an edge's optional fields and adds none` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts:76-78` (nine-key assertion) and `:80` (`label`), import at `:4` | Same cause, edge side: reproduced verbatim as `expected [ Array(5) ] to deeply equal [ Array(9) ]`. `toV2Edge` (`canvas-sync.ts:263-299`) folds `fromNode/fromSide/fromEnd` → `from` and `toNode/toSide/toEnd` → `to`, and `decodeEndpointToFile` (`canvas-registers.ts:615-626`) is its exact inverse. | The nine-key list is **kept verbatim** as a whole-collection exact `toEqual`; only the subject is read through the sanctioned inverse. **Stricter than before:** an added `toEqual` decodes the `to` register itself and pins `{toNode, toSide, toEnd}`, so a register that satisfied the key-set check while carrying a wrong or absent side can no longer pass — mirroring the sanctioned form in the visible twin. Test count unchanged. Falsified: making `decodeEndpointToFile` drop `end` turns this assertion red (7 vs 9 keys) and **only** it — 44 of 45 still pass (P2); restored byte-clean, sha256 verified. |
  <!-- Updated: B13 escalation ruling — WP59's licence extended to the two `edges.bare` pins, one per set 2026-08-02 -->
  | WP59 (bare edge) | `AC2 — a full round trip loses no field and no character > preserves an edge's optional fields and adds none` → the `edges.bare` key-set pin | `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts:103` (called `:79` in B13's handover, which used the pre-amendment numbering; the WP59 comment blocks shifted it) | **Same class as the two rows above, and the last site in the file still reading `parsed` instead of `flat`** — its own sibling assertion at `:91` was already amended to read `flat`. WP10 AC5 makes a side-less `{fromNode}` a **whole** endpoint register (`node` alone decides presence), so `toV2Edge` now folds a bare edge to `{from, id, to}`. **This assertion was never passing and was never violated: it was UNREACHABLE**, masked by the `:76` failure earlier in the same test body, and executed for the first time when WP59 greened `:76`. C59 §2 had fenced it off with *"they pass and must keep passing"* — see the fenced-off-claim rule below. | The `toEqual(["fromNode","id","toNode"])` whole-collection form is kept **verbatim**; only the subject moves from `parsed` to the already-bound `flat`. No new import, no new binding. **Stricter than before:** an added exact `toEqual` pins `decodeEndpointToFile("from", …)` to exactly `{fromNode: "a"}`, so an implementation re-emitting `fromSide: null` or `fromSide: ""` — the two shapes that would silently rewrite every side-less file on its first write — now fails here. Test count unchanged. **Falsified (B15):** the charter's named perturbation — `decodeEndpointToFile` emitting `fields[keys.side] = ""` unconditionally — turns this test red, but **at the `:98` assertion, which masks this site**, so it does not prove *this* pin bites. A second, narrower perturbation (`""` only when `side` is absent, leaving `full`'s real side intact) isolates it: red at exactly this assertion, `expected [ 'fromNode', 'fromSide', 'id', …(2) ] to deeply equal [ 'fromNode', 'id', 'toNode' ]`, 44 of 45 still passing. **The masking is the same trap B13 named** — one perturbation was not enough to falsify a site that sits behind another amended assertion in the same test body. Restored byte-clean, sha256 `553c8464…d8b748`. |
  | WP59 (bare edge) | `the .canvas file shape and tab indentation are unchanged (AC4) > stays readable by the unchanged parseCanvas, including edge-only content` | `workflowArtifacts/canvas-v2/tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts:79` | **Identical root cause, in a set B13 never touched — and the row that proves a CONFIRMED verdict can expire.** It was ledgered CONFIRMED 56/56/0 by WP56 and re-measures 56/55/1 with `parsed.edges["e-only"].fromNode` undefined. **WP56's measurement was correct when taken**; WP10 AC5 landed afterwards. The green was itself a symptom of the defect: `toV2Edge` keeps the flat keys only when the register **fails** to build, so pre-AC5 this assertion passed precisely because a fully-connected side-less edge was being read as not-an-endpoint. The test's stated subject — the file stays readable, edge-only content included — is untouched; the file bytes are identical either way. | Read through `decodeCanvasDataToFlat(parsed)`. **Stricter than before:** the single-field `toBe("ghost-a")` is joined by an exact whole-object `toEqual` over the bare edge's full flat key set and by the `decodeEndpointToFile` no-`*Side`-key pin, so the side-less round trip is pinned as a whole rather than one field at a time. Test count unchanged (5 before, 5 after). **Falsified (B15):** the charter's named perturbation turns this test red **at this site directly and alone** — `expected { fromNode: 'ghost-a', fromSide: '' } to deeply equal { fromNode: 'ghost-a' }`, 55 of 56 still passing. Unlike set2's row this site sits first in its test body, so one perturbation suffices. Restored byte-clean, sha256 `553c8464…d8b748`. |
  <!-- Updated: B11 — WP60 (1 row) and WP61 (5 rows) amendments entered 2026-08-01 -->
  | WP60 | `WP44 AC4 (blind 2) — the import list does not grow > imports exactly one node builtin: node:http` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts:74-77` (assertion), `:1-8` (preamble prose restating the same claim) | The pin was a **self-imposed tightening beyond AC4**, not AC4 itself. AC4's subject is `resolvePort` — *"keeps its existing precedence and gains no new dependency"* — and WP44's dependency language (`:51`, `:107`, `:112`) is uniformly about **runtime packages** (publish date ≥ 7 days, `npm view`); a node built-in cannot be a dependency in that sense. The visible counterpart states the intended rule explicitly and contradicts the blind pin: `tests/visible/WP44/test_tp12_no_server_no_port_visible.test.ts:13-14` allows *"a `node:` builtin **or** a package already in `plugin/package.json`"*, implemented at `:111-131` as an allow-list that **skips every `node:` specifier**. `node:crypto` has exactly one use site — `e2e-control.ts:978`, the `canvas.file` sha256 that `T3_SharedContract` §6.1 mandates — and adds no port, socket or listener. | Exact whole-set `toEqual` over `new Set(["node:crypto", "node:http"])`. **No** subset match, `arrayContaining`, "at least" check, pre-filtering of `node:crypto`, `skip` or `only`. Falsified: adding `node:util` to `e2e-control.ts` turns this test and only this test red (P1). |
  | WP61 (class A) | `WP49 AC1 blind1 — timeoutMs boundary values > timeoutMs 0 answers true when already idle and false immediately after activity` | `workflowArtifacts/canvas-v2/tests/blind_set1/WP49/test_tp4_timeout_semantics_preserved_blind1.test.ts:71` (test), advances at `:77` and `:82`; preamble `:1-5` | Stale against WP49 AC1's **deliberate** sleep-first ordering, which AC1 names the old ordering as the defect it removes. `timeoutMs = 0` means *expire at the earliest opportunity*, which still costs one 20 ms poll because `waitQuiescent` sleeps before it evaluates (`e2e-control.ts:1012-1017`). The test advanced only 10 ms — less than one poll — so neither promise ever settled and it died on vitest's 5 s timeout. **The verdicts it asserts are the verdicts the implementation produces**; only the zero-latency assumption was wrong, and no spec statement supported it. Closed by AC4's new `T3_SharedContract` §6 statement. | Both `toEqual` verdict assertions kept **verbatim** (`{quiescent: true}` idle, `{quiescent: false}` after activity); only the timer advance moved 10 → 20 ms. Test count unchanged. Falsified: collapsing `timeoutMs 0` to the 2000 default (`timeoutMs \|\| 2000`) turns this test red (P2). |
  | WP61 (class A) | `WP49 AC1 blind2 — a peer tombstone keeps the instance non-quiescent > a remote node removal blocks a zero-budget quiescence probe` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP49/test_tp1_peer_origin_blocks_quiescence_blind2.test.ts:49` (test), advances at `:62` and `:69` | Same cause as the row above: 5 ms advances against a 20 ms poll, so neither promise settled. The peer-tombstone property the test exists to pin is unaffected and still enforced. | Both `toEqual` verdicts kept **verbatim**; only the advances moved 5 → 20 ms. Falsified: the same `timeoutMs \|\| 2000` perturbation turns this test red (P2). |
  | WP61 (class B) | `WP49 AC1 blind2 — the activity seam is not the counter seam > session.info is untouched by the new seam` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP49/test_tp3_control_edit_still_bumps_blind2.test.ts:83` (test), assertion at `:87-92` | **Third instance of the pattern already licensed twice for WP46.** The assertion pinned the pre-WP46 four keys; `sessionInfo()` returns nine (`e2e-control.ts:832-850`), pinned field-by-field in `T3_SharedContract:199` and §6.2. `TaskCharter_WP46:95` settles it: *"stale, not violated — they pin a payload the spec deliberately replaced, while their own subjects are untouched."* This file's own subject is intact: its other two tests (that the widened seam does not move `bindingCounters`) both passed throughout. | Whole-object exact `toEqual` over all **nine** keys with this fixture's honest-degradation values (`vaultId: ""`, `vaultName: ""`, `vaultPath: null`, `pluginBuild: `0.0.0+${E2E_BUILD_MARKER}``, `canvasSurface: true`). **No** `toMatchObject`, subset, `objectContaining`, key-count check or destructuring. **Stricter than before** — it now also pins the AC3 degradation contract, which nothing in this set pinned previously. Falsified: pinning `canvasSurface: false` in production turns this test and only this test red (P3). |

  <!-- Updated: B3b — WP10 (3 rows) and WP14 (3 rows) amendments entered under the E1/E1-b rulings 2026-08-02 -->
  | WP10 | `TC4 — an endpoint register is wholly present or wholly absent` → the empty-**side** refusal conjunct | `plugin/src/__tests__/v2/wp10/test_tp04_wholly_present_or_absent_visible.test.ts:38,69` | The assertion required `encodeEndpoint` to **throw on an empty `side`** and read a side-less value as **absent**. AC5 makes exactly that shape legal: `side`/`end` are optional components and `node` alone decides presence. AC4's own subject — write granularity, "no chimera", no per-component setter — is **untouched and still asserted** in the same file (`:98`). Reading a side-less register as absent *was the defect*, so the retired assertion pinned the bug. | Exact assertions retained and **widened**: `encodeEndpoint` still `toThrow()` on missing/empty/`null`/wrong-typed **`node`**; `isEndpointRegister` pinned `toBe(true)` for `{node}` with absent side/end and `toBe(false)` for wrong-typed components and node-less values. No `toMatchObject`, no subset, no `skip`/`only`. Test count unchanged. |
  | WP10 | `a raw side-less value reads back PRESENT; a raw node-less value reads back ABSENT` (blind1) | `workflowArtifacts/canvas-v2/tests/blind_set1/WP10/test_tp04_wholly_present_or_absent_blind1.test.ts:35,67` | Blind counterpart of the row above; pinned `{node:"orphan"}` (no side) as **absent**. Retired by AC5. | Re-pinned to the **two-absences distinction** — absent (no `node`, edge dangling) vs. present-with-no-side (attached, legal) — with whole-object `toEqual` on both sides plus `hasBothEndpoints` `toBe(false)`/`toBe(true)`. **Stricter than before**: it now pins the exact confusion that caused the defect. Executed count 8/8. |
  | WP10 | `an ABSENT optional component keeps the register present; a WRONG-TYPED one voids it` (blind2) | `workflowArtifacts/canvas-v2/tests/blind_set2/WP10/test_tp04_wholly_present_or_absent_blind2.test.ts:38,44,92` | Pinned `isEndpointRegister({node,side,end:null})` as `false` and `encodeEndpoint("n1", null)` as throwing. The amendment states `""`/`null`/`undefined` all count as **absent** for `side`/`end` while the register stays **present**. | Exact `toBe(true)`/`toBe(false)` tables over absent vs. wrong-typed components; `encodeEndpoint` still `toThrow()` for `null`/`undefined`/`""`/wrong-typed **`node`**. No matcher softened. Executed count 6/6. |
  | WP14 | `` `to` key present but missing `side` → invalid, reason INVALID_TO `` | `plugin/src/__tests__/v2/wp14/test_tp08_edge_endpoint_missing_vs_illtyped_visible.test.ts:54` | Edge validity is exactly `id ∧ from.node ∧ to.node`; **`side` was never a conjunct** (CONCEPT_V2 Teil 11). The fixture was re-pointed to a genuinely invalid shape (`{node: "", side: "left"}` — an **empty node**) and the now-inaccurate **title** was corrected to say so. AC2's real subject — missing vs. ill-typed produce **distinguishable** reasons — is untouched and still asserted at `:64`. | Same exact `toBe(false)` + `reason` `toBe("INVALID_TO")` assertions, against a shape that is still genuinely ill-typed. Title corrected only; no matcher, strictness or count change. |
  | WP14 | `"to" = <shape> → validity matches hasBothEndpoints` (shape table) | `plugin/src/__tests__/v2/wp14/test_tp09_edge_validity_matches_hasBothEndpoints_visible.test.ts:60` | The table listed "missing `side`" as an invalid shape. Retired by AC5 / the AC1 re-read. TC9's subject is **behavioural agreement with `hasBothEndpoints`**, which is unchanged. | Verdicts stay **derived** from `hasBothEndpoints` (never hardcoded), and the table was **extended 8 → 11 shapes** (side-less-with-end, node-less-side-only, wrong-typed side). **Strictly stronger than before.** |
  | WP14 | `` `text` present but empty string → invalid, reason INVALID_TYPE_SPECIFIC `` (blind1) | `workflowArtifacts/canvas-v2/tests/blind_set1/WP14/test_tp05_node_type_specific_missing_vs_illtyped_blind1.test.ts:81,112` | **E1-b:** `"text": ""` is a legal JSON Canvas text node (an empty or cleared card). The pin made a legal record refusable, and under the pre-I11 coupling that refusal deleted it. `file`/`url` **keep** their non-empty requirement, so the missing-vs-ill-typed subject survives intact. | Re-pointed to shapes that are still genuinely ill-typed (`text: null`, `text: []`) plus a retained `link`→`url` empty-string invalid case, and **gained** an explicit `AMENDED: text: "" is a LEGAL empty card` positive pin. Exact `toBe` on both validity and reason. Executed count 34/34. |
  | WP61 (class C) | `WP49 AC1 blind2 — the quiet window is re-armed by whichever origin moved last > a user edit landing during a pending wait pushes the answer to false` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP49/test_tp2_user_origin_blocks_quiescence_blind2.test.ts:84` (test), fixture at `:89-92` | **Unsatisfiable as authored — mechanism demonstrated, not asserted.** Arithmetic: the wait starts at t0 after 400 ms of idle, so `lastActivity ≤ t0−400` and `deadline = t0+120`. The loop's first `setTimeout(r, 20)` fires at exactly t0+20 — the same instant `advanceTimersByTimeAsync(20)` lands on — and `advanceTimersByTimeAsync` drains microtasks, so the poll body runs and evaluates `idleFor = 420 ≥ quietWindowMs (50)`, returning `{quiescent: true}` **before** the `put` on the following line executes. Observed verbatim in the pre-repair run: `AssertionError: expected { quiescent: true } to deeply equal { quiescent: false }` at `:94`. With the chartered `pollMs = 20` / `quietWindowMs = 50` no implementation can answer `false` here, and the pre-WP49 evaluate-before-sleeping ordering (which AC1 forbids) resolves `true` at t0, earlier still. Only an unchartered `pollMs > 20` could leave it pending. The **property** the test names is legitimate; the fixture simply never delivered the edit inside the wait. | `{quiescent: false}` `toEqual` kept **verbatim**. Fixture retimed only: budget 120 → 25 ms and the pre-edit advance 20 → 10 ms, so the edit lands at t0+10, strictly inside the pending wait and before the first poll; poll t0+20 sees `idleFor = 10 < 50` and `20 < 25` so it keeps waiting, poll t0+40 sees `idleFor = 30 < 50` and `40 ≥ 25` so it answers `false` — the deadline decides, not a settle. **The repair is not a tautology:** falsified by making the activity seam origin-aware (the WP49 AC1 violation), which turns this test red (P5). It also still goes red if the wait ever evaluates before its first sleep. |
  | WP61 (class C) | `WP49 AC3 blind2 — near-miss neighbours are not substituted > the requested path is missing even though similar files exist` | `workflowArtifacts/canvas-v2/tests/blind_set2/WP49/test_tp10_absent_file_not_created_blind2.test.ts:64` | **Unsatisfiable as authored — mechanism demonstrated against the installed libraries.** Line 63 already pins `result` to exactly `{exists:false, sha256:"", size:0, content:null}` — what production returns (`e2e-control.ts:971-973`) and what `T3_SharedContract` §6.1 mandates. Line 64 then ran `expect(result.content).not.toContain("stale")` on that `null`. Path: `@vitest/expect/dist/index.js:1245` skips the string/string fast path because the receiver is not a string; `:1249` (`actual != null`) skips the jest-compat `Array.from` conversion, so the object flag stays `null`; `:1252` delegates to chai's `include`; `chai/index.js:2067-2074` matches no case for a `null` object, enters `default`, finds `val !== Object(val)` for the primitive `"stale"` and **`throw`s** `AssertionError`. Because it *throws* rather than routing through `this.assert()`, chai's `negate` flag cannot invert it — `.not` is irrelevant. Observed verbatim pre-repair: `AssertionError: the given combination of arguments (null and string) is invalid for this assertion` at `@vitest/expect/dist/index.js:1252:15`. **The contradiction is internal to the test:** any implementation making line 64 pass (by returning a string) breaks line 63, and any implementation honouring the contract throws on line 64. | `expect(result.content).toBeNull()` — a direct exact assertion, **strictly stronger** than the substring check it replaces: it admits exactly one value where `.not.toContain("stale")` admitted every string lacking that substring. Corroboration that this is the house-correct strict form: the untouched sibling `test_tp9_file_read_is_readonly_blind2.test.ts` already pins the same contract value with `expect(missing.content).toBeNull()`. Falsified: softening the absent-file branch to `content: ""` turns this test red (P4). |

  **Cross-ownership note.** The second assertion lives in a **WP44-owned** artefact. WP46 is explicitly cross-licensed to change *that one assertion's expected payload and nothing else* in that file — no restructuring, no change to the port-precedence logic, no other test in the file. WP44's charter and ACs are not reopened.

  <!-- Updated: B11 measured arithmetic for WP60 + WP61 2026-08-01 -->
  **Measured arithmetic for WP60 and WP61 (B11).** Test counts are **unchanged in every set**, which is the whole claim of an amendment: `WP44 set2` collected **25** before and after (24 pass / 1 fail → 25 / 0); `WP49 set1` collected **32** before and after (31 / 1 → 32 / 0); `WP49 set2` collected **34** before and after (30 / 4 → 34 / 0). Six assertions or fixtures restated, nothing added and nothing removed, and every one of the 86 previously-passing tests across the three sets still passes. Each amended site was **falsified individually** by perturbing the surface it pins and confirming it goes red, then restoring `plugin/src/testing/e2e-control.ts` byte-clean (sha256 verified identical before and after every perturbation) — harness `_falsify_b11.py`, five perturbations, all five hit their target. Two perturbations additionally turned an *untouched* sibling test red; both are independent pre-existing pins on the same genuinely-violated contract (`test_tp9`'s own `toBeNull()` on the absent-file shape, and `test_tp2`'s other test which also depends on user-origin activity marking), i.e. the pins working, not amendment damage.

  **Expected arithmetic for WP46:** the test count is **unchanged** — 674 baseline, two assertions restated, nothing added and nothing removed. Both sites go from failing to passing and no other test changes state in either direction. A handover still reporting these two as failures after the amendment lands is a stale run, not a passing state.

  <!-- Updated: E3 ruling — the migration call site is correct; the instrument that conflicts with it over-specifies its subject 2026-08-02 -->
  | WP | Assertion amended | File · line | Why it is stale rather than violated | Strictness after |
  |---|---|---|---|---|
  | WP18 (E3) | `non-empty doc + stale file → doc wins, file overwritten, NO file→CRDT read` — the `expect(tx.count()).toBe(0)` conjunct only | `plugin/src/__tests__/canvas-persistence.test.ts` | **An instrument over-specifying its subject** — the same shape B2 resolved for the WP3/WP16 conflict. The test's subject, stated in its own title, is *"NO file→CRDT read"*: it pins I3/I9, that a non-empty doc never takes the file as input. `tx.count() === 0` was a valid proxy only while a file→CRDT seed was the **sole** thing that could open a transaction on that branch. C8 AC2 requires an unstamped V1 doc arriving from the relay to be migrated, and C18 §7 TC7 pins that it happens on exactly this branch; a migration is a **doc-internal translation that reads nothing from the file**. The proxy now forbids a transaction the spec mandates, while still not pinning the property it exists to protect. | Replaced by **three** assertions, all of which must hold: `expect(tx.countWithOrigin(CANVAS_SEED_ORIGIN)).toBe(0)` — the subject, now pinned **directly** instead of by proxy; `expect(tx.countWithOrigin(CANVAS_MIGRATION_ORIGIN)).toBe(1)` — exactly one migration, not "at least one"; and `expect(tx.count()).toBe(1)` — and **nothing else** opened a transaction. Strictly stronger: it forbids everything the original forbade except the one transaction the spec now requires, and additionally pins transaction **provenance**, which nothing pinned before. Requires `migrateV1ToV2` to run its transaction under a distinct exported origin (`CANVAS_SEED_ORIGIN` already exists); a migration transacting with a bare/undefined origin fails the new assertions. Every other assertion in the test — doc wins, file overwritten with the doc's content — is untouched. |

  <!-- Updated: WP19 entry — B3c escalation ruling; AC1 retires the V1 key-removal oracle in 8 pre-existing tests, and silently vacates five green ones 2026-08-02 -->

  **WP19 entry (2026-08-02, B3c escalation ruling). LICENCE GRANTED, with three corrections and one extension.**

  **The ruling.** WP19 AC1 — *"no record's field container is destroyed by any delete path"* — turns
  deletion from an **absence** into a **value**. Every pre-existing oracle that spelled "the delete
  happened" as `nodesMap.has(id) === false` / `edgesMap.get(id) === undefined` therefore asserts the
  **pre-tombstone** semantics. This is the same shape as the WP46 and WP60/61 rulings: a chartered AC
  deliberately replaced the shape the assertion pinned. **All 8 rows are stale, none is a real
  defect** — verified row by row against the test bodies, not accepted from the ledger. In every one,
  the delete the test provokes still happens, the hand-over gating that decides *whether* it happens
  is untouched (`plan.deletes` comes from `planIntentDiff`, which WP19 did not touch), and the
  discriminating halves still pass.

  **Why the verification was done adversarially.** "The spec moved under this test" is the most
  convenient possible cover for a genuine regression, and WP19 is a **delete path**, where a
  regression means user data disappearing. The direction check is therefore stated explicitly: a
  stale row asserts *absence after a delete the test itself provokes*; a **real defect** would be a
  row asserting something still true under tombstones — e.g. that a record the user did **not**
  delete is still there. All 8 are the first kind. **The second kind exists too, and it is not in the
  8 — it is green (see the extension below).**

  **Correction 1 — it is 13 assertion lines in 8 tests, not 8 lines.** The prepared ledger says "only
  one oracle line per test is stale". That is wrong for four of the rows: rows 1, 3 and 4 each carry a
  **second** absence assertion (a `size` count or the cascaded edge), and row 8 carries **three**.
  Amending one line per test would leave those tests red and the next handover would report a
  surviving failure that looks like an unexplained defect. Every line is enumerated below.

  **Correction 2 — the two CASCADE lines must not be amended to a tombstone check.** WP19 **deleted**
  `pruneEdgesForDeletedNodes` and expresses the node→edge cascade through `buildCanvasData`'s
  `visibleNodeIds` set. A cascaded edge therefore carries **no tombstone of its own** —
  `isTombstoneSuppressed(readTombstoneEntry(deleted, "e1"))` is `false` for it. The ledger's preamble
  offers the tombstone check and the projection check as an "or"; for row 2 and the `e1` half of row 4
  the choice is **mandatory, not optional**: they become **absence from
  `buildCanvasData(nodes, edges, deleted)`**, plus a positive pin that the edge's container and every
  field value survive. An implementer following the preamble literally would write an assertion that
  is false and would then "discover" a defect that is not there.

  **Correction 3 — row 8 is a helper repair, not a line swap, and it is where a regression could
  hide.** `chaos_degraded_adapter.test.ts` reads `newRecordLocal/Peer2/Peer3` through
  `hasNode(doc, id)` (`:127-129`, consumed at `:388-390`) — raw key presence. Post-WP19 that helper
  returns `true` unconditionally, which (a) fails D2's two absence assertions and (b) **collapses D2's
  enabled-vs-disabled discrimination at `:602`**, because `on` and `off` now both read `true`. The
  repair is at the helper: redefine those three readings from *key present* to *visible in the
  projection* (present in `buildCanvasData(nodes, edges, deleted)`, equivalently not
  tombstone-suppressed). That single change fixes `:594-597` and `:598`, **restores** the discrimination
  at `:602`, and de-vacuates rows 9–11 below in the same stroke.

  | # | File · `it` line | Test title | Stale assertion line(s) | Why stale rather than violated | Strictness after |
  |---|---|---|---|---|---|
  | 1 | `plugin/src/__tests__/canvas-sync.test.ts:358` | `genuine local delete removes the node from the Y map` | `:387` `nodesMap.size).toBe(1)` · `:388` `get("n2")).toBeUndefined()` | Both are key-presence spellings of "the delete propagated". The delete still propagates — as a tombstone. The test's subject (Bug C: *a genuine local delete must still propagate*) is untouched. | `n2` tombstone-suppressed **and** absent from `buildCanvasData`, **plus** `nodesMap.size).toBe(2)` and the `n2` container still present with its field values. **Strictly stronger** — pins suppression, projection *and* AC1's non-destruction, where the old lines pinned key absence only. |
  | 2 | `plugin/src/__tests__/canvas-sync.test.ts:500` | `prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)` | `:529` `edgesMap.get("e1")).toBeUndefined()` | **Cascade row — see Correction 2.** AC3 preserves the cascade but requires it expressed "through tombstones or the suppression rule rather than key removal". The edge disappearing from the view is the subject and still holds. | `e1` **absent from `buildCanvasData(...).edges`**, and its container + every field value still present in the doc. **No tombstone assertion on `e1`** — it has none. Strictly stronger: pins the user-visible property *and* non-destruction. |
  | 3 | `plugin/src/__tests__/canvas-sync.test.ts:869` | `a genuine local DELETE of a whole record is still honoured (protection is per-key only)` | `:893` `nodesOf().get("n2")).toBeUndefined()` · `:894` `nodesOf().size).toBe(1)` | Subject is that `PROTECTED_KEYS` is a **per-key** guard and does not block a **whole-record** delete. The whole-record delete is still honoured; only its spelling changed. | `n2` tombstone-suppressed and absent from the projection; `size).toBe(2)`; container preserved. **Strictly stronger** — preservation is exactly what AC1 adds and nothing pinned it here before. |
  | 4 | `plugin/src/__tests__/w4-canvas-integrity.test.ts:331` | `A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS` | `:352` `docRecords(...,"nodes").n1).toBeUndefined()` · `:354` `docRecords(...,"edges").e1).toBeUndefined()` | As row 3 for `n1`. **`:354` is a CASCADE line — see Correction 2**: `e1` is suppressed by projection, not tombstoned. | `n1` tombstone-suppressed; `e1` absent from `buildCanvasData(...).edges`; **both containers and all field values preserved**. Strictly stronger on both halves. |
  | 5 | `plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts:219` | `T4 with the view open and a hand-over receipt, the delete still happens` | `:231-234` `nodes.has("n2")).toBe(false)` | The hand-over gating is the subject; WP19 did not touch it. The shadow half at `:235` (`getRecordState(...) === "absent"`) is **untouched and still passes**, which is the proof that the gating is unchanged. | `n2` tombstone-suppressed and absent from the projection; `:235` kept **verbatim**. Test count unchanged. |
  | 6 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:159` | `T2 after a confirmed apply the same omission is a deletion` | `:168` `nodes.has("n2")).toBe(false)` | Subject is that a confirmed apply **licenses** the omission to count as a deletion. It still does. Shadow half at `:169` untouched and still passing. | `n2` tombstone-suppressed and absent from the projection; `:169` kept **verbatim**. |
  | 7 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:172` | `T3 an interacting record is never handed over, so it cannot be deleted` | `:192` `nodes.has("n1")).toBe(false)` | The handed-over record's proven deletion. Its discriminating partner at `:193-195` still passes — **but is now vacuous; see row 12.** | `n1` tombstone-suppressed and absent from the projection. `:193-195` **must be strengthened in the same edit** (row 12), not left as-is. |
  | 8 | `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts:580` | ``D2 seam `advanceFromReceipt(..., { perFieldReceipt: false })`: the unlanded apply leaks and deletes`` | `:594-597` `off.newRecordLocal).toBe(false)` · `:598` `off.newRecordPeer2).toBe(false)` · **`:602`** `on.newRecordLocal).not.toBe(off.newRecordLocal)` | **See Correction 3 — helper repair at `:127-129`/`:388-390`, not a line swap.** With the seam disarmed the V1 defect still deletes the unseen record; it now writes a tombstone instead of removing the key, so the *reading* is stale, not the property. | `newRecord*` redefined as **visible in the projection**. All three assertions kept **verbatim** — `toBe(false)`, `toBe(false)`, `not.toBe(...)` — against the corrected reading. **Strictly stronger**: it restores a discrimination that key presence had destroyed, and it pins what the user experiences rather than a storage detail. |

  **Falsification is mandatory on row 8 and is the gate on this whole licence.** Row 8's amendment is
  licensed **only if the measurement confirms the discrimination survives**: the `off`
  (`perFieldReceipt: false`) run must show `n4` **suppressed** and the `on` run must show it
  **visible**. **If the `off` run shows `n4` still visible, the delete did not happen, D2 has caught a
  real regression in the hand-over gating, and this row is revoked** — leave it red and ESCALATE. The
  same rule applies in miniature to rows 1–7: each amended site must be shown to go red when the
  delete path it pins is perturbed. An amendment that cannot fail is worse than the failure it
  replaced (§7 amendment condition 1).

  **Extension — rows 9–14: the inverse defect WP19 caused, which is invisible because it is GREEN.**

  The 8 red rows are only half of what AC1 did. Turning deletion from an absence into a value also
  makes every oracle that proved a record was **NOT** deleted by asserting **key presence** true
  *unconditionally* — because **no delete path removes a key any more**. These tests still pass, so
  Worker 3 could not have found them by running the suite, and they are not in the ledger. They pin
  **I7** — *"a partial observation is ignorance, not deletion"* — the one invariant whose regression
  means **user data disappearing**, which is exactly the risk this escalation was raised about.
  Leaving them is the strictness loss §7 forbids; it simply arrives as a green test instead of a red
  one. **They are licensed for strengthening under the same WP19 entry** — an increase in strictness
  with no change in test count, which is inside the amendment class's own two conditions.

  | # | File · `it` line | Test title | Now-vacuous assertion | Other oracle still discriminating? | Required strengthening |
  |---|---|---|---|---|---|
  | 9 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:142` | `T1 nothing is handed over before a confirmed apply` | `:153-156` `nodes.has("n2")).toBe(true)` — *"an omission without a hand-over receipt deleted a record (I7)"* | **NO — this is the test's only oracle.** Highest priority of the five. | Add `not tombstone-suppressed` **and** present in `buildCanvasData(...)`. Keep `:153-156` verbatim as well. |
  | 10 | `plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts:201` | `T3 with the view closed, a record missing from the save is not deleted` | `:212-215` `nodes.has("n2")).toBe(true)` | Yes — shadow `getRecordState(...) === "present"` at `:216`. | Same: add the not-suppressed + present-in-projection pins. `:216` kept verbatim. This is the T3/T4 discrimination pair with row 5; **both halves must be tombstone-aware or the pair proves nothing.** |
  | 11 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:172` | `T3 an interacting record is never handed over, so it cannot be deleted` | `:193-195` `nodes.has("n2")).toBe(true)` — *"the card the user was holding was deleted by a save it never saw"* | Partially — its partner `:192` is row 7 and is being amended in the same edit. | Same pins. **Rows 7 and 11 are one edit**: after it, `n1` must be suppressed and `n2` must **not** be, which is the discrimination the test exists for. |
  | 12 | `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts:432` | `T2 a record the open view never received is not deleted by the save that omits it` | `:435-439` `newRecordLocal/Peer2/Peer3).toBe(true)` | No — all three readings come from the same vacuous `hasNode`. | **Fixed for free by Correction 3's helper repair.** Assertions kept verbatim; the reading becomes projection visibility and the test discriminates again. |
  | 13 | `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts:442` | `T3 the same degradation with the reload surface gone leaks nothing either` | `:453` `newRecordLocal).toBe(true)` | Its other assertions pin different properties (`basisAtSave`, `local`, `peer2/3`) and still discriminate; this line does not. | As row 12 — fixed by the same helper repair. |
  | 14 | `plugin/src/__tests__/v2/wp18/test_tp03_capture_boundary_rejects_invalid_new_record_visible.test.ts:79` | `a type-less new node in a save is never created; the complete new node in the same save is` | `:110` `nodes.has("n1")).toBe(true)` — *"the refusal took an unrelated record with it"* | **NO — key presence is the only oracle on `n1`.** No field read, no projection, no tombstone read. | Add `not tombstone-suppressed` **and** present in `buildCanvasData(...)`. **This is the C18-AC1-refusal-does-not-take-bystanders pin — the E2/I11 loss class** — so a refusal that "spares" a record by tombstoning it currently passes. Highest-value strengthening after row 9. |

  **Rows 9–14 are not optional and not a follow-up WP.** They are the direct consequence of AC1 and
  must land in the same WP19 amendment, for one reason: a suite in which "the record survived" cannot
  fail is a suite that will not notice the next delete-path regression. **After the amendment, the
  measurement that proves this half landed is that rows 9–14 go RED when delete suppression is
  inverted** — i.e. the fault-injection row 2 perturbation of the C23 matrix. If they stay green under
  that perturbation, the strengthening did not take and the licence is not satisfied.

  **Expected arithmetic for WP19.** The test count is **unchanged** — 13 assertion lines restated
  across 8 tests, 6 further tests strengthened, one shared helper redefined, **nothing added and
  nothing removed**. The suite goes from **1338/1346** to **1346/1346**. No test may change state in
  the other direction; if any currently-passing test outside rows 9–14 goes red, that is a real defect
  and an ESCALATE, not something to absorb into this licence.

  **Scope boundary — what AC1's word "any" does and does not reach.** AC1 says *"no record's field
  container is destroyed by **any** delete path"*, but WP19's charter scope is the **capture** delete
  path, the reconcile output, serialisation suppression and the edge cascade. Two other paths still
  remove keys and are **correctly** untouched by WP19: the `CanvasBinding` record-level delete
  (`v2/wp22/test_tp03_record_delete_is_the_only_removal_visible.test.ts:129-149`,
  `test_tp04_rig_mirror_is_upsert_only_visible.test.ts:128-135`) — frozen behind `useCanvasBinding =
  false` until WP39/WP40 — and the `e2e-control` rig mirror (`e2e-control.test.ts:249-250`), which is
  test infrastructure, not a production delete path. Those tests are green and must **stay** green;
  they are **not** covered by this licence. **This is recorded so that a later reader does not
  conclude AC1 was under-implemented, and so the binding path's eventual tombstone conversion has a
  named owner: WP39/WP40, at the point `useCanvasBinding` flips.**

  **Not covered by this licence, and deferred to WP64 with an owner.** The B3c sweep that produced
  rows 9–14 also found a **wider class**: ~8 further tests whose key-presence oracle is now vacuous but
  which retain a *partial* field-level oracle (WP18 seed/cold-open/migration tests, WP20 quarantine,
  WP23 partial-capture, WP63 withhold, `w4-canvas-integrity` A1/E1/L1), plus the **tombstone-blind
  instruments** they read through: `docRecords()` helpers that iterate the raw Yjs map and never
  consult `deleted` (`w4-canvas-integrity.test.ts:132`, `v2/wp5v2/test_tp01:99`, `test_tp05:87`,
  `test_tp06:94`) and ~10 remaining **2-arg** `serializeCanvas` / `buildCanvasData` call sites in tests,
  which suppress nothing by construction. **These are deliberately excluded from WP19** — folding them
  in would turn a bounded licence into a general permit to edit pre-existing tests, which is exactly
  what §7 exists to prevent. They are chartered as **C64 / WP64** instead. Note the asymmetry that
  makes this safe to defer but not to drop: each retains an oracle that still catches **container
  destruction**, so the P0-critical loss class is still pinned; what they can no longer catch is a
  record that survives as a **suppressed tombstone**.

  <!-- Updated: the deferral's stated REASON was false for one of the nine sites; B16 verified it per site rather than assuming it 2026-08-02 -->
  > **Correction to the sentence above (2026-08-02, measured by B16).** The conclusion holds for all
  > nine sites; the **stated reason** does not hold for one. This paragraph and the WP64 charter both
  > justify the deferral by saying each site *"retains a **field-level** check"*. At
  > `v2/wp63/test_tp02:99` that is **false**: the record `n-peer` has **no field-level assertion
  > anywhere in the test** — `expect(nodes.has("n-peer")).toBe(true)` was its entire oracle, and the
  > neighbouring `nodes.get("n-ok")?.get("x")` pins a *different* record. The deferral was still
  > **safe**, but for a weaker reason than the one given: `has()` catches outright container
  > destruction, which is the P0-critical class. What it does not catch — and what the false reason
  > wrongly implied was covered — is an **emptied container**, the record present with every field
  > stripped. That would have passed the site silently. All three gaps are now closed at that site
  > (suppression pin, projection pin, and a `text` value pin).
  >
  > **Why the correction is recorded rather than quietly fixed.** A deferral is a claim about what is
  > still protected while the work waits. Stating a *stronger* protection than exists makes the
  > deferral unreviewable: the next reader checks the reason, not the site. This is the same failure
  > the fenced-off-claim rule below governs — the fence was right, its citation was not — and per that
  > rule's condition 2 the reason is re-read against the tree rather than recalled.

  <!-- Updated: WP64 entry — the deferral above is DISCHARGED; measured counts replace the estimates 2026-08-02 -->
  **WP64 entry (B16) — the deferral above is DISCHARGED.** Full enumeration by file · line ·
  why-vacuous · post-amendment strictness is in **`ImplementationReport_WP64.md`** §§4–6; it is not
  duplicated here because it runs to 57 call sites. Summary of what was **measured**, against the
  estimates in the paragraph above:

  | Class | Estimate above | Measured | Disposition |
  |---|---|---|---|
  | Partial-oracle tests | ~8 | **9 sites** | All 9 pinned: suppression + projection beside the existing oracle, originals kept verbatim |
  | Tombstone-blind `docRecords()` helpers | 4 | **4** | `w4` keeps its helper for field-value reads and gains two tombstone-aware **siblings**; the three `wp5v2` helpers become suppression-aware |
  | 2-arg serializer call sites | ~10 | **57** | **15 converted** to 3-arg, **36 dispositioned by comment** (`wp17`, deliberate), **6 deferred untouched** (`v2/wp3`, B15 concurrency) |

  Three corrections to the paragraph above, each measured rather than inferred:

  1. **The 2-arg count is 57, not ~10** — a 5.7× underestimate. The list in the WP64 charter's §3 was
     a sample, not the population.
  2. **One named site is not a call site.** `v2/wp19/test_tp05…:21` is **prose in a header comment**;
     that file's only projection call is already 3-arg. Nothing was changed there.
  3. **"Each retains an oracle that still catches container destruction" is right, but its stated
     reason is wrong for one row.** At `v2/wp63/test_tp02:99` the record `n-peer` has **no
     field-level check at all** — `has()` alone is its oracle. Deferral was still safe (`has()` does
     catch destruction), but an *emptied container* would have passed. Now pinned explicitly.

  **Falsification (AC4).** Every strengthened site was perturbed with a **targeted injection of its
  own loss class** — never a global suppression inversion, which B14 showed can falsely certify a row
  by turning it red on a neighbour. All 10 went **RED on their own new pin**, first time, no row
  needing isolation; a bare tombstone write touches no container and no field, so it structurally
  cannot trip a neighbouring field-level oracle. In every row the **pre-existing oracle stayed
  GREEN** under the same injection, and for the `wp5v2` helper this was measured as an explicit A/B:
  repaired helper **RED**, original raw helper **GREEN** on an identical injection. Every file was
  restored and **md5-verified** byte-identical.

  **Fixture completion, enumerated** (fourth class, extended to WP64 above): `w4-canvas-integrity`
  **A1** only. Measured `nodes=[] edges=["e1"]` — its `type:"text"` nodes carry no `text`, so C18 AC1
  refused both and the test ran against an **empty node map**, which is also why its edge was pruned
  as dangling. `text` added to its three node literals; no assertion touched. **Reported, not
  edited:** the same incomplete literal appears **13×** in that file, so **A2/A3/A5/A6** are very
  likely in the same state and are outside WP64's residual list.

  **Gates:** 231 files · **1346 tests · 1346 passed · 0 failed** — count **unchanged**; `tsc` exit 0
  and `npm run build` exit 0, all measured **before** the concurrent WP24 batch landed. No production
  source changed (`plugin/src/canvas/` verified byte-identical by `diff -r`).

  <!-- Updated: fourth licensed class added by the E2 ruling — completing an invalid input fixture is neither a deletion nor an assertion rewrite 2026-08-02 -->

  <!-- Updated: extended to WP64 by the B16 run — B14's row-4 note routed this exact fixture class to "WP18/WP64", and WP64 measured a second instance of it at w4 A1 2026-08-02 -->
  <!-- Updated: WP25 was added to this class by the B4 ruling on 2026-08-04 and RE-FILED to the FIFTH class the same day, by the Dispatcher's own correction of that ruling. Reason, in one line: WP25's two blind2 ordering tests were GREEN while asserting nothing and were found by measurement — the fifth class's description verbatim — not RED on scenery, which is what this class governs. Grantee list is WP18 + WP64 again; the "extended no further" sentence below stands and is now true. The WP25 row, its demonstration and the full history of the mis-filing are kept, under the fifth class. 2026-08-04 -->
  **Fourth class, 2026-08-02 — *fixture completion* (licensed for WP18 and **WP64**).** The three classes above govern a test that *disappears*, a test whose *assertion is restated*, and a test that *could never have passed*. The E2 ruling surfaces a fourth that none of them covers: **a test whose assertions are all correct and all still meaningful, but whose input fixture is an invalid JSON Canvas record.** A body of baseline tests seeds shorthand like `{id:"n1", x:0, y:0}` — no `type`, no `width`/`height`, no type-specific payload — which is not a legal canvas node in any version of the format. C18 AC1 refuses it, correctly, and the test fails on scenery rather than on subject.

  Editing a fixture is **not** editing an assertion, and this class is deliberately narrower than it sounds:

  1. **Completion only, never reshaping.** Only the fields the JSON Canvas format requires may be added (`type`, `width`, `height`, the type-specific payload), with neutral values. Every id, coordinate, edge topology and **every value any assertion reads** stays byte-identical. Changing a value an assertion observes is a rewrite wearing a fixture's clothes and is an abort criterion.
  2. **No assertion is touched.** Not the expectation, not the matcher, not the strictness. No `skip`, no `only`.
  3. **The test count does not change**, and no test that was passing changes state in either direction.
  4. **Enumeration by name**, as for every other class: file, test title, and the exact keys added to each fixture.
  5. **Order of operations is mandatory.** The E1 and E3 corrections land and the suite is **re-measured first**; the licence then applies only to what is still red. A fixture completed for a test that E1 would have fixed anyway is an unlicensed edit — the point is to make the number of touched fixtures as small as the defect actually requires, not as large as the first measurement suggested.
  6. **Falsification.** Each completed fixture's test must be shown to still go red when the behaviour it actually pins is perturbed. Because these tests span several distinct subjects (merge, echo window, lock denial, delete paths, dangling-edge pruning), falsification is required for **at least one representative per subject family**, named in the report.
  7. **A changed outcome is an escalation, not a fix.** If completing a fixture makes a test pass for any reason other than the record now being admitted — or changes what any assertion observes — that is a real defect: leave it red and ESCALATE.

  <!-- Updated: Dispatcher ruling 2026-08-04 — this sentence still read "WP18 only" after WP64 was added to the class header and given its own enumerated row, so the closing grant contradicted the header it belongs to. Corrected to match; no scope is widened by this edit, since WP64's grant already existed above. Surfaced by the Worker 2 §7 audit, which correctly declined to tidy it unasked. -->
  This licence is granted to **WP18 and WP64 only** and expires with them. It is not precedent for editing fixtures to clear a red suite; it exists because these particular fixtures encode a document the spec has deliberately made illegal, and keeping them would mean keeping open the exact door C18 AC1 was chartered to close.

  <!-- Updated: fifth class added by the B16 ruling — a SEPARATE licence, because WP66 completes fixtures under GREEN tests and the fourth class's abort criterion is WP66's expected outcome 2026-08-02 -->
  <!-- Updated: second grantee added — WP25, RE-FILED here from the fourth class by the Dispatcher's correction of its own B4 ruling of the same day. Reason: WP25's two blind2 ordering tests were GREEN while asserting nothing and were found the fifth class's way, by a perturbation that reddened nothing — not RED on scenery. The class is therefore reframed as a class with two grantees rather than a WP66-specific carve-out, and the fourth class's "extended no further" sentence is left standing and true. The mis-filing is not deleted: it is recorded at the WP25 entry below. 2026-08-04 -->
  <!-- Updated: block relocated ahead of the WP25 entry so the entry sits under the class that now grants it; text below is otherwise unchanged apart from the grantee widening 2026-08-04 -->

  **Fifth class, 2026-08-02 — *hollow-fixture completion* (licensed for **WP66** and **WP25**).** The fourth class above is **extended no further.** It was granted to WP18 and stretched once to WP64; a third stretch would be the wrong instrument — not because that licence is nearly used up, but because **the work this class governs inverts the fourth class's expectations**:

  | | Fourth class (WP18, WP64) | **Fifth class (WP66, WP25)** |
  |---|---|---|
  | The test's state before the edit | **RED** — it fails on scenery | **GREEN** — it passes while asserting nothing |
  | What the edit is expected to do | make it pass on its subject | make it *actually run* its subject |
  | A test that **fails** after completion | **abort criterion** (fourth class, condition 7) | **the expected and valuable outcome** — escalate it, do not undo it |
  | How the population is found | the red list, already visible | **by measurement**, because a hollow fixture announces nothing |

  Condition 7 of the fourth class — *"a changed outcome is an escalation, not a fix"* — reads as an abort when a red test goes green for the wrong reason. Under this class the outcome that changes is a **green test becoming able to fail**, which is the finding the work exists to produce. Folding it into the fourth class would force a choice between neutering that abort criterion and blocking the work. A separate licence with the expectation written the right way round is the honest form. Condition 5 of the fourth class (the E1/E3 re-measure ordering) is also WP18-specific and has no analogue here.

  The fifth class inherits conditions 1–4 of the fourth **unchanged and unweakened**, and replaces 5–7:

  1. **Completion only, never reshaping** — only the fields the JSON Canvas format requires, with neutral values. Every id, coordinate, edge topology and **every value any assertion reads** stays byte-identical.
  2. **No assertion is touched** — not the expectation, not the matcher, not the strictness, not the title. No `skip`, no `only`.
  3. **The test count does not change.**
  4. **Enumeration by name** — file, line, test title, the record ids measured absent, and the exact keys added.
  5. **The population is measured, not listed.** For WP66 the licence covers whatever the C66 AC1 measurement returns across the whole suite; for WP25 it covers only the single site its entry names, established the same way — by a perturbation that reddened nothing. It does **not** authorise editing a fixture on the strength of its literal *looking* incomplete: a fixture is in scope only once the record set under assertion has been measured empty, short, or unreachable. `text: ""` is valid, and a `remoteRecord(...)` fixture is not on the refusal path at all — completing either would be an unlicensed edit made on a grep's authority.
  6. **Falsification per completed site**, targeted rather than global, red on the site's **own** named assertion, with the pre-existing-oracle result reported and any B15-style masking narrowed until the failure is attributable.
  7. **A green test that goes red is escalated, not reverted.** It is left red, reported with the measured before/after, and handed back for its own charter. Undoing the completion to restore green, or weakening the assertion, is an **abort criterion** — that green was never worth anything, and trading a discovered defect for the appearance of a passing suite is the exact transaction §7 exists to forbid. A completed site whose test stays **green** but is now demonstrably *able* to fail (WP25's case) satisfies this class as well: the demonstration, not the colour change, is what condition 6 requires.

  This licence is granted to **WP66 and WP25** and expires with them. Each grantee's scope is bounded by its own entry below and by nothing wider. It is not a general permit to edit fixtures, and it authorises no change to any **assertion** at all, nor any change to a test instrument or helper beyond the exact bound the grantee's entry names — WP64 owned the instruments and WP66 owns only the scenery, while **WP25's bound is the single gate-helper signature its entry names**, which is a gate rather than an assertion and is the reason that entry is worth more than the fixture it records.

  <!-- Updated: WP25 entry — originally written under the fourth class by the B4 Dispatcher ruling, re-filed here on the same day by the Dispatcher's own correction; measured row entered from Worker3Handover_B4_P2.md §B + _B4_P2_running_notes.md "Repair (b)" 2026-08-04 -->

  **WP25 entry (2026-08-04, B4 ruling as corrected the same day) — the fifth class takes a second grantee, bounded to one signature.** The class now covers **WP66 and WP25**. WP25's licence is bounded to **the IO double's `wait` signature in `workflowArtifacts/canvas-v2/tests/blind_set2/WP25/tp01` and nothing else** — not the visible harness, not `blind_set1`, not any other file, not any assertion anywhere. Any further WP25 fixture edit is an abort criterion exactly as an unenumerated deletion is.

  **Filing history, kept deliberately.** This entry was **first filed under the fourth class** (fixture completion) by the B4 ruling on 2026-08-04, and **re-filed here the same day** when the Dispatcher corrected that ruling on the merits: the fourth class governs a test that is **RED**, failing on scenery, whereas WP25's two `tp01` ordering tests were **GREEN while asserting nothing** and were found by measurement — the fifth class's description verbatim. The mis-filing is recorded rather than erased; a register that hides its own corrections is worth less than one that shows them. It also restores the fourth class's *"extended no further"* sentence, which the original filing contradicted on its face.

  | WP | Fixture completed | File · site | Why the fixture, not the assertion, was wrong | Strictness after · demonstration |
  |---|---|---|---|---|
  | WP25 | The gated `SidecarIO` double's blocking helper — `wait(op)` → `wait(op, path)`, evaluated as `path === sidecarIndexPath() ? undefined : gates.get(op)`, with `sidecarIndexPath` **imported from WP24** rather than re-spelled | `workflowArtifacts/canvas-v2/tests/blind_set2/WP25/test_tp01_sidecar_load_before_peer_sync_blind2.test.ts` — the `gatedIO()` helper (`:41-95` in the current tree; `wait` at `:64-68`, the two gated tests at `:216` and `:243`) | **The gate was blocking the wrong seam.** The fixture gated on a blanket `hold("exists")`, but identity resolution runs **before the doc exists**: `resolveGuidForSubscribe` → `store.bind` → `readIndex()` → `io.exists(sidecarIndexPath())`. The gate therefore stalled the subscribe **inside identity resolution** — before `getDoc`, before `waitForSync`, before the sidecar load — so `expect(sync.synced).toEqual([])` held for **every** implementation, including one that loads the sidecar long after peer sync. **Both blind2 ordering tests were vacuous, and that predates the repair.** The assertions were correct and meaningful throughout; only the scenery never let them reach their subject. Direction check, done adversarially because *"the fixture is broken"* is perfect cover for a real ordering bug: the observation channel contained the **manifest's** id, **never** `__canvas__:<guid>` — a genuine early-peer-sync defect would show the canvas doc id. | **No assertion, subject, name or count changed** — `blind_set2/WP25` collected **47** before and after, 47 passed at close; the four `it` blocks in `tp01` are untouched, and no `toMatchObject`, `objectContaining`, subset match, `skip` or `only` appears anywhere in `blind_set2/WP25` (re-verified against the current tree). **Demonstration, in the form this class requires — shown, not asserted:** *before the repair, falsification **A** (the load moved after `waitForSync`) left set2 at **47/47 green**; after the repair, falsification **A** reddens it* (**set2 45/47**, the two reds both in `tp01`, each on its own subject). Falsification **B** (the load issued but not awaited) likewise reddens it, set2 45/47. Two blind2 tests correctly stayed green under both — `lifecycle.load` driven directly, and corrupt-sidecar degradation — neither being an ordering pin; in all four perturbation runs the only reds were in `tp01`, `tp02`–`tp10` stayed green in both sets, and the red lists account for the whole difference each time. **No masking; no narrowing needed.** `canvas-sync.ts` was backed up outside the repo (never via `git checkout`, the coder's work being uncommitted), restored and sha256-verified `18a6929d…cecf8aa` identical before and after every run, zero `FALSIFY` markers, `tsc` clean. |

  **Why this row is worth more than the fixture it records — the sixth instance, and the first in a gate.** This is the **sixth distinct instance of "a green test that cannot fail"** in this run and the **first located in a *gate* rather than in an assertion**. The generalisation, which belongs to every future WP and not only to WP25: **identity resolution touches the sidecar *before* the doc exists, so any gate written against `subscribe` must name the seam it blocks.** An ordering oracle stalled at the wrong seam never reaches the ordering it claims to pin — and reports green. It was detected only because falsification A left set2 **47/47 green**: **a perturbation that changes nothing is a finding, not a null result.** The repaired fixture records this reasoning in place, in the comment block above `wait`, so the exemption cannot later be "tidied" back into a blanket gate.

  <!-- Updated: classification tension recorded at row-entry time rather than smoothed over 2026-08-04 -->
  <!-- Updated: the tension below is RESOLVED — the Dispatcher took disposition (b), re-filed the row here, and the block is kept verbatim with a resolution stamp rather than deleted, per "a ledger row is a measurement" and because a register that hides its own corrections is worth less than one that shows them 2026-08-04 -->

  > **✅ DIVERGENCE D-3 — RESOLVED 2026-08-04 by disposition (b).** The Dispatcher re-ruled on the merits and re-filed this row **out of the fourth class and into the fifth**, where it now sits, and widened the fifth class's grant from *"WP66 only"* to **WP66 and WP25**. The fourth class is restored to **WP18 + WP64** and its *"extended no further"* sentence stands and is now true. **The original divergence text is kept verbatim below** — it is the record of what was flagged and why, and deleting it would hide the correction it produced. Read everything after this line as the state **before** the re-filing.
  >
  > **⚠ DIVERGENCE — recorded, not resolved: this row sits in the fourth class by ruling, but its before-state is the fifth class's.** Two tensions, both real, neither smoothed over:
  >   1. **The fourth class's own text says it is extended no further.** The fifth-class block immediately below opens *"The fourth class above is **extended no further.** It was granted to WP18, stretched once to WP64, and a second stretch would be the wrong instrument"* (2026-08-02, B16). WP25 is that second stretch. The sentence's *stated reason* is WP66-specific — that WP66 **inverts** the fourth class's expectations — so it does not obviously reach WP25; but the sentence as written is unqualified, and this row contradicts it on its face.
  >   2. **WP25's before-state matches the fifth class's comparison table, not the fourth's.** The fourth class governs a fixture whose test is **RED** — *"it fails on scenery"*. WP25's two `tp01` ordering tests were **GREEN while asserting nothing**, which is the fifth class's row verbatim (*"GREEN — it passes while asserting nothing"* / *"make it actually run its subject"* / *"the population is found by measurement, because a hollow fixture announces nothing"*). It was found exactly that way: by a perturbation that failed to redden anything. What it does **not** share with the fifth class is condition 7's outcome — no test went red against the correct implementation; the tests stayed green and merely became **able** to fail.
  >
  > The row is filed where the Dispatcher ruled, and the ruling is not second-guessed here. But the register cannot both say *"extended no further"* and carry a further extension without a reader concluding one of them is unmaintained. **Two dispositions are open to the Dispatcher, and Worker 2 does not pick between them:** (a) qualify the "extended no further" sentence to name WP66-shaped stretches specifically, leaving WP25 inside the fourth class; or (b) re-file this row under the **fifth** class as a second grantee, which is where its before-state actually lives — noting that the fifth class is currently *"granted to WP66 only"*, so that too needs a grant. Either resolves the inconsistency; leaving both sentences standing does not.

  > **Enumeration note (condition 4), stated precisely.** `ImplementationReport_WP25.md` does **not** enumerate this repair — it records only the two *visible* `wp25/harness.ts` fixture defects (F1 `synced` never written, F2 the manifest's setup-time `waitForSync` polluting the ordering trace), which are a different, unlicensed-and-unlicensable class (fixture files with zero assertions, authored by the batch; `grep -c "expect(" harness.ts` → 0). The enumeration for **this** row lives in `Worker3Handover_B4_P2.md` §B and `_B4_P2_running_notes.md` §"Repair (b)". The condition is satisfied in substance — the repair is named by file, site, mechanism and demonstration — but **not in the artefact §7's wording points at**, and a later reader consulting only `ImplementationReport_WP25.md` will not find it. **Unverified:** the running notes record that the `tp01` fixture repairs were routed to the **test author, not the coder** (deliberate structural isolation); whether that routing covers repair (b) specifically, as distinct from repair (a), is stated nowhere and is not inferred here.

- **Blind-set execution gate (new, 2026-08-01).** <!-- Updated: the shared blind runner was found able to report a never-executed set as green; an executed-test count is now the evidence a blind set passed 2026-08-01 --> **No batch may report a blind set as passing without a recorded executed-test count greater than zero alongside it.** An exit code is not evidence. A blind run that collects zero tests is a **failed** run, never a passing one, and a handover that reports a blind set as green without its executed count is an incomplete handover rather than a passing one.

  <!-- Updated: rationale corrected — the old runner failed loudly (vitest exits 1 on zero discovery); the gate is defence-in-depth, not the fix for an observed silent pass 2026-08-01 --> The rule's original rationale said `_run_blind.py` produced a silent green because "vitest exits **0** after printing *No test files found*". **That is withdrawn — vitest 4.0.18 exits 1 on zero discovery and no config sets `passWithNoTests`.** The runner failed loudly on the three affected sets; the green counts in the handovers came from an unrecorded manual rename-and-retarget step instead. **The gate stands unchanged and is not weakened by this correction** — it is defence-in-depth against a silent-pass class this codebase happened not to have, and it is what makes the reproducibility debt visible: a green without a recorded collected count is an unreproducible claim even when it is a true one. Running WP46 blind_set1 correctly for the first time did surface a real, deterministic defect (C58) that no prior committed run had exercised.

  Required from every batch from now on, per blind set: `(WP, set, framework, tests collected, tests passed, tests failed)`. `tests collected` is the load-bearing field. C55 makes the runner emit it; this gate makes reporting it mandatory.

  **Retro-applied.** The gate is applied backwards to every blind claim made before it existed, via the C56/C57 re-verification ledger (`BlindVerificationLedger.md`). Until a `(WP, set)` pair carries a CONFIRMED verdict with a non-zero collected count in that ledger, **its blind claim is unverified regardless of what any handover says**. This explicitly includes batches already closed. A closed handover is not evidence of blind-set execution; the ledger is.

- **The fenced-off-claim rule (new, 2026-08-02).** <!-- Updated: C59 §2 fenced off an assertion on the grounds that it "passes and must keep passing"; it had never executed, and the reason given for its green described the pre-AC5 defect as a guarantee 2026-08-02 -->

  **A masked assertion is not a passing assertion.** An earlier failure in the same test body throws first and hides every assertion after it, so *"N tests fail"* systematically **undercounts** stale sites: each red test may be concealing an unknown number of further reds behind it. WP59 fenced off `edges.bare` with the words *"They pass and must keep passing."* It had never executed in any measurement anyone had taken, and greening the assertion three lines above it made it run for the first time — red.

  Two conditions now apply to any charter that declares a test or assertion out of scope **because it currently passes**:

  1. **Reachability must be established, not assumed.** The charter states how it knows the assertion executes — a passing sibling *after* it in the same test body, a per-assertion run, or an explicit note that the whole test file is currently green. An assertion that sits after a known-failing line in the same `it(...)` body may **not** be described as passing; it is *unobserved*, and the honest fence says so.
  2. **The stated reason must be re-read against the current tree, not recalled.** WP59's fence did not merely assert a false state, it gave a false *reason*: it credited `encodeEndpointFromFile` refusing to build a side-less endpoint as *"a data-preservation guarantee this WP must not disturb"*. That refusal was the **defect** WP10 AC5 had already removed — the over-constraint that read a fully-connected edge as dangling and wrote it out of the user's file. The charter protected the assertion **because of** the bug and cited the bug as the reason. When a charter names a production function as the justification for a fence, it re-reads that function's current source; a remembered contract from an earlier tree is not a citation, and a WP that has been **reopened** (as WP10 was) invalidates every recollection of its semantics.

  A fence that fails either condition is not a scope boundary — it is an untested assumption with a charter's authority behind it, which is strictly worse than no fence at all.

- **Ledger rows are measurements, not timeless facts (new, 2026-08-02).** <!-- Updated: WP3 set1 was CONFIRMED 56/56/0 by WP56 and re-measured 56/55/1 with no change to the set; the row expired when WP10 AC5 landed underneath it 2026-08-02 -->

  `BlindVerificationLedger.md` is the artefact that certifies this project's verification means something, and it was being read as a set of standing facts. It is not. **A CONFIRMED row is a measurement of one `(WP, set)` pair against one tree state at one moment**, and a later AC can retire the shape that row pinned without touching the set at all.

  **WP3 set1 is the proof, and the failure mode is worse than staleness.** WP56 measured it 56/56/0 and transcribed the count by script from `_blind_records/*.json`; B13 re-measured the untouched set at 56/55/1. **WP56 was not wrong.** The mechanism is decisive: `toV2Edge` keeps an edge's flat keys **only when the endpoint register fails to build**, so before WP10 AC5 the assertion passed *because* a side-less endpoint was refused — i.e. the row was green **on account of the very defect AC5 was written to fix**. The row did not drift; the ground moved, and the direction of the move was an improvement. A verification artefact that cannot express *"this was true of a tree that no longer exists"* will eventually be read as evidence that a fixed bug is still fixed, when what it actually records is the bug.

  **Remedy — required, and chartered as WP65.** The gap is concrete: `_blind_records/*.json` currently carries `(wp, set, framework, files_staged, tests_collected, tests_passed, tests_failed, exit_code, verdict, reason, package, depth, detail)` and **not one field that says when it was measured or against what**. File mtime is the only signal and it is overwritten on every re-run. Until WP65 lands, the following holds by rule:

  - A CONFIRMED row is evidence **only** for the tree it was measured against. It is never readable as a current pass.
  - Any batch that lands an AC **retiring a shape that existing blind sets pin** must name the `(WP, set)` pairs that plausibly pin it and re-measure them, or record explicitly that it did not. WP10 AC5's batch did neither, which is why this surfaced two batches later by accident.
  - Absence of a row is still never readable as a pass (unchanged), and now: **an old row is not readable as a pass either.**

- **Named-intermittent register (new, 2026-08-02).** <!-- Updated: B13 reported an unowned intermittent; an unattributed flake is how a real race gets dismissed twice 2026-08-02 -->

  An intermittent failure with no owner gets re-discovered, re-explained and re-dismissed by every batch that meets it — and the second dismissal is where a genuine race dies. Every observed intermittent is therefore **named, owned and given a falsification threshold** here, or it is treated as a real red.

  | Test | Observation | Owner | Ruling |
  |---|---|---|---|
  | `plugin/src/__tests__/wp5/latency.test.ts` › *harness injects a measurable RTT inside the 50–150 ms band (US6 AC1)* | Failed in **one of two** consecutive full-suite runs during B13 with no intervening change (9 fails once, 8 the other). The suite already budgets ≈41 s wall time and this file deliberately sleeps 33.5 s. | **WP65** | **ACCEPTED as a wall-clock timing flake, with a threshold that makes the acceptance falsifiable.** A hard 50–150 ms band asserted on a loaded Windows host is a scheduling measurement, not a protocol measurement. **It is not licensed to be ignored:** WP65 registers it, and if it fails **more than once in ten consecutive full-suite runs**, or **ever fails in the same run as any other `wp5` assertion**, the acceptance is void and it is escalated as a real defect in the latency harness. Until then a batch meeting it re-runs that file alone and reports both results, rather than counting it as a new red or silently dropping it from the count. |

- **Unfalsifiable-repair register (new, 2026-08-02).** <!-- Updated: B16 repaired two helpers and honestly declined to count them as verified; an unverifiable repair with no owner becomes a verified one by attrition 2026-08-02 -->

  A repair that **cannot currently be falsified** is not a failure to report — it is a claim awaiting evidence, and it is registered here with an owner rather than carried in a handover's prose. The failure mode is attrition: the third reader of a repaired-and-green site stops asking whether anything ever measured it.

  | Site | Repair | Why not falsifiable today | Owner | Ruling |
  |---|---|---|---|---|
  | `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts:99` and `test_tp06_discrimination_seam_visible.test.ts:94` — the suppression-aware `docRecords()` helpers | WP64 / B16 | **Neither fixture contains a tombstone**, so the suppression-aware form is a behaviour-preserving no-op and no injection can distinguish it from the raw helper. B16 measured this and **declined to count them as AC4 reds** — the correct call. | **WP67** | **REPAIR RETAINED, VERIFICATION OWED.** The repairs stay: the *form* was proven at `test_tp05` by an explicit A/B (repaired **RED**, raw **GREEN**, identical injection), and reverting a correct fidelity fix because it is currently inert would be worse. What is owed is a measurement at these two sites. **It must not be obtained by adding a tombstone to either fixture** — those tests' subjects are the single-shadow reload and the discrimination seam, and a tombstone changes what they are about. C67 pins the **helper** instead. Until WP67 lands, these two sites are **not** readable as verified, and no batch may cite them as evidence that the helper class is sound. |

  **DISCHARGED — WP67 / batch B17, 2026-08-02.** <!-- Updated: the owed measurement was taken; the row above is kept verbatim because a ledger row is a measurement, not a timeless fact 2026-08-02 -->
  The row above is **retained as written** — it records what was true at B16 — and is now discharged by
  measurement. Both sites are readable as **verified**, and the prohibition on citing them as evidence is lifted.

  - **The pin.** One added test per file, same name in both:
    `WP67 — this file's suppression-aware docRecords() is falsifiable > P1 docRecords omits a tombstoned
    record the raw form hands over, and keeps the live one`. It builds its **own** `Y.Doc` carrying one
    suppressed node (`n1`) and one suppressed edge (`e1`) beside a live sibling of each — **no tombstone was
    added to either existing fixture**, and lines 1–309 of `test_tp01` and 1–289 of `test_tp06` hash
    **byte-identical** to their pre-WP67 state (`382df67581d0337c79f47b4fb3fc04c8`,
    `6c4c870b570aaa8d6cc7d838126e55fb`). Every change is strictly appended below the original last line.
  - **A/B, injection A — in-file control, permanent.** Each pin carries `rawDocRecordsControl()`, the
    pre-WP64 raw key-presence form verbatim, and asserts it **does** report `n1`/`e1` on the same doc. The
    repaired helper's omission is therefore measured against a raw reading that keeps the record, not against
    a record that was never there — the pin cannot pass vacuously.
  - **A/B, injection B — perturbation, measured once per site, one file at a time.** With the helper reverted
    to the pre-WP64 form (`for (const [, record] of …)`, suppression check removed), the pin goes **RED on its
    own assertion**: `test_tp01:403` — *"a deleted node was handed to the reconcile classifier as live:
    expected [ 'n1', 'n2' ] to not include 'n1'"*; `test_tp06:386` — *"a deleted node was written into the
    receipt's desired state as live: …"*. Restored → **GREEN**. Both restorations verified by hash.
  - **The isolation result is itself the evidence B16 was right.** Under that same revert, `test_tp01`'s
    T1–T5 and `test_tp06`'s T1–T4 stayed **GREEN** — no neighbour was perturbed, no B14-style global
    certification, no B15-style masking, and the untouched originals confirm directly that these two sites
    were behaviour-preserving no-ops before the pin existed.
  - **Count.** The two files went **9 → 11** tests (+2, exactly the pins added); no existing test changed
    state in either direction. Tree at close: **244 files · 1424 tests · 1424 passed · 0 failed**,
    `npm run build` exit **0**, `tsc --noEmit` exit **0**.

- **Concurrent-batch attribution (new, 2026-08-02).** <!-- Updated: B16's gates went red mid-run from a foreign batch landing in the tree; without attribution a later reader reads another WP's in-flight state as this WP's damage 2026-08-02 -->

  **A gate measured while another batch is live in the tree records whose state it measured.** When a batch's own gates are clean and the tree's gates are not, the handover names the foreign files, the foreign batch, and the fact that **zero** of the failures fall in its own touched set — otherwise the next reader attributes the red to the closing WP, which is the one artefact that will still be there when the foreign batch has landed and the memory has not.

  **Standing attribution, B16 / WP64 (2026-08-02).** The red gates observed at the close of B16 are **batch B4's in-flight WP24 work, not WP64 regressions**, and were measured **after** WP64's own clean measurement:

  - WP64's gates, measured at 11:14 **before** WP24 landed: **231 files · 1346 tests · 1346 passed · 0 failed**, `tsc --noEmit` exit 0, `npm run build` exit 0, `plugin/src/canvas/` byte-identical by `diff -r`.
  - The tree's gates after WP24 landed at 11:14–11:16: **6 file-level collection errors**, all `Cannot find module '../../../files/canvas-sidecar'` (a production module WP24 has not written yet), collecting **zero** tests — which is why the test line still reads `1346 passed (1346)` and the count is unchanged. Plus **11 `tsc`/`build` errors, every one inside `plugin/src/__tests__/v2/wp24/`**, and **zero** in any WP64-touched file.
  - Therefore: **WP64 is not the owner of any currently-red gate.** WP24's spec-first files are red **by construction** until its production module lands, which is the intended state of a spec-first batch mid-flight, not a defect.

  **Standing attribution, B17 / WP67 (2026-08-02).** <!-- Updated: B4 landed its production module DURING B17's run, so the tree's state changed between two measurements of the same scope 2026-08-02 -->
  B16's red gates above have **cleared**, and the clearing is B4's, not WP67's — the entry is kept so a later
  reader does not read B16's standing red as still current:

  - WP67's own scope, measured directly: `test_tp01` **5 → 6** and `test_tp06` **4 → 5** tests, all green,
    with the A/B falsification recorded in the register above.
  - **First** whole-tree measurement (11:39): `244 files · 1424 tests · 1417 passed · 7 failed` in 3 files.
    One was positively identified by name — `v2/wp24/test_tp06_load_is_idempotent_visible.test.ts` — and the
    other two were **not** captured, because the log filter used truncated the failure list. That is stated
    rather than inferred: **three failed files were seen and only one was named.**
  - **Second** whole-tree measurement, minutes later (11:41): `244 files · 1424 tests · 1424 passed · 0 failed`,
    `npm run build` exit **0**, `tsc --noEmit` exit **0** — B16's 6 collection errors and 11 `tsc` errors are
    all gone. Between the two runs `plugin/src/files/canvas-sidecar.ts` — the module whose absence caused
    B16's collection errors — was written by **B4** (mtime inside the run window, a file WP67 never touched).
  - Therefore: the first run measured **B4's production source mid-write**, not a WP67 regression. WP67's
    touched set is two test files; **zero** of the failures fell inside it, and the identical count (1424) in
    both runs shows nothing was added or lost between them. The unnamed two are attributed to `v2/wp24/` **by
    the re-run, not by assumption** — the second measurement is clean, so no failure outside `v2/wp24/`
    survived it.

- **Abort criteria:**
  - `npm run build` fails, or `npm test` reports any failure.
  - <!-- Updated: blind-set execution gate 2026-08-01 --> A blind set is reported as passing with a collected-test count of zero, absent, or unrecorded; or a blind set is made to run by editing, relaxing, skipping or deleting any assertion rather than by name-only normalisation. Renaming a blind file so the runner can discover it is licensed; changing what it asserts is not, and is an abort criterion exactly as an unenumerated deletion is.
  - Test count drops without a matching entry in the deletion ledger.
  - <!-- Updated: fenced-off-claim rule 2026-08-02 --> A charter declares a test or assertion out of scope **on the grounds that it passes**, without establishing that the assertion is actually reached, or justifies the fence by citing a production contract that was not re-read against the current tree. Treat as a spec defect and ESCALATE — do not widen the amendment silently to cover what the fence got wrong.
  - <!-- Updated: WP46 amendment ledger 2026-08-01 --> An existing assertion is rewritten without a matching entry in the amendment ledger, **or** an amended assertion loses strictness (`toEqual` → `toMatchObject` / subset / `objectContaining` / key-count check / `skip` / `only`, or the added fields destructured away). Weakening a test to make a suite green is an abort, never a fix — leave it failing and escalate instead.
  - `GEOMETRY_KEYS` changes membership or loses its export (§3.1 S2) — ESCALATE instead.
  - `canvas-presence.ts` is modified (WP21 AC2 requires it byte-unchanged) — ESCALATE.
  - Logic (not wiring) is added to `main.ts` (§3.1 S11) — ESCALATE.
  - Any WP before WP39 modifies `canvas-binding.ts` / `canvas-model-bridge.ts` outside WP22's narrow removal, or any WP before WP40 flips `useCanvasBinding` — ESCALATE.
  - A new **runtime** dependency is proposed (D11), or any dependency whose published version is **less than 7 days old** is introduced (workspace npm policy). Use `npm ci` in build/deploy contexts, never `npm install`.
  - `server/` source is touched by any WP other than WP41.
  - The plugin version is bumped (it stays as found; the pre-existing 0.6.0/0.6.1 discrepancy is recorded, not resolved, here).
- **Definition of Done (project-level):** <!-- Updated: 62 WPs; DIVERGENT rows must also be resolved, not merely recorded 2026-08-01 --> <!-- Updated: 63 WPs with WP63 (I11) 2026-08-02 --> <!-- Updated: 64 WPs with WP64 (tombstone-blind test-instrument sweep) 2026-08-02 --> <!-- Updated: 66 WPs with WP66 (hollow-fixture sweep) and WP67 (falsifiability pins for the WP64 helper repairs) 2026-08-02 --> <!-- Updated: corrected to 68 by the Dispatcher 2026-08-02 — the 64→66 step counted WP66 and WP67 but silently skipped WP65, which has had a §5 component (C65) and a §9 row throughout; +WP68 (file-op rename sidecar boundary). Arithmetic: 66 as written → +WP65 (never counted) → +WP68 = 68. Found by the Worker 2 §7 audit; see the §9 count-amendment block. --> <!-- Updated: 69 with WP69 (one-shot E2E build mode + instrumented-build install) 2026-08-02 --> <!-- Updated: 70 with WP70 (gate settings provisioning + local relay lifecycle) — the shared surface and the relay the gate presupposed and nobody owned 2026-08-02 --> <!-- Updated: 73 with WP71 (agent-mediated gate execution — the rig has no launch backend), WP72 (canvas.setFlag borrow-clobber) and WP73 (matrix driver discards `applied` — seventh instance of the green-that-cannot-fail class) 2026-08-04 --> <!-- Updated: 74 with WP74 (matrix driver discards `{opened, subscribed}` and `{quiescent}` — eighth instance of the class, second in the gate's own driver, one seam over from WP73) 2026-08-04 --> <!-- Updated: 75 with WP75 (real-host signal fidelity and gate validity — `applied` is a literal on the real host and the driver discards the whole `session.info` payload; ninth instance of the class and the first to hollow a WP already reported as closed) 2026-08-04 --> all **75** WPs DONE, **including a WP66 ledger in which every hollow fixture found by measurement is either completed-and-falsified or dispositioned, and every verdict change it produced is escalated rather than absorbed**; `BlindVerificationLedger.md` complete with no `(WP, set)` pair left unverified, no VACUOUS verdict outstanding, and **no DIVERGENT row left unresolved** — each is either amended under the §7 ledger (WP59–WP61) or escalated as a real defect, and WP17 carries its rows (WP62); build + tests green with the deletion ledger accounted for; the convergence fuzzer green over its configured budget with every registered op class exercised; both chaos suites green including their discrimination variants; a green two-vault run against **real Obsidian** recorded by the T3 entrypoint (WP7, incl. its vault-fingerprint check) — <!-- Updated: the entrypoint plans and does not launch; the run is agent-mediated, so the record is the plan plus its per-step outcomes 2026-08-04 --> where, the run being **agent-mediated** (C71), "recorded by the T3 entrypoint" means the plan that entrypoint emitted, the recorded outcome of every planned step and the rig-rendered verdict, not one console transcript; and a complete `CaptureTriggerLedger.md` with no `UNCONFIRMED` entry (WP54) licensing the promotion in WP40.
- **Data-safety gate (new, 2026-08-01):** every real-Obsidian run is subject to the before/after vault fingerprint of C47 AC3. A run that leaves either of the owner's two working vaults changed outside its own scratch artefacts is a **failed** run regardless of its functional result, and is an abort criterion for the WP that performed it.
- <!-- Updated: independent restore baseline measured and entered — the C47 fingerprint is the rig checking itself; this one is not 2026-08-02 --> **Data-safety gate, second and independent leg (2026-08-02).** C47 AC3's fingerprint is taken, held and compared by the rig — it is the code under test checking its own work, and a restore path that is wrong in the same way in both directions passes it. The pre-flight therefore recorded a baseline **outside** the rig, before any gate work existed, so a post-run mismatch is provable rather than arguable:

  | Vault | `.obsidian/plugins/live-share/data.json` — sha256 of bytes, measured 2026-08-02 |
  |---|---|
  | `H:\Developement\_NeuralAngels\ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` |
  | `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` |

  **Post-teardown, both hashes must equal these values** (C50 AC6), and the comparison must not consult the rig's `data.json.e2e-original`, its `.e2e-provision.json` marker or any other rig bookkeeping — the whole value of this leg is that it does not trust them. The two hashes **differ** between the vaults, which is correct: each carries per-vault identity keys (`clientId`, `displayName`, …). Converging them is a data-safety failure, not a normalisation. **Standing rule, restated because this is where it will be tempting to break it:** both files hold live credentials (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`, `token`). Their bytes, and every value read from them, are **never** printed, logged, echoed into a report, handover or commit message, written into a test fixture, or included in an error message. Comparison is **sha256-of-bytes only**, and no MCP tool ever carries one. The same rule governs C69's `main.js` restore point: a recorded hash, never a copied artefact in the repo.
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
| WP23 | P1 | Convergence fuzzer | 3–5 replicas, pluggable ops, four assertion families **+ the AC5 intent-trace oracle** | WP17, WP19, WP20 | planned |
| **WP63** | **P1** | **Non-destructive seed boundary (I11)** | refusal at a seed boundary withholds the file write instead of dropping the record | **WP18** | **planned** |
| **WP64** | **P1** | **Tombstone-blind test-instrument sweep** | restore falsifiability to the survival oracles WP19 vacated outside its own licence; test instruments only, no production source | **WP19, WP23** | **planned** |
<!-- Updated: WP66/WP67 added by the B16 escalation ruling — a fixture class found three times by accident and never once by design, plus two repairs carried without a measurement 2026-08-02 -->
| **WP66** | **P1** | **Hollow-fixture detection sweep** | measure, suite-wide, every test asserting over a record set its own fixture never put into the doc; complete or disposition each; escalate every verdict change | **WP18, WP64** | **planned** |
| **WP67** | **P1** | **Falsifiability pins for the WP64 helper repairs** | direct A/B pins on the two `wp5v2` suppression-aware helpers whose fixtures contain no tombstone; additive only, existing fixtures byte-identical | **WP64** | **planned** |
| WP24 | P2 | Sidecar store core | append/checkpoint/truncate/load, corrupt tolerance | WP8 | planned |
| WP25 | P2 | Sidecar lifecycle + compaction | load-before-sync, update capture, GC | WP24 | planned |
| WP26 | P2 | Sidecar exclusion | excluded from manifest, sync, text-sync detection | WP24 | planned |
| WP27 | P2 | GUID identity + rename + `getDoc` guards | doc id by guid; path stays the registry key | WP8, WP24 | planned |
| WP28 | P2 | Epoch rule + conflict archive | higher epoch wins; loser archives a copy | WP27 | planned |
| WP29 | P2 | Seed-once + REMOVAL of destructive re-seed | I9 seeding rule; R4 eliminated | WP25, WP27 | planned |
| WP30 | P2 | "Import from file" command | epoch++, confirmation dialog | WP28, WP29 | planned |
<!-- Updated: WP68 added — the file-op broadcast arm of the either-side rename gate, found by WP26 and correctly declined as out of charter 2026-08-02 -->
| **WP68** | **P2** | **Sidecar exclusion at the file-op rename boundary** | the rename broadcast and its inbound admission gate refuse either-endpoint sidecar paths; refusal deletes nothing (I11) | **WP26** | **planned** |
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
<!-- Updated: WP69 added — the only E2E-capable build is the only build that never terminates, and the install step T3_SharedContract §1.1 assigned to "WP50/WP51" was never in either charter 2026-08-02 -->
| **WP69** | **P0** | **One-shot E2E build mode + instrumented-build install** | explicit `e2e` esbuild mode that terminates; production output byte-identical; reversible one-file install into both vaults | **WP43, WP44** | **planned** |
<!-- Updated: WP70 added — nothing established that the scratch folder is inside the shared surface, and nothing started the relay the gate is documented as running against 2026-08-02 -->
| **WP70** | **P0** | **Gate settings provisioning + local relay lifecycle** | the full settings key set through WP44's one borrow; shared surface pinned to the rig folder; rig-owned local relay started, probed ready, released; relay-mediated propagation distinguishable from a second sync engine | **WP43, WP44, WP47, WP69** | **planned** |
<!-- Updated: WP71 added — lifecycle.py's only console backend is PlanOnlyConsole and nothing under tools/obsidian_e2e/ spawns a process, so the gate run is agent-mediated and the mediation itself was never chartered 2026-08-04 -->
| **WP71** | **P0** | **Agent-mediated gate execution: run plan, outcomes and replay** | one ordered machine-readable plan artefact emitted before execution; exactly one recorded outcome per planned step; the rig renders the verdict; improvisation detected and refused; no process-spawn capability added | **WP45, WP48** | **planned** |
<!-- Updated: WP72 added — canvas.setFlag calls saveSettings() for any existing settings key, rewriting the data.json WP70 borrows, and returns {set:true} for any name at all 2026-08-04 -->
| **WP72** | **P0** | **`canvas.setFlag`: borrow-clobber and inert flag map** | the control surface stops rewriting the borrowed `data.json`; in-memory overrides are session-scoped and reversible; the return value stops conflating applied / refused / inert | **WP51** | **planned** |
<!-- Updated: WP73 added — _run_case discards `applied` at all eleven call sites, so an unapplied gesture leaves both snapshots equal and the case records pass; seventh instance of the green-that-cannot-fail class, in the gate's own driver 2026-08-04 -->
| **WP73** | **P0** | **Matrix driver: an unapplied gesture cannot be a pass** | `applied` consumed at all eleven `_simulate` sites; an unapplied gesture terminates the case `inconclusive` and names it; falsified by injecting `applied: false` | **WP50** | **planned** |
<!-- Updated: WP74 added — the same class one seam over from WP73: `_open`'s results are discarded at the only two opens the matrix performs, and `_wait_both` discards both `{quiescent}` answers, so a case can be decided against a canvas nothing is subscribed to and a TIMED-OUT wait is read as a settle; verified against the driver at AgenticWorkspace `50b0cf4`, after WP73 landed 2026-08-04 -->
| **WP74** | **P0** | **Matrix driver: the never-opened canvas and the timed-out wait** | `subscribed` required on both instances before the first case, refused as a run-level `inconclusive`; `{quiescent}` consumed for both instances at all ten settle sites, a timeout is `inconclusive` not `fail`; each seam falsified separately; **and an AST-asserted inventory of the whole response surface, so the class is closed rather than its latest two instances repaired** | **WP50, WP73** | **planned** |
<!-- Updated: WP75 added — the two sweep items C74 escalated rather than annexed (S1, S6), i.e. the two places where the class lands on the REAL HOST rather than on the driver: `simulateEdit` returns the literal `{applied:true}`, and the driver discards the whole `session.info` payload including the e2e build marker and both vault-identity fields; verified against liveshare `b8a541e` and AgenticWorkspace `50b0cf4` 2026-08-04 -->
| **WP75** | **P0** | **Real-host signal fidelity and gate validity** | `applied` reports whether the edit happened instead of returning a literal, with a fault distinguishable from a truthful refusal and I11 binding on the refusal; `session.info`'s own `connected` consumed and `pluginBuild`'s e2e marker required, an unmarked build refusing the run; **`vaultId`/`vaultName` distinctness between roles a and b as a gate-validity precondition checked before case 1**; the docstring corrected to the real nine-key payload; the plugin-side repair falsified against the REAL endpoint, not a fake | **WP50, WP73, WP74** | **planned** |
| WP52 | P5 | Adapter interaction tap | ordered, path-scoped signal events over the control protocol | WP39, WP46 | planned |
| WP53 | P5 | Gesture driver for the trigger set | real input-layer gestures for every claimed trigger | WP47, WP52 | planned |
| WP54 | P5 | `CAPTURE_TRIGGERS` verification + ledger | per-trigger verdict ledger; corrected mapping if measured | WP7, WP39, WP52, WP53 | planned |
| WP55 | VI | Blind-set execution integrity | runner cannot report a non-executed set as green; executed-count assertion | — | planned |
| WP56 | VI | Blind re-verification: discoverable sets | re-run WP1–WP16, WP49 under the repaired runner; create the ledger | WP55 | planned |
| WP57 | VI | Blind re-verification: non-discoverable sets | re-run WP41, WP42, WP46-TS, WP44-TS, WP47-TS and the Python sets; complete the ledger | WP55, WP56 | planned |
| WP58 | VI | Readiness probe side-effect freedom | fix the real C46 violation the vacuous runs concealed | WP55 | planned |
| WP59 | VI | WP3 round-trip blind amendment | pin WP16's V2 reader shape through the decode bridge | WP16, WP55, WP56 · **B2 closed** | planned |
| WP60 | VI | WP44 import-surface pin amendment | pin the sanctioned `{node:crypto, node:http}` builtin set | WP49, WP55, WP57 | planned |
| WP61 | VI | WP49 quiescence blind amendments | timing cluster, `session.info` shape, two unsatisfiable fixtures, `timeoutMs 0` contract | WP46, WP49, WP55, WP56, WP58 | planned |
| WP62 | VI | WP17 blind-set coverage | the one `(WP, set)` gap the sweep declared | WP55, WP56, WP57 · **B2 closed** | planned |
<!-- Updated: WP65 added by the B13 escalation ruling — a CONFIRMED row expired unnoticed 2026-08-02 -->
| WP65 | VI | Ledger row provenance + named-intermittent register | `measured_at` / `tree_rev` on every blind record; ledger states rows are not timeless; the `wp5` RTT flake gets an owner and a threshold | WP55, WP56, WP57 | planned |

<!-- Updated: WP55–WP58 added — verification-integrity phase; the blind runner could report a never-executed set as green 2026-08-01 -->
**On the blocking relationship.** WP55 blocks WP56, WP57 and WP58 absolutely: none of them produces trustworthy evidence under the broken runner, and running them first would manufacture exactly the kind of unverified green this phase exists to eliminate. WP56 precedes WP57 only because it establishes the ledger artefact and its row schema; the two do not otherwise interact. **WP58 must not be started before WP55**, because its acceptance criterion 4 requires a recorded non-zero executed count that the current runner cannot produce.

**On what this phase may invalidate.** WP56 and WP57 are chartered with an outcome that is not known in advance and may be unwelcome: a VACUOUS or DIVERGENT verdict retroactively invalidates a blind claim in an already-closed handover. That is the point of the work, not a failure of it. The batches whose claims are affected are named in the charters.

<!-- Updated: WP7 and WP40 dependencies extended onto the T3 layer 2026-08-01 -->
**Amended dependencies (2026-08-01).** Two existing rows above are superseded by this line and nothing else about them changes:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5 | WP4, WP5, **WP50, WP51** |
| WP40 | P5 | Promote op-capture to primary | WP7, WP39 | WP7, WP39, **WP54** |

<!-- Updated: WP7 gains WP69 — no live run is possible until an E2E-capable bundle exists in the vaults 2026-08-02 -->
**Amended dependencies (2026-08-02).** One further row, and one deliberate non-dependency:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5, WP50, WP51 | WP4, WP5, WP50, WP51, **WP69** |

**WP50 and WP51 deliberately do NOT depend on WP69.** Both are verified at injectable seams — WP50's driver against fake endpoints, WP51's control commands under the `plugin/` vitest gate — so neither needs an installed E2E bundle to reach `DONE`, and making them wait on one would serialise the batch behind its riskiest step for no verification gain. This is the same reasoning that keeps WP63 out of the WP19–WP23 dependency chain. **WP7 is where the dependency is real:** it is the run.

<!-- Updated: WP7 gains WP70 — the gate is documented as running against a local relay that nothing starts, and against a shared surface nothing establishes 2026-08-02 -->
**Amended dependencies (2026-08-02, second).** One further row, and one deliberate non-dependency:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5, WP50, WP51, WP69 | WP4, WP5, WP50, WP51, WP69, **WP70** |

**WP50 deliberately does NOT depend on WP70**, for the same reason it does not depend on WP69: C50 AC5 is the *detector* and is verified against fake endpoints, while C70 is the *provisioner* and is verified against fixture vaults and a local relay. Neither needs the other to reach `DONE`, and coupling them would let the provisioner's own bookkeeping become the thing the detector reads — which is exactly what C50 AC5 forbids. **WP7 is again where the dependency is real:** it is the run, and it is the only place where an unprovisioned shared surface or an absent relay can turn a green case into a false pass.

**On the count.** The decomposition target given for this run was 20–35 work packages; the honest result is 42. The drivers are structural, not stylistic: P6 is in scope (2 WPs), the Teil 14 test strategy is three separate deliverables split across the phases that make them meaningful (4 WPs), three removals are chartered separately by requirement (WP21, WP22, WP33), and the pure-core/wiring split mandated by D12 roughly doubles P1. Compressing to 35 would require re-merging pure cores with their wiring, which is exactly the property that makes these units headless-testable. The count is reported rather than hidden.

<!-- Updated: T3 amendment 2026-08-01 -->
<!-- Updated: count raised to 58 by the verification-integrity phase 2026-08-01 -->
<!-- Updated: WP63 added by the E2 ruling 2026-08-02 -->
**On the count, amended (2026-08-02).** The count is now **63**. The one added WP (**WP63**, §5 C63) is not new product scope — it closes a data-loss path that every existing AC permitted because each step in it was individually chartered and individually correct. It is chartered separately rather than folded into WP18 because it is a different boundary (the file write, not the doc write), a different invariant (I11), and because folding a safety net into the WP whose behaviour it catches would leave the net untested by construction.

<!-- Updated: count raised to 66 by the B16 escalation ruling 2026-08-02 -->
**On the count, amended again (2026-08-02).** The count is now **66**. Neither added WP is new product scope, and neither touches a production file.

**WP66** exists because one defect class has now been found **three times by accident**: B14 at `w4-canvas-integrity:352` (refused at the host seed with `MISSING_TYPE_SPECIFIC`, never red), B16 at **A1** (measured `nodes=[] edges=["e1"]` — a delete-path test running against an empty node map), and B16's report of the same incomplete literal **13×** in that one file. The mechanism is general, not local: **C18 AC1 tightened ingest validation correctly, and every fixture written against the looser rule became invalid input.** Such a fixture does not fail — its records are refused, the test asserts over nothing, and it goes **green**. No gate in §7 catches that, because every gate in §7 watches for tests that *fail*. The population is unknown and will stay unknown until it is measured, which is why WP66's first AC is a measurement rather than a fix list.

**WP66 is chartered by measurement, not by the suspected list, deliberately.** B16's own estimate error is the precedent: its charter said ~10 serializer call sites and the tree held **57**. Naming `A2/A3/A5/A6` as the scope would repeat that mistake in the other direction — a spot check of the file already shows incomplete literals **outside** that list (at `A7`, and in the `G` describe) and at least one *inside* it that is already valid (`A6`'s seed carries `text: ""`, which the validator accepts, since its only refusal test is `storedSpecific === undefined`). The four are starting points and are recorded as such.

**WP67** is small and separate on purpose. It could have been an extra AC on WP66, but its subject is a *helper*, not a fixture, and WP66's defining rule is that the test count does not change while WP67's whole deliverable is added pins. Mixing them would blur the one boundary that keeps a sweep charter from over-running.

<!-- Updated: count raised to 68 by WP68, and the WP65 omission in the previous count corrected 2026-08-02 -->
**On the count, amended again (2026-08-02) — and one correction to the previous amendment.** The count is now **68**, and the arithmetic is spelled out because the previous figure was wrong by one:

| Step | Count |
|---|---|
| "amended again" above, as written | 66 |
| **+ WP65** — chartered by the B13 escalation ruling, present in §5 as **C65** and in the table above as a row, but **never added to either count paragraph**; the 64 → 66 step counted WP66 and WP67 and skipped it | 67 |
| **+ WP68** (§5 **C68**) — the file-op broadcast arm of the sidecar leak | **68** |

**WP68 is not new product scope.** It is the second arm of the leak C26 exists to close, found by WP26's own coder, traced end to end, and correctly **declined** at the time as an unchartered widening of a three-file charter. It is chartered separately rather than reopened into WP26 because the two arms are different surfaces — manifest membership versus a peer-visible file operation — and because folding a fix into the WP whose charter did not reach it would leave the new behaviour with no criterion of its own, which is the same argument that separated WP63 from WP18.

**Not corrected here:** §7's project-level Definition of Done still reads *"all **66** WPs DONE"*. That line lives inside the §7 register and is left to the Dispatcher rather than flipped in passing, but it is now stale by two and is reported as such. <!-- Updated: discharged — the Dispatcher corrected that line to 68 on 2026-08-02, and this Worker 2 pass carried it to 69 with WP69; the paragraph is kept for the record rather than rewritten 2026-08-02 --> *(Discharged 2026-08-02: the Dispatcher corrected the §7 line to 68, and it now reads **69** with WP69. This paragraph is retained as the record of the finding, not as a live item.)*

<!-- Updated: count raised to 69 by WP69 — the one-shot E2E build mode and the instrumented-build install 2026-08-02 -->
**On the count, amended again (2026-08-02) — WP69.** The count is now **69**.

<!-- Updated: count raised to 70 by WP70 — the settings provisioning and the local relay the gate has always presupposed 2026-08-02 -->
**On the count, amended again (2026-08-02) — WP70.** The count is now **70**.

<!-- Updated: count raised to 73 by WP71, WP72 and WP73 — all three from measurements taken during batch B9b's test preparation, none of them new product scope 2026-08-04 -->
**On the count, amended again (2026-08-04) — WP71, WP72, WP73.** The count is now **73**. All three come from measurements taken while batch B9b prepared tests for WP69 and WP51; **none is new product scope**. B9b found all three **before implementing anything**, and stopped rather than record a gate result it could not obtain — which is the reason these are chartered rather than absorbed. **Nothing about the gate has been executed:** no charter here claims the gate ran, the rig works, or that any endpoint has answered, and "no endpoint has ever answered on this host" is now **measured** (both real control ports probed free, nothing listening), not inherited.

| Step | Count |
|---|---|
| "amended again — WP70" above | 70 |
| **+ WP71** (§5 **C71**) — agent-mediated gate execution: the plan, the outcomes, the replay | 71 |
| **+ WP72** (§5 **C72**) — the `canvas.setFlag` borrow-clobber and the inert flag map | 72 |
| **+ WP73** (§5 **C73**) — the matrix driver's discarded `applied` | 73 |

<!-- Updated: count raised to 74 by WP74 — the same vacuity class one seam over from WP73, found by sweeping the driver after the seventh instance rather than by a mechanism designed to catch it 2026-08-04 -->
**On the count, amended again (2026-08-04) — WP74.** The count is now **74**.

| Step | Count |
|---|---|
| "amended again — WP71, WP72, WP73" above | 73 |
| **+ WP74** (§5 **C74**) — the matrix driver's discarded `{opened, subscribed}` and `{quiescent}` | **74** |

<!-- Updated: count raised to 75 by WP75 — the two items C74's sweep escalated rather than annexed, i.e. the two places where the class lands on the real host rather than on the driver 2026-08-04 -->
**On the count, amended again (2026-08-04) — WP75.** The count is now **75**.

| Step | Count |
|---|---|
| "amended again — WP74" above | 74 |
| **+ WP75** (§5 **C75**) — real-host signal fidelity and gate validity: the constant `applied` and the discarded `session.info` payload | **75** |

**WP75 is not new product scope, and it is the first work package in this run chartered against a defect that hollows a work package already reported as closed.** C74's sweep found six items and deliberately escalated three rather than annexing them; the Dispatcher verified two and chartered them here. Both are the same class C74 named — *"a response field with no reader reads as success"* — but they land on the **real host** rather than on the driver, which is the distinction that makes them a separate component rather than a fifth and sixth criterion on C74. **WP73 is DONE and is not re-opened.** Its guard is structurally correct and every falsification of it was real; all of them, however, used **fake** endpoints that can return `applied: false`, and no real endpoint can — so **C73 AC1 is presently unfalsifiable against the real build, and it becomes meaningful only once WP75 lands.** That relation is recorded as a dependency and a cross-reference, not as a re-opening: WP73's charter was satisfied in full, and an artefact describing it as having failed is factually wrong about a closed WP.

**WP75 is chartered separately rather than folded into WP50, WP73 or WP74 for the reason this run has now used six times.** WP73 is closed and its subject is the driver's *reading* of a flag, not the host's *production* of it. WP74 explicitly excluded `plugin/**` and recorded S1 as escalated, which was correct — a WP74 that widened into the plugin's control surface would have been the unchartered widening five other WPs were held to. WP50 owns the *detector*, and C50 AC5 names the `pluginBuild` requirement without owning the payload it arrives in; splitting one payload's consumption across two work packages is how the field was lost. And **vault distinctness has its own criterion here rather than a line inside C50 AC5 because it is a gate-validity precondition, not a case-level check** — if it fails, no result from the run means anything, including the cases that passed, which is a different category from every other precondition C50 AC5 lists. Same argument that separated WP63 from WP18, WP67 from WP66, WP68 from WP26, WP69 from WP50 and WP73 from WP50.

<!-- Updated: WP7 gains WP74 and WP75 — WP74's own §9 dependency amendment was never written, and is entered here rather than back-dated 2026-08-04 -->
**Amended dependencies (2026-08-04, second) — and one omission corrected.** One row, one deliberate non-dependency, and one correction to the previous amendment block:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5, WP50, WP51, WP69, WP70, WP71, WP72, WP73 | WP4, WP5, WP50, WP51, WP69, WP70, WP71, WP72, WP73, **WP74, WP75** |

**Correction, stated rather than back-dated: WP74's own dependency amendment was never entered.** `TaskCharter_WP74` §2 states *"WP7 depends on this WP"* and C74 states that it *"must land before the gate run"*, but no §9 row was written for it, so the table above carried WP7's dependencies only as far as WP73. The row is entered here, covering WP74 and WP75 together, rather than by editing the 2026-08-04 block above — an amendment block is a record of when a decision was taken and is not rewritten after the fact (rule 5, applied to the spec's own registers).

**WP75 blocks WP7 and deliberately does NOT block WP50, and the argument is the one this spec has already made four times — with one difference.** WP50 is the *detector* charter, verified against **fake** endpoints; the plugin-side half of WP75 is a TypeScript repair in a different repository, and making WP50 wait on it would serialise a Python driver behind it for no verification gain. The driver-side half is in WP50's own file, which is why **WP75 depends on WP50 rather than the reverse**: WP50 restructures that file and a repair landed underneath it would have to be re-derived. **The difference is in how strongly it blocks WP7.** WP73 and WP74 block the run because a specific false green becomes reachable without them — they make the gate *able to detect* things. WP75 blocks it because without it a green WP7 would carry a falsifiability property it does not have (Part A: the guard its per-case verdict depends on is a check on a constant) and would be compatible with **one vault syncing with itself over a build nobody identified** (Part B). That is not a weakened gate but a vacuous one, and it is indistinguishable from a real green in the artefact. **WP75 makes the gate's result mean anything at all.** Whether WP51 or WP52 should also wait is not decided here and is not claimed.

**WP71 is a missing chartered capability, not a failure of WP43–WP49, and the distinction is load-bearing.** Those seven WPs delivered exactly what they were chartered to deliver — discovery, port provisioning, launch planning, readiness, scratch safety, teardown and the oracles are all real. **C45 AC4 forbids the rig from starting a process outside `visible-console`**, and the rig has no MCP client, so `PlanOnlyConsole` is the correct consequence of that criterion rather than an unfinished implementation of something else. What no charter ever reached is the **mediation**: the artefact that carries a whole run's plan, the feedback of each step's outcome, and the statement that the executed sequence was the planned one. Without it, C7 AC1's *"executes end to end"* has no satisfiable reading, and §7's requirement of *"a recorded, reproducible green run plus a documented invocation"* cannot be met by any command that exists. WP71 is chartered separately rather than written as procedure text in WP7 because a procedure has no acceptance criterion and nothing can falsify "the agent followed it"; reproducibility has to be carried by an artefact. The alternative — giving the rig a real spawn backend — was **evaluated and rejected**, with the argument recorded in full at C71: it contradicts a landed AC, it converts the injected-console structural guarantee protecting the owner's live vaults into a convention, and it would still leave the plan/outcome artefact necessary while hiding which steps had been improvised.

**WP72 and WP73 are live defects found by measurement, and each is chartered separately for the reason this run has now used five times.** WP72's borrow-clobber (`setFlag` → `saveSettings()` → the `data.json` C70 borrows) is named by **no** existing charter; C51 AC3 owns only the rejection of inert flags, and folding the file-write behaviour into it would leave the clobber with no criterion of its own. WP73 is the **seventh** instance in this run of *a green test that cannot fail*, and the first located in the instrument that renders the release gate's own per-case verdicts: C50 AC3 already forbids reporting a case whose gesture did not take effect as a pass, and the driver cannot honour it because it throws the `applied` flag away at all **eleven** `_simulate` call sites. **The eleven is measured and corrects a "six" in the original report** — six is the number of matrix cases, not of call sites, and a repair scoped to six would have left five gestures unchecked. That correction is itself an instance of rule 12.

<!-- Updated: WP7 gains WP71, WP72 and WP73 — the run cannot be mediated, its control surface can destroy the borrow its verdict is checked against, and its driver cannot detect an unapplied gesture 2026-08-04 -->
**Amended dependencies (2026-08-04).** One row, and one deliberate non-dependency:

| WP | Phase | Title | Depends on (was) | Depends on (now) |
|---|---|---|---|---|
| WP7 | P0 | E2E rig as mandatory gate | WP4, WP5, WP50, WP51, WP69, WP70 | WP4, WP5, WP50, WP51, WP69, WP70, **WP71, WP72, WP73** |

**WP71, WP72 and WP73 deliberately do NOT depend on each other**, and none of them depends on WP69 or WP70. WP71 is verified against a fixture plan and a fake console seam; WP72 under the `plugin/` vitest gate at the control-surface boundary; WP73 against fake endpoints that return `applied: false` on demand. **WP7 is again where every one of these dependencies is real:** it is the run, and it is the only place where an unmediated launch, a clobbered borrow or an undetected unapplied gesture turns a green case into a false pass.

**WP70 is not new product scope, and it is the second half of the same discovery that produced WP69.** The pre-flight established that the gate had no way to *build* the bundle it needs (WP69). Reading the gate's own preconditions further shows it also had no way to *connect* the two instances it builds that bundle for: WP44 provisions exactly one settings key, WP47 places the scratch canvas in a rig-owned folder, and **nothing established that the folder is inside the shared surface** — so the gate could converge on a file neither instance was syncing and report it as a pass. That is the vacuous-green class this whole run exists to eliminate, sitting on the release gate itself. In the same place, WP7 §2 states that the gate "runs against a local relay" while nothing in `tools/obsidian_e2e/` starts one and no rig module reads `serverUrl`.

**It is chartered separately rather than folded into WP44 or WP50 for three reasons.** WP44 is `DONE` and its subject is one key and a byte-exact borrow; re-opening it to provision nine more would put a new blast radius inside a landed WP whose ACs never reached it. WP50 owns the *detector* (C50 AC5) and must stay independent of the *provisioner* — a detector its own provisioner may satisfy trivially is worthless, and merging them is the one change that would make C50 AC5 unfalsifiable. And the relay is a process lifecycle with its own port, its own store paths and its own release criterion, which is a different layer from a verdict-rendering driver: §9 records that PHASE T3 was decomposed fine-grained precisely so a failure localises to one layer rather than to "the rig". This is the same argument that separated WP63 from WP18, WP67 from WP66, WP68 from WP26 and WP69 from WP50.

**WP69 is not new product scope either, and it is not a convenience.** It is a precondition the spec has always assumed and never owned: `T3_SharedContract` §1.1 states in prose that "a real run requires a **dev build** installed into the vaults" and assigns that step to "WP50/WP51" — but neither charter's scope, acceptance criteria or Definition-of-Done artefacts ever contained it, so the step had a pointer and no owner. The 2026-08-02 pre-flight then measured why it cannot simply be done in passing: the only build that sets `__LS_E2E__` true is the watch build, which never terminates, so there is no supported way to *produce* the bundle the gate needs, let alone install it. It is chartered separately rather than added to WP50 because it is the only work in this phase that edits a file whose output **ships to users**, and because its central criterion — the production bundle is byte-identical before and after — is not a statement about the run matrix at all. See the C69 note in §5 for the full argument, including why the fire-and-forget-and-kill-the-watcher alternative was rejected.

**WP63 is deliberately NOT a dependency of WP19–WP23.** It depends on WP18 and must be DONE before P1 closes, but nothing in the tombstone wiring, the quarantine auditor, the two removals or the fuzzer needs it in place first. This ordering is intentional: the P1 queue must not be serialised behind it.

**On the count, amended again (2026-08-01).** The count is now **58**. The four added WPs (§5 PHASE VI) are not new product scope — they repair the mechanism that was supposed to be verifying the other 54, and re-establish which of its historical verdicts were real. They are chartered separately rather than folded into a maintenance pass because one of them (WP57) can invalidate closed handovers, which is a finding the project must be able to cite by artefact.

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
| `INGEST REJECTED:` | new | WP18 — a local record refused at a write boundary, with boundary and reason |
| `SEED REFUSED:` / `SEED RESTORED:` | new | WP63 — file write withheld after a seed refusal / withhold lifted |
| `SIDECAR:` | new | WP24/WP25 — load, compaction, degradation |
| `EPOCH CONFLICT:` | new | WP28 — with both epoch values |
| `MODE:` | new | WP31/WP32 — mode announcement and degradation |

- **Monitoring:** the debug ring buffer plus the optional file sink remain the only observation channel; no telemetry is added. No per-frame logging in hot paths.
- **Recovery / backups:** the sidecar is the client-side recovery path; the conflict copy (`<name>.conflict-<date>.canvas`) is the user-visible archive; the relay blob store (P6) is the room-side recovery path. None of the three is a prerequisite of another.
- **Security and access rules:** the relay stays content-blind — P6 stores opaque frames and must not parse or decrypt them. No secret ever passes through an agent tool or a command string. `SERVER_PASSWORD`, `docker/.env` and the deploy stack are out of scope and must not be read. The protected NA infrastructure (`neural-angels-access`, `n8n`) is never touched.
- **Dependency policy:** zero new runtime dependencies (D11). Any dependency change requires a publish date ≥7 days old, verified with `npm view <pkg>@<version> time.created`. `npm ci` in all build/deploy contexts; `npm install` only for a deliberate local add.
- <!-- Updated: process finding from B3 — a red tree could not be handed back green because uncommitted earlier batches shared the same files 2026-08-02 --> **Snapshot discipline before the first coder attempt (mandatory).** A batch that modifies a file already carrying **uncommitted** work from an earlier batch must snapshot that file before the first coder attempt (a copy under `workflowArtifacts/canvas-v2/_snapshots/<batch>/`, not a `git stash`). B3 could not restore a green baseline because `canvas-sync.ts` and `canvas-persistence.ts` carried B2's WP16/WP17 work and B3's WP18 work in one unversioned diff, with no pre-WP18 point between them — a `git checkout` would have destroyed B2. Reverting was correctly judged more dangerous than reporting honestly, but the choice should never have been forced. **The ability to hand back a green tree is a deliverable, not a courtesy**, and it costs one file copy.
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
