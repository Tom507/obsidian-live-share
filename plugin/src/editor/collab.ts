import { Compartment, EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { yCollab } from "y-codemirror.next";
import type * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

import type { SyncManager } from "../sync/sync";
import type { Permission, SessionRole } from "../types";
import { applyMinimalYTextUpdate, normalizeLineEndings, skipsAutoTextSync } from "../utils";
import { conflictExtension } from "./conflict-decoration";

export interface CursorUser {
  name: string;
  color: string;
  colorLight: string;
}

export class CollabManager {
  private compartment = new Compartment();
  private currentPath: string | null = null;
  private currentView: EditorView | null = null;
  private currentAwareness: awarenessProtocol.Awareness | null = null;
  private activationGen = 0;

  getBaseExtension(): Extension {
    return this.compartment.of([]);
  }

  async activateForFile(
    view: EditorView,
    filePath: string | null,
    syncManager: SyncManager,
    role?: SessionRole,
    permission?: Permission,
    cursorUser?: CursorUser,
  ) {
    const gen = ++this.activationGen;

    if (filePath !== this.currentPath || view !== this.currentView) {
      if (this.currentAwareness) {
        this.currentAwareness.setLocalState(null);
      }
      if (this.currentView && this.currentView !== view) {
        try {
          this.currentView.dispatch({
            effects: this.compartment.reconfigure([]),
          });
        } catch {
          // Previous view may have been destroyed
        }
      }
      this.currentAwareness = null;
    }
    this.currentPath = filePath;
    this.currentView = view;
    if (!filePath) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }
    // WP27 AC4 — the second of the two unguarded bare-path `getDoc` sites (R5).
    //
    // `filePath` is a VAULT PATH. An unguarded host activation over a `.canvas`
    // asks the sync manager for a document under that path, then seeds the whole
    // canvas JSON into a raw `Y.Text` for it and installs a `yCollab` binding —
    // a character-level CRDT over a document `CanvasSync` owns structurally.
    // That is R5 itself, and its merge destroys edge endpoints.
    //
    // Guid-based doc ids defuse the collision structurally, but AC4 asks for the
    // guard as well ("verified by an explicit test rather than by a reachability
    // argument"), so this line is the one a test can point at. It sits BEFORE
    // the `getDoc` because the CALL is what creates the document.
    //
    // `skipsAutoTextSync` is the shared predicate (`utils.ts`): `.canvas` plus
    // the sidecar directory, one definition, no private copy. Nothing legitimate
    // is refused — both this and `BackgroundSync.setActiveFile` are fed from a
    // `MarkdownView`, which a `.canvas` never is, and the R10 text fallback runs
    // through `BackgroundSync.subscribe`, never through an editor binding.
    //
    // The early return takes the same shape as the `!docHandle` one below: drop
    // the awareness reference and reconfigure the compartment to EMPTY, so a
    // previous file's binding is never left live over the canvas.
    if (skipsAutoTextSync(filePath)) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }
    const docHandle = syncManager.getDoc(filePath);
    if (!docHandle) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }

    try {
      await syncManager.waitForSync(filePath);
    } catch {
      if (this.activationGen !== gen) return;
      new Notice("Live Share: sync timed out");
      this.currentAwareness = null;
      try {
        view.dispatch({ effects: this.compartment.reconfigure([]) });
      } catch {
        // View may have been destroyed during sync
      }
      return;
    }

    if (this.activationGen !== gen) return;
    if ((view as unknown as { destroyed: boolean }).destroyed) return;

    if (role !== "host" && docHandle.text.length === 0) {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (this.activationGen !== gen) return;
        if ((view as unknown as { destroyed: boolean }).destroyed) return;
        if (docHandle.text.length > 0) break;
      }
    }

    if (role === "host" && docHandle.text.length === 0) {
      // Seed only when Y.Text is empty (mirror the guest logic). Force-seeding
      // on every activation would clobber concurrent guest edits whenever the
      // CM6 doc is momentarily stale relative to Y.Text.
      const localContent = normalizeLineEndings(view.state.doc.toString());
      applyMinimalYTextUpdate(docHandle.doc, docHandle.text, localContent);
    }

    this.currentAwareness = docHandle.awareness;
    if (cursorUser) {
      docHandle.awareness.setLocalStateField("user", cursorUser);
    }
    const collabExt = yCollab(docHandle.text, docHandle.awareness, {
      undoManager: false,
    });
    const extensions: Extension[] = Array.isArray(collabExt) ? [...collabExt] : [collabExt];
    extensions.push(conflictExtension());
    if (permission === "read-only") {
      extensions.push(EditorState.readOnly.of(true));
    }
    view.dispatch({
      effects: this.compartment.reconfigure(extensions),
    });

    const selection = view.state.selection.main;
    const anchor = Y.createRelativePositionFromTypeIndex(docHandle.text, selection.anchor);
    const head = Y.createRelativePositionFromTypeIndex(docHandle.text, selection.head);
    docHandle.awareness.setLocalStateField("cursor", { anchor, head });
  }

  deactivateAll(view: EditorView) {
    this.activationGen++;
    if (this.currentAwareness) {
      this.currentAwareness.setLocalState(null);
      this.currentAwareness = null;
    }
    this.currentPath = null;
    this.currentView = null;
    view.dispatch({ effects: this.compartment.reconfigure([]) });
  }
}
