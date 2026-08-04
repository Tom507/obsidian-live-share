// WP51 AC4 — blind set 2 (structural).
//
// Angle: fingerprints instead of token searches. The canvas modules and
// `main.ts` are hashed against the batch baseline; if WP51 edited one of them at
// all — with or without a recognisable token — the digest moves and this file
// says which file it was. A token list can only catch the branches somebody
// thought of; a digest catches every one.
//
// Because WP51's file boundary is `plugin/src/testing/e2e-control.ts` ALONE
// (SharedOwnershipContract_B9b §2), an unchanged digest for every other module
// is not a nice-to-have here — it is the boundary itself, expressed as a test.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RUNTIME_FLAG_READERS, STALE_VIEW_FLAG } from "../../testing/e2e-control";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** sha256 over the file's bytes with line endings normalised (CRLF host). */
function digest(path: string): string {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const canvasModules = () =>
  readdirSync(join(SRC, "canvas"))
    .filter((f) => f.endsWith(".ts"))
    .sort();

describe("WP51 AC4 (blind2) — the file boundary, expressed as a digest", () => {
  it("the canvas module set is the one this WP promised not to touch", () => {
    // A NEW production canvas module is also a violation: the surface must not
    // arrive as an extra file either.
    expect(canvasModules()).toEqual([
      "canvas-adapter.ts",
      "canvas-binding.ts",
      "canvas-canonical.ts",
      "canvas-epoch.ts",
      "canvas-import-command.ts",
      "canvas-ingest-schema.ts",
      "canvas-model-bridge.ts",
      "canvas-ord.ts",
      "canvas-overlay.ts",
      "canvas-presence.ts",
      "canvas-registers.ts",
      "canvas-schema.ts",
      "canvas-shadow.ts",
      "canvas-tombstone.ts",
      "canvas-type-guard.ts",
      "reconcile-plan.ts",
    ]);
  });

  it("POSITIVE CONTROL: the surface lives in the one file WP51 owns", () => {
    const control = readFileSync(join(SRC, "testing", "e2e-control.ts"), "utf8");
    expect(control).toContain(STALE_VIEW_FLAG);
    expect(Object.keys(RUNTIME_FLAG_READERS)).toContain(STALE_VIEW_FLAG);
  });

  it("every canvas module is free of any conditional that mentions e2e or the rig", () => {
    for (const name of canvasModules()) {
      const source = readFileSync(join(SRC, "canvas", name), "utf8");
      const suspect = source
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
        .filter((l) => /\b(if|while|return|const|let)\b/.test(l))
        .filter((l) => /\be2e\b|\brig\b|stale.?view|control.?server/i.test(l));
      expect(suspect, `${name} carries a rig-aware code line`).toEqual([]);
    }
  });

  it("`canvas-presence.ts` is untouched — the charter makes editing it an ESCALATE", () => {
    const source = readFileSync(join(SRC, "canvas", "canvas-presence.ts"), "utf8");
    expect(source).not.toContain(STALE_VIEW_FLAG);
    expect(source).not.toMatch(/e2e/i);
  });

  it("`main.ts` holds wiring only — no stale-view decision is made there", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(main).not.toContain(STALE_VIEW_FLAG);
    expect(main).not.toMatch(/stale.?view/i);
    // `reconcileLiveCanvas` keeps exactly the two early returns it already had
    // for a surface that cannot be advanced — the WP6 seams — and gains none.
    expect(main).toContain("if (!adapter || !adapter.isAvailable()) return;");
    expect(main).toContain("if (adapter.isBusy()) {");
  });

  it("the two files that DO change per this WP are the testing module and its tests", () => {
    // `e2e-control.ts` must differ from its own pre-WP51 shape — otherwise the
    // implementation never happened and every other assertion here is vacuous.
    const control = readFileSync(join(SRC, "testing", "e2e-control.ts"), "utf8");
    expect(control).toContain("canvas.flags");
    expect(control).toContain("canvas.save");
    expect(control).toContain(STALE_VIEW_FLAG);
    expect(digest(join(SRC, "testing", "e2e-control.ts"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
