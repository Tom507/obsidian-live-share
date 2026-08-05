// ---------------------------------------------------------------------------
// WP36 / C36 — the THREE-WAY text merge, as a pure core.
//
// Zero imports. The precedent is `canvas/reconcile-plan.ts`: no Obsidian, no
// filesystem, no clock, no Yjs. This module decides *which ops* a capture must
// emit into a nested collaborative text; the caller emits them. That split is
// what makes the hard part testable at all — the position arithmetic is a pure
// function of three strings.
//
// WHY THIS EXISTS AND WHY `applyMinimalYTextUpdate` MAY NOT BE USED HERE
// ---------------------------------------------------------------------------
// `utils.ts:applyMinimalYTextUpdate` opens with `const oldContent =
// text.toString()` — it diffs the CRDT's own current content against the
// incoming string. On the raw-markdown sync path that is correct, because there
// the incoming string IS the merged truth.
//
// On the canvas file-driven capture path it is not. The incoming string is what
// the local `.canvas` file holds, and the local file does NOT contain a peer's
// characters that Yjs merged into the doc after this client last reconciled its
// view. A two-way diff computes those characters as a DELETION:
//
//   doc  (Y.Text)      "Alice" + "Y" + "Bob"     <- peer B's "Y", already merged
//   local .canvas      "Alice" + "X" + "Bob"     <- this client's own save
//   two-way diff       keep "Alice"/"Bob"  =>  delete "Y", insert "X"
//   doc after capture  "Alice" + "X" + "Bob"     <- B's character is GONE
//
// Both replicas then converge on the truncated string, so byte equality, strong
// eventual consistency and the convergence fuzzer all stay GREEN while a remote
// user's text is destroyed. The failure is invisible to every oracle that
// compares the two replicas to each other, because it is a property of ONE
// client's capture.
//
// The third operand is therefore mandatory: the Surface-Shadow's value, i.e.
// "the string this client last confirmed was on the surface". `base -> next` is
// what the local user actually did; `base -> current` is what the peers did.
// Only the first is intent.
//
// POSITION RESOLUTION: design (a), CONTEXT-ANCHORED (charter §3 Verification 3).
// ---------------------------------------------------------------------------
// No `Y.RelativePosition` anchors are held anywhere, and no per-field state
// lives beside the shadow. The local edit's offset is re-derived on every write
// from the *unchanged context* around it, by comparing the local change region
// against the peers' change region in the SAME (base) coordinate system:
//
//   - the two regions are DISJOINT  -> the local offset maps by a constant
//     shift (0 if the local edit is before the peers' region, the peers' net
//     length delta if it is after). Exact, no guessing.
//   - the two regions OVERLAP       -> the peers edited the same span. The
//     local INSERT still applies; the local DELETE applies only to characters
//     that are still literally there (found by matching the deleted text inside
//     the peers' current span). A character the peers already removed is NOT
//     deleted again, and a character the peers ADDED is never deleted at all —
//     that is C36 AC3's "no client's capture deletes a character it did not
//     observe the user delete", stated as code.
//   - the deleted text occurs MORE THAN ONCE in the peers' span -> the anchor
//     is genuinely ambiguous. This does NOT guess: it falls back to a whole-
//     value replace and REPORTS the fallback, so the caller can count it. A
//     fallback counter that fires on most edits is the signal that the
//     mechanism is not merging.
// ---------------------------------------------------------------------------

/** One primitive op against a collaborative text, in that text's coordinates. */
export type TextMergeOp =
  | { readonly kind: "delete"; readonly index: number; readonly length: number }
  | { readonly kind: "insert"; readonly index: number; readonly text: string };

/**
 * How the local edit's position was resolved. Reported per write so a run can
 * be audited afterwards — a mechanism that always answers `"fallback-replace"`
 * is a whole-string LWW register wearing a merge's clothes.
 */
