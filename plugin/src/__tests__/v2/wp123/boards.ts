// WP123 — THE THREE SPELLINGS OF ONE BOARD, plus the boards that genuinely differ.
//
// S174/S177 measured three stable byte forms for identical records on this build
// — the author's, the plugin's canonical, and Obsidian's own. Every fixture below
// is written out by hand rather than generated, because a fixture produced by the
// same serialiser the oracle is being tested against cannot demonstrate that the
// oracle survives a serialiser it has never seen.
//
// NOTHING HERE IS DERIVED FROM A PEER READING. These are the reference point.

import { createHash } from "node:crypto";

/** The board every SAME_RECORDS spelling below encodes. The expectation's source. */
export const AUTHORED_GEOMETRY = {
  n1: { x: 100, y: 200, width: 250, height: 60 },
  n2: { x: 400, y: 200, width: 250, height: 60 },
} as const;

/** Spelling 1 — the author's: two-space pretty print, `x`/`y` before the size. */
export const SPELLING_AUTHOR = `{
  "nodes": [
    {"id": "n1", "type": "text", "text": "card one", "x": 100, "y": 200, "width": 250, "height": 60},
    {"id": "n2", "type": "text", "text": "card two", "x": 400, "y": 200, "width": 250, "height": 60}
  ],
  "edges": [
    {"id": "e1", "fromNode": "n1", "fromSide": "right", "toNode": "n2", "toSide": "left"}
  ]
}`;

/** Spelling 2 — the plugin's canonical: no whitespace at all, a different key order. */
export const SPELLING_CANONICAL =
  '{"nodes":[{"type":"text","id":"n1","width":250,"height":60,"x":100,"y":200,"text":"card one"},' +
  '{"type":"text","id":"n2","width":250,"height":60,"x":400,"y":200,"text":"card two"}],' +
  '"edges":[{"id":"e1","fromNode":"n1","fromSide":"right","toNode":"n2","toSide":"left"}]}';

/** Spelling 3 — Obsidian's own: tab indent, one key per line, trailing newline. */
export const SPELLING_OBSIDIAN = `{
\t"nodes":[
\t\t{"id":"n1","x":100,"y":200,"width":250,"height":60,"type":"text","text":"card one"},
\t\t{"id":"n2","x":400,"y":200,"width":250,"height":60,"type":"text","text":"card two"}
\t],
\t"edges":[
\t\t{"id":"e1","fromNode":"n1","fromSide":"right","toNode":"n2","toSide":"left"}
\t]
}
`;

/** THE SAME RECORDS, THREE WAYS. */
export const SAME_RECORDS = [SPELLING_AUTHOR, SPELLING_CANONICAL, SPELLING_OBSIDIAN];

/**
 * THE DIVERGENT BOARD — `n1` moved down by 199 px and NOTHING else changed. Ids
 * identical, edge identical, sizes identical. An id-set comparison passes it.
 */
export const MOVED_N1 = SPELLING_AUTHOR.replace('"y": 200, "width": 250, "height": 60},', '"y": 399, "width": 250, "height": 60},');

/** The same move, spelt canonically — so "moved" and "respelt" can be separated. */
export const MOVED_N1_CANONICAL = SPELLING_CANONICAL.replace('"x":100,"y":200', '"x":100,"y":399');

/** Not JSON at all. `parseCanvas` degrades on this and does not throw. */
export const UNPARSEABLE = '{"nodes":[{"id":"n1","x":100,';

/** Well-formed JSON with NO `nodes` array — `degraded` is false and records are still empty. */
export const NO_NODES_KEY = '{"edges":[]}';

/** A reading, in the shape `judgeConvergence` takes. */
export function reading(peer: string, content: string | null, exists = true) {
  return {
    peer,
    file: {
      exists,
      sha256: content === null ? "" : sha256(content),
      size: content === null ? 0 : Buffer.byteLength(content, "utf8"),
      content,
    },
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}
