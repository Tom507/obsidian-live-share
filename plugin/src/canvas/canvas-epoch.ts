import * as Y from "yjs";

import { EPOCH_KEY, META_MAP_NAME } from "./canvas-schema";

// ---------------------------------------------------------------------------
// WP28 / P2 — THE EPOCH RULE and the CONFLICT ARCHIVE (C28).
// ---------------------------------------------------------------------------
//
// CONCEPT_V2 Teil 7: `meta.epoch` is monotonic and HOST-INCREMENTED, and it marks
// a deliberate re-seed. When two replicas share a guid but differ in epoch, the
// higher epoch wins COMPLETELY, and the loser ARCHIVES its state as a local
// conflict copy (`<name>.conflict-<date>.canvas`) instead of merging silently or
// losing silently. That is the whole of C28: the W4 divergence class stops being
// "lautlos" and becomes "benannt und archiviert".
//
// ─────────────────────────────────────────────────────────────────────────
// FIVE PROPERTIES, EACH OF WHICH IS A DIFFERENT WAY TO LOSE A BOARD
// ─────────────────────────────────────────────────────────────────────────
//
// 1. NORMALISATION IS NOT COERCION. `Number("9")` is 9, `Number(true)` is 1,
//    `Number("")`, `Number(null)` and `Number([])` are all 0, and `Number(" 3 ")`
//    is 3. A `meta.epoch` cell corrupted into the STRING "9" by a bad writer
//    would, under `Number(...)`, beat every real board it ever met and every
//    peer would archive-and-adopt garbage. An epoch is a non-negative finite
//    INTEGER and nothing else; everything else reads as 0 (which is also WP27's
//    `INITIAL_CANVAS_EPOCH` — deliberately the same fact, spelled here as
//    "an absent cell is epoch 0" rather than exported as a constant).
//
// 2. MONOTONICITY IS A PROPERTY OF THE WRITER. `epoch + 1` over an absent cell
//    is `NaN`, which normalises back to 0 — one corrupt cell would pin a board
//    at epoch 0 forever and no later import could ever win again. {@link
//    nextEpoch} normalises FIRST and is therefore strictly greater for every
//    input, including the corrupt ones.
//
// 3. ARCHIVE BEFORE ADOPT, AND FAIL CLOSED. An implementation that adopts the
//    winner and THEN writes the conflict copy produces a file with the right
//    name, the right date and a valid `.canvas` body — a body that is a COPY OF
//    THE WINNER. Every end-state oracle is green and the only thing gone is the
//    work the archive existed to preserve. So the serialise and the write are
//    sequenced BEFORE the first mutation of the doc, and a rejected write adopts
//    NOTHING: no transaction, no notification, no log line.
//
// 4. "WINS COMPLETELY" IS A SET EQUATION. `Y.applyUpdate` is a UNION and is
//    therefore not an adoption: it converges, it passes SEC, schema, byte
//    equality and the shadow oracle, and it leaves a board carrying two
//    unrelated histories at once. The record containers are REPLACED. Nor are
//    the loser's records tombstoned — a suppressed record is still in the doc,
//    still exportable, and resurfaces the moment the epochs equalise. The
//    archive FILE is where the loser's work is preserved.
//
// 5. EQUAL EPOCHS ARE THE ORDINARY CASE. Two related replicas meeting is what
//    happens thousands of times a day in a live session; the archive path must be
//    completely inert there — no serialise, no write, no notice, no signature,
//    and not one transaction on the doc. Without that half, "archive on every
//    merge" satisfies AC2 perfectly and fills the vault with conflict copies.
//
// ─────────────────────────────────────────────────────────────────────────
// OWNERSHIP AND PLACEMENT (Shared Ownership Contract §1/§2)
// ─────────────────────────────────────────────────────────────────────────
//
// WP28 owns {@link compareEpoch} + {@link EpochVerdict}, {@link conflictCopyPath}
// + the `<name>.conflict-<date>.canvas` format, and {@link
// epochConflictSignature}. WP30 IMPORTS all three and formats no conflict name of
// its own; WP30's `epoch++` goes through {@link bumpEpoch} and nobody writes
// `meta.set(EPOCH_KEY, x + 1)` by hand.
//
// `EPOCH_KEY` is WP27's to DEFINE and WP28's to give MEANING (contract §2). It is
// imported from `canvas-schema.ts`; the string `"epoch"` appears nowhere here.
//
// This module lives in `canvas/` and not in `files/` for the same reason
// `reconcile-plan.ts` does: it is a near-pure core (`yjs` + `canvas-schema`,
// nothing else — no Obsidian, no filesystem, no clock). The `.canvas` projection,
// the vault write, the user notification and the calendar date are all INJECTED
// through {@link EpochConflictEnv}, which is also what makes the archive-before-
// adopt ORDERING observable at all. Putting it in `files/` and importing
// `serializeCanvas` back out of `canvas-sync.ts` would close a runtime cycle —
// the same one WP25 had to defuse with a type-only import.
// ---------------------------------------------------------------------------

