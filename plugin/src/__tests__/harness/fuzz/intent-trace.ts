// WP23 / AC5 — THE INTENT TRACE. The harness's own account of what the user
// meant, and the ONLY basis the correctness oracle is allowed to use.
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// AC2's four assertion families — SEC, schema invariants, byte equality,
// shadow consistency — share one blind spot: ALL FOUR ARE SATISFIED WHEN EVERY
// REPLICA CONVERGES ON THE SAME WRONG VALUE. The WP18 batch found exactly that
// bug in production: `decodeV2RecordToFlat` resolved a flat-vs-register
// collision by `Y.Map` INSERTION ORDER, so a moved card snapped back to its
// pre-move coordinate on every replica. SEC held. The schema held. The bytes
// were byte-identical everywhere. The shadow agreed. Four green families over a
// corrupted document.
//
// So this module records, for every field an op touched, the value that op
// INTENDED — at the moment the op was issued, in the file vocabulary the user
// would see — and nothing else. It never reads a replica, never reads a doc,
// never imports a decoder, a serialiser or any other part of the system under
// test. Its expectations are computed from ITS OWN LOG.
//
//   THE CIRCULARITY RULE: reading the expected value back from a replica, or
//   from a "reference" implementation that shares code with the system under
//   test, makes the oracle circular and is a FAILED implementation of AC5.
//   Nothing in this file imports from `src/canvas/` or `src/files/`.
//
// THE DETERMINISM PROBLEM, AND HOW IT IS SOLVED HERE
// --------------------------------------------------
// An assertion on a specific value is legitimate only when that value has a
// single author or a causal predecessor chain. Yjs tie-breaks a genuinely
// concurrent same-key write on `clientID = random.uint32()`, so an assertion on
// such an outcome passes about half the time — worse than no fuzzer.
//
// The oracle therefore needs a TOTAL ORDER it can predict, and it gets one
// because THE HARNESS IMPOSES IT rather than inferring it:
//
//   ├── A run is a sequence of WINDOWS. Every window ends with a full-mesh
//   │      synchronisation to quiescence, so every op in window `w+1` is issued
//   │      by a replica that has already integrated every op of window `w`.
//   │      Cross-window writes to the same slot are therefore CAUSALLY ORDERED,
//   │      never concurrent, and Yjs's LWW picks the later one by construction.
//   ├── WITHIN a window a slot may be CLAIMED by at most one op (see
//   │      `SlotClaims`). Two ops in the same window can only ever touch
//   │      DISTINCT slots, so there is no same-slot concurrency to tie-break.
//   └── The one place a genuinely concurrent same-slot write is WANTED — the
//          WP21 link, "removing the write gate does not change convergence" —
//          is declared CONTESTED. For a contested slot the oracle asserts
//          convergence and LWW-consistency (all replicas agree, and the winner
//          is one of the values actually written) and NEVER which one won.
//
// Partitions, delta reordering and delta duplication all happen INSIDE a
// window, so the interleaving space is genuinely explored; what the window
// boundary removes is only the unpredictability of the ARBITRATION, not the
// concurrency.

/** The two record id spaces of a `.canvas` surface. */
export type FuzzRecordKind = "node" | "edge";

/**
 * A value as it appears in the `.canvas` FILE — the vocabulary the user sees.
 *
 * The oracle deliberately works in FILE terms, not doc terms. The WP18-class
 * bug lives in the doc→file projection: the doc held the right answer under the
 * flat spelling and the wrong one under the register spelling, and a doc-level
 * oracle would have called that document perfectly healthy.
 */
export type FileValue = string | number | boolean | null;

/** One field of one record, addressed the way the file addresses it. */
export interface FieldSlot {
  readonly kind: FuzzRecordKind;
  readonly id: string;
  /** A `.canvas` FILE key — `x`, `width`, `fromNode`, `label`, … */
  readonly field: string;
  /**
   * `true` for a slot that is NOT a file field: record VISIBILITY and the
   * doc-only `ord`. Both are real intents an op expresses and both need
   * exclusivity within a window, but neither is a key the oracle may look up in
   * a projected record — so the discriminator is an explicit flag rather than a
   * naming convention that a later field name could collide with.
   */
  readonly pseudo?: boolean;
}

