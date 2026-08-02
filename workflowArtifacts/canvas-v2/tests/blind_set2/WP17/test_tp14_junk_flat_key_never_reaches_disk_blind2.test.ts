// WP17 AC5 part 2 blind2 — a `null` / `""` already sitting in the doc under a
// TYPED flat key is JUNK: it is dropped on the way to the file, including on the
// verbatim flat-key pass, and it never overrides the register that still holds
// the real answer. Angle: the raw serialized STRING is the primary oracle (junk
// that reaches disk is a substring, and a substring is what a user's file
// actually gets), driven from one module-level table over all ten typed keys and
// both junk values.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";
import {
  encodeEndpoint,
  encodePos,
  encodeSize,
} from "../../../../../plugin/src/canvas/canvas-registers";

/** The two junk values, spelled once. */
const JUNK_VALUES: readonly (null | "")[] = [null, ""];

const JUNK_LABEL = new Map<null | "", string>([
  [null, "null"],
  ["", 'empty string ""'],
]);

/**
 * The ten keys whose `null` / `""` is junk: the four geometry keys and the six
 * endpoint keys. Each row names the record kind that carries it and the value the
 * surviving register must still produce for that key.
 */
const TYPED_KEYS: readonly {
  readonly kind: "node" | "edge";
  readonly key: string;
  readonly expected: string | number;
}[] = [
  { kind: "node", key: "x", expected: 12 },
  { kind: "node", key: "y", expected: 34 },
  { kind: "node", key: "width", expected: 56 },
  { kind: "node", key: "height", expected: 78 },
  { kind: "edge", key: "fromNode", expected: "na" },
  { kind: "edge", key: "fromSide", expected: "right" },
  { kind: "edge", key: "fromEnd", expected: "none" },
  { kind: "edge", key: "toNode", expected: "nb" },
  { kind: "edge", key: "toSide", expected: "left" },
  { kind: "edge", key: "toEnd", expected: "arrow" },
];

/** The canonical key list each subject record must serialize with. */
const SUBJECT_KEYS: Record<"node" | "edge", readonly string[]> = {
  node: ["id", "type", "x", "y", "width", "height"],
  edge: ["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd"],
};

const SUBJECT_ID: Record<"node" | "edge", string> = { node: "nz", edge: "ez" };

interface Containers {
  readonly nodes: Y.Map<Y.Map<unknown>>;
  readonly edges: Y.Map<Y.Map<unknown>>;
}

function anchorNode(nodes: Y.Map<Y.Map<unknown>>, id: string, x: number): void {
  const held = new Y.Map<unknown>();
  nodes.set(id, held);
  held.set("id", id);
  held.set("type", "text");
  held.set("pos", encodePos(x, 0));
  held.set("size", encodeSize(200, 100));
}

/**
 * The parameterized fixture builder: a doc holding two anchor nodes plus ONE
 * subject record whose registers carry the truth and which additionally holds
 * `junk` under `key`.
 */
function buildDoc(kind: "node" | "edge", key: string, junk: null | ""): Containers {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");

  // The endpoint anchors. An edge whose endpoint node is invisible is pruned, so
  // these must exist for the edge rows to be observable at all.
  anchorNode(nodes, "na", 0);
  anchorNode(nodes, "nb", 400);

  if (kind === "node") {
    const subject = new Y.Map<unknown>();
    nodes.set(SUBJECT_ID.node, subject);
    subject.set("id", SUBJECT_ID.node);
    subject.set("type", "text");
    subject.set("pos", encodePos(12, 34));
    subject.set("size", encodeSize(56, 78));
    subject.set(key, junk);
  } else {
    const subject = new Y.Map<unknown>();
    edges.set(SUBJECT_ID.edge, subject);
    subject.set("id", SUBJECT_ID.edge);
    subject.set("from", encodeEndpoint("na", "right", "none"));
    subject.set("to", encodeEndpoint("nb", "left", "arrow"));
    subject.set(key, junk);
  }
  return { nodes, edges };
}

