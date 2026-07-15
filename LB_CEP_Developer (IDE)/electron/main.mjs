import { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceRoot = path.resolve(__dirname, "..");
const runtimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, "ide-runtime")
  : sourceRoot;
const userDataPath = path.join(app.getPath("userData"), "local-data");
app.setPath("userData", userDataPath);
app.disableHardwareAcceleration();
app.requestSingleInstanceLock() || app.quit();

const SETTINGS_FILE = path.join(userDataPath, "ai-settings.json");
const PROVIDERS_FILE = path.join(userDataPath, "providers.json");
const MCP_SETTINGS_FILE = path.join(userDataPath, "mcp-settings.json");
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const authorizedRoots = new Set();
let mainWindow = null;
let serverProcess = null;

function normalizeRoot(input) {
  if (!input || typeof input !== "string") throw new Error("Missing workspace path");
  const resolved = path.resolve(input);
  const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  const stat = fs.existsSync(real) ? fs.statSync(real) : null;
  if (stat && !stat.isDirectory()) throw new Error("Workspace must be a directory");
  return real;
}

function registerWorkspace(input) {
  const root = normalizeRoot(input);
  authorizedRoots.add(root);
  return root;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function authorizePath(input, { mustExist = false } = {}) {
  if (!input || typeof input !== "string") throw new Error("Missing path");
  const resolved = path.resolve(input);
  let candidate = resolved;
  if (fs.existsSync(resolved)) {
    candidate = fs.realpathSync.native(resolved);
  } else {
    const parent = path.dirname(resolved);
    if (fs.existsSync(parent)) {
      candidate = path.join(fs.realpathSync.native(parent), path.basename(resolved));
    }
  }
  if (mustExist && !fs.existsSync(candidate)) throw new Error("Path does not exist");
  for (const root of authorizedRoots) {
    if (isWithin(root, candidate)) return candidate;
  }
  const err = new Error("Path is outside an authorized workspace");
  err.code = "WORKSPACE_SCOPE_BLOCKED";
  throw err;
}

function authorizeRoot(input) {
  const root = normalizeRoot(input);
  if (!authorizedRoots.has(root)) {
    const err = new Error("Workspace is not authorized");
    err.code = "WORKSPACE_NOT_AUTHORIZED";
    throw err;
  }
  return root;
}

function safeResult(fn, fallback = null) {
  try { return fn(); } catch (error) { return { ok: false, error: error.message, code: error.code || "OPERATION_FAILED", fallback }; }
}

function encryptValue(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    const err = new Error("Secure operating-system storage is unavailable; secrets were not persisted");
    err.code = "SECURE_STORAGE_UNAVAILABLE";
    throw err;
  }
  return `enc:${safeStorage.encryptString(value).toString("base64")}`;
}

function decryptValue(value) {
  if (!value) return "";
  if (!String(value).startsWith("enc:")) return "";
  if (!safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(String(value).slice(4), "base64")); } catch { return ""; }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
}

function readSettingsFile() {
  const parsed = readJson(SETTINGS_FILE, { config: {}, profiles: [] });
  const config = { ...(parsed.config || {}) };
  if (config.apiKey) config.apiKey = decryptValue(config.apiKey);
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles.map((profile) => {
    const next = { ...profile };
    if (next.apiKey) next.apiKey = decryptValue(next.apiKey);
    return next;
  }) : [];
  return { config, profiles, encryptionAvailable: safeStorage.isEncryptionAvailable() };
}

function writeSettingsFile(payload) {
  try {
    const config = { ...(payload?.config || {}) };
    if (config.apiKey) config.apiKey = encryptValue(config.apiKey);
    const profiles = Array.isArray(payload?.profiles) ? payload.profiles.map((profile) => {
      const next = { ...profile };
      if (next.apiKey) next.apiKey = encryptValue(next.apiKey);
      return next;
    }) : [];
    writeJson(SETTINGS_FILE, { config, profiles });
    return { ok: true, encrypted: true };
  } catch (error) {
    return { ok: false, encrypted: false, code: error.code || "SETTINGS_SAVE_FAILED", error: error.message };
  }
}

