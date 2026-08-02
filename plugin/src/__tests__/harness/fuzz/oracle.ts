// WP23 / AC2 + AC5 — THE ASSERTION FAMILIES.
//
// Four CONVERGENCE families and one CORRECTNESS family, and the difference
// between those two words is the whole point of this file.
//
//   ├── sec     — every replica holds the same doc state (order-independent).
//   ├── schema  — no endpoint-less edge, no record without a position.
//   ├── bytes   — every replica serialises the byte-identical `.canvas` text.
//   ├── shadow  — no replica ever pushed a stale field (the W1 discriminant).
//   └── intent-trace — for every field the op sequence touched, the converged
//          value equals what the LAST OP ON THAT FIELD wrote, as computed by the
//          harness from its OWN op log.
//
// The first four are convergence oracles. ALL FOUR GO GREEN WHEN EVERY REPLICA
// AGREES ON THE SAME WRONG VALUE — which is not a theoretical worry: the WP18
// batch found exactly that bug in `decodeV2RecordToFlat`, and byte equality
// across replicas provably cannot see it, because both replicas converge on the
// SAME wrong value. `intent-trace` is the only family with an independent basis.
//
// Two further families exist because two work packages named a property that is
// neither convergence nor field-value correctness:
//
//   ├── i7  — WP22: a partial capture must never remove a field it did not
//   │      mention. Recorded by the op itself as `fieldRemovals`.
//   └── lww — WP21: with the write gate gone, a local write must LAND locally
//          (no denial) and the run must still converge by honest LWW, with no
//          baseline-hold artefact. Recorded as `writeAdmissions`.
//
// AGREEMENT BETWEEN REPLICAS IS NECESSARY BUT NOT SUFFICIENT. A run in which all
// replicas agree on a value that no op ever wrote is a FAILURE, not a pass — and
// `intent-trace` is what makes that statement operational.

import { serializeCanvas } from "../../../files/canvas-sync";
import {
  type FieldSlot,
  type FuzzRecordKind,
  type IntentTrace,
  slotKey,
} from "./intent-trace";
import type { FuzzReplica } from "./replica";

export type AssertionFamily =
  | "intent-trace"
  | "sec"
  | "schema"
  | "bytes"
  | "shadow"
  | "i7"
  | "lww";

export interface FuzzViolation {
  readonly family: AssertionFamily;
  readonly message: string;
}

/** One replica's `.canvas` projection, parsed. This is the SUBJECT, never the basis. */
interface ProjectedFile {
  readonly text: string;
  readonly nodes: Record<string, unknown>[];
  readonly edges: Record<string, unknown>[];
}

export function projectFile(replica: FuzzReplica): ProjectedFile {
  const text = serializeCanvas(replica.nodes(), replica.edges(), replica.deleted());
  const parsed = JSON.parse(text) as {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  return { text, nodes: parsed.nodes, edges: parsed.edges };
}

function indexById(records: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const record of records) out.set(String(record.id ?? ""), record);
  return out;
}

// ---------------------------------------------------------------------------
// SEC — identical doc state on every replica.
// ---------------------------------------------------------------------------

/**
 * A doc snapshot with every key set sorted.
 *
 * `Y.Map` ITERATION ORDER is a function of the local integration history, not of
 * the state, so a raw `toJSON()` comparison would report drift for two replicas
 * that hold exactly the same thing. Sorting is the whole difference between
 * comparing STATE and comparing HISTORY.
 */
