import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
  type DebugLogger,
  type LogEntry,
  LOG_LEVELS,
  LOG_LEVEL_ORDER,
  type LogLevel,
} from "../debug-logger";

export const LOG_VIEW_TYPE = "live-share-log";

// Phase A: the live status console. Modeled on PresenceView: an ItemView docked
// in the right sidebar that renders the DebugLogger ring buffer, filters it by a
// level dropdown, subscribes for live entries, and offers a clear button. This is
// how the user visually confirms the canvas presence layer wired up correctly.
export class LogView extends ItemView {
  private logger: DebugLogger | null = null;
  private unsubscribe: (() => void) | null = null;
  private filterLevel: LogLevel = "debug";
  private listEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  setLogger(logger: DebugLogger): void {
    this.logger = logger;
    this.filterLevel = logger.getLevel();
    if (this.listEl) this.rebuildSubscription();
  }

  getViewType(): string {
    return LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Live Share console";
  }

  getIcon(): string {
    return "scroll-text";
  }

  override onOpen(): Promise<void> {
    this.build();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
    this.listEl = null;
    return Promise.resolve();
  }

  private build(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("live-share-log-panel");

    const toolbar = contentEl.createEl("div", { cls: "live-share-log-toolbar" });

    const select = toolbar.createEl("select", { cls: "live-share-log-level dropdown" });
    for (const level of LOG_LEVELS) {
      const opt = select.createEl("option", { text: level.toUpperCase(), value: level });
      if (level === this.filterLevel) opt.selected = true;
    }
    select.addEventListener("change", () => {
      this.filterLevel = select.value as LogLevel;
      this.logger?.setLevel(this.filterLevel);
      this.renderAll();
    });

    const clearBtn = toolbar.createEl("button", {
      text: "Clear",
      cls: "live-share-log-clear",
    });
    clearBtn.addEventListener("click", () => {
      this.logger?.clear();
      this.renderAll();
    });

    this.listEl = contentEl.createEl("div", { cls: "live-share-log-list" });
    this.rebuildSubscription();
  }

  private rebuildSubscription(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.renderAll();
    if (this.logger) {
      this.unsubscribe = this.logger.subscribe((entry) => {
        if (entry === null) this.renderAll();
        else this.appendEntry(entry);
      });
    }
  }

  private renderAll(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const entries = this.logger?.getEntries() ?? [];
    if (entries.length === 0) {
      this.listEl.createEl("div", {
        text: "No log entries yet",
        cls: "live-share-log-empty",
      });
      return;
    }
    for (const entry of entries) this.appendEntry(entry);
  }

  private appendEntry(entry: LogEntry): void {
    if (!this.listEl) return;
    if (LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[this.filterLevel]) return;
    // Drop the empty-state placeholder once real rows arrive.
    const placeholder = this.listEl.querySelector(".live-share-log-empty");
    placeholder?.remove();

    const row = this.listEl.createEl("div", {
      cls: `live-share-log-row mod-${entry.level}`,
    });
    row.createEl("span", { text: entry.ts.slice(11, 23), cls: "live-share-log-ts" });
    row.createEl("span", { text: entry.level.toUpperCase(), cls: "live-share-log-lvl" });
    row.createEl("span", { text: `[${entry.category}]`, cls: "live-share-log-cat" });
    row.createEl("span", { text: entry.message, cls: "live-share-log-msg" });
    // Autoscroll to the newest line.
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}
