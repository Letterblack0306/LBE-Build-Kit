export const quickOpen = {
  files: [],

  async loadFiles(currentProject) {
    if (!window.ide || !currentProject) return;
    const entries = await window.ide.readDir(currentProject);
    // Recursively get all files (crude version for now)
    this.files = await this.walk(currentProject);
  },

  async walk(dir) {
    let results = [];
    const entries = await window.ide.readDir(dir);
    for (const entry of entries) {
      if (entry.isDir) {
        if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
        const children = await this.walk(entry.path);
        results = results.concat(children);
      } else {
        results.push(entry);
      }
    }
    return results;
  },

  search(query) {
    if (!query) return this.files.slice(0, 10);
    const q = query.toLowerCase();
    return this.files
      .filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 15);
  }
};