function write(kind: "node" | "edge", key: string, junk: null | ""): string {
  const { nodes, edges } = buildDoc(kind, key, junk);
  return serializeCanvas(nodes, edges);
}

function subjectOf(text: string, kind: "node" | "edge"): Record<string, unknown> {
  const space = kind === "node" ? "nodes" : "edges";
  const parsed = JSON.parse(text) as Record<string, Record<string, unknown>[]>;
  const found = parsed[space].find((record) => record.id === SUBJECT_ID[kind]);
  if (found === undefined) throw new Error(`the ${kind} subject was dropped from the file entirely`);
  return found;
}

describe("WP17 AC5 part 2 (blind2): junk under a typed flat key is dropped before disk and never beats the register — read off the raw serialized text", () => {
  for (const row of TYPED_KEYS) {
    for (const junk of JUNK_VALUES) {
      const label = JUNK_LABEL.get(junk) as string;

      it(`a ${label} under the typed ${row.kind} key '${row.key}' never reaches the serialized text`, () => {
        const text = write(row.kind, row.key, junk);
        // The raw artefact is the oracle: this is literally what would land in
        // the user's `.canvas`.
        expect(text).not.toContain(`"${row.key}": null`);
        expect(text).not.toContain(`"${row.key}": ""`);
        expect(text).not.toContain("null");
        expect(text).not.toContain('": ""');
      });

      it(`a ${label} under '${row.key}' does not override the register that still holds the real answer`, () => {
        const text = write(row.kind, row.key, junk);
        const subject = subjectOf(text, row.kind);
        expect(subject[row.key]).toBe(row.expected);
        expect(text).toContain(
          typeof row.expected === "string"
            ? `"${row.key}": ${JSON.stringify(row.expected)}`
            : `"${row.key}": ${row.expected}`,
        );
      });

      it(`a ${label} under '${row.key}' leaves the ${row.kind}'s canonical key list untouched`, () => {
        const subject = subjectOf(write(row.kind, row.key, junk), row.kind);
        expect(Object.keys(subject)).toEqual([...SUBJECT_KEYS[row.kind]]);
        // The junk key is present in the DOC. It must be present in the FILE
        // only because the register put a real value there, never as a junk
        // carry-over — which the value assertion above pins.
        expect(subject[row.key]).not.toBe(null);
        expect(subject[row.key]).not.toBe("");
      });
    }
  }

  it("the same records with no junk at all serialize identically — dropping junk is a no-op on a clean doc", () => {
    const withJunk = write("edge", "toSide", null);
    const clean = (() => {
      const doc = new Y.Doc();
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      anchorNode(nodes, "na", 0);
      anchorNode(nodes, "nb", 400);
      const subject = new Y.Map<unknown>();
      edges.set(SUBJECT_ID.edge, subject);
      subject.set("id", SUBJECT_ID.edge);
      subject.set("from", encodeEndpoint("na", "right", "none"));
      subject.set("to", encodeEndpoint("nb", "left", "arrow"));
      return serializeCanvas(nodes, edges);
    })();
    expect(withJunk).toBe(clean);
  });

  it("a null under an UNKNOWN key is NOT dropped — canonicalisation may not delete a key nobody understands", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const held = new Y.Map<unknown>();
    nodes.set("nz", held);
    held.set("id", "nz");
    held.set("type", "text");
    held.set("pos", encodePos(12, 34));
    held.set("size", encodeSize(56, 78));
    held.set("someFutureKey", null);
    const text = serializeCanvas(nodes, edges);
    expect(text).toContain('"someFutureKey": null');
    const subject = subjectOf(text, "node");
    expect("someFutureKey" in subject).toBe(true);
    expect(Object.keys(subject)).toEqual([...SUBJECT_KEYS.node, "someFutureKey"]);
  });
});
