# Shared Ownership Contract — Batch B4, Phase P2 (WP24–WP30)

> **Status:** BINDING. Authored by Worker 3 Core before the first sub-agent was spawned.
> Passed to every Unit Test Sub-Agent and every Coder Sub-Agent in this batch.
>
> **Why this file exists.** Batch B2 recorded the failure this prevents: two agents
> independently choose incompatible names, formats or constants for the same thing, both
> write self-consistent code, and *both test suites pass*. The suites cannot see the
> disagreement because neither one spans it. This has already cost this project a batch.
>
> **The rule, in one line:** where two WPs in this batch share a constant, filename, key,
> format or function, it is **defined in exactly one WP and imported by the other**. Never
> re-spelt, never re-derived, never duplicated "for clarity".

---

## 0. Execution order for this batch

Topological on the charters' `Depends on`, with shared-symbol ownership breaking the ties:

```text
WP24  ← owns the sidecar module, its directory, its filenames, its store API
 ├── WP26  ← consumes WP24's path predicate (nothing else)
 ├── WP27  ← owns doc identity + the three meta keys
 │     ├── WP25  ← consumes WP24's store API + WP27's guid
 │     └── WP28  ← consumes WP27's meta keys; owns epoch rule + conflict archive
 │           └── WP29  ← consumes WP24 + WP25 + WP27; owns the seed decision
 │                 └── WP30  ← consumes WP28's epoch bump + WP29's seed entry point
```

Run order: **WP24 → WP26 → WP27 → WP25 → WP28 → WP29 → WP30.**

WP26 is deliberately early: it is independent of everything except WP24's predicate, and
landing it early means the exclusion exists before any sidecar file is ever written by
WP25's wiring.

---

## 1. Ownership table — the binding part

| Symbol / constant / format | Owner WP | Defined in | Consumers | Consumer rule |
|---|---|---|---|---|
| `SIDECAR_DIR` | **WP24** | `plugin/src/files/canvas-sidecar.ts` | WP25, WP26, WP29 | import it; never re-spell `.obsidian/liveshare/state` |
| `SIDECAR_HISTORY_EXT` (`.yhistory`) | **WP24** | `canvas-sidecar.ts` | WP25 | import |
| `SIDECAR_CHECKPOINT_EXT` (`.ycheckpoint`) | **WP24** | `canvas-sidecar.ts` | WP25 | import |
| `SIDECAR_INDEX_FILENAME` (`index.json`) | **WP24** | `canvas-sidecar.ts` | WP25, WP27 | import |
| `isSidecarPath(path)` | **WP24** | `canvas-sidecar.ts` | **WP26** | WP26 calls this; it does **not** write its own suffix or prefix test |
| `sidecarHistoryPath(guid)` / `sidecarCheckpointPath(guid)` / `sidecarIndexPath()` | **WP24** | `canvas-sidecar.ts` | WP25 | import; WP25 never concatenates paths itself |
| `SidecarIO` (injected I/O interface) | **WP24** | `canvas-sidecar.ts` | WP25 | import |
| `SidecarStore` + `append` / `checkpoint` / `load` / `truncate` | **WP24** | `canvas-sidecar.ts` | WP25, WP29 | import |
| `SidecarLoadResult` + its degradation reporting | **WP24** | `canvas-sidecar.ts` | WP25, WP29 | import |
| `SIDECAR_COMPACTION_*` (period / horizon tunables) | **WP25** | WP25's wiring module | — | WP25 owns; document the unit in the name or a comment |
| `CANVAS_DOC_PREFIX` (**must become exported**) | **WP27** | `plugin/src/files/canvas-sync.ts` | WP25, WP28 | import; it is module-private today |
| `canvasDocId(guid)` | **WP27** | `canvas-sync.ts` | WP25, WP28, WP30 | import; nobody builds `` `${prefix}${x}` `` by hand |
| `GUID_KEY` | **WP27** | `plugin/src/canvas/canvas-schema.ts` | WP25, WP28, WP30 | import |
| `PATH_KEY` | **WP27** | `canvas-schema.ts` | WP28, WP30 | import |
| `EPOCH_KEY` | **WP27** *(defined)* | `canvas-schema.ts` | **WP28** *(owns the semantics)*, WP30 | see §2 — this split is deliberate |
| `compareEpoch(...)` + its verdict type | **WP28** | WP28's module | WP30 | import |
| `conflictCopyPath(canvasPath, date)` and the `<name>.conflict-<date>.canvas` format | **WP28** | WP28's module | WP30 | import; WP30 never formats a conflict name itself |
| the epoch-conflict log signature | **WP28** | WP28's module | WP30 | import |
| the seed decision (`decideSeed` / `SeedDecision` or equivalent) | **WP29** | WP29's module | WP30 | import |
| the "import from file" entry point that performs `epoch++` + seed | **WP30** | WP30's command module | — | WP30 owns |

