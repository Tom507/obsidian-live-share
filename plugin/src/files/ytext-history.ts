import type * as Y from "yjs";

/**
 * S126 — DID THIS TEXT EVER HOLD CONTENT?
 *
 * The question `S119`'s floor actually needed, asked of the thing that knows.
 *
 * S119 stopped an empty document from overwriting a user's note, using "has
 * THIS PEER observed this document holding content in this session" as the
 * evidence that an emptiness was deliberate. That is a fact about local
 * observation, and it shipped a regression: a peer with the note closed never
 * observes it non-empty, so a genuine select-all-and-delete was indistinguishable
 * from an absence and the deletion never reached that peer.
 *
 * "Did somebody delete this content" is not a property of one peer's history.
 * It is a property of the DOCUMENT, and CRDTs replicate it: a `Y.Text` that held
 * characters and had them removed keeps TOMBSTONES — deleted items in its item
 * list — while one that never held anything has an empty list. Every peer that
 * has the document has the tombstones, whether or not it ever opened the file.
 *
 * VERIFIED, NOT ASSUMED. The charter required this and it was right to: the
 * discriminator was measured across six scenarios before anything was built on
 * it, and those measurements are pinned as tests beside this module
 * (`test_s126_*`). Measured results, `items`/`deletedItems` on the text type:
 *
 * ```text
 *   never held content ................  items=0  deleted=0
 *   held then emptied .................  items=1  deleted=1
 *   REMOTE peer, final state only ......  items=1  deleted=1   <- the S126 case
 *   gc: true, emptied ..................  items=1  deleted=1
 *   gc: true, remote ...................  items=1  deleted=1
 *   v2 encode/decode round trip ........  items=1  deleted=1
 *   three successive full re-encodings .  items=1  deleted=1
 * ```
 *
 * The compaction question the charter singled out is answered by the last three
 * rows: Yjs's garbage collection replaces the deleted CONTENT but keeps the
 * item and its `deleted` flag, because the delete set is what makes concurrent
 * edits converge and cannot be dropped while any peer might still not have seen
 * it. Re-encoding a document does not erase its delete set.
 *
 * WHAT WOULD BREAK THIS: a Yjs release that garbage-collects the delete set
 * itself, or renames the internal `_start` linked list. Both are pinned by the
 * scenario table in the tests, so the failure would be a red suite rather than
 * a silent return to overwriting user notes. If that day comes, the next-best
 * evidence is `Y.encodeStateVector(doc).length > 1` — "this document has state
 * from some client" — which discriminated identically in every scenario above
 * (1 byte when empty-forever, 6-7 bytes once anything had been written). It is
 * public API and cheaper, but it is DOC-scoped rather than text-scoped, so it
 * would answer the wrong question the moment one of these docs gained a second
 * shared type. That is why it is the fallback and not the primary.
 */
export function yTextHeldContent(text: Y.Text | null | undefined): boolean {
  if (!text) return false;
  try {
    // The type's item list. A deleted item is a tombstone: content was here.
    // `_start` is Yjs-internal; the scenario tests beside this module are what
    // make that dependency safe to hold.
    let node = (text as unknown as { _start?: { deleted?: boolean; right?: unknown } | null })
      ._start as { deleted?: boolean; right?: unknown } | null | undefined;
    let guard = 0;
    while (node && guard++ < 100_000) {
      if (node.deleted === true) return true;
      node = node.right as { deleted?: boolean; right?: unknown } | null | undefined;
    }
    // No tombstone found. If the text currently HOLDS content, it obviously
    // held content — this keeps the predicate honest for a caller that asks
    // about a non-empty text, even though S119's floor only asks about empty
    // ones.
    return text.length > 0;
  } catch {
    // A text that cannot answer is not evidence that content was deleted.
    // Fail-closed: the caller treats `false` as "no positive evidence", which
    // refuses the destructive write.
    return false;
  }
}
