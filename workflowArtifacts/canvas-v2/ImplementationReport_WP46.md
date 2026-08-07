# Implementation Report — WP46: Readiness + instance-identity handshake

**Status:** `DONE` (implementation complete; **one owner decision is pending** — see Blocked Items)
**Attempt:** 1
**Charter:** `TaskCharter_WP46_ReadinessIdentityHandshake.md` (Charter Status → `DONE`)

> **Read Blocked Items first.** WP46 AC1 changes the `session.info` payload from 4 keys to
> 9. Two pre-existing exact-shape assertions elsewhere in the suite are therefore
> arithmetically unsatisfiable and now fail. They were left **failing and unmodified** on
> purpose, per the "never modify an existing or visible test" rule. The exact one-line fix
> for each is below.

---

## 1. Per-AC table

| AC | State | Evidence |
|---|---|---|
| **AC1** — `session.info` additionally reports vault identity, build identity and canvas-surface availability; the added fields change nothing in production and `src/testing/` still tree-shakes out | **MET** | TC1–TC4 green (21 vitest cases). Tree-shake re-verified out of band: a production esbuild bundle (`__LS_E2E__=false`) greps to **0** matches for `e2e-control\|LIVESHARE_E2E\|e2eControlPort`; the same bundle built with `__LS_E2E__=true` **does** match, so the 0 is real elimination and not a false negative. `routeCommand` was not touched at all — it already forwards the whole payload. |
| **AC2** — bounded timeout; both answer, **different** vaults, **same** room; each failure its own named abort; no edit issued | **MET** | TC5–TC8 green. The three conditions are three separate rungs of `_verdict_present`, returning `READINESS_TIMEOUT` / `IDENTITY_SAME_VAULT` / `ROOM_MISMATCH`. "No edit is issued" is structural: the module has exactly **one** outbound request site (`_default_transport`) and it sends exactly one module-level frozen payload (`_SESSION_INFO_BODY`), with no parameter or branch able to change it. The stubs' command logs confirm only `session.info` ever arrives, on every path including the green one. |
| **AC3** — positive assertion, not absence of error | **MET** | TC9–TC11 green. `ready=True` is reachable only after every rung is positively satisfied. A timeout, a legacy-only answer, an empty identity, a 200 with non-JSON / no `result` / a truncated body / `ok:false` / a non-object `result`, and a third vault each produce a named refusal. Nothing is inferred from "no exception raised". |
| **AC4** — re-runnable mid-run; reused inverted by teardown | **MET** | TC12–TC14 green. The module holds no cache and no state, so a second call re-probes and a pair that degrades between calls is caught by the same function. The inverted direction is exposed as `check_endpoints_gone` (`expect_absent`) rather than left to callers: both endpoints refusing is `ready=True` there and `READINESS_TIMEOUT` for `check_readiness` on the *identical* world state; a survivor is named by role and vault in `identities`. |

---

## 2. Blocked Items — RESOLVED 2026-08-01 by Worker 2 licensing (see §2.0)

### 2.0 Amendment ledger entry — WP46 (BUILD_SPEC §7, amendment class)

<!-- Updated: Worker 2 licensed both assertions as AMENDMENTS (BUILD_SPEC §7 amendment ledger,
     charter AC5); Worker 3 applied them 2026-08-01 -->

**Status: APPLIED.** Worker 2 ruled that widening `session.info` from four to nine keys is the
*literal content* of AC1, so both assertions were **stale, not violated**. They are amended, not
deleted. This is WP46's entry against the §7 amendment ledger; both amended assertions are named
below by file, line, reason and post-amendment strictness.

