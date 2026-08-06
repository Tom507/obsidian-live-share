// WP68 / C68 AC5 — ONE PREDICATE, ONE DEFINITION, at the two named boundaries.
//
// "Verified against the source, in the same style and with the same discipline
// as C26 AC3 — the claim is checked by RUNNING AN EXTRACTION over the source,
// not by reading it."
//
// So this file derives. It reuses WP83's tree-walking helpers rather than
// growing a second copy of them, for the same reason the criterion exists: a
// second private copy of a rule is how this defect class propagated in the first
// place. Nothing here is a behavioural claim — the behaviour is TP01–TP04. This
// is the source-structure half and only that half.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ───────────────────────────────────────────
//   · Re-spell the directory at either guard (`path.startsWith(".obsidian/…")`)
//     → "spelt in exactly one production module" and "no guard module rebuilds
//     the test out of its own parts" both redden.
//   · Move either guard out of its named boundary function → the two
//     `<module>::<function>` rows redden by name.
//   · Duplicate the inbound guard per op type → the "exactly one call site in
//     the inbound module" row reddens.
//   · Add a new `FileOp` variant → the derived-vs-pinned op-type row reddens,
//     which is the point: the rename branch is the only one admitted on
//     `.some(isSharedPath)`, and that claim has to be re-decided when the class
//     of ops changes rather than silently inherited.
// All four verified; messages in the report's break table.
//
// ── THE POSITIVE CONTROL ─────────────────────────────────────────────────────
// A census that reports "no re-spelling found" without having proved it can find
// one is not a measurement. `reddens on a synthetic module` below plants each
// violation and requires the same functions to report it.

import { describe, expect, it } from "vitest";

import { SIDECAR_DIR } from "../../../files/canvas-sidecar";
import {
  type SourceFile,
  callSitesOf,
  distinctIds,
  productionFiles,
  stripComments,
} from "../wp83/wp83-source-derivation";

const PREDICATE = "isSidecarPath";
const OWNER = "files/canvas-sidecar.ts";
const OUTBOUND = "files/file-ops.ts";
const INBOUND = "sync/control-handlers.ts";

const FILES = productionFiles();
const SITES = callSitesOf(FILES, PREDICATE, [OWNER]);

function file(name: string): SourceFile {
  const found = FILES.find((f) => f.name === name);
  if (!found) throw new Error(`${name} is not in the production tree`);
  return found;
}

describe("WP68 AC5 — the derivation can find what it claims to look for", () => {
  it("both boundary modules are in the walked tree, and the walk is not empty", () => {
    expect(FILES.length, "the production walk found nothing").toBeGreaterThan(20);
    expect(file(OUTBOUND).code.length).toBeGreaterThan(1000);
    expect(file(INBOUND).code.length).toBeGreaterThan(1000);
  });

  it("the predicate has call sites at all, and every one resolves to a function", () => {
    expect(SITES.length, "zero call sites derived — the pattern matches nothing").toBeGreaterThan(
      3,
    );
    const unresolved = SITES.filter((s) => s.fn === null).map((s) => s.id);
    expect(unresolved, "a call site could not be attributed to an enclosing function").toEqual([]);
  });
});

describe("WP68 AC5 — both guards consult the shared predicate at the two named boundaries", () => {
  it("the outbound guard is in `onFileRename` and nowhere else in that module", () => {
    const ids = distinctIds(SITES.filter((s) => s.module === OUTBOUND));
    expect(ids, "the outbound guard is not at the boundary the charter names").toEqual([
      `${OUTBOUND}::onFileRename`,
    ]);
  });

  it("the inbound guard is in `registerControlHandlers` and is a SINGLE call site", () => {
    const inbound = SITES.filter((s) => s.module === INBOUND);
    expect(distinctIds(inbound)).toEqual([`${INBOUND}::registerControlHandlers`]);
    // "placed at the two named boundaries rather than duplicated per op type".
    // One call site, not nine.
    expect(inbound.length, "the guard was duplicated per op type").toBe(1);
  });

  it("both modules IMPORT the predicate from its owning module", () => {
    for (const name of [OUTBOUND, INBOUND]) {
      expect(file(name).code, `${name} does not import the predicate`).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${PREDICATE}\\b[^}]*\\}\\s*from\\s*"[^"]*canvas-sidecar"`),
      );
    }
  });

  it("neither guard uses `skipsAutoTextSync` for the rename boundary", () => {
    // The charter rules it out by name: this boundary must keep passing an
    // ordinary `.canvas`. `file-ops.ts` still calls it in `onFileCreate`
    // (WP83's door), so the check is per-FUNCTION, not per-module — a module
    // check would be satisfied by nothing and would also be unable to fail.
    const wrong = callSitesOf(FILES, "skipsAutoTextSync", ["utils.ts"]);
    const atOurBoundaries = distinctIds(wrong).filter(
      (id) => id === `${OUTBOUND}::onFileRename` || id === `${INBOUND}::registerControlHandlers`,
    );
    expect(atOurBoundaries).toEqual([]);
    // POSITIVE CONTROL: the `skipsAutoTextSync` derivation is not empty, so the
    // absence above is a fact about our two boundaries and not about the search.
    expect(distinctIds(wrong)).toContain(`${OUTBOUND}::onFileCreate`);
  });
});

