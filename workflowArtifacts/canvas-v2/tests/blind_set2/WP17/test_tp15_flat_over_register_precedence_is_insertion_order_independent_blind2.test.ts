// WP17 AC5 part 3 blind2 — a record holding a STALE register and a FRESH flat key
// serialises the FLAT value, and that outcome is a RULE, not an artefact of
// `Y.Map` insertion order. Angle: build the same logical record under EVERY
// permutation of its key writes (24 per scenario) and require all 24 serialized
// artefacts to be byte-identical to each other and to carry the flat value —
// cross-replica byte equality provably cannot see this class, because two
// replicas converge on the SAME wrong value, so insertion-order independence has
// to be asserted directly.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";
import {
  encodeEndpoint,
  encodePos,
  encodeSize,
} from "../../../../../plugin/src/canvas/canvas-registers";

type Write = (record: Y.Map<unknown>) => void;

interface KeyWrite {
  readonly label: string;
  readonly write: Write;
}

interface Scenario {
  readonly name: string;
  readonly kind: "node" | "edge";
  /** Writes issued before the permuted ones, identical in every ordering. */
  readonly base: readonly KeyWrite[];
  /** The writes whose ORDER is the variable under test. */
  readonly permuted: readonly KeyWrite[];
  /** The canonical key list the record must serialize with. */
  readonly expectedKeys: readonly string[];
  /** The FLAT (fresh) value each contested key must end up carrying. */
  readonly expectedValues: Readonly<Record<string, string | number>>;
  /** Substrings that prove the STALE register leaked into the file. */
  readonly staleNeedles: readonly string[];
}

const SUBJECT_ID: Record<"node" | "edge", string> = { node: "nz", edge: "ez" };

function key(label: string, write: Write): KeyWrite {
  return { label, write };
}

/**
 * The scenario table: one geometry register per contested pair, one endpoint
 * register per slot. Each carries a THIRD unrelated key so more than two
 * orderings exist — with four permuted writes there are 24 of them, and the
 * register may sit first, last or anywhere in between.
 */
const SCENARIOS: readonly Scenario[] = [
  {
    name: "stale `pos` register vs fresh flat x/y",
    kind: "node",
    base: [
      key("id", (r) => r.set("id", SUBJECT_ID.node)),
      key("type", (r) => r.set("type", "text")),
    ],
    permuted: [
      key("pos(stale)", (r) => r.set("pos", encodePos(900, 900))),
      key("x(fresh)", (r) => r.set("x", 10)),
      key("y(fresh)", (r) => r.set("y", 20)),
      key("color", (r) => r.set("color", "3")),
    ],
    expectedKeys: ["id", "type", "x", "y", "color"],
    expectedValues: { x: 10, y: 20 },
    staleNeedles: ["900"],
  },
  {
    name: "stale `size` register vs fresh flat width/height",
    kind: "node",
    base: [
      key("id", (r) => r.set("id", SUBJECT_ID.node)),
      key("type", (r) => r.set("type", "text")),
    ],
    permuted: [
      key("size(stale)", (r) => r.set("size", encodeSize(700, 700))),
      key("width(fresh)", (r) => r.set("width", 56)),
      key("height(fresh)", (r) => r.set("height", 78)),
      key("color", (r) => r.set("color", "3")),
    ],
    expectedKeys: ["id", "type", "width", "height", "color"],
    expectedValues: { width: 56, height: 78 },
    staleNeedles: ["700"],
  },
  {
    name: "stale `from` endpoint register vs fresh flat fromNode/fromSide/fromEnd",
    kind: "edge",
    base: [
      key("id", (r) => r.set("id", SUBJECT_ID.edge)),
      // Register-ONLY, no flat counterpart: it must be unaffected and still expand.
      key("to(register-only)", (r) => r.set("to", encodeEndpoint("nb", "left", "arrow"))),
    ],
    permuted: [
      key("from(stale)", (r) => r.set("from", encodeEndpoint("nStale", "top", "stale-end"))),
      key("fromNode(fresh)", (r) => r.set("fromNode", "na")),
      key("fromSide(fresh)", (r) => r.set("fromSide", "right")),
      key("fromEnd(fresh)", (r) => r.set("fromEnd", "none")),
    ],
    expectedKeys: ["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd"],
    expectedValues: {
      fromNode: "na",
      fromSide: "right",
      fromEnd: "none",
      toNode: "nb",
      toSide: "left",
      toEnd: "arrow",
    },
    staleNeedles: ["nStale", '"top"', "stale-end"],
  },
  {
    name: "stale `to` endpoint register vs fresh flat toNode/toSide/toEnd",
    kind: "edge",
    base: [
      key("id", (r) => r.set("id", SUBJECT_ID.edge)),
      key("from(register-only)", (r) => r.set("from", encodeEndpoint("na", "right", "none"))),
    ],
    permuted: [
      key("to(stale)", (r) => r.set("to", encodeEndpoint("nStale2", "bottom", "stale-tail"))),
      key("toNode(fresh)", (r) => r.set("toNode", "nb")),
      key("toSide(fresh)", (r) => r.set("toSide", "left")),
      key("toEnd(fresh)", (r) => r.set("toEnd", "arrow")),
    ],
    expectedKeys: ["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd"],
    expectedValues: {
      fromNode: "na",
      fromSide: "right",
      fromEnd: "none",
      toNode: "nb",
      toSide: "left",
      toEnd: "arrow",
    },
    staleNeedles: ["nStale2", '"bottom"', "stale-tail"],
  },
];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let index = 0; index < items.length; index++) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([items[index], ...tail]);
  }
  return out;
}

