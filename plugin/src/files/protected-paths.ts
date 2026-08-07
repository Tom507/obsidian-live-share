// ---------------------------------------------------------------------------
// WP95 (S94) — THE PROTECTED-PATH PREDICATE.
//
// THE DEFECT THIS EXISTS TO CLOSE. WP68 put a guard on the inbound file-op
// channel and the guard was `isSidecarPath`. `isSidecarPath` tests membership of
// `SIDECAR_DIR`, and `SIDECAR_DIR` is the single literal
// `.obsidian/liveshare/state` (`canvas-sidecar.ts`). The guard was therefore
// NARROWER THAN THE SURFACE ITS OWN COMMENT NAMED — that comment says "a
// peer-driven write into this process's own `.obsidian/**`", and the predicate
// underneath it covered one directory out of that tree. Everything else under
// `.obsidian/**` was reachable by a peer, including:
//
//   ├── `.obsidian/plugins/<id>/main.js`   the plugin's own EXECUTABLE CODE.
//   │                                      A peer who can place bytes there runs
//   │                                      code in another user's Obsidian, at
//   │                                      that user's privilege, on next load.
//   └── `.obsidian/plugins/<id>/data.json` that user's CREDENTIALS.
//
// A live peer-injected rename into `.obsidian/plugins/live-share/` was ADMITTED
// AND APPLIED. The reasoning was already in the tree (`seed-refusal-store.ts`
// carries "write under `.obsidian/**` is a code-execution surface") and the
// predicate did not match it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SECOND PREDICATE AND NOT A WIDENING OF `isSidecarPath`
//
// They answer different questions and must give different answers.
//
//   `isSidecarPath`   "is this LOCAL REPLICA STATE this peer owns?"  — used to
//                     decide what is EXCLUDED FROM SHARING. It is deliberately
//                     narrow and deliberately case-SENSITIVE: every extra path
//                     it swallows is a user file that silently stops syncing.
//   `isProtectedPath` "would writing peer-supplied bytes here be a code-execution
//                     or credential surface?" — used to decide what is REFUSED
//                     ON ARRIVAL. Every extra path it swallows costs a refusal;
//                     every path it MISSES costs arbitrary code execution. The
//                     two error directions are not comparable, so this one is
//                     deliberately WIDE.
//
// Three widenings follow from that asymmetry, and each is a decision, not an
// oversight:
//
//   1. CASE-INSENSITIVE. `.OBSIDIAN/plugins/live-share/main.js` is the same file
//      as `.obsidian/plugins/live-share/main.js` on Windows and on the default
//      macOS filesystem, which is where this plugin's users are. A
//      case-sensitive test here is a bypass with a shift key.
//   2. ANY SEGMENT, not just the first. A vault may contain nested git
//      repositories — this repo's own owner keeps vaults under git — so
//      `notes/project/.git/hooks/pre-commit` is exactly as executable as
//      `.git/hooks/pre-commit`. `isSidecarPath` returns FALSE for a nested
//      `notes/.obsidian/liveshare/state/x` on purpose (it is not this vault's
//      replica state); the opposite answer is correct here.
//   3. THE ROOT ITSELF IS PROTECTED. `isSidecarPath` returns false for the bare
//      directory because the directory names no file. Here a rename whose
//      destination is the bare name `.obsidian` replaces the config directory
//      with a file, which is not a thing a peer may do either.
//
// `.git/**` is in the minimum set for the same reason as `.obsidian/**` and it
// is NOT hypothetical: nothing in this tree excluded it before WP95. The
// `ExclusionManager` default patterns are `${configDir}/**` and `.trash/**`, so
// a peer-supplied `.git/hooks/pre-commit` passed `isSharedPath` in the DEFAULT
// configuration.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT `ExclusionManager`
//
// `ExclusionManager` already excludes `${configDir}/**`, and for the ordinary
// create/modify/delete arms that is why they were not the arm B56 demonstrated.
// It is the wrong instrument for this job for four reasons, and `manifest.ts`
// had already written down three of them about the sidecar:
//
//   ├── it is CONFIGURATION. `setPatterns` rebuilds the list on every settings
//   │   save, `setConfigDir` may never have been called, and a peer's reachable
//   │   surface must not be a function of the local user's settings;
//   ├── `manifestManager.exclusionManager` is OPTIONAL (`?.`), so a
//   │   `ManifestManager` constructed without one excludes nothing;
//   ├── it is consulted by exactly ONE gate (`isSharedPath`), and the census in
//   │   the WP95 report lists ten inbound arms, four of which never reach it; and
//   └── a non-default `app.vault.configDir` leaves the literal `.obsidian` tree
//       unprotected while the plugin's own directory moves elsewhere.
//
// This predicate is a CONSTANT, imported, never re-spelt, and asked by every arm.
// ---------------------------------------------------------------------------