/**
 * The record containers an adoption REPLACES.
 *
 * There is no `NODES_MAP_NAME` / `EDGES_MAP_NAME` constant in this codebase —
 * the literals are the established convention (`canvas-sync.ts`,
 * `canvas-sidecar-lifecycle.ts` both spell them inline).
 */
const RECORD_SPACES = ["nodes", "edges"] as const;

/**
 * The tombstone container, which is replaced along with the record spaces.
 *
 * `canvas-sync.ts` OWNS this name as `DELETED_MAP_NAME` (WP19) and it is spelt
 * here rather than imported for exactly one reason: `canvas-sync.ts` imports THIS
 * module on its merge path, so a value import in the other direction closes a
 * runtime cycle — the cycle the charter's §7.0 placement note exists to avoid and
 * that WP25 had to defuse with a type-only import. A type-only import cannot
 * carry a value, and re-homing the constant into `canvas-schema.ts` would move a
 * name away from its owner, which the contract forbids more strongly than it
 * forbids this literal.
 */
const TOMBSTONE_SPACE = "deleted";

/** The one file extension a canvas — and therefore a conflict copy — may carry. */
const CANVAS_EXT = ".canvas";

/**
 * The largest value that can BE an epoch.
 *
 * Not a stylistic bound. Above `Number.MAX_SAFE_INTEGER`, `n + 1 === n`, so
 * {@link nextEpoch}'s "strictly greater for every input" quietly stops being true
 * and a board's epoch freezes forever — every later import silently loses every
 * conflict it enters, with no error anywhere. Restricting the DOMAIN to safe
 * integers is what makes the guarantee total instead of nearly-total; the ceiling
 * itself is then a loud refusal rather than a silent no-op.
 */
const MAX_EPOCH = Number.MAX_SAFE_INTEGER;

/**
 * What a single path COMPONENT may contain — the `date` in a conflict copy name
 * is one of these.
 *
 * Deliberately not a `YYYY-MM-DD` shape test: the property being defended is not
 * "this looks like a date", it is "this cannot move the archive, collide with an
 * unrelated file, or produce a name the user cannot type or find". `env.today()`
 * supplies `YYYY-MM-DD` and satisfies it. Whitespace, separators and control
 * characters are all outside the class; `.` and `..` are rejected separately
 * below, because the class alone admits both.
 */
const SAFE_COMPONENT = /^[A-Za-z0-9._-]+$/;

