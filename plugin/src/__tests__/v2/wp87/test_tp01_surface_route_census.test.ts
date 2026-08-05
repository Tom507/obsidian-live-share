// WP87 AC2 — the route set is DERIVED FROM THE TREE, and no reachable path from
// a remote change to a live canvas surface gets there without consulting the ONE
// editing predicate and acting on the answer.
//
// The reverse assertions (S53) come FIRST in this file on purpose: WP86's census
// deriver returned an empty set and both "every derived site is pinned" rows
// passed on it, and WP88's parser then mistook a type literal in a multi-line
// signature for a function body. An enumeration that returns nothing satisfies
// "all of them are pinned" perfectly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SRC_ROOT,
  censusFromTree,
  countMatches,
  deriveCensus,
  deriveFileWriters,
  deriveViewMutators,
  parseUnits,
} from "./surface-route-census";

const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");
const WRITER = [{ name: "write", firstParam: "diskPath" }];

describe("WP87 AC2 — the deriver itself (S53: the anti-vacuity instrument, first)", () => {
  it("parses a real number of units — an empty parse is not an empty census", () => {
    expect(censusFromTree().unitCount).toBeGreaterThan(200);
  });

  it("S53's ORIGINAL TRAP, live in this tree: a `{` in the PARAMETER LIST is not the body", () => {
    // `main.ts#reconcileLiveCanvas` opens a `{` inside its parameter list, on the
    // line after its name. A parser that takes the first `{` reads that type
    // literal as the whole function, and the route this whole criterion is about
    // then looks like it calls nothing at all.
    const units = parseUnits(
      "probe.ts",
      [
        "  private reconcileLiveCanvas(",
        "    path: string,",
        "    data: { nodes: Record<string, unknown>[] },",
        "    opts?: { initial?: boolean },",
        "  ): void {",
        "    adapter.reloadCanvasData(data);",
        "  }",
      ].join("\n"),
    );
    expect(units).toHaveLength(1);
    expect(units[0].body).toContain("reloadCanvasData");
  });

  it("derives a NON-EMPTY effect vocabulary from the tree, BOTH halves", () => {
    const mutators = deriveViewMutators(read("canvas/canvas-adapter.ts"));
    const writers = deriveFileWriters(read("files/canvas-persistence.ts"));
    // A vocabulary with only the VIEW half is the exact blind spot that let R-C
    // ship: MEASURED, the file is a surface too.
    expect(mutators).toContain("setData");
    expect(mutators).toContain("moveAndResize");
    expect(writers).toEqual([{ name: "write", firstParam: "diskPath" }]);
  });

  it("REVERSE ASSERTION: it finds the sinks known to exist, on BOTH routes", () => {
    const ids = censusFromTree().sinks.map((s) => s.id);
    // The VIEW route's sink — WP37's, known present.
    expect(ids).toContain("canvas/canvas-adapter.ts#reloadCanvasData");
    // The FILE route's sink — WP85's writer, the one AC1 attributed the
    // destruction to.
    expect(ids).toContain("files/canvas-persistence.ts#writeSnapshot");
  });

  it("REVERSE ASSERTION: `main.ts#reconcileLiveCanvas` is in the derived route set", () => {
    expect(censusFromTree().routes).toContain("main.ts#reconcileLiveCanvas");
  });

  it("REVERSE ASSERTION: an innocent module yields NO sinks", () => {
    const innocent = {
      file: "innocent.ts",
      src: [
        "export function addNumbers(a: number, b: number): number {",
        "  const total = a + b;",
        "  return total;",
        "}",
        "export function describeIt(x: string): string {",
        "  // this comment mentions setData( and write(diskPath) and moveAndResize(",
        "  return x.trim();",
        "}",
      ].join("\n"),
    };
    const census = deriveCensus([innocent], ["setData", "moveAndResize"], WRITER);
    expect(census.unitCount).toBeGreaterThan(0);
    expect(census.sinks).toEqual([]);
  });

  it("REVERSE ASSERTION: it reaches a sink THREE hops away", () => {
    const chain = {
      file: "chain.ts",
      src: [
        "export function sinkIt(data: unknown): void {",
        "  canvas.setData(data);",
        "}",
        "export function middleIt(data: unknown): void {",
        "  sinkIt(data);",
        "}",
        "export function entryIt(data: unknown): void {",
        "  middleIt(data);",
        "}",
      ].join("\n"),
    };
    const census = deriveCensus([chain], ["setData"], []);
    expect(census.routes).toContain("chain.ts#sinkIt");
    expect(census.routes).toContain("chain.ts#middleIt");
    expect(census.routes).toContain("chain.ts#entryIt");
  });

  it("THE PIN DISCRIMINATES: the PRE-WP87 disk route is reported UNGUARDED", () => {
    // The shape the tree actually had: the write is reached, it has a production
    // caller, and the predicate is consulted zero times anywhere on the way. If
    // the pin cannot report this as unguarded, every row below is decoration.
    const preWp87 = {
      file: "canvas-writer.ts",
      src: [
        "export async function writeSnapshot(content: string): Promise<void> {",
        "  await io.write(diskPath, content);",
        "}",
        "export function attachWriter(path: string): void {",
        "  writeSnapshot(serializeIt(path));",
        "}",
      ].join("\n"),
    };
    const census = deriveCensus([preWp87], [], WRITER);
    const sink = census.sinks.find((s) => s.unit === "writeSnapshot");
    expect(sink?.consults).toEqual([]);
    expect(sink?.disposition).toBe("UNGUARDED");
  });

  it("THE PIN DISCRIMINATES: asking and IGNORING the answer is not guarding", () => {
    const asksAndIgnores = {
      file: "canvas-writer.ts",
      src: [
        "export async function writeIt(content: string): Promise<void> {",
        "  const decision = planCanvasDiskWrite({ editingNodeId: null });",
        "  void decision;",
        "  await io.write(diskPath, content);",
        "}",
        "export function callIt(path: string): void {",
        "  writeIt(path);",
        "}",
      ].join("\n"),
    };
    const census = deriveCensus([asksAndIgnores], [], WRITER);
    const sink = census.sinks.find((s) => s.unit === "writeIt");
    // It DOES call the predicate — and it still does not guard, because it
    // branches on no verdict and takes no early exit. A site that asks and
    // ignores the answer passes a call-site check and destroys the editor anyway.
    expect(sink?.consults).toContain("planCanvasDiskWrite");
    expect(sink?.disposition).toBe("UNGUARDED");
  });

  it("THE PIN IS SATISFIABLE: branching on the verdict and returning early GUARDS", () => {
    const guarded = {
      file: "canvas-writer.ts",
      src: [
        "export async function writeIt(content: string): Promise<void> {",
        "  const decision = planCanvasDiskWrite({ editingNodeId: editing });",
        '  if (decision.mode === "withhold") {',
        "    holds.hold(path, content);",
        "    return;",
        "  }",
        "  await io.write(diskPath, content);",
        "}",
      ].join("\n"),
    };
    const census = deriveCensus([guarded], [], WRITER);
    expect(census.sinks.find((s) => s.unit === "writeIt")?.disposition).toBe("GUARDED");
  });
});

