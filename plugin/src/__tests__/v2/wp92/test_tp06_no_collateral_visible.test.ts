// WP92 / C92 AC6 — NO COLLATERAL. WP90's five properties, WP63's withhold and
// WP91's cap all survive, SHOWN BY DRIVING THEM.
//
// AC6(c) is the risk this file is built against: driving WP90's five properties
// on a store that was never populated makes every one of them true of the empty
// case. Every fixture below is POPULATED, and each property is paired with a
// control showing the assertion reddens when the property is removed.
//
// AC6(a): "unchanged" is asserted by RUNNING the diff, never by reading it. The
// structural case shells out to `git diff --name-only` with a positive control
// that the comparison is not empty.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// Touch `utils.ts`, `canvas-sidecar.ts`, `canvas-sync.ts` or `file-ops.ts` and
// the structural case names the file. Let `load()` write and the hydration≠
// persistence case reddens on the write count. Let a migration run on a
// quarantined store and the degradation case reddens on the preserved bytes.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { isSidecarPath, seedRefusalStorePath } from "../../../files/canvas-sidecar";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import { findPluginSrc } from "./census";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  legacyEntry,
  legacyStoreFile,
  refusal,
} from "./harness";

const KEY = "guid-collateral";
const OTHER = "guid-other";

function repoRoot(): string {
  return findPluginSrc().replace(/[/\\]plugin[/\\]src$/, "");
}