/** `kind|id|field`. The wildcard form `kind|id|*` claims a whole record. */
export type SlotKey = string;

export function slotKey(slot: FieldSlot): SlotKey {
  return `${slot.kind}|${slot.id}|${slot.field}`;
}

export function recordKey(kind: FuzzRecordKind, id: string): SlotKey {
  return `${kind}|${id}|*`;
}

/** The visibility "slot" of a record — delete, undo and quarantine all claim it. */
export function visibilitySlot(kind: FuzzRecordKind, id: string): FieldSlot {
  return { kind, id, field: "@visible", pseudo: true };
}

/** The `ord` slot. Doc-only: `ord` never reaches the file, it decides ORDER. */
export function ordSlot(kind: FuzzRecordKind, id: string): FieldSlot {
  return { kind, id, field: "@ord", pseudo: true };
}

/**
 * How the harness built a record in the doc, so an op knows which spelling it
 * may honestly write.
 *
 *   ├── `dual`         — the record carries BOTH the flat file keys and the
 *   │      atomic registers for the same fact. This is the shape a
 *   │      `migrateV1ToV2`-migrated record has in production (the migration is
 *   │      deliberately ADDITIVE), and it is the AC5 collision class. Only the
 *   │      FLAT spelling is authored on such a record, because in P1 the flat
 *   │      key is the vocabulary every live writer authors in and the register
 *   │      is only ever a translation of it.
 *   └── `registerOnly` — the record carries the registers alone (what a V2
 *          cold-open seed writes). The register IS the authored spelling.
 */
export type RecordShape = "dual" | "registerOnly";

/** Which spelling was inserted into the `Y.Map` FIRST — AC5's "varies the insertion order". */
export type KeyOrder = "flatFirst" | "registerFirst";

/** One entry of the harness's op log. Append-only; never rewritten. */
export interface OpLogEntry {
  readonly window: number;
  readonly seq: number;
  readonly replica: number;
  readonly opClass: string;
  readonly slot: FieldSlot;
  readonly value: FileValue;
  /**
   * `true` only for a DELIBERATELY concurrent same-slot write (the WP21 link).
   * The oracle then asserts convergence + membership, never a specific winner.
   */
  readonly contested: boolean;
}

/** What the trace expects a slot to hold once the run has quiesced. */
export type SlotExpectation =
  | { readonly kind: "determinate"; readonly value: FileValue; readonly by: OpLogEntry }
  | { readonly kind: "contested"; readonly candidates: readonly FileValue[]; readonly window: number };

/** What the trace knows about one record, purely from the ops that built it. */
export interface TracedRecord {
  readonly kind: FuzzRecordKind;
  readonly id: string;
  shape: RecordShape;
  keyOrder: KeyOrder;
  /** `true` when the record is part of the simulated Obsidian surface (save path). */
  saveEligible: boolean;
  /** The harness's own belief about visibility — set by delete / undo / quarantine ops. */
  visible: boolean;
  /** `true` when the harness deliberately made this record invalid (WP20 fault injection). */
  invalid: boolean;
  /** The `ord` the harness assigned, `""` when it never assigned one. */
  ord: string;
}

/**
 * A slot claim ledger for ONE window.
 *
 * This is the mechanism that makes the intent-trace oracle deterministic, so it
 * is deliberately a hard gate rather than an advisory: an op that cannot claim
 * its slot ABORTS and is not logged. A claim on `kind|id|*` (a whole record)
 * conflicts with every field of that record and vice versa, which is what lets a
 * whole-surface save claim everything it could possibly write in one call.
 */
export class SlotClaims {
  private readonly exact = new Set<SlotKey>();
  private readonly records = new Set<SlotKey>();

  /** Claim one field slot. `false` ⇒ somebody already owns it this window. */
  claim(slot: FieldSlot): boolean {
    const key = slotKey(slot);
    if (this.exact.has(key)) return false;
    if (this.records.has(recordKey(slot.kind, slot.id))) return false;
    this.exact.add(key);
    return true;
  }

  /** Claim EVERY slot of a record. `false` ⇒ any field of it is already claimed. */
  claimRecord(kind: FuzzRecordKind, id: string): boolean {
    const key = recordKey(kind, id);
    if (this.records.has(key)) return false;
    const prefix = `${kind}|${id}|`;
    for (const held of this.exact) {
      if (held.startsWith(prefix)) return false;
    }
    this.records.add(key);
    return true;
  }