function startServer() {
  const script = path.join(runtimeRoot, "scripts", "dev-server.mjs");
  const executable = app.isPackaged ? process.execPath : "node";
  serverProcess = spawn(executable, [script], {
    cwd: runtimeRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LBE_IDE_SESSION_TOKEN: SESSION_TOKEN },
    stdio: "pipe"
  });
  serverProcess.stdout.on("data", (data) => console.log(`[server] ${data}`));
  serverProcess.stderr.on("data", (data) => console.error(`[server] ${data}`));
  serverProcess.on("error", (error) => dialog.showErrorBox("Server Error", error.message));
}

function runGit(projectRoot, args) {
  const root = authorizeRoot(projectRoot);
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: root, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

function audit(projectRoot, eventType, txnId, files, payload = {}) {
  try {
    const root = authorizeRoot(projectRoot);
    const directory = path.join(root, ".letterblack", "audit");
    fs.mkdirSync(directory, { recursive: true });
    const entry = {
      eventId: `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      eventType,
      timestamp: Date.now(),
      txnId,
      projectRoot: root,
      summary: { fileCount: files?.length || 0 },
      payload
    };
    fs.appendFileSync(path.join(directory, "audit-log.ndjson"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch { }
}

function installIpcHandlers() {
  ipcMain.handle("workspace-register", (_event, root) => safeResult(() => ({ ok: true, root: registerWorkspace(root) })));
  ipcMain.handle("read-dir", (_event, input) => safeResult(() => fs.readdirSync(authorizePath(input, { mustExist: true }), { withFileTypes: true }).map((entry) => ({ name: entry.name, path: path.join(input, entry.name), isDir: entry.isDirectory() })).sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1), []));
  ipcMain.handle("read-file", (_event, input) => safeResult(() => ({ ok: true, content: fs.readFileSync(authorizePath(input, { mustExist: true }), "utf8") })));
  ipcMain.handle("write-file", () => ({ ok: false, code: "DIRECT_WRITE_DISABLED", error: "Use executeWriteTransaction" }));
  ipcMain.handle("create-file", () => ({ ok: false, code: "DIRECT_WRITE_DISABLED", error: "Use executeWriteTransaction" }));
  ipcMain.handle("create-folder", () => ({ ok: false, code: "DIRECT_WRITE_DISABLED", error: "Use executeWriteTransaction" }));
  ipcMain.handle("rename-file", () => ({ ok: false, code: "DIRECT_WRITE_DISABLED", error: "Use executeWriteTransaction" }));
  ipcMain.handle("delete-file", () => ({ ok: false, code: "DIRECT_WRITE_DISABLED", error: "Use executeWriteTransaction" }));
  ipcMain.handle("reveal-in-folder", (_event, input) => safeResult(() => { shell.showItemInFolder(authorizePath(input, { mustExist: true })); return { ok: true }; }));
  ipcMain.handle("search-files", (_event, rootInput, query, options = {}) => safeResult(() => {
    const root = authorizeRoot(rootInput);
    const results = [];
    const expression = options.isRegex ? new RegExp(String(query), options.matchCase ? "g" : "gi") : null;
    const needle = options.matchCase ? String(query) : String(query).toLowerCase();
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink?.()) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "dist", ".letterblack"].includes(entry.name)) walk(full);
          continue;
        }
        try {
          const content = fs.readFileSync(full, "utf8");
          const matched = expression ? expression.test(content) : (options.matchCase ? content : content.toLowerCase()).includes(needle);
          if (matched) results.push({ path: full, name: entry.name });
        } catch { }
      }
    };
    walk(root);
    return results.slice(0, 500);
  }, []));

  ipcMain.handle("execute-write-transaction", (_event, txn) => safeResult(() => {
    const projectRoot = authorizeRoot(txn?.projectRoot);
    const files = Array.isArray(txn?.files) ? txn.files : [];
    if (!files.length) throw new Error("Transaction contains no files");
    const txnId = `txn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const txnDir = path.join(projectRoot, ".letterblack", "transactions", txnId);
    const seen = new Set();
    const staged = files.map((file) => {
      const relativePath = String(file.relativePath || "").replace(/\\/g, "/");
      if (!relativePath || relativePath.startsWith("/") || relativePath.includes("../")) throw new Error(`Invalid relative path: ${relativePath}`);
      if (seen.has(relativePath)) throw new Error(`Duplicate target: ${relativePath}`);
      seen.add(relativePath);
      const absolutePath = authorizePath(path.join(projectRoot, relativePath));
      return { ...file, relativePath, absolutePath, originalExists: fs.existsSync(absolutePath) };
    });
    fs.mkdirSync(path.join(txnDir, "backup"), { recursive: true });
    audit(projectRoot, "txn.intent", txnId, staged, { files: staged.map((file) => file.relativePath) });
    for (const file of staged) {
      if (file.originalExists) {
        const backup = path.join(txnDir, "backup", file.relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(file.absolutePath, backup);
      }
    }
    const committed = [];
    try {
      for (const file of staged) {
        fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
        if (file.operation === "delete") fs.rmSync(file.absolutePath, { recursive: true, force: true });
        else fs.writeFileSync(file.absolutePath, String(file.proposedContent ?? ""), "utf8");
        committed.push(file);
      }
    } catch (error) {
      for (const file of committed.reverse()) {
        const backup = path.join(txnDir, "backup", file.relativePath);
        if (file.originalExists && fs.existsSync(backup)) fs.copyFileSync(backup, file.absolutePath);
        else fs.rmSync(file.absolutePath, { recursive: true, force: true });
      }
      audit(projectRoot, "txn.failed", txnId, staged, { error: error.message });
      throw error;
    }
    const manifest = { txnId, status: "committed", timestamp: Date.now(), files: staged.map((file) => ({ relativePath: file.relativePath, operation: file.operation || "write" })) };
    writeJson(path.join(txnDir, "manifest.json"), manifest);
    audit(projectRoot, "txn.commit_completed", txnId, staged, manifest);
    return { ok: true, txnId, files: staged.map((file) => ({ relativePath: file.relativePath, status: "committed" })) };
  }));

  ipcMain.handle("recover-transactions", (_event, rootInput) => safeResult(() => {
    const root = authorizeRoot(rootInput);
    const txRoot = path.join(root, ".letterblack", "transactions");
    if (!fs.existsSync(txRoot)) return [];
    return fs.readdirSync(txRoot).filter((folder) => !fs.existsSync(path.join(txRoot, folder, "manifest.json")));
  }, []));
  ipcMain.handle("read-audit-log", (_event, rootInput) => safeResult(() => {
    const file = path.join(authorizeRoot(rootInput), ".letterblack", "audit", "audit-log.ndjson");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }, []));
  ipcMain.handle("append-audit-log", () => ({ ok: false, code: "AUDIT_MAIN_PROCESS_OWNED", error: "Renderer-authored audit events are disabled" }));
  ipcMain.handle("append-memory-log", (_event, rootInput, entry) => safeResult(() => {
    const root = authorizeRoot(rootInput);
    const directory = path.join(root, ".letterblack", "memory");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "memory.ndjson"), `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`, "utf8");
    return { ok: true };
  }));
  ipcMain.handle("read-memory-log", (_event, rootInput) => safeResult(() => {
    const file = path.join(authorizeRoot(rootInput), ".letterblack", "memory", "memory.ndjson");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }, []));

  ipcMain.handle("load-providers", () => readJson(PROVIDERS_FILE, { version: "1.0", providers: [] }));
  ipcMain.handle("save-providers", (_event, config) => safeResult(() => { writeJson(PROVIDERS_FILE, config); return { ok: true }; }));
  ipcMain.handle("load-mcp-settings", () => readJson(MCP_SETTINGS_FILE, { version: "1.0", enabled: true, port: 3001, host: "127.0.0.1", tools: {} }));
  ipcMain.handle("save-mcp-settings", (_event, config) => safeResult(() => { writeJson(MCP_SETTINGS_FILE, config); return { ok: true }; }));
  ipcMain.handle("settings-load", () => readSettingsFile());
  ipcMain.handle("settings-save", (_event, payload) => writeSettingsFile(payload));
  ipcMain.handle("settings-reveal", () => safeResult(() => { if (!fs.existsSync(SETTINGS_FILE)) writeJson(SETTINGS_FILE, { config: {}, profiles: [] }); shell.showItemInFolder(SETTINGS_FILE); return { ok: true, path: SETTINGS_FILE }; }));

  ipcMain.handle("open-project-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Open Project Folder", properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return registerWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("check-dependencies", async () => ({ buildKit: { ok: fs.existsSync(path.join(runtimeRoot, "LBE Build Kit", "ext-build.mjs")), path: path.join(runtimeRoot, "LBE Build Kit") }, adobeDebug: { ok: true, status: app.isPackaged ? "production" : "development" } }));

  ipcMain.handle("git-status", async (_event, root) => { const result = await runGit(root, ["status", "--porcelain"]); return result.ok ? { ok: true, dirty: Boolean(result.stdout.trim()), changes: result.stdout.trim().split("\n").filter(Boolean) } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-branch", async (_event, root) => { const result = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]); return result.ok ? { ok: true, branch: result.stdout.trim() } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-log", async (_event, root) => { const result = await runGit(root, ["log", "-1", "--pretty=format:%h|%an|%ad|%s"]); return result.ok ? { ok: true, raw: result.stdout.trim() } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-create-branch", async (_event, root, name) => { if (!/^[A-Za-z0-9._/-]+$/.test(String(name || ""))) return { ok: false, error: "Invalid branch name" }; const result = await runGit(root, ["checkout", "-b", String(name)]); return result.ok ? { ok: true, branch: name } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-stage-files", async (_event, root, files) => { const safeFiles = (Array.isArray(files) ? files : []).map((file) => path.relative(authorizeRoot(root), authorizePath(path.join(authorizeRoot(root), file)))); const result = await runGit(root, ["add", "--", ...safeFiles]); return result.ok ? { ok: true } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-commit", async (_event, root, message) => { const result = await runGit(root, ["commit", "-m", String(message || "").trim()]); return result.ok ? { ok: true, output: result.stdout.trim() } : { ok: false, error: result.stderr }; });
  ipcMain.handle("git-push", async (_event, root, branch) => { if (!/^[A-Za-z0-9._/-]+$/.test(String(branch || ""))) return { ok: false, error: "Invalid branch name" }; const result = await runGit(root, ["push", "-u", "origin", String(branch)]); return result.ok ? { ok: true, output: result.stdout.trim() || result.stderr.trim() } : { ok: false, error: result.stderr }; });
}

function buildMenu(window) {
  const template = [{ label: "File", submenu: [{ label: "Open Project…", accelerator: "CmdOrCtrl+O", click: async () => { const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] }); if (!result.canceled && result.filePaths[0]) window.webContents.send("project-opened", registerWorkspace(result.filePaths[0])); } }, { type: "separator" }, { label: "Quit", role: "quit" }] }];
  if (!app.isPackaged) template.push({ label: "View", submenu: [{ label: "Reload", role: "reload" }, { label: "Toggle DevTools", role: "toggleDevTools" }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0b0c",
    show: false,
    title: "LetterBlack CEP IDE",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: path.join(__dirname, "preload.mjs")
    }
  });
  buildMenu(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("http://127.0.0.1:4173/")) event.preventDefault(); });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const load = () => mainWindow?.loadURL(`http://127.0.0.1:4173/?token=${SESSION_TOKEN}`).catch(() => setTimeout(load, 500));
  load();
  mainWindow.on("closed", () => { mainWindow = null; });
}

installIpcHandlers();
app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.whenReady().then(() => {
  if (!app.isPackaged && process.env.LBE_IDE_ENABLE_CDP === "1") app.commandLine.appendSwitch("remote-debugging-port", process.env.LBE_IDE_CDP_PORT || "9222");
  startServer();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (serverProcess) serverProcess.kill(); });
