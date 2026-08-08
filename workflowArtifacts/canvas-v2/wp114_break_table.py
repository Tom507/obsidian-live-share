"""S147 / WP114 — Rule 9 falsifiability driver.

Mechanics copied verbatim from `wp109_break_table.py`, including its anchored
`^\\s*[x×]` failure parser (`S133`'s unanchored ancestor manufactured a false
red) and its copy-aside / exact-replacement / restore-in-`finally` / sha256
discipline. Never `git checkout`, never `git stash`.

Two things are deliberately different, and both are about WHAT is being broken.

  1. The clamp FACILITY is a subject in its own right. AC2 says a fix for this
     class that cannot be tested under a clamp regresses unnoticed, so the rows
     below break the facility as well as the product: an instrument that cannot
     fail is worth less than no instrument.
  2. Several rows restore the SHIPPED defect verbatim. The point of those is not
     that some assertion goes red — it is that the row that reddens is the one
     naming the live reading (`docExists`, `observers`, recovery), and that the
     controls stay green so the red cannot be a general breakage.

A break that reddens NOTHING is reported as such, not silently dropped.
"""

import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugin"
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"
MAIN = PLUGIN / "src" / "main.ts"
SYNC = PLUGIN / "src" / "sync" / "sync.ts"
CLAMP = PLUGIN / "src" / "__tests__" / "support" / "timer-clamp.ts"

TESTS = [
    "src/__tests__/v2/wp114/test_s147_a_subscribe_under_a_clamp.test.ts",
    "src/__tests__/v2/wp114/test_ac2_the_clamp_facility.test.ts",
    # The neighbours S147 must not have re-opened. S134 owns the seeding arm
    # this repair moves code across; S119/S126/S129 own the floors the guest arm
    # meets; background-sync.test.ts is the module's own suite.
    "src/__tests__/v2/wp109/test_s134_a_note_born_in_a_session.test.ts",
    "src/__tests__/dataloss/test_s129_opening_a_note_cannot_empty_it.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/background-sync.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "T1",
        "AC1/AC3 — THE DEFECT ITSELF, half one",
        "restore the twenty-hop poll: the guest waits for the seed by counting "
        "timer hops instead of by hearing it arrive (the shipped code, verbatim)",
        [(BGSYNC,
          "          await this.awaitSeed(path, docHandle, SEED_WAIT_BUDGET_MS);",
          "          for (let i = 0; i < 20; i++) {\n"
          "            await new Promise((resolve) => setTimeout(resolve, 100));\n"
          "            if (this.cancelledSubscribes.has(path)) return;\n"
          "            if (docHandle.doc.isDestroyed) return;\n"
          "            if (docHandle.text.length > 0) break;\n"
          "          }")],
    ),
    (
        "T2",
        "AC1 — THE DEFECT ITSELF, half two (startAll)",
        "the session bring-up settles each path before creating the next one's "
        "document, so a stalled path decides whether its neighbours exist",
        [(BGSYNC,
          "    this.registerAnnounced(paths);",
          "    // phase 1 removed")],
    ),
    (
        "T3",
        "AC1 — THE DEFECT ITSELF, half two (the manifest arm)",
        "the mid-session announcement loses its phase 1, which is the live "
        "`docExists: false` on a host-created note",
        [(MAIN,
          "      this.backgroundSync.registerAnnounced(actuallyAdded);",
          "      // phase 1 removed")],
    ),
    (
        "T4",
        "AC1/AC4 — the observer is behind the settlement again",
        "`attachObserver` goes back to being the last statement, so every early "
        "return leaves `observers: false` and a restored link delivers nothing",
        [(BGSYNC,
          "      this.attachObserver(path, docHandle.text);\n\n      // S147 — the RESOLUTION is read",
          "      // attach moved back to the tail\n\n      // S147 — the RESOLUTION is read"),
         (BGSYNC,
          "    } finally {\n      this.subscribing.delete(path);",
          "      this.attachObserver(path, docHandle.text);\n    } finally {\n      this.subscribing.delete(path);")],
    ),
    (
        "T5",
        "AC3 — a longer timeout is NOT a fix",
        "the budget is multiplied by twenty instead of the hop count being "
        "removed, which is exactly the non-repair the charter rules out",
        [(BGSYNC,
          "const SEED_WAIT_BUDGET_MS = 2_000;",
          "const SEED_WAIT_BUDGET_MS = 40_000;")],
    ),
    (
        "T6",
        "AC3 — event-driven",
        "the seed's arrival stops ending the wait, so only the deadline can",
        [(BGSYNC,
          "      handle.text.observe(observer);",
          "      void observer;")],
    ),
    (
        "T7",
        "AC3 — the answered question is not re-asked",
        "`PEER_STATE` no longer short-circuits the wait, so every already-answered "
        "empty document pays the full budget again",
        [(BGSYNC,
          "        if (docHandle.text.length === 0 && resolution !== SYNC_RESOLUTION.PEER_STATE) {",
          "        if (docHandle.text.length === 0 && resolution !== undefined) {")],
    ),
    (
        "T8",
        "AC4 — the idempotent re-assert",
        "a restored link no longer re-sends its subscribes, so the relay keeps "
        "believing this client subscribed to nothing",
        [(SYNC,
          "    if (!this.isDestroyed && !this.silenced && this.ws?.readyState === WebSocket.OPEN) {",
          "    if (false) {")],
    ),
    (
        "T9",
        "AC5 — a deliberate cancellation is still a refusal",
        "the cancellation no longer detaches the observer it was too late to stop, "
        "so a refused subscribe leaves a live subscription behind",
        [(BGSYNC,
          "      if (this.cancelledSubscribes.has(path)) this.detachObserver(path);",
          "      // detach removed")],
    ),
    (
        "T10",
        "AC5 — the tombstone gate (S134/S126, untouched by this repair)",
        "an emptied note is resurrected under the user's cursor",
        [(BGSYNC,
          "            if (!isActive || !yTextHeldContent(docHandle.text)) {",
          "            if (true) {")],
    ),
    (
        "T11",
        "AC2 — THE FACILITY MUST BE ABLE TO FAIL: the floor",
        "the clamp stops raising any delay, so every scenario reads as if the "
        "renderer were in the foreground",
        [(CLAMP,
          "    let applied = Math.max(requested, floorMs);",
          "    let applied = requested;")],
    ),
    (
        "T12",
        "AC2 — THE FACILITY MUST BE ABLE TO FAIL: the dead-instrument guard",
        "`assertClamped` stops refusing a window in which nothing was clamped, "
        "which is how `S113` was quoted as four silent branches",
        [(CLAMP,
          "      if (clamped < minimum) {",
          "      if (false) {")],
    ),
    (
        "T13",
        "AC2 — THE FACILITY MUST BE ABLE TO FAIL: the scope",
        "the clamp throttles everything, including the relay and the harness, so "
        "the test would be measuring itself",
        [(CLAMP,
          "    if (!frame || !scope.test(frame)) return requested;",
          "    if (false) return requested;")],
    ),
    (
        "T14",
        "NEGATIVE CONTROL",
        "a comment is reworded and a constant keeps its value — nothing about "
        "behaviour changes and nothing may redden",
        [(BGSYNC,
          "/** S147 — release anything parked in {@link awaitSeed} for this path. */",
          "/** S147 — wake anything parked in {@link awaitSeed} for this path. */")],
    ),
]