/** C0 and C7F controls. A NUL truncates a path at the syscall boundary. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** A Windows drive prefix (`C:`), which makes a path absolute on one platform only. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

// ---------------------------------------------------------------------------
// THE ARGUMENT RULE, STATED ONCE AND APPLIED TO EVERY EXPORT
// ---------------------------------------------------------------------------
//
// This module is a LIBRARY. Its callers — `canvas-sync.ts` today, WP30's import
// command tomorrow, and whatever comes after — pass arguments this module did not
// choose, and one of its exports CONSTRUCTS A FILESYSTEM PATH that is then
// written into the user's vault as the ONLY surviving copy of work that is about
// to be overwritten. That makes argument validation a data-integrity property,
// not hygiene.
//
// The rule, applied uniformly below rather than to whichever function last had a
// bug:
//
//   1. EVERY exported function validates the FULL DOMAIN of every parameter,
//      not the values a test happens to supply.
//   2. Validation happens BEFORE the first irreversible action, and for
//      `resolveEpochConflict` that means before the serialise, the write, the
//      notification AND the transaction — not per-step, where a late failure
//      leaves an archive on disk that no outcome object mentions.
//   3. Where a function cannot honour its contract, it THROWS. It never returns
//      a plausible-looking wrong answer, because a plausible wrong answer here is
//      a real file, in the wrong place, containing real work, under a name nobody
//      will look for. `String(undefined)` is the canonical shape of that bug:
//      `undefined.conflict-2026-08-02.canvas` is a perfectly valid filename.
//   4. Anything that NAMES A LOCATION goes through the same two predicates —
//      {@link assertVaultPath} for a path, {@link assertPathComponent} for a
//      single name — so the set of rejected inputs is identical everywhere. A
//      traversal guard on one function with the same class open on the next is a
//      patch, not a defence.
//
// The three failure classes the location predicates exist for:
//
//   ├── ESCAPE — `../../elsewhere/plan.canvas`, `/etc/plan.canvas`,
//   │      `C:/plan.canvas`, a `\` separator, or a `..` smuggled in through the
//   │      DATE (`.` and `..` both match a naive name charset). The archive lands
//   │      outside the board's folder, or outside the vault entirely.
//   ├── COLLISION / SILENT MIS-NAMING — a control character (a NUL truncates the
//   │      path at the syscall boundary, so `a\0b.canvas` becomes `a`), an empty
//   │      segment from `a//b`, a `.` segment from `a/./b`, or a segment with
//   │      leading/trailing whitespace (Windows strips a trailing space, so
//   │      `board /x.canvas` and `board/x.canvas` are the same file there and
//   │      different strings here).
//   └── UNDETECTABLE-BY-THE-CALLER — every one of the above returns a STRING that
//          looks exactly like a valid answer. The caller has no way to tell.

function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/**
 * A parameter that must be a non-blank string. The blank test is deliberate:
 * `" "` is a truthy string and an unusable name.
 */
function assertNonBlankString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string, got ${typeName(value)}`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be blank`);
  }
}

/**
 * A vault-relative path this module is willing to name.
 *
 * Rejects, in order: a non-string, a blank, a control character, a backslash, an
 * absolute path (POSIX or drive-lettered), and any segment that is empty, `.`,
 * `..`, or carries leading/trailing whitespace.
 *
 * Stricter than `utils.isPathSafe` (which checks absoluteness and dot segments
 * only) and deliberately independent of it: `utils.ts` imports Obsidian, and this
 * module may not. Where the two disagree, this one is the tighter of the two, so
 * nothing it accepts is rejected downstream.
 */
function assertVaultPath(value: unknown, label: string): asserts value is string {
  assertNonBlankString(value, label);
  if (CONTROL_CHARS.test(value)) {
    throw new Error(`${label} contains a control character - it would name a different file`);
  }
  if (value.includes("\\")) {
    throw new Error(`${label} contains a backslash - vault paths are "/"-separated`);
  }
  if (value.startsWith("/") || DRIVE_PREFIX.test(value)) {
    throw new Error(`${label} is absolute - a conflict copy lives inside the vault`);
  }
  for (const segment of value.split("/")) {
    if (segment.length === 0) {
      throw new Error(`${label} has an empty path segment`);
    }
    if (segment === "." || segment === "..") {
      throw new Error(`${label} has a "${segment}" segment - it can escape its own folder`);
    }
    if (segment !== segment.trim()) {
      throw new Error(
        `${label} has a segment padded with whitespace ("${segment}") - it names one file here and another on Windows`,
      );
    }
  }
}

/**
 * A single path COMPONENT — no separators at all, and not a dot segment.
 *
 * `.` and `..` both satisfy the name charset, which is exactly why they are
 * rejected explicitly rather than left to the regex.
 */
function assertPathComponent(value: unknown, label: string): asserts value is string {
  assertNonBlankString(value, label);
  if (value === "." || value === "..") {
    throw new Error(`${label} may not be "${value}" - it can escape its own folder`);
  }
  if (!SAFE_COMPONENT.test(value)) {
    throw new Error(
      `${label} may only contain letters, digits, ".", "_" and "-" - anything else can move the archive or make it unfindable`,
    );
  }
}

