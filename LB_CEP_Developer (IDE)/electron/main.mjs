import { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In production (packaged), __dirname is inside resources/app.asar/electron/
// We need to point projectRoot to where the app content lives.
const projectRoot = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.resolve(__dirname, "..");

app.disableHardwareAcceleration();
// userData should be in a standard system location in production
const userDataPath = app.isPackaged
  ? path.join(app.getPath("userData"), "local-data")
  : path.join(projectRoot, ".electron-data");

app.setPath("userData", userDataPath);

let mainWindow = null;
let serverProcess = null;

const SETTINGS_FILE = path.join(app.getPath("userData"), "ai-settings.json");

function encryptValue(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) return value;
  const buf = safeStorage.encryptString(value);
  return `enc:${buf.toString("base64")}`;
}

function decryptValue(value) {
  if (!value) return "";
  if (value.startsWith("enc:")) {
    const raw = value.slice(4);
    try {
      const buf = Buffer.from(raw, "base64");
      return safeStorage.decryptString(buf);
    } catch {
      return "";
    }
  }
  return value;
}

function readSettingsFile() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { config: {}, profiles: [] };
    const config = parsed.config || {};
    if (config.apiKey) config.apiKey = decryptValue(config.apiKey);
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    profiles.forEach((p) => {
      if (p.apiKey) p.apiKey = decryptValue(p.apiKey);
    });
    return { config, profiles };
  } catch {
    return { config: {}, profiles: [] };
  }
}

function writeSettingsFile(payload) {
  const safeConfig = { ...(payload?.config || {}) };
  if (safeConfig.apiKey) safeConfig.apiKey = encryptValue(safeConfig.apiKey);
  const safeProfiles = Array.isArray(payload?.profiles) ? payload.profiles.map((p) => {
    const next = { ...p };
    if (next.apiKey) next.apiKey = encryptValue(next.apiKey);
    return next;
  }) : [];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ config: safeConfig, profiles: safeProfiles }, null, 2), "utf8");
  return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
}

// ── Dev server ─────────────────────────────────────────────────────────────
function startServer() {
  const serverScript = path.join(projectRoot, "scripts", "dev-server.mjs");

  // Use node if available, otherwise fallback to electron (which can run node scripts)
  const execPath = app.isPackaged ? process.execPath : "node";

  console.log(`[electron] Starting server at: ${serverScript}`);

  serverProcess = spawn(execPath, [serverScript], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "pipe", // Capture logs for debugging
  });

  serverProcess.stdout.on("data", (data) => console.log(`[server] ${data}`));
  serverProcess.stderr.on("data", (data) => console.error(`[server-err] ${data}`));

  serverProcess.on("error", (err) => {
    console.error("[electron] server failed to start:", err.message);
    dialog.showErrorBox("Server Error", `Failed to start local background server: ${err.message}`);
  });
}

// ── IPC handlers ───────────────────────────────────────────────────────────
ipcMain.handle("read-dir", (_event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
});