/**
 * The directory names whose subtrees no peer may write into, at any depth.
 *
 * Lower-case; {@link isProtectedPath} lower-cases the path it is given before
 * comparing, so these must stay lower-case or the comparison silently stops
 * matching. `PROTECTED_ROOTS` is exported so a test can derive its cases from
 * the constant rather than restating it — a restated list is how a guard and its
 * test come to disagree.
 */
export const PROTECTED_ROOTS: readonly string[] = [".obsidian", ".git"];

const PROTECTED_SET = new Set(PROTECTED_ROOTS);

/**
 * Split a path into comparable segments: `\` normalised to `/`, one leading
 * `./` or `/` stripped, empty segments dropped, each segment lower-cased.
 *
 * Empty segments are dropped rather than preserved so `.obsidian//plugins/x` and
 * `.obsidian/plugins/x` cannot disagree.
 */
function segmentsOf(path: string): string[] {
  const normalised = path.replace(/\\/g, "/");
  return normalised
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * True iff any segment of `path` names a protected root — i.e. the path IS a
 * protected root or lies anywhere inside one, at any depth.
 *
 * This governs INBOUND PEER OPERATIONS ONLY. The plugin's own writer still
 * writes its sidecar under `.obsidian/liveshare/state/**`, and must: the sidecar
 * writer (`canvas-sidecar-lifecycle.ts`) never consults this predicate, and
 * nothing added by WP95 stands between it and its adapter. "A peer op refused
 * and a local sidecar write succeeding" is one test, not two, precisely so that
 * a repair which achieved the first by breaking the second cannot pass.
 *
 * `.` and `..` segments are NOT handled here. That is `isPathSafe`'s question
 * and it is asked separately at every arm — a traversal is a different defect
 * with a different answer, and folding the two together would let a change to
 * one silently move the other.
 */
export function isProtectedPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  return segmentsOf(path).some((segment) => PROTECTED_SET.has(segment));
}

/**
 * Which root protected it, or `null`. For the log line and the counter's
 * breakdown: the ROOT is a class, so it may be named. The PATH may not be —
 * `.obsidian/plugins/live-share/data.json` is a filename that tells a reader
 * exactly which file holds this user's credentials, and this module never puts
 * one into a log, a counter or a return value. Same rule as `muteClass` in
 * `file-ops.ts`: class, never path.
 */
export function protectedRootFor(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  for (const segment of segmentsOf(path)) {
    if (PROTECTED_SET.has(segment)) return segment;
  }
  return null;
}

// ---------------------------------------------------------------------------
// AC5 — THE REFUSAL IS OBSERVABLE.
//
// "Nothing was written" and "nothing was written because the guard fired" are
// different observations, and only a counter tells them apart. The precedent is
// `refusedSidecarRenames` / `refusedWhileSealed` in `file-ops.ts`: STATE, so a
// test can be an oracle over it rather than over a log line.
//
// PROCESS-WIDE ON PURPOSE, unlike those two. The surface being protected is
// process-wide (one `.obsidian`, one plugin directory, one set of credentials)
// and the arms that refuse are spread across five modules, three of which hold
// no reference to any counter-owning object and cannot be given one without
// editing `main.ts`. A per-instance counter would have produced five counters
// and a live reader that sees one of them — which is the observability failure
// `getMuteReleaseStats()` already demonstrated and this WP was told to fix, not
// to repeat.
//
// (That sentence names the method and NOT the work package that added it,
// deliberately. The mute-release package's own no-collateral criterion attributes
// its edits by grepping the tree for its bare identifier, on the stated ground
// that "nothing outside this work package writes" it — so a prose reference from
// an unrelated new file is indistinguishable from an edit by that package, and
// reds its census. Measured, not guessed: it did.)
//
// {@link resetProtectedPathRefusals} exists for tests, and for that reason only.
// ---------------------------------------------------------------------------