/** A `.canvas` path. The extension is case-SENSITIVE; Obsidian's view keys on it. */
function assertCanvasPath(value: unknown, label: string): asserts value is string {
  assertVaultPath(value, label);
  if (!value.endsWith(CANVAS_EXT)) {
    throw new Error(
      `${label} is not a ${CANVAS_EXT} path - the archive would not open as a canvas`,
    );
  }
  if (value.length === CANVAS_EXT.length || value.endsWith(`/${CANVAS_EXT}`)) {
    throw new Error(`${label} has no file name before ${CANVAS_EXT}`);
  }
}

/**
 * Duck-typed rather than `instanceof Y.Doc`: a `Y.Doc` from a second copy of Yjs
 * in the module graph fails `instanceof` while working perfectly. What is being
 * defended is `undefined.getMap(...)`, whose message names neither the parameter
 * nor the caller.
 */
function assertYDoc(value: unknown, label: string): asserts value is Y.Doc {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Y.Doc).getMap !== "function" ||
    typeof (value as Y.Doc).transact !== "function"
  ) {
    throw new TypeError(`${label} must be a Y.Doc, got ${typeName(value)}`);
  }
}

/** A parameter that is DECLARED `number` and must actually be one. */
function assertEpochNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number, got ${typeName(value)}`);
  }
}

function assertFunction(value: unknown, label: string): void {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function, got ${typeName(value)}`);
  }
}

/** The three answers the epoch rule can give. Never a boolean, never a number. */
export type EpochVerdict = "local-wins" | "remote-wins" | "equal";

/**
 * The provenance stamped on the adoption transaction, in the style of
 * `CANVAS_MIGRATION_ORIGIN` (`canvas-schema.ts`) and `CANVAS_SEED_ORIGIN`
 * (`canvas-persistence.ts`).
 *
 * A `unique symbol` rather than a string so no peer, no test and no other module
 * can forge it, and so an observer can tell an adoption apart from a peer delta,
 * a seed and a migration.
 */
export const CANVAS_EPOCH_ADOPT_ORIGIN: unique symbol = Symbol("canvas-epoch-adopt-origin");

/**
 * The ONE definition of "this value is an epoch".
 *
 * NEVER `Number(value)` — see property 1 in the header. A non-negative SAFE
 * integer is itself; everything else (`undefined`, `null`, `NaN`, `±Infinity`,
 * negatives, fractions, numeric STRINGS, booleans, objects, arrays, and anything
 * beyond {@link MAX_EPOCH}) is 0, which is also what a doc WP27 has not stamped
 * reads as.
 *
 * `Number.isSafeInteger` rather than `Number.isInteger` is load-bearing and is
 * the difference between a total guarantee and one that holds for the values
 * anybody thought to try. `2 ** 53` IS an integer, so `isInteger` admits it — and
 * at that magnitude `n + 1 === n`, so it would be an epoch nothing could ever
 * exceed. A single corrupt cell holding one would pin the board forever, and the
 * only symptom would be that imports quietly stop winning.
 *
 * This is also a total function on purpose: it is the READ side, and a doc whose
 * cell a peer corrupted must degrade to "unstamped", never throw a subscribe.
 * The loud refusals live on the WRITE side ({@link nextEpoch}) and on the naming
 * side, where a wrong answer is not recoverable.
 */
export function normalizeEpoch(value: unknown): number {
  if (typeof value !== "number") return 0;
  // `isSafeInteger` is already false for NaN, both infinities and every fraction.
  if (!Number.isSafeInteger(value)) return 0;
  if (value <= 0) return 0; // `<=` normalises `-0` to `+0` on the way past.
  return value;
}

/**
 * Reads `meta[EPOCH_KEY]` through {@link normalizeEpoch}. Writes NOTHING, ever —
 * not a default, not a repair, not a stamp.
 *
 * `doc.getMap(META_MAP_NAME)` creates the shared type's local handle when it is
 * absent, which emits no update and opens no transaction (WP8 AC1: `meta` is
 * reached through `getMap`, never assigned).
 */
