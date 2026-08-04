# Task Charter — WP72: `canvas.setFlag` — the borrow-clobber and the inert flag map

<!-- Updated: chartered 2026-08-04 — verified against the current tree per hard-won rule 12. `setFlag` calls plugin.saveSettings() for any name that is an existing settings key, rewriting from the live in-memory copy the exact data.json WP70 borrows and WP7 AC6 checks against an independent baseline. No charter names this. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP72
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP51
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the gate's own control surface can no longer destroy the settings borrow its verdict is checked against, and it can no longer report success for a flag that does nothing.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C72 — `canvas.setFlag`: the borrow-clobber and the inert flag map** (work package WP72); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/testing/e2e-control.ts` — `setFlag` in `buildPluginHost` and the `runtimeFlags` map it writes)
  - Responsibility: stop a control command from rewriting the settings file the gate's restore depends on, and stop it reporting success for a flag nothing consumes.
  - Scope summary: the control surface stops rewriting the borrowed `data.json`; in-memory overrides are session-scoped and reversible; the return value stops conflating applied / refused / inert
- **Out of scope / non-goals:**
  - **C51 AC3's rejection rule.** *"A runtime flag the control server accepts is actually read by the code path it names; a flag no path consults is rejected at the command boundary rather than silently stored"* belongs to **WP51** and is neither restated, weakened, nor re-implemented here. This WP owns the **file-write behaviour** of the accepted branch and the **truthfulness of the return value** — neither of which C51 AC3 reaches. See §3 for why they are separable.
  - **Any change to the settings schema.** No key is added, removed, renamed or given a new default. `LiveShareSettings` is read, never redesigned.
  - **Any change to `plugin/src/main.ts`'s settings load or `saveSettings` itself.** The defect is a control command calling a legitimate persistence API at a moment it must not; the API is not the defect.
  - **Any file outside `plugin/src/testing/`.** Test files are Worker 3's.
  - **The rig side.** `tools/obsidian_e2e/**` and the borrow in `ports.py` are not touched. WP70 owns the borrow; this WP stops something else writing over it.
  - **Provisioning-time ordering.** C70 AC4 already refuses provisioning into a vault whose plugin is loaded, under `RESTART_REQUIRED_OPERATOR`. That is a different source of the same corruption and stays with WP70.
- **Known interfaces / dependencies:**
  - Input: a control `canvas.setFlag` command naming a flag and a value
  - Output: a disposition the caller can act on — applied, refused, or refused-because-inert — and, on the applied path, a bounded and reversible effect on the instance that never rewrites the borrowed settings file
  - Depends on work packages: **WP51**, which owns the same function's rejection rule. Landing this WP first would force WP51's implementor to reason about a boundary that had just moved underneath them; landing WP51 first leaves this WP a narrower, better-understood surface.
  - **WP7 depends on this WP.** WP70 does not — its borrow is verified against fixture vaults, and the clobber is a run-time interaction, not a defect in the borrow.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** `canvas.setFlag` — the borrow-clobber and the inert flag map
- **Interfaces involved:**
  - Input: a control `canvas.setFlag` command naming a flag and a value
  - Output: a disposition the caller can act on, and an applied path that never rewrites the borrowed settings file
- **Verified against the current tree (hard-won rule 12), 2026-08-04 — given, do not re-derive.** `setFlag(name, value)` in `buildPluginHost` tests `Object.prototype.hasOwnProperty.call(plugin.settings, name)`. **Two distinct defects share the one function.**
  - **(a) Borrow-clobber — named by no charter, and it is the dangerous one.** On the true branch it assigns into the live `plugin.settings` object and calls `plugin.saveSettings?.()`, which rewrites the whole of `<vault>/.obsidian/plugins/live-share/data.json` **from the in-memory copy**. C70 AC1 borrows that exact file byte-exactly and restores it verbatim; C50 AC6 and C7 AC6 then compare it, post-teardown, against an **independent** sha256 baseline the rig did not produce, and **a mismatch fails the run**. So the failure mode is: the gate issues one of its own control commands, the file stops hashing back to its baseline, and the gate fails on data safety with the cause looking like a WP44 restore bug. Every canvas-relevant settings key the gate cares about — `useCanvasBinding`, `showCanvasPresence`, `showCanvasCursors`, `sharedFolder`, `roomId`, `serverUrl` — is an existing key, so the **natural** use of this command takes the true branch. C70 AC4 records the general shape of this hazard (*"any later `saveSettings()` in that live instance writes its in-memory copy back over the rig's file"*) but attributes it to late provisioning, not to a command the gate itself issues mid-run.
  - **(b) Inert map — the vacuity C51 AC3 targets, restated here only as the boundary the two share.** On the false branch the value goes into `runtimeFlags` (`plugin/src/testing/e2e-control.ts:803`), which is **written at exactly one site and read by nothing in `plugin/src`** — grep-verified against the current tree. The function returns `{ set: true }` for **any** name whatsoever, so a caller cannot distinguish a flag that was applied, a flag stashed where nothing will read it, and a flag that does not exist.
