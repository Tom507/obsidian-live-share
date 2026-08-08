"""S141 / S142 — WP112 Rule 11 falsifiability driver.

Mechanics copied verbatim from `wp115_break_table.py` (itself from
`wp109_break_table.py`): copy-aside, EXACT string replacement, restore in a
`finally`, sha256 equality, the `S133`-anchored failure parser. Its own file for
`S100`'s reason. Never `git checkout`, never `git stash`.

A break that reddens NOTHING is reported as such, not silently dropped — and one
row (`W12`) is a NEGATIVE CONTROL that is SUPPOSED to redden nothing.
"""

import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugin"
MANIFEST = PLUGIN / "src" / "files" / "manifest.ts"
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"
ATTEST = PLUGIN / "src" / "files" / "attestation-guard.ts"
SINGLE = PLUGIN / "src" / "files" / "single-writer.ts"

TESTS = [
    "src/__tests__/v2/wp112/test_s141_the_attestation_and_the_file_it_names.test.ts",
    "src/__tests__/v2/wp112/test_s142_the_guest_arm_had_no_single_writer_guard.test.ts",
    # The neighbours this package could re-open. S119/S126 own the write floor
    # whose evidence S141 subverts; S125/S148 own the preservation seam this
    # package's guest branch now stands in front of; S134/WP109 owns the host
    # arm's guard whose shape S142 copies; S151 owns the initiator's disk lag,
    # which is the SAME invariant read from the other side; and the two broad
    # unit files pin the two production modules that were edited.
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/dataloss/test_s125_the_guests_version_is_preserved.test.ts",
    "src/__tests__/v2/wp109/test_s134_a_note_born_in_a_session.test.ts",
    "src/__tests__/v2/wp115/test_s148_the_guests_offline_work_is_never_silently_lost.test.ts",
    "src/__tests__/v2/wp115/test_s151_the_initiators_own_disk_lags_its_peers.test.ts",
    "src/__tests__/background-sync.test.ts",
    "src/__tests__/manifest.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "W1",
        "A1/A2 — THE DEFECT ITSELF",
        "the publish path loses its floor: updateFile publishes whatever it is handed, "
        "which is the shipped S141 behaviour verbatim",
        [(MANIFEST,
          "    if (!(await this.admitsAttestation(file, canonical, attestedLength, binary))) return;",
          "    if (false && !(await this.admitsAttestation(file, canonical, attestedLength, binary))) return;")],
    ),
    (
        "W2",
        "A1 — the floor must consult THE FILE, not a convenient constant",
        "the floor keeps running but stops reading the file it names, so every empty "
        "attestation verifies against a fiction",
        [(MANIFEST,
          "      attestedLength > 0 ? null : await this.attestedFileLength(file, binary);",
          "      attestedLength > 0 ? null : 0;")],
    ),
    (
        "W3",
        "A4 / I11 — an unknown REFUSES, it does not guess",
        "an unreadable file is treated as an empty one, so the attestation goes out anyway",
        [(ATTEST,
          '        "empty attestation licences every peer to empty its own copy, and a stale entry does not",\n'
          "      refused: true,",
          '        "empty attestation licences every peer to empty its own copy, and a stale entry does not",\n'
          "      refused: false,")],
    ),
    (
        "W4",
        "A3 / S126 — the LEGITIMATE emptying must still publish",
        "the floor over-reaches and refuses every empty attestation, including the true ones",
        [(ATTEST,
          "  if (input.fileLength > 0) {",
          "  if (input.fileLength >= 0) {")],
    ),
    (
        "W5",
        "B1 — S142's guard, and the PRE-REPAIR MEASUREMENT",
        "the guest arm loses its active-file guard: the shipped S142 behaviour verbatim",
        [(BGSYNC,
          "        if (remoteContent !== localContent && path === this.activeFile) {",
          "        if (false && remoteContent !== localContent && path === this.activeFile) {")],
    ),
    (
        "W6",
        "B3 — THE SUBTLE ONE: a decline must not poison the catch-up",
        "the decline branch also records the remote content as written, so writeToDisk's "
        "first line short-circuits the flush and the guest's file never converges",
        [(BGSYNC,
          '          noteSingleWriterDecline("subscribe-guest", path, this.logger);',
          '          noteSingleWriterDecline("subscribe-guest", path, this.logger);\n'
          "          this.lastWrittenContent.set(path, remoteContent);")],
    ),
    (
        "W7",
        "B2 / S134 — the guard stands in front of the WRITE, never the ARM",
        "S134's mistake reproduced in the other role: the guard moves to the top of the "
        "guest arm, where it also kills the seed wait and S119's evidence",
        [(BGSYNC,
          '      } else if (this.role === "guest") {\n        // Wait for the host to seed',
          '      } else if (this.role === "guest") {\n        if (path === this.activeFile) return;\n'
          "        // Wait for the host to seed")],
    ),
    (
        "W8",
        "B5 / S155 — WP109's silent branch",
        "the host arm's decline stops being counted, restoring the reading in which "
        "'declined' and 'never reached' are identical",
        [(BGSYNC,
          '            noteSingleWriterDecline("subscribe-host", path, this.logger);',
          "            /* the decline is taken but not counted */")],
    ),
    (
        "W9",
        "B1 — a ledger that counts what it did not do",
        "the decline is counted AND the write happens anyway, which is the failure mode a "
        "counter alone would not catch",
        [(BGSYNC,
          '          noteSingleWriterDecline("subscribe-guest", path, this.logger);\n'
          "        } else if (remoteContent !== localContent) {",
          '          noteSingleWriterDecline("subscribe-guest", path, this.logger);\n'
          "          await this.writeToDisk(path, remoteContent, undefined, { preserveLocal: true });\n"
          "        } else if (remoteContent !== localContent) {")],
    ),
    (
        "W10",
        "A6 / S155 — every branch counted, including the do-nothing ones",
        "the ledger returns before its counters for every non-refusing decision, which is "
        "byte-for-byte the defect that cost WP115 a round",
        [(ATTEST,
          "  ledger.total += 1;\n  switch (verdict.decision) {",
          "  if (!verdict.refused) return;\n  ledger.total += 1;\n  switch (verdict.decision) {")],
    ),
    (
        "W11",
        "P5 — the short-circuit is the caller's contract",
        "the non-empty branch stops being decided first, so every ordinary publication "
        "becomes REFUSE_UNVERIFIABLE and the product stops syncing",
        [(ATTEST,
          "  if (input.attestedLength > 0) {\n"
          "    return {\n"
          "      decision: ATTESTATION_DECISION.PUBLISH_NOT_EMPTY,\n"
          '      reason: "the attestation is not empty; this floor governs empty attestations only",\n'
          "      refused: false,\n"
          "    };\n"
          "  }\n"
          "  if (input.fileLength === null) {",
          "  if (input.fileLength === null) {\n"
          "    return {\n"
          "      decision: ATTESTATION_DECISION.REFUSE_UNVERIFIABLE,\n"
          '      reason: "reordered",\n'
          "      refused: true,\n"
          "    };\n"
          "  }\n"
          "  if (input.attestedLength > 0) {")],
    ),
    (
        "W12",
        "NEGATIVE CONTROL",
        "the attestation refusal line is reworded; no decision, no counter and no branch is "
        "touched, and no row asserts this wording",
        [(ATTEST,
          "  return `ATTESTATION REFUSED: path=${path} reason=${reason}`;",
          "  return `ATTESTATION DECLINED: file=${path} because=${reason}`;")],
    ),
    (
        "W13",
        "B6 — the decline line's WORDING is pinned on purpose",
        "the single-writer line is reworded. NOT a negative control: B6 exists to pin this "
        "spelling, because S137's whole finding was that a refusal nobody can grep for cannot "
        "be attributed. The first cut of W12 bundled this edit and reddened B6 for exactly "
        "this reason; it is split out rather than quietly dropped",
        [(SINGLE,
          "    `SINGLE-WRITER DECLINE: arm=${arm} path=${path} reason=the editor owns this file's `",
          "    `SINGLE-WRITER SKIP: writer=${arm} file=${path} because=the editor owns this file's `")],
    ),
]

TARGETS = {MANIFEST, BGSYNC, ATTEST, SINGLE}


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
    # S133 — ANCHORED AT LINE START. An unanchored `[x×]` harvests prose.
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

    print("\n\n================ WP112 BREAK TABLE ================")
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
