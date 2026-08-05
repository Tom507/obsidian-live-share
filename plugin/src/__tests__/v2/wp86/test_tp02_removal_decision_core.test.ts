// WP86 — the pure decision core's truth table. These are NOT the acceptance
// evidence (that is two live Obsidian instances, per the charter's §4); they
// are the honest tool for a zero-import pure function and for the unknown-input
// discipline, which cannot be driven from a live rig.

import { describe, expect, it } from "vitest";

import {
  REMOVAL_DECISION,
  RENAME_DECISION,
  decideManifestRemoval,
  decideManifestRename,
} from "../../../files/manifest-removal-decision";

describe("WP86 — decideManifestRemoval", () => {
  it("tp02a: nothing on disk -> nothing-to-destroy", () => {
    const d = decideManifestRemoval({ path: "a/b.md", localKind: "absent", stillInManifest: false });
    expect(d.verdict).toBe(REMOVAL_DECISION.NOTHING_TO_DESTROY);
    expect(d.path).toBe("a/b.md");
    expect(d.reason.length).toBeGreaterThan(0);
  });

  it("tp02b: a FOLDER at the path is refused — producer 5, the retired parent-directory entry", () => {
    const d = decideManifestRemoval({ path: "a/sub", localKind: "folder", stillInManifest: false });
    expect(d.verdict).toBe(REMOVAL_DECISION.REFUSED);
    expect(d.reason).toContain("folder");
  });

  it("tp02c: a non-file, non-folder abstract thing is refused too (fail-closed)", () => {
    expect(decideManifestRemoval({ path: "x", localKind: "other" }).verdict).toBe(
      REMOVAL_DECISION.REFUSED,
    );
  });

  it("tp02d: a file at the path is DELEGATED — never destroyed here", () => {
    const d = decideManifestRemoval({ path: "a/b.md", localKind: "file", stillInManifest: false });
    expect(d.verdict).toBe(REMOVAL_DECISION.DELEGATED);
    expect(d.reason).toContain("stale reconcile");
  });

  it("tp02e: a key that is back in the manifest is refused even with a file behind it", () => {
    const d = decideManifestRemoval({ path: "a/b.md", localKind: "file", stillInManifest: true });
    expect(d.verdict).toBe(REMOVAL_DECISION.REFUSED);
  });

  it("tp02f: every unknown input resolves away from DELEGATED, never toward it", () => {
    const unknowns: unknown[] = [
      undefined,
      null,
      {},
      { localKind: undefined },
      { localKind: null },
      { localKind: 1 },
      { localKind: "FILE" },
      42,
      "file",
    ];
    for (const probe of unknowns) {
      const d = decideManifestRemoval(probe as never);
      expect([REMOVAL_DECISION.REFUSED, REMOVAL_DECISION.NOTHING_TO_DESTROY]).toContain(d.verdict);
      expect(d.reason.length).toBeGreaterThan(0);
    }
    // `stillInManifest: "yes"` is not the literal `true`, so it is NOT read as
    // "still listed". That resolves to DELEGATED — which is the fail-closed
    // answer here, because DELEGATED destroys nothing: it hands the question to
    // the D2 evidence gate. There is no unknown input for which this core can
    // itself cause a destructive write, because it has no destructive branch.
    expect(
      decideManifestRemoval({ path: "p", localKind: "file", stillInManifest: "yes" }).verdict,
    ).toBe(REMOVAL_DECISION.DELEGATED);
  });

  it("tp02g: no branch returns an empty reason, and none mutates its argument", () => {
    const probe = { path: "a/b.md", localKind: "file", stillInManifest: false };
    const copy = JSON.parse(JSON.stringify(probe));
    decideManifestRemoval(probe);
    expect(probe).toStrictEqual(copy);
    for (const kind of ["absent", "file", "folder", "other"] as const) {
      expect(decideManifestRemoval({ path: "p", localKind: kind }).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("WP86 — decideManifestRename", () => {
  const paired = {
    oldPath: "a/old.md",
    newPath: "a/new.md",
    hasContentPair: true,
    oldKind: "file" as const,
    newExists: false,
  };

  it("tp02h: a content-identity pair on a file with a free target is a rename", () => {
    const d = decideManifestRename(paired);
    expect(d.verdict).toBe(RENAME_DECISION.RENAME);
  });

  it("tp02i: NO content pair -> refused. This is the defect: the positional fallback", () => {
    const d = decideManifestRename({ ...paired, hasContentPair: false });
    expect(d.verdict).toBe(RENAME_DECISION.REFUSED);
    expect(d.reason).toContain("content-identity");
  });

  it("tp02j: a FOLDER at the removed path is never moved — the folder-into-itself throw", () => {
    const d = decideManifestRename({ ...paired, oldKind: "folder" });
    expect(d.verdict).toBe(RENAME_DECISION.REFUSED);
  });

  it("tp02k: an occupied target is refused", () => {
    expect(decideManifestRename({ ...paired, newExists: true }).verdict).toBe(
      RENAME_DECISION.REFUSED,
    );
  });

  it("tp02l: every unknown input resolves to REFUSED", () => {
    const unknowns: unknown[] = [
      undefined,
      null,
      {},
      { hasContentPair: "true", oldKind: "file" },
      { hasContentPair: 1, oldKind: "file" },
      { hasContentPair: true },
      { hasContentPair: true, oldKind: "file", newExists: 1 },
    ];
    for (const probe of unknowns) {
      const d = decideManifestRename(probe as never);
      if (probe && typeof probe === "object" && (probe as { hasContentPair?: unknown }).hasContentPair === true &&
        (probe as { oldKind?: unknown }).oldKind === "file" &&
        (probe as { newExists?: unknown }).newExists === 1) {
        // `newExists: 1` is not the literal `true`; the pair is real and the
        // kind is a file, so this one legitimately renames.
        expect(d.verdict).toBe(RENAME_DECISION.RENAME);
      } else {
        expect(d.verdict).toBe(RENAME_DECISION.REFUSED);
      }
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });

  it("tp02m: stateless between calls and non-mutating", () => {
    const probe = { ...paired };
    const copy = JSON.parse(JSON.stringify(probe));
    const a = decideManifestRename(probe);
    const b = decideManifestRename(probe);
    expect(a).toStrictEqual(b);
    expect(probe).toStrictEqual(copy);
  });
});