| # | File · line (post-amendment) | Why it was stale | Strictness after |
|---|---|---|---|
| 1 | `plugin/src/__tests__/e2e-control.test.ts:203` — `buildPluginHost > sessionInfo maps settings + connection state` | **Pre-existing baseline** (prior e2e-infra initiative). Pinned the four-key payload with an exact `toEqual`; AC1 made that shape unreachable. | Whole-object `toEqual` over **all nine** keys. **Stricter than before** — additionally pins the AC3 honest-degradation values (`vaultId: ""`, `vaultName: ""`, `vaultPath: null`) that nothing pinned previously. |
| 2 | `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:147` — `WP44 AC4 > binds the numeric LIVESHARE_E2E port (order 1)` | Staged mirror of a WP44 visible test, written before WP46 extended `session.info`. Its subject is *port precedence*; the payload is only proof that a real control server owns the port. | Whole-object `toEqual` over **all nine** keys (nested under `result`). **Stricter than before** — same added AC3 degradation pins, with `canvasSurface: false` (this fixture has no `canvasSync`). |

**Site 2 exists twice — both copies amended.** The staged copy above is untracked and is
regenerated from its source of truth at
`workflowArtifacts/canvas-v2/tests/visible/WP44/test_tp11_resolveport_precedence_visible.test.ts:147`.
Patching only the staged copy would silently revert on the next restage and resurface later as a
spontaneous regression. **WP46 is cross-licensed for this one assertion inside WP44's artefact and
nothing else in WP44's territory.** The two files were verified byte-identical before the edit and
are byte-identical after it.

**Strictness bar held (§7 conditions 1 and 2).** No `toMatchObject`, no subset match, no
`expect.objectContaining`, no key-count check, no `skip`/`only`, no destructuring the added fields
away. Test count did **not** move: the `e2e-control` + `t3/` scope was **37 tests before and 37
after**, going from `2 failed / 35 passed` to `37 passed`. Nothing added, nothing removed.

