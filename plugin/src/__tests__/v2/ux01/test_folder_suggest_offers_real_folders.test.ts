import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { FolderSuggest } from "../../../ui/folder-suggest";

/**
 * UX01 — the "Shared folder" field offers folders that EXIST.
 *
 * The defect it answers is silent: a mistyped folder name makes
 * `isSharedPath` answer `false` for every path in the vault, so the session
 * connects, reports no error, and shares nothing. That reads as "sync is
 * broken", not as "you have a typo", which is the most expensive way for a
 * wrong value to fail.
 */

function folder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  return f;
}

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function appWith(children: Array<TFolder | TFile>) {
  return {
    vault: { getAllLoadedFiles: vi.fn(() => children) },
  } as never;
}

function inputEl(): HTMLInputElement {
  return { value: "" } as HTMLInputElement;
}

const VAULT = [
  folder("/"),
  folder("Journal"),
  folder("Journal/2026"),
  folder("Projects"),
  folder("Projects/Shared notes"),
  folder("_liveshare-test"),
  file("Journal/2026/08.md"),
  file("Inbox.md"),
];

function suggesterOver(children: Array<TFolder | TFile>, onPick = vi.fn()) {
  const el = inputEl();
  const suggest = new FolderSuggest(appWith(children), el, onPick);
  // `getSuggestions` is `protected` on the base class; the test drives it as the
  // popover does, which is the only way to observe the filter at all.
  const query = (q: string): string[] =>
    (suggest as unknown as { getSuggestions(q: string): TFolder[] })
      .getSuggestions(q)
      .map((f) => f.path);
  return { suggest, el, onPick, query };
}

describe("UX01 — FolderSuggest offers the vault's real folders", () => {
  it("lists every folder for an empty query, in a stable order", () => {
    const { query } = suggesterOver(VAULT);
    // `localeCompare` ordering, which puts punctuation before letters — the
    // order the popover shows. Asserted as the sorted permutation of the input
    // rather than as a hand-written list, so this pins STABILITY without
    // pinning ICU's collation table.
    const expected = [
      "Journal",
      "Journal/2026",
      "Projects",
      "Projects/Shared notes",
      "_liveshare-test",
    ].sort((a, b) => a.localeCompare(b));
    expect(query("")).toEqual(expected);
    expect(query("")).toHaveLength(5);
  });

  it("never offers the vault root — that is the empty field, and the widest value", () => {
    const { query } = suggesterOver(VAULT);
    expect(query("")).not.toContain("/");
    expect(query("/")).not.toContain("/");
  });

  it("never offers a file", () => {
    const { query } = suggesterOver(VAULT);
    const all = query("");
    expect(all).not.toContain("Inbox.md");
    expect(all).not.toContain("Journal/2026/08.md");
  });

  it("filters case-insensitively on any part of the path", () => {
    const { query } = suggesterOver(VAULT);
    expect(query("journal")).toEqual(["Journal", "Journal/2026"]);
    expect(query("SHARED")).toEqual(["Projects/Shared notes"]);
    expect(query("2026")).toEqual(["Journal/2026"]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    const { query } = suggesterOver(VAULT);
    expect(query("no-such-folder")).toEqual([]);
  });

  it("selecting a folder writes the path into the field AND reports it", () => {
    const { suggest, el, onPick } = suggesterOver(VAULT);
    suggest.selectSuggestion(folder("Projects/Shared notes"));
    // Both halves matter: the field showing the new value without the callback
    // firing is a setting the user believes they changed and did not.
    expect(el.value).toBe("Projects/Shared notes");
    expect(onPick).toHaveBeenCalledWith("Projects/Shared notes");
  });

  it("a vault with no subfolders offers nothing and does not throw", () => {
    const { query } = suggesterOver([folder("/"), file("Inbox.md")]);
    expect(query("")).toEqual([]);
  });
});
