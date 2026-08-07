// WP83 / C83 AC3 — "the canvas ownership invariant is stated as a property, not
// as a list of guarded sites."
//
// THE PROPERTY: no production module transmits file CONTENT for a path
// `skipsAutoTextSync` answers `true` for without consulting it — expressed at
// the seam where content is emitted, not by a hand-maintained allowlist of
// module names.
//
// HOW IT IS DECIDED, and where it admits it cannot be. Coverage is STRUCTURAL: a
// function is covered when it consults the predicate, or when it has in-module
// callers and every one of them is covered (fixpoint). `sendFileContent` is
// therefore covered without a guard of its own, because its only caller is
// `onFileCreate`, which has one — and that is the intended shape. Charter §2 is
// explicit that a second private guard at the downstream seam is the propagation
// pattern the shared predicate exists to stop.
//
// Where the property cannot be decided that way, the residue is ENUMERATED BY
// NAME with a written reason, and pinned with `toEqual`. A census that grows
// silently is the WP78 spawn-census failure mode; a `>=` count is the same
// failure with arithmetic on top.
//
// TWO PINS, and they fail on different things — that is deliberate:
//   PIN 1  the census itself. A NEW emission anywhere in production reddens it,
//          naming the site. Removing an emission reddens it too.
//   PIN 2  the unguarded residue. Removing AC1's guard reddens THIS one, on its
//          own, distinct from AC1's behavioural rows in tp01: `onFileCreate` and
//          `sendFileContent` both fall out of coverage and join the residue.
//
// THE VACUITY THIS FILE IS BUILT AGAINST is the WP82 diagnostic failure in test
// form: a pattern that matches nothing on a tree where the emitter has been
// renamed, reporting "zero unguarded emissions" as if that were a result. The
// first describe block is the positive control and runs before any absence is
// claimed: the seam names are still real declarations, the detector finds a
// known-present emission, and the detector demonstrably does NOT match a module
// that emits through a differently named method.

import { describe, expect, it } from "vitest";

import {
  EMISSION_SEAMS,
  type SourceFile,
  emissionSites,
  productionFiles,
  stripComments,
  unguardedEmitters,
} from "./wp83-source-derivation";

const PREDICATE = "skipsAutoTextSync";
const FILES = productionFiles();
const SITES = emissionSites(FILES);
const FILE_OPS = FILES.find((f) => f.name === "files/file-ops.ts");

// ---------------------------------------------------------------------------
// PIN 1 — the census. `toEqual` over the enumerated set, plus the raw occurrence
// count as a number, because two arms of one ternary share a key and only the
// count moves when a third is added.
// ---------------------------------------------------------------------------
const CENSUS = [
  "files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-data",
  "files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-end",
  "files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-resume",
  "files/file-ops.ts::emitOp::sendOp::-",
  "files/file-ops.ts::onFileCreate::emitOp::folder-create",
  "files/file-ops.ts::onFileCreate::sendFileContent::-",
  "files/file-ops.ts::onFileDelete::emitOp::delete",
  "files/file-ops.ts::onFileModify::emitOp::modify",
  "files/file-ops.ts::onFileModify::sendChunked::-",
  "files/file-ops.ts::onFileRename::emitOp::rename",
  "files/file-ops.ts::sendChunked::emitOp::chunk-data",
  "files/file-ops.ts::sendChunked::emitOp::chunk-end",
  "files/file-ops.ts::sendChunked::emitOp::chunk-start",
  "files/file-ops.ts::sendFileContent::emitOp::create",
  "files/file-ops.ts::sendFileContent::sendChunked::-",
  "files/file-ops.ts::setOnline::sendOp::-",
];
const CENSUS_RAW_OCCURRENCES = 17;

