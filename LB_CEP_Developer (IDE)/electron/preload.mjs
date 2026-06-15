import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("ide", {
  // File system
  readDir: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("write-file", filePath, content),
  executeWriteTransaction: (txn) => ipcRenderer.invoke("execute-write-transaction", txn),
  searchFiles: (rootPath, query, options) => ipcRenderer.invoke("search-files", rootPath, query, options),
  recoverTransactions: (rootPath) => ipcRenderer.invoke("recover-transactions", rootPath),
  readAuditLog: (rootPath) => ipcRenderer.invoke("read-audit-log", rootPath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke("rename-file", oldPath, newPath),
  deleteFile: (filePath) => ipcRenderer.invoke("delete-file", filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke("reveal-in-folder", filePath),
  createFile: (filePath, content) => ipcRenderer.invoke("create-file", filePath, content),
  createFolder: (folderPath) => ipcRenderer.invoke("create-folder", folderPath),
  appendMemoryLog: (rootPath, entry) => ipcRenderer.invoke("append-memory-log", rootPath, entry),
  readMemoryLog: (rootPath) => ipcRenderer.invoke("read-memory-log", rootPath),
  appendAuditLog: (rootPath, entry) => ipcRenderer.invoke("append-audit-log", rootPath, entry),
  loadSettings: () => ipcRenderer.invoke("settings-load"),
  saveSettings: (payload) => ipcRenderer.invoke("settings-save", payload),
  revealSettings: () => ipcRenderer.invoke("settings-reveal"),

  // Dependency status
  checkDependencies: () => ipcRenderer.invoke("check-dependencies"),
  openProjectDialog: () => ipcRenderer.invoke("open-project-dialog"),
  onDependencyStatus: (cb) => ipcRenderer.on("dependency-status", (_e, d) => cb(d)),

  // Events from main process
  onProjectOpened: (cb) => ipcRenderer.on("project-opened", (_e, p) => cb(p)),
  onFileOpened: (cb) => ipcRenderer.on("file-opened", (_e, p) => cb(p)),
  onRunCommand: (cb) => ipcRenderer.on("run-command", (_e, cmd) => cb(cmd)),

  // Platform info
  platform: process.platform,

  // Git helpers
  gitStatus: (rootPath) => ipcRenderer.invoke("git-status", rootPath),
  gitBranch: (rootPath) => ipcRenderer.invoke("git-branch", rootPath),
  gitLog: (rootPath) => ipcRenderer.invoke("git-log", rootPath),
  gitCreateBranch: (rootPath, branchName) => ipcRenderer.invoke("git-create-branch", rootPath, branchName),
  gitStageFiles: (rootPath, files) => ipcRenderer.invoke("git-stage-files", rootPath, files),
  gitCommit: (rootPath, message) => ipcRenderer.invoke("git-commit", rootPath, message),
  gitPush: (rootPath, branchName) => ipcRenderer.invoke("git-push", rootPath, branchName),
});

// Production bridge alias
contextBridge.exposeInMainWorld("electronAPI", {
  writeFile: (path, content) => ipcRenderer.invoke("write-file", path, content),
  readFile: (path) => ipcRenderer.invoke("read-file", path),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
});