function git(...args: string[]): string[] {
  return execFileSync("git", args, { cwd: repoRoot(), encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

/**
 * THIS work package's change set, in a SHARED working tree.
 *
 * Not `git diff HEAD`. That answers "what is uncommitted", which in this tree is
 * a union of every live batch and which becomes EMPTY the moment WP92 commits —
 * at which point "no forbidden file is in the diff" would be true for free, and
 * the assertion would have stopped meaning anything without anyone noticing.
 * That is the exact class this run keeps producing.
 *
 * So the set is located from WP92's own artefact: the commit that ADDED
 * `__tests__/v2/wp92/`, unioned with whatever of WP92's files is still
 * uncommitted. Self-locating, always non-empty, and unaffected by a sibling.
 */
function wp92Commit(): string | null {
  // ⚠ NEVER `HEAD`. A sibling batch commits into this branch while WP92 runs —
  // it happened during this batch's own falsification pass — and every `HEAD`
  // reference silently started pointing at someone else's work, which turned a
  // real assertion into one that could no longer see its own subject.
  const commits = git(
    "log",
    "--diff-filter=A",
    "--format=%H",
    "-1",
    "--",
    "plugin/src/__tests__/v2/wp92",
  );
  return commits.length > 0 ? commits[0] : null;
}

/** Every line WP92 ADDED to `file`, across its own commit and the live tree. */
function wp92AddedLines(file: string): string[] {
  const commit = wp92Commit();
  const fromCommit = commit
    ? git("show", "--unified=0", "--format=", commit, "--", file)
    : [];
  return [...fromCommit, ...git("diff", "--unified=0", "--", file)].filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  );
}

function wp92ChangedFiles(): string[] {
  const commit = wp92Commit();
  const fromCommit = commit ? git("show", "--name-only", "--format=", commit) : [];
  const fromTree = git("diff", "--name-only", "HEAD");
  return [...new Set([...fromCommit, ...fromTree])];
}

describe("WP92 AC6 — WP90's five properties, driven on POPULATED fixtures", () => {
  it("1. IDS, REASONS AND BOUNDARIES ONLY — an extra field is left at the door, by the same one gate", async () => {
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    store.save(KEY, [
      { ...refusal("n-bad"), secret: "the user's node text" } as never,
    ]);
    await store.idle();
    const text = storeIO.text() as string;
    expect(text, "the store recorded nothing — this property is vacuous").toContain("n-bad");
    expect(text, "a field outside the four-key projection reached the bytes").not.toContain(
      "secret",
    );
    expect(text).not.toContain("the user's node text");
  });

  it("2. NOTHING IS RE-INJECTED — a withheld flush produces no bytes at all", async () => {
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: legacyStoreFile({ [KEY]: legacyEntry("n-bad") }),
    });
    const doc = new Y.Doc();
    // A non-empty doc that has NEVER contained the refused record.
    doc.getMap<Y.Map<unknown>>("nodes").set("n-ok", new Y.Map(Object.entries(VALID_NODE)));
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ "board.canvas": before });
    const p = new CanvasPersistence(doc, io, "board.canvas", {
      durableRefusals: new SeedRefusalStore(storeIO, {}),
      refusalIdentity: KEY,
    });
    expect(await p.coldOpen()).toBe("doc-wins");
    await p.flush();
    expect(p.isWriteWithheld(), "nothing was withheld — the property is untested").toBe(true);
    expect(io.write, "a withhold produced bytes").not.toHaveBeenCalled();
    expect(io.files.get("board.canvas")).toBe(before);
    p.destroy();
    doc.destroy();
  });

  it("3. LOCAL-ONLY — the one path this WP writes still satisfies isSidecarPath", async () => {
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    store.save(KEY, [refusal("n-bad")]);
    store.migrate("legacy/path.canvas", KEY);
    await store.idle();
    expect(storeIO.written.length, "nothing was written — the property is vacuous").toBeGreaterThan(
      0,
    );
    // Driven off the paths actually written, never off the constant.
    for (const written of storeIO.written) {
      expect(isSidecarPath(written), `${written} escaped SIDECAR_DIR`).toBe(true);
    }
    expect(new Set(storeIO.written)).toEqual(new Set([seedRefusalStorePath()]));
  });

  it("4. DEFINED DEGRADATION — a MIGRATION cannot launder a failed read into the file", async () => {
    const corrupt = '{"version": 1, "paths": ';
    const storeIO = createStoreIO({ [seedRefusalStorePath()]: corrupt });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });

    expect(await store.load(KEY)).toEqual([]);
    expect(store.describeHealth(), "the fixture did not fail to read").toBe("unreadable");
    store.migrate("legacy/path.canvas", KEY);
    store.save(KEY, [refusal("n-bad")]);
    await store.idle();

    expect(storeIO.written, "the quarantine was bypassed by the new write path").toEqual([]);
    expect(storeIO.text(), "the forensic bytes were destroyed").toBe(corrupt);
    expect(log.lines.some((l) => l.includes("quarantined"))).toBe(true);
  });

  it("5. HYDRATION ≠ PERSISTENCE — an ordinary hydrate performs ZERO writes", async () => {
    const storeIO = createStoreIO({
      [seedRefusalStorePath()]: legacyStoreFile({
        [KEY]: legacyEntry("n-bad"),
        [OTHER]: legacyEntry("n-other"),
      }),
    });
    const doc = new Y.Doc();
    doc.getMap<Y.Map<unknown>>("nodes").set("n-ok", new Y.Map(Object.entries(VALID_NODE)));
    const io = createIO({ "board.canvas": canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const store = new SeedRefusalStore(storeIO, {});
    const p = new CanvasPersistence(doc, io, "board.canvas", {
      durableRefusals: store,
      refusalIdentity: KEY,
    });

    expect(await p.coldOpen()).toBe("doc-wins");
    await store.idle();

    // The hydrate FOUND something — otherwise "no write" is true of the empty
    // case, which is exactly AC6(c)'s trap.
    expect(p.seedRefusals().map((r) => r.id), "the hydrate found nothing").toEqual(["n-bad"]);
    expect(storeIO.written, "reading the store wrote to it").toEqual([]);
    expect(storeIO.write).not.toHaveBeenCalled();

    p.destroy();
    doc.destroy();
  });

  it("WP91's cap is untouched, and it is the newest thing in the file this WP edits", () => {
    // `MAX_MUTE_MS` is module-private, so it is read from the source it is
    // defined in rather than imported — and both of its terms are pinned, not
    // just their sum, so a compensating pair of edits still reddens.
    const src = readFileSync(join(findPluginSrc(), "files", "canvas-persistence.ts"), "utf8");
    expect(src, "DISK_WRITE_SETTLE_MS moved").toMatch(/const DISK_WRITE_SETTLE_MS = 250;/);
    expect(src, "WP91's ceiling is no longer MAX_WAIT_MS + DISK_WRITE_SETTLE_MS").toMatch(
      /const MAX_MUTE_MS = MAX_WAIT_MS \+ DISK_WRITE_SETTLE_MS;/,
    );
  });

  it("STRUCTURAL: no out-of-scope file carries a WP92 line — attributable in a SHARED tree", () => {
    const changed = wp92ChangedFiles();
    // AC6(a)'s positive control: a comparison over an empty change set would
    // report every file untouched, perfectly.
    expect(
      changed.length,
      "git reported no changes at all — this assertion would be vacuous",
    ).toBeGreaterThan(0);
    expect(
      changed.some((f) => f.endsWith("plugin/src/files/seed-refusal-store.ts")),
      "this WP's own file is not in the diff — the comparison is looking at the wrong tree",
    ).toBe(true);

    // ⚠ RULE 14 — THE WORKING TREE IS SHARED, so "not in the diff" is not a
    // statement any single batch can make about a file a sibling is live in. The
    // instrument is therefore ATTRIBUTION rather than absence: a forbidden file
    // may appear in the diff (a sibling's work), but not one ADDED line in it may
    // carry this work package's marker. That is decidable per batch, and it stays
    // decidable no matter how many agents are typing.
    for (const forbidden of [
      "plugin/src/utils.ts",
      "plugin/src/files/canvas-sidecar.ts",
      "plugin/src/files/canvas-sync.ts",
      "plugin/src/files/file-ops.ts",
      "plugin/src/sync/control-handlers.ts",
      "plugin/src/files/vault-events.ts",
    ]) {
      if (!changed.includes(forbidden)) continue;
      const added = wp92AddedLines(forbidden);
      expect(
        added.filter((line) => /WP92|refusalIdentity|SeedRefusalStore|seedRefusalFlush/.test(line)),
        `${forbidden} carries a WP92 line and is out of this WP's scope`,
      ).toEqual([]);
    }
    // The one that has no sibling excuse: `utils.ts`'s character map. 30+ call
    // sites across 8 modules and a landed comment reasons from its membership.
    expect(changed, "utils.ts was modified — that is an ESCALATE, not a fix").not.toContain(
      "plugin/src/utils.ts",
    );
    // ----------------------------------------------------------------- WP95 --
    // CONVERTED TO THE METHOD THIS FUNCTION'S OWN COMMENT PRESCRIBES, eleven
    // lines up, and which the loop above already applies to the six production
    // files: ATTRIBUTION, not absence.
    //
    // These two lines used to assert whole-file diff PRESENCE — that nothing
    // under `wp63/` or `wp90/` appears in the change set at all. That is exactly
    // the statement RULE 14 says no single batch can make about a shared tree,
    // and this function says so itself before contradicting itself here. It is
    // also a tripwire on the wrong thing: it reds for ANY future batch that so
    // much as touches those directories, whoever they are and whatever they did.
    //
    // It fired that way for real. A sibling batch edited
    // `wp90/test_tp06_…` under a Dispatcher ruling that had nothing to do with
    // this work package, and this row reported it as a WP92 scope violation.
    //
    // The replacement is STRICTER where it matters, not weaker: a file in these
    // directories may now be touched by somebody else, but not one ADDED line
    // anywhere in either directory may carry a WP92 marker. A genuine in-scope
    // leak is still caught; a sibling's unrelated edit is no longer misreported
    // as one. Same regex, same helper, same discipline as the loop above.
    for (const dir of ["__tests__/v2/wp63/", "__tests__/v2/wp90/"]) {
      for (const file of changed.filter((f) => f.includes(dir))) {
        expect(
          wp92AddedLines(file).filter((line) =>
            /WP92|refusalIdentity|SeedRefusalStore|seedRefusalFlush/.test(line),
          ),
          `${file} carries a WP92 line and ${dir} is out of this WP's scope`,
        ).toEqual([]);
      }
    }

    // …and the ATTRIBUTION detector is shown FIRING, on this WP's own in-scope
    // file. Without it, "no forbidden file carries a WP92 line" would be
    // satisfied by a regex that matches nothing — the same shape as a census
    // reporting zero violations from an empty input set.
    expect(
      wp92AddedLines("plugin/src/files/canvas-persistence.ts").filter((line) =>
        /WP92|refusalIdentity|SeedRefusalStore|seedRefusalFlush/.test(line),
      ).length,
      "the WP92 marker regex matches nothing at all — the attribution check cannot fail",
    ).toBeGreaterThan(0);
  });

  it("POSITIVE CONTROL for the empty-directory trap — wp63/ and wp90/ are not empty", () => {
    // Reading them proves the "not in the diff" assertion above is about real
    // files. WP90's precedent, and it is why WP63's contract stands by
    // measurement rather than by claim.
    const wp63 = git("ls-files", "plugin/src/__tests__/v2/wp63");
    const wp90 = git("ls-files", "plugin/src/__tests__/v2/wp90");
    expect(wp63.length, "wp63/ is empty — 'not in the diff' would be free").toBeGreaterThan(0);
    expect(wp90.length, "wp90/ is empty — 'not in the diff' would be free").toBeGreaterThan(0);
  });
});
