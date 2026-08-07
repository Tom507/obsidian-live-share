# Task Charter — WP58: Readiness probe side-effect freedom

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP58
**task_mode:** `standard`
**Depends on:** WP55
**W4 Test Targets:** `0`

---

## 1. Task Objective

- **Outcome:** Issuing the readiness handshake no longer perturbs the capture path — a probe followed by a single canvas edit advances the capture counter by exactly one, where it currently advances by two.
- **BUILD_SPEC reference:** §5 PHASE VI → **C58 — Readiness probe side-effect freedom**. The underlying properties are C46 AC2 ("no edit is issued") and C46 AC4 (re-runnable mid-run, reused by teardown).

---

## 2. Worker 2 ruling — why this is a new WP and not a reopening of WP46

This defect is a genuine **C46 acceptance-criterion violation**. The question put to Worker 2 was whether it reopens WP46 or becomes its own work package. **Ruling: its own work package. WP46 stays `DONE`.** Four reasons, in order of weight:

1. **WP46's closure record is sound and reopening would corrupt it.** WP46's `DONE` rests on an audited chain: a §7 amendment-ledger entry naming two assertions by file and line, a falsification check that perturbed one payload field and confirmed exactly the two amended assertions went red, and an md5-verified byte-clean restore. Reopening drags that settled record back into flux to carry a defect that is unrelated to it — the failure is on the *edit/bump* path, and `e2e-control.ts` is byte-identical to its pre-amendment state on that path.
2. **The evidence for the defect did not exist when WP46 closed, and could not have.** The blind test that catches it was never executed by any gate, because the runner could not discover it. WP46 was closed against the evidence available, and that evidence was honestly reported. Reopening the WP would retroactively recast a truthful closure as a negligent one and destroy the audit trail of what was known when.
3. **It needs its own acceptance criteria, and they are not C46's.** C46 AC2 states the no-edit property *structurally* ("the module has exactly one outbound request site... it sends one module-level frozen payload"). That reasoning is correct and the implementation satisfies it — yet the counter still advances twice, which means the side effect enters by a path the structural argument does not cover. The fix must therefore be gated on an **observable** property (§4 AC1–AC3), which is a different criterion from the one WP46 was graded against. Appending it to C46 would silently change what WP46's `DONE` ever meant.
4. **Project precedent.** The comparable case — WP4's I7 phasing escalation in B1/P0 — was resolved by Worker 2 through a ledger amendment and a forward-carried owner, not by reopening the closed WP.

**Consequences of the ruling, to be applied by Worker 3:**
- `TaskCharter_WP46_ReadinessIdentityHandshake.md` stays `DONE`. Add a single forward-pointer line to its §9 naming WP58 as the owner of the probe side-effect defect. Change nothing else in that charter.
- `ImplementationReport_WP46.md` §5's "Open, NOT caused by this amendment" note stays exactly as written — it is an accurate record — and gains the same forward pointer.
- WP46's ACs, its §7 amendment-ledger entry and its test counts are **not** reopened, reworded or re-litigated.

---

## 3. Scope and Boundaries

- **In scope:**
  - Whichever module owns the observed side effect — `plugin/src/testing/e2e-control.ts` (the `session.info` command and `buildPluginHost`) and/or `tools/obsidian_e2e/readiness.py`. **Locating it is part of the task**; the structural argument in `ImplementationReport_WP46.md` §1 AC2 is sound as far as it goes, so the second `bump` enters by a path that argument does not cover.
  - Making probe side-effect freedom observable rather than inferred.
- **Out of scope / non-goals:**
  - Any change to the four legacy `session.info` fields or the five identity fields added by WP46 AC1 — the nine-key payload is settled and pinned by two amended whole-object `toEqual` assertions.
  - Any change to the two amended assertions or to WP46's §7 amendment-ledger entry.
  - WP47's scratch layer, WP49's file oracle, and WP48's teardown paths, except where the fix is provably in a shared seam — in which case flag it before touching it, because those three WPs share `e2e-control.ts` and were deliberately serialised to keep edits additive.
  - Repairing the blind runner (WP55) or running the re-verification (WP56/WP57).
- **Known interfaces / dependencies:**
  - WP55 must be `DONE` — AC4 requires a recorded non-zero executed count, which the current runner cannot produce for WP46.
  - `plugin/src/testing/e2e-control.ts` carries three additive layers (WP46 identity, WP47 scratch, WP49 file oracle). The type pattern that lets them coexist under `tsc` is *optional on the base interface, required on a narrowed return type*: `E2EControlHost` → `E2EScratchControlHost` → `E2EFileControlHost`. A required member on the base breaks the three hand-rolled `fakeHost()` literals.

---

## 4. Architecture Context