### The three names that are *not* free

`canvas-schema.ts` already owns the `meta` container and its keys — `META_MAP_NAME = "meta"`
(`:101`) and `SCHEMA_VERSION_KEY = "schemaVersion"` (`:104`). The three new meta keys go
**in that same module, in that same style**, and nowhere else. Do not create a second
"meta keys" module; do not put them on `canvas-sync.ts`; do not inline the string `"guid"`,
`"epoch"` or `"path"` at any call site in this batch.

---

## 2. The one deliberate ownership split — `EPOCH_KEY`

`EPOCH_KEY` is **defined by WP27** but its **semantics are owned by WP28**. This looks like
a violation of the one-owner rule and is not; it is the rule applied precisely.

- WP27's charter §3 states the schema change adds `meta.guid`, `meta.epoch` **and**
  `meta.path` as one coherent change. Splitting the *definition* would mean WP27 lands two
  of three keys and WP28 lands the third into a module WP27 just rewrote — the exact
  interleaving that produces a merge-shaped defect.
- WP28's charter §2 puts the *epoch comparison rule* out of WP27's scope, and it stays out.

So: **WP27 defines the constant. WP28 defines what it means.** WP27 must not implement
monotonicity, comparison, host-increment or conflict handling — it declares the key and,
at most, stamps an initial value. If WP27's coder finds itself writing a comparison, it has
crossed into WP28 and must stop.

---

## 3. Test placement — the convention this repo already has

Do not invent a location. The established split in this repo is:

| Set | Location | Runs in the main suite? |
|---|---|---|
| visible | `plugin/src/__tests__/v2/wp<N>/test_<point_id>_visible.test.ts` | **yes** — counts toward the plugin total |
| blind_set1 | `workflowArtifacts/canvas-v2/tests/blind_set1/WP<N>/test_<point_id>_blind1.test.ts` | no — staged by `_run_blind.py` |
| blind_set2 | `workflowArtifacts/canvas-v2/tests/blind_set2/WP<N>/test_<point_id>_blind2.test.ts` | no — staged by `_run_blind.py` |

The `workflowArtifacts/.../tests/visible/WP4x/` folders belong to the **T3 rig** work
packages (WP41–WP49), which are Python/server-side and are not the precedent for a
plugin-code WP. WP1–WP23 are the precedent: visible tests live under
`plugin/src/__tests__/v2/wp<N>/`.

A blind set is measured **only** by `python _run_blind.py <N> both` from
`workflowArtifacts/canvas-v2/`. A blind set reported as passing without an executed,
non-zero collected count is UNVERIFIED, and `ZERO_COLLECTION` is a hard failure.

---

## 4. Stale line numbers in the charters — read this before trusting a `:NNN`

The P2 charters were written against the pre-P0/P1 tree. `canvas-sync.ts` has roughly
tripled since. **Every line number in a P2 charter is stale.** Current, verified anchors:

