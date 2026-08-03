import type { App } from "obsidian";

import {
  type ImportOverwriteSummary,
  importConfirmationMessage,
} from "../canvas/canvas-import-command";
import { ConfirmModal } from "./modals";

// ---------------------------------------------------------------------------
// WP30 / AC3 — the confirmation dialog for "Import canvas from file".
// ---------------------------------------------------------------------------
//
// This file is deliberately almost empty, and that is the design.
//
// `ConfirmModal` (`ui/modals.ts`) already resolves `true` on Confirm, `false` on
// Cancel, and — the half that is easy to miss and impossible to add later — it
// resolves `false` from `onClose` when the user dismisses the dialog WITHOUT
// deciding. DISMISSAL THEREFORE ALREADY COUNTS AS CANCEL and needs no new code.
// Its Confirm button already carries `mod-warning`, which is Obsidian's
// destructive styling. Re-implementing any of that here would produce a second
// modal that has to be kept correct in parallel, and the copy would be the one
// used by the only command in this plugin that destroys shared work.
//
// So the subclass adds exactly two things:
//
//   ├── the MESSAGE, built by `importConfirmationMessage` — the pure core owns
//   │   the sentence, so the text a user reads before authorising a destruction
//   │   is unit-testable without a DOM (the Obsidian test double's
//   │   `contentEl.createEl` returns `{}`); and
//   └── the SUMMARY it was built from, retained so the rendering half (a W4
//       HUMAN_OBSERVABLE target) can be inspected against the data it claims to
//       state, rather than against a string.
//
// WP30 never calls `ConfirmModal` directly with a hand-built sentence: routing
// every import confirmation through this one constructor is what guarantees the
// dialog and the `ImportOverwriteSummary` in the result can never disagree.
// ---------------------------------------------------------------------------

export class ImportCanvasConfirmModal extends ConfirmModal {
  readonly summary: ImportOverwriteSummary;

  constructor(app: App, summary: ImportOverwriteSummary, resolve: (value: boolean) => void) {
    // Throws on a summary that cannot be stated truthfully — before the modal is
    // constructed, so a dialog asking for permission over `undefined` never
    // opens at all.
    super(app, importConfirmationMessage(summary), resolve);
    this.summary = summary;
  }
}

/**
 * The Promise wrapper, mirroring `LiveSharePlugin.confirm(message)` exactly —
 * the same shape, one modal deeper, so the caller in `main.ts` stays wiring.
 */
export function confirmImportFromFile(app: App, summary: ImportOverwriteSummary): Promise<boolean> {
  return new Promise((resolve) => {
    new ImportCanvasConfirmModal(app, summary, resolve).open();
  });
}
