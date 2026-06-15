export const editorStore = {
  tabs: [], // { path: string, name: string, content: string, originalContent: string, isDirty: boolean, readOnly: boolean }
  panes: [
    { id: 'left', activeTabPath: null, tabPaths: [] }
  ],
  activePaneId: 'left',

  // ── Per-tab edit history ────────────────────────────────────────────────
  _historyMap: {}, // filePath → { stack: [{prev, next}], pointer: number }
  _maxHistory: 100,

  _getHistory(path) {
    if (!this._historyMap[path]) this._historyMap[path] = { stack: [], pointer: -1 };
    return this._historyMap[path];
  },

  pushHistory(path, prevContent, nextContent) {
    if (prevContent === nextContent) return;
    const h = this._getHistory(path);
    // Discard forward entries when a new edit is made
    h.stack = h.stack.slice(0, h.pointer + 1);
    h.stack.push({ prev: prevContent, next: nextContent });
    if (h.stack.length > this._maxHistory) h.stack.shift();
    h.pointer = h.stack.length - 1;
  },

  undo(path) {
    const h = this._getHistory(path);
    if (h.pointer < 0) return null;
    const entry = h.stack[h.pointer];
    h.pointer--;
    return entry.prev;
  },

  redo(path) {
    const h = this._getHistory(path);
    if (h.pointer >= h.stack.length - 1) return null;
    h.pointer++;
    const entry = h.stack[h.pointer];
    return entry.next;
  },

  clearHistory(path) {
    delete this._historyMap[path];
  },

  addTab(path, name, content, readOnly = false) {
    let tab = this.tabs.find(t => t.path === path);
    if (!tab) {
      tab = {
        path,
        name,
        content,
        originalContent: content,
        isDirty: false,
        readOnly
      };
      this.tabs.push(tab);
    }

    const pane = this.panes.find(p => p.id === this.activePaneId);
    if (!pane.tabPaths.includes(path)) {
      pane.tabPaths.push(path);
    }
    pane.activeTabPath = path;
    this.saveToSession();
  },

  closeTab(paneId, path) {
    const pane = this.panes.find(p => p.id === paneId);
    if (!pane) return;

    const index = pane.tabPaths.indexOf(path);
    if (index === -1) return;

    pane.tabPaths.splice(index, 1);
    if (pane.activeTabPath === path) {
      pane.activeTabPath = pane.tabPaths.length > 0 ? pane.tabPaths[Math.max(0, index - 1)] : null;
    }

    // If tab is not open in any other pane, remove it from global tabs list
    const isOpenElsewhere = this.panes.some(p => p.tabPaths.includes(path));
    if (!isOpenElsewhere) {
      const globalIndex = this.tabs.findIndex(t => t.path === path);
      if (globalIndex !== -1) this.tabs.splice(globalIndex, 1);
    }

    this.saveToSession();
  },

  setActivePane(paneId) {
    this.activePaneId = paneId;
    this.saveToSession();
  },

  setActiveTab(paneId, path) {
    const pane = this.panes.find(p => p.id === paneId);
    if (pane) {
      pane.activeTabPath = path;
      this.activePaneId = paneId;
    }
    this.saveToSession();
  },

  splitPane(orientation = 'horizontal') {
    if (this.panes.length >= 2) return; // Limit to 2 panes for now
    const currentPane = this.panes.find(p => p.id === this.activePaneId);
    const newPaneId = this.activePaneId === 'left' ? 'right' : 'bottom';

    this.panes.push({
      id: newPaneId,
      activeTabPath: currentPane.activeTabPath,
      tabPaths: [...currentPane.tabPaths],
      orientation
    });
    this.activePaneId = newPaneId;
    this.saveToSession();
  },

  closePane(paneId) {
    if (this.panes.length <= 1) return;
    const index = this.panes.findIndex(p => p.id === paneId);
    if (index !== -1) {
      this.panes.splice(index, 1);
      this.activePaneId = this.panes[0].id;
    }
    this.saveToSession();
  },

  updateContent(path, newContent) {
    const tab = this.tabs.find(t => t.path === path);
    if (!tab || tab.readOnly) return;
    tab.content = newContent;
    tab.isDirty = tab.content !== tab.originalContent;
    this.saveToSession();
  },

  jumpToLine(path, line) {
    const pane = this.panes.find(p => p.tabPaths.includes(path)) || this.panes.find(p => p.id === this.activePaneId);
    if (pane) {
      pane.activeTabPath = path;
      this.activePaneId = pane.id;
    }
    this.saveToSession();

    // Emit event for UI to scroll
    window.dispatchEvent(new CustomEvent('editor-jump', { detail: { path, line } }));
  },

  markSaved(path) {
    const tab = this.tabs.find(t => t.path === path);
    if (!tab) return;
    tab.originalContent = tab.content;
    tab.isDirty = false;
    this.saveToSession();
  },

  saveToSession() {
    const state = {
      tabs: this.tabs,
      panes: this.panes,
      activePaneId: this.activePaneId
    };
    localStorage.setItem('editor_session', JSON.stringify(state));
  },

  loadFromSession() {
    try {
      const saved = localStorage.getItem('editor_session');
      if (saved) {
        const state = JSON.parse(saved);
        this.tabs = state.tabs || [];
        this.panes = state.panes || [{ id: 'left', activeTabPath: null, tabPaths: [] }];
        this.activePaneId = state.activePaneId || 'left';
        return true;
      }
    } catch (e) {
      console.error('Failed to load editor session', e);
    }
    return false;
  }
};
