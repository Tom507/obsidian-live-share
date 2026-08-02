# Implementation Report — WP11

**WP:** WP11 — Write-once `type` guard (C11, phase P1)
**Attempt:** 1
**Charter:** `workflowArtifacts/canvas-v2/TaskCharter_WP11_WriteOnceTypeGuard.md` (Charter Status → `DONE`)

---

## Status: `DONE`

All three visible tests pass. `npx tsc -noEmit -skipLibCheck` is clean (zero errors, including zero
under `src/__tests__/wp49/`). No existing test was deleted, skipped, weakened or touched.

---

## Completed Work

| AC | Text (verbatim, charter §4) | Status | Where it lives |
|---|---|---|---|
| AC1 (first half) | "The first write of `type` on a record is accepted" | DONE | `guardTypeWrite` — `established === undefined` branch performs the single `record.set(V2_FIELD.type, …)` and returns `{kind: "accepted"}`. Verified by TC1. |
| AC1 (second half) | "…every subsequent write with a different value is rejected and produces a signature in the log" | DONE | `guardTypeWrite` final branch — no `set`, returns `{kind: "rejected", signature}`. The signature is returned as data in `canvas-sync.ts`'s `<NAME> signature: …` shape for the caller to log; the module itself does not log (purity contract). Verified by TC2. |
| AC2 | "A subsequent write with the **same** value is a no-op and produces no delta and no signature" | DONE | `established === proposedType` branch returns the frozen `NOOP` singleton **without calling `record.set`**. "No delta" is literal, not cosmetic — see the note below. The `noop` verdict has no `signature` KEY at all (not `signature: undefined`), so `"signature" in verdict === false`. Verified by TC3. |
| AC3 | "A record can never reach the doc without `type` through any local write path" | **INTEGRATION_SCOPE** — not proven here | Classified in charter §7b. Requires the write boundaries to be wired through the guard, which is explicitly WP18 (charter §2, Shared Ownership Contract §3). Deliberately not faked at unit level. |

**Why the `noop` branch must not call `set`.** Yjs has no value-equality short circuit: a same-value
LWW `set` produces a real `update` and a real encoded delta (WP8 tp04 precedent). Since a save
re-states every field of every record, a same-value `type` write is the *common* case — re-setting
would put one delta per record per save on the wire and hand every peer a fresh remote change. "No
delta" therefore had to be implemented as "no `set` call". Same for the `rejected` branch.

---

## Blocked Items

None. No `SPEC_CONTRADICTION`, no `ESCALATE`, no `TOOL_REQUEST`.

---

## Tools Created

None. No new runtime dependency, no new dev dependency, no script, no fixture, no test helper.

---

## Changes Made

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-type-guard.ts` | **NEW** (the only source file created or modified). Pure module, 3 exports. |
| `workflowArtifacts/canvas-v2/TaskCharter_WP11_WriteOnceTypeGuard.md` | Charter Status `TESTS_ADDED` → `DONE`; §8 and §9 filled in. |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP11.md` | **NEW** — this file. |

**Not touched, on purpose:**

- `PROTECTED_KEYS` (`plugin/src/files/canvas-sync.ts:53–62`) — left exactly as it is. It stays as
  defence in depth without carrying correctness (charter §2). Removing it would be an ESCALATE.
- No write boundary was wired to the guard (`canvas-sync.ts`, `handleLocalModify`, the ingest path) —
  that is WP18, a later batch.
- `canvas-registers.ts` was read but not modified. `server/`, `docker/`, `deploy/`, `plugin/main.js`,
  `manifest.json`, `package.json`, `canvas-presence.ts`, `canvas-binding.ts`,
  `canvas-model-bridge.ts`, `main.ts`: untouched. No version bump, no build, no formatter, no
  `lint --fix`.

> Other modified files visible in `git status` (`canvas-registers.ts`, `canvas-sync.ts`,
> `e2e-control.ts`, `tools/…`, other TaskCharters) are **not mine** — they are concurrent work by
> other WPs in this batch.

---

## Exported API surface

`plugin/src/canvas/canvas-type-guard.ts` — exactly the charter §7 contract, plus one small shared
predicate:

```ts
export type TypeWriteVerdict =
  | { readonly kind: "accepted" }                              // first write — set() IS performed
  | { readonly kind: "noop" }                                  // same value  — set() NOT called
  | { readonly kind: "rejected"; readonly signature: string }; // differing   — set() NOT called

export function guardTypeWrite(
  record: V2RecordMap,
  recordId: string,
  proposedType: string,
): TypeWriteVerdict;

export function readRecordType(record: V2RecordMap): string | undefined;
```

Behavioural notes for consumers (WP14 composition, WP18 wiring):

- **`guardTypeWrite` never throws.** It sits on a hot capture path where a throw would abort a whole
  save; a refusal is data.
