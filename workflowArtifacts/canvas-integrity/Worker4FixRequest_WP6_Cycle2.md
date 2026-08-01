# Worker 4 Fix Request — WP6, Cycle 2

> Filed as a **new** artifact so `Worker4FixRequest_WP6.md` (cycle 1) stays intact as the audit
> trail. Cycle 1's four failures (F1–F4) are **all fixed and independently re-verified** — see
> the revalidation section of `IntegrationTestReport.md`. This file covers one **new** defect,
> found by executing the fourth entry point W3 identified by reading and correctly declined to
> guess at.

## Summary

`ManifestManager.syncFromManifest` is a fourth entry point in the same defect class, and it is
worse than the first three: it does not merely create a redundant CRDT, it **writes an empty
`.canvas` over the user's file**. Since WP6 made `startAll` skip `.canvas`, *nothing* ever
populates a canvas's bare-path `Y.Text`, so `tempHandle.text.toString()` is always `""`. That
empty string is then written to disk.

This is a **regression introduced by the main round**, not by cycle 1: at HEAD `4b34d5e`,
`startAll` subscribed every text file including `.canvas`, so the bare-path `Y.Text` *was*
populated and the write carried real content. Verified via `git show HEAD:plugin/src/files/background-sync.ts`.

W3 was right to stop and ask for a red rather than reflex-guarding it. Here is the red.

---

## Failures

### F5 — `syncFromManifest` creates a raw `Y.Text` document for a `.canvas`

- **Severity:** HIGH
- **Affected flow:** US5 AC1 — exactly one subsystem per `.canvas` at any instant
- **Test level:** integration (Level 2, revalidation)
- **Test executed:** `npx vitest run src/__tests__/w4-canvas-integrity.test.ts -t "K1"`
- **Expected behavior:** `getDoc("board.canvas")` (bare path) is never called for a canvas entry
- **Observed behavior:** `expected 1 to be +0`
- **Code path:** `manifest.ts:182` `const tempHandle = this.syncManager.getDoc(path);`. The only
  filter is `if (options?.skipText && !entry.binary && isTextFile(path)) continue;` at
  `manifest.ts:155` — so a `.canvas` is skipped **only** when the caller opts in.
- **Call sites:** of the six `syncFromManifest` calls in `main.ts`, **only `:252` passes
  `{ skipText: true }`**. `:472` (resume), `:625` and `:658` (join), `:1629` (reconnect-as-guest)
  and `:1643` (reload-all-from-host) do not.
- **Mitigating difference from F1/F2:** it attaches **no observer**, so it is a one-shot doc
  acquisition plus a one-shot write, not a standing second writer. That is why F5 alone would be
  MEDIUM. F6 is what makes it HIGH.

### F6 — DATA LOSS: an empty `.canvas` is written over a canvas that has content

- **Severity:** HIGH
- **Affected flow:** guest join / resume / reconnect / reload-from-host
- **Test level:** integration
- **Test executed:** `npx vitest run src/__tests__/w4-canvas-integrity.test.ts -t "K2"`
- **Step that failed:** `syncFromManifest` on a manifest entry for `board.canvas` whose hash does
  not match the guest's local file
- **Expected behavior:** no empty write reaches disk
- **Observed behavior:** `expected [ [ 'board.canvas', '' ] ] to have a length of +0 but got 1` —
  `vault.modify(localFile, "")` was called on a canvas whose on-disk content was
  `{"nodes":[{"id":"n1","type":"text"}],"edges":[]}`
- **Reproduction steps:**
  1. Manifest contains `board.canvas` with the host's hash.
  2. Guest's local `board.canvas` has content whose hash differs (ordinary: any divergence, or
     just a different serialization). Or the guest has no local file at all.
  3. Guest joins / resumes / reconnects — any of the five call sites without `skipText`.
  4. `needsSync` is true → `getDoc(path)` → `waitForSync` → `content = ""` → `vault.modify(file, "")`
     (or `vault.create(path, "")` when the file is absent).
- **Why the content is always empty:** under WP6's guards no code path populates a canvas's
  bare-path `Y.Text` any more — `startAll`, `onFileAdded` and `onFileRenamed` all skip `.canvas`,
  and `subscribe()` is only reached via the R10 fallback. The write therefore **cannot** be
  load-bearing; it can only destroy. This resolves the open question in HANDOVER § 8.
- **Suspected problem class:** regression (WP6 `startAll` skip removed the only populator, leaving
  a consumer that assumes a populated doc)
- **Regression hint:** `git show HEAD:plugin/src/files/background-sync.ts` — pre-round `startAll`
  had no `.canvas` skip, so this write previously carried the real file.

---

## Fix Priority

| Fix ID | Severity | Suspected root cause | Recommended approach |
|---|---|---|---|
| F5 | HIGH | `syncFromManifest`'s text branch has no `.canvas` skip | Skip `.canvas` in the text branch unconditionally |
| F6 | HIGH | Consequence of F5 once WP6 removed the only populator | Covered by fixing F5 |

**Recommended shape.** Skip `.canvas` in `syncFromManifest`'s **text** branch regardless of
`skipText`, for the same reason `startAll` skips it: the path is owned by `CanvasSync`, and its
initial file materialisation is `CanvasPersistence.coldOpen`'s job, not the manifest's.
`skipsAutoTextSync` already exists as the named predicate and rationale — consider exporting it
from `background-sync.ts` (or lifting it to `utils.ts` beside `isTextFile`) so `manifest.ts`
consults the same one rather than growing a fourth private copy of `path.endsWith(".canvas")`.

Do **not** simply add `{ skipText: true }` to the five call sites — that would also stop markdown
from syncing on join, which is load-bearing. The skip belongs to the canvas extension, not the
caller.

---

## Notes for Worker 3

- **Confirm the self-heal window, because I could not.** After the empty write, a guest that later
  opens the canvas hits `CanvasPersistence.coldOpen`. If the shared canvas doc is non-empty the
  `doc-wins` branch restores the real bytes and the damage was transient. **If the shared doc is
  also empty**, `coldOpen` returns `"empty"` — and the guest's local content, which the round's
  deliberate `"seeded-from-file"` improvement would have published to the room, has already been
  erased. That is permanent loss, and it specifically defeats the cycle's own coldOpen change.
  I could not establish which ordering actually runs, because it lives in `main.ts`
  (`connectSync()` runs before `manifestManager.connect()`, so the session-start canvas subscribe
  loop at `main.ts:825` may see an empty manifest and subscribe nothing, leaving only the lazy
  on-open subscribe at `main.ts:995`). **That reasoning is reading, not execution** — `main.ts`
  has no test file. Treat it as a question to answer, not a finding.
- Regression coverage exists: `K1`–`K4` in `plugin/src/__tests__/w4-canvas-integrity.test.ts`.
  `K3` pins that `skipText: true` still works and `K4` pins that markdown still syncs, so an
  over-broad fix will fail.
- Cycle 1's `J1`–`J4` and the new `K6`–`K8` must stay green.

---

## Not a defect — recorded so it is not re-investigated

**`editor/collab.ts:62`.** Probed by execution (`K5`). `CollabManager.activateForFile` has **no
internal `.canvas` guard**: called with a `.canvas` path it does acquire a bare-path `Y.Text` doc.
It is currently unreachable for a canvas only because `main.ts` gates on
`getActiveViewOfType(MarkdownView)` and a canvas opens in a Canvas view. W3's reading was correct.
No fix requested — but it is an unguarded call protected solely by an untested `main.ts` gate, so
it is recorded as a residual risk rather than as "safe".