describe("WP87 AC2 — the census over the real tree", () => {
  it("the derived sink set is non-empty and reaches BOTH physical surfaces", () => {
    const { sinks } = censusFromTree();
    expect(sinks.length).toBeGreaterThan(0);
    const files = sinks.map((s) => s.file);
    expect(files.some((f) => f.includes("canvas-adapter"))).toBe(true);
    expect(files.some((f) => f.includes("canvas-persistence"))).toBe(true);
  });

  it("THE CRITERION: no derived canvas-surface sink is UNGUARDED", () => {
    const { sinks } = censusFromTree();
    const unguarded = sinks.filter((s) => s.disposition === "UNGUARDED");
    expect(
      unguarded.map((s) => `${s.id} (via ${s.via.join(",")}; callers ${s.callers.join(",")})`),
      "an unguarded path from a remote change to a live canvas surface",
    ).toEqual([]);
  });

  it("every admission is STRUCTURAL, and each one is named with its reason", () => {
    // A disposition table, not a filename allowlist: every non-GUARDED row is
    // admitted by something read off the unit's own body or off the call graph.
    const { sinks } = censusFromTree();
    const byDisposition = new Map<string, string[]>();
    for (const s of sinks) {
      byDisposition.set(s.disposition, [...(byDisposition.get(s.disposition) ?? []), s.id]);
    }
    // The DISK write's entry site guards directly. The VIEW mutators live inside
    // the adapter (they cannot ask — they ARE the surface), and are guarded by
    // their caller, `main.ts#reconcileLiveCanvas`.
    expect(byDisposition.get("GUARDED")).toContain("main.ts#attachCanvasWriter");
    expect(byDisposition.get("GUARDED-BY-CALLER")).toContain(
      "canvas/canvas-adapter.ts#reloadCanvasData",
    );
    expect(byDisposition.get("GUARDED-BY-CALLER")).toContain(
      "canvas/canvas-adapter.ts#applyNodeGeometry",
    );
    // The RELEASE site is the drain, and it can only run once a hold exists.
    expect(byDisposition.get("RELEASE")).toContain("main.ts#releaseHeldCanvasWrite");
    // The writer itself is admitted only because every site that INJECTS its
    // `PersistenceIO` guards — the row that goes red on the pre-WP87 tree.
    expect(byDisposition.get("INJECTED-SEAM")).toContain(
      "files/canvas-persistence.ts#writeSnapshot",
    );
    // Nothing is admitted for any other reason.
    for (const s of sinks) {
      expect(
        [
          "GUARDED",
          "GUARDED-BY-CALLER",
          "INJECTED-SEAM",
          "RELEASE",
          "REFUSES-TO-OVERWRITE",
          "NO-PRODUCTION-CALLER",
          "FROZEN-BEHIND-FLAG",
          "DEFINER-FACTORY",
        ],
        `${s.id} has disposition ${s.disposition}`,
      ).toContain(s.disposition);
    }
  });

  it("the FILE sink is guarded by the SAME definer as the VIEW sink — no second predicate", () => {
    const { sinks: allSinks, routes } = censusFromTree();
    const writer = allSinks.find((s) => s.id === "files/canvas-persistence.ts#writeSnapshot");
    const attach = allSinks.find((s) => s.id === "main.ts#attachCanvasWriter");
    // WP85's file consults nothing itself and stays byte-unchanged: the guard is
    // in the seam that INJECTS its `PersistenceIO`.
    expect(writer?.consults).toEqual([]);
    expect(attach?.consults).toContain("getEditingNodeId");
    // And the VIEW route's guard is the SAME definer, one layer up.
    expect(routes).toContain("main.ts#reconcileLiveCanvas");
  });

  it("RULE 10 — `getEditingNodeId` has exactly ONE definer in production", () => {
    const adapter = read("canvas/canvas-adapter.ts");
    expect(countMatches(adapter, /getEditingNodeId\s*\??\s*\(/)).toBeGreaterThanOrEqual(2);
    for (const file of ["main.ts", "files/canvas-persistence.ts", "files/canvas-sync.ts"]) {
      expect(
        countMatches(read(file), /getEditingNodeId\s*\(\s*\)\s*:\s*string/),
        `${file} declares a second editing predicate`,
      ).toBe(0);
    }
  });

  it("RULE 15, both directions — the absence claim carries its pattern and a positive control", () => {
    // TOOL: Node's own `RegExp` with `g`, over COMMENT-STRIPPED source
    // (`countMatches`). Not `grep -o` — its `.` wildcard produced two false hits
    // in this run — and the pattern below contains no `.`.
    const PATTERN = /getEditingNodeId|onEditingEnd|planEditingDeferral|classifyBusyGate|isBusy/;

    // POSITIVE CONTROLS — the two files where the mechanism demonstrably lives.
    // These are what make the zeros below evidence rather than silence.
    expect(countMatches(read("canvas/canvas-adapter.ts"), PATTERN)).toBeGreaterThan(5);
    expect(countMatches(read("main.ts"), PATTERN)).toBeGreaterThan(5);

    // THE ABSENCES, with the detector proven able to match by the two rows above.
    // `canvas-persistence.ts` still consults NOTHING — and that is now CORRECT
    // rather than the defect, because WP87 put the consultation in the seam that
    // injects its writer, so WP85's file stays byte-unchanged.
    for (const file of [
      "files/canvas-persistence.ts",
      "files/canvas-sync.ts",
      "files/vault-events.ts",
      "canvas/canvas-shadow.ts",
    ]) {
      expect(countMatches(read(file), PATTERN), file).toBe(0);
    }
  });
});
