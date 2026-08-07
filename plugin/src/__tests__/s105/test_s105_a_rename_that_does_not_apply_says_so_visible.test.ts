// S105 — AN INBOUND RENAME THAT DOES NOT APPLY SAYS SO.
//
// THE OBSERVATION. W4 live-reproduced this twice, on an ORDINARY shared path:
// source present, destination free, 60 s settle, `delivered=true`,
// `refusals+0` — and afterwards the source is still there and the destination
// was never created. Not a protected-path refusal: the op arrives and does
// nothing.
//
// WHY TWO LIVE REPRODUCTIONS PRODUCED NO DIAGNOSIS, which is the actual finding
// here. Between the control socket and the bytes there are FOUR ways an inbound
// rename can fail to apply, and until this commit EVERY ONE OF THEM WAS SILENT:
//
//   1. `control-handlers.ts` — `if (!paths.some(isSharedPath)) return;`
//      A bare `return`. The two refusals above it (sidecar, protected) both log
//      and both bump a counter; this one, the only one an ORDINARY path can
//      take, says nothing and counts nothing.
//   2. `file-ops.ts` rename arm — neither endpoint resolves, so all three
//      branches are skipped and control falls out of a bare `break`.
//   3. `file-ops.ts` rename arm — `vault.rename` throws and is re-thrown.
//   4. `file-ops.ts` — the outer `catch` around the whole apply switch, which
//      swallows (3) and every other throw.
//
// (4) IS THE ONE THAT MATTERS, AND IT IS WORSE THAN SILENT. It is
//
//     } catch {
//       const opPath = "path" in op ? op.path : "unknown";
//       new Notice(`Live Share: failed to apply ${op.type} for ${opPath}`);
//     }
//
// which has three separate defects for this signal:
//   - it writes NOTHING to the logger, only a transient toast;
//   - `"path" in op` is FALSE for a rename — a rename carries `oldPath` and
//     `newPath` — so the one report that does exist names the file `"unknown"`;
//   - by SWALLOWING, it resolves `applyRemoteOp` successfully, which makes
//     `control-handlers.ts`'s
//         .catch((err) => plugin.logger.error("file-op", "failed to apply
//          remote file-op", err))
//     UNREACHABLE for every throw raised inside the switch. That handler is the
//     project's only error channel for an inbound op, and it is dead code for
//     the entire class of failures it was written for.
//
// This is the same shape as S104 and it is why S105 has resisted diagnosis: the
// instrument was not weak, it was absent. These rows do not guess which of the
// four branches fires live — that is not decidable from here, and guessing is
// what this run keeps paying for. They make each branch NAME ITSELF, so the
// next live reproduction is decisive instead of being another adjacency.
//
// WHY THIS COULD NOT HAVE BEEN WRITTEN BEFORE TODAY: `FileOpsManager`'s logger
// was `undefined` in every real session (S104, fixed earlier in this batch). A
// line added here would have been emitted into the same dead channel.
//
// WHAT WOULD MAKE EACH ROW FAIL:
//   T1  a rename whose apply THROWS stops reaching the logger, or stops naming
//       both endpoints. RED before the repair.
//   T2  a rename that resolves NEITHER endpoint stops reaching the logger.
//       RED before the repair.
//   T3  ANTI-VACUITY. An ordinary rename that DOES apply starts emitting one of
//       the two lines above. If this row ever reddens, T1/T2 are measuring a
//       logger that simply always speaks, and are worth nothing.
//   T4  the outer catch goes back to naming an op by `"path"` alone, i.e.
//       reports `"unknown"` for any op that carries `oldPath`/`newPath`.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileOpsManager } from "../../files/file-ops";
import type { FileOp } from "../../types";
import { stripComments } from "../v2/wp93/census";

const encoder = new TextEncoder();

const SHARED_NOTE = "_liveshare-test/hello.md";
const RENAMED = "_liveshare-test/renamed.md";
const ABSENT = "_liveshare-test/never-existed.md";
const ABSENT_DEST = "_liveshare-test/also-never-existed.md";

function tfile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

interface Rig {
  manager: FileOpsManager;
  bytes: Map<string, Uint8Array>;
  journal: string[];
  /** Every `warn` the manager's OWN logger received — the S104 channel. */
  warnings: string[];
  destroy(): void;
}

/**
 * A `FileOpsManager` wired the way `main.ts` wires it AFTER S104 — i.e. with a
 * logger that exists. Before S104 landed this rig could not have been built:
 * `setLogger` was called with `undefined` and the field stayed `undefined`.
 *
 * `renameThrows` reproduces branch (3): the vault refuses the move. Every
 * mutation is journalled, so "nothing happened" is asserted against a record of
 * ALL vault calls rather than against a hand-picked few.
 */
