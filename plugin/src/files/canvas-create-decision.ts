// ---------------------------------------------------------------------------
// WP117 (S122) — MAY THE HOST MATERIALISE THIS GUEST-REQUESTED CANVAS? A pure
// core, in the precedent of `files/canvas-mirror-decision.ts` and
// `files/canvas-seed-decision.ts`: ZERO imports. No Obsidian, no filesystem, no
// clock, no Yjs. Everything it needs arrives as an argument.
//
// THE PROBLEM THIS ANSWERS. A `.canvas` created on a GUEST reached nobody and
// entered no client's manifest, not even its own. Three doors refuse it and two
// of them are correct: the manifest add is gated on `role === "host"` (the host
// is the sole manifest writer) and the content push is refused by
// `skipsAutoTextSync` (WP83 — a raw character-merge destroys edge endpoints).
// The third, the guid mint refusing a non-host, is the one that owns the hole:
// with no guid the guest opens no canvas document at all.
//
// THE SANCTIONED REPAIR IS HOST-MEDIATED CREATION. The guest sends the whole
// canvas to the host with a request to materialise it; the host validates,
// creates it in the shared space, mints the guid and seeds the document. Seed
// authority does not move — the host is still the only seeder, still the only
// minter and still the only manifest writer — which is precisely why this shape
// was sanctioned over the content-free variant that lets the originating guest
// seed from its own file.
//
// THIS MODULE IS THE VALIDATION HALF, AND IT IS THE HOST'S. A guest is not
// trusted to name a path: the request carries a path and bytes, and every claim
// in it is re-derived on the host before a single byte is written.
//
// FAIL-CLOSED, AND `=== true` / `!== false` RATHER THAN TRUTHINESS, for the same
// reason `decideCanvasMirror` states it: the verdict that WRITES is the
// dangerous one, so an input that is missing, `undefined`, `null` or not a
// boolean must land on a refusal and never on `materialise`. A probe that could
// not answer whether a path is protected is treated as protected.
//
// ORDER IS PART OF THE CONTRACT and is asserted row by row rather than by
// example:
//
//   1. AUTHORITY   — only the host answers at all.
//   2. SHAPE       — is this even a `.canvas`, and is the name safe?
//   3. PROTECTION  — `.obsidian` / `.git`, refused before membership so the
//                    answer never depends on how the share is configured.
//   4. MEMBERSHIP  — inside the host's shared tree.
//   5. SIZE        — a stated bound, refused before the bytes are parsed.
//   6. CONTENT     — the bytes are a canvas document.
//   7. COLLISION   — the host already holds a file at that path.
//
// Collision is LAST on purpose. It is the only clause whose answer describes the
// host's own disk, and a request that is refused for any of the six reasons
// above must be refused without that answer being derivable from the reply.
// ---------------------------------------------------------------------------

/**
 * The closed set of answers. Every consumer imports these strings rather than
 * re-spelling them, so a receipt, a counter and a test can name the same
 * verdict.
 */
export const CANVAS_CREATE_VERDICT = {
  /** The one verdict that writes. The host creates the file, mints and seeds. */
  MATERIALISE: "materialise",
  /** This client is not the host. It answers nothing and does nothing. */
  NOT_HOST: "refuse-not-host",
  /** The request does not name a `.canvas`. */
  NOT_CANVAS: "refuse-not-canvas",
  /** `isPathSafe` refused: an absolute path, or one containing `..` or `.`. */
  UNSAFE_PATH: "refuse-unsafe-path",
  /** The path is inside a protected tree. */
  PROTECTED_PATH: "refuse-protected-path",
  /** The path is outside the host's shared tree. */
  OUTSIDE_SHARE: "refuse-outside-share",
  /** The payload exceeds the stated transfer bound. */
  TOO_LARGE: "refuse-too-large",
  /** The bytes are not a canvas document this host is willing to seed from. */
  NOT_A_CANVAS_DOCUMENT: "refuse-not-a-canvas-document",
  /**
   * A file already exists at that path on the HOST. Refused rather than
   * overwritten: I11 — a request never destroys. The guest is told, and the
   * user renames.
   */
  ALREADY_EXISTS: "refuse-already-exists",
} as const;

export type CanvasCreateVerdict =
  (typeof CANVAS_CREATE_VERDICT)[keyof typeof CANVAS_CREATE_VERDICT];

/** Every refusal in {@link CANVAS_CREATE_VERDICT}, in decision order. */
export const CANVAS_CREATE_REFUSALS: readonly CanvasCreateVerdict[] = [
  CANVAS_CREATE_VERDICT.NOT_HOST,
  CANVAS_CREATE_VERDICT.NOT_CANVAS,
  CANVAS_CREATE_VERDICT.UNSAFE_PATH,
  CANVAS_CREATE_VERDICT.PROTECTED_PATH,
  CANVAS_CREATE_VERDICT.OUTSIDE_SHARE,
  CANVAS_CREATE_VERDICT.TOO_LARGE,
  CANVAS_CREATE_VERDICT.NOT_A_CANVAS_DOCUMENT,
  CANVAS_CREATE_VERDICT.ALREADY_EXISTS,
];

/**
 * What the HOST measured about one request before deciding.
 *
 * Every field is a measurement the wiring layer takes from the object that owns
 * it — `isPathSafe`, `isProtectedPath`, `ManifestManager.isSharedPath`, the
 * vault adapter, the canvas parser. This module performs none of them and
 * imports none of them; that is what keeps it total and testable without a rig.
 */