export function readEpoch(doc: Y.Doc): number {
  assertYDoc(doc, "readEpoch: doc");
  return normalizeEpoch(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY));
}

/**
 * The epoch rule itself. Everything else in this module is downstream of it.
 *
 * Both sides are normalised BEFORE they are compared, so a corrupt cell can
 * never win, and two never-stamped docs answer `"equal"` rather than being
 * incomparable (a bare `a > b` answers `false` in both directions there, which
 * reads as "not higher" on one side and cannot say "equal" at all).
 */
export function compareEpoch(localEpoch: unknown, remoteEpoch: unknown): EpochVerdict {
  const local = normalizeEpoch(localEpoch);
  const remote = normalizeEpoch(remoteEpoch);
  if (local > remote) return "local-wins";
  if (local < remote) return "remote-wins";
  return "equal";
}

/**
 * The next epoch after `current`. Strictly greater than
 * `normalizeEpoch(current)` for EVERY input in the domain, corrupt ones included
 * — a corrupt cell is repaired by the bump instead of freezing the board
 * (property 2).
 *
 * "In the domain" is what {@link MAX_EPOCH} makes true rather than approximately
 * true. `normalizeEpoch` already maps every unsafe magnitude to 0, so the only
 * value that can reach the ceiling is a legitimately-reached `MAX_EPOCH` itself,
 * and there `+ 1` is the identity. Returning it would hand the caller a number
 * that reads back as an epoch NOTHING can beat — the exact silent, permanent
 * failure this function exists to prevent — so it is refused loudly instead.
 * (2^53 host imports is not a reachable state; being unable to distinguish it
 * from a corrupted cell is the reason to say so out loud anyway.)
 */
export function nextEpoch(current: unknown): number {
  const value = normalizeEpoch(current);
  if (value >= MAX_EPOCH) {
    throw new RangeError(
      `nextEpoch: the epoch is already at ${MAX_EPOCH} and cannot be incremented - a higher value would not compare as higher`,
    );
  }
  return value + 1;
}

/**
 * The HOST increment (AC1). ONE transaction, touching `meta` and nothing else,
 * leaving WP27's `guid` / `path` byte-identical. Returns the value it wrote.
 *
 * Single authorship is not incidental here: it is exactly why an epoch can carry
 * an ordering that record content cannot. Two peers bumping concurrently would be
 * a genuine `clientID` tie-break; the host-increment rule exists so that never
 * happens, and "one doc-local write by one author" is the shape that guarantees
 * it.
 */
export function bumpEpoch(doc: Y.Doc): number {
  assertYDoc(doc, "bumpEpoch: doc");
  const meta = doc.getMap<unknown>(META_MAP_NAME);
  // Computed BEFORE the transaction is opened, so the ceiling refusal cannot
  // leave a half-written `meta` behind. Same discipline as WP27's stamp guard.
  const next = nextEpoch(meta.get(EPOCH_KEY));
  doc.transact(() => {
    meta.set(EPOCH_KEY, next);
  });
  return next;
}

/**
 * `<dir>/<name>.conflict-<date>.canvas` — WP28 owns this format and WP30 imports
 * it (contract §1).
 *
 * The extension is REPLACED, never appended: `plan.canvas.conflict-….canvas` is
 * a file the user cannot tell from a backup of a backup, and
 * `plan.canvas.conflict-…` is not a canvas at all, because Obsidian keys the
 * canvas view on the extension. Only the TRAILING `.canvas` is touched, so
 * `plan.canvas.canvas` and a folder called `my.canvas.folder/` both survive —
 * `path.replace(".canvas", …)` replaces the FIRST occurrence and breaks on both.
 * The directory is preserved at every depth: an archive written to the vault root
 * is one the user will not find in the folder they were working in.
 *
 * Throws rather than coercing, on either argument, and rejects the full escape /
 * collision / silent-mis-naming class on BOTH — see the argument rule above. The
 * `date` is validated as a path COMPONENT, not merely as a non-empty string: a
 * date of `..` satisfies every "looks like a name" charset and produces
 * `plan.conflict-...canvas`, and a date carrying a separator relocates the
 * archive outright. Both arrive from `env.today()`, which this module does not
 * own and cannot audit.
 *
 * A silently stringified `undefined` produces `undefined.conflict-….canvas`,
 * which is a real file containing real work under a name nobody will ever look
 * for. That is the shape of every bug in this class: the return value looks
 * exactly like a correct answer.
 */
