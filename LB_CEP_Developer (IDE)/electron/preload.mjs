import { contextBridge, ipcRenderer } from "electron";

const on = (channel, callback) => {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("ide", Object.freeze({
  registerWorkspace: (rootPath) => ipcRenderer.invoke("workspace-register", rootPath),
  openProjectDialog: () => ipcRenderer.invoke("open-project-dialog"),
  readDir: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  executeWriteTransaction: (transaction) => ipcRenderer.invoke("execute-write-transaction", transaction),
  searchFiles: (rootPath, query, options) => ipcRenderer.invoke("search-files", rootPath, query, options),
  recoverTransactions: (rootPath) => ipcRenderer.invoke("recover-transactions", rootPath),
  readAuditLog: (rootPath) => ipcRenderer.invoke("read-audit-log", rootPath),
  appendMemoryLog: (rootPath, entry) => ipcRenderer.invoke("append-memory-log", rootPath, entry),
  readMemoryLog: (rootPath) => ipcRenderer.invoke("read-memory-log", rootPath),
  revealInFolder: (filePath) => ipcRenderer.invoke("reveal-in-folder", filePath),

  loadSettings: () => ipcRenderer.invoke("settings-load"),
  saveSettings: (payload) => ipcRenderer.invoke("settings-save", payload),
  revealSettings: () => ipcRenderer.invoke("settings-reveal"),
  loadProviders: () => ipcRenderer.invoke("load-providers"),
  saveProviders: (config) => ipcRenderer.invoke("save-providers", config),
  loadMcpSettings: () => ipcRenderer.invoke("load-mcp-settings"),
  saveMcpSettings: (settings) => ipcRenderer.invoke("save-mcp-settings", settings),

  checkDependencies: () => ipcRenderer.invoke("check-dependencies"),
  gitStatus: (rootPath) => ipcRenderer.invoke("git-status", rootPath),
  gitBranch: (rootPath) => ipcRenderer.invoke("git-branch", rootPath),
  gitLog: (rootPath) => ipcRenderer.invoke("git-log", rootPath),
  gitCreateBranch: (rootPath, branchName) => ipcRenderer.invoke("git-create-branch", rootPath, branchName),
  gitStageFiles: (rootPath, files) => ipcRenderer.invoke("git-stage-files", rootPath, files),
  gitCommit: (rootPath, message) => ipcRenderer.invoke("git-commit", rootPath, message),
  gitPush: (rootPath, branchName) => ipcRenderer.invoke("git-push", rootPath, branchName),

  onProjectOpened: (callback) => on("project-opened", callback),
  onFileOpened: (callback) => on("file-opened", callback),
  onRunCommand: (callback) => on("run-command", callback),
  platform: process.platform
}));