describe("WP68 AC5 — no second spelling, no second constant", () => {
  it("the sidecar directory literal is still spelt in exactly one production module", () => {
    const spellers = FILES.filter((f) => f.code.includes(SIDECAR_DIR)).map((f) => f.name);
    expect(spellers).toEqual([OWNER]);
  });

  it("neither guard module rebuilds the test out of its own parts", () => {
    // `.obsidian/liveshare` re-spelt with a different tail, or the segments
    // concatenated at the call site, are both a second definition.
    const head = SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"));
    for (const name of [OUTBOUND, INBOUND]) {
      expect(file(name).code, `${name} re-spells the sidecar directory`).not.toContain(head);
      expect(file(name).code).not.toContain("SIDECAR_DIR");
      expect(file(name).code, `${name} writes its own extension test`).not.toMatch(
        /\.yhistory|\.ycheckpoint/,
      );
    }
  });

  it("`isSidecarPath` is still defined exactly once, in the module that owns it", () => {
    const definers = FILES.filter((f) =>
      new RegExp(`(?:export\\s+)?(?:function|const)\\s+${PREDICATE}\\b`).test(f.code),
    ).map((f) => f.name);
    expect(definers).toEqual([OWNER]);
  });
});

describe("WP68 AC5 — the class of file ops is CLOSED, derived rather than remembered", () => {
  // The charter's reason for scoping this WP to `rename` alone is that every
  // OTHER op type is already admitted on the strict all-paths form. That is a
  // claim about a CLASS, so the class is derived from `types.ts` and compared
  // against a pinned table. A new variant reddens this row and forces the
  // decision to be retaken rather than silently inherited.
  const PINNED = [
    "chunk-data",
    "chunk-end",
    "chunk-resume",
    "chunk-start",
    "create",
    "delete",
    "folder-create",
    "modify",
    "rename",
  ];

  it("the derived FileOp type set matches the pinned table", () => {
    const types = file("types.ts");
    const union = /export type FileOp =([\s\S]*?);/.exec(types.code);
    expect(union, "the FileOp union could not be located").not.toBeNull();
    const members = (union?.[1] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(members.length, "no union members parsed").toBeGreaterThan(4);

    const derived = new Set<string>();
    for (const member of members) {
      const decl = new RegExp(`interface\\s+${member}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(types.code);
      expect(decl, `no declaration found for ${member}`).not.toBeNull();
      const literal = /type:\s*"([a-z-]+)"/.exec(decl?.[1] ?? "");
      expect(literal, `${member} has no discriminant literal`).not.toBeNull();
      derived.add(literal?.[1] as string);
    }
    expect([...derived].sort()).toEqual(PINNED);
  });

  it("only the `rename` branch of the inbound gate consults the sidecar predicate", () => {
    // The guard sits inside `if (isRename) { … }`. Derived by locating the
    // branch and requiring the predicate call to be inside it, rather than by
    // reading the file and agreeing with it.
    const code = file(INBOUND).code;
    const branchAt = code.indexOf('const isRename = op.type === "rename"');
    expect(branchAt, "the rename branch could not be located").toBeGreaterThan(-1);
    const elseAt = code.indexOf("} else {", branchAt);
    expect(elseAt).toBeGreaterThan(branchAt);

    const inBranch = code.slice(branchAt, elseAt);
    expect(inBranch, "the guard is not inside the rename branch").toContain(`${PREDICATE}(`);

    // …and the non-rename branch still uses the strict all-paths form, untouched.
    const afterElse = code.slice(elseAt, elseAt + 300);
    expect(afterElse).toContain("paths.some((path) => !plugin.manifestManager.isSharedPath(path))");
    expect(afterElse, "WP68 leaked into the other op types").not.toContain(`${PREDICATE}(`);
  });
});

describe("WP68 AC5 — the derivation reddens (its own positive control)", () => {
  it("reddens on a synthetic module that re-spells the directory and guards elsewhere", () => {
    const synthetic: SourceFile[] = [
      {
        name: "fake/second-copy.ts",
        raw: "",
        code: [
          "class SecondCopy {",
          "  onSomethingElse(path: string) {",
          `    if (path.startsWith("${SIDECAR_DIR}/")) return;`,
          `    if (${PREDICATE}(path)) return;`,
          "    this.send(path);",
          "  }",
          "}",
        ].join("\n"),
      },
    ];
    // 1. the call-site derivation reports the wrong boundary…
    expect(distinctIds(callSitesOf(synthetic, PREDICATE, [OWNER]))).toEqual([
      "fake/second-copy.ts::onSomethingElse",
    ]);
    // 2. …and the literal census reports the re-spelling.
    expect(synthetic.filter((f) => f.code.includes(SIDECAR_DIR)).map((f) => f.name)).toEqual([
      "fake/second-copy.ts",
    ]);
    // 3. …and neither of those names is in the real tree's answers.
    expect(distinctIds(SITES)).not.toContain("fake/second-copy.ts::onSomethingElse");
  });

  it("a predicate named only in a COMMENT is not a call site — the strip is real", () => {
    const synthetic: SourceFile[] = [
      {
        name: "fake/only-prose.ts",
        raw: "",
        code: stripComments(
          [
            "class Prose {",
            "  method(path: string) {",
            `    // guarded by ${PREDICATE}(path) elsewhere`,
            `    /* and ${PREDICATE}(path) again */`,
            "    return path;",
            "  }",
            "}",
          ].join("\n"),
        ),
      },
    ];
    expect(callSitesOf(synthetic, PREDICATE, [OWNER])).toEqual([]);
  });
});
