// WP23 / AC1 — THE NETWORK MODEL: partitions, delta REORDERING, delta
// DUPLICATION, and a deterministic quiescence with no wall-clock anything.
//
// What is being modelled, and why each piece is there:
//
//   ├── PARTITION — replicas are split into groups for the duration of a
//   │      window; a delta authored in one group does not reach another until
//   │      the window heals. This is what produces genuine concurrency: two
//   │      replicas that never saw each other's write.
//   ├── REORDER — the deltas a replica receives are shuffled. Yjs buffers an
//   │      update whose causal predecessors have not arrived yet, so this
//   │      exercises the pending-struct path rather than the happy one.
//   ├── DUPLICATION — some deltas are delivered twice. Integration must be
//   │      idempotent; a second application that changes state is a bug that a
//   │      once-only harness can never see.
//   └── QUIESCENCE — a full mesh state-vector exchange repeated until every
//          replica holds the same state, INTERLEAVED with a flush of the
//          debounced audit timers, because `CanvasSync`'s quarantine auditor is
//          itself a writer: a settle that stopped at the first equal state
//          vector would assert over a doc that had not finished repairing.
//
// There is no `setTimeout`, no sleep and no new timing constant anywhere here.
// `flushTimers` is injected by the caller (the suite passes vitest's fake-timer
// flush), so the core stays free of the test runner.

import * as Y from "yjs";

import type { FuzzRng } from "./prng";
import { FUZZ_REMOTE_ORIGIN, type FuzzReplica } from "./replica";

/** One window's network split. Every replica appears in exactly one group. */
export type Partition = number[][];

/**
 * Draw a partition of `count` replicas.
 *
 * Weighted towards SPLIT rather than whole, because a whole network is the case
 * every other test in the repo already covers. A group of one is deliberately
 * possible: a replica that writes while completely isolated and rejoins later is
 * the harshest case for the capture path's surface bookkeeping.
 */
export function drawPartition(rng: FuzzRng, count: number): Partition {
  const indices = rng.shuffle([...Array(count).keys()]);
  const groupCount = rng.bool(0.25) ? 1 : rng.between(2, Math.min(3, count));
  const groups: Partition = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < indices.length; i++) {
    groups[i % groupCount].push(indices[i]);
  }
  return groups.filter((group) => group.length > 0);
}

/**
 * Deliver the pending outboxes WITHIN each partition group, reordered and
 * partly duplicated. Outboxes are consumed: what a group did not receive stays
 * unsent until the window's healing catch-up.
 */
export function deliverWithinPartition(
  rng: FuzzRng,
  replicas: readonly FuzzReplica[],
  partition: Partition,
): void {
  for (const group of partition) {
    if (group.length < 2) continue;
    const pending: { from: number; update: Uint8Array }[] = [];
    for (const index of group) {
      for (const item of replicas[index].outbox) {
        pending.push({ from: item.from, update: item.update });
      }
    }
    if (pending.length === 0) continue;

    for (const target of group) {
      const forTarget = pending.filter((item) => item.from !== target);
      if (forTarget.length === 0) continue;
      // DUPLICATION first, so a duplicate can land before its original.
      const withDuplicates = [...forTarget];
      for (const item of forTarget) {
        if (rng.bool(0.25)) withDuplicates.push(item);
      }
      // REORDER.
      for (const item of rng.shuffle(withDuplicates)) {
        Y.applyUpdate(replicas[target].doc, item.update, FUZZ_REMOTE_ORIGIN);
      }
    }
  }
  // Everything a group's members authored has now been offered inside that
  // group; drop it so the healing pass exchanges only what is genuinely missing.
  for (const group of partition) {
    if (group.length < 2) continue;
    for (const index of group) replicas[index].outbox.length = 0;
  }
}

/** Do all replicas hold byte-identical state vectors? */
export function stateVectorsAgree(replicas: readonly FuzzReplica[]): boolean {
  const first = Y.encodeStateVector(replicas[0].doc);
  for (let i = 1; i < replicas.length; i++) {
    const other = Y.encodeStateVector(replicas[i].doc);
    if (other.length !== first.length) return false;
    for (let b = 0; b < first.length; b++) {
      if (first[b] !== other[b]) return false;
    }
  }
  return true;
}

/** One full-mesh catch-up round: every replica sends every peer what it is missing. */
function exchangeOnce(replicas: readonly FuzzReplica[]): boolean {
  let moved = false;
  const vectors = replicas.map((replica) => Y.encodeStateVector(replica.doc));
  const deltas = replicas.map((replica) =>
    vectors.map((vector) => Y.encodeStateAsUpdate(replica.doc, vector)),
  );
  for (let source = 0; source < replicas.length; source++) {
    for (let target = 0; target < replicas.length; target++) {
      if (source === target) continue;
      const delta = deltas[source][target];
      // A 2-byte update is Yjs's "nothing to send" encoding.
      if (delta.length <= 2) continue;
      Y.applyUpdate(replicas[target].doc, delta, FUZZ_REMOTE_ORIGIN);
      moved = true;
    }
  }
  for (const replica of replicas) replica.outbox.length = 0;
  return moved;
}

/**
 * Heal the network and settle everything — deltas AND the debounced auditor —
 * until the run is genuinely at rest.
 *
 * The loop alternates exchange and timer flush because they feed each other: a
 * delivered delta arms an audit, and an audit's repair is itself a delta. It
 * terminates when a flush produces no new local update and every state vector
 * agrees. `maxRounds` is a safety net, not a schedule; hitting it is reported as
 * a failure by the caller rather than silently tolerated.
 */
export function quiesce(
  replicas: readonly FuzzReplica[],
  flushTimers: () => void,
  maxRounds = 24,
): boolean {
  for (let round = 0; round < maxRounds; round++) {
    exchangeOnce(replicas);
    flushTimers();
    let produced = 0;
    for (const replica of replicas) produced += replica.outbox.length;
    if (produced === 0 && stateVectorsAgree(replicas)) return true;
  }
  return stateVectorsAgree(replicas);
}
