import { Platform, TFile, TFolder, type Vault } from "obsidian";

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
 * Pairs concurrently-removed manifest paths to concurrently-added ones by
 * matching content hash, so `removed=[A,C], added=[D,B]` renames A→B and C→D
 * (content identity) instead of A→D (iteration order). Returns a map of
 * oldPath -> newPath for the confident, hash-matched renames only; callers fall
 * back to positional pairing for anything left unmatched.
 */
export function matchRenamesByHash(
  removed: string[],
  added: string[],
  removedHashOf: (path: string) => string | undefined,
  addedHashOf: (path: string) => string | undefined,
): Map<string, string> {
  const pairs = new Map<string, string>();
  const usedNew = new Set<string>();
  for (const oldPath of removed) {
    const oldHash = removedHashOf(oldPath);
    if (!oldHash) continue;
    for (const newPath of added) {
      if (usedNew.has(newPath)) continue;
      if (addedHashOf(newPath) === oldHash) {
        pairs.set(oldPath, newPath);
        usedNew.add(newPath);
        break;
      }
    }
  }
  return pairs;
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
 * WP6 / US5 AC1+AC2 — the ONE `.canvas` skip for every automatic raw-text sync
 * path. Lives here, beside `isTextFile`, because it is the exception to it:
 * `"canvas"` IS in `TEXT_EXTENSIONS` (a canvas is JSON text on disk) but a
 * `.canvas` is owned by `CanvasSync`, which syncs it as a structured
 * nodes/edges document.
 *
 * Without this skip a shared canvas ALSO gets a raw-`Y.Text` document of the
 * same bytes — a second CRDT for a path `CanvasSync` already owns, whose
 * character-level merge destroys edge endpoints.
 *
 * Every caller that would AUTOMATICALLY install or consume a bare-path
 * `Y.Text` must consult this predicate:
 *
 *   files/background-sync.ts  startAll  ..... manifest replay
 *                             onFileAdded ... vault create
 *                             onFileRenamed . vault rename INTO a .canvas
 *   files/manifest.ts         syncFromManifest text branch — join / resume /
 *                             reconnect / reload-from-host
 *
 * The predicate is shared rather than copied per module deliberately: four
 * private copies of `path.endsWith(".canvas")` is exactly how this defect class
 * propagated (a guard added at one of N call sites).
 *
 * `BackgroundSync.subscribe()` is the ONE place that does NOT consult it: it is
 * the explicit door of the announced R10 text fallback (BUILD_SPEC § 6.1
 * TEXT-OWNED), entered only by `subscribeCanvasWithHandover` after a
 * `CanvasSync` subscribe genuinely FAILED — i.e. precisely when `CanvasSync`
 * does not own the path. That keeps the fallback exclusive, never concurrent.
 */
export function skipsAutoTextSync(path: string): boolean {
  return path.endsWith(".canvas");
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

export async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = vault.getAbstractFileByPath(current);
    if (!folder) {
      try {
        await vault.createFolder(current);
      } catch {
        // Folder may already exist from a concurrent create
      }
    }
  }
}