TARGETS = {BGSYNC, MAIN, SYNC, CLAMP}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_summary(clean):
    m = re.search(r"Tests\s+(.+?)\n", clean)
    return m.group(1).strip() if m else "UNPARSED"


def run_tests():
    proc = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose", *TESTS],
        cwd=PLUGIN, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    # S133 — ANCHORED AT LINE START.
    failed = sorted({
        m.group(1).strip()
        for m in re.finditer(r"^\s*[x×]\s+(.+?)(?:\s+\d+ms)?$", clean, re.M)
    })
    return failed, clean_summary(clean)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    baseline_sha = {p: sha256(p) for p in TARGETS}

    wanted = {a.upper() for a in sys.argv[1:]}
    selected = [b for b in BREAKS if not wanted or b[0].upper() in wanted]
    if wanted:
        missing = wanted - {b[0].upper() for b in BREAKS}
        if missing:
            print(f"  !! unknown break ids: {sorted(missing)}")
            return 2
        print(f"=== FILTERED RUN: {len(selected)} of {len(BREAKS)} rows "
              f"({', '.join(b[0] for b in selected)}) ===")
    else:
        print(f"=== FULL RUN: all {len(BREAKS)} rows ===")

    print("=== BASELINE (no break) ===")
    failed, summary = run_tests()
    print(f"  {summary}")
    if failed:
        print("  !! baseline is not green, aborting:", failed)
        return 1

    rows = []
    for bid, ac, desc, edits in selected:
        for p in TARGETS:
            shutil.copyfile(p, p.with_suffix(p.suffix + ".pre-v2-smoke"))
        applied = True
        for path, old, new in edits:
            text = path.read_text(encoding="utf-8")
            if old not in text:
                print(f"  !! {bid}: anchor not found in {path.name}")
                applied = False
                break
            path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="")
        try:
            if applied:
                failed, summary = run_tests()
            else:
                failed, summary = ["ANCHOR NOT FOUND"], "NOT RUN"
        finally:
            for p in TARGETS:
                shutil.copyfile(p.with_suffix(p.suffix + ".pre-v2-smoke"), p)
                p.with_suffix(p.suffix + ".pre-v2-smoke").unlink()
        restored = all(sha256(p) == baseline_sha[p] for p in TARGETS)

        rows.append((bid, ac, desc, failed, summary, restored))
        print(f"\n=== {bid} ({ac}) {desc}")
        print(f"  {summary}   restore byte-identical: {restored}")
        for f in failed:
            print(f"    RED: {f}")

    print("\n\n================ WP114 BREAK TABLE ================")
    for bid, ac, desc, failed, summary, restored in rows:
        print(f"\n{bid} [{ac}] {desc}")
        print(f"  result   : {summary}")
        print(f"  restored : {'byte-identical (sha256)' if restored else '!! MISMATCH !!'}")
        if failed:
            for f in failed:
                print(f"  RED      : {f}")
        else:
            print("  RED      : NOTHING — this break reddened no test")

    print("\n=== FINAL GREEN CHECK ===")
    failed, summary = run_tests()
    print(f"  {summary}  failures={failed}")
    leftovers = sorted(str(p) for p in PLUGIN.rglob("*.pre-v2-smoke"))
    print(f"=== COPY-ASIDE LEFTOVERS: {len(leftovers)} {leftovers} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