export function conflictCopyPath(canvasPath: string, date: string): string {
  assertCanvasPath(canvasPath, "conflictCopyPath: path");
  assertPathComponent(date, "conflictCopyPath: date");
  const stem = canvasPath.slice(0, -CANVAS_EXT.length);
  return `${stem}.conflict-${date}${CANVAS_EXT}`;
}

/**
 * AC2's user-facing message. It MUST contain `conflictPath` verbatim.
 *
 * "Live Share: canvas conflict resolved" satisfies every "did we notify?"
 * assertion ever written and leaves the user unable to find their own version —
 * which, from where they are standing, is indistinguishable from having lost the
 * work outright. The user is being told their board was replaced by somebody
 * else's; the only thing that makes that survivable is knowing where their own
 * version went.
 *
 * Refuses anything that is not a real path for the same reason: "archived to
 * undefined" is a notification that fires, reads fluently, satisfies the AC's
 * words, and sends the user looking for a file that does not exist. A notice is
 * only useful if the name in it is one the user can act on, so the argument is
 * held to the same standard as the path itself.
 */
export function epochConflictNotice(conflictPath: string): string {
  assertVaultPath(conflictPath, "epochConflictNotice: conflictPath");
  return `Live Share: this canvas was replaced by a newer version of the board (a higher epoch). Your previous version was archived to ${conflictPath}`;
}

/**
 * AC4 — the DISTINCT signature, carrying BOTH epoch values.
 *
 * A line that records only the winner cannot diagnose the incident afterwards:
 * `(0,9)`, `(3,9)` and `(8,9)` collapse into one sentence, they are three
 * different incidents, and by the time anyone reads the log the doc has already
 * been overwritten. Both numbers are LABELLED so they cannot be read backwards.
 *
 * Shape (`canvas-sync.ts`'s established `<NAME> signature: …` form, and distinct
 * from `INGEST REJECTED` / `QUARANTINE RAISED` / `QUARANTINE LIFTED` so an
 * operator grepping for one class does not find the other):
 *
 * ```text
 * EPOCH CONFLICT signature: <path> local=<n> remote=<m> -> <verdict>, archived to <path>
 * EPOCH CONFLICT signature: <path> local=<n> remote=<m> -> <verdict>, no archive needed
 * ```
 *
 * Throws on an equal pair. An equal merge is not a conflict, and an
 * implementation that logs one on every merge makes the log useless for finding
 * the real ones.
 *
 * Every argument is checked, including `archivedTo`. `undefined` is not `null`,
 * so an `archivedTo` the caller forgot to default would print "archived to
 * undefined" — a line an operator reads as "an archive exists", pointing at a
 * file that does not. `null` remains the ONE way to say "no archive", and it is
 * spelled out rather than inferred from falsiness (`""` would otherwise mean it
 * too, silently).
 */
export function epochConflictSignature(
  canvasPath: string,
  localEpoch: number,
  remoteEpoch: number,
  archivedTo: string | null,
): string {
  assertCanvasPath(canvasPath, "epochConflictSignature: canvasPath");
  assertEpochNumber(localEpoch, "epochConflictSignature: localEpoch");
  assertEpochNumber(remoteEpoch, "epochConflictSignature: remoteEpoch");
  if (archivedTo !== null) {
    assertCanvasPath(archivedTo, "epochConflictSignature: archivedTo");
  }
  const local = normalizeEpoch(localEpoch);
  const remote = normalizeEpoch(remoteEpoch);
  const verdict = compareEpoch(local, remote);
  if (verdict === "equal") {
    throw new Error(
      `epochConflictSignature: epochs are equal (${local}) - an equal merge is not a conflict`,
    );
  }
  const archive = archivedTo === null ? "no archive needed" : `archived to ${archivedTo}`;
  return `EPOCH CONFLICT signature: ${canvasPath} local=${local} remote=${remote} -> ${verdict}, ${archive}`;
}