export interface CanvasCreateObservation {
  /** This client's session role. Anything other than `"host"` refuses. */
  readonly role: "host" | "guest";
  /** The requested path ends in `.canvas`. */
  readonly canvasPath: boolean;
  /** `isPathSafe(path)` — no absolute prefix, no `..`, no `.` segment. */
  readonly pathSafe: boolean;
  /** `isProtectedPath(path)` — inside `.obsidian` or `.git`. */
  readonly protectedPath: boolean;
  /** `ManifestManager.isSharedPath(path)`, evaluated on the HOST. */
  readonly sharedPath: boolean;
  /** UTF-16 code-unit length of the payload, as the wire will carry it. */
  readonly contentBytes: number;
  /** The bound this host enforces. A non-positive or absent bound refuses. */
  readonly maxBytes: number;
  /** The payload parses as a canvas document with a record set. */
  readonly parsable: boolean;
  /** A file already exists at that path in the HOST's vault. */
  readonly localFileExists: boolean;
}

/** The verdict plus the sentence a refusal is reported to the user with. */
export interface CanvasCreateDecision {
  readonly verdict: CanvasCreateVerdict;
  /** Always populated, in every branch. Never empty, never a bare code. */
  readonly reason: string;
}

function refuse(verdict: CanvasCreateVerdict, reason: string): CanvasCreateDecision {
  return { verdict, reason };
}

/**
 * Pure. No state between calls, does not mutate its argument, never throws on
 * any input — including `null`, `undefined` and a non-object.
 *
 * Returns {@link CANVAS_CREATE_VERDICT.MATERIALISE} only when every clause is
 * satisfied by a value of exactly the right type; every other input, including
 * a missing field, yields a named refusal.
 */
export function decideCanvasCreate(
  observation: CanvasCreateObservation,
): CanvasCreateDecision {
  if (observation === null || typeof observation !== "object") {
    return refuse(
      CANVAS_CREATE_VERDICT.NOT_HOST,
      "the request could not be measured at all, so no client is entitled to act on it",
    );
  }
  const probe = observation as {
    role?: unknown;
    canvasPath?: unknown;
    pathSafe?: unknown;
    protectedPath?: unknown;
    sharedPath?: unknown;
    contentBytes?: unknown;
    maxBytes?: unknown;
    parsable?: unknown;
    localFileExists?: unknown;
  };

  // 1. AUTHORITY. `=== "host"`, so an unknown role does not act. Every peer in
  //    the room receives the request; exactly one of them is entitled to answer
  //    it, and this is the clause that makes that true.
  if (probe.role !== "host") {
    return refuse(
      CANVAS_CREATE_VERDICT.NOT_HOST,
      "only the host materialises a canvas creation request",
    );
  }

  // 2. SHAPE. The selector first, then the safety of the name.
  if (probe.canvasPath !== true) {
    return refuse(
      CANVAS_CREATE_VERDICT.NOT_CANVAS,
      "the request does not name a .canvas file",
    );
  }
  if (probe.pathSafe !== true) {
    return refuse(
      CANVAS_CREATE_VERDICT.UNSAFE_PATH,
      "the requested path is not a safe vault-relative path",
    );
  }

  // 3. PROTECTION, ahead of membership so the refusal never depends on how the
  //    share happens to be configured. This is the same ordering
  //    `sync/control-handlers.ts` uses on the two inbound gates.
  if (probe.protectedPath !== false) {
    return refuse(
      CANVAS_CREATE_VERDICT.PROTECTED_PATH,
      "the requested path is inside a protected tree",
    );
  }

  // 4. MEMBERSHIP.
  if (probe.sharedPath !== true) {
    return refuse(
      CANVAS_CREATE_VERDICT.OUTSIDE_SHARE,
      "the requested path is outside the shared folder",
    );
  }

  // 5. SIZE, before the bytes are parsed: refusing an oversized payload must not
  //    require this host to walk it. An absent or non-positive bound refuses
  //    everything rather than admitting everything.
  const bytes = typeof probe.contentBytes === "number" ? probe.contentBytes : Number.NaN;
  const max = typeof probe.maxBytes === "number" ? probe.maxBytes : Number.NaN;
  if (!Number.isFinite(bytes) || !Number.isFinite(max) || max <= 0 || bytes > max) {
    return refuse(
      CANVAS_CREATE_VERDICT.TOO_LARGE,
      "the canvas is larger than a single control-channel transfer carries",
    );
  }

  // 6. CONTENT.
  if (probe.parsable !== true) {
    return refuse(
      CANVAS_CREATE_VERDICT.NOT_A_CANVAS_DOCUMENT,
      "the payload is not a readable canvas document",
    );
  }

  // 7. COLLISION, last. See the header: this is the only clause whose answer
  //    describes the host's own disk.
  if (probe.localFileExists !== false) {
    return refuse(
      CANVAS_CREATE_VERDICT.ALREADY_EXISTS,
      "a file already exists at that path on the host and is never overwritten",
    );
  }

  return {
    verdict: CANVAS_CREATE_VERDICT.MATERIALISE,
    reason: "validated: safe, shared, unprotected, within the size bound and readable",
  };
}
