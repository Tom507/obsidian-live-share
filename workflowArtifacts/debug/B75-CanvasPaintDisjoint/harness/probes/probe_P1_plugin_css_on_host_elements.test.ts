// B75 · P1 — CODE-LEVEL
//
// SURFACE: the CSS cascade, where the plugin's stylesheet meets Obsidian's own.
//
// The reported expectation is "the canvas is not visually disjointed". This
// probe measures one thing that can produce exactly that and nothing else: a
// plugin CSS class that is attached to an element Obsidian owns and lays out,
// and that redeclares a property Obsidian's own layout depends on.
//
// HOW THE SUBJECT IS FOUND (not hardcoded): every class name the canvas code
// passes to `classList.add(...)` is collected, and every class name the canvas
// code puts on an element it CREATED itself is collected. A class in the first
// set but not the second is, by construction, applied to a foreign element.
// The rules for those classes in plugin/styles.css are then read.
//
// WHY IT CAN GO RED: it asserts an absence. Add `position`, `display`, `width`,
// `margin`, `padding` or a `transform` to such a rule and it fires.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const CANVAS_SRC = join(REPO, "plugin", "src", "canvas");
const STYLES = join(REPO, "plugin", "styles.css");

/**
 * Properties whose presence on an element changes where that element — or any
 * SIBLING of it — is laid out. `outline`, `box-shadow`, `border-radius`,
 * `color`, `opacity` and custom properties are deliberately absent: decorating
 * with those is the safe way to do exactly what the held ring is for.
 */
const LAYOUT_PROPS = [
  "position", "top", "right", "bottom", "left", "inset",
  "display", "float", "clear", "transform", "transform-origin",
  "contain", "box-sizing", "overflow",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-width", "border-style",
  "flex", "flex-basis", "grid-area",
];

function canvasSources(): string {
  return readdirSync(CANVAS_SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(CANVAS_SRC, f), "utf8"))
    .join("\n");
}

/** Class names handed to `classList.add("…")` anywhere in the canvas code. */
function classesAddedByCode(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/classList\s*\.\s*add\(\s*["'`]([^"'`]+)["'`]/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) out.add(cls);
  }
  return out;
}

/** Class names the canvas code puts on an element it created itself. */
function classesOnOwnElements(src: string): Set<string> {
  const out = new Set<string>();
  const patterns = [
    /createDiv\(\s*\{\s*cls:\s*["'`]([^"'`]+)["'`]/g,
    /createEl\([^)]*cls:\s*["'`]([^"'`]+)["'`]/g,
    /\.className\s*=\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      for (const cls of m[1].split(/\s+/)) if (cls) out.add(cls);
    }
  }
  return out;
}

/** Top-level `selector { body }` blocks of a flat stylesheet. */
function rules(css: string): Array<{ selector: string; decls: string[] }> {
  const out: Array<{ selector: string; decls: string[] }> = [];
  for (const m of css.matchAll(/(^|\})\s*([^{}@]+?)\{([^{}]*)\}/g)) {
    out.push({
      selector: m[2].trim(),
      decls: m[3].split(";").map((d) => d.trim()).filter(Boolean),
    });
  }
  return out;
}

function declaredProp(decl: string): string {
  return decl.split(":")[0].trim().toLowerCase();
}

describe("B75 P1 — plugin CSS applied to Obsidian-owned canvas elements", () => {
  const src = canvasSources();
  const added = classesAddedByCode(src);
  const own = classesOnOwnElements(src);
  const foreign = [...added].filter((c) => !own.has(c)).sort();

  it("the probe has a subject: the canvas code attaches at least one plugin class to a foreign element", () => {
    // Guard against a vacuous green. If this ever legitimately becomes zero,
    // the assertion below has nothing to measure and must be retired, not
    // quietly passed.
    expect(
      { classesAdded: [...added].sort(), classesOnOwnElements: [...own].sort(), foreign },
      "no classList.add(...) target was found in plugin/src/canvas — P1 has no subject",
    ).toHaveProperty("foreign");
    expect(foreign.length).toBeGreaterThan(0);
  });

  it("declares no layout-affecting property in any rule for such a class", () => {
    const css = readFileSync(STYLES, "utf8");
    const offences: string[] = [];
    for (const rule of rules(css)) {
      const hit = foreign.find((cls) => rule.selector.includes(`.${cls}`));
      if (!hit) continue;
      for (const decl of rule.decls) {
        const prop = declaredProp(decl);
        if (LAYOUT_PROPS.includes(prop)) {
          offences.push(`${rule.selector} { ${decl} }   [class '${hit}' is applied to a host element]`);
        }
      }
    }
    expect(offences, `plugin/styles.css writes layout onto Obsidian-owned elements:\n  ${offences.join("\n  ")}`)
      .toEqual([]);
  });
});