/**
 * The injected world. Everything impure this WP needs, and nothing else.
 *
 * The injection is not only a purity concern: `writeConflictCopy` being a seam is
 * what makes the archive-BEFORE-adopt ordering observable, and `today()` being a
 * parameter is what makes the conflict-copy format testable without freezing
 * time.
 */
export interface EpochConflictEnv {
  /** The `.canvas` text of the doc as it stands right now. */
  serializeDoc(doc: Y.Doc): string;
  /** Write the archive copy. Resolves only when the bytes are durable. */
  writeConflictCopy(path: string, content: string): Promise<void>;
  notify(message: string): void;
  /** `YYYY-MM-DD`. Injected — this module never reads a clock. */
  today(): string;
  logger?: {
    debug(category: string, message: string): void;
    warn(category: string, message: string): void;
  };
}

export interface EpochConflictOutcome {
  readonly verdict: EpochVerdict;
  readonly localEpoch: number;
  readonly remoteEpoch: number;
  /** The path written, or `null` when nothing was archived. */
  readonly archivedTo: string | null;
  readonly adopted: boolean;
  /** The AC4 signature, or `null` when there was no conflict. */
  readonly signature: string | null;
}

/** The logger category every epoch-conflict line carries. */
const EPOCH_LOG_CATEGORY = "canvas-epoch";

/**
 * Copy one container entry across docs.
 *
 * A `Y.Map` record cannot be handed to another doc by reference — it is already
 * integrated — so it is CLONED, which carries nested shared types (P4 moves node
 * `text` to a `Y.Text` within the same schema major, and this must survive it).
 * A plain value is copied as itself; the `deleted` container holds plain
 * tombstone objects, not shared types.
 */
function copyValue(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.clone() : value;
}

/**
 * REPLACE the loser's containers with the winner's, in ONE transaction.
 *
 * Not `Y.applyUpdate`, which is a union (property 4). Not a tombstone sweep,
 * which leaves the loser's history in the doc. Not N transactions, which makes
 * the doc observable half-done — a board that is half of each history.
 *
 * `meta` receives ONLY the epoch: `guid`, `path` and `schemaVersion` are WP27's
 * and WP8's and do not move when the records do.
 */
function adoptWinner(doc: Y.Doc, winner: Y.Doc, remoteEpoch: number): void {
  doc.transact(() => {
    for (const space of RECORD_SPACES) {
      const target = doc.getMap<unknown>(space);
      const source = winner.getMap<unknown>(space);
      for (const id of [...target.keys()]) target.delete(id);
      for (const [id, record] of source) target.set(id, copyValue(record));
    }
    const targetDeleted = doc.getMap<unknown>(TOMBSTONE_SPACE);
    const sourceDeleted = winner.getMap<unknown>(TOMBSTONE_SPACE);
    for (const id of [...targetDeleted.keys()]) targetDeleted.delete(id);
    for (const [id, entry] of sourceDeleted) targetDeleted.set(id, copyValue(entry));

    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, remoteEpoch);
  }, CANVAS_EPOCH_ADOPT_ORIGIN);
}

/**
 * The whole rule, and THE ORDER BELOW IS THE ACCEPTANCE CRITERION, not a
 * preference:
 *
 * ```text
 * verdict !== "remote-wins"   ← "equal" AND "local-wins"
 *   └── return immediately. NO serialise, NO write, NO notify, NO log, and NOT
 *       ONE transaction on `doc`.
 *
 * verdict === "remote-wins"
 *   ├── 1. content    := env.serializeDoc(doc)              ← the LOSER, pre-adoption
 *   ├── 2. archivedTo := conflictCopyPath(canvasPath, env.today())
 *   ├── 3. await env.writeConflictCopy(archivedTo, content) ← rejects ⇒ propagate and
 *   │                                                         adopt NOTHING
 *   ├── 4. env.notify(epochConflictNotice(archivedTo))
 *   ├── 5. ONE doc.transact(..., CANVAS_EPOCH_ADOPT_ORIGIN)
 *   ├── 6. env.logger?.warn("canvas-epoch", signature)
 *   └── 7. return the outcome
 * ```
 *
 * Steps 1–3 are sequenced before step 5 and are AWAITED, not raced: an archive
 * issued concurrently with the adoption is the same defect as one issued after
 * it, just harder to see. The write rejecting propagates — an archive that is
 * "best effort" is not an archive, it is a delete with a log line.
 *
 * `winner` is READ ONLY. The loser's adoption never mutates the doc it adopted
 * from.
 *
 * EVERY argument is validated up front, on EVERY verdict — including the
 * equal-epoch path that does nothing. Two reasons, and the second is the one that
 * matters:
 *
 *   ├── nothing irreversible may happen before the arguments are known good. A
 *   │   `canvasPath` checked lazily at step 2 is checked AFTER `serializeDoc` has
 *   │   already been called, and an `env` whose `notify` is missing throws at step
 *   │   4 — with the archive already on disk and no outcome object to mention it.
 *   └── validating only on the conflict path means the first time a bad argument
 *       is ever exercised is the first REAL conflict in the field, which is
 *       precisely the moment the mechanism is load-bearing. The ordinary
 *       equal-epoch merge runs thousands of times a day and is where a caller's
 *       mistake should surface.
 */
