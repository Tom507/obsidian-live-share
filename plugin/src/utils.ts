import { Platform, TFile, TFolder, type Vault } from "obsidian";

import { isSidecarPath } from "./files/canvas-sidecar";
import {
  ENSURE_FOLDER_OUTCOMES,
  type PathOutcomeLogger,
  notePathOutcome,
} from "./files/path-outcome";
import { pairRenamesByIdentity } from "./files/rename-identity";

export const VAULT_EVENT_SETTLE_MS = 250;

const WIN_CHAR_MAP: [string, string][] = [
  ["?", "\uFF1F"],
  ["*", "\u204E"],
  ["<", "\uFF1C"],
  [">", "\uFF1E"],
  ['"', "\uFF02"],
  ["|", "\uFF5C"],
  [":", "\uFF1A"],
];

const ASCII_TO_FULLWIDTH = new Map(WIN_CHAR_MAP.map(([a, f]) => [a, f]));
const FULLWIDTH_TO_ASCII = new Map(WIN_CHAR_MAP.map(([a, f]) => [f, a]));

const FULLWIDTH_RE = new RegExp(`[${WIN_CHAR_MAP.map(([, f]) => f).join("")}]`, "g");
const ASCII_RE = new RegExp(
  `[${WIN_CHAR_MAP.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}]`,
  "g",
);

export function toLocalPath(canonicalPath: string): string {
  if (!Platform.isWin) return canonicalPath;
  return canonicalPath.replace(ASCII_RE, (ch) => ASCII_TO_FULLWIDTH.get(ch) ?? ch);
}

export function toCanonicalPath(localPath: string): string {
  if (!Platform.isWin) return localPath;
  return localPath.replace(FULLWIDTH_RE, (ch) => FULLWIDTH_TO_ASCII.get(ch) ?? ch);
}

export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Rejects paths that could escape the vault root. A path is safe only when it
 * is relative (no leading "/" or "\") and contains no "." or ".." segments.
 * Used as the single source of truth for validating any peer-supplied path
 * before it is written to disk.
 */
export function isPathSafe(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  const segments = path.split(/[\\/]/);
  return !segments.some((segment) => segment === ".." || segment === ".");
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n|\r/g, "\n");
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function applyMinimalYTextUpdate(
  doc: { transact: (fn: () => void) => void },
  text: {
    toString: () => string;
    delete: (pos: number, len: number) => void;
    insert: (pos: number, s: string) => void;
    length: number;
  },
  newContent: string,
): void {
  const oldContent = text.toString();
  if (oldContent === newContent) return;

  let prefix = 0;
  const minLen = Math.min(oldContent.length, newContent.length);
  while (prefix < minLen && oldContent[prefix] === newContent[prefix]) prefix++;

  let oldSuffix = oldContent.length;
  let newSuffix = newContent.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldContent[oldSuffix - 1] === newContent[newSuffix - 1]
  ) {
    oldSuffix--;
    newSuffix--;
  }

  // Snap the diff boundaries off surrogate pairs so delete/insert never cut
  // between a high (\uD800-\uDBFF) and low (\uDC00-\uDFFF) surrogate. If the
  // prefix landed right after a *matched* high surrogate, its low-surrogate
  // partner differs (otherwise prefix would have advanced past it) -> the pair
  // is being split, so back the boundary off the whole code point.
  while (prefix > 0 && isHighSurrogate(oldContent.charCodeAt(prefix - 1))) {
    prefix--;
  }
  // If the retained suffix would start on a lone low surrogate, its matched
  // high-surrogate partner is inside the delete region -> extend the boundary
  // to keep the whole code point together.
  while (
    oldSuffix < oldContent.length &&
    isLowSurrogate(oldContent.charCodeAt(oldSuffix)) &&
    oldSuffix > prefix
  ) {
    oldSuffix++;
    newSuffix++;
  }

  doc.transact(() => {
    if (oldSuffix > prefix) text.delete(prefix, oldSuffix - prefix);
    if (newSuffix > prefix) text.insert(prefix, newContent.slice(prefix, newSuffix));
  });
}

