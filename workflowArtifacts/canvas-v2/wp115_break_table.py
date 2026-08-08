"""S148 / S151 — WP115 Rule 11 falsifiability driver.

Mechanics copied verbatim from `wp109_break_table.py` (copy-aside, exact string
replacement, restore in a `finally`, sha256 equality, the `S133`-anchored
failure parser). Its own file for `S100`'s reason.

For each planted break: copy the targets aside, apply an EXACT string
replacement, run the WP115 set plus the neighbours this package could re-open,
record which rows reddened, restore from the copy-aside, verify the restore is
byte-identical. Never `git checkout`, never `git stash`.

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
CONFLICT = PLUGIN / "src" / "files" / "conflict-copy.ts"
MANIFEST = PLUGIN / "src" / "files" / "manifest.ts"
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"

TESTS = [
    "src/__tests__/v2/wp115/test_s148_the_guests_offline_work_is_never_silently_lost.test.ts",
    "src/__tests__/v2/wp115/test_s151_the_initiators_own_disk_lags_its_peers.test.ts",
    # The neighbours WP115 must not have re-opened: S125 owns the seam this
    # package widened, S119/S126 own the floor it now sits behind on the second
    # arm, and background-sync.test.ts pins the writer it threads an option through.
    "src/__tests__/dataloss/test_s125_the_guests_version_is_preserved.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/background-sync.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "W1",
        "A1/A2 — THE DEFECT ITSELF",
        "restore the cached-only mtime read (the shipped defect, verbatim): the guard "
        "goes back to believing Obsidian's index",
        [(MANIFEST,
          "    const mtime = observedModificationTime({\n"
          "      cached: localFile.stat?.mtime,\n"
          "      onDisk: await this.diskModificationTime(localFile.path),\n"
          "    });",
          "    const mtime = localFile.stat?.mtime;")],
    ),
    (
        "W2",
        "A2 — the disk read must WIN when the cache is behind",
        "take the cached value whenever both are usable, instead of the later of the two",
        [(CONFLICT,
          "  if (usableTimestamp(cached) && usableTimestamp(onDisk)) return Math.max(cached, onDisk);",
          "  if (usableTimestamp(cached) && usableTimestamp(onDisk)) return Math.min(cached, onDisk);")],
    ),
    (
        "W3",
        "A7 / AC6b — every unknown preserves",
        "a throwing adapter.stat is no longer contained, so it escapes preserveLocalVersion "
        "and takes that file's whole sync with it",
        [(MANIFEST,
          "      return typeof mtime === \"number\" ? mtime : undefined;\n"
          "    } catch {\n"
          "      return undefined;\n"
          "    }",
          "      return typeof mtime === \"number\" ? mtime : undefined;\n"
          "    } finally {\n"
          "      /* containment removed */\n"
          "    }")],
    ),
    (
        "W4",
        "A3 — THE SECOND DOOR",
        "the guest arm stops asking for preservation before it overwrites",
        [(BGSYNC,
          "          await this.writeToDisk(path, remoteContent, undefined, { preserveLocal: true });",
          "          await this.writeToDisk(path, remoteContent);")],
    ),
    (
        "W5",
        "A3 — the second door's seam must be the SAME seam",
        "the option is accepted and silently dropped on the way to the writer",
        [(BGSYNC,
          "        if (options?.preserveLocal) {\n          try {",
          "        if (false) {\n          try {")],
    ),
    (
        "W6",
        "A4/A5 — the discard becomes observable",
        "the DISCARD branch goes back to returning before every counter",
        [(MANIFEST,
          "    if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) {\n"
          "      // S148 — COUNTED AND SAID. The decision is unchanged; its silence is not.\n"
          "      noteConflictDiscard(",
          "    if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) return false;\n"
          "    if (false) {\n"
          "      noteConflictDiscard(")],
    ),
    (
        "W7",
        "A4 — S125's discard branch is NOT weakened",
        "everything preserves: the discard verdict is never acted on",
        [(MANIFEST,
          "    if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) {",
          "    if (false && verdict.decision === CONFLICT_PRESERVATION.DISCARD) {")],
    ),
    (
        "W8",
        "A3 / S125 AC6 — a refusal writes no copy",
        "preservation moves AHEAD of the empty-write floor on the doc arm, so a refused "
        "write litters a copy",
        [(BGSYNC,
          "        const docText = this.syncManager.getDoc(path)?.text ?? null;",
          "        if (options?.preserveLocal) {\n"
          "          await this.manifestManager.preserveLocalVersion(path, file, \"text\");\n"
          "        }\n"
          "        const docText = this.syncManager.getDoc(path)?.text ?? null;")],
    ),
    (
        "W9",
        "B1/B2 — S151's mechanism",
        "the initiator's own LOCAL transaction is allowed to schedule a disk write",
        [(BGSYNC,
          "      if (transaction.local) return;\n"
          "      // A remote delta was just integrated",
          "      if (false) return;\n"
          "      // A remote delta was just integrated")],
    ),
    (
        "W10",
        "B4 — the clamp facility has teeth",
        "the peer's disk write stops being debounced at all, so the clamp has no timer to raise",
        [(BGSYNC,
          "      this.scheduleDiskWrite(path, text);",
          "      void this.writeToDisk(path, text.toString(), this.currentSeq(path));")],
    ),
    (
        "W12",
        "A9 — preservation is STRICTLY ADDITIVE",
        "the containment is removed, so an unreachable seam suppresses the SYNC as well "
        "as the copy (the defect the first cut of this change actually had)",
        [(BGSYNC,
          "          try {\n"
          "            // Deliberately NOT an optional call. `?.` would make an absent seam\n"
          "            // a SILENT skip, which is the class of defect this whole package is\n"
          "            // about; a throw here is contained, counted and visible.\n"
          "            await this.manifestManager.preserveLocalVersion(path, file, \"text\");\n"
          "          } catch {\n"
          "            noteConflictCopyFailure();\n"
          "          }",
          "          await this.manifestManager.preserveLocalVersion(path, file, \"text\");")],
    ),
    (
        "W11",
        "NEGATIVE CONTROL",
        "the CONFLICT COPY SKIPPED line is reworded; every decision and every counter "
        "is untouched",
        [(CONFLICT,
          "    `CONFLICT COPY SKIPPED: arm=${input.arm} path=${input.path} ` +",
          "    `CONFLICT COPY SKIPPED: writer=${input.arm} file=${input.path} ` +")],
    ),
]

TARGETS = {CONFLICT, MANIFEST, BGSYNC}


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

    print("\n\n================ WP115 BREAK TABLE ================")
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