ipcMain.handle("read-file", (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("write-file", (_event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (err) {
    console.error("[electron] write error:", err.message);
    return false;
  }
});

// ── Write Transaction ───────────────────────────────────────────────────────
// Helpers

function _txnId() {
  return `txn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function _eventId() {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function _txnHash(str) {
  return crypto.createHash("sha256").update(str || "", "utf8").digest("hex");
}

function _txnBackupPath(txnDir, relativePath) {
  return path.join(txnDir, "backup", ...relativePath.split("/"));
}

function _txnAudit(projectRoot, eventType, txnId, ctx, files, extraPayload = {}) {
  try {
    const dir = path.join(projectRoot, ".letterblack", "audit");
    fs.mkdirSync(dir, { recursive: true });

    let status = "pending";
    if (eventType === "txn.validation_passed") status = "validated";
    if (eventType === "txn.stage_completed") status = "staged";
    if (eventType === "txn.commit_completed") status = "committed";
    if (eventType === "txn.rollback_completed") status = "rolled_back";
    if (eventType === "txn.failed") status = "failed";
    if (eventType === "txn.recovery_detected") status = "interrupted";

    const entry = {
      eventId: _eventId(),
      eventType: eventType,
      timestamp: Date.now(),
      txnId: txnId,
      sessionId: ctx.sessionId || null,
      source: ctx.source || "chat",
      actor: ctx.actor || { type: "ai" },
      projectRoot: projectRoot,
      summary: {
        fileCount: files ? files.length : 0,
        status: status
      },
      payload: extraPayload
    };

    fs.appendFileSync(
      path.join(dir, "audit-log.ndjson"),
      JSON.stringify(entry) + "\n",
      "utf8"
    );
  } catch { /* audit must never crash the main process */ }
}

ipcMain.handle("execute-write-transaction", (_event, txn) => {
  const { projectRoot, files, actor, source, sessionId } = txn;
  const ctx = { actor, source, sessionId };
  const txnId = _txnId();
  const txnDir = path.join(projectRoot, ".letterblack", "transactions", txnId);
  const resolvedRoot = path.resolve(projectRoot);
  const committed = [];

  // ── Validate: all paths must stay inside projectRoot ─────────────────────
  const conflicts = [];
  const seen = new Set();

  for (const file of files) {
    if (seen.has(file.relativePath)) conflicts.push(file.relativePath);
    seen.add(file.relativePath);

    const absPath = path.resolve(projectRoot, ...file.relativePath.split("/"));
    if (!absPath.startsWith(resolvedRoot + path.sep) && absPath !== resolvedRoot) {
      const err = { code: "PATH_TRAVERSAL_BLOCKED", message: `Blocked: ${file.relativePath}` };
      _txnAudit(projectRoot, "txn.failed", txnId, ctx, files, { error: err });
      return { ok: false, txnId, error: err };
    }
    file.absolutePath = absPath;
  }

  if (conflicts.length > 0) {
    const err = { code: "DUPLICATE_TARGET_PATH", message: "Duplicate file paths in batch", conflicts };
    _txnAudit(projectRoot, "txn.failed", txnId, ctx, files, { error: err });
    return { ok: false, txnId, error: err };
  }

  // ── Audit: intent and validation ──────────────────────────────────────────
  _txnAudit(projectRoot, "txn.intent", txnId, ctx, files, {
    files: files.map(f => ({ path: f.relativePath, op: f.operation || "write" }))
  });

  _txnAudit(projectRoot, "txn.validation_passed", txnId, ctx, files, {
    validation: { projectOpen: true, sandbox: true, conflicts: [] }
  });

  // ── Stage: snapshot existing files into backup folder ─────────────────────
  try {
    fs.mkdirSync(txnDir, { recursive: true });
    for (const file of files) {
      if (fs.existsSync(file.absolutePath)) {
        file.originalContent = fs.readFileSync(file.absolutePath, "utf8");
        file.originalHash = _txnHash(file.originalContent);
        file.originalExists = true;
        const bkPath = _txnBackupPath(txnDir, file.relativePath);
        fs.mkdirSync(path.dirname(bkPath), { recursive: true });
        fs.writeFileSync(bkPath, file.originalContent, "utf8");
      } else {
        file.originalExists = false;
        file.originalContent = null;
        file.originalHash = null;
      }
      file.proposedHash = _txnHash(file.proposedContent);
      file.status = "staged";
    }
    _txnAudit(projectRoot, "txn.stage_completed", txnId, ctx, files, {
      files: files.map(f => ({ relativePath: f.relativePath, originalExists: f.originalExists, status: f.status }))
    });
  } catch (err) {
    const e = { code: "STAGE_FAILED", message: err.message };
    _txnAudit(projectRoot, "txn.failed", txnId, ctx, files, { error: e });
    return { ok: false, txnId, error: e };
  }

  // ── Commit: write all files ───────────────────────────────────────────────
  try {
    for (const file of files) {
      fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
      fs.writeFileSync(file.absolutePath, file.proposedContent, "utf8");
      file.status = "committed";
      committed.push(file.relativePath);
    }
  } catch (commitErr) {
    // Rollback committed writes in reverse order
    const rollback = { performed: true, restoredFiles: [], failedRestores: [] };
    for (const rp of committed.slice().reverse()) {
      const file = files.find(f => f.relativePath === rp);
      try {
        if (file.originalExists) {
          const bkPath = _txnBackupPath(txnDir, rp);
          fs.writeFileSync(file.absolutePath, fs.readFileSync(bkPath, "utf8"), "utf8");
        } else if (fs.existsSync(file.absolutePath)) {
          fs.unlinkSync(file.absolutePath);
        }
        file.status = "rolled_back";
        rollback.restoredFiles.push(rp);
      } catch (restoreErr) {
        rollback.failedRestores.push({ path: rp, error: restoreErr.message });
      }
    }
    const err = { code: "COMMIT_FAILED", message: commitErr.message };
    _txnAudit(projectRoot, "txn.rollback_completed", txnId, ctx, files, { rollback });
    _txnAudit(projectRoot, "txn.failed", txnId, ctx, files, { error: err });
    return { ok: false, txnId, rollback, error: err };
  }

  // ── Write manifest ────────────────────────────────────────────────────────
  try {
    fs.writeFileSync(
      path.join(txnDir, "manifest.json"),
      JSON.stringify({
        txnId, status: "committed", ts: Date.now(),
        files: files.map(f => ({
          relativePath: f.relativePath,
          operation: f.operation || "write",
          originalExists: f.originalExists,
          originalHash: f.originalHash,
          proposedHash: f.proposedHash,
        })),
      }, null, 2),
      "utf8"
    );
  } catch { /* non-fatal */ }

  // ── Audit: committed ──────────────────────────────────────────────────────
  _txnAudit(projectRoot, "txn.commit_completed", txnId, ctx, files, { committedFiles: committed });

  // Return lean result — strip proposedContent from response
  return {
    ok: true, txnId,
    files: files.map(f => ({
      relativePath: f.relativePath,
      absolutePath: f.absolutePath,
      status: f.status,
      originalExists: f.originalExists,
    })),
  };
});

ipcMain.handle("recover-transactions", (_event, projectRoot) => {
  try {
    const txRoot = path.join(projectRoot, ".letterblack", "transactions");
    if (!fs.existsSync(txRoot)) return [];
    const folders = fs.readdirSync(txRoot);
    const recovered = [];

    for (const folder of folders) {
      const manifestPath = path.join(txRoot, folder, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (manifest.status === "pending" || manifest.status === "validated" || manifest.status === "staging") {
            manifest.status = "interrupted";
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

            _txnAudit(projectRoot, "txn.recovery_detected", manifest.txnId, {}, manifest.files || [], { previousStatus: manifest.status });
            recovered.push(manifest.txnId);
          }
        } catch { }
      }
    }
    return recovered;
  } catch (err) {
    return [];
  }
});

ipcMain.handle("read-audit-log", (_event, projectRoot) => {
  try {
    const logPath = path.join(projectRoot, ".letterblack", "audit", "audit-log.ndjson");
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
});

ipcMain.handle("append-audit-log", (_event, projectRoot, entry) => {
  if (!projectRoot || !entry) return { ok: false, error: "Missing audit entry" };
  try {
    const dir = path.join(projectRoot, ".letterblack", "audit");
    fs.mkdirSync(dir, { recursive: true });
    const auditEntry = {
      eventId: `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      timestamp: Date.now(),
      projectRoot,
      ...entry,
    };
    fs.appendFileSync(
      path.join(dir, "audit-log.ndjson"),
      JSON.stringify(auditEntry) + "\n",
      "utf8"
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("append-memory-log", (_event, projectRoot, entry) => {
  try {
    const dir = path.join(projectRoot, ".letterblack", "memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "memory.ndjson"),
      JSON.stringify({ ...entry, timestamp: Date.now() }) + "\n",
      "utf8"
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("read-memory-log", (_event, projectRoot) => {
  try {
    const logPath = path.join(projectRoot, ".letterblack", "memory", "memory.ndjson");
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
});

ipcMain.handle("search-files", (_event, rootPath, query, options = {}) => {
  const results = [];
  const { isRegex, matchCase } = options;

  function walk(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        if (["node_modules", ".git", "dist"].includes(file.name)) continue;
        walk(fullPath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          let match = false;
          if (isRegex) {
            const re = new RegExp(query, matchCase ? "g" : "gi");
            match = re.test(content);
          } else {
            const q = matchCase ? query : query.toLowerCase();
            const c = matchCase ? content : content.toLowerCase();
            match = c.includes(q);
          }

          if (match) {
            const lines = content.split("\n");
            lines.forEach((line, i) => {
              if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  path: fullPath,
                  name: file.name,
                  line: i + 1,
                  text: line.trim()
                });
              }
            });
          }
        } catch { }
      }
    }
  }

  try {
    walk(rootPath);
  } catch (err) {
    console.error("[electron] search error:", err.message);
  }
  return results;
});

ipcMain.handle("reveal-in-folder", (_event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("create-file", (_event, filePath, content = "") => {
  try {
    if (fs.existsSync(filePath)) return { ok: false, error: "File already exists" };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("create-folder", (_event, folderPath) => {
  try {
    if (fs.existsSync(folderPath)) return { ok: false, error: "Folder already exists" };
    fs.mkdirSync(folderPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("rename-file", (_event, oldPath, newPath) => {
  try {
    fs.renameSync(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("delete-file", (_event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Provider config ────────────────────────────────────────────────────────

const PROVIDERS_FILE = path.join(projectRoot, "config", "providers.json");
const MCP_SETTINGS_FILE = path.join(projectRoot, "config", "mcp-settings.json");

ipcMain.handle("load-providers", () => {
  try {
    return JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8"));
  } catch {
    return { version: "1.0", providers: [] };
  }
});

ipcMain.handle("save-providers", (_event, config) => {
  try {
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(config, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("load-mcp-settings", () => {
  try {
    return JSON.parse(fs.readFileSync(MCP_SETTINGS_FILE, "utf8"));
  } catch {
    return { version: "1.0", enabled: true, port: 3001, host: "127.0.0.1", tools: {} };
  }
});

ipcMain.handle("save-mcp-settings", (_event, settings) => {
  try {
    fs.writeFileSync(MCP_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Native menu ────────────────────────────────────────────────────────────
function buildMenu(win) {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          async click() {
            const result = await dialog.showOpenDialog(win, {
              title: "Open Project",
              properties: ["openDirectory"],
            });
            if (!result.canceled && result.filePaths[0]) {
              win.webContents.send("project-opened", result.filePaths[0]);
            }
          },
        },
        {
          label: "Open File…",
          accelerator: "CmdOrCtrl+Shift+O",
          async click() {
            const result = await dialog.showOpenDialog(win, {
              title: "Open File",
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths[0]) {
              win.webContents.send("file-opened", result.filePaths[0]);
            }
          },
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => win.reload(),
        },
        {
          label: "Toggle DevTools",
          accelerator: "F12",
          click: () => win.webContents.toggleDevTools(),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 1),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 1),
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: () => win.webContents.setZoomLevel(0),
        },
      ],
    },
    {
      label: "Build Kit",
      submenu: [
        {
          label: "Run: doctor",
          accelerator: "CmdOrCtrl+1",
          click: () => win.webContents.send("run-command", "ext-build doctor"),
        },
        {
          label: "Run: check",
          accelerator: "CmdOrCtrl+2",
          click: () => win.webContents.send("run-command", "ext-build check"),
        },
        {
          label: "Run: dev-verify",
          accelerator: "CmdOrCtrl+3",
          click: () => win.webContents.send("run-command", "ext-build dev-verify"),
        },
        {
          label: "Run: simulate",
          accelerator: "CmdOrCtrl+4",
          click: () => win.webContents.send("run-command", "ext-build simulate"),
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Minimize", accelerator: "CmdOrCtrl+M", click: () => win.minimize() },
        { label: "Maximize / Restore", click: () => win.isMaximized() ? win.unmaximize() : win.maximize() },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Dependency Checks ──────────────────────────────────────────────────────
async function checkDependencies() {
  const results = {
    java: { ok: false, version: null, error: null },
    buildKit: { ok: false, path: projectRoot, error: null },
    adobeDebug: { ok: false, status: "unknown", error: null },
  };

  // 1. Check Java
  try {
    const javaCheck = spawn("java", ["-version"]);
    const versionPromise = new Promise((resolve) => {
      let data = "";
      javaCheck.stderr.on("data", (chunk) => { data += chunk.toString(); });
      javaCheck.on("close", (code) => {
        if (code === 0 || data.includes("version")) {
          const match = data.match(/version "([^"]+)"/);
          resolve({ ok: true, version: match ? match[1] : "detected" });
        } else {
          resolve({ ok: false, error: `Exit code ${code}` });
        }
      });
      javaCheck.on("error", (err) => resolve({ ok: false, error: err.message }));
    });
    const javaResult = await versionPromise;
    results.java = { ...results.java, ...javaResult };
  } catch (err) {
    results.java.error = err.message;
  }

  // 2. Check Build Kit sibling folder
  try {
    const bkPath = path.resolve(projectRoot, "..", "LBE Build Kit");
    const cliPath = path.join(bkPath, "ext-build.mjs");
    if (fs.existsSync(cliPath)) {
      results.buildKit = { ok: true, path: bkPath };
    } else {
      results.buildKit = { ok: false, error: "LBE Build Kit folder or ext-build.mjs missing in sibling directory" };
    }
  } catch (err) {
    results.buildKit.error = err.message;
  }

  // 3. Check Adobe PlayerDebugMode (Windows only)
  if (process.platform === "win32") {
    try {
      const regCheck = spawn("reg", ["query", "HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.11", "/v", "PlayerDebugMode"]);
      const regPromise = new Promise((resolve) => {
        let data = "";
        regCheck.stdout.on("data", (chunk) => { data += chunk.toString(); });
        regCheck.on("close", (code) => {
          if (code === 0 && data.includes("0x1")) {
            resolve({ ok: true, status: "enabled" });
          } else {
            resolve({ ok: false, status: "disabled or missing", error: "Run 'ext-build dev-verify' to fix" });
          }
        });
        regCheck.on("error", (err) => resolve({ ok: false, error: err.message }));
      });
      const regResult = await regPromise;
      results.adobeDebug = { ...results.adobeDebug, ...regResult };
    } catch (err) {
      results.adobeDebug.error = err.message;
    }
  } else {
    results.adobeDebug = { ok: true, status: "skipped (non-windows)" };
  }

  return results;
}

ipcMain.handle("check-dependencies", async () => {
  return await checkDependencies();
});

ipcMain.handle("git-status", async (_event, projectRoot) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  try {
    const git = spawn("git", ["status", "--porcelain"], { cwd: projectRoot });
    let output = "";
    return await new Promise((resolve) => {
      git.stdout.on("data", (d) => { output += d.toString(); });
      git.on("close", (code) => {
        if (code !== 0) return resolve({ ok: false, error: "git status failed" });
        const lines = output.trim().split("\n").filter(Boolean);
        resolve({ ok: true, dirty: lines.length > 0, changes: lines });
      });
      git.on("error", (err) => resolve({ ok: false, error: err.message }));
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function runGit(projectRoot, args) {
  return new Promise((resolve) => {
    const git = spawn("git", args, { cwd: projectRoot });
    let stdout = "";
    let stderr = "";
    git.stdout.on("data", (d) => { stdout += d.toString(); });
    git.stderr.on("data", (d) => { stderr += d.toString(); });
    git.on("error", (err) => resolve({ ok: false, code: -1, stdout, stderr: err.message || String(err) }));
    git.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

ipcMain.handle("git-branch", async (_event, projectRoot) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  try {
    const git = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot });
    let output = "";
    return await new Promise((resolve) => {
      git.stdout.on("data", (d) => { output += d.toString(); });
      git.on("close", (code) => {
        if (code !== 0) return resolve({ ok: false, error: "git branch failed" });
        resolve({ ok: true, branch: output.trim() });
      });
      git.on("error", (err) => resolve({ ok: false, error: err.message }));
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("git-log", async (_event, projectRoot) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  try {
    const git = spawn("git", ["log", "-1", "--pretty=format:%h|%an|%ad|%s"], { cwd: projectRoot });
    let output = "";
    return await new Promise((resolve) => {
      git.stdout.on("data", (d) => { output += d.toString(); });
      git.on("close", (code) => {
        if (code !== 0) return resolve({ ok: false, error: "git log failed" });
        const [hash, author, date, subject] = output.split("|");
        resolve({ ok: true, commit: { hash, author, date, subject } });
      });
      git.on("error", (err) => resolve({ ok: false, error: err.message }));
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("git-create-branch", async (_event, projectRoot, branchName) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  if (!branchName || !String(branchName).trim()) return { ok: false, error: "Missing branchName" };
  const safeName = String(branchName).trim();
  const res = await runGit(projectRoot, ["checkout", "-b", safeName]);
  if (!res.ok) {
    return { ok: false, error: res.stderr || res.stdout || "git checkout -b failed" };
  }
  return { ok: true, branch: safeName };
});

ipcMain.handle("git-stage-files", async (_event, projectRoot, files = []) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files provided" };
  const res = await runGit(projectRoot, ["add", "--", ...files]);
  if (!res.ok) {
    return { ok: false, error: res.stderr || res.stdout || "git add failed" };
  }
  return { ok: true };
});

ipcMain.handle("git-commit", async (_event, projectRoot, message) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  if (!message || !String(message).trim()) return { ok: false, error: "Missing commit message" };
  const res = await runGit(projectRoot, ["commit", "-m", String(message).trim()]);
  if (!res.ok) {
    return { ok: false, error: res.stderr || res.stdout || "git commit failed" };
  }
  return { ok: true, output: res.stdout.trim() };
});

ipcMain.handle("git-push", async (_event, projectRoot, branchName) => {
  if (!projectRoot) return { ok: false, error: "Missing projectRoot" };
  if (!branchName || !String(branchName).trim()) return { ok: false, error: "Missing branch name" };
  const branch = String(branchName).trim();
  const res = await runGit(projectRoot, ["push", "-u", "origin", branch]);
  if (!res.ok) {
    return { ok: false, error: res.stderr || res.stdout || "git push failed" };
  }
  return { ok: true, output: res.stdout.trim() || res.stderr.trim() };
});

ipcMain.handle("open-project-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Project Folder",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("settings-load", async () => {
  return readSettingsFile();
});

ipcMain.handle("settings-save", async (_event, payload) => {
  return writeSettingsFile(payload);
});

ipcMain.handle("settings-reveal", async () => {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ config: {}, profiles: [] }, null, 2), "utf8");
  }
  shell.showItemInFolder(SETTINGS_FILE);
  return { ok: true, path: SETTINGS_FILE };
});

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0b0c",
    show: false, // Don't show until ready-to-show
    title: "LetterBlack CEP IDE",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,           // false so preload can use Node imports
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  buildMenu(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  const url = "http://127.0.0.1:4173";

  const tryLoad = () => {
    if (!mainWindow) return;
    mainWindow.loadURL(url).catch(() => {
      console.log("[electron] Server not ready, retrying in 1s...");
      setTimeout(tryLoad, 1000);
    });
  };

  // Initial load after a small delay
  setTimeout(tryLoad, 500);

  mainWindow.webContents.on("did-finish-load", async () => {
    const deps = await checkDependencies();
    mainWindow.webContents.send("dependency-status", deps);
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Enable remote debugging on port 9222 for CDP access
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  startServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});