- **Component(s) being changed:** C58; `readiness.py` and/or the `session.info` path in `e2e-control.ts`.
- **Interfaces involved:** input is a readiness probe against a live control endpoint followed by an ordinary canvas edit; output is the same readiness verdict with the subsequent edit accounted exactly once.
- **Constraints from BUILD_SPEC:**
  - C46 AC1: the added fields change nothing in production and `src/testing/` still tree-shakes out. **This must still hold after the fix** — verify with a production esbuild bundle greping to 0 matches for `e2e-control|LIVESHARE_E2E|e2eControlPort`, and confirm the same bundle built with `__LS_E2E__=true` does match, so the 0 is real elimination and not a false negative.
  - C49 AC1: `buildPluginHost` subscribes `markActivity` to `update` on every `Y.Doc` it reaches, idempotently via a `WeakSet<Y.Doc>`, and **never inspects origin**. That is deliberate — it is what makes peer-originated updates count. Do not "fix" the double-bump by making the activity seam origin-sensitive without escalating: that would silently revert WP49 AC1.
  - §7: no test may be weakened to make this green. The blind test is the oracle; fix the implementation.
- **Technology / framework / config constraints:** Vitest 4.0.18 (no `basic` reporter); `PYTHONIOENCODING=utf-8`; pytest from the repo root; `sys.path.insert(<repo>/tools)` + `from obsidian_e2e import …`.
- **Entry points / relevant files:** `plugin/src/testing/e2e-control.ts`; `tools/obsidian_e2e/readiness.py`; the failing oracle `tests/blind_set1/WP46/test_probe_side_effect_free_blind1.ts`.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

**The observation, precisely.** `test_probe_side_effect_free_blind1.ts > does not disturb an edit that follows it`: `expect(bump).toHaveBeenCalledTimes(1)` receives **2** after a single `canvas.simulateEdit`. Deterministic across three runs, not flaky. It appeared the first time WP46 blind_set1 was executed correctly, via a throwaway runner, and had been concealed by every prior "green" because the set was never executed at all.

---

## 5. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C58.*

1. Issuing the readiness probe does not cause, duplicate, suppress, delay or reorder any subsequent capture: after a probe followed by a single canvas edit, the capture counter advances by exactly one. The currently observed behaviour is an advance of two, deterministically across repeated runs.
2. The C46 property "any of the three failing aborts the run under a distinct named reason and **no edit is issued**" holds observably and not merely structurally: the probe's effect on the edit path is asserted by test, not inferred from the absence of an outbound edit request.
3. The C46 property "the same check is re-runnable mid-run and is reused by teardown to confirm the endpoints are gone" holds without accumulating side effects: N consecutive probes followed by one edit still advance the capture counter by exactly one, for N greater than one.
4. The fix is verified under the repaired C55 runner with a recorded non-zero executed count for both WP46 blind sets, and the failing blind test `test_probe_side_effect_free_blind1.ts > does not disturb an edit that follows it` is fixed by changing the implementation, not the test. No blind or visible assertion is edited, and the WP46 test count does not change.
5. C46's existing acceptance criteria and its §7 amendment-ledger entry are not reopened, reworded or re-litigated; WP46 remains `DONE` and this work package carries the defect forward under its own charter.

**Definition of Done:** The readiness probe can be issued as often as the rig needs without perturbing what the rig is trying to measure — demonstrated by both WP46 blind sets green with recorded non-zero collected counts.

---

## 6. Constraints and Known Risks

- **Permission / environment limits:** Windows; no real Obsidian instance is required — the defect reproduces in the blind set against injected seams.
- **Known flaky patterns:**
  - The tempting quick fix is to make the activity seam ignore updates whose origin is the probe. **That is a WP49 AC1 regression** (the seam must never inspect origin) and is an escalation, not a fix. If the correct fix genuinely requires touching that seam, say so and escalate before editing.
  - `e2e-control.ts` is shared by WP44, WP46, WP47 and WP49, which were serialised specifically so their edits stayed additive. A non-additive edit here can silently break a sibling WP's verified property. Verify the sibling regions are byte-preserved, as B9a did.
  - `session.info` for WP46 has a **frozen module-level payload** (`_SESSION_INFO_BODY`) and exactly one outbound request site. The extra bump is therefore unlikely to be an extra request — look for a subscription, listener, or doc-reach registered as a side effect of probing.
- **External dependency risks:** no new runtime dependency (D11); the workspace 7-day npm policy applies if any package is proposed.
- **Hard constraints:**
  - Fix the implementation, never the test. Weakening a test to make a suite green is an abort, not a fix.
  - The nine-key `session.info` payload and both amended assertions stay exactly as they are.
  - Production tree-shaking of `src/testing/` must still be verified empirically after the change, both directions.
  - WP46's charter and report are edited **only** to add the forward-pointer line described in §2.

---

## 7. Definition of Done Artifacts

- **Required changed files:** `plugin/src/testing/e2e-control.ts` and/or `tools/obsidian_e2e/readiness.py`; a one-line forward pointer in `TaskCharter_WP46_ReadinessIdentityHandshake.md` §9 and in `ImplementationReport_WP46.md` §5.
- **Required report:** `ImplementationReport_WP58.md`, stating where the second bump originated, why the C46 structural argument did not cover it, and the recorded collected counts for both WP46 blind sets before and after.
- **BUILD_SPEC updates required:** no — C58 is already written. If the fix turns out to require changing a C46, C47 or C49 acceptance criterion, **escalate to Worker 2** instead of editing.
- **Gate status required at handover:** all visible tests PASS; both WP46 blind sets green with non-zero recorded collected counts; production bundle greps to 0 for the control-module markers with the `__LS_E2E__=true` counter-check confirming the 0 is real.

---

## 8. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent.*