export function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

export async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hashContent(content: string): Promise<string> {
  return hashBuffer(new TextEncoder().encode(content).buffer);
}

/**
 * S159 — the map-only view of `pairRenamesByIdentity`, which lives in the pure,
 * zero-import `files/rename-identity.ts` so that `manifest-removal-decision.ts`
 * can share its accepted-basis list without importing this module (this one
 * imports `obsidian` on line 1).
 *
 * THE SIGNATURE IS UNCHANGED AND THE MEANING IS NOT. A key present in this map
 * now asserts IDENTITY — a digest unique on both sides of the event, or a
 * filename that survives inside an ambiguous digest class — where before it
 * asserted only that two paths carried equal bytes. `hash("")` is a full digest
 * like any other, so equal bytes made two empty notes, and any two identical
 * notes, interchangeable to the old loop, which broke the tie by iteration
 * order and then handed the answer to `vault.rename`.
 *
 * Callers that want to know WHY a key was or was not paired — and every refusal
 * is recorded, S155 — should call `pairRenamesByIdentity` directly.
 */
export function matchRenamesByHash(
  removed: string[],
  added: string[],
  removedHashOf: (path: string) => string | undefined,
  addedHashOf: (path: string) => string | undefined,
): Map<string, string> {
  return pairRenamesByIdentity(removed, added, removedHashOf, addedHashOf).pairs;
}

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "json",
  "css",
  "js",
  "ts",
  "jsx",
  "tsx",
  "html",
  "xml",
  "yaml",
  "yml",
  "csv",
  "svg",
  "tex",
  "latex",
  "bib",
  "org",
  "rst",
  "adoc",
  "canvas",
  "mermaid",
  "graphql",
  "toml",
  "ini",
  "cfg",
  "conf",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "scala",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "swift",
  "r",
  "lua",
  "sql",
  "scss",
  "sass",
  "less",
  "styl",
  "vue",
  "svelte",
]);