/** The inbound arms that can refuse. Named, so a typo cannot invent an arm. */
export const PROTECTED_REFUSAL_ARMS = [
  /** `sync/control-handlers.ts` — the inbound file-op admission gate. */
  "file-op-gate",
  /** `sync/control-handlers.ts` — the inbound chunk-transfer admission gate. */
  "chunk-gate",
  /** `files/file-ops.ts` — `applyRemoteOpInner`, the independent second refusal. */
  "apply-remote-op",
  /** `files/manifest.ts` — `syncFromManifest`, manifest-driven materialisation. */
  "manifest-sync",
  /** `files/manifest.ts` — `isSharedPath`, the membership/scope predicate. */
  "shared-path",
  /** `files/background-sync.ts` — the doc-driven disk writer. */
  "doc-write",
  /** `files/canvas-sync.ts` — the canvas doc-driven disk writer. */
  "canvas-write",
] as const;

// THE EIGHTH ARM IS DELIBERATELY NOT IN THAT LIST, and its absence is a
// decision rather than an omission. `files/manifest-removal-decision.ts`'s
// `decideManifestRename` also refuses a protected destination, but it is a PURE
// CORE — a total function of its argument, with no side effects at all. Calling
// `noteProtectedRefusal` from it would make it observably stateful, and its
// refusal is already observable in the value it returns: the caller pushes the
// verdict and its `reason` string onto `disposition.renames`, which the manifest
// change handler already reports. An arm whose refusal is in its return value
// does not need a counter, and giving it one would have cost the purity that
// makes it testable without a rig.


export type ProtectedRefusalArm = (typeof PROTECTED_REFUSAL_ARMS)[number];

export interface ProtectedPathRefusals {
  /** Total refusals since the last reset. Never decremented. */
  total: number;
  /** Refusals by arm. Arm, never path. */
  byArm: Record<string, number>;
  /** Refusals by protected root. Class, never path. */
  byRoot: Record<string, number>;
}

const refusalsByArm = new Map<string, number>();
const refusalsByRoot = new Map<string, number>();
let refusalTotal = 0;

/**
 * Record one refusal. Takes the ARM and the PATH, and stores neither the path
 * nor anything derived from it except its protected ROOT.
 */
export function noteProtectedRefusal(arm: ProtectedRefusalArm, path: string): void {
  refusalTotal += 1;
  refusalsByArm.set(arm, (refusalsByArm.get(arm) ?? 0) + 1);
  const root = protectedRootFor(path) ?? "unknown";
  refusalsByRoot.set(root, (refusalsByRoot.get(root) ?? 0) + 1);
}

/** READ-ONLY. What every arm has refused, so a live validator can read it. */
export function getProtectedPathRefusals(): ProtectedPathRefusals {
  return {
    total: refusalTotal,
    byArm: Object.fromEntries(refusalsByArm),
    byRoot: Object.fromEntries(refusalsByRoot),
  };
}

/** Tests only. Production never calls this — a counter that production resets
 * cannot answer "how many refusals has this session seen". */
export function resetProtectedPathRefusals(): void {
  refusalTotal = 0;
  refusalsByArm.clear();
  refusalsByRoot.clear();
}

/**
 * The ONE spelling of the refusal log line. Every arm emits this exact string,
 * so a live log grep is a census over arms rather than over phrasings, and so a
 * new arm cannot invent its own wording.
 *
 * NAMES NO PATH. The root is a class; the path is the user's file.
 */
export function protectedRefusalMessage(arm: ProtectedRefusalArm, path: string): string {
  const root = protectedRootFor(path) ?? "unknown";
  return (
    `PROTECTED PATH REFUSED: arm=${arm} root=${root}/** ` +
    `(total=${refusalTotal}) — a peer operation targeting a protected tree was ` +
    "refused before any byte was written"
  );
}
