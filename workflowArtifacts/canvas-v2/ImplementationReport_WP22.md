# Implementation Report — WP22

**REMOVAL: `writeRecordMinimal` key deletion** · Phase P1 · `task_mode: standard`
Attempt: 1

## Status: DONE

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| 1 — `writeRecordMinimal` no longer deletes doc keys absent from the incoming record; capturing `{id}` over an existing edge leaves its endpoints intact | DONE | The absent-key sweep is gone from `canvas-binding.ts`. Pinned by TC1 (the AC verbatim: a five-key edge, a `{id}` capture, all four endpoint keys survive) and TC2 (an eight-key text card, a `{id,x,y}` drag, five unmentioned keys survive). Both carry the over-correction guard: a reported field must still land and a repeat capture must still emit **0** Yjs updates (I3). |
| 2 — deletion is possible only through an explicit delete trigger that writes a tombstone | DONE | No code change was needed: the trigger already exists (`captureLocal`, `change.record === null` ⇒ `map.delete(id)`), and removing the sweep is what makes it the *only* removal. TC3 asserts both halves — progressively emptier observations down to `{}` remove nothing, and `record: null` produces a real CRDT tombstone (replaying the record's own creation update does not resurrect it; a replica still holding the record loses it on integration). **Field-level explicit removal is deliberately not attempted** — accepted regression S14, owned by WP39 AC5 (charter §4 amendment note). |
| 3 — the `upsertRecord` mirror in the E2E control server is changed to the same semantics, so the rig cannot reproduce the old behaviour | DONE | The identical sweep is gone from `e2e-control.ts`. TC4 drives it through the public command surface (`buildPluginHost(...).simulateEdit` and `routeCommand`), not the private function. Proven load-bearing: reverting **only** the mirror turns TC4 red while TC1–TC3 stay green (falsification F3 below). |
| 4 — `useCanvasBinding` remains `false` and the binding stays dormant | DONE | `plugin/src/types.ts:65` is byte-unchanged (`git diff` on that file shows no `useCanvasBinding` hunk). TC5 pins the default from the module *and* the literal, and proves the single `new CanvasBinding(` site in `main.ts` is lexically inside `if (this.settings.useCanvasBinding) {` via a brace-depth walk. |

---

## DELETION LEDGER

**No deletions were required.**

The full suite was run before implementation (1300 tests / 215 files, 8 failed) and after
(1316 tests / 220 files, 8 failed). **The failing set is identical** — the eight WP19-caused
legacy-delete-oracle reds, listed under *Full-suite gate* below. **No pre-existing test
anywhere in the tree pinned the removed key-deletion behaviour**, so BUILD_SPEC §7's
licensed-deletion entry for WP22 is exercised as an empty ledger.

That was checked, not assumed:
- The whole suite passes with the sweep removed — a test pinning it would have gone red.
- `plugin/src/__tests__/**` was searched for `writeRecordMinimal`; the only two hits are
  prose (`v2/wp2/test_tp02_upsert_on_difference_visible.test.ts:11` names it as the
  behaviour that *must not reappear* — i.e. it pins the new semantics, not the old, and it
  is green) and this WP's own files.
- The four `canvas-binding*` test files (`canvas-binding.test.ts`,
  `canvas-binding-apply.test.ts`, `canvas-binding-capture.test.ts`, plus `canvas-matrix`)
  contain no partial-capture-then-absence assertion; their delete oracles are all
  record-level (`T9 add/remove`, `captures a local node DELETE`), which is the behaviour
  AC2 preserves.

## Amendment candidates NOT acted on (reported, not edited)

**None found.** WP22 is not on BUILD_SPEC §7's licensed-amendment list, so any surviving
test whose oracle spelling had gone stale would have been reported here rather than
edited. No such test exists: the removal changed no shape that an existing assertion
pins. **Zero pre-existing test files were modified by this WP.**

One item worth flagging as *information only*, not an amendment candidate:
- `plugin/src/canvas/canvas-binding.ts:92–94` still says the local helpers' "semantics MUST
  match canvas-sync.ts `canvasRecordsEqual` / `applyKeyDiff`". That is still true in
  substance — `canvas-sync.ts`'s write path became upsert-only under WP4/WP18
  (`upsertRecordFields()` — "upsert only, never delete") — so the two sides are now aligned
  *more* closely than before, not less. Left byte-unchanged under the file freeze.

---

## Changes Made

Two production files, both named in charter §6. Nothing else in `plugin/src/` was touched.

**1. `plugin/src/canvas/canvas-binding.ts` — `writeRecordMinimal` (`:126`)**

Removed the absent-key sweep:

```ts
  // Snapshot keys first — deleting while iterating a Y.Map is unsafe.
  for (const key of [...ymap.keys()]) {
    if (!(key in next)) {
      ymap.delete(key);
      changed = true;
    }
  }
```

The function is now: set each key of `next` whose value differs, return whether anything
changed. Its doc comment was restated to say *why* — a capture is a partial observation,
so absence carries no intent — and to point at the surviving record-level trigger and at
S14 / WP39 AC5 for field-level removal.

Untouched in the same file: the upsert loop, the `changed` return (I3 — an empty diff
still produces no Yjs update), `CANVAS_BINDING_ORIGIN`, `captureLocal`'s `record === null`
delete branch, the `canWrite` / `canWriteNode` / `canDeleteNode` options (WP21 removed only
their `main.ts` wiring; the options are not this WP's to remove), `applyRemote`, `destroy`,
the instrumentation seam, and every export.

**2. `plugin/src/testing/e2e-control.ts` — `upsertRecord` (`:656`)**

Removed the byte-identical mirror of that sweep:

```ts
  for (const k of [...ymap.keys()]) {
    if (!(k in record)) ymap.delete(k);
  }
```

Doc comment restated to record that this is AC3 and that the rig keeps its **explicit**
removals (`simulateEdit`'s `removeNodes` / `removeEdges`) — what is gone is deletion by
omission. `simulateEdit`, `routeCommand`, `buildPluginHost` and the WP46/47/49 surfaces are
untouched.

**Not touched:** `canvas-model-bridge.ts` (frozen), `canvas-presence.ts` (byte-unchanged),
`canvas-sync.ts` (its key-deletion was already closed by WP4/WP18 — the charter's amendment
note says finding nothing there is the expected state, and nothing was "fixed"),
`types.ts`, `main.ts`, `GEOMETRY_KEYS` (still exactly `{x,y,width,height}`, still exported),
`server/`, `docker/`, `deploy/`, `plugin/main.js`, `plugin/manifest.json` (never read),
`package.json`. No version bump. **Zero new dependencies** — the tests import only `vitest`,
`yjs` and `node:fs`, all already present.

**New test files (10 + 5 = 15, all additions):**

```text
plugin/src/__tests__/v2/wp22/
├── test_tp01_partial_edge_capture_keeps_endpoints_visible.test.ts        ← 3 tests
├── test_tp02_multi_field_partial_capture_preserves_rest_visible.test.ts  ← 3 tests
├── test_tp03_record_delete_is_the_only_removal_visible.test.ts           ← 3 tests
├── test_tp04_rig_mirror_is_upsert_only_visible.test.ts                   ← 4 tests
└── test_tp05_binding_stays_dormant_visible.test.ts                       ← 3 tests

workflowArtifacts/canvas-v2/tests/blind_set1/WP22/   ← 5 files, 13 tests
workflowArtifacts/canvas-v2/tests/blind_set2/WP22/   ← 5 files, 14 tests
```

Blind sets differ from the visible tests in fixture, entry point and angle of attack, not
in wording: set 1 goes through the model's `onLocalChange` subscription and judges by key
*set*, drives the rig through `parseAndRoute` with a raw JSON body, counts every `Y.Map`
delete event the doc emits across a mixed workload, and requires the rig and the binding to
converge on **byte-equal content** from an identical sequence of partial edits. Set 2
enumerates all 2^5 subsets of an edge's keys, interleaves partial captures with remote
deltas and asserts the *model projection*, tests the delete trigger's full lifecycle
(create → delete → re-create, so a tombstone cannot become an id ban), and pins
`canvas-binding.ts`'s runtime export surface as an exact set.

---

## Visible Test Results

Command: `npx vitest run src/__tests__/v2/wp22` from `plugin/`.

| Test | Status | Notes |
|---|---|---|
| TC1 · capturing `{id}` over a connected edge leaves all four endpoint keys intact | PASS | RED before implementation: `` `fromNode` was deleted by a capture that never mentioned it — R1 is still live: expected undefined to be 'alpha' `` |
| TC1 · that same capture is still an EMPTY diff | PASS | RED before: `expected 1 to be +0` — the sweep itself was emitting the update. Over-correction guard. |
| TC1 · a partial capture with a new value upserts it and every replica keeps the endpoints | PASS | RED before: `expected { id: 'e1', color: '3' } to deeply equal { id: 'e1', fromNode: 'alpha', …(4) }`. Three replicas. |
| TC2 · a drag reporting only x and y leaves type, text, colour and size untouched | PASS | RED before: `expected { id: 'card', x: 140, y: 260 } to deeply equal { id: 'card', type: 'text', …(6) }` |
| TC2 · the write stays minimal: one origin update for a real change, none for a repeat | PASS | Green before **and** after — the over-correction guard for I3. |
| TC2 · a partial capture still ADDS a key the doc has never held | PASS | RED before: `expected { id: 'card', color: '2', …(1) } to deeply equal { id: 'card', x: 1, y: 2, …(2) }` — the sweep ate `x`/`y` while adding the new keys. |
| TC3 · no partial capture removes a key, down to a capture reporting nothing at all | PASS | RED before, on the *second* shape already: `a capture of {"id":"w","x":0,"y":0} removed a key from the record` |
| TC3 · `record: null` deletes the whole record and the deletion is a tombstone | PASS | Green before and after — AC2's surviving trigger, pinned so the removal cannot take it too. |
| TC3 · a capture for a record that does not exist creates it | PASS | Green before and after — over-correction guard. |
| TC4 · `canvas.simulateEdit` with a partial edge leaves the endpoints connected | PASS | RED before: `the rig deleted the endpoints of an edge it only mentioned by id — R1 is reproducible from the control channel` |
| TC4 · a partial node edit through the router upserts the reported fields and keeps the rest | PASS | RED before: `expected { id: 'sensor', x: 555 } to deeply equal { id: 'sensor', type: 'text', …(5) }` |
| TC4 · the rig keeps its EXPLICIT removals | PASS | Green before and after — the discriminating half of AC3. |
| TC4 · the mirror's source carries no absent-key sweep | PASS | RED before, printing the offending body verbatim. |
| TC5 · the shipped default for `useCanvasBinding` is false | PASS | Green before and after — AC4 is a *pin*, not a change. |
| TC5 · main.ts constructs the binding in exactly one place, behind the flag | PASS | Green before and after. |
| TC5 · the legacy follower-apply bypass is still the flag's other consumer | PASS | Green before and after. |

**16/16 visible PASS.** Pre-implementation run: **9 failed / 7 passed** — the seven passes
being exactly the over-correction guards and the AC4 pins, as designed.

**Blind sets: 27/27 PASS** (blind1 13, blind2 14), staged at depth 3 under
`plugin/src/__tests__/blindstage{1,2}/WP22/`, run, then unstaged. Typecheck was clean with
them staged.

---

## Falsification Results

Each mutation was applied to the shipped source, the WP22 visible suite re-run, then the
mutation reverted and the suite re-run green.

| AC | Mutation applied | Test that went RED | Restored green? |
|---|---|---|---|
| 1 | Re-added the absent-key sweep to `writeRecordMinimal` (`canvas-binding.ts`) | TC1 all three · TC2 `x/y drag` and `still ADDS a key` · TC3 `no partial capture removes a key` — **6 red**. TC4 stayed **green**, proving the two write boundaries are pinned independently. | yes — 16/16 |
| 2 | Disabled the explicit record-level delete trigger (`if (false && map.has(change.id))` in `captureLocal`) — the sweep left removed | TC3 `` `record: null` deletes the whole record and the deletion is a tombstone `` — **1 red, and only that one**. The "ONLY" half stayed green, showing the two halves of AC2 are separately falsifiable. | yes — 16/16 |
| 3 | Re-added the sweep to `upsertRecord` (`e2e-control.ts`) **only** — production seam left fixed | TC4 all three behavioural + source assertions — **3 red**. TC1/TC2/TC3 stayed **green**. | yes — 16/16 |
| 4 | `types.ts:65` → `useCanvasBinding: true` | TC5 `the shipped default for useCanvasBinding is false` — **1 red** | yes — 16/16, and `types.ts` re-verified byte-identical (`git diff` shows no `useCanvasBinding` hunk) |

**AC3 is load-bearing, proven directly.** F3 is the specific check the charter asks for: with
the production seam fixed and *only* the rig mirror reverted, the rig can once again delete
an edge's endpoints from a `{id}`-shaped `canvas.simulateEdit` — and TC4 catches it while
nothing else does. The mirror is therefore a genuinely independent write boundary, and after
the fix the rig has no path to the old behaviour: `simulateEdit`'s only write is
`upsertRecord`, which now cannot delete, and its only removals are the explicit
`removeNodes` / `removeEdges` (asserted still working, so the fix is not inertness).

---

## Full-suite gate

Run from `plugin/`.

**`npm test` (`vitest run`)**

| | Files | Tests | Failed |
|---|---|---|---|
| Before WP22 (baseline for this batch) | 215 | 1300 | 8 |
| After WP22 | 220 | 1316 | **8** |
| Delta | **+5** | **+16** | **0** |

**The test-count delta is fully accounted for:** +5 files and +16 tests are exactly this
WP's five visible test files (3+3+3+4+3 = 16). Nothing was deleted, skipped, `.only`'d,
retitled or weakened, so the suite did not shrink at any point and no licensing condition
of BUILD_SPEC §7 is engaged.

**The failure set is exactly the 8 pre-existing WP19-caused reds, unchanged:**

```text
canvas-sync.test.ts
├── CanvasSync > genuine local delete removes the node from the Y map
├── CanvasSync > prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)
└── CanvasSync > a genuine local DELETE of a whole record is still honoured (protection is per-key only)
w4-canvas-integrity.test.ts
└── W4 L2-A > A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS
v2/wp4/test_tp01_intent_basis_visible.test.ts
└── WP4 AC1 > T4 with the view open and a hand-over receipt, the delete still happens
v2/wp5v2/test_tp05_handover_and_close_visible.test.ts
├── WP5 > T2 after a confirmed apply the same omission is a deletion
└── WP5 > T3 an interacting record is never handed over, so it cannot be deleted
v2/wp6/chaos_degraded_adapter.test.ts
└── WP6 AC3 > D2 seam advanceFromReceipt(..., { perFieldReceipt: false }): the unlanded apply leaks and deletes
```

Same eight titles, same five files, same assertion lines as the pre-WP22 baseline capture.
They are **not mine** and were not touched, edited, deleted or fixed; they await Worker 2's
licensing ruling on WP19. **WP22 introduced zero regressions.**

**`npx tsc --noEmit`** — clean, 0 errors (also clean with both blind sets staged at depth 3).
One issue was found and fixed during this run: `Object.hasOwn` is not in the configured
`lib` target, so two of my own new tests were rewritten to `expect(Object.keys(x)).toContain(k)`.

**`npm run build`** (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`) —
PASS. `plugin/main.js` is not modified in `git status`; no version bump; `package.json`
untouched.

**`npx biome check`** on the touched + new files — one finding: the known whole-file
`format` finding on `e2e-control.ts`, which the charter §5 records as a CRLF environment
artifact (it starts at line 1, the file's first comment, far from my edit). Advisory
locally. **Not mass-reformatted**, per the charter. The five new visible test files and
`canvas-binding.ts` are clean.

---

## Summary for Worker 3

WP22 is **DONE on all four ACs, attempt 1, with no escalation.**

The R1 mechanism no longer exists at either of the two write boundaries this WP owns. Both
were the same six lines: "delete every key of the doc record that the incoming record does
not mention". Both are gone. What survives is deliberately intact — the upsert half, I3's
empty-diff-writes-nothing, the origin stamp, the record-level delete trigger with its real
CRDT tombstone, and the rig's explicit `removeNodes`/`removeEdges`.

Three things worth carrying forward:

1. **The deletion ledger is empty, and that is a verified result rather than an omission.**
   Nothing in the 215-file suite pinned the removed behaviour. WP22's entry in BUILD_SPEC §7's
   licensed-deletion list can be closed as *licence unused*. No test was amended either, so
   WP22's absence from the licensed-amendment list was never tested against.
2. **The two boundaries are independently pinned.** Falsification F1 (production seam only)
   and F3 (rig mirror only) each turn a disjoint set of tests red. A future change to either
   file cannot silently regress the other.
3. **The third boundary was checked, not assumed.** As the charter's §4 amendment note
   predicted, `canvas-sync.ts` carries no key-deletion left (WP4/WP18 closed the capture and
   seed boundaries). It was inspected and deliberately **not** touched.

Scope held exactly: `useCanvasBinding` still `false` and still dormant behind its single
gate (WP40 unaffected); `canvas-model-bridge.ts` and `canvas-presence.ts` untouched; the
`canWriteNode:` option left in place as instructed; the wider op-capture contract renewal
left to WP39; field-level explicit removal left as S14 for WP39 AC5. **W4 Test Targets: 0.**