// ---------------------------------------------------------------------------
// PIN 2 — the residue, with the reason each member is admitted. A member without
// a reason fails the last test in this file, so the table cannot rot silently.
// ---------------------------------------------------------------------------
const UNGUARDED_WITH_REASON: Record<string, string> = {
  "files/file-ops.ts::applyRemoteOpInner":
    "the `chunk-resume` responder. It re-sends chunks of an ALREADY AUTHORISED " +
    "outgoing transfer, looked up by `transferId` in `outgoingTransfers`, which " +
    "only `sendChunked` ever populates. It originates no transfer and grants no " +
    "new authorisation, so a guard here would decide nothing.",
  "files/file-ops.ts::emitOp":
    "the shared exit. It forwards an op another function already constructed and " +
    "cannot see a path class. Guarding here would be a second, differently spelt " +
    "gate over every op type including the path-only ones — the propagation " +
    "pattern the shared predicate exists to stop.",
  "files/file-ops.ts::onFileDelete":
    "path-only (`{type:'delete'}`). Carries no content, so it can neither " +
    "overwrite a byte nor install a writer. Named OUT OF SCOPE by C83 §2 and " +
    "recorded as S43 — whether a peer's `.canvas` should be trashed by a remote " +
    "delete is a real question and it is not this WP's.",
  "files/file-ops.ts::onFileModify":
    "unreachable for a `.canvas` twice over and independently: the vault event " +
    "router returns into the text/canvas branch before reaching it, and the " +
    "method itself returns at `if (!binary) return;`. Byte-unchanged by C83 §2.",
  "files/file-ops.ts::onFileRename":
    "path-only (`{type:'rename', oldPath, newPath}`). Carries no content, so it " +
    "can neither overwrite a byte nor install a writer. Named OUT OF SCOPE by " +
    "C83 §2 and recorded as S43 alongside `onFileDelete`. WP68 owns the rename " +
    "boundary of this module and is not yet implemented.",
  "files/file-ops.ts::sendChunked":
    "reached only from `sendFileContent` (covered) and `onFileModify` (binary " +
    "only). C83 §2 forbids a second private guard here in as many words: " +
    "'closing the door upstream closes it'.",
  "files/file-ops.ts::setOnline":
    "the offline-queue drain. It replays ops that passed every gate when they " +
    "were enqueued; re-deciding them at drain time would apply a later verdict " +
    "to an earlier authorisation.",
};
const UNGUARDED = Object.keys(UNGUARDED_WITH_REASON).sort();

describe("WP83 AC3 — the detector can find what it claims to look for (positive control)", () => {
  it("every emission seam it keys on is still a real declaration in `files/file-ops.ts`", () => {
    // THE control. If `emitOp` were renamed, every "zero unguarded emissions"
    // below would be true and worthless. This row makes the rename fail loudly.
    expect(FILE_OPS, "files/file-ops.ts is gone from the production tree").toBeDefined();
    const code = FILE_OPS?.code ?? "";
    for (const seam of EMISSION_SEAMS) {
      expect(
        code,
        `the census keys on \`${seam}\`, and no declaration of that name exists ` +
          "any more. The detector would silently report fewer emissions.",
      ).toMatch(new RegExp(`(?:private|public|protected)?\\s*(?:async\\s+)?${seam}\\s*\\(`));
    }
  });

  it("it finds a known-present emission — the `create` op that carries the whole file", () => {
    const create = SITES.filter((s) => s.opType === "create");
    expect(create.length, "the `create` emission was not found at all").toBeGreaterThan(0);
    expect(create.map((s) => s.key)).toContain("files/file-ops.ts::sendFileContent::emitOp::create");
    expect(create[0].args).toContain("content");
  });

  it("it matches an emission in a synthetic module, and NOT one that uses a different method name", () => {
    const emits: SourceFile = {
      name: "fake/emits.ts",
      raw: "",
      code: [
        "class Door {",
        "  push(path: string, content: string) {",
        '    this.emitOp({ type: "create", path, content });',
        "  }",
        "}",
      ].join("\n"),
    };
    const renamed: SourceFile = {
      name: "fake/renamed.ts",
      raw: "",
      code: emits.code.replace("emitOp", "transmit"),
    };
    expect(emissionSites([emits]).map((s) => s.key)).toEqual([
      "fake/emits.ts::push::emitOp::create",
    ]);
    // Stated rather than hidden: the detector is keyed on names, so a rename to
    // a name it does not know is invisible to it. That is exactly why the first
    // test in this block pins the names against the real module.
    expect(emissionSites([renamed])).toEqual([]);
  });
});

describe("WP83 AC3 — PIN 1: the content-emission census", () => {
  it("the census is exactly this set — a new emission site reddens here, naming it", () => {
    expect([...new Set(SITES.map((s) => s.key))].sort()).toEqual(CENSUS);
  });

  it("the raw occurrence count is pinned as a number, not as a floor", () => {
    // Two arms of one ternary share a key. Only this number moves when a third
    // arm is added, which is the gap a set-only pin would leave open.
    expect(SITES.length).toBe(CENSUS_RAW_OCCURRENCES);
  });

  it("every emission resolved to an enclosing function", () => {
    expect(SITES.filter((s) => s.fn === null).map((s) => s.args)).toEqual([]);
  });
});