**Refinement applied (Worker 2's optional note).** Both files already imported from
`src/testing/e2e-control`, so `pluginBuild` is composed as `` `0.0.0+${E2E_BUILD_MARKER}` `` from
the exported constant rather than hardcoding `"0.0.0+e2e"`. This cost one added named specifier in
an existing import statement in each file — no new import statement — and matches what WP46's own
visible and blind tests already do.

**Falsification check (not trusted, tested).** `resolveVaultName`'s unknown-vault default was
perturbed from `""` to `"PERTURBED"` in `plugin/src/testing/e2e-control.ts` — a single field of the
nine-key payload. **Both** amended assertions went red, and only those two; the other 35 tests in
scope stayed green, confirming each amendment still fails on payload drift rather than merely
having been fitted to the current output. The file was then restored from a byte-exact backup and
verified by md5 (`f1c4e75abcab9bafd6c34dd86649c5c2`, identical pre- and post-check) with zero
perturbation traces remaining.

---

## 2.1 The original contradiction (retained for the record)

**The contradiction.** AC1 + visible TC1 pin `session.info` to *exactly* nine keys
(`Object.keys(info).sort()` must equal the four legacy plus the five §6.2 names). Two
pre-existing tests assert the *old* exact four-key shape with `toEqual`. No implementation
can satisfy both; there is no "optional fields" escape, because visible TC3 requires a
hollow plugin to answer **all nine** fields (`vaultId: ""`, `vaultPath: null`, …) — that
honesty is precisely what makes the AC3 refusal possible.

Both were left failing and byte-unmodified *at first submission*. <!-- Updated: both edits are
now APPLIED under the §7 amendment ledger — see §2.0 2026-08-01 --> Each needed one edit, and in
both cases the assertion stays an exact whole-object `toEqual` — nothing is weakened or deleted.
**Both are now applied**; the text below is the proposal as written then, and it matches what
landed (modulo `pluginBuild` now being composed from `E2E_BUILD_MARKER` instead of hardcoded):

1. `plugin/src/__tests__/e2e-control.test.ts:197` (`buildPluginHost > sessionInfo maps
   settings + connection state`). Its `fakePlugin` has `canvasSync` but no `app` and no
   `manifest`, so the correct new expectation is:

   ```ts
   expect(host.sessionInfo()).toEqual({
     clientId: "cid", role: "guest", roomId: "room", connected: true,
     vaultId: "", vaultName: "", vaultPath: null,
     pluginBuild: "0.0.0+e2e", canvasSurface: true,
   });
   ```

2. `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:140`
   (`binds the numeric LIVESHARE_E2E port (order 1)`) — an **untracked staged copy**;
   the source of truth is `workflowArtifacts/canvas-v2/tests/visible/WP44/`, owned by
   WP44, which is why WP46 did not touch it. Its subject is the *port precedence*; the
   payload is only proof that a real control server owns the port. Its fixture plugin has
   neither `app`/`manifest` nor `canvasSync`:

   ```ts
   result: {
     clientId: "e2e-a", role: "host", roomId: "fixture-room", connected: true,
     vaultId: "", vaultName: "", vaultPath: null,
     pluginBuild: "0.0.0+e2e", canvasSurface: false,
   },
   ```

**Not blocking, not WP46's:** `npm run build` fails at its `tsc -noEmit` stage on
**pre-existing** errors in other WPs' staged visible tests — `canvasFile` and
`evaluateCanvasConvergence` do not exist on `E2EControlHost` yet (WP49) and
`src/canvas/canvas-ord` does not exist yet (WP13). After the WP46 change `tsc` reports
**zero** errors outside `src/__tests__/wp49/` and `src/__tests__/v2/wp13/`. The AC1 bundle
guard was therefore verified by invoking esbuild directly into a scratch path
(`h:\tmp`, since deleted) — `plugin/main.js` was **not** rebuilt or modified.

---

## 3. Changes Made

### 3.1 `plugin/src/testing/e2e-control.ts` — **purely additive, +123 lines, 0 deletions**

`git diff` confirms zero deleted lines. Four disjoint insertion regions (line numbers are
post-change):

| Region | Lines | What |
|---|---|---|
| `E2E_BUILD_MARKER` | `:63–71` | New exported const `"e2e"`, immediately above `export interface E2EControlHost`. Tests import it; the literal is never hardcoded. |
| `E2EControlHost.sessionInfo()` return type | `:79–86` | Five §6.2 fields appended, declared **optional** on the *interface* so the pre-WP46 four-field fake hosts in existing tests (`e2e-control.test.ts:21`, `wp49/test_tp4`, `wp49/test_tp12`) stay type-valid. `buildPluginHost` always populates all five. |
| `E2EPluginLike` | `:342–361` | Added `app?`, `manifest?`, `hasCanvasSurface?`. |
| Identity resolvers + `sessionInfo` body | `:390–442` (five module-private helpers, immediately above `buildPluginHost`) and `:466–481` (inside `sessionInfo`) | `safeCall`, `nonEmptyString`, `resolveVaultPath`, `resolveVaultId`, `resolveVaultName`, `resolvePluginBuild`, `resolveCanvasSurface`. |

**Untouched on purpose, so WP47 and WP49 do not collide with this WP:** `routeCommand`
and its `switch` (it already forwards the whole `sessionInfo()` payload, so `session.info`
needed no router change at all), `createControlServer`, `resolvePort`,
`maybeStartE2EControlServer`, `upsertRecord`, and every other method on the object
returned by `buildPluginHost`.

**Resolution rules** (all degrade, none throws, none guesses):

- `vaultId` — `app.appId` when a non-empty string, else the absolute vault base path, else `""`
- `vaultName` — `app.vault.getName()` when it returns a string, else `""`
- `vaultPath` — the adapter base path when a non-empty string, else **`null`** (never `""`)
- `pluginBuild` — `` `${manifest.version ?? "0.0.0"}+${E2E_BUILD_MARKER}` ``, always non-empty
- `canvasSurface` — `plugin.hasCanvasSurface()` when the hook exists (it wins), else `Boolean(plugin.canvasSync)`

**One deviation from the charter §7 type snippet, forced and deliberate.** §7 shows
`adapter?: { getBasePath?(): string }`. Typing it that way makes the real `LiveSharePlugin`
stop satisfying `E2EPluginLike` — Obsidian's public `DataAdapter` has no `getBasePath`
(it is a desktop-only `FileSystemAdapter` API), and TypeScript's weak-type check then
rejects `main.ts:430` with `TS2345`, breaking the build. Since charter §3 states as an
invariant that "the real `LiveSharePlugin` already satisfies" this interface, the adapter is
typed `unknown` and narrowed in exactly one guarded accessor inside `resolveVaultPath`.
Every visible test constructs its fixture with `as E2EPluginLike`, so all of them are
unaffected; the runtime behaviour is identical.

### 3.2 `tools/obsidian_e2e/readiness.py` — **new, standard library only**

Public surface, exactly as pinned by charter §7 plus one probe helper for WP48:

```python
@dataclass(frozen=True) class ReadinessVerdict: ready, reason, identities, detail
@dataclass(frozen=True) class EndpointAnswer:  role, url, answered, status, info, error
@dataclass(frozen=True) class RawAnswer:       status, body, error

probe_endpoints(endpoints, timeout_s, *, transport=None) -> dict[str, EndpointAnswer]
check_readiness(endpoints, configured_vaults, timeout_s, *, plugin_states=None, transport=None)
check_endpoints_gone(endpoints, timeout_s, *, transport=None)
```

- **Refusal ladder** (order is the diagnosis, most fundamental first): not-all-answered →
  `READINESS_TIMEOUT`; any answer missing a §6.2 field, or unparsable at all →
  `PLUGIN_NOT_E2E_CAPABLE`; a reported vault blank or outside `configured_vaults.values()`
  → `IDENTITY_UNKNOWN_VAULT`; the vaults equal → `IDENTITY_SAME_VAULT`; a blank room or two
  different rooms → `ROOM_MISMATCH`. Vault ids and rooms are compared **exactly** — no case
  folding, no trimming, no normalisation.
- **Bounded and named.** `probe_endpoints` runs one daemon thread per endpoint against a
  single deadline, so a pair of silent instances costs **one** timeout, not two, and an
  in-flight probe is abandoned rather than waited on. Every `detail` string starts
  `waited for: <condition>`.
- **`plugin_states=` — the environment-reality seam (contract §1.1).** Pass WP43's per-role
  plugin state (a string, or anything with `.plugin_state`, e.g. a `VaultInstance`) and a
  known-bad state short-circuits the check *without probing at all*: the installed build in
  both real vaults is a production build with no control server, which must surface as
  `PLUGIN_NOT_E2E_CAPABLE`, never as `READINESS_TIMEOUT`. A missing control server and a
  slow one are different diagnoses and WP50/WP51 depend on the distinction.
- **Teardown reason.** §7 pins no reason for a failed teardown. Rather than invent one
  (§7: no WP invents an ad-hoc reason string), `check_endpoints_gone` reuses the sanctioned
  `constants.WAIT_TIMEOUT`, whose whole contract is to name the awaited condition — here
  `waited for: control endpoints gone; still answering: ['a']`. **If Worker 3 core prefers a
  dedicated name, that is a one-line change here plus one in `constants.py`.**
- **No constant is redefined.** Every reason, command name, field name and path is imported
  from `obsidian_e2e.constants`; this module declares no reason string, no port and no field
  name of its own. Confirmed by grep: the only string literals in the module are dict keys
  of the outbound payload (built from `constants.CMD_SESSION_INFO`), `detail` text, and
  thread names.

### 3.3 Other files

- `tools/obsidian_e2e/__init__.py` — one docstring bullet and `"readiness"` added to `__all__`.
- `plugin/src/__tests__/wp46/` (new, untracked) — the four visible `.ts` files staged as
  `*.test.ts` so vitest's default glob picks them up, following the WP44/WP49 precedent. No
  `vitest.config.ts` change was needed.
- **Not created:** `tools/test_readiness.py`. No sibling WP in this batch created a
  `tools/test_<name>.py`; each visible test file is standalone-runnable via
  `run_as_script`, which is the same convention WP43–WP45 followed.

---

## 4. Visible Test Results

| Side | Command | Result |
|---|---|---|
| Python (TC5–TC14, 10 files + 1 support module) | `.venv\Scripts\python.exe -m pytest workflowArtifacts/canvas-v2/tests/visible/WP46 -q` (from the repo root) | **41 passed, 0 failed** (51.8 s) |
| TypeScript (TC1–TC4, 4 files) | `npx vitest run src/__tests__/wp46` (from `plugin/`) | **21 passed, 0 failed** (0.45 s) |
| **Total** | | **62 passed / 62, across all 15 visible files** |

**On the Python wall-clock.** ~1 s of each test is the *fixture's* own cost, not the
module's: `ThreadingHTTPServer.shutdown()` polls at 0.5 s, so stopping two stubs costs
~1.0 s. Measured directly — `check_readiness` against a live healthy pair returns in
**0.078 s**. Separately, on this Windows host a connection to a just-released ephemeral
port is **silently dropped rather than refused**, so a "gone" probe consumes its whole
budget (measured 0.203 s at `timeout_s=0.2`, 2.03 s at `timeout_s=3.0`). That is exactly
why the timeout is bounded and caller-supplied; teardown callers should pass a small value.

**Regression gate.** Full suite: **1015 tests, 989 passed, 26 failed** — every one of the
26 in `src/__tests__/wp49/` (WP49's `canvasFile` / `evaluateCanvasConvergence` not yet
implemented) or `src/__tests__/v2/wp13/` (`canvas/canvas-ord` missing), i.e. pre-existing
and untouched by WP46. Adding back the two assertions from § Blocked Items makes it 28.
The count **before** the WP46 change, with the visible tests already staged, was also 26 +
those 2 — no test outside § Blocked Items changed state in either direction.

---

## 5. Data safety

- No real Obsidian instance, no vault, no `%APPDATA%`, no `data.json` was contacted, read,
  written or hashed. Every test ran against in-process stubs on `127.0.0.1:0`, each of which
  asserts its own ephemeral port is neither `REAL_CONTROL_PORT_A` nor `REAL_CONTROL_PORT_B`.
- `plugin/main.js` was **not** rebuilt; the AC1 bundle check wrote to `h:\tmp` and the
  scratch bundles were deleted. `plugin/main.js` is byte-unchanged (sha256
  `0ad14107…5582df` before and after).
- `readiness.py` performs **no filesystem access of any kind** — no `open`, no `os`, no
  `pathlib`, no `subprocess`. Its only I/O is one `urlopen` carrying one frozen payload.

---

## 6. Summary for Worker 3

WP46 is implemented and green on all 15 of its own visible files (62/62). One decision is
yours: two pre-existing exact-shape `session.info` assertions are arithmetically
unsatisfiable under AC1 and were left failing rather than edited — § Blocked Items gives
the exact replacement text for both, each a strictness-preserving `toEqual`.

For **serialising WP47 and WP49 on `e2e-control.ts`**: the WP46 diff is **purely additive
(+123, −0)** and does not touch `routeCommand`, its `switch`, `createControlServer`,
`resolvePort` or `maybeStartE2EControlServer`. WP47 (`scratch.create` / `scratch.remove`)
and WP49 (`canvas.file`, `evaluateCanvasConvergence`) will add *methods* to
`E2EControlHost` and *cases* to the router; the only shared regions are the interface
blocks `E2EControlHost` (WP46 extended the `sessionInfo()` return type at `:79–86`, they
append sibling methods) and `E2EPluginLike` (WP46 added `app`/`manifest`/`hasCanvasSurface`
at `:342–361`). Both are appends into different parts of the same braces — a three-way
merge handles them, but running WP47 and WP49 **after** this change rather than against the
pre-WP46 file avoids the question entirely.

One thing WP49 should know: `E2E_BUILD_MARKER` is exported at `:71` and `DOC_CONVERGED_FILE_DIVERGED`
is currently expected by WP49's visible tests as an export of `e2e-control.ts` — WP46 did
not add it, so it is still WP49's to create.

---

## Attempt 2 — robustness

### Readiness is an assertion about a *successful* response, not a parseable one

**The gap.** `_parse_session_info()` was reached for any answer at all
(`info=_parse_session_info(got) if got.answered else None`), and `EndpointAnswer.usable`
asked only "did it answer, and did the body parse". A control endpoint that returned
`503`, `403` or `302` while serving a **perfectly well-formed** `session.info` body
therefore climbed every rung of the ladder — complete identity, distinct vaults, shared
room — and the run was declared **ready**. The visible tests never caught it because every
malformed-body case they exercise is served with a `200`; the status was only ever varied
*together with* the body.

**The fix — transport first, payload second, in one place.**

- `_is_success_status(status)` — one predicate, the 2xx class and nothing else. Redirects
  are not success either: a 3xx says the thing on that port is not the control endpoint.
- `RawAnswer.succeeded` / `EndpointAnswer.succeeded` sit next to `answered`, which keeps
  the two questions apart permanently. They are genuinely different questions and both are
  needed: teardown's `check_endpoints_gone` must keep treating *any* answer as a survivor
  (a half-torn-down instance returning 500 is still up), while readiness must not.
- `_parse_session_info()` returns `None` for anything that did not succeed **before it
  looks at the body**, so there is no ordering in which a good-looking payload can rescue a
  failed request.
- `_verdict_present()` gained a rung between "everyone answered" and "everyone answered
  with a complete identity": a non-2xx is refused under `PLUGIN_NOT_E2E_CAPABLE` — the same
  named reason a `400 {"ok": false}` already produced — with a detail that names the role
  and the status it returned.

**Why this generalises.** The rule is now a property of the status *class*, not a list of
statuses someone remembered: any non-2xx, with any body, on any role, is refused, and the
refusal is decided before parsing rather than after. Verified across `500`, `403`, `302`,
`404` and `199`, each carrying a byte-perfect two-vault-one-room identity pair — all
`ready=False` with a `constants.FAILURE_REASONS` name — while the all-2xx control case
stays `ready=True` and the teardown direction still reports a 500 as a survivor.

**Result.** Visible suite **266/266**; WP46's own 12 Python tests unchanged and green.

---

## Forward pointer — added by WP58 (batch B10)

The readiness-probe side-effect defect — `bump` called **2** times after a single
`canvas.simulateEdit` — is owned by **WP58**, not by this work package. WP46 remains `DONE`.
Its acceptance criteria, its §7 amendment-ledger entry, its test counts and its "open" note
are not reopened, reworded or re-litigated.

Nothing in this report was wrong. §1 AC2's structural argument ("exactly one outbound request
site, one module-level frozen payload") is **correct**, and `sessionInfo()` is provably inert:
it reads fields and returns them. The second bump never came from the probe. It came from a
redundant explicit `markActivity()` at the end of `simulateEdit`, which WP49 had made redundant
when it moved the activity seam onto the doc itself. A structural argument about the *request*
path could not have covered a duplicate count on the *edit* path — which is exactly why WP58
was given an observable acceptance criterion instead.

After the WP58 fix both WP46 blind sets are green with recorded non-zero collected counts:
**set1 22/22** (was 21/22, 1 failing) and **set2 19/19**.

> Note for the record: `TaskCharter_WP58_ProbeSideEffectFreedom.md` §2 cites this note as living
> in "§5" of this report. It does not — §5 here is "Data safety". The "Open, NOT caused by this
> amendment" wording is in `Worker3Handover_B9a_T3infra.md:223`. That handover's statement is
> accurate and is left unmodified.
