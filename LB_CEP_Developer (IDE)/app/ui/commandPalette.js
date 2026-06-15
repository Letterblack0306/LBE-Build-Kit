export const commandPalette = {
  commands: new Map(),

  register(id, name, category, callback, shortcut = '') {
    this.commands.set(id, { id, name, category, callback, shortcut });
  },

  search(query) {
    const all = [...this.commands.values()];
    if (!query) return all;
    const q = query.toLowerCase();
    const results = [];
    for (const cmd of all) {
      const haystack = (cmd.name + ' ' + (cmd.category || '')).toLowerCase();
      let score = 0;
      let qi = 0;
      for (let i = 0; i < haystack.length && qi < q.length; i++) {
        if (haystack[i] === q[qi]) { score += (qi === 0 ? 10 : 5); qi++; }
      }
      if (qi === q.length) results.push({ ...cmd, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }
};

// ── Default commands ────────────────────────────────────────────────────────

commandPalette.register('file.open_project', 'Open Project', 'File', () => {
  document.getElementById('open-project-btn')?.click();
}, 'Ctrl+Shift+O');

commandPalette.register('file.save_all', 'Save All Files', 'File', () => {
  document.dispatchEvent(new CustomEvent('save-all-files'));
}, 'Ctrl+Shift+S');

commandPalette.register('ui.split_horizontal', 'Split Editor Horizontal', 'View', () => {
  if (window.editorStore) window.editorStore.splitPane();
  else document.dispatchEvent(new CustomEvent('split-pane'));
}, 'Ctrl+\\');

commandPalette.register('editor.close_tab', 'Close Tab', 'Editor', () => {
  document.dispatchEvent(new CustomEvent('close-active-tab'));
}, 'Ctrl+W');

commandPalette.register('terminal.toggle', 'Toggle Terminal', 'View', () => {
  document.dispatchEvent(new CustomEvent('toggle-terminal'));
}, 'Ctrl+`');

commandPalette.register('ui.focus_editor', 'Focus Editor', 'View', () => {
  document.querySelector('.file-editor, #cm-editor')?.focus();
}, 'Escape');

commandPalette.register('ui.toggle_theme', 'Toggle Theme', 'View', () => {
  document.body.classList.toggle('theme-light');
});

commandPalette.register('ui.settings', 'Open Settings', 'View', () => {
  document.getElementById('settings-btn')?.click();
}, 'Ctrl+,');

commandPalette.register('bk.doctor', 'Build Kit: Doctor', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build doctor' }));
});

commandPalette.register('bk.build', 'Build Kit: Build', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build build' }));
}, 'Ctrl+Shift+B');

commandPalette.register('bk.dev', 'Build Kit: Dev Mode', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build dev' }));
});

commandPalette.register('bk.reload', 'Build Kit: Reload Extension', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build reload' }));
}, 'Ctrl+Shift+R');

commandPalette.register('bk.sync', 'Build Kit: Sync to Host', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build sync' }));
});

commandPalette.register('bk.simulate', 'Build Kit: Simulate Run', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build simulate' }));
});

commandPalette.register('bk.bump_patch', 'Build Kit: Bump Patch Version', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build bump patch' }));
});

commandPalette.register('bk.changelog', 'Build Kit: Generate Changelog', 'Build Kit', () => {
  window.dispatchEvent(new CustomEvent('run-command', { detail: 'ext-build changelog' }));
});
