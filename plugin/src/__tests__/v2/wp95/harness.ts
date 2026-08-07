// WP95 / S94 — shared fixtures for "the guard is narrower than the surface it
// names".
//
// BUILT ON WP68'S RIG ON PURPOSE. `createInboundRig` already drives the REAL
// `registerControlHandlers` over a vault whose every mutation is journalled, and
// re-implementing that here would have produced a second fixture that could
// drift from the one WP68's own suite pins. This module adds exactly what WP68's
// rig does not have — a chunk-channel deliverer and byte digests — and re-exports
// the rest verbatim.
//
// THE ANTI-VACUITY PROPERTY OF THE BORROWED RIG, and the reason it is the right
// one: its fake `isSharedPath` answers `true` for everything except the sidecar
// directory. So for `.obsidian/plugins/live-share/data.json` it answers TRUE —
// the path IS shared as far as that rig is concerned. Nothing in this fixture
// can refuse a protected path except the predicate under test, which means a
// green here cannot be bought by the membership gate, by `ExclusionManager` (not
// present) or by WP68's sidecar guard (does not match). Remove the WP95 guard
// and every case in this suite admits.
//
// PATHS ARE DERIVED FROM `PROTECTED_ROOTS`, never re-spelt. A suite that
// hard-coded `.obsidian` would keep passing after the constant changed, against
// a guard that no longer covered it — the same rule WP68's harness states about
// `SIDECAR_DIR`.

import { createHash } from "node:crypto";

import { PROTECTED_ROOTS } from "../../../files/protected-paths";
import type { FileOp } from "../../../types";
import type { InboundRig, RecordingVault } from "../wp68/harness";

export {
  createInboundRig,
  createOutboundRig,
  createRecordingFileManager,
  createRecordingVault,
  SHARED_NOTE,
  SIDECAR_INDEX,
} from "../wp68/harness";
export type { InboundRig, RecordingVault } from "../wp68/harness";

const OBSIDIAN_ROOT = PROTECTED_ROOTS[0];
const GIT_ROOT = PROTECTED_ROOTS[1];

/**
 * The plugin's own executable code. A peer who can place bytes here runs code in
 * another user's Obsidian on next load — the reason S94 was raised.
 */
export const PLUGIN_CODE = `${OBSIDIAN_ROOT}/plugins/live-share/main.js`;
/**
 * The plugin's own settings file. In a real vault it holds live credentials, so
 * NOTHING in this suite reads, logs or compares its content: every assertion
 * about it is over a SHA-256 of the bytes. The fixture's content below is
 * synthetic and is never a credential.
 */
export const PLUGIN_DATA = `${OBSIDIAN_ROOT}/plugins/live-share/data.json`;
/** A peer-injected git hook — the same class, in a tree nothing excluded. */
export const GIT_HOOK = `${GIT_ROOT}/hooks/pre-commit`;
/** A NESTED repository's hook. A vault may contain git repos below its root. */
export const NESTED_GIT_HOOK = `notes/project/${GIT_ROOT}/hooks/pre-commit`;

/**
 * Synthetic stand-in bytes for the two protected files. Deliberately NOT shaped
 * like a credential and deliberately not read by any assertion — the oracle is
 * the digest, never the value.
 */
export const PLACEHOLDER_BYTES = "PLACEHOLDER-NOT-A-CREDENTIAL";

/** SHA-256 of what the recording vault currently holds at `path`, or `null`. */
export function digestAt(vault: RecordingVault, path: string): string | null {
  const bytes = vault.bytes.get(path);
  if (bytes === undefined) return null;
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deliver one chunk-channel control message, which is a DIFFERENT door from
 * `file-op`: its own `ControlMessage` type, its own `channel.on` registration
 * and, before WP95, its own gate consisting of `isSharedPath` alone.
 */
export function deliverChunk(
  rig: InboundRig,
  type: "file-chunk-start" | "file-chunk-data" | "file-chunk-end" | "file-chunk-resume",
  msg: Record<string, unknown>,
): void {
  rig.channel.deliver(type, { type, ...msg });
}

/**
 * THE CENSUS DENOMINATOR, DERIVED FROM THE TYPE AND CHECKED BY THE COMPILER.
 *
 * `Record<FileOp["type"], FileOp>` is the whole instrument. `FileOp` is a
 * discriminated union of nine members, so this table cannot compile with a
 * member missing — add a tenth op kind to `types.ts` and `tsc` fails here until
 * this table gains a row, at which point the suite that iterates it tests the
 * new kind automatically.
 *
 * THIS IS THE ANSWER TO "HOW DO YOU KNOW THE COUNT IS COMPLETE", and it is
 * deliberately not a grep. `S89` is the precedent: three successive batches
 * grepped a NAME for the mute-release census and undercounted 2 -> 9 -> 10,
 * because a capability passed as a callback has no call site to grep. A census
 * whose completeness is enforced by exhaustiveness checking cannot undercount
 * without failing to build.
 *
 * It covers the FILE-OP CHANNEL only, which is one arm of the wider inbound
 * census. The other arms are reached from different entry points and are pinned
 * individually — a type can enumerate a union's members, it cannot enumerate the
 * ways a module is called.
 */
export function opsTargeting(path: string): Record<FileOp["type"], FileOp> {
  return {
    create: { type: "create", path, content: "peer bytes" },
    modify: { type: "modify", path, content: "peer bytes" },
    delete: { type: "delete", path },
    rename: { type: "rename", oldPath: "notes/ordinary.md", newPath: path },
    "folder-create": { type: "folder-create", path },
    "chunk-start": { type: "chunk-start", path, totalSize: 8, transferId: "t1" },
    "chunk-data": { type: "chunk-data", path, index: 0, data: "AAAAAAAA", transferId: "t1" },
    "chunk-end": { type: "chunk-end", path, transferId: "t1" },
    "chunk-resume": { type: "chunk-resume", path, transferId: "t1", receivedSeqs: [] },
  };
}
