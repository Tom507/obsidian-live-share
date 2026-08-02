// WP21 AC4 blind2 — the survivors found by asking the CLASS what it still has,
// instead of asking the test files what they still say.
//
// Both other AC4 scans are text scans, and a text scan can only look for
// spellings someone thought of. This one inverts the direction: it reads the
// injection surface `CanvasSync` actually exposes, then requires that every
// `something.setXxx(` call a test file makes on a canvas-sync-shaped receiver
// names a method that EXISTS. A test that calls a deleted setter is then caught
// whatever it is called, and a test that calls a surviving one is never caught —
// which is the property a hand-written token list cannot guarantee.
//
// It is the same subject as the visible test (no surviving test pins the removed
// denial behaviour) approached from the class rather than from the corpus, and
// it additionally catches the case a token list is blind to: a NEW test written
// after the removal that reaches for the old seam out of habit.
//
// Receivers are matched conservatively — only identifiers that read as a canvas
// sync instance (`cs`, `canvasSync`, `t.cs`, `sync`) — so `presence.setX(...)`,
// `sm.setLogger(...)` and the binding's option object are structurally out of
// range and cannot be condemned.
//
// THE POLARITY RULE, and why this angle is immune to it by construction. The
// two text-scanning AC4 tests must distinguish a POSITIVE claim on the
// `LOCK DENIED:` signature (an offender — it pins behaviour that no longer
// exists) from an ABSENCE claim such as `toHaveLength(0)` (NOT an offender — it
// states the removal, and WP21 makes it permanently true). A substring scan
// cannot see that difference and produces a false positive on the absence form.
//
// This test cannot make that mistake: its oracle is REACHABILITY, not text. It
// asks whether a called method still exists on the class, and an assertion —
// of either polarity — about a log line calls nothing. The absence form is
// therefore structurally out of range rather than exempted, which is the
// stronger version of the same property. It is pinned explicitly below so the
// immunity is proven rather than assumed, and so this file states the corrected
// contract in the same terms as its two counterparts.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { CanvasSync } from "../../../files/canvas-sync";

const TESTS_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function collectTestFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(`${dir}/${entry.name}`, rel));
      continue;
    }
    if (entry.name.endsWith(".test.ts")) found.push(rel);
  }
  return found;
}

const isOwnFile = (rel: string) => /wp21/i.test(rel);

/** `<receiver>.set<Name>(` where the receiver reads as a CanvasSync instance. */
const CANVAS_SYNC_SETTER = /\b(?:t\.cs|cs|canvasSync|sync)\.(set[A-Z]\w*)\s*\(/g;

function canvasSyncMethods(): Set<string> {
  const instance = new CanvasSync(
    { getAbstractFileByPath: () => null } as never,
    { getDoc: () => undefined, releaseDoc: vi.fn(), waitForSync: async () => {} } as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  const names = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object));
  instance.destroy();
  return names;
}

describe("WP21 AC4 blind2 — no test calls a CanvasSync seam that no longer exists", () => {
  it("the class no longer exposes a per-node lock gate under any spelling", () => {
    const methods = canvasSyncMethods();
    const lockShaped = [...methods].filter((name) => /^setCan\w*Node$/.test(name));
    expect(
      lockShaped.sort(),
      "CanvasSync still exposes a per-node lock gate — AC4 cannot be satisfied while the seam exists",
    ).toEqual([]);
    expect(methods.has("setCanWrite"), "AC3: the authorisation seam was deleted too").toBe(true);
  });

  it("every CanvasSync setter a surviving test calls still exists on the class", () => {
    const methods = canvasSyncMethods();
    const offenders: string[] = [];

    for (const rel of collectTestFiles(TESTS_ROOT)) {
      if (isOwnFile(rel)) continue;
      const lines = readFileSync(`${TESTS_ROOT}${rel}`, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const match of line.matchAll(CANVAS_SYNC_SETTER)) {
          const method = match[1];
          if (methods.has(method)) continue;
          offenders.push(
            `${rel}:${index + 1} — calls \`${method}\`, which CanvasSync no longer exposes`,
          );
        }
      });
    }

    expect(
      offenders.sort(),
      "these tests inject into a seam WP21 deleted; remove them and enumerate each by name in ImplementationReport_WP21.md",
    ).toEqual([]);
  });

  it("the scan reaches the corpus and its receiver rule is not over-broad", () => {
    const files = collectTestFiles(TESTS_ROOT);
    expect(files.length, "the scan sees no tests — it would pass vacuously").toBeGreaterThan(20);
    expect(
      files.some((rel) => rel.endsWith("canvas-sync.test.ts")),
      "the scan does not reach the suite most likely to hold a survivor",
    ).toBe(true);

    // A surviving CanvasSync setter IS matched by the receiver rule (so the scan
    // is live), and non-CanvasSync receivers are NOT (so it cannot over-reach).
    const matched = (line: string) => [...line.matchAll(CANVAS_SYNC_SETTER)].map((m) => m[1]);
    expect(matched("    canvasSync.setCanWrite(() => false);")).toEqual(["setCanWrite"]);
    expect(matched("    t.cs.setSurfaceStateProvider(() => state);")).toEqual([
      "setSurfaceStateProvider",
    ]);
    expect(matched("    presence.setDisplayOptions(true, false);"), "a presence call was matched")
      .toEqual([]);
    expect(matched("    sm.setLogger(logger);"), "a SyncManager call was matched").toEqual([]);
    expect(
      matched("      canWriteNode: (_path, id) => id !== \"n1\","),
      "a CanvasBinding option was matched",
    ).toEqual([]);

    // THE POLARITY RULE, pinned. An assertion ABOUT the removed `LOCK DENIED:`
    // signature calls no setter, so this angle condemns neither polarity — and
    // in particular cannot produce the false positive a substring scan does on
    // the absence form, which states the removal instead of pinning it.
    expect(
      matched("    expect(warns.filter((m) => m.startsWith(\"LOCK DENIED:\"))).toHaveLength(0);"),
      "an ABSENCE claim on the removed signature was matched — it states the removal, it does not pin it",
    ).toEqual([]);
    expect(
      matched("    expect(warns.filter((m) => m.startsWith(\"LOCK DENIED:\"))).toHaveLength(1);"),
      "this angle must stay reachability-only; the signature's polarity is the text scans' job",
    ).toEqual([]);
    // …but a call into the DELETED seam is still caught, whatever it asserts.
    expect(
      matched("    canvasSync.setCanWriteNode((_p, nodeId) => nodeId !== \"n1\");"),
      "the removed setter escaped the receiver rule",
    ).toEqual(["setCanWriteNode"]);
  });
});
