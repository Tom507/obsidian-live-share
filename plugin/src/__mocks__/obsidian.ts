export class Notice {}

export class Modal {
  app: any;
  contentEl = { createEl: () => ({}), createDiv: () => ({}), empty: () => {} };
  constructor(app: any) {
    this.app = app;
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class Plugin {
  app: any = {};
  manifest: any = {};
  loadData() {
    return Promise.resolve({});
  }
  saveData(_data: any) {
    return Promise.resolve();
  }
  addCommand(_cmd: any) {}
  addSettingTab(_tab: any) {}
  addStatusBarItem() {
    return { setText: () => {}, addEventListener: () => {}, style: {} };
  }
  addRibbonIcon() {
    return {} as any;
  }
  registerView() {}
  registerEvent() {}
  registerEditorExtension() {}
}

export class PluginSettingTab {
  app: any;
  containerEl = { empty: () => {} };
  constructor(app: any, _plugin: any) {
    this.app = app;
  }
  display() {}
}

export class ItemView {
  leaf: any;
  contentEl = { empty: () => {}, createEl: () => ({}), createDiv: () => ({}) };
  constructor(leaf: any) {
    this.leaf = leaf;
  }
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
  getIcon() {
    return "";
  }
  onOpen() {
    return Promise.resolve();
  }
  onClose() {
    return Promise.resolve();
  }
}

export class MarkdownView {}
export class TFile {
  path = "";
  stat = { size: 0, mtime: 0, ctime: 0 };
}
export class TFolder {
  path = "";
  // The real `TFolder.isRoot()` is `this.path === "/"`. `FolderSuggest` relies
  // on it to keep the vault root out of the menu, so a mock that always
  // answered `false` would make that exclusion untestable — the test would
  // pass while asserting nothing about the case it exists for.
  isRoot() {
    return this.path === "/";
  }
}
export class TAbstractFile {
  path = "";
}

/**
 * Stand-in for the real type-ahead base class. Deliberately keeps the two
 * behaviours `FolderSuggest` actually depends on — the input element it was
 * constructed over, and `setValue` writing through to it — so a test can
 * observe a selection rather than only that a method was called.
 */
export class AbstractInputSuggest<T> {
  limit = 100;
  app: any;
  closed = false;
  protected textInputEl: any;
  constructor(app: any, textInputEl: any) {
    this.app = app;
    this.textInputEl = textInputEl;
  }
  setValue(value: string) {
    if (this.textInputEl) this.textInputEl.value = value;
  }
  getValue(): string {
    return this.textInputEl?.value ?? "";
  }
  selectSuggestion(_value: T, _evt?: any) {}
  close() {
    this.closed = true;
  }
}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isSafari: false,
  resourcePathPrefix: "app://local/",
};

export class Setting {
  setName(_n: string) {
    return this;
  }
  setDesc(_d: string) {
    return this;
  }
  addText(_cb: any) {
    return this;
  }
  addButton(_cb: any) {
    return this;
  }
}