function createRig(opts: { renameThrows?: boolean; disk?: Record<string, string> } = {}): Rig {
  const bytes = new Map<string, Uint8Array>();
  const files = new Map<string, TFile>();
  const journal: string[] = [];
  const warnings: string[] = [];

  for (const [path, content] of Object.entries(opts.disk ?? {})) {
    bytes.set(path, encoder.encode(content));
    files.set(path, tfile(path));
  }

  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    rename: vi.fn(async (file: { path: string }, newPath: string) => {
      if (opts.renameThrows) {
        journal.push(`rename-threw ${file.path} -> ${newPath}`);
        throw new Error("EPERM: operation not permitted");
      }
      journal.push(`rename ${file.path} -> ${newPath}`);
      const content = bytes.get(file.path);
      bytes.delete(file.path);
      files.delete(file.path);
      if (content !== undefined) bytes.set(newPath, content);
      file.path = newPath;
      files.set(newPath, file as TFile);
    }),
    create: vi.fn(async (path: string) => {
      journal.push(`create ${path}`);
      const file = tfile(path);
      files.set(path, file);
      bytes.set(path, new Uint8Array());
      return file;
    }),
    createBinary: vi.fn(async () => tfile("")),
    createFolder: vi.fn(async (path: string) => {
      journal.push(`createFolder ${path}`);
      return {};
    }),
    modify: vi.fn(async () => {}),
    modifyBinary: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    read: vi.fn(async () => "content"),
    readBinary: vi.fn(async () => new ArrayBuffer(8)),
  };
  const fileManager = {
    trashFile: vi.fn(async (file: { path: string }) => {
      journal.push(`trashFile ${file.path}`);
      bytes.delete(file.path);
      files.delete(file.path);
    }),
  };

  const manager = new FileOpsManager(vault as never, fileManager as never);
  // Exactly what `main.ts` now does, in the order it now does it.
  manager.setLogger({
    warn: (_category: string, message: string) => {
      warnings.push(message);
    },
  });

  return { manager, bytes, journal, warnings, destroy: () => manager.destroy() };
}

/** The lines this signal owns, so a row cannot be satisfied by unrelated noise. */
function renameDiagnostics(warnings: string[]): string[] {
  return warnings.filter(
    (m) => m.startsWith("RENAME NOT APPLIED:") || m.startsWith("APPLY FAILED:"),
  );
}

const RENAME: FileOp = {
  type: "rename",
  oldPath: SHARED_NOTE,
  newPath: RENAMED,
} as FileOp;

describe("S105 — an inbound rename that does not apply is not silent", () => {
  let rig: Rig | undefined;

  afterEach(() => {
    rig?.destroy();
    rig = undefined;
  });

  it("T1 — the apply THROWS: the failure reaches the logger and names both endpoints", async () => {
    rig = createRig({ renameThrows: true, disk: { [SHARED_NOTE]: "note" } });

    await rig.manager.applyRemoteOp(RENAME);

    // The premise of the row: the move really was attempted and really failed.
    // Without this the row could pass against a rig that never called `rename`.
    expect(rig.journal.some((e) => e.startsWith("rename-threw "))).toBe(true);
    expect(rig.bytes.has(RENAMED)).toBe(false);
    expect(rig.bytes.has(SHARED_NOTE)).toBe(true);

    const said = renameDiagnostics(rig.warnings);

    // BEFORE THE REPAIR this is `[]`. The throw was swallowed by the outer
    // `catch`, which raised a toast naming `"unknown"` and wrote nothing —
    // and, by swallowing, also kept `control-handlers.ts`'s `.catch` from ever
    // running. Two channels, both dead, for the same one failure.
    expect(said).toHaveLength(1);
    // It must be usable: an operator reading the log has to know WHICH file.
    expect(said[0]).toContain(SHARED_NOTE);
    expect(said[0]).toContain(RENAMED);
    expect(said[0]).not.toContain("unknown");
  });

  it("T2 — NEITHER endpoint resolves: the drop reaches the logger and names both endpoints", async () => {
    rig = createRig({ disk: {} });

    await rig.manager.applyRemoteOp({
      type: "rename",
      oldPath: ABSENT,
      newPath: ABSENT_DEST,
    } as FileOp);

    // Nothing was touched — which is correct, and is exactly the problem: this
    // outcome and "the op never arrived" were indistinguishable from outside.
    expect(rig.journal).toEqual([]);

    const said = renameDiagnostics(rig.warnings);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(ABSENT);
    expect(said[0]).toContain(ABSENT_DEST);
  });

  it("T3 — ANTI-VACUITY: an ordinary rename that DOES apply says nothing at all", async () => {
    rig = createRig({ disk: { [SHARED_NOTE]: "note" } });

    await rig.manager.applyRemoteOp(RENAME);

    // The positive control, in the same file and the same run: these fixtures
    // CAN move bytes, so T1/T2's silence is a property of the failure and not
    // of the rig.
    expect(rig.bytes.has(RENAMED)).toBe(true);
    expect(rig.bytes.has(SHARED_NOTE)).toBe(false);
    expect(rig.journal.some((e) => e.startsWith("rename "))).toBe(true);

    expect(renameDiagnostics(rig.warnings)).toEqual([]);
  });

  it("T4 — the apply-switch catch names an op by ALL its paths, never by `path` alone", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "..", "files", "file-ops.ts"), "utf8");
    // CODE ONLY. This row reddened on its own subject's COMMENT the first time
    // it ran — the repair quotes the defective expression in prose to explain
    // it, and an unstripped grep cannot tell an explanation from an occurrence.
    // `stripComments` is the census helper WP93 already owns, imported rather
    // than re-spelt.
    const src = stripComments(raw);

    // The exact shape that produced `"unknown"` for every rename, delete-by-
    // oldPath and any future op without a bare `path` field. A rename carries
    // `oldPath`/`newPath`, so this expression could NEVER name one.
    // Asserted as a BOOLEAN, not with `toContain`: a failing `toContain` prints
    // the whole 1000-line haystack into the diff, which buries the three rows
    // above it.
    expect(src.includes('"path" in op ? op.path : "unknown"')).toBe(false);

    // And the catch must not be bare: a `catch {` with no binding cannot report
    // the error it caught, which is how the underlying cause of S105 was lost
    // on both live reproductions.
    const applySwitchCatch = /\}\s*catch\s*\{\s*\n\s*const opPath/.test(src);
    expect(applySwitchCatch).toBe(false);
  });
});