export function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * WP6 / US5 AC1+AC2 and WP26 AC1/AC3/AC4 — the ONE skip for every automatic
 * raw-text sync path. Two disjoint clauses, one predicate, one definition.
 *
 * CLAUSE 1 — `.canvas` (WP6 / US5). Lives here, beside `isTextFile`, because it
 * is the exception to it: `"canvas"` IS in `TEXT_EXTENSIONS` (a canvas is JSON
 * text on disk) but a `.canvas` is owned by `CanvasSync`, which syncs it as a
 * structured nodes/edges document.
 *
 * Without this skip a shared canvas ALSO gets a raw-`Y.Text` document of the
 * same bytes — a second CRDT for a path `CanvasSync` already owns, whose
 * character-level merge destroys edge endpoints.
 *
 * CLAUSE 2 — the sidecar state directory (WP26). Everything under it is LOCAL
 * REPLICA STATE (per-doc update history, checkpoints, the guid index) and must
 * never become shared content. The membership test is `isSidecarPath` from
 * `files/canvas-sidecar.ts`, which WP24 owns; this module IMPORTS it and never
 * re-spells the directory, never writes its own prefix or suffix test and never
 * adds a second constant. It is a DIRECTORY test, not an extension test, so a
 * future sidecar file type is covered without touching this line.
 *
 * The two clauses are disjoint — no `.canvas` path is a sidecar path — so
 * neither one widens or narrows the other, and the `.canvas` behaviour is
 * exactly what it was before clause 2 existed (WP26 AC4).
 *
 * PRODUCTION CALL SITES OF THIS PREDICATE (WP83 AC2). The block below
 * enumerates every call to `skipsAutoTextSync` in `plugin/src/`, other than this
 * definition, as `<module>  <function>`. That is a claim about THE TREE, and
 * WP83 AC2's coherence derivation walks the tree and fails when the two
 * disagree. The block is delimited by the two `==== ... BLOCK` rules below
 * because that derivation reads it: the delimiters are load-bearing, not
 * decoration, and a row moved outside them stops being checked. (The test is
 * named by ROLE and not by filename, on the same rule as the reasoning further
 * down: every `.ts` name in this comment is a row of an enumeration block.)
 *
 * It is deliberately NOT the claim this heading used to make — "every caller
 * that would AUTOMATICALLY install or consume a bare-path `Y.Text` must consult
 * this predicate". That was a claim about the world written in the grammar of a
 * list. No test can hold it, it was quoted by several work packages as an
 * authoritative map, and it was already one row stale on the day it was quoted:
 * `background-sync.ts setActiveFile` has been a guarded consumer, with a test
 * naming it, since WP27 — and the list did not have it.
 *
 * ==== CALL-SITE BLOCK — derived from the tree, a test holds it ==============
 *   files/background-sync.ts  startAll  ..... manifest replay
 *                             registerAnnounced S147's phase 1 — the batch of
 *                                             announced paths whose documents
 *                                             are created BEFORE any one of
 *                                             them is settled. It reaches
 *                                             `getDoc` directly, so it needs
 *                                             this guard itself and does not
 *                                             inherit `subscribe()`'s
 *                             setActiveFile . the de-activation flush (WP27
 *                                             AC4), guarding the bare-path
 *                                             `getDoc` on the OUTGOING file
 *                             onFileAdded ... vault create
 *                             onFileRenamed . vault rename INTO a .canvas or
 *                                             into the sidecar directory
 *   files/manifest.ts         syncFromManifest text branch — join / resume /
 *                             reconnect / reload-from-host
 *   editor/collab.ts          activateForFile the editor binding (WP27 AC4),
 *                             guarding the bare-path `getDoc` that would seed
 *                             the whole document into a raw `Y.Text` and
 *                             install a character-level binding over it
 *   files/file-ops.ts         onFileCreate .. the file-op CONTENT push (WP83
 *                                             AC1) — see the note below
 * ==== END CALL-SITE BLOCK ==================================================
 *
 * THIS COMMENT IS NOT A DOOR CENSUS, and no enumeration of this predicate's
 * callers can ever be one. A derivation over CONSUMERS finds only sites that
 * already consult the predicate; a door is by definition a site that does not.
 * The block above is a coherence check between the comment and the tree, and it
 * buys exactly that and nothing more.
 *
 * So, explicitly NON-EXHAUSTIVE and not derivable from anything: the mechanisms
 * OTHER than a bare-path `Y.Text` by which a `.canvas` has been observed to
 * reach a peer. It exists so the next reader is not misled into treating the
 * block above as a complete map of the ways a canvas travels:
 *
 *   files/file-ops.ts  onFileCreate  the file-op CONTENT channel. The whole file
 *                                    as `{type:"create", path, content}`,
 *                                    applied by the receiver with `vault.modify`
 *                                    / `vault.create` under a path mute — a raw,
 *                                    unmerged, last-writer-wins overwrite of a
 *                                    path `CanvasSync` owns, invisible to the
 *                                    doc. Guarded by this predicate since WP83;
 *                                    listed here because closing one door is not
 *                                    evidence that there is no other.
 *
 * If you need to know how a `.canvas` can travel, measure the tree. Do not read
 * this comment and conclude.
 *
 * The predicate is shared rather than copied per module deliberately: four
 * private copies of `path.endsWith(".canvas")` is exactly how this defect class
 * propagated (a guard added at one of N call sites).
 *
 * WP26's exclusion additionally has SIX seams this predicate must NOT serve,
 * because at each of them a `.canvas` has to keep passing. They call
 * `isSidecarPath` directly. (Four came from WP26; the last two are WP68's two
 * ends of the file-operation channel.)
 *
 * The CONSUMER LIST is the indented block below, and it is exhaustive in both
 * directions: every production call site of `isSidecarPath`, other than this
 * predicate itself and its owning module `files/canvas-sidecar.ts`, appears as a
 * row; and every row is a real call site. Each row is `<module>  <function>`.
 *
 * Every `.ts` name appearing ANYWHERE in this comment is therefore a row of one
 * of the two enumeration blocks — this one and the callers-of-this-predicate
 * block above — or that owning module, or this file. Other components are
 * referred to by ROLE rather than by filename — deliberately, so the consumer
 * set can be read off mechanically without disambiguating prose. Do not
 * "helpfully" restore a filename to the reasoning below: a bare filename here is
 * exactly the ambiguity that let this defect recur twice, with two different
 * modules (WP26 AC3):
 *
 *   files/background-sync.ts  handleLocalTextModify
 *   files/manifest.ts         syncFromManifest
 *   files/manifest.ts         isSharedPath
 *   files/manifest.ts         renameFile
 *   files/file-ops.ts         onFileRename
 *   sync/control-handlers.ts  registerControlHandlers
 *
 * Why each of the six, and why it takes the sidecar predicate alone rather than
 * this one:
 *
 *   handleLocalTextModify  AC2's "modifying" verb. Guarding it with THIS
 *                          predicate would make the announced R10 text fallback
 *                          read-only for local edits, because the VAULT EVENT
 *                          ROUTER — the module registering the vault `modify`
 *                          handler — deliberately routes a `.canvas` that
 *                          CanvasSync does not own into it, immediately after
 *                          emitting the fallback warning. That router is the
 *                          CALLER of this seam and consults neither predicate
 *                          itself, so it is named by role, not by filename.
 *   syncFromManifest       Guarded at the TOP of the entry loop, ahead of the
 *                          directory and binary branches, which the `.canvas`
 *                          skip further down never reaches.
 *   isSharedPath           The manifest MEMBERSHIP gate — a second and wholly
 *                          independent gate, which must keep admitting ordinary
 *                          `.canvas` files.
 *   renameFile             The one manifest WRITER that does not consult
 *                          `isSharedPath`; it re-keys an entry directly, so the
 *                          membership gate cannot constrain it. Destination side
 *                          only.
 *   onFileRename           WP68, the OUTBOUND file-op boundary. It carries no
 *                          content, so THIS predicate is the wrong one twice
 *                          over: an ordinary `.canvas` must still be renamed
 *                          across the link. Both endpoints, because a rename out
 *                          of the sidecar directory names a file every peer
 *                          holds. Refuses the emit and nothing else — no vault
 *                          call, no queue slot, no mute.
 *   registerControlHandlers  WP68, the INBOUND file-op admission gate, in the
 *                          `rename` branch. The rename branch is the only one
 *                          admitted on `.some(isSharedPath)` rather than on the
 *                          strict all-paths form, so a sidecar endpoint rode in
 *                          on its shared partner. Refuses before the op reaches
 *                          the vault at all.
 *
 * Readers are constrained by `isSharedPath`; writers are not, unless they ask it.
 * `publishManifest` (via `getSharedFiles`), `updateFile` and `addFolder` all ask
 * and so need no guard of their own; `renameFile` does not ask and therefore has
 * one. The remaining manifest mutations are deletions and cannot admit a path.
 *
 * `BackgroundSync.subscribe()` is the ONE place that does NOT consult it: it is
 * the explicit door of the announced R10 text fallback (BUILD_SPEC § 6.1
 * TEXT-OWNED), entered only by `subscribeCanvasWithHandover` after a
 * `CanvasSync` subscribe genuinely FAILED — i.e. precisely when `CanvasSync`
 * does not own the path. That keeps the fallback exclusive, never concurrent.
 * WP26 leaves that door open on purpose (closing it is WP33's); it is made
 * unreachable for a sidecar path by the guards on its callers instead.
 */
export function skipsAutoTextSync(path: string): boolean {
  return path.endsWith(".canvas") || isSidecarPath(path);
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface JwtPayload {
  sub: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

export function parseJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(atob(b64));
  if (!payload.sub || !payload.username) throw new Error("Invalid JWT payload");
  return payload as JwtPayload;
}

export function getFileByPath(vault: Vault, path: string): TFile | null {
  const file = vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

/**
 * S144 — CREATE THE FOLDER, AND SAY WHAT HAPPENED.
 *
 * THE DEFECT, and it is small in code and large in diagnosis: this function
 * caught every `createFolder` error and discarded it. The `catch` was written
 * for ONE case — a concurrent create, where the folder exists a moment later and
 * the throw means nothing — and it silently absorbed every other case with it: a
 * permission error, a full disk, a name that collides with a FILE, an adapter
 * that is gone. The caller then failed at whatever it wanted the folder for, and
 * the user was told THAT operation had failed. A folder that could not be
 * created is reported as a **rename** failure.
 *
 * That is the same misattribution `S112`/`S138` criticised the rig for, in the
 * product, and it sits directly on the path `WP110` just repaired — which is
 * where the next diagnosis will happen.
 *
 * WHAT CHANGED AND WHAT DID NOT (B3). The caller's behaviour is BYTE-IDENTICAL:
 * this still returns `void`, still never throws, and every call site is
 * unaltered. Making the failure LEGIBLE is the whole package. Whether a caller
 * *should* abort on a folder failure is a separate question, and one this
 * package deliberately does not answer — see the report.
 *
 * HOW THE TWO CASES ARE TOLD APART, and it is positive evidence rather than
 * an error-string test (`I11`'s discipline, applied to a diagnosis): after a
 * throw, ask the vault whether the folder is there NOW. If it is, something else
 * created it and the throw was the benign race the `catch` was written for. If
 * it is not, the folder genuinely does not exist and the caller is about to
 * fail. No error message is parsed, so no adapter's phrasing is depended on.
 *
 * ONE OUTCOME PER CALL, not per segment: the caller asked for one folder to
 * exist. When segments disagree the WORST is reported, because a call that
 * created two segments and failed on the third is a FAILED call.
 *
 * The `logger` is a PARAMETER and optional — `S104`, and it keeps all eleven
 * existing call sites compiling unchanged while the two on the file-op path can
 * pass the real sink.
 */
export async function ensureFolder(
  vault: Vault,
  path: string,
  logger?: PathOutcomeLogger | null,
): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) {
    notePathOutcome(
      { arm: "ensure-folder", outcome: ENSURE_FOLDER_OUTCOMES.ALREADY_A_FOLDER, path },
      logger,
    );
    return;
  }
  const parts = path.split("/");
  let current = "";
  let created = 0;
  let raced: string | null = null;
  let failed: { segment: string; detail: string } | null = null;
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = vault.getAbstractFileByPath(current);
    if (!folder) {
      try {
        await vault.createFolder(current);
        created++;
      } catch (err) {
        // Folder may already exist from a concurrent create — ASK, rather than
        // assume, which is the entire repair.
        const message = err instanceof Error ? err.message : String(err);
        if (vault.getAbstractFileByPath(current)) {
          raced = current;
        } else {
          failed = { segment: current, detail: message };
        }
      }
    }
  }

  // S155 — EVERY branch reports, including the two that did nothing wrong.
  // A ledger in which only failures increment cannot distinguish "no folder
  // ever failed" from "this function was never called", and the second is
  // exactly what a reader concludes from a row of zeros.
  if (failed) {
    notePathOutcome(
      {
        arm: "ensure-folder",
        outcome: ENSURE_FOLDER_OUTCOMES.CREATE_FAILED,
        // The FOLDER path, which is the fact the caller's own failure message
        // does not contain and the reason this line exists.
        path: failed.segment,
        detail: `requested=${path} error=${failed.detail}`,
      },
      logger,
    );
    return;
  }
  if (raced) {
    notePathOutcome(
      {
        arm: "ensure-folder",
        outcome: ENSURE_FOLDER_OUTCOMES.CREATE_RACED,
        path: raced,
        detail: `requested=${path}`,
      },
      logger,
    );
    return;
  }
  notePathOutcome(
    {
      arm: "ensure-folder",
      outcome:
        created > 0
          ? ENSURE_FOLDER_OUTCOMES.CREATED
          : ENSURE_FOLDER_OUTCOMES.NOTHING_TO_CREATE,
      path,
    },
    logger,
  );
}