- **Why this is its own work package and not an extra AC on WP51.** C51 AC3 is the *rejection rule*; C72 is the *file-write and truthfulness* rule. They are separable, and the tree proves it: **C51 AC3 can be satisfied in full while `setFlag` still rewrites `data.json` for every accepted name** — which is exactly the state the tree is in today, since AC3 is not yet implemented and the clobber exists independently of it. Folding this into WP51 would leave the borrow-clobber with no criterion of its own, the same argument that separated WP63 from WP18, WP67 from WP66, WP68 from WP26 and WP69 from WP50. It is also a different blast radius: WP51's failure mode is a scenario that does not reproduce; this one's is the owner's settings file and the gate's data-safety verdict.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **The production bundle is unchanged.** The whole of `src/testing/` still tree-shakes out of the production `main.js` (`__LS_E2E__` false), and no file outside `plugin/src/testing/` is modified. This is C7 AC4's property and is not to be re-established by weakening it.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If this WP believes it must, that is an ESCALATE.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - **Zero new runtime dependencies.**
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41.
  - **`data.json` holds live credentials.** No byte, key value or credential is ever printed, logged, echoed into a report or handover, or placed in a fixture. Comparison is **sha256-of-bytes only**.
- **Technology / framework / config constraints:**
  - The control server is `node:http` bound to `127.0.0.1`. `POST /command` takes `{cmd, args}`; there is no handshake and no auth — localhost plus the `__LS_E2E__` build gate is the boundary. No new transport, no new command family beyond what the criteria require.
  - **Schema impact:** none. No doc format and no `.canvas` file-format change.
- **Entry points / relevant files:**
  - `plugin/src/testing/e2e-control.ts` — `setFlag` in `buildPluginHost` (the `hasOwnProperty` branch, the `plugin.saveSettings?.()` call and the unconditional `return { set: true }`); the `runtimeFlags` map at `:803`; the `E2EControlHost.setFlag` signature at `:286`; the `case "canvas.setFlag"` route at `:392–393`
  - `plugin/src/main.ts` — the settings load at `:408–417` and `saveSettings`, **read-only context**: this WP changes neither
  - `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` §5 **C51** — the adjacent rejection rule this WP must not absorb
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C72. No paraphrasing.*

1. **A control command cannot rewrite the borrowed settings file.** `setFlag` performs no `saveSettings()` and no other write to `data.json`, by any path, for any name, including names that are existing settings keys. The behaviour that made this possible is removed rather than guarded by a caller-supplied option: a flag whose effect requires persistence is refused at the command boundary under a distinct named reason. This is demonstrated, not asserted — with the file's sha256 taken before and after a `setFlag` of an existing settings key and shown unchanged, per the credential rule of hash-only comparison.
2. **An in-memory settings override, where one is still wanted, is explicitly scoped to the session and is reversible.** Any value the command applies to the live instance is applied to the in-memory state only, is recorded so the instance can be returned to its prior in-memory value through the protocol, and does not survive the instance. Nothing in the applied path may reach a persistence call, and a plugin whose `saveSettings` is invoked by an unrelated code path must still restore to the borrowed bytes.
3. **The return value distinguishes the outcomes it currently conflates.** `{ set: true }` is returned only when the named flag was applied to a path that consumes it. A name that is refused, and a name accepted only into a store nothing reads, are each reported as their own outcome and never as success. The criterion is falsified by calling `setFlag` with a name in each class and showing the three responses differ — a single response shape for all three is the defect, not a simplification.
4. **No production canvas module gains a branch, and the production bundle is unchanged.** The whole of `src/testing/` still tree-shakes out of the production `main.js` (`__LS_E2E__` false), and no file outside `plugin/src/testing/` is modified.

