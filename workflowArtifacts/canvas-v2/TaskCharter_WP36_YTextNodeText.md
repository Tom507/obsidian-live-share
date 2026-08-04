# Task Charter — WP36: `Y.Text` node text and edge labels

<!-- Updated: re-chartered 2026-08-05 (B16b) from the template-generated skeleton, against the current tree on branch `fix-bugs-and-raceconditions`, per hard-won rule 12. Every line number below was measured by reading the tree. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run. The re-charter is not cosmetic: the previous C36 AC2 ("capture uses the existing minimal-diff mechanism") specified a DEFECT, and §3 Verification 2 shows why. Under the owner's new workflow the acceptance evidence is two live Obsidian instances, not blind sets; §4 is written so that is possible. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP36
**Phase:** P4
**task_mode:** `standard`
**Depends on:** WP5 (`DONE`), WP18 (`DONE`), WP19 (`DONE`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** card text and edge labels stop being whole-string LWW registers and become nested `Y.Text` instances, so two people editing the same card merge character-wise instead of one side's text vanishing — **and the file-driven capture path stops being able to delete a character it never observed the user delete.** The second half is not a refinement of the first; it is the half that decides whether this WP is a fix or a repackaging of the same data loss.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C36** (work package **WP36**); section 4.3 (the `text` row of the field-by-field merge policy); section 4.5 invariants **I3 DOC IS TRUTH**, **I7** (capture removes nothing) and **I11 REFUSAL NEVER DESTROYS**; phase **P4**.
- **The defect this serves, in the owner's words:** *"manchmal verschluckt er noch Buchstaben."* **Read §5's ruling before assuming this WP closes it.** It does not close it alone. WP37 does. WP36 is what makes WP37's deferral non-lossy and stops the fix from moving the loss to the other peer.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: the record shape for `text`/`label`, the capture write for those two fields, the doc→file/view projection's rendering of them, and the lazy conversion of an existing plain string.
  - Scope summary: nested sequence CRDT · **three-way** shadow→save capture · explicit `Y.Text`→string render in the single projection · a per-field write router so no capture path can overwrite a `Y.Text` with a string · lazy, write-triggered migration inside schema major 2.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ Modifying `plugin/src/utils.ts`.** `applyMinimalYTextUpdate` (`:65-117`) is the raw-text sync path's writer and has other callers. WP36 neither edits it nor calls it as the writer for card text. Its surrogate-snapping boundary rule may be **re-implemented or extracted**, but the existing function's behaviour and its existing call sites stay byte-unchanged.
  - **⚠ Modifying `isRichTextValue` (`canvas/canvas-ingest-schema.ts:167-174`).** It is the guard that makes a `Y.Text` ingest-VALID and therefore un-refusable, and therefore un-deletable. Touching it re-arms the E2 cascade. It stays byte-unchanged, and so does its `NODE_TYPE_SPECIFIC` entry at `:194`.
  - **⚠ Modifying `migrateV1ToV2` or `SUPPORTED_SCHEMA_MAJOR` (`canvas/canvas-schema.ts`).** The migration's own header (`:71-76`) commits to carrying `text`/`label` through untouched precisely so both shapes survive it, and `:145-148` commits the major to `2`. WP36 keeps both promises by not touching either. A schema-major bump is an ESCALATE, never a decision taken inside this WP.
  - **A bulk conversion pass over every record in a doc.** See §3 Verification 4: it is the shape the Dispatcher already ruled against once (Ä4), and it buys nothing.
  - **The blur-merge deferral, the editing-aware busy predicate, the per-record queue.** WP37.
  - **Undo.** WP38.
  - **Binding to Obsidian's private inline editor.** Out of scope for the whole initiative (BUILD_SPEC §2, "no real-time co-typing inside one card").
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** The flag is `false` (`types.ts:65`) and frozen until P5 (WP39/WP40); flipping it or editing those two files is a §7 abort criterion. The live capture path is `handleLocalModify`.
  - **`server/**`.** Untouched — a `server/` edit outside WP41 is a §7 abort criterion.
  - **The relay, the wire protocol, the manifest, the sidecar format.** A nested `Y.Text` is an ordinary Yjs update; nothing above the doc changes.
  - **`plugin/src/canvas/canvas-presence.ts`.** Byte-unchanged (WP21 AC2).
  - **Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: `handleLocalModify` (`files/canvas-sync.ts:2736`) → `planCapture` → `applyIntentPlan` (`:2943`); the Surface-Shadow (`canvas/canvas-shadow.ts`), obtained through `CanvasSync.getSurfaceShadow()`
  - Output: `Y.Text` insert/delete ops under `V2_FIELD.text` / `V2_FIELD.label`; a string at every projection boundary
  - Depends on: **WP5** (the per-field apply receipt — it is what supplies the three-way base), **WP18** (the create-once / upsert-only capture boundary this write lives inside), **WP19** (tombstones) — all three `DONE`.
  - **Blocks:** WP37 and WP38, both of which name WP36 as a dependency.
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** registers a `text-edit` op in WP23's op registry. **Its limit is part of the requirement:** cross-replica byte equality provably cannot see this WP's central failure, because both replicas converge on the same destroyed string. The fuzzer is supporting evidence and must not be reported as the acceptance evidence.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **No C5, C17, C18 or C19 acceptance criterion is restated, weakened or re-verified.** WP36 adds a rendering step to the projection C17 owns and a routing arm to the write C18 owns. Neither changes what those mechanisms do for any value they handle today: a plain string is not a `Y.Text`, so every existing input takes the existing path unchanged.
2. **No existing test is deleted, weakened, retitled, skipped or amended.** WP36 holds **no §7 licence of any class**. If an inherited assertion goes red, that is an **ESCALATE with the measured before/after**, not a rewrite and not a fixture edit. Leaving it red and escalating is the required behaviour (§7: *"weakening a test to make a suite green is an abort, never a fix"*).
3. **`main.ts` is not modified by this WP at all.** No wiring is needed: every site is inside `files/canvas-sync.ts` and the `canvas/` modules. (WP37 is the P4 WP that touches `main.ts`, and it takes wiring only.)
4. **The one place re-opening would be tempting is named and refused.** `docValueEquals` (`canvas-sync.ts:1403`) is the natural home for a `Y.Text` arm, and adding one there would be wrong: it is a **value-equality** predicate consumed by `upsertRecordFields` (`:1434`) and by the capture write (`:3025`), and teaching it that a `Y.Text` "equals" a string would make the write silently skip real edits. The correct shape is a **routing** decision taken before the equality question is asked, not a wider equality. Stated here so the implementor does not reach for the smaller diff.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

**Verification 1 — where `text` is read and written today, exhaustively.**

| | |
|---|---|
| Field names | `V2_FIELD.text` = `"text"`, `V2_FIELD.label` = `"label"` (`canvas/canvas-registers.ts:72-73`). `label` is a member of **both** `V2_NODE_FIELD_KEYS` (`:105-106`) and `V2_EDGE_FIELD_KEYS` (`:118`) — this WP owns both. |
| Doc type today | `V2Node.text?: unknown` / `label?: unknown` (`canvas-registers.ts:145-146`), with the docstring at `:148-152`: the field *"will widen when P4 moves it to a nested `Y.Text`"* and *"a read must tolerate BOTH shapes, so no consumer may narrow it with a hard `typeof === "string"` validity assertion"*. |
| **The write — THE site** | `files/canvas-sync.ts:3025-3027`, inside `applyIntentPlan`: `if (!docValueEquals(existing.get(upsert.field), upsert.value)) { existing.set(upsert.field, upsert.value); }`. This is the whole-string LWW register. |
| The create | `buildDetachedRecord` (`canvas-sync.ts:1545-1557`) → `upsertRecordFields` (`:1420-1437`) → `record.set(key, value)`. The container is populated **while detached** and attached complete — the pattern AC1 must follow. |
| The equality gate | `docValueEquals` (`canvas-sync.ts:1403-1410`) — arms for `pos`, `size`, endpoint registers, `===` otherwise. **A string is never `===` a `Y.Text`, so with no routing the site at `:3026` fires on every single capture and replaces the `Y.Text` with a plain string.** |
| The validity gate | `validateNodeIngest` (`canvas-ingest-schema.ts:207-236`) via `NODE_TYPE_SPECIFIC.text` (`:194`) → `isRichTextValue` (`:167-174`). **It already accepts the object shape**, deliberately, and says so at `:151-166`. |
| **The read — THE site** | `toCanonicalFileRecord` (`canvas-sync.ts:869-895`): every non-`ord` key is copied `raw[key] = value` and handed to `canonicalizeRecord`. **A `Y.Text` passes through as an object.** |
| Where that projection goes | `buildCanvasData` (`:918`) → **four** consumers: `serializeCanvas` (`:971`, the disk bytes, via `CanvasPersistence` `canvas-persistence.ts:324`); `reconcileLiveCanvas` (`main.ts:1198`, the **open Obsidian view**, via `adapter.reloadCanvasData`); `getCanvasSnapshot` (`canvas-sync.ts:2055`) → the E2E `canvas.state` command (`testing/e2e-control.ts:969-972`); and `buildApplyReceipt` (`canvas-shadow.ts:795`) → `advanceFromReceipt` (`:1048`) → **the Surface-Shadow itself**. |
| The shadow's value type | `ShadowFieldValue` (`canvas-shadow.ts:76-83`) = `string \| number \| boolean \| null \| PosRegister \| SizeRegister \| EndpointRegister`. **A `Y.Text` is not a member.** |

**Verification 2 — the trap the previous AC2 specified, and why every existing oracle is blind to it.**

`applyMinimalYTextUpdate` (`plugin/src/utils.ts:65-117`) opens with `const oldContent = text.toString();` and diffs **the `Y.Text`'s own current content** against the incoming string. On the raw-text sync path that is correct, because there the incoming string *is* the merged truth. On the **canvas file-driven capture path it is not**: the incoming string is what the local `.canvas` file holds, and the local file does not contain a peer's characters that Yjs merged into the doc after this client last reconciled its view.

Worked example, both peers on the current tree with WP36 naively implemented:

```text
doc Y.Text           "Alice" + "Y" + "Bob"     ← peer B's "Y", already merged in
local .canvas file   "Alice" + "X" + "Bob"     ← this client's own save
two-way diff         prefix "Alice", suffix "Bob"  ⇒  delete "Y", insert "X"
doc after capture    "Alice" + "X" + "Bob"     ← B's character is GONE
```

The replicas converge. Byte equality holds. Strong eventual consistency holds. The fuzzer is green. **The remote user's characters are destroyed and nothing in the suite can see it** — the "green that cannot fail" class, arriving through a helper that is correct in its own home. It is why AC2 is written as a prohibition and AC3 is stated as a property of **one client's capture**, not of the converged pair.

**Verification 3 — the three-way base already exists and is already correct.**

The Surface-Shadow is *"what this client last confirmed is on the surface"*, advanced **per field and only on a confirmed apply** (`buildApplyReceipt` / `advanceFromReceipt`, `canvas-shadow.ts:795`, `:1048`; the receipt's fields come from `pass.desired`, i.e. from the projection output, so with AC4 in place they are **strings**). The capture already classifies against it — `const save = toParsedSave(...); const surface = this.surfaceStateProvider(path); const plan = this.planCapture(save, surface, tombstones);` (`canvas-sync.ts:2811-2818`). So the two operands of the three-way merge, base and local, are **both already in hand at the write site**. This WP does not need a new state store, a new snapshot, or a relative-position index in the doc. It needs the write to use the operands the plan already carried.

Consequence for the implementor: a `FieldUpsertIntent` for `text`/`label` must carry — or be resolvable to — **both** the shadow's prior string and the save's new string. Whether that is a widened intent, a second lookup at the write site, or a dedicated text-intent kind is the implementor's call. What is fixed: the ops written into the `Y.Text` are `diff(shadowString → saveString)` and never `diff(ytext.toString() → saveString)`.

**Position resolution is the one genuinely hard part, and this charter does not pretend otherwise.** The shadow→save diff yields one contiguous `(offset, deleteLen, insertString)` in **shadow coordinates**, and the `Y.Text` may have moved on. Two acceptable resolutions; the implementor picks one and **states which in the implementation report**:

- **(a) Context-anchored.** Locate the diff boundary in the current `Y.Text` by matching the shadow's unchanged prefix/suffix context; apply there. When the context cannot be located unambiguously, **do not guess** — fall back to a whole-value replace and **count the fallback**. A fallback counter that fires on most edits is the signal that the mechanism is not merging, and the report must carry the count.
- **(b) Relative positions.** Hold `Y.RelativePosition` anchors captured when the shadow was advanced. Exact, but it puts per-field state alongside the shadow and needs its own lifecycle.

Either is acceptable. **Silently doing (b)-shaped bookkeeping while writing (a)-shaped code is not**, and neither is choosing the two-way helper because it needs no anchors at all.

**Verification 4 — the migration, and why it cannot produce a refusal-then-deletion.**

The Dispatcher's Ä4 ruling (`AMENDMENT_DISPOSITION.md:160-166`) refused an amendment because *"the first V2 write deletes the flat keys in the same transaction"* leaves records with no geometry, which `validateNodeIngest` refuses, and *"the refusal composes into deletion."* The test for WP36 is whether its migration has that shape. Measured, it does not, for two independent reasons:

1. **The conversion never removes anything and never leaves the key absent.** The prescribed form is a **single** operation — `record.set(V2_FIELD.text, new Y.Text(previousString))` — not `delete` then `set` then `insert`. The key is populated at every observable instant, for every observer, on every peer. There is no window in which a reader sees a `text` node with no `text`.
   **The abort shape, written out so it cannot be arrived at by accident:** any sequence in which `text` is deleted; or set to an empty `Y.Text` that is filled afterwards; or set to a `Y.Text` attached before its content is inserted. The first is observable as `MISSING_TYPE_SPECIFIC` and **composes into deletion exactly as Ä4 does**; the others are observable as a card that briefly went empty, which is the E2 empty-file class one level down.
2. **`isRichTextValue` already accepts the object shape, and it landed for this reason.** `canvas-ingest-schema.ts:151-166` states it: *"P4 moves a node's `text` … into a nested collaborative text type WITHIN schema major 2, so a read must tolerate both … Asserting `typeof value === "string"` alone here would make the future shape invalid on ingest the day P4 lands."* A `Y.Text` under `text` is therefore **VALID** at every ingest boundary on the current build. **It is never refused, so the refusal can never compose into a deletion.** The guard is not something WP36 must build; it is something WP36 must not break — which is why editing that function is an ESCALATE.

**What an older peer actually sees, stated honestly.** The relevant "older peer" is a build carrying V2 but predating WP36. Such a peer:

- **does not refuse** the record (reason 2) — no deletion, no E2 cascade, no data loss;
- **writes the file correctly by accident** — its `toCanonicalFileRecord` copies the object through and `JSON.stringify` calls `Y.Text.prototype.toJSON`, which yields the string;
- **renders its open canvas view incorrectly** — `reconcileLiveCanvas` hands the raw object to `adapter.reloadCanvasData`, so Obsidian receives a `text` that is not a string;
- **corrupts its own Surface-Shadow** — `advanceFromReceipt` stores the object where `ShadowFieldValue` expects a string, so that peer's next capture diffs against an object.

That is a **view and capture defect on the un-upgraded peer, not a destructive one**, and it is bounded by a measured fact: the first and only installation of any V2 build was 2026-08-05 (`DISPATCHER_STATE.md`, *FIRST REAL RUN*), both vaults received the same bundle from the same tree, and `isRichTextValue` landed 2026-08-02 — i.e. **no build exists anywhere that would refuse a `Y.Text`.** The general instrument for a mixed-build room is P3's room-level mode consensus (WP31/WP32, queued, not built); gating P4 on it is **deliberately not required here**, because the population it would protect is empty and a dependency on unbuilt work is how a phase stops shipping. This is a ruling, not an oversight — **if P4 ships after a public release, it must be revisited.**

**Verification 5 — the symptom chain, which does not pass through this WP.** See §5's ruling.

- **Component(s) being changed:** the record shape for `text`/`label`; the capture write; the doc→file/view projection.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 are binding and must not be weakened. **I11 in particular:** a refusal may withhold a write, never destroy one.
  - Yjs stays. No CRDT library swap, no alternative CRDT, **and no second CRDT over a path `CanvasSync` already owns** — a nested `Y.Text` inside the record map is not the forbidden bare-path `Y.Text` of the R10 fallback, and the difference must not be blurred.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.**
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported.
  - `plugin/src/main.ts` may hold wiring only, never logic — and this WP needs none.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores import nothing from Obsidian, the filesystem or a clock; the precedent is `canvas/reconcile-plan.ts` (zero imports). The **diff** is a pure core; the **write** is not.
  - **Schema impact:** no `schemaVersion` bump. `text`/`label` change representation inside major 2. Reads must tolerate both shapes. If a tolerant read proves impossible, ESCALATE for a major bump — do not guess and do not silently coerce.
- **Entry points / relevant files:**
  - `plugin/src/files/canvas-sync.ts` — `handleLocalModify` `:2736`, `applyIntentPlan` `:2943`, the write `:3025-3027`, `docValueEquals` `:1403`, `buildDetachedRecord` `:1545`, `upsertRecordFields` `:1420`, `toCanonicalFileRecord` `:869`, `buildCanvasData` `:918`, `serializeCanvas` `:971`
  - `plugin/src/canvas/canvas-shadow.ts` — `ShadowFieldValue` `:76`, `buildApplyReceipt` `:795`, `advanceFromReceipt` `:1048`
  - `plugin/src/canvas/canvas-registers.ts` — `V2_FIELD` `:38-79`, `V2Node` `:139-153`
  - `plugin/src/canvas/canvas-ingest-schema.ts` — `isRichTextValue` `:167-174` (**read; do not edit**)
  - `plugin/src/utils.ts` — `applyMinimalYTextUpdate` `:65-117` (**read for the surrogate rule; do not edit, do not call as the writer**)
  - `plugin/src/editor/collab.ts` — the existing `Y.Text` binding pattern, reference only
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Restated from BUILD_SPEC §5 C36. Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Under the owner's workflow of 2026-08-05 the acceptance evidence is two LIVE Obsidian instances driven through the working E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}`, commands `session.info` · `canvas.open` · `canvas.state` · `canvas.file` · `sync.waitQuiescent` · `plugin.settings` — with **edits driven by writing the `.canvas` file on disk**, which is the real capture path while `useCanvasBinding` is `false`. **`canvas.simulateEdit` may not be used by any criterion**: it writes straight into the `Y.Doc` (`testing/e2e-control.ts:995-1005`) and returns a hardcoded `applied: true` (`:1023`). Unit tests remain welcome for the pure diff and are not the acceptance evidence.*

1. **The field is a `Y.Text`, created complete in one operation, and never replaced by a plain value.**
   - **Observable (live):** open the same canvas on both vaults. Write a `.canvas` on vault A whose card has non-empty `text`. After `sync.waitQuiescent`, `canvas.state` on **both** ports reports that card's `text` as the **string** (AC4), and `canvas.file` on both returns bytes whose `"text"` value is that same string. Then write A's file **again** with the text changed by one character; after quiescence both sides again report the new string. **The second write is the one that matters** — it is the capture this criterion requires *not* to have flattened the `Y.Text` back to a string.
   - **Vacuous if:** the check only ever reads the projected string, which is identical whether the doc holds a `Y.Text` or a plain string. **A string read-back alone does not satisfy this criterion.** A doc-level witness is required and is part of the deliverable: a receipt or counter emitted by the mechanism itself, reporting per captured text write whether the target was a `Y.Text` and how many insert/delete ops were emitted. A capture reporting "0 ops, whole-value set" for a card whose text changed has flattened the field, and the criterion is red however correct the string is. Equally vacuous: asserting AC1 only for a **newly created** card — the flattening happens on the **second** capture, not the first.

2. **The capture write is three-way, and the two-way helper is not the writer.**
   - **Observable (live) — the discriminating scenario of the whole WP:** with both vaults quiescent on a card whose text is `AliceBob`,
     (i) write vault B's `.canvas` with `AliceYBob`;
     (ii) `sync.waitQuiescent`, then confirm through `canvas.state` on **A** that A's doc now holds `AliceYBob`, and record A's `canvas.file` bytes showing `Y` **absent from A's file**;
     (iii) write vault A's `.canvas` with `AliceXBob` — a local save that does **not** contain `Y`;
     (iv) `sync.waitQuiescent` on both.
     **`Y` must still be present on both vaults**, in `canvas.state` and in `canvas.file`. Under the two-way helper `Y` is deleted at step (iii) and the run is red.
   - **Vacuous if — and this is exactly the precondition the new E2E suite has already got wrong once:** step (ii) is skipped or unverified, so A's doc never actually held `Y` when A's file was written, and the scenario degenerates into two sequential edits which survive under LWW too. **The recorded precondition (A's doc contained `Y`; A's file did not) is part of the criterion, not part of the write-up.** Also vacuous: placing `X` and `Y` where the diff boundaries do not overlap, which some fallbacks handle by luck — a **single-character substitution at the same offset** must be one of the runs.
   - **Static half, additionally required:** `plugin/src/utils.ts` is byte-unchanged and no call to `applyMinimalYTextUpdate` appears on any canvas capture path. Quoted in the implementation report.

3. **Concurrent editing merges character-wise, and no client's capture deletes a character it did not observe the user delete.**
   - **Observable (live):** from a common base, write both vaults' `.canvas` files within one window, each inserting a distinct marker at a distinct offset of the **same** card. After quiescence, **both markers are present on both vaults**, in `canvas.file` bytes and in `canvas.state`. Then repeat with a genuine local deletion on one side and confirm the deleted characters are gone on both — a merge that never deletes is not a merge.
   - **Vacuous if:** only convergence is asserted. **Convergence is precisely what the defect preserves.** The assertion is over *content* — both markers present — never over *agreement*. Equally vacuous: markers so far apart that any implementation succeeds; at least one run places the two edits inside the same word.

4. **The projection renders explicitly, and the render is not `JSON.stringify`'s.**
   - **Observable (live):** with a `Y.Text`-backed card, `canvas.file` on both vaults returns `.canvas` bytes in which `"text"` is a JSON string and the file parses as valid JSON Canvas; and the card **renders as text in the open Obsidian canvas view on both instances** after a remote structural change — the view is the consumer `JSON.stringify` does not cover.
   - **Vacuous if — the specific trap:** the check reads only `canvas.file` and `canvas.state`, both JSON-serialised over HTTP and therefore passing through `Y.Text.prototype.toJSON` **even when the explicit render is missing entirely**. A green there proves nothing about the two consumers that matter, the open view and the Surface-Shadow. This criterion therefore additionally requires two headless assertions — that the value handed to `reloadCanvasData` is `typeof === "string"`, and that the Surface-Shadow's stored field value after an apply is `typeof === "string"` — each shown to go **red** when the render is removed. A render whose removal changes no test is not being tested.

5. **The migration is lazy, non-destructive by construction, and `""` survives it.**
   - **Observable (live):** a card with `"text": ""` — a legal empty card, load-bearing per the E1-b ruling — is written into a `.canvas` on vault A. After quiescence: the card is **present** on vault B; `canvas.state` on both reports the `text` key **present** with value exactly `""`; `canvas.file` on both contains `"text": ""`. It is not absent, not refused, not dropped.
   - **Additionally required, headless, stated as a prohibition:** the conversion is a **single** `set` of an already-populated `Y.Text`. No branch deletes the key, attaches an empty `Y.Text` and fills it afterwards, or converts records the local user did not edit. No bulk pass exists. `migrateV1ToV2`, `SUPPORTED_SCHEMA_MAJOR` and `isRichTextValue` are byte-unchanged, quoted in the report.
   - **Vacuous if:** the empty-card check asserts a **falsy** value rather than key presence plus exact equality to `""` — `undefined`, a missing key and a dropped record are all falsy, and all three are the failure this criterion exists to catch. Equally vacuous: an "empty card survives" assertion whose fixture card is empty for the wrong reason (never written, wrong id, wrong canvas), excluded by carrying a **non-empty** card through the same run.

**Definition of Done:** concurrent card editing merges instead of one side vanishing, and no capture deletes a character it did not observe the user delete.

---

## 5. Constraints and Known Risks

### The ruling this charter owes the Dispatcher: **WP36 alone does not fix what the owner saw**

Stated plainly because it is the single most useful thing this charter carries.

The owner's symptom — *"manchmal verschluckt er noch Buchstaben"* — is produced by this chain, measured in the current tree:

| Step | Evidence |
|---|---|
| A remote change to any non-geometry field (including another card's `text`) reaches this client | `main.ts:848` → `reconcileLiveCanvas` |
| `planReconcile` classifies it `"structural"` — the non-geometry branch has no finer verdict | `canvas/reconcile-plan.ts:25`, `:112-150`, `:166-182` |
| `reconcileLiveCanvas` executes a **full** `adapter.reloadCanvasData` / `setData` | `main.ts:1198`, `:1268-1275` |
| The only protection today is `if (adapter.isBusy()) return;`, and `isBusy()` is **drag-only** | `main.ts:1212-1217`; `canvas-adapter.ts:572-580` → `dragActive()` `:318-334` |
| The reload rebuilds the view, **destroying the live inline editor and every keystroke Obsidian has not yet flushed to the file** | consequence of `setData`; Obsidian's canvas `requestSave` is debounced and is **not** in this repo |

**Neither the `Y.Text` nor the merge appears anywhere in that chain.** WP36 changes what is *stored*; the characters are lost *before* storage, in the editor. **WP37 is the WP that closes the symptom**, by making `isBusy()` editing-aware and deferring the structural apply for the edited record.

Three further rulings, recorded here because P4's three WPs must not be reported as one undifferentiated fix:

- **Is a capture-side change needed too — is this really P5's?** **No.** The debounce is real but it is not the loss mechanism. Once WP37 keeps the editor alive, the keystrokes reach the file at the next `requestSave` and the capture sees them in full; nothing is pending at the moment of destruction, because there is no destruction. **P4 is sufficient for the observed symptom and P5 is not required for it.** Bounded caveat, recorded rather than hedged: this covers text typed into a card. It does **not** cover a keystroke lost between the last save and an Obsidian **crash**, which is Obsidian's own durability boundary and is out of scope for every phase.
- **Is WP38 needed for the symptom?** **No.** No C38 criterion bears on dropped keystrokes. It is chartered because CONCEPT_V2 requires it and because it is the natural home for the undo-across-migration question — not because it closes anything the owner reported.
- **A measured limit on the whole ruling.** The plugin's own timing constants (`DEBOUNCE_MS = 200`, `MAX_WAIT_MS = 500`, `canvas-sync.ts:291-292`; `DISK_WRITE_SETTLE_MS = 250`, `canvas-persistence.ts:52`) all sit on the **doc→disk** side. The editor→file debounce belongs to Obsidian's canvas `requestSave` and **is not measurable from this tree**. The brief's framing is correct; its *window* is not a number this charter may assert, and no criterion depends on one.

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python`/`run_command` with **absolute** paths, never a Bash background process. **The two owner vaults are shared with other work** — do not restore, reinstall or reset them without checking `DISPATCHER_STATE.md` first, and never during another agent's run.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is calling `applyMinimalYTextUpdate`.** It is already in the tree, it already handles surrogates, the previous C36 AC2 named it, and it makes every convergence test green while destroying remote characters. **If the diff calls it on a canvas capture path, the WP is wrong however green its tests are.**
  - **⚠ The second most likely is forgetting the write router at `canvas-sync.ts:3025-3027`.** `docValueEquals` has no `Y.Text` arm, so the unmodified line replaces the `Y.Text` with a plain string on the **first capture after conversion** — silently un-migrating the record and discarding its history. The visible symptom is "it merged once and then stopped merging", which reads like flaky sync rather than a bug.
  - **⚠ The third is relying on `JSON.stringify`.** `Y.Text.prototype.toJSON` makes the disk bytes and the HTTP read-back correct with the explicit render entirely absent. The two consumers that then break — the open view and the Surface-Shadow — are exactly the two no JSON-shaped oracle observes. AC4's headless half exists for this and may not be dropped as redundant.
  - **⚠ The fourth is a bulk migration pass.** It looks tidier, it produces one big delta, and it is the Ä4 shape wearing a different hat. Lazy and write-triggered, per §3 Verification 4.
  - **⚠ Do not add a `Y.Text` arm to `docValueEquals`.** §2's §7 disposition, clause 4 — it makes real edits silently skip.
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5; the live capture path is `handleLocalModify`; P3's mode consensus is not built. A criterion that would only pass once P3 or P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide for every other WP. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report or a commit message, or placed in a fixture. Keys may be named; values may not. Comparison is sha256-of-bytes only.
  - **⚠ Another agent may be live in the vaults.** Coordinate through the Dispatcher before any live run.

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is `sync.waitQuiescent` or a bounded wait that names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle. A receipt asserted **in addition** to state is fine, and AC1 requires one.
  - **The E2E suite is not idempotent** — scenarios leave nodes behind and a re-run can pass or fail vacuously. Every scenario here creates its own canvas (or its own node ids) and asserts its **precondition** before its postcondition.
  - A test that asserts an absence is suspect by default. Ask what it would take for it to fail, and write that down.
- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **The capture write is three-way. `applyMinimalYTextUpdate` is not the writer and `plugin/src/utils.ts` is byte-unchanged.**
  - **`isRichTextValue`, `migrateV1ToV2` and `SUPPORTED_SCHEMA_MAJOR` are byte-unchanged.**
  - **The conversion is one operation and never leaves the key absent, nor the `Y.Text` empty-then-filled.**
  - **The projection renders `Y.Text` → string explicitly; correctness may not rest on `JSON.stringify`.**
  - **No capture path may overwrite a `Y.Text` with a plain value.**
  - **`"text": ""` stays present, valid and equal to `""`.**
  - **No bulk migration pass. No schema-major bump. No second CRDT on any path `CanvasSync` owns.**
  - **`main.ts` is not modified. No `server/**` edit. `useCanvasBinding` is not flipped. The plugin version is not bumped.**
  - **No `DONE` work package is re-opened; WP36 holds no §7 licence of any class.** An unenumerated deletion or assertion rewrite is an abort criterion; a reddened inherited assertion is an ESCALATE, left red.
  - **`canvas.simulateEdit` is not used by any criterion.** Edits are driven by writing the `.canvas` file on disk.
  - **No owner-vault file is read, hashed into a report, fixtured or named by value; no secret through any agent tool.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/canvas-sync.ts` — the write router, the three-way text write, the projection render
  - `plugin/src/canvas/` — the pure text-diff core (new file, zero imports, `reconcile-plan.ts` precedent) and any widening of the shadow/intent types needed to carry the base string
- **Already landed by Worker 2 with this charter — NOT implementor work:** the revised §5 C36 block, the revised §9 WP36 row, and the header re-derivation note (count unchanged at 79). The implementor does not edit `BUILD_SPEC_CanvasV2.md`.
- **Required report:** `ImplementationReport_WP36.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: **which position-resolution design was taken**, (a) or (b), and for (a) the **fallback count** observed across the live runs; the **AC2 live scenario in full**, including the recorded precondition (A's doc held `Y`; A's file bytes did not) and the single-character-substitution run; the **AC1 doc-level witness** output for the **second** capture, not only the first; the **AC4 headless red/green evidence** with the render removed; a quoted statement that `plugin/src/utils.ts`, `isRichTextValue`, `migrateV1ToV2` and `SUPPORTED_SCHEMA_MAJOR` are byte-unchanged; the **executed test count** before and after, with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; the `text-edit` fuzzer op registration **together with the explicit statement that the fuzzer cannot see AC3's failure mode**; and, for every live run, which vault ports were used, that no `data.json` value was read or printed, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — §5, §9 and the header note were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision**, not to a separate infrastructure WP.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
