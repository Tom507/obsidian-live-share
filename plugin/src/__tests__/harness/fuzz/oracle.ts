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
  type TextAuthorship,
  isCollabTextSlot,
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
  | "lww"
  /**
   * WP36 follow-up (B32) — COLLABORATIVE TEXT.
   *
   * `text` and `label` are nested `Y.Text`s now, so the two families that used
   * to judge them — `intent-trace`'s "the value equals what the LAST op wrote"
   * and `lww`'s "my whole write landed verbatim" — were both statements of
   * *"text is a whole-string LWW register"*, which is the property WP36 was
   * chartered to remove.
   *
   * THE REPLACEMENT IS STRICTLY STRONGER, AND THAT IS THE POINT:
   *
   *   ├── LWW requires the replicas to AGREE. It is satisfied when one
   *   │      author's edit is destroyed, as long as everybody destroys it.
   *   └── This family requires BOTH EDITS TO SURVIVE. A run in which two peers
   *          edit the same card and one of them loses is a FAILURE here and was
   *          a PASS under the oracle it replaces.
   *
   * Where the harness can compute the merge exactly from its own log — two pure
   * insertions at distinct offsets, or two replacements of the same span — it
   * pins the exact string. Where it cannot without re-implementing the CRDT
   * (which is the circularity `intent-trace.ts` forbids), it asserts survival
   * and says so in the message rather than pretending to a value.
   */
  | "text-merge";

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
      if (admission.contribution !== undefined) {
        // WP36 follow-up (B32) — THE COLLABORATIVE-TEXT ADMISSION.
        //
        // "My whole string is what my doc holds" is unsatisfiable once the field
        // merges: this replica's own doc may already carry a peer's characters,
        // and demanding they be gone would be demanding the destruction AC3
        // forbids. What WP21's family actually asks — was my write ADMITTED, or
        // was it denied — survives the change intact, and is asserted here in
        // the only form that still means it: MY characters are in MY doc,
        // immediately after MY write.
        const landed = typeof admission.landed === "string" ? admission.landed : "";
        if (admission.contribution.length > 0 && !landed.includes(admission.contribution)) {
          out.push({
            family: "lww",
            message:
              `replica ${admission.replica}: its own local write to ${admission.kind}/${admission.id}.${admission.field} ` +
              `did not land — it contributed ${JSON.stringify(admission.contribution)} and its own doc ` +
              `holds ${JSON.stringify(admission.landed)} immediately afterwards ` +
              `(it meant ${JSON.stringify(admission.intended)}). A write-denial artefact, which WP21 removed.`,
          });
        }
      } else if (!Object.is(admission.landed, admission.intended)) {
        out.push({
          family: "lww",
          message:
            `replica ${admission.replica}: its own local write to ${admission.kind}/${admission.id}.${admission.field} ` +
            `did not land (intended ${JSON.stringify(admission.intended)}, doc held ${JSON.stringify(admission.landed)}) ` +
            `— a write-denial artefact, which WP21 removed`,
        });
      }
      // WP36 follow-up (B32) — THE CLAUSE THAT MAKES THIS STRICTLY STRONGER
      // THAN THE ORACLE IT REPLACES.
      //
      // The value check above is the pre-WP36 assertion, restored to full
      // strength by snapshotting the rendered string at write time (see
      // `WriteAdmission.landed`). On its own it is exactly as strong as before
      // and therefore GREEN against the whole-string LWW register.
      //
      // This clause is not. It says the write went through the collaborative
      // text path and left a nested `Y.Text` behind, which the pre-WP36
      // register never does — so the pair is red on the behaviour it replaced,
      // and it also catches the "merged once and then stopped merging"
      // un-migration the charter names as the second most likely wrong
      // implementation.
      if (admission.expectYText === true && admission.shape !== "ytext") {
        out.push({
          family: "lww",
          message:
            `replica ${admission.replica}: after its own write to ${admission.kind}/${admission.id}.${admission.field} ` +
            `the doc holds a ${admission.shape}, not a collaborative text. C36 AC1: no capture path ` +
            `may overwrite a \`Y.Text\` with a plain value — a field that flattens back to a register ` +
            `has silently stopped merging, and every convergence family stays green while it does.`,
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

// ---------------------------------------------------------------------------
// TEXT-MERGE — the correctness family for `text` / `label` (WP36 follow-up).
// ---------------------------------------------------------------------------

/** Every ordering of the authors' contributions. `n` is 2 in practice. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/**
 * The EXACT set of strings a sequence CRDT may converge on, computed from the
 * harness's own log — or `undefined` when the shape is one the harness cannot
 * name without simulating the CRDT.
 *
 * Two shapes are exactly computable, and between them they cover every
 * concurrent text write this registry issues:
 *
 *   ├── PURE INSERTIONS AT DISTINCT OFFSETS (`textEditViaSave`, and the live
 *   │      `kolla1bo2ration` case C36 AC3 is written around). Every author's
 *   │      characters land at their own offset, so the result is a SINGLE
 *   │      string: the base with each contribution spliced in. No tie-break is
 *   │      involved, so there is no set — there is one answer.
 *   └── REPLACEMENTS OF THE SAME SPAN (`contendedFieldWrite`: two peers each
 *          retyping the whole card). The deletions coincide and both insertions
 *          land at the same position, so the result is
 *          `prefix + contributions in SOME order + suffix`. Yjs breaks that tie
 *          on a random `clientID`, so the oracle names the whole set and never
 *          which member won — asserting one would pass about half the time,
 *          which is worse than not asserting.
 */
function expectedMergeSet(
  authors: readonly TextAuthorship[],
): { values: string[]; shape: string } | undefined {
  if (authors.length < 2) return undefined;
  const base = authors[0].base;
  if (!authors.every((author) => author.base === base)) return undefined;

  const contributing = authors.filter((author) => author.inserted.length > 0);
  if (contributing.length === 0) return undefined;

  // Shape 1 — pure insertions at pairwise-distinct offsets.
  const offsets = authors.map((author) => author.offset);
  if (
    authors.every((author) => author.deleted.length === 0) &&
    new Set(offsets).size === offsets.length
  ) {
    const ordered = [...authors].sort((a, b) => b.offset - a.offset);
    let out = base;
    for (const author of ordered) {
      out = out.slice(0, author.offset) + author.inserted + out.slice(author.offset);
    }
    return { values: [out], shape: "pure insertions at distinct offsets" };
  }

  // Shape 2 — every author replaced exactly the same span.
  const { offset, deleted } = authors[0];
  if (authors.every((author) => author.offset === offset && author.deleted === deleted)) {
    const prefix = base.slice(0, offset);
    const suffix = base.slice(offset + deleted.length);
    const values = permutations(contributing.map((author) => author.inserted)).map(
      (order) => prefix + order.join("") + suffix,
    );
    return { values: [...new Set(values)], shape: "one replaced span, tie-broken order" };
  }

  return undefined;
}

function describeAuthors(authors: readonly TextAuthorship[]): string {
  return authors
    .map(
      (author) =>
        `r${author.replica}/${author.opClass}@w${author.window} ` +
        `base=${JSON.stringify(author.base)} -> ${JSON.stringify(author.next)} ` +
        `(contributed ${JSON.stringify(author.inserted)} at ${author.offset}, ` +
        `deleted ${JSON.stringify(author.deleted)})`,
    )
    .join("\n      ");
}

/**
 * Judge ONE collaborative-text slot.
 *
 * Order matters and is deliberate: SURVIVAL first, EXACTNESS second,
 * AGREEMENT LAST. Convergence is exactly what the defect WP36 removed
 * PRESERVED — two replicas agreeing on a string with one peer's characters
 * destroyed is a perfectly convergent document — so agreement is asserted only
 * after the properties that can actually contradict it.
 */
function checkTextSlot(
  slot: FieldSlot,
  expectation: Extract<
    ReturnType<IntentTrace["expect"]>,
    { kind: "text-merge" }
  >,
  observed: readonly unknown[],
): FuzzViolation[] {
  const out: FuzzViolation[] = [];
  const where = describeSlot(slot);

  const rendered: string[] = [];
  for (const [index, value] of observed.entries()) {
    if (typeof value !== "string") {
      out.push({
        family: "text-merge",
        message:
          `replica ${index}: ${where} reached the FILE as ${JSON.stringify(value)} ` +
          `(${typeof value}). The projection must render a nested \`Y.Text\` to its string — ` +
          `a consumer that receives the object is C36 AC4's failure, not a merge failure.`,
      });
      rendered.push("");
      continue;
    }
    rendered.push(value);
  }

  // ---- 1. SURVIVAL. The clause LWW cannot satisfy. ------------------------
  //
  // Restricted to the LAST window that wrote the slot: an earlier author's
  // characters may legitimately have been deleted by a later, causally ordered
  // author, and asserting over the whole run would forbid deletion entirely —
  // "a merge that never deletes is not a merge".
  for (const author of expectation.lastWindowAuthors) {
    if (author.inserted.length === 0) continue;
    for (const [index, value] of rendered.entries()) {
      if (value.includes(author.inserted)) continue;
      out.push({
        family: "text-merge",
        message:
          `replica ${index}: ${where} converged on ${JSON.stringify(value)}, which does NOT ` +
          `contain the characters replica ${author.replica} contributed ` +
          `(${JSON.stringify(author.inserted)}, op "${author.opClass}", window ${author.window}).\n` +
          `      ${expectation.lastWindowAuthors.length > 1 ? "TWO AUTHORS WROTE THIS FIELD CONCURRENTLY AND ONE OF THEM LOST." : "A single author's own edit did not survive."}\n` +
          `      A whole-string LWW register passes this run; a character-level merge must not.\n` +
          `      authors:\n      ${describeAuthors(expectation.lastWindowAuthors)}`,
      });
    }
  }

  // ---- 2. EXACTNESS, wherever the harness can compute it ------------------
  if (!expectation.diverged && expectation.value !== undefined) {
    // Sequential writes from an up-to-date surface: every capture is `exact`,
    // so the converged value IS the last author's string. Same strength as the
    // pre-WP36 determinate check, kept verbatim.
    for (const [index, value] of rendered.entries()) {
      if (value === expectation.value) continue;
      out.push({
        family: "text-merge",
        message:
          `replica ${index}: ${where} converged on ${JSON.stringify(value)}, but the writes to ` +
          `this field were strictly sequential from an up-to-date surface, so the merge had ` +
          `nothing to reconcile and the value must be the last author's ` +
          `${JSON.stringify(expectation.value)}.\n      authors:\n      ${describeAuthors(expectation.authors)}`,
      });
    }
  } else if (expectation.lastWindowAuthors.length > 1 && expectation.lastWindowBaseVerified) {
    // THE RECORDED PRECONDITION GATE. Without it this arm would compute a merge
    // from bases the authors merely BELIEVED, and a stale belief makes every
    // outcome look like an invention. `lastWindowBaseVerified` means every
    // author of this window checked its base against its own doc and they all
    // agree — which is exactly the state in which a sequence CRDT's outcome is
    // a function of the log alone.
    const exact = expectedMergeSet(expectation.lastWindowAuthors);
    if (exact !== undefined) {
      for (const [index, value] of rendered.entries()) {
        if (exact.values.includes(value)) continue;
        out.push({
          family: "text-merge",
          message:
            `replica ${index}: ${where} converged on ${JSON.stringify(value)}, which is not a ` +
            `merge of the concurrent edits (${exact.shape}). The only outcomes a sequence CRDT ` +
            `may produce here are ${JSON.stringify(exact.values)}.\n` +
            `      A value outside that set contains a character nobody typed, or lost one ` +
            `somebody did.\n      authors:\n      ${describeAuthors(expectation.lastWindowAuthors)}`,
        });
      }
    }
  }

  // ---- 3. AGREEMENT, and only now --------------------------------------
  const first = rendered[0];
  for (const [index, value] of rendered.entries()) {
    if (value === first) continue;
    out.push({
      family: "text-merge",
      message: `replica ${index}: ${where} did not converge (${JSON.stringify(value)} vs ${JSON.stringify(first)})`,
    });
  }

  return out;
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

    // WP36 follow-up (B32): `text` and `label` are judged by the merge family,
    // never by the LWW arms below.
    if (expectation.kind === "text-merge") {
      out.push(...checkTextSlot(slot, expectation, observed));
      continue;
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
