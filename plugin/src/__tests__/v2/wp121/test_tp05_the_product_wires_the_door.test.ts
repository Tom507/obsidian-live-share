// WP121 — THE PRODUCTION WIRING, PINNED STRUCTURALLY.
//
// `preserveDiscarded` is OPTIONAL on `CanvasPersistenceOpts`, and it has to be:
// every pre-WP121 caller and every headless fixture in this suite constructs a
// `CanvasPersistence` without one, and each must keep behaving exactly as it
// did. But `canvas-persistence.ts` states the opposite rule for the guards it
// cannot make optional — "a caller that forgets one silently loses the
// guarantee, and a canvas write is exactly where that must not be possible".
//
// Both are satisfiable at once only if something OTHER than the type system
// asserts that the PRODUCT wires it. That is this file. The criterion is derived
// from `main.ts`'s source — every `attachCanvasPersistence(` call site must
// carry a `preserveDiscarded:` key — rather than from a hand list, because a
// hand list cannot catch the second call site the next work package writes.
//
// 🔴 THE POSITIVE CONTROL HAS TWO HALVES (`S53`). After a repair, "the class is
// empty" and "the deriver went blind" produce the same output, so:
//   ├── HALF A — it can find one. Run against {@link PRE_WP121_ATTACH}, a
//   │   literal of the pre-WP121 call site, the deriver must report it UNWIRED.
//   └── HALF B — it refuses to answer on nothing. An input with no call site at
//       all THROWS rather than reporting "all sites wired".
//
// CAVEAT, stated rather than discovered (`S88`'s shape): this test reads the
// LIVE WORKING COPY of `main.ts`. A batch editing that file makes this row
// transiently red, and the redness is not attributable to WP121.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findPluginSrc, stripComments } from "../wp92/census";

interface AttachSite {
  readonly line: number;
  readonly wired: boolean;
}

/** Balanced read of the whole argument list of one `attachCanvasPersistence(` call. */
function callArguments(code: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openParen + 1, i);
    }
  }
  throw new Error("WP121 census: unbalanced attachCanvasPersistence( call");
}

/**
 * Every `attachCanvasPersistence(` call site in `source`, and whether its
 * options object carries a `preserveDiscarded:` key.
 *
 * THROWS on an input with no call site — half B of the control.
 */