export type TextMergeResolution =
  /** `base === next`: the local user changed nothing. No ops. */
  | "identical"
  /**
   * `current === next`: the doc ALREADY holds exactly what the local file
   * holds. Nothing to contribute — and contributing anything would duplicate an
   * edit that has already landed (the local save arriving back after its own
   * round trip, or a peer having made the identical change).
   */
  | "converged"
  /** No peer touched this field since the shadow advanced. Offsets are exact. */
  | "exact"
  /** The local edit lies entirely before the peers' changed span. */
  | "disjoint-before"
  /** The local edit lies entirely after the peers' changed span. */
  | "disjoint-after"
  /** Overlapping spans; the deleted text was located exactly once. */
  | "overlap-anchored"
  /** Overlapping spans; the deleted text is already gone. Insert only. */
  | "overlap-delete-already-applied"
  /** Overlapping spans, ambiguous anchor. Whole-value replace, counted. */
  | "fallback-replace"
  /**
   * The shadow never observed this field, so there is no third operand. Handled
   * WITHOUT deletions (see {@link planTextMerge}) — never as a two-way diff.
   */
  | "no-base-insert-only"
  /** No base, and the doc already holds exactly what the save holds. No ops. */
  | "no-base-converged";

export interface TextMergePlan {
  /** The ops to emit, in order, inside one transaction. May be empty. */
  readonly ops: readonly TextMergeOp[];
  readonly resolution: TextMergeResolution;
  /** `true` only for `"fallback-replace"`. The counter the charter requires. */
  readonly fallback: boolean;
  /** The string the doc will hold once `ops` are applied to `current`. */
  readonly result: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

interface DiffBounds {
  /** Length of the shared prefix, snapped off surrogate pairs. */
  readonly prefix: number;
  /** Exclusive end of the changed span in `a`. */
  readonly aEnd: number;
  /** Exclusive end of the changed span in `b`. */
  readonly bEnd: number;
}

/**
 * The single contiguous change between two strings, with the surrogate-pair
 * boundary rule.
 *
 * The boundary rule is re-implemented here rather than imported: `utils.ts` is
 * byte-frozen by this work package, and its function is the two-way writer this
 * module exists to replace. The rule itself is the same one, and it is the
 * reason it may not be paraphrased loosely — a `delete`/`insert` that cuts
 * between a high (\uD800-\uDBFF) and a low (\uDC00-\uDFFF) surrogate produces
 * an unpaired code unit that no consumer can render.
 */
export function diffBounds(a: string, b: string): DiffBounds {
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;

  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }

  // If the prefix landed right after a MATCHED high surrogate, its low-surrogate
  // partner must differ (otherwise the prefix would have advanced past it), so
  // the pair is being split — back the boundary off the whole code point.
  while (prefix > 0 && isHighSurrogate(a.charCodeAt(prefix - 1))) prefix--;
  // If the retained suffix would start on a lone low surrogate, its high
  // partner is inside the changed span — extend the boundary to keep the code
  // point together.
  while (aEnd < a.length && isLowSurrogate(a.charCodeAt(aEnd)) && aEnd > prefix) {
    aEnd++;
    bEnd++;
  }
  return { prefix, aEnd, bEnd };
}

function opsFor(index: number, deleteLength: number, insertText: string): TextMergeOp[] {
  const ops: TextMergeOp[] = [];
  // DELETE first, then INSERT at the same index. The order matters: an insert
  // first would shift the delete's own coordinates.
  if (deleteLength > 0) ops.push({ kind: "delete", index, length: deleteLength });
  if (insertText.length > 0) ops.push({ kind: "insert", index, text: insertText });
  return ops;
}

/** Apply a plan's ops to a plain string — the model the caller's CRDT realises. */
export function applyTextOps(source: string, ops: readonly TextMergeOp[]): string {
  let out = source;
  for (const op of ops) {
    if (op.kind === "delete") out = out.slice(0, op.index) + out.slice(op.index + op.length);
    else out = out.slice(0, op.index) + op.text + out.slice(op.index);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + 1);
  }
  return count;
}

/**
 * THE function. Three strings in, a set of CRDT ops out.
 *
 * @param base    what this client last confirmed was on the surface (the
 *                Surface-Shadow's value). `undefined` = never observed.
 * @param next    what the local `.canvas` file now holds — the local intent.
 * @param current what the collaborative text holds right now, peers included.
 */