function canonicalDocState(replica: FuzzReplica): string {
  const dump = (map: { toJSON(): unknown }): unknown => sortDeep(map.toJSON());
  return JSON.stringify({
    nodes: dump(replica.nodes()),
    edges: dump(replica.edges()),
    deleted: dump(replica.deleted()),
  });
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

function checkSec(replicas: readonly FuzzReplica[]): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  const first = canonicalDocState(replicas[0]);
  for (let i = 1; i < replicas.length; i++) {
    const other = canonicalDocState(replicas[i]);
    if (other !== first) {
      out.push({
        family: "sec",
        message:
          `replica ${i} holds a different doc state from replica 0 after quiescence.\n` +
          `  replica 0: ${first}\n  replica ${i}: ${other}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SCHEMA — no endpoint-less edge, no record without a position.
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Does this doc record carry a WHOLE position, in EITHER spelling?
 *
 * Re-derived here rather than imported: "no record without `pos`" is a property
 * the oracle must be able to contradict, and asking the module under test
 * whether it satisfies its own invariant is not an assertion. A P1 doc is
 * half-migrated by design, so a record positioned by the flat file keys alone is
 * as positioned as one carrying the register.
 */
function hasWholePosition(record: Record<string, unknown>): boolean {
  const pos = record.pos;
  if (Array.isArray(pos) && pos.length === 2 && isFiniteNumber(pos[0]) && isFiniteNumber(pos[1])) {
    return true;
  }
  return isFiniteNumber(record.x) && isFiniteNumber(record.y);
}

function checkSchema(replicas: readonly FuzzReplica[], files: readonly ProjectedFile[]): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  for (const [index, file] of files.entries()) {
    for (const node of file.nodes) {
      if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
        out.push({
          family: "schema",
          message: `replica ${index}: node "${String(node.id)}" reached the file with no position (${JSON.stringify(node)})`,
        });
      }
      if (!isFiniteNumber(node.width) || !isFiniteNumber(node.height)) {
        out.push({
          family: "schema",
          message: `replica ${index}: node "${String(node.id)}" reached the file with no size (${JSON.stringify(node)})`,
        });
      }
    }
    for (const edge of file.edges) {
      const from = edge.fromNode;
      const to = edge.toNode;
      if (typeof from !== "string" || from.length === 0 || typeof to !== "string" || to.length === 0) {
        out.push({
          family: "schema",
          message: `replica ${index}: endpoint-less edge "${String(edge.id)}" reached the file (${JSON.stringify(edge)})`,
        });
      }
    }
    // The same invariant one level down, on the DOC, for every record the file
    // projection actually emitted — a record can only be positioned on disk if
    // it was positioned in the doc, and a projection that invented geometry
    // would pass the loop above and fail here.
    const emitted = new Set(file.nodes.map((node) => String(node.id)));
    for (const [id, record] of replicas[index].nodes()) {
      if (!emitted.has(id)) continue;
      if (!hasWholePosition(record.toJSON() as Record<string, unknown>)) {
        out.push({
          family: "schema",
          message: `replica ${index}: node record "${id}" is serialised but holds no whole position in either spelling`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BYTES — identical canonical serialisation (WP17).
// ---------------------------------------------------------------------------

function checkBytes(files: readonly ProjectedFile[]): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  for (let i = 1; i < files.length; i++) {
    if (files[i].text !== files[0].text) {
      out.push({
        family: "bytes",
        message:
          `replica ${i} serialises a different \`.canvas\` text from replica 0.\n` +
          `  replica 0: ${files[0].text}\n  replica ${i}: ${files[i].text}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SHADOW / I7 / LWW — recorded by the ops as they ran.
// ---------------------------------------------------------------------------

function checkRecorded(replicas: readonly FuzzReplica[]): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  for (const replica of replicas) {
    for (const push of replica.stalePushes) {
      out.push({
        family: "shadow",
        message:
          `replica ${push.replica} pushed a STALE field: ${push.kind}/${push.id}.${push.field} ` +
          `= ${JSON.stringify(push.staleValue)} over the newer ${JSON.stringify(push.expectedValue)}`,
      });
    }
    for (const removal of replica.fieldRemovals) {
      out.push({
        family: "i7",
        message:
          `replica ${removal.replica}: a partial capture REMOVED ${removal.kind}/${removal.id}.${removal.field} ` +
          `(was ${JSON.stringify(removal.before)}) — I7 says observation never deletes`,
      });
    }
    for (const artefact of replica.lwwArtefacts) {
      out.push({ family: "lww", message: `replica ${replica.index}: ${artefact}` });
    }
    for (const admission of replica.writeAdmissions) {
      if (!Object.is(admission.landed, admission.intended)) {
        out.push({
          family: "lww",
          message:
            `replica ${admission.replica}: its own local write to ${admission.kind}/${admission.id}.${admission.field} ` +
            `did not land (intended ${JSON.stringify(admission.intended)}, doc held ${JSON.stringify(admission.landed)}) ` +
            `— a write-denial artefact, which WP21 removed`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// INTENT TRACE — the correctness family (AC5).
// ---------------------------------------------------------------------------

function describeSlot(slot: FieldSlot): string {
  return `${slot.kind}/${slot.id}.${slot.field}`;
}

function checkIntentTrace(
  trace: IntentTrace,
  files: readonly ProjectedFile[],
): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  const indexed = files.map((file) => ({
    node: indexById(file.nodes),
    edge: indexById(file.edges),
  }));

  // 1 — VISIBILITY. Which records the harness's own log says should be on disk.
  for (const kind of ["node", "edge"] as const) {
    const expected = [...trace.expectedRecordIds(kind)].sort();
    for (const [index, file] of indexed.entries()) {
      const actual = [...file[kind].keys()].sort();
      if (actual.join(",") !== expected.join(",")) {
        out.push({
          family: "intent-trace",
          message:
            `replica ${index}: the set of visible ${kind}s is not what the op log says.\n` +
            `  op log expects: [${expected.join(", ")}]\n  file holds:     [${actual.join(", ")}]`,
        });
      }
    }
  }

  // 2 — RECORD ORDER, by the harness's own `(ord, id)` comparator.
  for (const kind of ["node", "edge"] as const) {
    const expected = trace.expectedOrder(kind);
    for (const [index, file] of files.entries()) {
      const actual = (kind === "node" ? file.nodes : file.edges).map((record) =>
        String(record.id ?? ""),
      );
      if (actual.length === expected.length && actual.join(",") !== expected.join(",")) {
        out.push({
          family: "intent-trace",
          message:
            `replica ${index}: ${kind} order is not the (ord, id) order the op log assigned.\n` +
            `  op log expects: [${expected.join(", ")}]\n  file holds:     [${actual.join(", ")}]`,
        });
      }
    }
  }

  // 3 — FIELD VALUES. The heart of AC5.
  for (const slot of trace.touchedSlots()) {
    if (slot.pseudo) continue; // visibility and `ord` are not file fields
    if (!trace.expectedVisible(slot.kind, slot.id)) continue; // no opinion about a hidden record
    const expectation = trace.expect(slot);
    if (expectation === undefined) continue;

    const observed: unknown[] = [];
    for (const [index, file] of indexed.entries()) {
      const record = file[slot.kind].get(slot.id);
      if (record === undefined) {
        out.push({
          family: "intent-trace",
          message: `replica ${index}: ${describeSlot(slot)} — the record is missing from the file entirely`,
        });
        observed.push(undefined);
        continue;
      }
      observed.push(record[slot.field]);
    }

    if (expectation.kind === "determinate") {
      for (const [index, value] of observed.entries()) {
        if (!Object.is(value, expectation.value)) {
          out.push({
            family: "intent-trace",
            message:
              `replica ${index}: ${describeSlot(slot)} converged on ${JSON.stringify(value)}, ` +
              `but the LAST op on that field wrote ${JSON.stringify(expectation.value)} ` +
              `(op "${expectation.by.opClass}" on replica ${expectation.by.replica}, window ${expectation.by.window}). ` +
              `Every replica agreeing on this value does not make it the value the user meant.`,
          });
        }
      }
      continue;
    }

    // CONTESTED — a genuinely concurrent same-field write. Yjs tie-breaks it on
    // a random `clientID`, so asserting WHICH value won would pass about half
    // the time. What IS deterministic: all replicas agree, and the winner is one
    // of the values somebody actually wrote — never a third value nobody sent.
    const first = observed[0];
    for (const [index, value] of observed.entries()) {
      if (!Object.is(value, first)) {
        out.push({
          family: "intent-trace",
          message: `replica ${index}: contested ${describeSlot(slot)} did not converge (${JSON.stringify(value)} vs ${JSON.stringify(first)})`,
        });
      }
    }
    if (!expectation.candidates.some((candidate) => Object.is(candidate, first))) {
      out.push({
        family: "intent-trace",
        message:
          `${describeSlot(slot)} converged on ${JSON.stringify(first)}, which NO op ever wrote ` +
          `(the concurrent writes were ${JSON.stringify(expectation.candidates)}). ` +
          `A value nobody submitted is the torn-write class, not an LWW outcome.`,
      });
    }
  }

  // 4 — ATOMIC REGISTER CONTESTS (I8). A concurrent same-register write must
  // land as ONE author's WHOLE tuple. Checking `x` and `y` separately cannot see
  // a torn `(A.x, B.y)`, because each half is individually a value somebody
  // wrote — which is exactly why the register is one key and this check is one
  // tuple.
  // Only the LATEST contest per record still has an opinion. A second contest,
  // or any determinate write, in a LATER window is causally after this one and
  // is therefore the unambiguous last writer — the per-field check above owns
  // the outcome from that point on.
  const latestContest = new Map<string, (typeof trace.pairedContests)[number]>();
  for (const contest of trace.pairedContests) {
    const key = `${contest.kind}|${contest.id}`;
    const held = latestContest.get(key);
    if (held === undefined || contest.window >= held.window) latestContest.set(key, contest);
  }
  for (const contest of latestContest.values()) {
    const superseded = contest.fields.some(
      (field) => trace.expect({ kind: contest.kind, id: contest.id, field })?.kind === "determinate",
    );
    if (superseded) continue;
    for (const [index, file] of indexed.entries()) {
      const record = file[contest.kind].get(contest.id);
      if (record === undefined) continue;
      const observed = contest.fields.map((field) => record[field]);
      const matches = contest.candidates.some(
        (candidate) =>
          candidate.length === observed.length &&
          candidate.every((value, position) => Object.is(value, observed[position])),
      );
      if (!matches) {
        out.push({
          family: "intent-trace",
          message:
            `replica ${index}: the atomic register ${contest.kind}/${contest.id} ` +
            `(${contest.fields.join(", ")}) converged on ${JSON.stringify(observed)}, which is not any ` +
            `single author's submission — the concurrent writes were ` +
            `${JSON.stringify(contest.candidates)}. A torn combination is a value nobody submitted.`,
        });
      }
    }
  }

  return out;
}

/** Run every family. An empty result is the only pass. */
export function checkAllFamilies(
  replicas: readonly FuzzReplica[],
  trace: IntentTrace,
): FuzzViolation[] {
  const files = replicas.map(projectFile);
  return [
    ...checkIntentTrace(trace, files),
    ...checkSec(replicas),
    ...checkSchema(replicas, files),
    ...checkBytes(files),
    ...checkRecorded(replicas),
  ];
}

/** Group violations by family — the shape the fault-injection matrix reports. */
export function familiesHit(violations: readonly FuzzViolation[]): Set<AssertionFamily> {
  const out = new Set<AssertionFamily>();
  for (const violation of violations) out.add(violation.family);
  return out;
}

export { slotKey, type FuzzRecordKind };
