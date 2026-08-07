# SPEC 04 — Phasing & Acceptance

> How the canvas redesign lands incrementally without ever breaking text sync, and
> the acceptance gate for each phase. **Spec only — no code yet.**

Related: `SPEC_01_CanvasBinding.md`, `SPEC_02_CanvasModelBridge.md`,
`SPEC_03_Persistence.md`, `../CANVAS_SYNC_REDESIGN.md`.

---

## 0. Ground rules for every phase

- **Text sync stays green.** The full existing vitest suite (currently 440) passes
  after every phase; the shared `SyncManager`, awareness, relay, and `yCollab` path
  are never modified for canvas.
- **Ship behind reality, not flags-forever.** A temporary `useCanvasBinding`
  setting (default OFF) lets host+guest opt into the new path during Phases 2–3 so
  the legacy bridge remains the fallback until acceptance. Removed in Phase 5.
- **Every phase is independently revertable** (git) and leaves the plugin buildable
  and usable.
- **Manual E2E is the user's** (no GUI automation). Each phase names the exact
  two-vault check the user runs.

---

## 1. Phase 0 — Prove the contract (headless, no plugin wiring)

**Build:** `CanvasBinding` (SPEC_01) + a fake `CanvasModelBridge` + the two-peer
harness. No `main.ts` changes.

**Acceptance (automated):** SPEC_01 tests **T1–T10** green, especially:
- T4/T5 no-echo (sync + async),
- T6 streamed drag → follower converges with **zero** re-push,
- T7 concurrent different nodes,
- T10 minimal-diff no-op.

**Gate:** T1–T10 green + full suite green. This locks the race-free contract before
any production code moves. **No user test** (nothing shipped).

---

## 2. Phase 1 — Persistence split (no behaviour change yet)

**Build:** extract `CanvasPersistence` (SPEC_03 §3) as a standalone downstream
writer observing the Y.Doc. Re-point the *current* `CanvasSync` disk writes through
it. `reconcileLiveCanvas` still runs (legacy path unchanged) — this phase only
separates "write the file" from "drive the view," proving the writer produces zero
CRDT writes.

**Acceptance (automated):** SPEC_03 persistence tests green; existing canvas-sync
tests green (adjusted for the extraction); full suite green.

**User test:** none required (no functional change); optional smoke test that a
single-side edit still persists.

---

## 3. Phase 2 — Reentrancy apply (binding drives the view, flagged)

**Build:** behind `useCanvasBinding`, replace `reconcileLiveCanvas` with
`CanvasBinding.applyRemote` over a **partial** model bridge (remote→model mutators
via the existing `applyNodeGeometry`/`setData`; capture still OFF — local edits
still flow through the legacy `handleLocalModify`). This isolates the follower-apply
path and proves the flag kills the echo.

**Acceptance (automated):** apply-path unit tests; suite green.

**User test (the decisive one):** with the flag ON in both vaults, **the guest
drags; watch the host.** The host must NOT scatter. This is the direct retest of
the reported failure. (Bidirectional still imperfect because capture is legacy —
expected.)

---

## 4. Phase 3 — Model-layer capture (close the loop, flagged)

**Build:** implement the full `CanvasModelBridge` (SPEC_02), including the
interaction-signal + snapshot-diff **capture** (SPEC_02 §4) with `isApplying()`
suppression. Behind the flag, local edits now flow model→CRDT via the binding.
Requires the **Phase-0 spike** (SPEC_02 §9) completed first to pin the private-API
hooks.

**Acceptance (automated):** SPEC_02 adapter tests green (apply members, capture on
interaction, suppression during apply); binding integration test green; suite green.

**User test:** flag ON both vaults. Run the full canvas matrix:
1. **Initial sync** correct on both (edges connected, positions right).
2. **Multi-edge move** on guest — stable, arrows re-route.
3. **Bidirectional** — both drag simultaneously; stable, converges, no oscillation.
4. Add/delete node & edge from each side.
5. `file`/Properties node interaction doesn't break the follower.

---

## 5. Phase 4 — Retire the legacy bridge & guards

**Build:** make the binding the default; delete (SPEC_01 §9): canvas
`handleLocalModify`, `reconcileLiveCanvas`, canvas mute windows, `recentDiskWrites`
for canvas, the **echo-breaker**, the **sequence gate**, the forced initial
reconcile. Keep the geometry guard only in the cold-open load (SPEC_03 §4).

**Acceptance (automated):** suite green with dead paths removed and their tests
replaced by binding/persistence tests; **net test count documented** (no silent
coverage loss).

**User test:** re-run the Phase-3 matrix with the flag removed (binding always on).

---

## 6. Phase 5 — Hardening & edges

**Build:** structural add/remove polish (SPEC_02 §5), edge side/cosmetic sync
(§7), `file`/embed node content (§6), undo policy decision, and cursor-coordinate
inversion (B5 — independent, fold in here). Remove the `useCanvasBinding` setting.

**Acceptance:** full matrix + a soak test (long bidirectional session, no drift);
BUGFIX_STATUS B1–B11 closed or explicitly deferred; `CANVAS_SYNC_REDESIGN.md`
marked delivered.

**Ship gate (unchanged from house rules):** only after the matrix passes visually,
push the landing zip (`scp` to `/home/deploy/liveshare/landing/rendered/…` as
`deploy`), user commits, version bump to a release.

---

## 7. Phase → spec → acceptance matrix

| Phase | Primary spec | Automated gate | User E2E gate |
|---|---|---|---|
| 0 Prove contract | SPEC_01 | T1–T10 + suite green | — |
| 1 Persistence split | SPEC_03 | writer tests + suite | (optional smoke) |
| 2 Reentrancy apply | SPEC_01 apply | apply tests + suite | **guest drags → host stable** |
| 3 Model capture | SPEC_02 | adapter+binding tests | full matrix, flagged |
| 4 Retire legacy | SPEC_01 §9 | suite green, count documented | matrix, unflagged |
| 5 Hardening | all | matrix + soak | ship gate |

---

## 8. Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Private-API capture hooks incomplete | 3 | Phase-0 spike pins them; snapshot-diff fallback covers gaps; log missed triggers |
| Obsidian `requestSave` not suppressible | 3 | SPEC_03 §5(b): tolerate as fsync; file never read while open → harmless |
| Node add/remove needs `setData` (flash) | 3/5 | Scoped to structural changes only; runs under `applyingRemote`, no feedback |
| Regression in text sync | any | Suite gate every phase; canvas never touches `yCollab`/SyncManager |
| Coverage loss when deleting legacy | 4 | Replace, don't just delete; document net test count |
| Dual-document (node↔md) confusion in testing | 3+ | Declared non-goal; documented so testers don't chase it |

---

## 9. Definition of done

- Bidirectional concurrent canvas editing is stable across a long session with no
  scatter, no detached edges, no oscillation — on **both** roles.
- The legacy file-bridge canvas path and all its timing guards are gone.
- Race-freedom argument (SPEC_01 §7) holds in code; the headless harness enforces
  it in CI.
- Text sync unchanged and green throughout.
