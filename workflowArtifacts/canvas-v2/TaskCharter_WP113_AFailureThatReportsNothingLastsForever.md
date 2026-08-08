# WP113 — A failure that reports nothing lasts forever

**Signals:** S143 · S144 · S157 · **Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions`

Both packages are failures the product **survives into a wrong steady state** because nothing records that
they happened.

> **DISPATCHER NOTE -- THIS CHARTER WAS WRITTEN BEFORE THREE PACKAGES LANDED, AND THEY CHANGED ITS SUBJECT.
> Re-establish the facts before trusting anything below.**
>
> - **WP111 (live) REFUTED S143 as the live cause.** The orphaned guests read `docExists: false`, so the doc
>   was never created and `subscribe()` was never reached. The live reading belonged to `S147`.
> - **WP114 then repaired `S147` -- and MOVED `attachObserver` to BEFORE `waitForSync`, in both arms**, on the
>   principle that *subscription is observation*. It also added an idempotent `SyncManager.rearm()`. **So the
>   sentence "`attachObserver` is the last statement" is no longer true of this code.**
> - **WP115** found `syncFromManifest`'s two traceless give-ups (now `S157`, added to this package).
> - **WP112** noted that `S141`'s producer is reached through exactly this family of early return.
>
> **Your first task is therefore to say what `S143` IS now**, on current `HEAD`, with the exits enumerated
> from source. It may be smaller than described, differently shaped, or already closed by WP114. **Any of
> those is a legitimate finding** -- report it plainly rather than repairing a defect that no longer exists.

---

## Package C -- S157: `syncFromManifest` gives up completely silently, twice

Its bare `catch` around `waitForSync`, and its `getDoc -> null` branch, both return with **no counter, no log
and no notice**. WP115 made the **outcome** of both safe (the guest arm now preserves before overwriting) but
**the silence is untouched**, and WP112 showed `S141`'s producer is reached through this same family.

**C1** -- Both give-ups counted and logged with the path and which exit was taken, in the shape
`empty-write-guard.ts` and WP110 established: one shared emitter, a named closed set of reasons pinned
against the production exits, **logger as a parameter, never a module sink** (`S104`). Do not invent a
third idiom.
**C2** -- `S155`'s rule: count **every** branch including the do-nothing one, or the ledger cannot
distinguish *declined* from *never reached* -- which is the mistake that cost WP115 a round.
**C3** -- This is observability, not behaviour. **Do not change what either branch decides.**

---

## Package A — S143: `subscribe()` gives up permanently and silently

### The shape

`attachObserver(path, docHandle.text)` is the **last statement** in `BackgroundSync.subscribe()`. Ahead of
it sit **six** ways out:

```ts
await this.syncManager.waitForSync(path);   →  catch { return; }
if (this.cancelledSubscribes.has(path)) return;
if (this.observers.has(path)) return;
if (docHandle.doc.isDestroyed) return;
if (!docHandle) return;
// …and the guest arm's 20 × 100 ms wait, which falls through
```

**Every one of them leaves `observers: false` for that path, with no retry, no counter and no log**, until
the next `startAll` — which in practice means until the user leaves and rejoins the session. The file is
open, the session is connected, everything reports healthy, and that document is simply never watched again.

**Why this is Tier 1 rather than tidiness:** it is the mechanism that produces the `observers:false` /
`synced:false` reading measured on all three peers in the last live round — the reading WP109's fix
**could not reproduce**, because an unseeded guest still *reaches* `attachObserver`. It is also the
amplifier that made S134 last a full day: the first failure is a 10 s timeout, and the consequence is
permanent.

### The task

**A1 — Demonstrate the permanence**, which is the part that matters more than the first failure: force one
early return, then show the path is still unobserved long afterwards, with the session healthy and nothing
having reported it. Cover **at least** the `waitForSync` rejection and one other exit — a fix that only
handles the timeout leaves five doors open.

**A2 — Make the give-up visible.** Counted, and logged to the **debug log** with the path and *which* exit
was taken. Follow WP110's shape: one shared emitter, a named closed set of reasons pinned against the
production exits, **logger as a parameter, never a module sink** (S104). Do not invent a second idiom —
`empty-write-guard.ts` already established this one and consistency is worth more than novelty here.

**A3 — Recover, and be careful here.** A permanent give-up should not need a session restart to clear.
Retry, or re-arm on an event, or reconcile on a timer — **your call, but justify it**, and respect what the
exits mean: `cancelledSubscribes` and `isDestroyed` are **deliberate** cancellations and must not be
retried into a resurrection. **I1: refusal never destroys.** A retry that overwrites a user's file is a
worse defect than the one being fixed. If you conclude some exits must stay terminal, say which and why —
that is a legitimate result.

**A4 — Do not reintroduce S134.** The seeding path now runs for the active file. Any retry or re-arm must
not seed over a document the editor owns, and must not resurrect an emptied note (`yTextHeldContent` is the
existing evidence predicate — use it, do not write a second one).

---

## Package B — S144: `ensureFolder` swallows every `createFolder` error

A folder failure is reported to the user as a **rename** failure. Small, but it is the product doing what
the *rig* was criticised for in S112/S138 — **misattributing a failure to the wrong operation** — and it
sits directly on the path WP110 just repaired, where the next diagnosis will happen.

**B1** — The error is not swallowed: it is counted, logged with the folder path, and distinguishable in the
log from a rename failure.
**B2** — A test proving a `createFolder` failure is reported **as itself**, with a positive control.
**B3** — Do not change what the *caller* does on failure unless you can justify it; making the failure
**legible** is the package. If you believe the caller's behaviour is also wrong, report it rather than
folding it in.

---

## Both packages

**Falsifiability (Dispatcher Rule 11):** a break table per fix — plant, RED **for the right reason**,
restore byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline is
**3057 tests / 410 files**, measured on a quiet tree.
⚠ `NEXT_FREE` is hardcoded at `check_signal_register.py:53` **and** in the register; that coupling is
recorded and is not yours to fix.

**Method rules:**

1. **No partial test doubles** — five packages lost to them so far. Drive the real object or state exactly
   which paths your double does not exercise.
2. **Demonstrated beats argued.** The executed exit, the observed absence of an observer, the measured
   silence.
3. Every new test gets a positive control.
4. **Report A, B and C separately.**
5. **Correct this charter if it is wrong** — the last three workers each corrected their premise and each
   was right.
6. **Signal numbers: next free is S163, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild or deploy, and do not touch the vaults** — the live rig belongs to the validation round.
- **Never `npx biome check --write`.** Never commit to a default branch. **Explicit path staging only.**
- `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**A facility to use:** `plugin/src/__tests__/support/timer-clamp.ts` (WP114) for anything timer-scheduled;
prove it can redden your scenario before trusting a failure from it.

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP113.md`.
