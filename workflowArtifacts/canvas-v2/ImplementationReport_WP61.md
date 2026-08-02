# Implementation Report — WP61: WP49 quiescence blind-set amendments and fixture repairs

**Status:** DONE
**Batch:** B11 (divergent-row amendments)
**task_mode:** `standard`
**Risk flag:** NONE

---

## 1. What changed

Five blind test files, one contract statement, the §7 ledger. **No production code.**
`plugin/src/testing/e2e-control.ts` was read only — and, during falsification, perturbed and restored
byte-clean with sha256 verification (§7 below).

| # | File · line | Class | Change |
|---|---|---|---|
| 1 | `tests/blind_set1/WP49/test_tp4_timeout_semantics_preserved_blind1.test.ts:71` | **A** | timer advances 10 → 20 ms (`:77`, `:82`); preamble prose corrected |
| 2 | `tests/blind_set2/WP49/test_tp1_peer_origin_blocks_quiescence_blind2.test.ts:49` | **A** | timer advances 5 → 20 ms (`:62`, `:69`) |
| 3 | `tests/blind_set2/WP49/test_tp3_control_edit_still_bumps_blind2.test.ts:83` | **B** | 4-key → 9-key whole-object `toEqual` (`:87-92`) |
| 4 | `tests/blind_set2/WP49/test_tp2_user_origin_blocks_quiescence_blind2.test.ts:84` | **C** | fixture retimed (`:89-92`) |
| 5 | `tests/blind_set2/WP49/test_tp10_absent_file_not_created_blind2.test.ts:64` | **C** | `.not.toContain("stale")` → `toBeNull()` |
| — | `T3_SharedContract.md` §6 | — | `timeoutMs = 0` semantics stated once (AC4) |

---

## 2. Class A — the timing cluster (#1, #2)

**Stale, but over a genuinely real behavioural change**, which is why this is recorded rather than
quietly fixed.

`waitQuiescent` (`e2e-control.ts:997-1018`) uses `pollMs = 20`, `quietWindowMs = 50`, and **sleeps
before it evaluates**. That ordering is `TaskCharter_WP49` AC1 verbatim, which names the *old*
ordering as the defect: a wait that evaluated before its first sleep answered out of **pre-call
history**, certifying a settle it never observed. So `timeoutMs = 0` means *expire at the earliest
opportunity* — one 20 ms poll — not "decided without waiting".

Both tests advanced fake timers by **less than one poll interval** (10 ms and 5 ms), so their promises
never settled and they died on vitest's 5 s timeout (recorded pre-repair as `Error: STACK_TRACE_ERROR`
from `@vitest/runner`). **The verdicts they assert are the verdicts the implementation produces** —
only the zero-latency assumption was wrong, and no spec statement supported it.

**#1 before / after:**

```ts
      const whenIdle = host.waitQuiescent(0);
      await vi.advanceTimersByTimeAsync(10);          // → 20
      expect(await whenIdle).toEqual({ quiescent: true });

      userEdit(doc, "n1", { id: "n1", x: 3, y: 4 });
      const whenBusy = host.waitQuiescent(0);
      await vi.advanceTimersByTimeAsync(10);          // → 20
      expect(await whenBusy).toEqual({ quiescent: false });
```

**#2 before / after:** identical shape, `advanceTimersByTimeAsync(5)` → `(20)` at `:62` and `:69`.

Every `toEqual` verdict is kept **verbatim** in both files. The named subject — that `timeoutMs: 0` is
forwarded and does **not** collapse to the 2000 default — is preserved and still fails if it ever does
(falsification P2 below proves this).

---

## 3. Class B — the settled-contract shape pin (#3)

`sessionInfo()` returns nine keys (`e2e-control.ts:832-850`); the assertion pinned the pre-WP46 four.
`TaskCharter_WP46:95` already settles the class: *"stale, not violated — they pin a payload the spec
deliberately replaced, while their own subjects are untouched."* The nine keys are pinned field-by-field
in `T3_SharedContract:199` and §6.2. **This is the third instance of a pattern licensed twice already**,
and WP46 AC5 mandates the remedy used here.

**Before:**

```ts
    expect(host.sessionInfo()).toEqual({
      clientId: "cid", role: "host", roomId: "room", connected: true,
    });
```

**After:**

```ts
    expect(host.sessionInfo()).toEqual({
      clientId: "cid", role: "host", roomId: "room", connected: true,
      vaultId: "", vaultName: "", vaultPath: null,
      pluginBuild: `0.0.0+${E2E_BUILD_MARKER}`, canvasSurface: true,
    });
```

