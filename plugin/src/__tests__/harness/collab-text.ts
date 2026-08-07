// WP36 follow-up (B32) — THE MIGRATED READ FOR A COLLABORATIVE TEXT FIELD.
//
// WHY THIS FILE EXISTS
// --------------------
// Before WP36, `text` and `label` were whole-string LWW registers, so every
// oracle that wanted to know "did the user's edit land?" wrote
//
//     expect(record.get("text")).toBe("edited");
//
// That single line asserts TWO things at once and only one of them was ever the
// point: the VALUE (the edit landed) and the REPRESENTATION (the doc holds a
// plain string). WP36 deliberately changed the second — card text is a nested
// `Y.Text` now — and `V2Node`'s own docstring had already forbidden consumers to
// narrow it: *"a read must tolerate BOTH shapes, so no consumer may narrow it
// with a hard `typeof === "string"` validity assertion"*
// (`canvas-registers.ts:148-152`).
//
// So the migration is NOT "read it through `toString()` and carry on". Dropping
// the representation half would leave an oracle STRICTLY WEAKER than the one it
// replaced: it would pass over a capture that flattened the `Y.Text` back to a
// plain string — the "it merged once and then stopped merging" defect that C36
// AC1 exists to catch and that the charter names as the second most likely wrong
// implementation.
//
// {@link collabText} therefore returns BOTH halves as one value, so a migrated
// assertion is one `toEqual` that reads as a sentence and cannot silently lose
// either half:
//
//     expect(collabText(field), "real intent was swallowed")
//       .toEqual({ shape: "ytext", text: "edited" });
//
//   ├── the VALUE half is byte-for-byte the old assertion, and
//   └── the SHAPE half is the post-WP36 invariant the old assertion could not
//          express — which is exactly why the migrated line goes RED against the
//          pre-WP36 behaviour (`CanvasSync.setCollabTextEnabled(false)`), where
//          the shape is `"string"`.
//
// A migration that cannot fail on the behaviour it replaced has migrated
// nothing. That sentence is the acceptance criterion for this file.

import * as Y from "yjs";

/** What the doc actually holds under a collaborative-text key. */
export type CollabTextShape = "ytext" | "string" | "absent" | "other";

export interface CollabTextReading {
  readonly shape: CollabTextShape;
  /** The rendered string, i.e. what every projection consumer sees. */
  readonly text: string | undefined;
}

/**
 * Doc value -> `{ shape, text }`.
 *
 * `text` is what `toCanonicalFileRecord`'s `renderDocValue` would produce, so a
 * test asserting on it is asserting on the value the disk bytes, the open
 * Obsidian view, `canvas.state` and the Surface-Shadow all receive.
 */
export function collabText(value: unknown): CollabTextReading {
  if (value instanceof Y.Text) return { shape: "ytext", text: value.toString() };
  if (typeof value === "string") return { shape: "string", text: value };
  if (value === undefined) return { shape: "absent", text: undefined };
  return { shape: "other", text: undefined };
}

/** The rendered string alone, for a check whose subject is not the shape. */
export function collabTextValue(value: unknown): string | undefined {
  return collabText(value).text;
}
