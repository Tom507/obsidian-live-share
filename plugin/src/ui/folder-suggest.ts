import { AbstractInputSuggest, type App, TFolder } from "obsidian";

/**
 * Type-ahead folder picker for the "Shared folder" setting.
 *
 * The field used to be free text, which made two wrong values indistinguishable
 * from a right one at the moment of typing: a folder that does not exist, and a
 * folder whose name differs only in case or in a trailing space. Neither is
 * reported anywhere — `isInSharedFolder` simply answers `false` for every path,
 * so the session comes up connected and shares nothing, which reads as a sync
 * failure rather than as a typo.
 *
 * The suggester does not *replace* the text field (a vault with no subfolders
 * still needs one, and a user restoring a config by hand should be able to
 * paste). It offers the vault's real folders, so the ordinary path produces a
 * value that is known to exist.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private readonly inputEl: HTMLInputElement,
    private readonly onPick: (path: string) => void,
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): TFolder[] {
    const needle = query.toLowerCase();
    const folders: TFolder[] = [];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFolder)) continue;
      // The vault root is `/` and means "share everything" — which is what an
      // EMPTY field already means. Offering it here would give the most
      // dangerous value its own menu entry.
      if (file.isRoot()) continue;
      if (file.path.toLowerCase().includes(needle)) folders.push(file);
    }
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return folders;
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  override selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path;
    this.setValue(folder.path);
    this.onPick(folder.path);
    this.close();
  }
}