Values are this fixture's **honest-degradation** values, derived from the resolvers, not guessed: the
fixture plugin has no `app` and no `manifest`, so `resolveVaultId`/`resolveVaultName` degrade to `""`
and `resolveVaultPath` to `null` (`e2e-control.ts:691-710`); `resolvePluginBuild` (`:713-714`) yields
`0.0.0+` the exported marker; `canvasSync` is present so `resolveCanvasSurface` (`:718-721`) is `true`.
`E2E_BUILD_MARKER` is **imported**, never hardcoded — the same form the already-licensed WP46
amendments use (`tests/blind_set2/WP46/…blind2.ts:50`, `tests/visible/WP44/…visible.test.ts:157`).

**Ledger correction (AC6):** the findings table described this as a *"2-key"* pin. It is a **four-key**
exact `toEqual`. Corrected in `BlindVerificationLedger.md`.

The file's own subject is intact — its other two tests, that the widened seam does not move
`bindingCounters`, passed before and after.

---

## 4. Class C #5 — unsatisfiable as authored: mechanism **demonstrated**

> The licence for this class is conditional on showing the mechanism, because *"this test could never
> pass"* is exactly what a sub-agent would claim about a test that found a real bug. So: the proof.

**The assertion:**

```ts
    expect(result).toEqual({ exists: false, sha256: "", size: 0, content: null });   // :63
    expect(result.content).not.toContain("stale");                                   // :64  ← unsatisfiable
```

**Step 1 — the receiver is provably `null`.** Line 63 already pins `result` with a whole-object
`toEqual` including `content: null`. That is exactly what production returns for an absent file
(`e2e-control.ts:971-973`) and what `T3_SharedContract` §6.1 mandates; the source comment at `:964-966`
states `content:null` "is never softened to `""`" because it is what distinguishes a missing file from
an empty one.

**Step 2 — the library path, read out of the installed packages:**

| Location | What happens |
|---|---|
| `@vitest/expect/dist/index.js:1245` | `if (typeof actual === "string" && typeof item === "string")` — **skipped**, the receiver is `null` |
| `@vitest/expect/dist/index.js:1249` | `if (actual != null && typeof actual !== "string")` — **skipped**, so the jest-compat `Array.from` conversion never runs and the object flag stays `null` |
| `@vitest/expect/dist/index.js:1252` | `return this.contain(item);` — delegates to chai's `include` |
| `chai/index.js:2067-2074` | no case matches a `null` object → `default` branch → `val !== Object(val)` is true for the primitive `"stale"` → **`throw new AssertionError(...)`** |

**Step 3 — why `.not` cannot save it.** Chai inverts only assertions routed through `this.assert()`.
Line 2069 **throws** directly, so the `negate` flag is never consulted. The assertion fails identically
with and without `.not`.

**Step 4 — observed, not merely reasoned.** The pre-repair run recorded verbatim:

```
AssertionError: the given combination of arguments (null and string) is invalid for this assertion.
You can use an array, a map, an object, a set, a string, or a weakset instead of a string
    at Proxy.<anonymous> (…/@vitest/expect/dist/index.js:1252:15)
    at Proxy.methodWrapper (…/chai/index.js:1700:25)
    at …/test_tp10_absent_file_not_created_blind2.test.ts:64:32
```

**Step 5 — the contradiction is internal to the test.** Any implementation making line 64 pass would
have to return a *string* for `content`, which breaks line 63 and violates §6.1. Any implementation
honouring the contract throws on line 64. **No implementation can satisfy both lines.**

**The repair, and why it is stricter:**

```ts
    expect(result.content).toBeNull();
```

`toBeNull()` admits **exactly one value**; `.not.toContain("stale")` admitted every string that merely
lacked that substring (and, had the receiver ever been a string, would have passed for `""`,
`"anything"`, …). Corroboration that this is the house-correct strict form rather than an invention:
the untouched sibling `test_tp9_file_read_is_readonly_blind2.test.ts` in the same set already pins the
same contract value with `expect(missing.content).toBeNull()`.

---

## 5. Class C #4 — unsatisfiable as authored: arithmetic **demonstrated**

**The fixture, before:**

```ts
    await vi.advanceTimersByTimeAsync(400);
    const pending = host.waitQuiescent(120);
    await vi.advanceTimersByTimeAsync(20);
    put(doc, "n2", { id: "n2", x: 7, y: 7 }, "canvas-view-user");
    await vi.advanceTimersByTimeAsync(160);
    expect(await pending).toEqual({ quiescent: false });
```

