# Implementation Report — WP60: WP44 set2 import-surface pin amendment

**Status:** DONE
**Batch:** B11 (divergent-row amendments)
**task_mode:** `lightweight`
**Risk flag:** NONE

---

## 1. What changed

One blind test file. **No production code.** `plugin/src/testing/e2e-control.ts` was read only.

| File | Change |
|---|---|
| `workflowArtifacts/canvas-v2/tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts` | one assertion + its title (`:74-77`), and the preamble prose that restated the same claim (`:1-8`) |
| `BUILD_SPEC_CanvasV2.md` §7 | one amendment-ledger row |
| `BlindVerificationLedger.md` | `WP44 / set2 / vitest` row DIVERGENT → CONFIRMED; findings row annotated RESOLVED |

## 2. The assertion, before and after

**Before:**

```ts
  it("imports exactly one node builtin: node:http", () => {
    const builtins = specifiers().filter((s) => s.startsWith("node:"));
    expect(new Set(builtins)).toEqual(new Set(["node:http"]));
  });
```

**After:**

```ts
  it("imports exactly the sanctioned node builtins: node:crypto, node:http", () => {
    const builtins = specifiers().filter((s) => s.startsWith("node:"));
    expect(new Set(builtins)).toEqual(new Set(["node:crypto", "node:http"]));
  });
```

The preamble's *"one runtime package (`yjs`), one node builtin (`node:http`)"* was corrected to name
both sanctioned builtins and to record why the pin moved, so the file no longer asserts one thing in
prose and another in code (AC1).

## 3. Why stale rather than violated

- `TaskCharter_WP44:87` (AC4, verbatim): *"`resolvePort` keeps its existing precedence and **gains no
  new dependency**, and a vault with no provisioned port still starts no control server at all."* The
  subject is `resolvePort` and port/server behaviour — **not** the module's total import surface.
- WP44's dependency constraints (`:51`, `:107`, `:112`) are uniformly about **runtime packages**
  (7-day publish rule, `npm view`). A Node built-in is not a dependency in that sense.
- The **visible counterpart is the authority for the intended rule and contradicts the blind pin**:
  `tests/visible/WP44/test_tp12_no_server_no_port_visible.test.ts:13-14` allows *"a `node:` builtin
  **or** a package already in `plugin/package.json`"*, implemented at `:111-131` as an allow-list that
  skips every `node:` specifier.
- `node:crypto` has exactly **one** use site — `e2e-control.ts:978`,
  `sha256: createHash("sha256").update(bytes).digest("hex")` — inside the WP49 `canvas.file` read-back
  that `T3_SharedContract` §6.1 mandates. It adds no port, no socket, no listener.

Deleting the import was explicitly **not** the fix: it would break a contract-pinned field
(charter §5 hard constraint).

## 4. Strictness after (AC2)

Still an **exact whole-set `toEqual`** over the complete builtin set. No subset match, no
`expect.arrayContaining`, no "at least" check, no filtering `node:crypto` out before comparing, no
`skip`/`only`/`todo`. Verified by grep over the file: zero occurrences of `toMatchObject`,
`objectContaining`, `arrayContaining`, `.skip`, `.only`, `.todo`.

**Falsification (P1).** Adding `import { format as _falsify } from "node:util";` to `e2e-control.ts`
turned **this test and only this test** red across the set; restoring the file byte-clean returned the
set to green. A future `node:net` or `node:child_process` import therefore still fails this pin.

## 5. Test count and collateral (AC3)

Five `it(...)` before, **five after**. The other four tests — including the behavioural no-server check
and the bare-specifier `{yjs}` pin, which are what AC4 actually protects — are byte-identical and all
still pass.

## 6. Blind-set result (AC4)

Run under the WP55 runner (`_run_blind.py 44 set2 --ts-only`), staged at depth 3 into `plugin/`:

| WP | Set | Framework | Collected | Pass | Fail | Verdict |
|---|---|---|---|---|---|---|
| WP44 | set2 | vitest | **25** | 25 | 0 | **CONFIRMED** |

Before the amendment the same set collected 25 and reported 24 / 1 — the count is unchanged, which is
the arithmetic an amendment is supposed to produce.

## 7. Open dependency

This ruling depends on `src/testing/` continuing to tree-shake out of the production bundle
(C46 AC1). That property is **not assumed here** — it is measured by **W4-1** in
`TaskCharter_WP46` §7b, which Worker 4 must re-run. If `W4-1` ever returns a non-zero match count,
this amendment must be revisited.

## 8. Risk notes

None. The test reads the module as **text** and never imports it, so it is immune to module-graph and
timing effects. No flaky patterns.