| Charter says | Actually is |
|---|---|
| `CANVAS_DOC_PREFIX` at `canvas-sync.ts:16` | `:93` (module-private `const`) |
| doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`, `:768` | `:1723`, `:1737`, `:1761`, `:1912`, `:1923`, `:2336` |
| `subscribe` `:360–467` | `:1754` |
| `unsubscribe` `:468–495` | `:1882` |
| `applyCanvasToYMaps` `:776–813` | `:2367–2381`, `private`, **one** caller at `:1796` |
| `coldOpen` `:310–327` | `canvas-persistence.ts:443` |
| `ColdOpenResult` `:79–83` | `canvas-persistence.ts:92–95` |
| `skipsAutoTextSync` `utils.ts:258` | `:258` — still correct |

Locate symbols **by name**, never by line. If a charter's line number and its symbol name
disagree, the name wins.

---

## 5. WP-specific notes that a sub-agent cannot derive from its own charter

### WP24 — the degradation path is the deliverable, not the happy path

AC3's "missing, truncated or corrupt sidecar is a defined degradation" is the case that
will actually happen in the field. A test suite that covers append/checkpoint/load and
treats corruption as an afterthought has tested the wrong half. Corrupt input must yield an
empty-but-valid result **and report the degradation** — never throw, never leave a
partially applied doc. "Partially applied" needs its own assertion: a doc that received
three of five updates before the fourth was found to be garbage is a *worse* outcome than a
doc that received none, because it looks healthy.

### WP26 — the exclusion has a second gate nobody has mentioned

`skipsAutoTextSync` (`utils.ts:258`) is **not** the only predicate a sidecar path meets.
`plugin/src/files/exclusion.ts` owns `ExclusionManager.isExcluded(path)`, consulted at
`manifest.ts:321`. These two are independent and unrelated — one is the canvas text-sync
skip, one is user/config exclusion from the manifest. AC1 says the exclusion is asserted
"at each of the exclusion consumers, not only at one", so the consumer set is:

- `background-sync.ts:72` (`startAll` / manifest replay)
- `background-sync.ts:195` (`onFileAdded`)
- `background-sync.ts:248` (`onFileRenamed`, on `normNew`)
- `manifest.ts:174` (`syncFromManifest`)
- **and** the `ExclusionManager` path at `manifest.ts:321` must be reasoned about explicitly

Current body is a bare `return path.endsWith(".canvas");` with a 28-line contract comment
above it enumerating the call sites. AC3 requires the sidecar exclusion in *the same style*
— one predicate, one definition, consumers enumerated in the comment. Extend that comment;
do not start a parallel one. AC4 (existing `.canvas` behaviour unchanged) needs its own
assertion, because the natural refactor here is exactly the kind that quietly widens or
narrows the `.canvas` case.

### WP27 — `getDoc` guards must be tested positively

AC4 says the two unguarded bare-path `getDoc` sites (`background-sync.ts:173`,
`collab.ts:62`) can no longer create or reach a canvas doc, "verified by an explicit test
rather than by a reachability argument". Note *why* this is still required even though
guid-based ids structurally defuse it: `__canvas__:<guid>` collides with no path, so the
confusion becomes unreachable **by construction**. That makes a naive test unable to fail —
it would pass against a completely unguarded call site. The test must therefore pin the
*guard*, not the *outcome*: it must be possible to point at the assertion and say which
line's removal turns it red. Fix the call sites anyway; a structural defence plus an
explicit guard is the ask, not either one alone.

AC3 is a **negative** AC: registries, `canvasOwned`, and the awareness field shape
including `canvasPath` all stay path-keyed and unchanged. Negative ACs are where a green
suite is most often unable to fail. Assert the path-keying survives, do not merely refrain
from breaking it.

### WP28 — do not assert a specific value across concurrent writers

The epoch rule is a comparison between two replicas. Concurrent same-key writes in Yjs are
tie-broken on `clientID`, which is `random.uint32()` — a test that asserts a specific
winner where both sides wrote concurrently passes about half the time. Assert a specific
value only where it has a single author or a causal predecessor chain. Where the contest is
genuinely symmetric, assert convergence plus membership, not identity.

AC2's archive is a **write before adopt** ordering claim. Ordering claims need an ordering
oracle: it is not enough that the conflict copy exists at the end. AC3 (equal epochs merge
normally, archive path does not trigger) is the discriminating half — without it, an
implementation that archives on *every* merge passes AC2.

### WP29 — the licence question, answered

**§7's licensed-deletion list is `WP4, WP18, WP21, WP22, WP33`. WP29 is not on it.**

Therefore: WP29 has **no licence to delete or weaken any test**. If removing the
destructive re-seed turns a test red, do **not** delete it, do **not** relax it, and do
**not** rewrite its assertion. Stop and escalate to Worker 3 Core, which will escalate to
Worker 2 for a licence. Do not assume the licence — this was called out explicitly in the
batch brief.

Two facts the charter does not know, both verified against the current tree:

1. `applyCanvasToYMaps` is `private`, has exactly **one** caller (`canvas-sync.ts:1796`,
   inside `subscribe`'s `role === "host"` block), and is named in **no** executable test
   assertion — only in four header comments. Removing the *method* by itself retires
   nothing.
2. **The destructive semantics are no longer in that method.** Its body is now four
   statements; the record-level delete-by-omission has moved into `seedFlatSpace`. The R4
   path is therefore in `seedFlatSpace`, and that is what AC2 is actually about. Deleting
   the wrapper while leaving `seedFlatSpace` destructive would satisfy the charter's
   *words* and none of its *purpose*.

Four tests exercise this path through `subscribe(path, "host")` and must be re-measured
deliberately, not just observed: `w4-canvas-integrity.test.ts:408`, and WP18's `tp01`,
`tp02`, `tp06`. Note that WP18 `tp06` is *"seed is upsert-only (I7)"* — that is WP29's own
thesis, so it should stay green and may deserve strengthening rather than amendment. A red
`tp06` means WP29's implementation is wrong, not that the test is stale.

### WP30 — the dialog text is a deliverable

AC3 requires the confirmation to name what will be overwritten **and whose work is
affected**. Generic text ("Are you sure?") does not satisfy it. Assert the content of the
message, not merely that a modal appeared.

Existing precedent to reuse rather than reinvent (`plugin/src/ui/modals.ts:76-113`):
`ConfirmModal(app, message, resolve)` delivers its result through a **resolve callback**,
not a return value, and `onClose` resolves `false` when the user dismisses without
deciding — dismissal already counts as cancel. `LiveSharePlugin.confirm(message)`
(`main.ts:1707-1712`) is the Promise wrapper. Commands register via `registerCommands`
(`session/commands.ts:7`) using `callback` for always-available and `checkCallback` for
conditional — AC4 (unavailable when unowned or degraded) is a `checkCallback` guard
returning `false`, and that guard needs its own test.

AC3's "cancelling performs no write of any kind" is the assertion most likely to be written
so it cannot fail. "No write" must be observed at the I/O boundary, not inferred from the
absence of a visible change.

---

## 6. Rules that apply to every sub-agent in this batch

1. **A green test may be unable to fail.** Where a WP changes what "absent" or "present"
   means, existing oracles may no longer discriminate. Any strengthened or amended
   assertion must be falsified by a targeted injection of the exact class it claims to
   catch, confirmed to fail on **its own** pin, with a note on whether neighbouring
   pre-existing oracles stayed green.
2. **A prior batch's amendment can mask a falsification** in the same file. If a
   perturbation reddens a different assertion first, narrow it until the intended site is
   isolated.
3. **Convergence is not correctness.** SEC, schema, byte-equality and shadow oracles have
   all gone green over a provably corrupt document in this project. If a P2 mechanism can
   be expressed as a fuzzer op class, it should be — see §7.
4. **No deletion or weakening without a named licence in §7 of the BUILD_SPEC.** The
   licensed-deletion list is `WP4, WP18, WP21, WP22, WP33`; the licensed-amendment list is
   `WP10, WP14, WP18, WP19, WP46, WP59, WP60, WP61`. **No WP in this batch is on either
   list.** An unenumerated deletion or assertion rewrite is an abort criterion.
5. **Do not touch:** `server/`, `docker/`, `deploy/`, `plugin/main.js`, `manifest.json`,
   `package.json`, `_run_blind.py`, and the two live Obsidian vaults.
6. **Concurrency.** Batch B16 (WP64) is running against pre-existing test files in this
   same tree. It changes no production source. Edits you did not make are foreign — report
   them, do not "fix" them, and measure your own scope rather than the whole tree if a
   count looks conflated.

---

## 7. Wiring P2 into the WP23 fuzzer

The fuzzer's registry is open for extension and its `intent-trace` oracle is the one that
caught what SEC, schema, bytes and shadow all missed. Harness lives in
`plugin/src/__tests__/harness/fuzz/` (`op-registry.ts`, `intent-trace.ts`, `oracle.ts`,
`standard-ops.ts`, `fuzzer.ts`).

Registering a new op class is additive and touches no existing file:

1. Build an `OpDefinition` — unique `name`, a `weight`, and a **non-empty** `reaches`
   array (an empty `reaches` fails WP23 TP06's "declares no WP coverage" assertion).
2. In `run(ctx)`: claim the slot first (`ctx.claims.claim(...)` / `claimRecord(...)`) and
   return `false` if the claim fails; mutate through `ctx.replica`; then log intent with
   `ctx.trace.write({ window, replica, opClass, slot, value, contested })`. **That trace
   entry is the only thing the oracle judges against** — an op that mutates without
   writing its intent is invisible to the oracle it was added for.
3. Attach with `createStandardRegistry().register(myOp)` and pass the registry to
   `runFuzzScenario`. Nothing in `fuzzer.ts` changes.

**Which P2 mechanisms are fuzzer-shaped:** the epoch rule (WP28) and the seed decision
(WP29) both express "which of two states wins, and what happens to the loser" — exactly
what the intent-trace oracle judges. The sidecar (WP24/WP25) is I/O lifecycle and is not
naturally a fuzz op. WP26/WP27/WP30 are structural and are not.

This is a **should**, not a gate: a WP that cannot express its mechanism as an op class
records why in its implementation report rather than forcing a bad fit.