**The arithmetic.** Let t0 be the instant `waitQuiescent(120)` is called. The preceding
`advanceTimersByTimeAsync(400)` leaves `lastActivity ≤ t0 − 400`, and `deadline = t0 + 120`. The loop's
first `await new Promise(r => setTimeout(r, pollMs))` is scheduled at t0 and fires at **exactly t0+20**
— the same instant the next line's `advanceTimersByTimeAsync(20)` lands on. `advanceTimersByTimeAsync`
runs timers due at the target instant *and drains the microtask queue*, so the poll body executes
inside that call:

```
idleFor = (t0+20) − lastActivity ≥ 420  ≥  quietWindowMs (50)   → return { quiescent: true }
```

The promise is therefore **already settled** when control returns and the `put` on the following line
runs. The edit can never influence the answer.

**Why no legal implementation could pass it.** With the chartered `pollMs = 20` / `quietWindowMs = 50`
and 420 ms of accumulated idle, the first poll necessarily answers `true`. A *shorter* poll answers
`true` sooner. The pre-WP49 evaluate-before-sleeping ordering — the defect AC1 exists to remove —
answers `true` at t0, earlier still. Only an unchartered `pollMs > 20` (or `quietWindowMs > 420`) would
leave the wait pending; neither is permitted. **Observed pre-repair:**
`AssertionError: expected { quiescent: true } to deeply equal { quiescent: false }` at `:94`.

**The repair — fixture only, verdict verbatim:**

```ts
    const pending = host.waitQuiescent(25);      // was 120
    await vi.advanceTimersByTimeAsync(10);       // was 20 — lands BEFORE the first poll
    put(doc, "n2", { id: "n2", x: 7, y: 7 }, "canvas-view-user");
    await vi.advanceTimersByTimeAsync(160);
    expect(await pending).toEqual({ quiescent: false });   // unchanged
```

New trace: the edit lands at t0+10, **strictly inside the pending wait and before the first poll**, so
`lastActivity = t0+10`. Poll t0+20: `idleFor = 10 < 50`, and `20 < 25` so the deadline has not passed →
keep waiting. Poll t0+40: `idleFor = 30 < 50`, and `40 ≥ 25` → return `{quiescent: false}`. The
**deadline** decides, not a settle — which is precisely what the test's title claims. The budget is now
shorter than the quiet window, the same construction the file's *other, already-passing* test uses
(`waitQuiescent(25)` at `:79`).

**The repair is not a tautology.** It still goes red if the activity seam ever ignores user-origin
updates (falsification P5: `idleFor` would be 420 at the first poll → `true`), and it still goes red if
`waitQuiescent` ever evaluates before its first sleep (`idleFor` 400 at t0 → `true`). Both are the
WP49 AC1 properties the test exists to protect.

---

## 6. AC4 — `timeoutMs = 0` stated once, in the shared contract

The root cause of the class-A cluster was a **spec gap**: a blind test and the implementation each held
a defensible but incompatible reading, and nothing adjudicated between them
(`T3_SharedContract:205` documented only `timeoutMs?` default 2000; `BUILD_SPEC` said nothing at all).
Added to `T3_SharedContract.md` §6, immediately after the `sync.waitQuiescent` row:

> **`sync.waitQuiescent` — `timeoutMs = 0` (WP61 AC4).** `0` is a legal, explicitly forwarded value,
> not an absent one: the router falls back to the `2000` default only when the argument is absent,
> non-numeric or negative. `0` means **"expire at the earliest opportunity — answer after the first
> poll, never from pre-call history"**. It does not mean "infinite", and it does not mean "decided
> synchronously": a wait is a question about the interval it covers, so `waitQuiescent` sleeps one poll
> interval before its first evaluation (WP49 AC1), and a zero-budget probe therefore costs exactly one
> poll interval (`pollMs = 20`) instead of returning for free. This is the single authority for
> `timeoutMs = 0`; no test and no implementation may assume a zero-latency answer.

**The user-visible consequence is stated rather than buried:** a zero-budget probe now costs one 20 ms
poll instead of returning synchronously, so rig code that assumed a free probe pays 20 ms per call.

---

## 7. Falsification — every amended site perturbed, then restored byte-clean

