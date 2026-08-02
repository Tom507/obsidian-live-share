# Task Charter — WP59: WP3 round-trip blind amendment (set2, and set1's bare-edge pin)

<!-- Updated: licence extended to the two `edges.bare` pins in BOTH sets after B13's re-measurement unmasked them; §2's out-of-scope claim about `edges.bare` corrected — it was false 2026-08-02 -->

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP59
**Phase:** VI
**task_mode:** `standard`
**Depends on:** WP16, WP55, WP56 · **and on batch B2 being closed** (see §5 — this is a hard gate, not a preference)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the two failing assertions in `tests/blind_set2/WP3/test_value_preservation_blind2.test.ts` pin WP16's V2 reader shape through the decode bridge instead of the pre-WP16 flat shape, and the WP3 set2 ledger row goes from DIVERGENT to CONFIRMED without any loss of strictness.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C59 — WP3 round-trip blind amendment** (work package WP59); phase **VI**. Licensed under the §7 amendment ledger.

---

## 2. Scope and Boundaries

- **In scope:**
  - Amending exactly **two** assertions in `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts`:
    - line 54, in `"returns every node byte-for-byte through serialise → parseCanvas"`
    - lines 76–78, in `"preserves an edge's optional fields and adds none"`
  - <!-- Updated: licence extended by the B13 escalation ruling 2026-08-02 --> **Extended scope — the two `edges.bare` pins, one per set.** Both read the *pre-WP10-AC5* reader shape and are the same staleness class as the two rows above:
    - `blind_set2/WP3/test_value_preservation_blind2.test.ts:103` — `Object.keys(parsed.edges.bare)` pinned as `["fromNode","id","toNode"]`, read off `parsed` while its sibling assertion at `:91` already reads `flat`.
    - `blind_set1/WP3/test_file_shape_tabs_blind1.test.ts:79` — `parsed.edges["e-only"].fromNode` pinned as `"ghost-a"`.
  - Adding the matching entries to the §7 amendment ledger in `BUILD_SPEC_CanvasV2.md`, each naming file, line and reason.
  - Re-running **both** `WP3` sets under the WP55 runner and updating both `BlindVerificationLedger.md` rows.
