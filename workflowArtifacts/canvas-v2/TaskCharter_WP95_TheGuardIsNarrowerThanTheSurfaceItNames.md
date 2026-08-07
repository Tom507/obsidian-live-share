# TaskCharter WP95 — The guard is narrower than the surface it names

**Phase:** P2 · **Severity:** **P0, and the highest of the run** · **Signal:** `S94`
**Chartered by:** Dispatcher, from B56/W4's live finding · **Supersedes the Tier 1 closure claim of WP68**

---

## 1. The defect, stated so it cannot be misread

`file-ops.ts:983` refuses an inbound rename when any of its four path forms satisfies `isSidecarPath`.
`isSidecarPath` tests membership of `SIDECAR_DIR`, and `SIDECAR_DIR` is **`.obsidian/liveshare/state`**
(`canvas-sidecar.ts:42`).

**Everything else under `.obsidian/**` is therefore reachable by a peer.** B56 demonstrated it live: a
peer-injected rename whose destination was inside **`.obsidian/plugins/live-share/`** was **admitted and
applied**. That directory holds:

- **`main.js`** — the plugin's own executable code. A peer who can place bytes there executes code in
  another user's Obsidian, at that user's privilege, on next load.
- **`data.json`** — the user's **live credentials** (`serverPassword`, `token`, `jwt`,
  `encryptionPassphrase`, `encryptionSalt`).

**The reasoning was already in the tree and the predicate did not match it.**
`seed-refusal-store.ts:42` carries, in a comment: *"write under `.obsidian/**` is a code-execution
surface; this opens no…"*. WP68 was chartered against exactly this subject and closed against a narrower
predicate, and **I accepted that closure** — the error is the Dispatcher's, not WP68's.

## 2. What is demonstrated and what is not — do not conflate them

| | status |
|---|---|
| Inbound **rename** with a destination under `.obsidian/plugins/live-share/` is admitted and applied | **demonstrated live** by B56 |
| Inbound **create / modify / delete** at the same paths | **NOT demonstrated.** Stated as an implication only |
| Overwrite of `main.js` or `data.json` specifically | **NOT demonstrated** |

**Your first job is to close that gap by measurement, not by argument.** A fix that assumes the other three
op kinds behave like rename is a fix built on the same reasoning that produced the defect.

## 3. Acceptance criteria

- **AC1 — the census.** Enumerate **every inbound arm that can place, move or remove bytes** in the vault:
  rename, create, modify, delete, chunked binary transfer, manifest-driven removal, and any arm reached by
  a callback rather than a named call. **`grep` is not sufficient and `S89` is the proof** — a capability
  passed as a parameter has no call site to grep. Follow the *type* and the *runtime*, and say which method
  you used for each arm. State the count and how you know it is the whole count.
- **AC2 — the predicate.** A single protected-path predicate, tested once, used by every arm from AC1.
  Minimum coverage: **all of `.obsidian/**`** and **all of `.git/**`** (a peer-injected `.git/hooks/pre-commit`
  is the same class of defect and this repo's own owner uses git in these vaults).
- **AC3 — the local writer is unaffected.** The plugin must still write its own sidecar under
  `.obsidian/liveshare/state/**`. The predicate governs **inbound peer ops**, not local writes. Prove both
  halves: a peer op refused, a local sidecar write succeeding, in the same test.
- **AC4 — refusal never destroys (I11).** A refused op leaves the local file **byte-identical**. Assert on
  bytes, not on absence of an error.
- **AC5 — the refusal is observable.** A counter and one log line, so W4 can read it live. See §5.
- **AC6 — the four op kinds.** One test per kind from AC1, each showing a peer op targeting
  `.obsidian/plugins/live-share/data.json` is refused. If any kind turns out **already** refused by some
  other gate, say so and say which gate — a criterion that passes for a reason you did not build is a
  finding, not a pass.

## 4. Rules

1. **Plant the regression, show the test red, remove the plant, show it green** — for every AC. A break that
   reddens nothing is a finding; report it and say why. This run's dominant defect class is a green that
   cannot fail, twelve-plus instances across eight surfaces.
2. **Restore breaks byte-identically by copy-aside.** Never `git checkout`, never `git stash` — a sibling
   agent shares this working tree.
3. **`git commit -o <explicit paths>`.** Never `git add -A`. B57 has uncommitted work in
   `plugin/src/files/canvas-persistence.ts`, `plugin/src/files/seed-refusal-store.ts`, `plugin/src/main.ts`
   and `plugin/src/__tests__/v2/wp92/` — **do not touch, stage or revert any of those.**
4. **Rule 5** — re-verify every line number before editing; cite what you found, not what this charter says.
5. **Never print, log, or copy a credential.** `data.json` holds live ones. Comparisons are **sha256-of-bytes
   only**. Naming a key is fine; naming a value is not. This applies to your tests and your report.
6. **Signal numbers: next free is S97, and you allocate none.** Describe findings; the Dispatcher numbers them.

## 5. Carried in from B56's revision request

`getMuteReleaseStats()` exists but **no e2e command exposes it**, so WP93 AC4's counter has no live reader and
the log line only appears when an overrun actually happens. Add the e2e command that exposes it, and expose
your own AC5 counter the same way. **An observable a live validator cannot read is not an observable.**

## 6. Definition of done

`tsc` clean; full suite green with the figure **you measured** (baseline at your HEAD, re-measured after);
`check_signal_register.py` exit 0; the break table with what each break reddened; and an explicit statement of
which of the four op kinds you **demonstrated** refused versus **argued** are refused.