**Definition of Done:** the gate's own control surface can no longer destroy the settings borrow its verdict is checked against, and it can no longer report success for a flag that does nothing.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget ≥90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known risks specific to this WP:**
  - **⚠ The obvious repair is the wrong one.** Adding a `persist: false` option, or guarding the `saveSettings()` call behind a caller-supplied flag, leaves the clobber one argument away and makes the gate's data safety depend on every future caller remembering. AC1 says the behaviour is **removed**, not gated, for exactly this reason. A charter that permitted a guard would be a charter that permits the defect on the default path.
  - **⚠ Do not "fix" this by making `setFlag` reject every existing settings key.** That looks like AC1 and is not: it would also remove the only way to put an instance into a state the stale-view scenario needs, and it would make the refusal indistinguishable from C51 AC3's refusal, collapsing two criteria that must stay separable. AC2 exists to keep an in-memory override available.
  - **⚠ The AC3 falsification is the one most likely to be faked.** Three names must produce three *distinguishable* responses. A repair that returns `{set:true}` / `{set:false}` / `{set:false}` has merged two of the three classes and has not satisfied AC3 — and it would go green against a test that only checked "not always true". Falsify with one call per class and compare all three, not with a single negative case.
  - **The instance may hold a stale in-memory copy independently of this WP.** Settings are read once at load (`main.ts:408–417`), so an instance started before the rig provisioned still holds the pre-provision values. That is C70 AC4's ordering problem, not this WP's, but AC2's "restore to the prior in-memory value" must not be confused with restoring the file.
  - **This function is on the gate's critical path and is currently unexercised on a real host.** No control endpoint has ever answered on this host — **measured** 2026-08-04, both real control ports probed free with nothing listening. Every criterion here is decided under the `plugin/` vitest gate, and nothing about a live instance may be claimed.
- **Known flaky patterns:**
  - No timing-based suppression: no new `setTimeout` waits and no new timing constants.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - **No write to `data.json` from this command, by any path, for any name.** This is AC1 and it is also the boundary of the WP.
  - **No file outside `plugin/src/testing/` is modified.**
  - **`data.json` comparison is sha256-of-bytes only**; no credential in any artefact, report, log or fixture.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP72 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/testing/e2e-control.ts`
- **Required report:** `ImplementationReport_WP72.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the AC1 sha256 before/after demonstration, expressed as **match** with no file content and no key value; the three distinguishable AC3 responses, by class; the grep evidence that no `saveSettings` call remains reachable from `setFlag`; and the AC4 production-bundle check (zero `__LS_E2E__`, zero `e2eControlPort` / `LIVESHARE_E2E` / `e2e-control` markers) against a freshly built bundle rather than an inherited measurement.
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Location: `workflowArtifacts/canvas-v2/tests/visible/WP72/` · staged to `plugin/src/__tests__/wp72/`
**after** implementation (mirroring a generated-but-unimplemented suite breaks `npm run build`
repo-wide — the B9b lesson, reverted at `6b20c17`).

| File | AC | Test points |
|---|---|---|
| `test_tp1_setflag_never_writes_the_borrowed_settings_file_visible.test.ts` | AC1 | sha256 unchanged across five existing settings keys with `saveSettings` spied at 0 calls, while the in-memory effect *does* land; **FALSIFICATION** — the same oracle moves when the removed `saveSettings()` call is made explicitly; unknown name reaches no persistence; the whole router path incl. `canvas.clearFlags` leaves the file byte-identical; a caller asking for `persist` is refused by name with the host never reached and the file untouched (`persist:false` too); STRUCTURAL — zero `saveSettings` call sites survive in the module with comments stripped |
| `test_tp2_override_is_session_scoped_and_reversible_visible.test.ts` | AC2 | override applied in memory and reversed through `canvas.clearFlags`; the prior value is captured on the **first** override, not the last; **an unrelated `saveSettings()` after `clearFlags` writes the borrowed sha256**; **FALSIFICATION** — without the `clearFlags` it writes a different one; an override does not survive the instance (a second host holds no journal, the first still can reverse); `clearFlags` idempotent and clears the runtime stash; a host that cannot reverse gets a structured 400 |
| `test_tp3_three_distinguishable_dispositions_visible.test.ts` | AC3 | one call per class, **all three whole responses compared pairwise** (`Set(…).size === 3`) — not a single negative case; each is the outcome it claims; success is reserved to the applied class across five inert/edge names; the classifier is read-only; I11 — an inert report destroys neither an unrelated override nor the reversal record; a host that cannot classify keeps its pre-WP72 answer verbatim |
| `test_tp4_no_production_branch_and_no_new_transport_visible.test.ts` | AC4 | imports still inside WP49's frozen allow-list; exactly one `.listen(` and one `createServer(`, no WebSocket; no canvas module mentions `setFlag`/`clearFlags`/`flagConsumer`/`runtimeFlags`/`settingsOverrides`/`e2e-control`/`__LS_E2E__`; no canvas module imports `testing/`; `main.ts` untouched |

**Credential rule observed throughout:** hash-only comparison, no real vault opened, no real
`data.json` read; every fixture is a throwaway file in the OS temp dir with non-secret contents.

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