- **Out of scope / non-goals:**
  - The remaining tests in either file (`parsed.nodes.long.text` at set2 `:74–75`; set1's four other tests). They pass and must keep passing.
  - Any change to `plugin/src/canvas/canvas-canonical.ts`, `plugin/src/files/canvas-sync.ts` or any other production file. **This WP changes test expectations only.** If the implementation turns out to be wrong, that is an escalation, not a local fix.
  - WP3's, WP10's and WP16's charters and ACs are not reopened. WP16 stays `DONE`; WP10 AC5 stands.

> **CORRECTION (2026-08-02) — this charter's original out-of-scope clause was false, and the reason matters.**
>
> It read: *"`edges.bare` … passes precisely because `encodeEndpointFromFile` refuses to build a half endpoint, which is a data-preservation guarantee this WP must not disturb."* Both halves are wrong.
>
> 1. **It was not passing.** It was *unreachable* — the `:76` failure earlier in the same test body threw first, so `:79` had never executed in any measurement anyone had taken. The fence was placed on an assertion whose state nobody had observed.
> 2. **The stated reason was the bug, described as the guarantee.** "`encodeEndpointFromFile` refuses to build a half endpoint" was written against the *pre-AC5* codec. WP10 AC5 had already landed: a side-less `{fromNode}` is not a half endpoint, it is a **whole** one, and `node` alone decides presence. The refusal this charter credited as a data-preservation guarantee is precisely the over-constraint AC5 exists to remove — the one that read a fully-connected edge as dangling and then wrote it out of the user's `.canvas` file. The charter fenced off the assertion *because of* the defect, and cited the defect as the reason to protect it.
>
> The root error was reasoning about `encodeEndpointFromFile`'s semantics from memory of an earlier tree instead of re-reading it after WP10 was reopened. See §7's fenced-off-claim rule, which generalises this.

---

## 3. Architecture Context

- **Component(s) being changed:** C59 — one blind test file plus the §7 ledger. No production code.
- **The finding, and why it is stale rather than a defect:**
  - The **file bytes are unchanged.** `serializeCanonicalCanvas` (`plugin/src/canvas/canvas-canonical.ts:235-237`) still emits flat `.canvas` keys, and `canonicalizeRecord` (`:140-164`) is a pure reordering that adds and removes nothing. `canvas-canonical.ts` has **no** working-tree diff.
  - The **reader** changed, deliberately and by charter. `parseCanvas` (`plugin/src/files/canvas-sync.ts:283-314`) now maps records through `toV2Node` (`:208-234`) and `toV2Edge` (`:245-281`), collapsing `x,y` → `pos`, `width,height` → `size`, `fromNode/fromSide/fromEnd` → `from`, `toNode/toSide/toEnd` → `to`. That is `TaskCharter_WP16_ParseCanvasV2OrdCapture.md` AC1 verbatim, recorded DONE at `ImplementationReport_WP16.md:26` and `:104` ("Same name, same export, new shape").
  - **Nothing is lost.** `decodeCanvasDataToFlat` (`canvas-sync.ts:364-374`) is the exact inverse and is applied immediately at every internal `parseCanvas` call site (`:979`, `:1148`, `:1379`, plus `canvas-persistence.ts`'s `coldOpen`). `toV2Node`/`toV2Edge` pass every non-register key through verbatim and both carry an explicit "keep the flat keys rather than lose them to a half-built register" fallback (`:229-232`, `:277-279`).
  - **Precedent already set and accepted.** The *identical* breakage in the visible WP3 test was escalated by WP16 as a stale expectation (`ImplementationReport_WP16.md:41-57`, `:251`, `:347-348`) and has since been amended to read through the bridge: `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts` now asserts `decodeEndpointToFile("to", data.edges.e1.to).toSide`, with the rationale recorded inline. This WP applies the same, already-sanctioned resolution to the blind half.
- **Entry points / relevant files:** the blind file above; `canvas-sync.ts` `decodeCanvasDataToFlat` / `decodeEndpointToFile` (read-only); `BUILD_SPEC_CanvasV2.md` §7.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C59.*

1. The two named assertions are amended to assert the round trip **through the decode bridge** (`decodeCanvasDataToFlat`, and `decodeEndpointToFile` where an endpoint is involved), so that the property under test is unchanged: a node's and an edge's full key set survives `serialise → parseCanvas → decode` with nothing added and nothing lost. The subject of each test — value preservation — is preserved exactly; only the shape the assertion reads is corrected.
2. **Strictness does not fall.** Each amended assertion remains a whole-collection exact `toEqual` over the complete sorted key list. No `toMatchObject`, no `expect.objectContaining`, no subset match, no key-count check, no `skip`/`only`, and no destructuring away of the register keys. The amended form is **stricter than before**: it now also pins the invertibility of the V2 register bridge, which nothing pinned previously.
3. The test count in the file does not change — four tests before, four after — and the two currently-passing tests in the file still pass unmodified.
4. Both amendments are entered in the §7 amendment ledger with file, line and reason, and `WP3 set2` is re-run under the WP55 runner with a recorded non-zero collected count, its `BlindVerificationLedger.md` row updated from DIVERGENT to its measured verdict.

<!-- Updated: AC5 + AC6 appended by the B13 escalation ruling — the two bare-edge pins are the same class and are licensed 2026-08-02 -->

5. **The two `edges.bare` pins are amended to read the round trip through the same sanctioned inverse**, one per set. The property each test is about — *a bare, side-less edge survives the round trip with its endpoints intact and gains no key* — is unchanged; only the shape the assertion reads is corrected.
   - set2 `:103` (Worker 3's handover calls this `:79` in the **pre-amendment** numbering — the WP59 comment blocks shifted it; there is no separate `:79` site left in set2): `Object.keys(parsed.edges.bare)` becomes `Object.keys(flat.edges.bare)`, keeping the exact `toEqual(["fromNode","id","toNode"])` whole-collection form verbatim. `flat` is already bound at `:89` in the same test — no new import, no new binding.
   - set1 `:79`: `parsed.edges["e-only"].fromNode` is read through `decodeCanvasDataToFlat(parsed)` instead. The test's stated subject, *"stays readable by the unchanged parseCanvas, including edge-only content"*, survives verbatim; `parseCanvas` is simply no longer "unchanged" in shape, and the file it reads is byte-identical either way.
6. **Strictness rises, and specifically on the property that was never pinned here.** Each amended site additionally pins, with an exact whole-object `toEqual`, that the side-less endpoint decodes to its `*Node` key **and no `*Side`/`*End` key at all** — i.e. `decodeEndpointToFile("from", …)` equals exactly `{fromNode: …}`. That is AC5's actual contract and the thing a regression would break: an implementation that re-emitted `fromSide: null` or `fromSide: ""` would satisfy the key-set check on `flat` but fail this. Test counts in both files are unchanged.

**Definition of Done:** both WP3 sets are green for the right reason — because the round trip genuinely preserves every value — and not because an assertion was loosened.

**Verification already performed by Worker 2 (do not re-derive, but do not skip falsification either):** `plugin/src/__tests__/v2/wp17/test_tp13_sideless_edge_file_byte_identical_round_trip_visible.test.ts` is **green, 5/5, measured 2026-08-02**. It pins that a `.canvas` file carrying side-less edges survives `parse → doc → serialize` **byte-identically** through *both* doc vocabularies, that no `null`/`""` is emitted for an omitted optional endpoint key, and that `buildCanvasData` emits exactly `{id, fromNode, toNode}` for the bare edge. The round-trip claim underlying this licence is therefore measured at the level of file bytes, not argued from the codec.

---

## 5. Constraints and Known Risks

- **Hard gate — batch B2.** B2 is live in `plugin/src/canvas/**` and `plugin/src/files/**`, and `canvas-sync.ts` currently carries a large uncommitted diff (+643/−65) that **is** B2's in-flight P1 work. **This WP must not start until B2 is closed.**
- **The ruling is provisional on B2's final state, and this matters.** The evidence that this is a stale expectation was gathered against a working tree B2 is still editing. The reader/decoder pair was complete and invertible when inspected — no `TODO`/`FIXME`/`WIP` anywhere in `canvas-sync.ts`, `canvas-canonical.ts` or `canvas-persistence.ts`, and no function silently dropping optional keys — but that is a snapshot. **Re-measure `WP3 set2` after B2 closes and before amending anything.** If the failure has changed shape, or if new keys are missing that the decode bridge does not restore, this is a **real defect** and the charter is wrong: stop and escalate rather than amending.
- **Hard constraint — the anti-weakening rule (§7 abort criteria).** Weakening a test to make a suite green is an abort, never a fix. If the amended assertion cannot be made to pass while staying an exact whole-collection `toEqual`, leave it failing and escalate. An amendment that no longer fails when the payload drifts is worse than the failure it replaced.
- **Do not touch production code.** The correct amendment reads through an existing, exported bridge function. If it appears that a production change is needed to make the test expressible, that is the signal that this is a real defect — escalate.
- **Known flaky patterns:** none in this file; it is a pure serialise/parse round trip with fixed fixtures.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts` (two assertions **+ the `edges.bare` pin**), <!-- Updated: set1 added 2026-08-02 --> `workflowArtifacts/canvas-v2/tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts` (one assertion), `BUILD_SPEC_CanvasV2.md` §7 (ledger entries), `BlindVerificationLedger.md` (both WP3 rows).
- **Required report:** `ImplementationReport_WP59.md` — must quote the before and after form of each amended assertion in full, so a reader can verify strictness did not fall without opening the test file.
- **BUILD_SPEC updates required:** yes — §7 amendment ledger, **four** rows (two landed, two added by this ruling).
- **Gate status required at handover:** **both** `WP3 set1` and `WP3 set2` CONFIRMED with non-zero collected counts; all visible tests PASS; plugin test count unchanged.
- **Falsification required per new site** (§7 class conditions): perturb the surface each amended assertion pins and confirm it goes red *alone*. The cheapest perturbation for both bare-edge sites is making `decodeEndpointToFile` emit `fields[keys.side] = ""` unconditionally — the amended assertions must catch it, and `wp17` TP13 must go red too. Restore byte-clean with sha256 verification, as B13 did.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent. Worker 2 leaves this section empty.*