describe("WP83 AC3 — PIN 2: nothing emits content unguarded except the named residue", () => {
  it("the unguarded emitters are exactly the enumerated residue", () => {
    // Removing AC1's guard reddens THIS assertion on its own: `onFileCreate`
    // stops consulting, so it and `sendFileContent` both fall out of coverage.
    expect(unguardedEmitters(FILES, SITES, PREDICATE)).toEqual(UNGUARDED);
  });

  it("`onFileCreate` and `sendFileContent` are COVERED — the guard is what makes them so", () => {
    const uncovered = unguardedEmitters(FILES, SITES, PREDICATE);
    expect(uncovered).not.toContain("files/file-ops.ts::onFileCreate");
    expect(uncovered).not.toContain("files/file-ops.ts::sendFileContent");
  });

  it("coverage is structural, not an allowlist — an unguarded synthetic emitter is reported", () => {
    const synthetic: SourceFile = {
      name: "fake/unguarded.ts",
      raw: "",
      code: [
        "class Door {",
        "  async push(path: string, content: string) {",
        '    this.emitOp({ type: "create", path, content });',
        "  }",
        "}",
      ].join("\n"),
    };
    const sites = emissionSites([synthetic]);
    expect(unguardedEmitters([synthetic], sites, PREDICATE)).toEqual(["fake/unguarded.ts::push"]);

    const guarded: SourceFile = {
      ...synthetic,
      code: synthetic.code.replace(
        "    this.emitOp(",
        `    if (${PREDICATE}(path)) return;\n    this.emitOp(`,
      ),
    };
    expect(unguardedEmitters([guarded], emissionSites([guarded]), PREDICATE)).toEqual([]);
  });

  it("coverage propagates one hop to a private helper with only covered callers", () => {
    const mod: SourceFile = {
      name: "fake/two-hop.ts",
      raw: "",
      code: [
        "class Door {",
        "  async entry(path: string, content: string) {",
        `    if (${PREDICATE}(path)) return;`,
        "    this.helper(path, content);",
        "  }",
        "  private helper(path: string, content: string) {",
        '    this.emitOp({ type: "create", path, content });',
        "  }",
        "}",
      ].join("\n"),
    };
    expect(unguardedEmitters([mod], emissionSites([mod]), PREDICATE)).toEqual([]);

    // …and stops propagating the moment a second, unguarded caller appears.
    const second: SourceFile = {
      ...mod,
      code: mod.code.replace(
        "  private helper(",
        "  other(path: string, content: string) {\n    this.helper(path, content);\n  }\n  private helper(",
      ),
    };
    // `other` is not itself an emission site, so it is not a member of the
    // residue — the residue enumerates EMITTERS. What it does is remove
    // `helper`'s coverage, which is the whole point of the row.
    expect(unguardedEmitters([second], emissionSites([second]), PREDICATE)).toEqual([
      "fake/two-hop.ts::helper",
    ]);
  });

  it("every residue member carries a written reason, and no reason outlives its member", () => {
    expect(Object.keys(UNGUARDED_WITH_REASON).sort()).toEqual(
      unguardedEmitters(FILES, SITES, PREDICATE),
    );
    for (const [member, reason] of Object.entries(UNGUARDED_WITH_REASON)) {
      expect(reason.length, `${member} is admitted without a reason`).toBeGreaterThan(80);
    }
  });
});

describe("WP83 AC3 — the guard is the SHARED predicate, not a fifth private copy", () => {
  // AC1's most likely wrong implementation is a private `endsWith(".canvas")` at
  // the emission seam. It passes every behavioural row in tp01 and re-creates
  // the exact propagation pattern the shared predicate exists to stop ("four
  // private copies … is exactly how this defect class propagated").
  //
  // MEASURED, NOT ASSUMED: three private spellings already exist in the tree and
  // are NOT WP83's to repair. They are therefore pinned as a census rather than
  // asserted away, so this row is honest about the tree it runs on AND a new
  // copy — in `file-ops.ts` or anywhere else — reddens it by name.
  const PRIVATE_CANVAS_SPELLERS = [
    "files/canvas-mirror.ts", // :144 `isCanvasPath` — the mirror's own candidate filter
    "files/vault-events.ts", // :57 and :259 — the ownership router
    "utils.ts", // the predicate itself: the one sanctioned spelling
  ];

  it("the set of modules spelling `.canvas` privately is exactly the pinned census", () => {
    const spellers = FILES.filter((f) => /endsWith\(\s*["']\.canvas["']\s*\)/.test(f.code)).map(
      (f) => f.name,
    );
    expect(spellers.sort()).toEqual(PRIVATE_CANVAS_SPELLERS);
  });

  it("`files/file-ops.ts` is NOT among them — WP83 added no private copy", () => {
    expect(PRIVATE_CANVAS_SPELLERS).not.toContain("files/file-ops.ts");
    expect(FILE_OPS?.code ?? "").not.toMatch(/endsWith\(\s*["']\.canvas["']\s*\)/);
  });

  it("`files/file-ops.ts` takes the guard by importing the shared predicate from `utils.ts`", () => {
    expect(stripComments(FILE_OPS?.raw ?? "")).toMatch(
      new RegExp(`import[\\s\\S]*?\\b${PREDICATE}\\b[\\s\\S]*?from "\\.\\./utils"`),
    );
  });
});