  /** Is this slot free? A read-only probe, for an op deciding applicability. */
  isFree(slot: FieldSlot): boolean {
    return !this.exact.has(slotKey(slot)) && !this.records.has(recordKey(slot.kind, slot.id));
  }

  clear(): void {
    this.exact.clear();
    this.records.clear();
  }
}

/**
 * THE INTENT TRACE.
 *
 * Holds the op log and the harness's own record catalogue, and answers the one
 * question the correctness oracle asks: "what did the last op on this slot,
 * under the run's total order, actually write?"
 */
/**
 * A deliberately concurrent write to a MULTI-FIELD fact (I8, "atomic is what
 * belongs together").
 *
 * `pos` is ONE register holding `[x, y]`. Two peers dragging the same card
 * concurrently must therefore land on ONE author's WHOLE pair — a merged
 * `(A.x, B.y)` is a coordinate NOBODY submitted, which is the exact defect the
 * atomic register exists to make unrepresentable. Per-field contest checking
 * cannot see it: `10` and `40` are each individually a value somebody wrote.
 */
export interface PairedContest {
  readonly window: number;
  readonly kind: FuzzRecordKind;
  readonly id: string;
  /** The FILE fields the one register expands into, e.g. `["x", "y"]`. */
  readonly fields: readonly string[];
  /** One entry per concurrent author: the whole tuple that author submitted. */
  readonly candidates: readonly (readonly FileValue[])[];
}

export class IntentTrace {
  private readonly entries: OpLogEntry[] = [];
  private readonly records = new Map<SlotKey, TracedRecord>();
  private readonly pairs: PairedContest[] = [];
  private seq = 0;

  /** Every declared atomic-register contest. Checked as WHOLE tuples, never per field. */
  get pairedContests(): readonly PairedContest[] {
    return this.pairs;
  }

  declarePairedContest(contest: PairedContest): void {
    this.pairs.push(contest);
  }

  /** Every logged op, in the run's total order. */
  get log(): readonly OpLogEntry[] {
    return this.entries;
  }

  get opCount(): number {
    return this.entries.length;
  }

  // ---- the record catalogue -----------------------------------------------

  declareRecord(record: Omit<TracedRecord, "visible" | "invalid" | "ord"> & Partial<TracedRecord>): TracedRecord {
    const key = recordKey(record.kind, record.id);
    const created: TracedRecord = {
      kind: record.kind,
      id: record.id,
      shape: record.shape,
      keyOrder: record.keyOrder,
      saveEligible: record.saveEligible,
      visible: record.visible ?? true,
      invalid: record.invalid ?? false,
      ord: record.ord ?? "",
    };
    this.records.set(key, created);
    return created;
  }

  record(kind: FuzzRecordKind, id: string): TracedRecord | undefined {
    return this.records.get(recordKey(kind, id));
  }

  allRecords(kind: FuzzRecordKind): TracedRecord[] {
    const out: TracedRecord[] = [];
    for (const record of this.records.values()) {
      if (record.kind === kind) out.push(record);
    }
    return out;
  }

  /**
   * Records the harness believes are on the simulated Obsidian surface right
   * now — i.e. what an Obsidian save of this canvas would contain.
   *
   * Uses `expectedVisible`, not the record's own `visible` flag, so the node→edge
   * CASCADE is honoured: an edge whose endpoint node was deleted is not on the
   * surface any more, and a save that still listed it would be re-stating a
   * record the user cannot see.
   */
  surfaceRecords(kind: FuzzRecordKind): TracedRecord[] {
    return this.allRecords(kind).filter(
      (record) => record.saveEligible && this.expectedVisible(kind, record.id),
    );
  }

  // ---- the log ------------------------------------------------------------

  /**
   * Log one field write. `value` is what the op MEANT, in file terms, recorded
   * at issue time — never read back from anything.
   */
  write(entry: Omit<OpLogEntry, "seq">): void {
    this.entries.push({ ...entry, seq: this.seq++ });
  }