- **It touches the record at most once**, by exactly one `set`, and only on the `accepted` path.
- **"Established `type`" = non-empty string.** A record holding `""` or a non-string is treated as
  having *no* type — which is precisely what `canvas-sync.ts`'s existing `NO TYPE signature` audit
  already reports as broken (`typeof type !== "string" || type.length === 0`). Treating such a value
  as established would make the guard refuse the very write that repairs the record, freezing the
  corruption permanently.
- **An invalid *proposal* (empty string, or a non-string from an untyped call site) is `rejected`,
  never stored** — whether or not the record already has a type. The mandate is that `type` can
  neither change *nor vanish*, and writing `""` is how it vanishes.
- `readRecordType` is exported so "does this record have a real type?" is answered by one predicate
  at every boundary rather than three copies — the same reasoning the Shared Ownership Contract
  applies to WP12's suppression predicate.
- **Signature format** (secondary oracle, humans only — never parse it):
  `TYPE WRITE REJECTED signature: record <id> holds <type "x" | no type>; refused proposed type "<y>" (type is write-once)`.
  Contains `recordId` and `proposedType` as substrings, as the contract requires. `type` values are
  schema vocabulary (`text`/`file`/`link`/`group`), never user prose, so quoting them leaks no note
  content (US6).

---

## Symbols imported rather than redefined

| Symbol | Owner | Imported from | Note |
|---|---|---|---|
| `V2_FIELD` (specifically `V2_FIELD.type`) | WP9 | `./canvas-registers` | The `type` key name is **never** spelled as an inline `"type"` literal anywhere in the module — not in the read, not in the `set`. |
| `V2RecordMap` | WP9 | `./canvas-registers` (type-only import) | Structural record interface; `Y.Map<unknown>` satisfies it as-is, which is what keeps this module free of the Yjs import chain. |

Nothing else is imported. **Zero** imports beyond `canvas-registers.ts` — no Yjs, no Obsidian, no
filesystem, no clock, no randomness, no logger. Precedents: `reconcile-plan.ts`,
`canvas-registers.ts`, `canvas-ord.ts`.

Nothing owned by another WP is re-declared: no `type` key literal, no `V2RecordMap` restatement, no
competing geometry/endpoint set, no `PROTECTED_KEYS` variant, no `ord` comparator, no tombstone
predicate.

---

## Visible Test Results

Command (run from `plugin/`, trailing slash as required):

```
npx vitest run src/__tests__/v2/wp11/ --reporter=dot
```

```
 RUN  v4.0.18 …/obsidian-live-share/plugin
 ···
 Test Files  3 passed (3)
      Tests  3 passed (3)
   Duration  430ms
```

| TC | File | Result |
|---|---|---|
| TC1 | `test_tp01_first_write_accepted_visible.test.ts` | PASS |
| TC2 | `test_tp02_differing_write_rejected_signature_visible.test.ts` | PASS |
| TC3 | `test_tp03_same_value_rewrite_noop_no_delta_visible.test.ts` | PASS |

Type check, run from `plugin/`:

```
npx tsc -noEmit -skipLibCheck    →  clean, zero output
```

Per instruction, the full `npm test` suite and `npm run build` were **not** run — Worker 3 runs the
suite once at the end of the batch.

---

## Summary for Worker 3

WP11 is `DONE` on attempt 1, no escalations. One new source file,
`plugin/src/canvas/canvas-type-guard.ts` — a pure, zero-dependency guard exporting `guardTypeWrite`,
`TypeWriteVerdict` and `readRecordType`. 3/3 visible tests green in 430 ms; `tsc -noEmit
-skipLibCheck` clean; no existing test touched; test-count baseline unaffected (only additions).

Three things to carry forward:

1. **The `noop` branch is correctness, not optimisation.** It returns without calling `record.set`,
   because Yjs emits a real delta for a same-value LWW `set`. Any later refactor that "simplifies"
   this into an unconditional set silently breaks AC2 and puts one delta per record per save on the
   wire. `rejected` is silent for the same reason.
2. **AC3 is genuinely open and belongs to WP18.** Nothing is wired. Until WP18 routes the write
   boundaries through `guardTypeWrite`, a record can still reach the doc without `type`; the guard
   only makes the decision available. `PROTECTED_KEYS` remains the only active in-tree defence and
   was deliberately left intact.
3. **Contract decision worth reviewing at composition time:** an existing record holding `""` or a
   non-string `type` is treated as *typeless*, so the next valid write is `accepted` and repairs it.
   This deviates from a maximally literal "write-once" reading, and it is intentional — the strict
   reading would permanently freeze exactly the corruption the `NO TYPE signature` audit exists to
   flag. If WP14/WP18 need the strict reading instead, that is a one-line change in
   `isEstablishedType`, but it should be a conscious spec decision, not a silent one.
