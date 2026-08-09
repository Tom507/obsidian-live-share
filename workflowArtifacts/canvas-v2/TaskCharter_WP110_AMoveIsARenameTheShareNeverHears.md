# WP110 — A move is a rename the share never hears · and a floor that cannot be attributed

**Signals:** S135 (high) · S137 (observability) · **Worker:** W3d, fresh context ·
**Branch:** `fix-bugs-and-raceconditions` · **Base:** `26581d2`

Two packages, chartered together because both live under `plugin/src/files/` and both are about an event
that happens and leaves no usable trace.

---

## Package A — S135: a rename that changes the parent folder does not propagate

### Measured, in three real vaults

| gesture | result |
|---|---|
| rename **within** the same folder, host→guests | propagates in **~0.1 s** |
| rename **within** the same folder, guest→host+guest | propagates in **~0.1 s** |
| move into `_liveshare-test/w4b-sub/` | **never propagated in 60 s — 4 attempts, both roles** |

The **subfolder itself propagates**; the file does not. No data is lost — peers keep the old path with
correct content — but **the shares diverge permanently and silently.**

The control is internal and sharp: same client, same file, same session, same reader. **Only the
destination folder differs.**

### Anchors — confirm or refute, do not assume

- `files/vault-events.ts:233` — the `"rename"` vault event, and immediately below it the
  `isPathMutedFor(file.path, "rename") || isPathMutedFor(oldPath, "rename")` pair from WP108's S120 fix.
  **Note it asks about BOTH paths.** A mute keyed on one of them is a live hypothesis worth eliminating
  first — and if it is the cause, the repair must not reopen S120 or the echo loop the mute exists to break.
- `files/file-ops.ts:1102` — `onFileRename(file, oldPath)`, and `:1113` the path-class guard added
  recently. `:1180` builds the `type: "rename"` op.
- `files/background-sync.ts:283` — `onFileRenamed(oldPath, newPath)`, which `unobserve()`s and
  `releaseDoc`s the old path.
- `files/canvas-sync.ts:3271` — `handleRename`, for the canvas half. **Check whether `.canvas` behaves the
  same way under a cross-folder move**; the live evidence is from `.md` only, and if canvas differs that is
  a fact worth having.

**The question the report must answer:** is the op never **emitted**, emitted but never **sent**, sent but
**refused on receipt**, or applied to a path the receiver then rejects? Each has a different repair. Locate
the drop precisely; do not fix the first plausible link.

### Acceptance

**A1** — A test that reproduces the cross-folder drop, RED for the right reason before the fix, GREEN after,
**with the same-folder rename passing in both states** as the internal control. Without that control the
test only proves renames work.
**A2** — Cross-folder moves propagate from **both roles**. Same-folder renames still propagate and S120's
property (a user gesture within ~1 s of a peer's arrival is not swallowed) still holds — assert it, do not
assume it.
**A3** — State in the report whether `.canvas` shares the defect, with evidence either way.

---

## Package B — S137: a floor whose firings cannot be attributed

The empty-write floor **fired twice during an ordinary rejoin**, arm `manifest-sync`, with no gesture
involved. That is the S119 shape — something attempted to write empty over a non-empty file — **occurring
on a plain join.** The guard held; those bytes survived because of it.

**The paths could not be identified.** The refusal goes to `console.warn`, not to the debug log, and no
console capture was attached. **A floor whose firings cannot be attributed cannot be diagnosed** — the live
validator hit exactly this wall and could not say which files were nearly destroyed.

### Acceptance

**B1** — Every empty-write refusal reaches the **debug log** with the path, the arm, and the reason.
The Notice/console behaviour may stay; the log entry is what must be added.
**B2** — Same for the sibling refusals in that family if they share the defect — `decideEmptyWrite`'s
callers and the local safety floors in `files/manifest.ts` (`passesLocalSafetyFloors`, `:976`,
`decideEmptyWrite` at `:689`). One consistent shape, **not a private logging idiom per call site.**
**B3** — A test that proves an attributable entry is produced, with a positive control. This is the package
whose absence made S137 unresolvable; a green here that could not have gone red would repeat the failure
exactly.

**Do not attempt to explain S137's two firings.** Root-causing them needs a live rerun with a CDP console
listener, which is W4's work and is out of your scope. Your job is to make the next occurrence
**diagnosable**. If your instrumentation happens to reveal the cause from unit evidence, report it as a
finding — but the package is complete without it.

---

## Both packages

**Falsifiability (Dispatcher Rule 11):** a break table per fix — plant, RED **for the right reason**,
restore byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files left at the end.

**Gate:** full `vitest` + `tsc` clean, **bracketed** (before your first change, after your last), and
`python workflowArtifacts/canvas-v2/check_signal_register.py` exit 0. Baseline at `26581d2` is
**3000 tests / 407 files**. A deliberate pin that reddens gets updated **with written justification and
without weakening the property** — that is inside the package.

**Method rules:**

1. **No partial test doubles.** They silently skip whole code paths and have cost **four** packages in this
   run. Drive the real object, or state exactly which paths your double does not exercise.
2. **Demonstrated beats argued.** The executed line, the observed transition, the measured byte.
3. Every new test gets a positive control.
4. **Report A and B separately**, each with its own evidence.
5. **Signal numbers: next free is S141, and you allocate none.** <!-- signal-register: meta -->
   Describe new findings in prose; the Dispatcher numbers them.
6. **Correct this charter if it is wrong**, in the report, rather than working around it.

**Hard constraints:**

- **Do not rebuild or deploy the plugin.** The live rig is pinned at `d8f98603ad6ddb1c` and W4 owns the
  vaults. Code plus unit/harness tests only.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's** — do not
  stage, revert or touch them.
- **`data.json` holds live credentials.** Never print, log, echo or fixture a value. Keys yes, values never.
  **No secret through any agent tool.**
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP110.md`.