  /**
   * The expectation for one slot, computed by walking the harness's OWN log.
   *
   * `undefined` when no op ever touched the slot — the oracle then asserts
   * nothing about it, which is the honest answer: the fuzzer has no opinion
   * about a field it never wrote.
   *
   * Two same-window contested writes collapse into ONE `contested` expectation
   * carrying both candidates; a later determinate write in a LATER window
   * replaces it, because the window boundary made it causally later and
   * therefore the unambiguous last writer.
   */
  expect(slot: FieldSlot): SlotExpectation | undefined {
    const key = slotKey(slot);
    let best: SlotExpectation | undefined;
    let bestWindow = -1;
    const contestedValues: FileValue[] = [];
    let contestedWindow = -1;

    for (const entry of this.entries) {
      if (slotKey(entry.slot) !== key) continue;
      if (entry.contested) {
        if (entry.window !== contestedWindow) {
          contestedValues.length = 0;
          contestedWindow = entry.window;
        }
        contestedValues.push(entry.value);
        if (entry.window >= bestWindow) {
          bestWindow = entry.window;
          best = { kind: "contested", candidates: [...contestedValues], window: entry.window };
        }
        continue;
      }
      bestWindow = entry.window;
      best = { kind: "determinate", value: entry.value, by: entry };
    }
    return best;
  }

  /** Every slot the run touched, deduplicated, in first-write order. */
  touchedSlots(): FieldSlot[] {
    const seen = new Set<SlotKey>();
    const out: FieldSlot[] = [];
    for (const entry of this.entries) {
      const key = slotKey(entry.slot);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry.slot);
    }
    return out;
  }

  /**
   * THE HARNESS'S OWN VISIBILITY MODEL, including the node→edge cascade.
   *
   * Deliberately re-derived here from the trace's own knowledge rather than
   * asked of `buildCanvasData`: the cascade ("an edge whose endpoint node is
   * suppressed is not serialised") is part of what the oracle must be able to
   * contradict, so borrowing production's answer for it would blind the oracle
   * to a cascade bug in exactly the way AC5 forbids.
   */
  expectedVisible(kind: FuzzRecordKind, id: string): boolean {
    const record = this.records.get(recordKey(kind, id));
    if (!record) return false;
    if (!record.visible || record.invalid) return false;
    if (kind === "node") return true;

    for (const endpoint of ["fromNode", "toNode"] as const) {
      const expectation = this.expect({ kind: "edge", id, field: endpoint });
      if (expectation === undefined) return false;
      const nodeId = expectation.kind === "determinate" ? expectation.value : undefined;
      if (typeof nodeId !== "string" || nodeId.length === 0) return false;
      const node = this.records.get(recordKey("node", nodeId));
      if (!node || !node.visible || node.invalid) return false;
    }
    return true;
  }

  /** Every record the harness expects to appear in the projected file, for one kind. */
  expectedRecordIds(kind: FuzzRecordKind): string[] {
    return this.allRecords(kind)
      .filter((record) => this.expectedVisible(kind, record.id))
      .map((record) => record.id);
  }

  /**
   * The record ORDER the harness expects, by its OWN `(ord, id)` comparator.
   *
   * Plain UTF-16 code-unit comparison, written here rather than imported from
   * `canvas-ord.ts` for the same reason as everything else in this file: an
   * oracle that borrows the comparator under test cannot disagree with it.
   */
  expectedOrder(kind: FuzzRecordKind): string[] {
    const ids = this.expectedRecordIds(kind);
    const decorated = ids.map((id) => ({
      id,
      ord: this.records.get(recordKey(kind, id))?.ord ?? "",
    }));
    decorated.sort((a, b) => {
      if (a.ord < b.ord) return -1;
      if (a.ord > b.ord) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return decorated.map((entry) => entry.id);
  }

  /**
   * The harness's expected FILE record for one id: every slot it ever wrote,
   * with the determinate expectation for each. Contested slots are omitted —
   * they have no single expected value by construction.
   */
  expectedRecord(kind: FuzzRecordKind, id: string): Record<string, FileValue> {
    const out: Record<string, FileValue> = {};
    for (const slot of this.touchedSlots()) {
      if (slot.kind !== kind || slot.id !== id) continue;
      if (slot.pseudo) continue;
      const expectation = this.expect(slot);
      if (expectation?.kind !== "determinate") continue;
      out[slot.field] = expectation.value;
    }
    return out;
  }
}