export async function resolveEpochConflict(args: {
  doc: Y.Doc;
  winner: Y.Doc;
  canvasPath: string;
  env: EpochConflictEnv;
}): Promise<EpochConflictOutcome> {
  if (args === null || typeof args !== "object") {
    throw new TypeError(`resolveEpochConflict: args must be an object, got ${typeName(args)}`);
  }
  const { doc, winner, canvasPath, env } = args;
  assertYDoc(doc, "resolveEpochConflict: doc");
  assertYDoc(winner, "resolveEpochConflict: winner");
  if (doc === winner) {
    // Always "equal", so the no-op is invisible — the caller believes a conflict
    // was evaluated and nothing was wrong. It is a wiring bug, and a silent one.
    throw new Error("resolveEpochConflict: doc and winner are the same document");
  }
  assertCanvasPath(canvasPath, "resolveEpochConflict: canvasPath");
  if (env === null || typeof env !== "object") {
    throw new TypeError(`resolveEpochConflict: env must be an object, got ${typeName(env)}`);
  }
  assertFunction(env.serializeDoc, "resolveEpochConflict: env.serializeDoc");
  assertFunction(env.writeConflictCopy, "resolveEpochConflict: env.writeConflictCopy");
  assertFunction(env.notify, "resolveEpochConflict: env.notify");
  assertFunction(env.today, "resolveEpochConflict: env.today");
  if (env.logger !== undefined && env.logger !== null) {
    assertFunction(env.logger.warn, "resolveEpochConflict: env.logger.warn");
  }

  const localEpoch = readEpoch(doc);
  const remoteEpoch = readEpoch(winner);
  const verdict = compareEpoch(localEpoch, remoteEpoch);

  if (verdict !== "remote-wins") {
    // AC3, and it is the discriminating half of AC2. Two related replicas — or a
    // replica that is AHEAD — are an ordinary merge, and the epoch path is inert:
    // Yjs does the merging and this function touches nothing at all.
    return {
      verdict,
      localEpoch,
      remoteEpoch,
      archivedTo: null,
      adopted: false,
      signature: null,
    };
  }

  const content = env.serializeDoc(doc);
  if (typeof content !== "string") {
    // Checked before the write, not after: `undefined` stringifies happily and
    // would land in the vault as a four-byte "archive" of the user's board.
    throw new TypeError(
      `resolveEpochConflict: env.serializeDoc returned ${typeName(content)}, not the doc's .canvas text`,
    );
  }
  // `conflictCopyPath` validates `env.today()` as a path component, so a bad
  // clock is refused HERE — before the write, while nothing is on disk yet.
  const archivedTo = conflictCopyPath(canvasPath, env.today());
  await env.writeConflictCopy(archivedTo, content);
  env.notify(epochConflictNotice(archivedTo));

  adoptWinner(doc, winner, remoteEpoch);

  const signature = epochConflictSignature(canvasPath, localEpoch, remoteEpoch, archivedTo);
  env.logger?.warn(EPOCH_LOG_CATEGORY, signature);

  return { verdict, localEpoch, remoteEpoch, archivedTo, adopted: true, signature };
}