export function deriveAttachSites(source: string): AttachSite[] {
  const code = stripComments(source);
  const sites: AttachSite[] = [];
  const scan = /(?:^|[^\w.])attachCanvasPersistence\s*\(/g;
  let match = scan.exec(code);
  while (match !== null) {
    const open = code.indexOf("(", match.index + match[0].length - 1);
    const args = callArguments(code, open);
    sites.push({
      line: code.slice(0, open).split(/\r?\n/).length,
      wired: /(?:^|[^\w.])preserveDiscarded\s*:/.test(args),
    });
    match = scan.exec(code);
  }
  if (sites.length === 0) {
    throw new Error(
      "WP121 attach census: no attachCanvasPersistence call site found — refusing to " +
        "report the class closed (S53 positive control, half B)",
    );
  }
  return sites;
}

/**
 * The pre-WP121 call site, as a LITERAL — half A of the control.
 *
 * Never regenerate this from the tree: it is what the build that HAD the defect
 * actually did, and the deriver's ability to report it unwired is the only
 * evidence that a green on the real tree means anything.
 */
export const PRE_WP121_ATTACH = `
      const { persistence, coldOpen } = await attachCanvasPersistence(
        handle.doc,
        io,
        toLocalPath(canonical),
        {
          logger: this.logger,
          onWritten: (content) => this.canvasSync?.noteExternalDiskWrite(canonical, content),
          seedRefusals: this.canvasSync?.seedRefusalLedger(canonical),
          durableRefusals: seedRefusalStore,
          refusalIdentity: this.canvasSync?.getCanvasGuid(canonical) ?? null,
          seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false, role: "guest" },
        },
      );
`;

describe("WP121 — the deriver's positive control", () => {
  it("HALF A: it reports the PRE-WP121 call site as UNWIRED", () => {
    const sites = deriveAttachSites(PRE_WP121_ATTACH);
    expect(sites).toHaveLength(1);
    expect(sites[0].wired).toBe(false);
  });

  it("HALF B: it THROWS on an input with no call site rather than reporting success", () => {
    expect(() => deriveAttachSites("const x = 1;\n")).toThrow(/refusing to report/);
  });

  it("it is not fooled by the name appearing only in a comment", () => {
    expect(() =>
      deriveAttachSites("// attachCanvasPersistence( is mentioned here\nconst x = 1;\n"),
    ).toThrow(/refusing to report/);
  });
});

describe("WP121 — the product wires the preservation door", () => {
  it("every attachCanvasPersistence call site in main.ts carries preserveDiscarded", () => {
    const source = readFileSync(`${findPluginSrc()}/main.ts`, "utf8");
    const sites = deriveAttachSites(source);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.filter((s) => !s.wired)).toEqual([]);
  });

  it("the wired door reads the SHARED FOLDER setting, not a literal", () => {
    // The conflicts root is a SIBLING of the share (`S125` AC7/AC9). A literal
    // here would put every vault's copies in one place regardless of what the
    // user configured, and `isConflictsPath` — the OWNED exclusion consulted by
    // `isSharedPath` — would then not cover them: the copies would be published,
    // re-conflicted on the next join, and multiply without bound.
    const code = stripComments(readFileSync(`${findPluginSrc()}/main.ts`, "utf8"));
    const open = code.indexOf("preserveDiscarded:");
    expect(open).toBeGreaterThan(-1);
    const block = code.slice(open, open + 400);
    expect(block).toMatch(/sharedFolder:\s*this\.settings\.sharedFolder/);
  });

  it("the copy does NOT travel through the decorated canvas-writer IO", () => {
    // WP87's editing-aware hold decorates `io.write` and re-plays deferred bytes
    // under the CANVAS path's key. A one-shot additive copy to a conflicts-root
    // path has no business in that queue; `baseIo` still carries `isPathSafe`
    // and `ensureFolder`, which are the guarantees a vault write actually needs.
    const code = stripComments(readFileSync(`${findPluginSrc()}/main.ts`, "utf8"));
    const open = code.indexOf("preserveDiscarded:");
    const block = code.slice(open, open + 400);
    expect(block).toMatch(/write:\s*\(copyPath,\s*content\)\s*=>\s*baseIo\.write\(/);
    expect(block).not.toMatch(/write:\s*\(copyPath,\s*content\)\s*=>\s*io\.write\(/);
  });

  it("the copy's write parameter is NOT named `diskPath` — WP87's census discriminates on it", () => {
    // Not cosmetic. `surface-route-census.ts` derives its live-canvas-surface
    // vocabulary from `PersistenceIO`'s declaration and matches
    // `write(<something>diskPath` — its own comment names "a conflict archive"
    // as one of the three writes that discriminator exists to EXCLUDE. Spelling
    // this parameter `diskPath` files the conflict archive as a live-surface
    // write, and WP87's criterion then reports an unguarded route that does not
    // exist. Pinned here so a future rename is a red row rather than a puzzle in
    // somebody else's package.
    const code = stripComments(readFileSync(`${findPluginSrc()}/main.ts`, "utf8"));
    const open = code.indexOf("preserveDiscarded:");
    const block = code.slice(open, open + 400);
    expect(block).not.toMatch(/write:\s*\(\s*diskPath\b/);
  });
});

describe("WP121 — a canvas event is readable through the live ledger", () => {
  it("main.ts's getConflictCopies is the module's, so `sync.conflictCopies` sees the canvas arm", () => {
    // `e2e-control.ts:1645` (`sync.conflictCopies`) calls
    // `plugin.getConflictCopies()`. Without this, A4's canvas arm would exist in
    // the module and be invisible to the next live round — which is the exact
    // failure `S155` documents.
    const code = stripComments(readFileSync(`${findPluginSrc()}/main.ts`, "utf8"));
    expect(code).toMatch(/getConflictCopies\(\)\s*:\s*ConflictCopyLedger\s*\{\s*return getConflictCopies\(\);/);
  });
});