function anchorNode(nodes: Y.Map<Y.Map<unknown>>, id: string, x: number): void {
  const held = new Y.Map<unknown>();
  nodes.set(id, held);
  held.set("id", id);
  held.set("type", "text");
  held.set("x", x);
  held.set("y", 0);
  held.set("width", 200);
  held.set("height", 100);
}

/**
 * The parameterized builder: assemble the SAME logical record, issuing its
 * permuted key writes in the given order, and serialize.
 *
 * Single-author fixture construction throughout — one `Y.Doc`, no concurrent
 * same-key writes from two peers, so nothing here is decided by a random
 * `clientID` tiebreak.
 */
function serializeUnderOrder(scenario: Scenario, order: readonly KeyWrite[]): string {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  anchorNode(nodes, "na", 0);
  anchorNode(nodes, "nb", 400);

  const subject = new Y.Map<unknown>();
  if (scenario.kind === "node") nodes.set(SUBJECT_ID.node, subject);
  else edges.set(SUBJECT_ID.edge, subject);

  for (const step of scenario.base) step.write(subject);
  for (const step of order) step.write(subject);

  return serializeCanvas(nodes, edges);
}

function subjectOf(text: string, kind: "node" | "edge"): Record<string, unknown> {
  const space = kind === "node" ? "nodes" : "edges";
  const parsed = JSON.parse(text) as Record<string, Record<string, unknown>[]>;
  const found = parsed[space].find((record) => record.id === SUBJECT_ID[kind]);
  if (found === undefined)
    throw new Error(`the ${kind} subject is missing from the file — the stale register won`);
  return found;
}

describe("WP17 AC5 part 3 (blind2): the flat key wins as an explicit rule — identical bytes under every Y.Map insertion order", () => {
  for (const scenario of SCENARIOS) {
    const orders = permutations(scenario.permuted);

    it(`${scenario.name}: all ${orders.length} insertion orders produce BYTE-IDENTICAL files`, () => {
      expect(orders).toHaveLength(24);
      const texts = orders.map((order) => serializeUnderOrder(scenario, order));
      expect(texts).toHaveLength(orders.length);
      // The actual property. A value-only assertion passes even when the
      // resolution is by insertion order, because one chosen order happens to
      // give the right answer.
      expect(new Set(texts).size).toBe(1);
    });

    it(`${scenario.name}: every insertion order carries the FRESH FLAT value`, () => {
      for (const order of orders) {
        const text = serializeUnderOrder(scenario, order);
        const subject = subjectOf(text, scenario.kind);
        for (const [contested, expected] of Object.entries(scenario.expectedValues)) {
          expect(contested in subject).toBe(true);
          expect(subject[contested]).toBe(expected);
        }
      }
    });

    it(`${scenario.name}: the STALE register value is absent from the file under every insertion order`, () => {
      for (const order of orders) {
        const text = serializeUnderOrder(scenario, order);
        for (const needle of scenario.staleNeedles) {
          expect(text).not.toContain(needle);
        }
      }
    });

    it(`${scenario.name}: the record's canonical key list is insertion-order independent too`, () => {
      for (const order of orders) {
        const subject = subjectOf(serializeUnderOrder(scenario, order), scenario.kind);
        expect(Object.keys(subject)).toEqual([...scenario.expectedKeys]);
      }
    });
  }

  it("a register-ONLY node (no flat key to override it) is unaffected and still expands", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const held = new Y.Map<unknown>();
    nodes.set("nz", held);
    held.set("id", "nz");
    held.set("type", "text");
    held.set("pos", encodePos(11, 22));
    held.set("size", encodeSize(33, 44));
    const subject = subjectOf(serializeCanvas(nodes, edges), "node");
    expect(Object.keys(subject)).toEqual(["id", "type", "x", "y", "width", "height"]);
    expect(subject.x).toBe(11);
    expect(subject.y).toBe(22);
    expect(subject.width).toBe(33);
    expect(subject.height).toBe(44);
  });

  it("a register-ONLY node expands identically whichever order its registers were written in", () => {
    const build = (registersFirst: boolean): string => {
      const doc = new Y.Doc();
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      const held = new Y.Map<unknown>();
      nodes.set("nz", held);
      if (registersFirst) {
        held.set("size", encodeSize(33, 44));
        held.set("pos", encodePos(11, 22));
        held.set("id", "nz");
        held.set("type", "text");
      } else {
        held.set("id", "nz");
        held.set("type", "text");
        held.set("pos", encodePos(11, 22));
        held.set("size", encodeSize(33, 44));
      }
      return serializeCanvas(nodes, edges);
    };
    expect(build(true)).toBe(build(false));
  });

  it("a register-ONLY edge (no flat endpoint key to override it) is unaffected and still expands", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    anchorNode(nodes, "na", 0);
    anchorNode(nodes, "nb", 400);
    const held = new Y.Map<unknown>();
    edges.set("ez", held);
    held.set("id", "ez");
    held.set("from", encodeEndpoint("na", "right", "none"));
    held.set("to", encodeEndpoint("nb", "left", "arrow"));
    const subject = subjectOf(serializeCanvas(nodes, edges), "edge");
    expect(Object.keys(subject)).toEqual([
      "id",
      "fromNode",
      "fromSide",
      "fromEnd",
      "toNode",
      "toSide",
      "toEnd",
    ]);
    expect(subject.fromNode).toBe("na");
    expect(subject.toEnd).toBe("arrow");
  });
});
