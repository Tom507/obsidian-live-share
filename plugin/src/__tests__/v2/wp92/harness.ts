// WP92 / I11 — shared fixtures for "the key is the document's, not the host's".
//
// WP90's harness is IMPORTED WHOLE and nothing in it is copied or modified.
// WP90 is DONE and its six files must keep passing byte-unmodified; duplicating
// `createStoreIO` here would let the two work packages drift about what "the
// sidecar disk" means, which is the same drift `wp90/harness.ts` refused when it
// imported WP63's instead of forking it.
//
// WHAT THIS FILE ADDS is one thing WP90 had no reason to need: a store file in
// WP90's LANDED on-disk shape, written as a LITERAL. AC2(a) is explicit about
// why — a migration test whose input file is produced by the NEW code migrates
// nothing, and would keep passing after the writer changed again. These bytes
// are what a version-1 build actually left on a user's disk, spelled out, so the
// test still means something in a year.

import type { SeedRefusal } from "../../../files/canvas-sync";

export {
  TYPELESS_NODE,
  VALID_NODE,
  applyRemoteDelta,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  docAsTheRelayWouldHandItBack,
  nodeIdsIn,
  repairedNode,
} from "../wp90/harness";
export type { FakeStoreIO } from "../wp90/harness";

/** A refusal in the exact four-field shape `projectRefusal` admits. */
export function refusal(id: string, kind: "node" | "edge" = "node"): SeedRefusal {
  return {
    boundary: "host-seed",
    kind,
    id,
    reason: "MISSING_TYPE",
  };
}

/**
 * A store file in WP90's LANDED version-1 shape, as a literal.
 *
 * `version: 1` and path-spelled keys — the two facts the migration has to cope
 * with. Written by hand rather than by `SeedRefusalStore` on purpose (AC2(a)).
 */
export function legacyStoreFile(paths: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 1, paths }, null, 2)}\n`;
}

/** The literal a version-1 build wrote for one refused node under a PATH key. */
export function legacyEntry(id: string): Array<Record<string, string>> {
  return [{ boundary: "host-seed", kind: "node", id, reason: "MISSING_TYPE" }];
}

/**
 * Spin the MICROTASK queue until `predicate` holds, or throw.
 *
 * Deliberately not a sleep and deliberately not a timer. S85 is the reason: a
 * fixed sleep used as a settle passes under load because the thing you were
 * waiting for simply has not happened yet, and a load-dependent green never gets
 * investigated. This yields a bounded number of times and FAILS LOUDLY if the
 * condition never arrives, so "it did not happen" is a red rather than a pass.
 */
export async function until(predicate: () => boolean, why: string, ticks = 200): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`WP92 harness: ${why} (not reached in ${ticks} microtasks)`);
}

/** Yield `ticks` times, so anything already queued has had its chance to run. */
export async function settleMicrotasks(ticks = 50): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

/**
 * A promise plus its resolvers — the instrument AC4 needs.
 *
 * The alternative is a sleep, and a sleep is what turns an ordering assertion
 * into S85's shape: under load the thing you were waiting for simply has not
 * happened yet and the assertion passes on an empty world.
 */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
