// WP27 / AC1 blind1 — the doc-id constructor, attacked as an INJECTIVE TOTAL
// FUNCTION over a generated corpus instead of as four hand-written examples.
//
// Different angle: build 60 guids programmatically (hex, uuid-shaped, unicode,
// very long, single character), map them all through `canvasDocId`, and assert
// three algebraic properties at once — every image is in the namespace, the map
// is injective, and it is invertible by stripping the prefix. An implementation
// that trimmed, lower-cased, hashed or truncated the guid fails injectivity or
// invertibility on rows a fixed example list would never contain.
//
// The second half attacks the OTHER direction: no string that a vault can
// produce is ever in the image. That is the property R5 lacked.

import { describe, expect, it } from "vitest";

import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
  SCHEMA_VERSION_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  CANVAS_DOC_PREFIX,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";

function generatedGuids(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) out.push(i.toString(16).padStart(32, "0"));
  for (let i = 0; i < 8; i++) out.push(`${i}f2a9c6e-1b4d-47aa-9d31-6c0e2f8b5a70`);
  out.push("g");
  out.push("G");
  out.push("ümläut-guid");
  out.push("0".repeat(512));
  out.push("guid.with.dots");
  out.push("guid_with_underscores");
  out.push("__canvas__");
  out.push("canvas");
  return out;
}

const VAULT_STRINGS = [
  "board.canvas",
  "boards/board.canvas",
  "deeply/nested/folder/with spaces/plan.canvas",
  ".obsidian/liveshare/state/index.json",
  "notes/journal.md",
  "__manifest__",
];

describe("WP27 AC1 blind1 — canvasDocId is injective, total and invertible", () => {
  const guids = generatedGuids();

  it("every image lands in the namespace and nothing else is added", () => {
    for (const guid of guids) {
      const id = canvasDocId(guid);
      expect(id.startsWith(CANVAS_DOC_PREFIX)).toBe(true);
      expect(id.length).toBe(CANVAS_DOC_PREFIX.length + guid.length);
    }
  });

  it("the map is INJECTIVE across the whole corpus", () => {
    const images = guids.map((g) => canvasDocId(g));
    expect(new Set(images).size).toBe(new Set(guids).size);
  });

  it("stripping the prefix recovers the guid EXACTLY — no trim, no case fold", () => {
    for (const guid of guids) {
      expect(canvasDocId(guid).slice(CANVAS_DOC_PREFIX.length)).toBe(guid);
    }
  });

  it("no vault-producible string is in the image of the constructor", () => {
    const images = new Set(guids.map((g) => canvasDocId(g)));
    for (const candidate of VAULT_STRINGS) {
      expect(images.has(candidate)).toBe(false);
      expect(candidate.startsWith(CANVAS_DOC_PREFIX)).toBe(false);
      // …and the pre-WP27 spelling is reachable from no guid in the corpus.
      expect(images.has(`${CANVAS_DOC_PREFIX}${candidate}`)).toBe(false);
    }
  });

  it("an unresolved guid is refused rather than mapped to the bare prefix", () => {
    expect(typeof canvasDocId).toBe("function");
    for (const bad of ["", " ", "\n", "\t\t"]) {
      expect(() => canvasDocId(bad), `canvasDocId(${JSON.stringify(bad)})`).toThrow();
    }
  });

  it("the meta key namespace has five distinct members and no empty one", () => {
    const keys = [GUID_KEY, PATH_KEY, EPOCH_KEY, META_MAP_NAME, SCHEMA_VERSION_KEY];
    expect(new Set(keys).size).toBe(5);
    for (const key of keys) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
    expect([GUID_KEY, PATH_KEY, EPOCH_KEY].sort()).toEqual(["epoch", "guid", "path"]);
  });
});