Harness: `workflowArtifacts/canvas-v2/_falsify_b11.py`. `plugin/src/testing/e2e-control.ts` carries
**pre-existing uncommitted changes**, so `git checkout --` is not a safe restore path; the harness
snapshots the exact bytes, restores from the snapshot in a `finally` block, and asserts the sha256
after every single perturbation.

| # | Perturbation of the pinned surface | Amended test expected red | Result |
|---|---|---|---|
| P1 | add `node:util` import to `e2e-control.ts` | WP60 builtin-set pin | **red, and nothing else** |
| P2 | `deadline = now + (timeoutMs \|\| 2000)` — collapse `0` to the default | class A #1 **and** #2 | **both red, nothing else** |
| P3 | `canvasSurface: false` — narrow `session.info` | class B #3 | **red, and nothing else** |
| P4 | absent-file `content: null` → `""` | class C #5 | **red** (+1 independent sibling, below) |
| P5 | activity seam made origin-aware (the WP49 AC1 violation) | class C #4 | **red** (+1 independent sibling, below) |

**Every amended assertion bit.** Two perturbations additionally turned an *untouched* test red, and in
both cases that is the pin working rather than amendment damage:

- **P4** also reddened `test_tp9_file_read_is_readonly_blind2.test.ts` → *"an absent sibling still
  reports the absent shape"*, which contains its own `expect(missing.content).toBeNull()`. Softening
  `content` to `""` is a genuine `T3_SharedContract` §6.1 breach, so a second independent pin catching
  it is correct.
- **P5** also reddened the *other* test in `test_tp2` — *"peer first, then the user: ordered writes,
  and the last one still blocks"* — which likewise depends on user-origin activity marking. Making the
  seam origin-aware is a genuine WP49 AC1 violation, so two tests catching it is correct.

**Restore verification:** with the tree restored, all three sets re-run **green (0 failures)** and
`e2e-control.ts` hashes to `6101d642…8c9fc`, byte-identical to the pre-falsification snapshot.

---

## 8. Strictness and test counts (AC5)

Grepped across all five files: **zero** occurrences of `toMatchObject`, `expect.objectContaining`,
`expect.arrayContaining`, key-count checks, `.skip(`, `.only(` or `.todo(` introduced by this WP.
(Three *other*, untouched WP49 blind files contain pre-existing `toMatchObject`/`toContain` usages;
they are out of this WP's scope, were not modified, and pass.) Both amended `toEqual`s remain
whole-object/whole-set exact.

| Set | Files | Collected before | Collected after | Pass before | Pass after |
|---|---|---|---|---|---|
| WP49 set1 | 12 | 32 | **32** | 31 | **32** |
| WP49 set2 | 12 | 34 | **34** | 30 | **34** |

Counts are identical before and after — restatements, not additions or deletions. All 61 previously
passing tests across the two sets still pass, unmodified.

## 9. Blind-set result (AC6)

Run under the WP55 runner (`_run_blind.py 49 both --ts-only`), staged at depth 2 into `plugin/`:

| WP | Set | Framework | Collected | Pass | Fail | Verdict |
|---|---|---|---|---|---|---|
| WP49 | set1 | vitest | **32** | 32 | 0 | **CONFIRMED** |
| WP49 | set2 | vitest | **34** | 34 | 0 | **CONFIRMED** |

`BlindVerificationLedger.md` rows updated DIVERGENT → CONFIRMED, with the "2-key" description of #3
corrected to "4-key".

## 10. Constraints honoured

- **WP49 AC1 untouched** — the activity seam is not origin-aware. The origin filter was used *only* as
  a falsification perturbation and reverted; P5 exists precisely to prove the tests would catch it.
- **`waitQuiescent` still sleeps before it evaluates.** The tests moved to the implementation's clock,
  never the reverse.
- **No production file changed.** `sessionInfo()` was not narrowed; `canvas.file` was not softened.
- **No wall-clock sleeps introduced** (§8); every advance is an explicit multiple of `pollMs` except
  #4's deliberate sub-poll 10 ms, which is the whole point of that repair.
- **WP47's double-`pytest.raises`** left untouched — same class, out of scope, needs its own charter.
  The §7 third-class table now tracks it explicitly as OPEN.

## 11. Risk notes

None outstanding. The cluster is fake-timer-sensitive by nature; all five sites now advance by explicit
multiples of the 20 ms poll (or, for #4, a deliberate 10 ms sub-poll offset whose arithmetic is written
into the test as a comment), so the timing intent is legible to the next reader rather than implicit.