export function planTextMerge(
  base: string | undefined,
  next: string,
  current: string,
): TextMergePlan {
  // ---- the doc already agrees with the file ------------------------------
  //
  // FIRST, before any diff, and it is not an optimisation. A stale base makes
  // an already-landed local edit look like a fresh one: base `"Alice"`, save
  // `"AliceBob"`, doc `"AliceBob"` would otherwise be read as "insert Bob"
  // against a doc that already has it, and the card would become
  // `"AliceBobBob"`. Convergence is the one state in which the correct number
  // of ops is provably zero.
  if (current === next) {
    return { ops: [], resolution: "converged", fallback: false, result: current };
  }

  // ---- no third operand -------------------------------------------------
  //
  // The shadow has never observed this field (a first capture in a fresh
  // session, before any reconcile pass has advanced it). A two-way diff is
  // exactly the forbidden shape, so this branch NEVER DELETES: it contributes
  // the characters the local file has and the doc lacks, and leaves everything
  // else alone. Stale characters converge on the next pass — once this capture
  // completes, the caller advances the shadow and every later write is a real
  // three-way.
  if (base === undefined) {
    const { prefix, aEnd, bEnd } = diffBounds(current, next);
    const insert = next.slice(prefix, bEnd);
    if (insert.length === 0) {
      return { ops: [], resolution: "no-base-converged", fallback: false, result: current };
    }
    // Insert AFTER whatever the doc holds in the changed span, so a peer's
    // characters keep their position and the local ones follow them.
    const ops = opsFor(aEnd, 0, insert);
    return {
      ops,
      resolution: "no-base-insert-only",
      fallback: false,
      result: applyTextOps(current, ops),
    };
  }

  // ---- the local user changed nothing -----------------------------------
  if (base === next) {
    return { ops: [], resolution: "identical", fallback: false, result: current };
  }

  const local = diffBounds(base, next);
  const localStart = local.prefix;
  const localEnd = local.aEnd;
  const deleted = base.slice(localStart, localEnd);
  const inserted = next.slice(local.prefix, local.bEnd);

  // ---- nobody else touched it -------------------------------------------
  if (current === base) {
    const ops = opsFor(localStart, deleted.length, inserted);
    return { ops, resolution: "exact", fallback: false, result: applyTextOps(current, ops) };
  }

  // ---- where did the PEERS change it? ------------------------------------
  const peer = diffBounds(base, current);
  const peerStart = peer.prefix;
  const peerEnd = peer.aEnd; // in BASE coordinates
  const peerCurEnd = peer.bEnd; // the same span in CURRENT coordinates
  const shift = peerCurEnd - peerEnd;

  // Local edit entirely BEFORE the peers' span: base coordinates still hold.
  if (localEnd <= peerStart) {
    const ops = opsFor(localStart, deleted.length, inserted);
    return {
      ops,
      resolution: "disjoint-before",
      fallback: false,
      result: applyTextOps(current, ops),
    };
  }

  // Local edit entirely AFTER the peers' span: shift by their net length delta.
  if (localStart >= peerEnd) {
    const ops = opsFor(localStart + shift, deleted.length, inserted);
    return {
      ops,
      resolution: "disjoint-after",
      fallback: false,
      result: applyTextOps(current, ops),
    };
  }

  // ---- OVERLAP: the peers edited the span the local user edited -----------
  const span = current.slice(peerStart, peerCurEnd);

  if (deleted.length === 0) {
    // A pure local insertion inside the peers' span. Nothing of theirs is
    // touched; the local characters land at the end of their span so both
    // survive, in a deterministic order.
    const ops = opsFor(peerCurEnd, 0, inserted);
    return {
      ops,
      resolution: "overlap-anchored",
      fallback: false,
      result: applyTextOps(current, ops),
    };
  }

  const occurrences = countOccurrences(span, deleted);

  if (occurrences === 0) {
    // The characters the local user deleted are ALREADY GONE — a peer removed
    // or replaced them. Re-deleting "the same offset" would delete the peer's
    // replacement, which is precisely the character this client never observed
    // the user delete. So: delete nothing, contribute the insertion only.
    if (inserted.length === 0) {
      return {
        ops: [],
        resolution: "overlap-delete-already-applied",
        fallback: false,
        result: current,
      };
    }
    const ops = opsFor(peerCurEnd, 0, inserted);
    return {
      ops,
      resolution: "overlap-delete-already-applied",
      fallback: false,
      result: applyTextOps(current, ops),
    };
  }

  if (occurrences > 1) {
    // The anchor cannot be located unambiguously. DO NOT GUESS — fall back to a
    // whole-value replace and report it, so a run that relies on this shows it
    // in the count rather than hiding it in a green.
    const ops = opsFor(0, current.length, next);
    return { ops, resolution: "fallback-replace", fallback: true, result: next };
  }

  const at = peerStart + span.indexOf(deleted);
  const ops = opsFor(at, deleted.length, inserted);
  return {
    ops,
    resolution: "overlap-anchored",
    fallback: false,
    result: applyTextOps(current, ops),
  };
}
