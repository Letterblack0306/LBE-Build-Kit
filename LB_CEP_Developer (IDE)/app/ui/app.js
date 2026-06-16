import {
  store,
  createCommand,
  appendStdout,
  appendStderr,
  updateStatus,
  setResult,
  setError,
  finalizeCommand,
  selectCommand,
  addDebugCatcherItem,
  setDebugCatcherFilter,
} from "./commandStore.js";
import { editorStore } from "./editorStore.js";
import { terminalStore } from "./terminalStore.js";
import { settingsStore } from "./settingsStore.js";
import { loadProviders, listProviders, getProvider, fetchProviderModels, filterModelsByCapability, pickBestModel } from "./providerRegistry.js";
import { chatStore } from "./chatStore.js";
import { highlighter } from "./highlighter.js";
import { autocomplete } from "./autocomplete.js";
import { commandPalette } from "./commandPalette.js";
import { quickOpen } from "./quickOpen.js";
import { reportViewer } from "./reportViewer.js";
import { openCommandStream } from "./sseClient.js";
import { appendLine, appendLineForCommand, bindCommandTerminal, renderTerminal } from "./terminal.js";
import { renderDebug } from "./debug.js";
import { renderStatusBar, renderBridgeStatus } from "./statusbar.js";
import { openProject, onFileSelected, openFileInEditor, updateHighlights, currentProject } from "./explorer.js";
import { streamChat } from "./aiClient.js";
import { projectContext } from "./projectContext.js";
import { sessionMemory } from "./sessionMemory.js";
import { behaviorHints } from "./behaviorHints.js";
import { patchManager } from "./patchManager.js";
import { intelligenceStore } from "./intelligenceStore.js";
import { persistentMemory } from "./persistentMemory.js";
import { confidenceEngine } from "./confidenceEngine.js";
import { retryManager } from "./retryManager.js";
import { agentRegistry } from "./openclaw/core/agentRegistry.js";
import { toolDispatcher } from "./openclaw/core/toolDispatcher.js";
import { executionContract } from "./openclaw/core/executionContract.js";
import { jobManager } from "./openclaw/core/jobManager.js";
import { auditRunner } from "./openclaw/agents/auditRunner.js";
import { retryClassifier } from "./retryClassifier.js";
import { edePanel } from "./openclaw/ede/edePanel.js";

// ── Error normalization ────────────────────────────────────────────────────
function normalizeError(error, stage = "chat") {
  if (!error) return { code: "UNKNOWN", message: "Unknown error", stage };
  if (typeof error === "string") return { code: "ERROR", message: error, stage };
  return {
    code: error.code || error.name || "ERROR",
    message: error.message || String(error),
    stage,
    details: error.details || null
  };
}

function formatErrorForChat(errorObj) {
  const safe = normalizeError(errorObj);
  return `[${safe.stage}:${safe.code}] ${safe.message}`;
}

// ── File path sandbox ──────────────────────────────────────────────────────
function isSubPath(childPath, rootPath) {
  if (!childPath || !rootPath) return false;
  const normalize = v =>
    String(v).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
  const child = normalize(childPath);
  const root = normalize(rootPath);
  return child === root || child.startsWith(root + "/");
}

function sanitizeRelativeFilePath(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) throw { code: "EMPTY_PATH", message: "Missing file path", details: raw };

  const normalized = raw.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/"))
    throw { code: "ABSOLUTE_PATH_BLOCKED", message: "Absolute paths are not allowed", details: raw };
  if (normalized.includes("\0"))
    throw { code: "INVALID_PATH", message: "Path contains invalid characters", details: raw };

  const parts = normalized.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..")
      throw { code: "PATH_TRAVERSAL_BLOCKED", message: "Path traversal is not allowed", details: raw };
  }
  return parts.join("/");
}

// ── Protected path policy gate ─────────────────────────────────────────────
const PROTECTED_DIRS = ["node_modules", ".git", ".build-report", "release-out", "dist"];
const PROTECTED_EXTS = [".exe", ".dll", ".so", ".dylib", ".bat", ".com", ".msi"];

function protectedPathReason(relativePath) {
  const parts = relativePath.split("/");
  if (PROTECTED_DIRS.includes(parts[0])) return `Protected directory: ${parts[0]}`;
  const dot = relativePath.lastIndexOf(".");
  if (dot >= 0 && PROTECTED_EXTS.includes(relativePath.slice(dot).toLowerCase()))
    return `Protected file type: ${relativePath.slice(dot)}`;
  return null;
}

function resolveProjectWritePath(filePath) {
  if (!currentProject)
    throw { code: "NO_PROJECT", message: "Open a project before writing files" };
  const safeRelative = sanitizeRelativeFilePath(filePath);
  const reason = protectedPathReason(safeRelative);
  if (reason) throw { code: "PROTECTED_PATH_BLOCKED", message: reason, details: safeRelative };
  const joined =
    `${String(currentProject).replace(/[\\\/]+$/, "")}/${safeRelative}`.replace(/\\/g, "/");
  if (!isSubPath(joined, currentProject))
    throw { code: "OUT_OF_PROJECT_BLOCKED", message: "Write path must stay inside the current project", details: joined };
  return { relativePath: safeRelative, absolutePath: joined };
}

// ── Render orchestration ───────────────────────────────────────────────────
function renderPanels() {
  renderDebug();
  renderStatusBar();
}

// ── Resizers ───────────────────────────────────────────────────────────────
const panelExplorer = document.getElementById("panel-explorer");
const centerCol = document.getElementById("center-col");
const panelRight = document.getElementById("panel-right");
const bottomRow = document.getElementById("bottom-row");
const resizerLeft = document.getElementById("resizer-left");
const resizerRight = document.getElementById("resizer-right");
const resizerBottom = document.getElementById("resizer-bottom");

let activeResizer = null;

function startResize(name) { activeResizer = name; document.body.style.userSelect = 'none'; }
function stopResize() { activeResizer = null; document.body.style.userSelect = ''; document.body.style.cursor = ''; }

resizerLeft?.addEventListener("mousedown", () => { startResize('left'); document.body.style.cursor = 'col-resize'; });
resizerRight?.addEventListener("mousedown", () => { startResize('right'); document.body.style.cursor = 'col-resize'; });
resizerBottom?.addEventListener("mousedown", () => { startResize('bottom'); document.body.style.cursor = 'row-resize'; });

window.addEventListener("mousemove", (e) => {
  if (!activeResizer) return;
  if (activeResizer === 'left') {
    const w = Math.max(120, Math.min(e.clientX, window.innerWidth - 600));
    if (panelExplorer) panelExplorer.style.width = w + 'px';
  }
  if (activeResizer === 'right') {
    const rightW = Math.max(260, Math.min(window.innerWidth - e.clientX, 800));
    if (panelRight) panelRight.style.width = rightW + 'px';
  }
  if (activeResizer === 'bottom') {
    const mainTop = document.getElementById("main-grid")?.getBoundingClientRect().top ?? 40;
    const chatH = Math.max(120, Math.min(e.clientY - mainTop, window.innerHeight - mainTop - 80));
    const panelChat = document.getElementById("panel-chat");
    if (panelChat) { panelChat.style.flex = 'none'; panelChat.style.height = chatH + 'px'; }
  }
});

window.addEventListener("mouseup", stopResize);

// ── Notifications ──────────────────────────────────────────────────────────
const notificationsContainer = document.getElementById("notifications-container");

function showNotification(message, type = "info", duration = 3000) {
  if (!notificationsContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  notificationsContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setActionState(state = "idle", label = "ready") {
  const statusEl = document.getElementById("status-bar");
  if (!statusEl) return;
  statusEl.classList.remove("running", "success", "error");
  if (state === "running") statusEl.classList.add("running");
  if (state === "success") statusEl.classList.add("success");
  if (state === "error") statusEl.classList.add("error");
  statusEl.textContent = state === "idle" ? "● ready" : `● ${label}`;
}

function notifyActionResult(ok, successText, errorText, source = "ui") {
  if (ok) {
    setActionState("success", successText || "success");
    showNotification(`✔ ${successText || "Success"}`, "success");
    setTimeout(() => setActionState("idle", "ready"), 1200);
    return;
  }
  const message = errorText || "Operation failed";
  setActionState("error", `${source} error`);
  appendLine("error", `[ERROR]\nmessage: ${message}\nsource: ${source}`, Date.now());
  showNotification(`✗ ${message}`, "error", 4500);
}

async function syncFileFromDisk(absolutePath) {
  if (!isElectron || !window.ide?.readFile || !absolutePath) return false;
  const readRes = await window.ide.readFile(absolutePath);
  if (!readRes?.ok) return false;
  const content = readRes.content || "";
  const existing = editorStore.tabs.find((t) => t.path === absolutePath);
  if (existing) {
    editorStore.updateContent(absolutePath, content);
    editorStore.markSaved(absolutePath);
  } else {
    editorStore.addTab(absolutePath, absolutePath.split(/[\\/]/).pop(), content);
  }
  return true;
}

// ── Status Bar Bottom ───────────────────────────────────────────────────────
const sbFile = document.getElementById("sb-file");
const sbCursor = document.getElementById("sb-cursor");
const sbLang = document.getElementById("sb-lang");
const sbSentinel = document.getElementById("sb-sentinel");

// ── Git Status (Sys Panel) ────────────────────────────────────────────────
const gitBranchEl = document.getElementById("git-branch");
const gitStatusEl = document.getElementById("git-status");
const gitCommitEl = document.getElementById("git-commit");
const gitRefreshBtn = document.getElementById("git-refresh-btn");
const gitCurrentBranchEl = document.getElementById("git-current-branch");
const gitNewBranchInput = document.getElementById("git-new-branch-input");
const gitCreateBranchBtn = document.getElementById("git-create-branch-btn");
const gitStageListEl = document.getElementById("git-stage-list");
const gitCommitMessageEl = document.getElementById("git-commit-message");
const gitCommitPushBtn = document.getElementById("git-commit-push-btn");

let _gitChanges = [];

function renderGitStageList(changes = []) {
  if (!gitStageListEl) return;
  if (!changes.length) {
    gitStageListEl.innerHTML = `<div class="tree-hint">No changes detected</div>`;
    return;
  }
  gitStageListEl.innerHTML = changes.map((line, i) => {
    const raw = String(line || "");
    const path = raw.slice(3).trim();
    return `<label class="git-stage-item"><input type="checkbox" data-idx="${i}" checked /> <span class="git-stage-code">${raw.slice(0, 2)}</span> <span class="git-stage-path">${path}</span></label>`;
  }).join("");
}

function getSelectedGitFiles() {
  if (!gitStageListEl) return [];
  const selected = [];
  gitStageListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    if (!cb.checked) return;
    const idx = Number(cb.dataset.idx);
    const line = _gitChanges[idx];
    if (!line) return;
    const file = String(line).slice(3).trim();
    if (file) selected.push(file);
  });
  return selected;
}

function updateStatusBar(filePath, line, col, lang) {
  if (sbFile) sbFile.textContent = filePath ? filePath.split(/[\\/]/).slice(-2).join('/') : 'No file open';
  if (sbCursor) sbCursor.textContent = `Ln ${line ?? 1}, Col ${col ?? 1}`;
  if (sbLang) sbLang.textContent = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Plain';
}

async function refreshGitStatus() {
  if (!gitBranchEl || !gitStatusEl || !gitCommitEl) return;
  if (!isElectron || !currentProject || !window.ide?.gitStatus) {
    gitBranchEl.textContent = "—";
    gitStatusEl.textContent = "—";
    gitCommitEl.textContent = "—";
    return;
  }

  setActionState("running", "git refresh");

  gitBranchEl.textContent = "Loading...";
  gitStatusEl.textContent = "Loading...";
  gitCommitEl.textContent = "Loading...";

  const [branchRes, statusRes, logRes] = await Promise.all([
    window.ide.gitBranch(currentProject),
    window.ide.gitStatus(currentProject),
    window.ide.gitLog(currentProject),
  ]);

  gitBranchEl.textContent = branchRes?.ok ? branchRes.branch : "git unavailable";
  if (gitCurrentBranchEl) gitCurrentBranchEl.textContent = branchRes?.ok ? branchRes.branch : "—";
  gitStatusEl.textContent = statusRes?.ok ? (statusRes.dirty ? "Dirty" : "Clean") : "git unavailable";
  _gitChanges = statusRes?.ok ? (statusRes.changes || []) : [];
  renderGitStageList(_gitChanges);
  if (logRes?.ok && logRes.commit) {
    const c = logRes.commit;
    gitCommitEl.textContent = `${c.hash} — ${c.subject}`;
    gitCommitEl.title = `${c.hash} by ${c.author} on ${c.date}`;
  } else {
    gitCommitEl.textContent = "git unavailable";
  }

  notifyActionResult(true, "Git refreshed", "", "git");
}

gitRefreshBtn?.addEventListener("click", refreshGitStatus);

gitCreateBranchBtn?.addEventListener("click", async () => {
  if (!isElectron || !currentProject || !window.ide?.gitCreateBranch) return;
  setActionState("running", "git branch");
  const name = (gitNewBranchInput?.value || "").trim();
  if (!name) { notifyActionResult(false, "", "Enter branch name", "git"); return; }
  const res = await window.ide.gitCreateBranch(currentProject, name);
  if (!res?.ok) {
    notifyActionResult(false, "", `Branch create failed: ${res?.error || "unknown"}`, "git");
    return;
  }
  notifyActionResult(true, `Switched to ${name}`, "", "git");
  if (gitNewBranchInput) gitNewBranchInput.value = "";
  refreshGitStatus();
});

gitCommitPushBtn?.addEventListener("click", async () => {
  if (!isElectron || !currentProject) return;
  setActionState("running", "git commit/push");
  const branchRes = await window.ide.gitBranch(currentProject);
  const branch = branchRes?.ok ? String(branchRes.branch || "") : "";
  if (!branch) { notifyActionResult(false, "", "Could not detect branch", "git"); return; }
  if (branch === "main" || branch === "master") {
    notifyActionResult(false, "", "Commit blocked on main/master. Create a feature branch.", "git");
    return;
  }

  const files = getSelectedGitFiles();
  if (files.length === 0) {
    notifyActionResult(false, "", "No files selected for staging", "git");
    return;
  }
  const msg = (gitCommitMessageEl?.value || "").trim();
  if (!msg) {
    notifyActionResult(false, "", "Commit message required", "git");
    return;
  }

  const stage = await window.ide.gitStageFiles(currentProject, files);
  if (!stage?.ok) { notifyActionResult(false, "", `Stage failed: ${stage?.error || "unknown"}`, "git"); return; }

  const commit = await window.ide.gitCommit(currentProject, msg);
  if (!commit?.ok) { notifyActionResult(false, "", `Commit failed: ${commit?.error || "unknown"}`, "git"); return; }

  const push = await window.ide.gitPush(currentProject, branch);
  if (!push?.ok) { notifyActionResult(false, "", `Push failed: ${push?.error || "unknown"}`, "git"); return; }

  notifyActionResult(true, `Committed + pushed to origin/${branch}`, "", "git");
  if (gitCommitMessageEl) gitCommitMessageEl.value = "";
  refreshGitStatus();
});

// Sentinel health ping every 10s
async function checkSentinelStatus() {
  if (!sbSentinel) return;
  try {
    const r = await fetch('http://localhost:8181/health', { signal: AbortSignal.timeout(2000) });
    sbSentinel.className = r.ok ? 'sb-item sb-sentinel online' : 'sb-item sb-sentinel offline';
    sbSentinel.innerHTML = `<svg class="btn-icon"><use href="#ic-dot"/></svg> Sentinel`;
  } catch {
    sbSentinel.className = 'sb-item sb-sentinel offline';
  }
}
checkSentinelStatus();
setInterval(checkSentinelStatus, 10000);

// ── Theme ──────────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle("light-theme");
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

commandPalette.register('ui.toggle_theme', 'Toggle Light/Dark Theme', 'UI', toggleTheme);

// ── Left Panel Tabs (Explorer / Search) ───────────────────────────────────
const explorerTabs = document.getElementById("explorer-tabs");
const explorerContents = document.querySelectorAll(".explorer-content");

explorerTabs?.addEventListener("click", (e) => {
  const tab = e.target.closest(".terminal-tab");
  if (!tab) return;

  const targetId = tab.dataset.target;
  explorerTabs.querySelectorAll(".terminal-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");

  explorerContents.forEach(content => {
    content.classList.toggle("active", content.id === targetId);
  });

  if (targetId === "search-content") {
    const searchInput = document.getElementById("search-input");
    if (searchInput) searchInput.focus();
  }
});

// ── Search ─────────────────────────────────────────────────────────────────
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");
const searchCaseBtn = document.getElementById("search-case-btn");
const searchRegexBtn = document.getElementById("search-regex-btn");

let searchOptions = { matchCase: false, isRegex: false };

searchCaseBtn?.addEventListener("click", () => {
  searchOptions.matchCase = !searchOptions.matchCase;
  searchCaseBtn.classList.toggle("active", searchOptions.matchCase);
  performSearch();
});

searchRegexBtn?.addEventListener("click", () => {
  searchOptions.isRegex = !searchOptions.isRegex;
  searchRegexBtn.classList.toggle("active", searchOptions.isRegex);
  performSearch();
});

searchInput?.addEventListener("input", () => {
  clearTimeout(searchInput._timer);
  searchInput._timer = setTimeout(performSearch, 300);
});

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query || query.length < 2) {
    searchResultsEl.innerHTML = '<div class="tree-hint">Enter at least 2 characters</div>';
    return;
  }

  if (!isElectron || !currentProject) {
    searchResultsEl.innerHTML = '<div class="tree-hint">Search only available in Electron with an open project</div>';
    return;
  }

  searchResultsEl.innerHTML = '<div class="tree-hint">Searching...</div>';
  const results = await window.ide.searchFiles(currentProject, query, searchOptions);
  renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="tree-hint">No matches found</div>';
    return;
  }

  searchResultsEl.innerHTML = results.map(res => `
    <div class="search-result-item" data-path="${res.path}" data-line="${res.line}">
      <div class="search-result-file">${res.name}:${res.line}</div>
      <div class="search-result-match">${res.text.replace(new RegExp(query, "gi"), '<b>$&</b>')}</div>
    </div>
  `).join("");

  searchResultsEl.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click", async () => {
      const path = item.dataset.path;
      const result = await window.ide.readFile(path);
      onFileSelected(path, result);
    });
  });
}

// ── Right Panel Tab Management ────────────────────────────────────────────
const rightTabsBar = document.getElementById("right-tabs");
const rightFileTabsEl = document.getElementById("right-file-tabs");
const rcContents = document.querySelectorAll(".rc-content");

function activateRcTab(targetId) {
  // Deactivate all persistent tabs in the tab bar
  rightTabsBar?.querySelectorAll(".terminal-tab").forEach(t => t.classList.remove("active"));
  // Show the target content area
  rcContents.forEach(c => c.classList.toggle("active", c.id === targetId));
  if (targetId !== "rc-editor") {
    // Activate the matching persistent tab button
    rightTabsBar?.querySelector(`[data-target="${targetId}"]`)?.classList.add("active");
  }
}

rightTabsBar?.addEventListener("click", (e) => {
  const tab = e.target.closest(".terminal-tab");
  if (!tab || !tab.dataset.target) return;
  activateRcTab(tab.dataset.target);
});

// Show a file in the right panel (single-file-tab behavior)
function showFileInRightPanel(filePath, fileName) {
  if (!rightFileTabsEl) return;
  rightFileTabsEl.innerHTML = "";
  const fileTab = document.createElement("div");
  fileTab.className = "right-file-tab";
  fileTab.innerHTML = `<span class="right-file-tab-name" title="${filePath}">${fileName}</span><span class="right-file-tab-close" title="Close">×</span>`;
  fileTab.addEventListener("click", (e) => {
    if (e.target.classList.contains("right-file-tab-close")) {
      rightFileTabsEl.innerHTML = "";
      // Close all editor tabs
      editorStore.panes.forEach(p => { p.tabPaths = []; p.activeTabPath = null; });
      renderEditor();
      activateRcTab("rc-browser");
    } else {
      activateRcTab("rc-editor");
    }
  });
  rightFileTabsEl.appendChild(fileTab);
  activateRcTab("rc-editor");
}

// Collapse / expand right panel
document.getElementById("right-collapse-btn")?.addEventListener("click", () => {
  const isCollapsed = panelRight?.classList.toggle("rp-collapsed");
  const btn = document.getElementById("right-collapse-btn");
  if (btn) btn.innerHTML = isCollapsed
    ? `<svg class="btn-icon"><use href="#ic-chevron-left"/></svg>`
    : `<svg class="btn-icon"><use href="#ic-chevron-right"/></svg>`;
  const resRight = document.getElementById("resizer-right");
  if (resRight) resRight.style.display = isCollapsed ? "none" : "";
});

// ── Debug Browser ──────────────────────────────────────────────────────────
const debugWebview = document.getElementById("debug-webview");
const browserUrlInput = document.getElementById("browser-url-input");
const browserGoBtn = document.getElementById("browser-go-btn");
const browserReloadBtn = document.getElementById("browser-reload-btn");
const browserBackBtn = document.getElementById("browser-back-btn");
const browserForwardBtn = document.getElementById("browser-forward-btn");

function updateBrowserUrl(url) {
  if (debugWebview) debugWebview.src = url;
  if (browserUrlInput) browserUrlInput.value = url;
}

browserGoBtn?.addEventListener("click", () => {
  let url = browserUrlInput.value.trim();
  if (url && !url.startsWith("http")) url = "http://" + url;
  if (url) updateBrowserUrl(url);
});

browserUrlInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") browserGoBtn.click();
});

browserReloadBtn?.addEventListener("click", () => {
  if (debugWebview) debugWebview.reload();
});

browserBackBtn?.addEventListener("click", () => {
  if (debugWebview && debugWebview.canGoBack()) debugWebview.goBack();
});

browserForwardBtn?.addEventListener("click", () => {
  if (debugWebview && debugWebview.canGoForward()) debugWebview.goForward();
});

// Sync input with webview navigation
debugWebview?.addEventListener("did-navigate", (e) => {
  if (browserUrlInput) browserUrlInput.value = e.url;
});

debugWebview?.addEventListener("did-navigate-in-page", (e) => {
  if (browserUrlInput) browserUrlInput.value = e.url;
});

// Default to CEP debug port
if (debugWebview) {
  setTimeout(() => {
    updateBrowserUrl("http://localhost:8088");
  }, 1000);
}

// ── Chat ───────────────────────────────────────────────────────────────────
const chatMessagesEl = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatClearBtn = document.getElementById("chat-clear-btn");
const agentSelector = document.getElementById("agent-selector");
const chatModeSelector = document.getElementById("chat-mode-selector");
const chatActiveContextEl = document.getElementById("chat-active-context");

let _chatMode = localStorage.getItem("chat_mode") || "chat";
if (chatModeSelector) {
  chatModeSelector.value = _chatMode;
  chatModeSelector.addEventListener("change", () => {
    _chatMode = chatModeSelector.value;
    localStorage.setItem("chat_mode", _chatMode);
  });
}

// Auto-grow textarea
if (chatInput) {
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
  });
}

function renderChat() {
  if (!chatMessagesEl) return;

  const escape = (t) => String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const renderCodeMarkdown = (text) => {
    const escaped = escape(text);
    let safeContent = escaped.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_, lang, code) => `<pre class="chat-code${lang ? " lang-" + lang : ""}"><code>${code}</code></pre>`
    );
    safeContent = safeContent.replace(/`([^`\n]+)`/g, (_, code) => `<code class="chat-inline-code">${code}</code>`);
    return safeContent;
  };

  const renderActions = (m) => {
    if (!Array.isArray(m.actions) || m.actions.length === 0) return "";
    return `<div class="chat-actions">${m.actions.map((a) =>
      `<button class="chat-action-btn" data-msg-id="${m.id}" data-action-id="${a.id}">${escape(a.label)}</button>`
    ).join("")}</div>`;
  };

  const renderMessageBody = (m) => {
    const type = m.type || (m.role === "user" ? "USER" : "AI_TEXT");
    const c = m.content;
    const asText = typeof c === "string" ? c : (c?.text || "");

    if (type === "USER") {
      return `<div class="chat-block user">${escape(asText)}</div>`;
    }
    if (type === "AI_PLAN") {
      const steps = Array.isArray(c?.steps) ? c.steps : String(asText || "").split("\n").filter(Boolean);
      return `<div class="chat-block plan"><div class="chat-block-title">Plan</div><ul>${steps.map((s) => `<li>${escape(s)}</li>`).join("")}</ul></div>`;
    }
    if (type === "EXECUTION") {
      const steps = Array.isArray(c?.steps) ? c.steps : [];
      const icon = (s) => s === "success" ? "✓" : s === "failed" ? "✗" : s === "running" ? "⏳" : "•";
      return `<div class="chat-block execution"><div class="chat-block-title">Execution ${m.status ? `(${escape(m.status)})` : ""}</div>${steps.map((s) => `<div class="chat-step ${escape(s.status || "pending")}">${icon(s.status)} ${escape(s.name || "step")}</div>`).join("")}</div>`;
    }
    if (type === "RESULT") {
      return `<div class="chat-block result"><div class="chat-block-title">Result</div><div>${renderCodeMarkdown(asText)}</div></div>`;
    }
    if (type === "ERROR") {
      const msg = c?.message || asText;
      return `<div class="chat-block error"><div class="chat-block-title">Error</div><div>${escape(msg)}</div></div>`;
    }
    return `<div class="chat-block ai-text">${renderCodeMarkdown(asText)}</div>`;
  };

  chatMessagesEl.innerHTML = chatStore.messages.map((m) => {
    const type = m.type || (m.role === "user" ? "USER" : "AI_TEXT");
    const roleClass = m.role === "user" ? "user" : "ai";
    return `<div class="chat-msg ${roleClass} type-${type.toLowerCase()}" data-msg-id="${m.id}">${renderMessageBody(m)}${renderActions(m)}</div>`;
  }).join("");

  chatMessagesEl.querySelectorAll(".chat-action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const msgId = btn.dataset.msgId;
      const actionId = btn.dataset.actionId;
      const m = chatStore.messages.find((x) => x.id === msgId);
      if (!m || !Array.isArray(m.actions)) return;
      const action = m.actions.find((x) => x.id === actionId);
      if (!action) return;

      if (action.kind === "retry") {
        if (action.payload?.text) chatInput.value = action.payload.text;
        await sendChatMessage();
        return;
      }
      if (action.kind === "rollback") {
        if (isElectron && currentProject && window.ide?.recoverTransactions) {
          const recovered = await window.ide.recoverTransactions(currentProject);
          showNotification(`Rollback/recovery checked: ${recovered.length || 0} recovered`, "info");
        }
        return;
      }
      if (action.kind === "open_file") {
        const path = action.payload?.path;
        const line = action.payload?.line;
        if (!path || !isElectron) return;
        const res = await window.ide.readFile(path);
        if (res?.ok) {
          const name = path.split(/[\\/]/).pop();
          editorStore.addTab(path, name, res.content);
          renderEditor();
          showFileInRightPanel(path, name);
          if (line) setTimeout(() => performJump(path, Number(line) || 1), 50);
        }
      }
    });
  });

  if (chatActiveContextEl) {
    const activePane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    const activePath = activePane?.activeTabPath;
    chatActiveContextEl.textContent = `Context: ${activePath ? activePath.split(/[\\/]/).pop() : "none"}`;
  }
}

// ── Chat streaming state ───────────────────────────────────────────────────
let _chatStreaming = false;  // prevents concurrent messages
let _chatAbortCtrl = null;  // AbortController for cancel support
let _chatRetryCount = 0;
let _chatLastRequest = 0;
let _chatLastText = "";

const RATE_LIMIT = {
  windowMs: 60000,
  maxRequests: 10,
};
const _rateHistory = [];

const RETRY_BACKOFF_MS = {
  openai: [1200, 2500],
  gemini: [1500, 3000],
  local: [600, 1200],
};

function _isTransientChatError(err) {
  return /429|rate|timeout|ECONNRESET|ETIMEDOUT|temporar|overload|unavailable/i.test(String(err?.message || err || ""));
}

function _getRetryDelay(provider, attempt) {
  const list = RETRY_BACKOFF_MS[provider] || RETRY_BACKOFF_MS.openai;
  const idx = Math.min(Math.max(attempt - 1, 0), list.length - 1);
  return list[idx];
}

function canSendNow() {
  const now = Date.now();
  _rateHistory.push(now);
  while (_rateHistory.length && now - _rateHistory[0] > RATE_LIMIT.windowMs) _rateHistory.shift();
  return _rateHistory.length <= RATE_LIMIT.maxRequests;
}

async function sendChatMessage() {
  if (_chatStreaming) return; // LOCK: block while streaming

  const text = chatInput.value.trim();
  if (!text) return;
  _chatLastText = text;

  if (!canSendNow()) {
    showNotification("Rate limit reached. Please wait a moment.", "warning");
    chatStore.addMessage("ai", "Rate limit hit. Wait ~60s and try again.");
    renderChat();
    return;
  }

  // Slash commands (local tools) — no LLM call
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(" ");
    const arg = rest.join(" ").trim();
    chatInput.value = "";
    renderChat();

    if (cmd === "/search") {
      if (!isElectron || !window.ide?.searchFiles || !currentProject) {
        chatStore.addMessage("ai", "Search is available only in the desktop app with an open project.");
        renderChat();
        return;
      }
      const results = await window.ide.searchFiles(currentProject, arg, { isRegex: false, matchCase: false });
      const lines = results.slice(0, 40).map(r => `${r.path}:${r.line} — ${r.text}`).join("\n");
      chatStore.addMessage("ai", results.length ? `Search results for "${arg}":\n\`\`\`\n${lines}\n\`\`\`` : `No results for "${arg}".`);
      renderChat();
      return;
    }

    if (cmd === "/read") {
      if (!isElectron || !window.ide?.readFile || !currentProject) {
        chatStore.addMessage("ai", "Read is available only in the desktop app with an open project.");
        renderChat();
        return;
      }
      try {
        const resolved = resolveProjectWritePath(arg);
        const res = await window.ide.readFile(resolved.absolutePath);
        if (res.ok) {
          const content = res.content || "";
          const snippet = content.split("\n").slice(0, 120).join("\n");
          chatStore.addMessage("ai", `\`\`\`\n${snippet}\n\`\`\``);
        } else {
          chatStore.addMessage("ai", `Read failed: ${res.error}`);
        }
      } catch (err) {
        chatStore.addMessage("ai", `Read failed: ${err.message}`);
      }
      renderChat();
      return;
    }

    if (cmd === "/open") {
      if (!isElectron || !window.ide?.readFile) {
        chatStore.addMessage("ai", "Open is available only in the desktop app.");
        renderChat();
        return;
      }
      try {
        const [pathPart, linePart] = arg.split(":");
        const line = linePart ? parseInt(linePart, 10) : null;
        const resolved = resolveProjectWritePath(pathPart.trim());
        const res = await window.ide.readFile(resolved.absolutePath);
        if (res.ok) {
          editorStore.addTab(resolved.absolutePath, resolved.relativePath.split("/").pop(), res.content);
          renderEditor();
          if (line && !isNaN(line)) setTimeout(() => performJump(resolved.absolutePath, line), 100);
          chatStore.addMessage("ai", `Opened ${resolved.relativePath}${line ? `:${line}` : ""}.`);
        } else {
          chatStore.addMessage("ai", `Open failed: ${res.error}`);
        }
      } catch (err) {
        chatStore.addMessage("ai", `Open failed: ${err.message}`);
      }
      renderChat();
      return;
    }
  }

  // Build active file context — reliable source: editorStore tabs (includes unsaved changes)
  let fileContext = "";
  let activeContextMeta = null;
  const activePane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
  if (activePane?.activeTabPath) {
    const tab = editorStore.tabs.find(t => t.path === activePane.activeTabPath);
    if (tab?.content) {
      let cursor = { line: 1, col: 1, offset: 0 };
      if (activeEditorTextarea && document.activeElement === activeEditorTextarea) {
        const pos = activeEditorTextarea.selectionStart || 0;
        const before = tab.content.slice(0, pos);
        const parts = before.split("\n");
        cursor = { line: parts.length, col: (parts[parts.length - 1] || "").length + 1, offset: pos };
      }
      activeContextMeta = { file: tab.path, cursor };
      // Hard trim at 8000 chars to prevent token overflow
      fileContext = `\n\nCurrently open file: ${tab.path}\nCursor: line ${cursor.line}, col ${cursor.col}\n\`\`\`\n${tab.content.slice(0, 8000)}\n\`\`\``;
    }
  }

  chatStore.addMessage("user", { text }, { type: "USER", meta: { mode: _chatMode, context: activeContextMeta } });
  chatInput.value = "";
  renderChat();
  setActionState("running", "chat");

  // Always read FRESH config — prevents stale cached values
  await settingsStore.load();
  let cfg = { ...settingsStore.config };

  if (!cfg.apiKey && cfg.provider !== "local") {
    chatStore.addMessage("ai", "⚠ No API key configured. Click ⚙ in the top bar to open Settings.");
    renderChat();
    return;
  }

  // Build messages array for API (last 10 turns + system prompt)
  const preset = settingsStore.config.preset || "balanced";
  const presetPrompt = {
    balanced: "Be precise, prefer PATCH mode, and ask before risky changes.",
    strict: "Be conservative. Avoid large changes. Prefer read-only guidance and PATCH-only edits.",
    refactor: "Optimize structure and maintainability. Group changes into coherent patches.",
    debug: "Prioritize diagnosis, reproduction steps, and minimal fixes. Avoid large edits."
  }[preset] || "Be precise and minimal.";

  const systemContent = `You are an expert Adobe CEP extension developer embedded in the LetterBlack CEP IDE.

[EXECUTION-FIRST RULES]
- Every response must map to execution intent.
- Return structured sections in order: PLAN, EXECUTION, RESULT.
- Avoid generic assistant chatter.
- Use concise actionable steps.
- Chat mode: ${_chatMode}

[WRITE MODES]
1. FULL FILE: For new files or total rewrites, start the fenced code block with: // FILE: path/to/filename.ext
2. PATCH: For surgical edits to existing functions, use this format inside the block:
// PATCH: path/to/filename.js
// TARGET: functionName
// ---
<entire new function code>
// ---

Be concise and prefer PATCH mode for existing files.
Preset: ${preset} — ${presetPrompt}
Tool schema: use fenced tool blocks only. Example:
\`\`\`tool
{"tool":"file_search","args":{"query":"term","regex":false,"matchCase":false}}
\`\`\`
Allowed tools: file_search, file_read, file_open.
Never use tools without explicit user intent.
${projectContext.getSystemPromptSnippet()}${behaviorHints.getHintsPrompt(sessionMemory.getSummary())}${persistentMemory.getPastBehaviorSnippet()}${fileContext}`;

  const apiMessages = [
    { role: "system", content: systemContent },
    ...chatStore.messages
      .filter(m => m.role === "user" || m.role === "ai")
      .slice(-10)
      .map(m => {
        const content = typeof m.content === "string" ? m.content : (m.content?.text || JSON.stringify(m.content));
        return { role: m.role === "ai" ? "assistant" : "user", content };
      }),
    { role: "user", content: text },
  ];

  const planStepsByMode = {
    chat: ["understand request", "answer with actionable guidance"],
    build: ["analyze build intent", "run/prepare command", "summarize output"],
    fix: ["locate issue", "propose patch", "validate result"],
    plan: ["define intent", "draft execution plan", "prepare next actions"]
  };
  const planSteps = planStepsByMode[_chatMode] || planStepsByMode.chat;
  chatStore.addPlanMessage({ steps: planSteps }, { mode: _chatMode });
  const execMsgIdx = chatStore.addExecutionMessage({
    steps: planSteps.map((s, i) => ({ name: `step ${i + 1}: ${s}`, status: i === 0 ? "running" : "pending" }))
  }, "executing", { mode: _chatMode });
  renderChat();

  // Add empty AI placeholder for streaming
  chatStore.addMessage("ai", "", { type: "AI_TEXT", status: "streaming" });
  const placeholderIdx = chatStore.messages.length - 1;
  renderChat();

  // Lock UI + show stop button
  _chatStreaming = true;
  _chatAbortCtrl = new AbortController();
  chatSendBtn.disabled = true;
  chatSendBtn.textContent = "■ Stop";
  const origClickHandler = chatSendBtn.onclick;
  chatSendBtn.onclick = () => { if (_chatAbortCtrl) _chatAbortCtrl.abort(); };

  let fullResponse = "";
  let rafPending = false;

  // Smart scroll: only auto-scroll when user is near the bottom
  function scrollIfNeeded() {
    if (!chatMessagesEl) return;
    const nearBottom = chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight < 80;
    if (nearBottom) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // Smart model selection: governance system first, pickBestModel as fallback
  if (cfg.smartModelSelection !== false) {
    let governed = false;
    if (typeof window.__LB_applyGovernedModelSelection === "function") {
      try {
        const gov = window.__LB_applyGovernedModelSelection(cfg, _chatMode);
        cfg = gov.cfg;
        governed = true;
      } catch {
        // governance failed — fall through to pickBestModel
      }
    }
    if (!governed && _providerModels.length > 0) {
      const taskCapability = (_chatMode === "build" || _chatMode === "fix") ? "code" : cfg.capability || "chat";
      const bestModel = pickBestModel(_providerModels, taskCapability);
      if (bestModel) {
        cfg = { ...cfg, model: bestModel };
        updateModelBadge(bestModel, true);
      }
    }
  } else {
    updateModelBadge(cfg.model, false);
  }

  // streamChat routes by protocol, not provider id — resolve it from the registry
  const _provDef = getProvider(cfg.provider);
  cfg = { ...cfg, protocol: _provDef?.protocol || cfg.provider };

  const activeJob = jobManager.createJob("ai_chat", settingsStore.config.provider);

  try {
    for await (const chunk of streamChat(apiMessages, cfg)) {
      if (_chatAbortCtrl?.signal.aborted) break;
      fullResponse += chunk;
      chatStore.messages[placeholderIdx].content = fullResponse;

      // Throttle DOM updates with requestAnimationFrame (prevents UI lag on long responses)
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          renderChat();
          scrollIfNeeded();
        });
      }
    }

    // Final save + render after stream ends
    if (!String(fullResponse || "").trim()) {
      fullResponse = "I couldn't generate a response this turn. Please retry, or verify API settings.";
      chatStore.messages[placeholderIdx].content = fullResponse;
    }
    chatStore.updateMessage(execMsgIdx, {
      status: "completed",
      content: {
        steps: planSteps.map((s, i) => ({ name: `step ${i + 1}: ${s}`, status: "success" }))
      }
    });
    chatStore.addResultMessage("status: completed", "completed", { mode: _chatMode }, [
      { id: "retry", label: "Retry", kind: "retry", payload: { text: _chatLastText } }
    ]);
    chatStore.save();
    renderChat();
    scrollIfNeeded();

    // Detect // FILE: blocks and offer write buttons for each
    detectAndOfferFileWrite(fullResponse, false, activeJob.id);
    detectAndOfferToolCalls(fullResponse, activeJob.id);
    notifyActionResult(true, "Chat complete", "", "chat");

  } catch (err) {
    jobManager.failJob(activeJob.id, err);
    if (_chatAbortCtrl?.signal.aborted || err.name === "AbortError") {
      sessionMemory.logError("ABORT_ERROR", "User stopped generation", "chat");
      persistentMemory.log(currentProject, { type: "error", code: "ABORT_ERROR", message: "User stopped generation", stage: "chat" });
      chatStore.messages[placeholderIdx].content = fullResponse
        ? fullResponse + "\n\n[Generation stopped]"
        : "[Stopped]";
    } else {
      const safe = normalizeError(err, "chat");
      sessionMemory.logError(safe.code, safe.message, safe.stage);
      persistentMemory.log(currentProject, { type: "error", code: safe.code, message: safe.message, stage: safe.stage });
      addDebugCatcherItem({
        id: `catch_${Date.now()}`,
        source: "ai",
        message: safe.message,
        time: Date.now(),
        details: safe,
      });
      chatStore.messages[placeholderIdx].content = formatErrorForChat(safe);
      chatStore.updateMessage(execMsgIdx, {
        status: "failed",
        content: {
          steps: planSteps.map((s, i) => ({ name: `step ${i + 1}: ${s}`, status: i === 0 ? "success" : (i === 1 ? "failed" : "pending") }))
        }
      });
      chatStore.addErrorMessage({ message: safe.message }, { code: safe.code, stage: safe.stage }, [
        { id: "retry", label: "Retry", kind: "retry", payload: { text: _chatLastText } },
        { id: "rollback", label: "Rollback", kind: "rollback", payload: {} }
      ]);
      showNotification(`${safe.code}: ${safe.message}`, "error");
      notifyActionResult(false, "", safe.message, "chat");
    }
    // Retry policy (per-provider backoff, limited retries on transient errors)
    const provider = settingsStore.config.provider || "openai";
    const maxRetries = (RETRY_BACKOFF_MS[provider] || RETRY_BACKOFF_MS.openai).length;
    if (_isTransientChatError(err) && _chatRetryCount < maxRetries) {
      _chatRetryCount += 1;
      const delay = _getRetryDelay(provider, _chatRetryCount);
      chatStore.addMessage("ai", `Transient error detected. Retrying in ${delay}ms (attempt ${_chatRetryCount}/${maxRetries})...`);
      renderChat();
      _chatStreaming = false;
      _chatAbortCtrl = null;
      await new Promise(r => setTimeout(r, delay));
      await sendChatMessage();
      return;
    }
    chatStore.save();
    renderChat();
  } finally {
    _chatStreaming = false;
    _chatAbortCtrl = null;
    _chatRetryCount = 0;
    chatSendBtn.disabled = false;
    chatSendBtn.textContent = "Send";
    chatSendBtn.onclick = origClickHandler;
  }
}

// ── AI File Write Detection ─────────────────────────────────────────────────
async function detectAndOfferFileWrite(response, isRetry = false, parentJobId = null) {
  if (!response || !isElectron || !window.ide?.writeFile) return;

  // Single job ID + provider for the entire detection pass
  const _jobId = parentJobId || `job_${Date.now()}`;
  const _provider = settingsStore.config.provider;
  const files = [];

  // 1. Parse FULL FILE blocks
  const fileRegex = /```[\w-]*\n\/\/ FILE: ([^\n]+)\n([\s\S]*?)```/g;
  let fMatch;
  while ((fMatch = fileRegex.exec(response)) !== null) {
    files.push({ filePath: fMatch[1].trim(), content: fMatch[2] });
  }

  // 2. Parse and apply PATCH blocks — all tool ops route through dispatcher
  //    patchManager.parse() is a pure parser (not a tool), stays direct.
  const patches = patchManager.parse(response);
  for (const p of patches) {
    try {
      const resolved = resolveProjectWritePath(p.relativePath);

      // Read current file content via dispatcher
      let currentContent = "";
      const tab = editorStore.tabs.find(t => t.path === resolved.absolutePath);
      if (tab) {
        currentContent = tab.content;
      } else {
        const readRes = await toolDispatcher.run(_jobId, _provider, "file_read", { path: resolved.absolutePath });
        if (readRes.ok) currentContent = readRes.output?.content ?? readRes.output;
      }

      // Validate patch body via dispatcher (replaces direct patchManager.validate)
      const valRes = await toolDispatcher.run(_jobId, _provider, "validator", { patch: p.proposedContent });
      if (!valRes.ok || valRes.output?.ok === false) {
        const reason = valRes.output?.error || valRes.error || "Validation failed";
        showNotification(`Patch blocked: ${reason}`, "error");
        continue;
      }

      // Apply patch via dispatcher (replaces direct patchManager.applyPatch)
      const patchRes = await toolDispatcher.run(_jobId, _provider, "patchEngine", { original: currentContent, patch: p });
      if (!patchRes.ok) {
        showNotification(`Failed to apply patch to ${p.relativePath}: ${patchRes.error}`, "error");
        continue;
      }
      const updatedContent = patchRes.output?.content ?? patchRes.output;

      files.push({
        filePath: p.relativePath,
        content: updatedContent,
        isPatch: true,
        target: p.target,
        range: p.start !== null ? `${p.start}-${p.end}` : null
      });
    } catch (err) {
      console.error("Failed to apply patch:", err);
      showNotification(`Failed to apply patch to ${p.relativePath}: ${err.message}`, "error");
    }
  }

  if (files.length === 0) return;

  // 3. Sub-agent syntax validation gate — runs AFTER assembly, BEFORE write group UI
  //    Every proposed write (FILE + PATCH) must pass syntax-agent validation.
  //    Blocked files are excluded from the write group and shown as inline notices.
  //    Blocked files NEVER enter the retry loop (they are dropped here, before
  //    executeTransaction is ever reached).
  const validatedFiles = [];
  const blockedFiles = [];

  for (const f of files) {
    const res = await toolDispatcher.runSubAgent(
      _jobId, _provider, "syntax-agent", "validator", { patch: f.content }
    );

    const passed = res.ok && (res.output?.ok !== false);
    if (passed) {
      validatedFiles.push(f);
    } else {
      const rawReason = res.output?.error || res.error || "Validation failed";
      const category = _classifyBlockReason(rawReason);

      blockedFiles.push({ ...f, blockReason: rawReason, blockCategory: category });

      // Severity escalation — track repeated SECURITY violations
      if (category === "SECURITY") {
        sessionMemory.logSecurityViolation();
        if (sessionMemory.isEscalated()) {
          showNotification("SECURITY ESCALATION: Auto-commit disabled for this session.", "error");
        }
      }

      // Step debugger entry
      jobManager.logStep(_jobId, `validation_blocked | ${category} | ${f.filePath} | ${rawReason}`);

      // Persistent memory — AI learns what gets blocked over time
      persistentMemory.log(currentProject, {
        type: "blocked_file",
        file: f.filePath,
        reason: rawReason,
        category: category,
        stage: "syntax-agent",
      });

      appendLine("sys", `[syntax-agent] [${category}] blocked ${f.filePath}: ${rawReason}`, Date.now());
      showNotification(`[${category}] Blocked: ${f.filePath} — ${rawReason}`, "error");
    }
  }

  if (blockedFiles.length > 0) _renderBlockedNotices(blockedFiles);
  if (validatedFiles.length === 0) return;

  offerGroupedFileWrites(validatedFiles, isRetry, parentJobId);
}

// ── AI Tool Call Detection ─────────────────────────────────────────────────
function parseToolCalls(text) {
  const calls = [];
  // Format A:
  // ```tool
  // {"tool":"file_search","args":{...}}
  // ```
  const blockA = /```tool\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = blockA.exec(text)) !== null) {
    try {
      const payload = JSON.parse(m[1]);
      if (payload && payload.tool) {
        calls.push({ tool: payload.tool, args: payload.args || {} });
      }
    } catch { }
  }
  // Format B:
  // ```tool:file_search
  // { ... }
  // ```
  const blockB = /```tool:([a-zA-Z0-9_-]+)\s*\n([\s\S]*?)```/g;
  while ((m = blockB.exec(text)) !== null) {
    try {
      const payload = JSON.parse(m[2]);
      calls.push({ tool: m[1], args: payload || {} });
    } catch { }
  }
  return calls;
}

const TOOL_ALLOWLIST = new Set(["file_search", "file_read", "file_open"]);
const TOOL_OUTPUT_CACHE = {
  file_read: new Map(),
  file_search: new Map(),
};

function _toolCacheKey(tool, args) {
  if (tool === "file_read") return String(args.path || "");
  if (tool === "file_search") {
    const q = String(args.query || "");
    const r = args.regex ? "1" : "0";
    const c = args.matchCase ? "1" : "0";
    return `${currentProject || ""}|${q}|${r}|${c}`;
  }
  return JSON.stringify(args || {});
}

function _simpleLineDiff(prevText, nextText, limit = 200) {
  const a = String(prevText || "").split("\n");
  const b = String(nextText || "").split("\n");
  const max = Math.min(Math.max(a.length, b.length), limit);
  const out = [];
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      out.push(` ${left ?? ""}`);
    } else {
      if (left !== undefined) out.push(`-${left}`);
      if (right !== undefined) out.push(`+${right}`);
    }
  }
  if (a.length > limit || b.length > limit) out.push("… diff truncated");
  return out.join("\n");
}

function _escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function _showToolDiff(title, diffText) {
  const overlay = document.createElement("div");
  overlay.className = "diff-preview-overlay";

  const box = document.createElement("div");
  box.className = "diff-preview-box";

  const header = document.createElement("div");
  header.className = "diff-header";
  header.innerHTML = `
    <span class="diff-title">${title}</span>
    <button class="topbar-btn">Close</button>
  `;
  header.querySelector("button").onclick = () => overlay.remove();

  const body = document.createElement("div");
  body.className = "diff-body";
  const lines = String(diffText || "").split("\n").map(line => {
    const escaped = _escapeHtml(line);
    if (line.startsWith("+")) return `<span class="diff-added">${escaped}</span>`;
    if (line.startsWith("-")) return `<span class="diff-removed">${escaped}</span>`;
    return `<span>${escaped}</span>`;
  });
  body.innerHTML = lines.join("\n");

  box.appendChild(header);
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

async function runToolCall(call, jobId) {
  const tool = call.tool;
  const args = call.args || {};

  if (!TOOL_ALLOWLIST.has(tool)) {
    return { ok: false, message: `Tool not allowed: ${tool}` };
  }
  if (!isElectron || !currentProject) {
    return { ok: false, message: "Tool calls require the desktop app with an open project." };
  }

  if (tool === "file_search") {
    const query = String(args.query || "").trim();
    if (!query) return { ok: false, message: "Missing query" };
    const res = await toolDispatcher.run(jobId, settingsStore.config.provider, "file_search", {
      rootPath: currentProject,
      query,
      options: { isRegex: Boolean(args.regex), matchCase: Boolean(args.matchCase) }
    });
    if (!res.ok) return { ok: false, message: res.error || "Search failed" };
    const results = res.output || [];
    const lines = results.slice(0, 40).map(r => `${r.path}:${r.line} — ${r.text}`).join("\n");
    const outputText = results.length ? lines : "";
    const key = _toolCacheKey("file_search", args);
    const prev = TOOL_OUTPUT_CACHE.file_search.get(key);
    TOOL_OUTPUT_CACHE.file_search.set(key, outputText);
    const diffAvailable = prev !== undefined && prev !== outputText;
    const diffText = diffAvailable ? _simpleLineDiff(prev, outputText) : "";
    return {
      ok: true,
      message: results.length
        ? `Search results for "${query}":\n\`\`\`\n${lines}\n\`\`\``
        : `No results for "${query}".`,
      diff: diffAvailable ? { title: `Diff: search "${query}"`, text: diffText } : null
    };
  }

  if (tool === "file_read") {
    const path = String(args.path || "").trim();
    if (!path) return { ok: false, message: "Missing path" };
    try {
      const resolved = resolveProjectWritePath(path);
      const res = await toolDispatcher.run(jobId, settingsStore.config.provider, "file_read", { path: resolved.absolutePath });
      if (!res.ok) return { ok: false, message: res.error || "Read failed" };
      const content = res.output?.content || res.output || "";
      const snippet = String(content).split("\n").slice(0, 120).join("\n");
      const key = _toolCacheKey("file_read", args);
      const prev = TOOL_OUTPUT_CACHE.file_read.get(key);
      TOOL_OUTPUT_CACHE.file_read.set(key, String(content));
      const diffAvailable = prev !== undefined && prev !== String(content);
      const diffText = diffAvailable ? _simpleLineDiff(prev, String(content)) : "";
      return {
        ok: true,
        message: `\`\`\`\n${snippet}\n\`\`\``,
        diff: diffAvailable ? { title: `Diff: ${resolved.relativePath}`, text: diffText } : null
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  if (tool === "file_open") {
    const path = String(args.path || "").trim();
    const line = args.line ? parseInt(args.line, 10) : null;
    if (!path) return { ok: false, message: "Missing path" };
    try {
      const resolved = resolveProjectWritePath(path);
      const res = await window.ide.readFile(resolved.absolutePath);
      if (!res.ok) return { ok: false, message: res.error || "Open failed" };
      editorStore.addTab(resolved.absolutePath, resolved.relativePath.split("/").pop(), res.content);
      renderEditor();
      if (line && !isNaN(line)) setTimeout(() => performJump(resolved.absolutePath, line), 100);
      return { ok: true, message: `Opened ${resolved.relativePath}${line ? `:${line}` : ""}.` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  return { ok: false, message: "Unhandled tool" };
}

function detectAndOfferToolCalls(response, parentJobId = null) {
  if (!response) return;
  const calls = parseToolCalls(response);
  if (calls.length === 0) return;

  const aiMessages = document.querySelectorAll(".chat-msg.ai");
  const target = aiMessages[aiMessages.length - 1];
  if (!target) return;

  const wrap = document.createElement("div");
  wrap.className = "chat-tool-group";

  const header = document.createElement("div");
  header.className = "chat-tool-header";
  header.textContent = `Proposed Tools (${calls.length})`;
  wrap.appendChild(header);

  calls.forEach((call) => {
    const row = document.createElement("div");
    row.className = "chat-tool-row";
    const meta = document.createElement("div");
    meta.className = "chat-tool-meta";
    meta.innerHTML = `<span class="chat-tool-name">${call.tool}</span><span class="chat-tool-args">${JSON.stringify(call.args)}</span>`;

    const actions = document.createElement("div");
    actions.className = "chat-tool-actions";
    const denyBtn = document.createElement("button");
    denyBtn.className = "chat-tool-btn small";
    denyBtn.textContent = "Deny";
    denyBtn.onclick = () => {
      row.classList.add("denied");
    };
    const approveBtn = document.createElement("button");
    approveBtn.className = "chat-tool-btn";
    approveBtn.textContent = "Approve";
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      const res = await runToolCall(call, parentJobId || `job_${Date.now()}`);
      if (res.ok) {
        row.classList.add("approved");
        chatStore.addMessage("ai", res.message);
        if (res.diff) {
          const diffBtn = document.createElement("button");
          diffBtn.className = "chat-tool-btn small";
          diffBtn.textContent = "View Diff";
          diffBtn.onclick = () => _showToolDiff(res.diff.title, res.diff.text);
          actions.appendChild(diffBtn);
        }
      } else {
        row.classList.add("denied");
        chatStore.addMessage("ai", `Tool failed: ${res.message}`);
      }
      renderChat();
    };
    actions.appendChild(denyBtn);
    actions.appendChild(approveBtn);
    row.appendChild(meta);
    row.appendChild(actions);
    wrap.appendChild(row);
  });

  target.appendChild(wrap);
}

// Maps raw validator error text to a coarse category for UI display + analytics
function _classifyBlockReason(reason) {
  const r = (reason || "").toUpperCase();
  if (r.includes("EVAL") || r.includes("SCRIPT") || r.includes("INJECTION") || r.includes("DANGEROUS")) {
    return "SECURITY";
  }
  if (r.includes("FORBIDDEN") || r.includes("INNERHTML") || r.includes("PROTECTED") || r.includes("POLICY")) {
    return "POLICY";
  }
  return "SYNTAX";
}

// Renders inline blocked notices inside the last AI chat bubble.
// Never called for retry-originated flows — blocked files exit before executeTransaction.
function _renderBlockedNotices(blockedFiles) {
  const aiMessages = document.querySelectorAll(".chat-msg.ai");
  const target = aiMessages[aiMessages.length - 1];
  if (!target) return;

  const wrap = document.createElement("div");
  wrap.className = "chat-blocked-group";

  blockedFiles.forEach(f => {
    const row = document.createElement("div");
    row.className = `chat-blocked-row blocked-${(f.blockCategory || "SYNTAX").toLowerCase()}`;
    row.innerHTML =
      `<span class="chat-blocked-badge">${f.blockCategory || "SYNTAX"}</span>` +
      `<span class="chat-blocked-path">${f.filePath}</span>` +
      `<span class="chat-blocked-reason">${f.blockReason}</span>`;
    wrap.appendChild(row);
  });

  target.appendChild(wrap);
}

function showDiffPreview(filePath, originalContent, proposedContent) {
  const overlay = document.createElement("div");
  overlay.className = "diff-preview-overlay";

  const box = document.createElement("div");
  box.className = "diff-preview-box";

  const header = document.createElement("div");
  header.className = "diff-header";
  header.innerHTML = `
    <span class="diff-title">Diff: ${filePath}</span>
    <button class="topbar-btn">Close</button>
  `;
  header.querySelector("button").onclick = () => overlay.remove();

  const body = document.createElement("div");
  body.className = "diff-body";

  // Simple line-based diff
  const oldLines = (originalContent || "").split("\n");
  const newLines = (proposedContent || "").split("\n");

  // For simplicity in this shell, we'll just show the proposed lines
  // if original is empty (new file), otherwise a basic comparison
  if (!originalContent) {
    body.innerHTML = newLines.map(line => `<span class="diff-added">+ ${line}</span>`).join("\n");
  } else {
    // Very naive diff: just show what changed if it's different
    // In a real IDE we'd use jsdiff or similar
    body.innerHTML = newLines.map((line, i) => {
      if (line !== oldLines[i]) {
        return `<span class="diff-added">+ ${line}</span>`;
      }
      return `  ${line}`;
    }).join("\n");
  }

  box.appendChild(header);
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function offerGroupedFileWrites(files, isRetry = false, parentJobId = null) {
  const aiMessages = document.querySelectorAll(".chat-msg.ai");
  const target = aiMessages[aiMessages.length - 1];
  if (!target) return;

  const wrap = document.createElement("div");
  wrap.className = "chat-write-group";

  // 1. Evaluate Confidence
  const fileStates = files.map(f => {
    const score = confidenceEngine.score(f, { fileCount: files.length });
    const classification = confidenceEngine.classify(score);
    return { ...f, score, ...classification };
  });

  // Escalation override: if session has 3+ SECURITY violations, force everything to "review"
  const sessionEscalated = sessionMemory.isEscalated();
  const fileStatesResolved = sessionEscalated
    ? fileStates.map(fs => fs.level === "safe" ? { ...fs, level: "review" } : fs)
    : fileStates;

  const allSafe = !sessionEscalated && fileStatesResolved.every(fs => fs.level === "safe");
  const shouldAutoExec = allSafe && files.length <= 2;

  // ── Header ─────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "chat-write-group-header";

  const title = document.createElement("div");
  title.className = "chat-write-group-title";
  title.textContent = "Proposed Changes (" + files.length + ")";
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "chat-write-group-actions";

  const rejectBtn = document.createElement("button");
  rejectBtn.className = "chat-write-cancel-btn";
  rejectBtn.textContent = "Discard";
  rejectBtn.onclick = () => {
    wrap.style.opacity = "0.5";
    wrap.style.pointerEvents = "none";
    showNotification("Discarded proposed changes", "info");
  };

  const approveBtn = document.createElement("button");
  approveBtn.className = "chat-write-all-btn";
  approveBtn.textContent = shouldAutoExec ? "Auto-Applied" : "Apply Selected";
  if (shouldAutoExec) approveBtn.classList.add("written");

  actions.appendChild(rejectBtn);
  actions.appendChild(approveBtn);
  header.appendChild(actions);

  if (shouldAutoExec) {
    const notice = document.createElement("div");
    notice.className = "chat-write-auto-notice";
    notice.textContent = "Applied low-risk surgical patches automatically";
    wrap.appendChild(notice);
  }

  if (sessionEscalated) {
    const escalationBanner = document.createElement("div");
    escalationBanner.className = "chat-write-escalation-notice";
    escalationBanner.textContent = "Security escalation active — all writes require manual approval";
    wrap.appendChild(escalationBanner);
  }

  // ── File List ──────────────────────────────────────────────────────────
  const list = document.createElement("div");
  list.className = "chat-write-list";

  const fileRows = fileStatesResolved.map((f, index) => {
    const row = document.createElement("div");
    row.className = "chat-write-row";
    row.dataset.path = f.filePath;

    // Checkbox for selection
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.index = index;
    cb.className = "chat-write-checkbox";
    if (shouldAutoExec) cb.disabled = true;
    row.appendChild(cb);

    const meta = document.createElement("div");
    meta.className = "chat-write-meta";

    const nameEl = document.createElement("div");
    nameEl.className = "chat-write-name";
    nameEl.innerHTML = `${f.filePath} <span class="confidence-badge" style="color:${f.color}">${f.label} ${f.score}</span>`;

    const tags = `
      <span class="chat-write-status-tag tag-written">Written</span>
      <span class="chat-write-status-tag tag-error">Failed</span>
      <span class="chat-write-status-tag tag-rolled-back">Rolled Back</span>
    `;
    nameEl.innerHTML += tags;

    const noteEl = document.createElement("div");
    noteEl.className = "chat-write-note";
    if (f.isPatch) {
      noteEl.textContent = f.target ? `Patch: function ${f.target}` : `Patch: lines ${f.range}`;
    } else {
      noteEl.textContent = `${f.content.length} chars`;
    }

    meta.appendChild(nameEl);
    meta.appendChild(noteEl);

    const rowActions = document.createElement("div");
    rowActions.className = "chat-write-row-actions";

    const diffBtn = document.createElement("button");
    diffBtn.className = "chat-write-btn-small";
    diffBtn.textContent = "Diff";
    diffBtn.onclick = async () => {
      let original = "";
      try {
        const resolved = resolveProjectWritePath(f.filePath);
        const res = await toolDispatcher.run(parentJobId || `job_${Date.now()}`, settingsStore.config.provider, "file_read", { path: resolved.absolutePath });
        if (res.ok) original = res.output.content || res.output;
      } catch { }
      showDiffPreview(f.filePath, original, f.content);
    };

    rowActions.appendChild(diffBtn);
    row.appendChild(meta);
    row.appendChild(rowActions);
    list.appendChild(row);

    return { ...f, row, cb };
  });

  const executeTransaction = async (selected) => {
    try {
      setActionState("running", "patch apply");
      const resolved = selected.map(f => {
        const r = resolveProjectWritePath(f.filePath);
        return { relativePath: r.relativePath, absolutePath: r.absolutePath, proposedContent: f.content, operation: "write" };
      });

      const dispatchRes = await toolDispatcher.run(parentJobId || `job_${Date.now()}`, settingsStore.config.provider, "transactionManager", {
        projectRoot: currentProject,
        files: resolved,
        actor: { type: "ai" },
        source: "chat",
      });

      const result = dispatchRes.ok ? dispatchRes.output : dispatchRes;

      if (result.ok) {
        sessionMemory.logTransaction(result.txnId, "success", resolved);
        persistentMemory.log(currentProject, {
          type: isRetry ? "retry_success" : "transaction",
          id: result.txnId,
          status: "success",
          files: resolved.map(f => f.relativePath),
          auto: shouldAutoExec
        });
        // Confidence learning: record that these scores led to success
        selected.forEach(f => { if (f.score != null) confidenceEngine.learn(f.score, true); });
        approveBtn.classList.add("written");
        selected.forEach((f, i) => {
          f.row.classList.add("written");
          const r = resolved[i];
          if (typeof editorStore?.addTab === "function") {
            editorStore.addTab(r.absolutePath, r.relativePath.split("/").pop(), f.content);
          }
        });

        for (const r of resolved) {
          await syncFileFromDisk(r.absolutePath);
        }

        renderEditor();
        renderProjectPanel();
        if (!shouldAutoExec) showNotification(`Committed ${selected.length} files`, "success");
        appendLine("sys", `[txn:${result.txnId}] committed ${shouldAutoExec ? "auto" : "manual"} write`, Date.now());
        notifyActionResult(true, `Patch applied (${selected.length} file${selected.length === 1 ? "" : "s"})`, "", "patch");

        // Auto-audit on commit
        enqueueAuditAfter("commit", result);
      } else {
        sessionMemory.logTransaction(result.txnId, "error", resolved);
        sessionMemory.logError(result.error?.code || "COMMIT_FAILED", result.error?.message, "file-write");
        persistentMemory.log(currentProject, { type: "transaction", id: result.txnId, status: "error", error: result.error?.code, files: resolved.map(f => f.relativePath) });
        // Confidence learning: record that these scores led to failure
        selected.forEach(f => { if (f.score != null) confidenceEngine.learn(f.score, false); });

        // ⚡ Auto-Retry Logic
        if (!isRetry && retryClassifier.isRetryable(result.error)) {
          appendLine("sys", `[retry] Transaction failed (${result.error.code}). Attempting auto-fix...`, Date.now());
          showNotification("Attempting autonomous fix...", "info");

          persistentMemory.log(currentProject, {
            type: "retry_initiated",
            originalError: result.error.code,
            files: selected.map(f => f.filePath)
          });

          const success = await retryManager.attemptAutoFix(result.error, selected, detectAndOfferFileWrite);
          if (success) {
            appendLine("sys", `[retry] Auto-fix patch received and offered.`, Date.now());
            enqueueAuditAfter("retry", result);
            wrap.style.opacity = "0.5";
            wrap.style.pointerEvents = "none";
            return;
          } else {
            persistentMemory.log(currentProject, { type: "retry_failed", stage: "generation" });
          }
        }

        if (isRetry) {
          persistentMemory.log(currentProject, { type: "retry_failed", stage: "commit", error: result.error?.code });
        }

        approveBtn.classList.add("error");
        approveBtn.textContent = "Commit Failed";

        selected.forEach((f, i) => {
          const r = resolved[i];
          const restored = result.rollback?.restoredFiles?.includes(r.relativePath);
          if (restored) f.row.classList.add("rolled_back");
          else f.row.classList.add("error");
        });

        const errMsg = result.error?.message || "Transaction failed";
        showNotification(`Transaction failed: ${errMsg}`, "error");
        notifyActionResult(false, "", errMsg, "patch");

        // Auto-audit on rollback
        enqueueAuditAfter("rollback", result);
      }
    } catch (err) {
      const safe = normalizeError(err, "file-write");
      sessionMemory.logError(safe.code, safe.message, safe.stage);
      persistentMemory.log(currentProject, { type: "error", code: safe.code, message: safe.message, stage: safe.stage });
      approveBtn.disabled = false;
      approveBtn.textContent = "Apply Selected";
      showNotification(`${safe.code}: ${safe.message}`, "error");
      notifyActionResult(false, "", safe.message, "patch");
    }
  };

  approveBtn.onclick = async () => {
    if (shouldAutoExec && approveBtn.classList.contains("written")) return;
    const selected = fileRows.filter(f => f.cb.checked);
    if (selected.length === 0) return;

    approveBtn.disabled = true;
    approveBtn.textContent = "Writing...";
    rejectBtn.style.display = "none";
    fileRows.forEach(f => f.cb.disabled = true);
    await executeTransaction(selected);
  };

  wrap.appendChild(header);
  wrap.appendChild(list);
  target.appendChild(wrap);

  // ⚡ Auto-execute if safe
  if (shouldAutoExec) {
    executeTransaction(fileRows);
  }
}

chatSendBtn?.addEventListener("click", sendChatMessage);
chatClearBtn?.addEventListener("click", () => {
  chatStore.clear();
  renderChat();
});

// ── Image upload in chat ────────────────────────────────────────────────────
const chatImageBtn = document.getElementById("chat-image-btn");
const chatImageInput = document.getElementById("chat-image-input");

chatImageBtn?.addEventListener("click", () => chatImageInput?.click());
chatImageInput?.addEventListener("change", () => {
  const file = chatImageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const b64 = e.target.result;
    // Show image in chat history (visual only — not sent to API in this iteration)
    const msg = document.createElement("div");
    msg.className = "chat-msg user chat-image-msg";
    const img = document.createElement("img");
    img.src = b64;
    img.className = "chat-attached-image";
    msg.appendChild(img);
    chatMessagesEl?.appendChild(msg);
    if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatImageInput.value = "";
  };
  reader.readAsDataURL(file);
});

// Agent selector ↔ settingsStore sync (loop-guarded)
agentSelector?.addEventListener("change", () => {
  const newProvider = agentSelector.value;
  if (settingsStore.config.provider !== newProvider) {
    settingsStore.save({ provider: newProvider });
  }
});
chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// ── Terminal ───────────────────────────────────────────────────────────────
const newTerminalBtn = document.getElementById("new-terminal-btn");
const cmdHistory = JSON.parse(localStorage.getItem('terminal_history') || "[]");
let cmdHistoryIndex = -1;

newTerminalBtn?.addEventListener("click", () => {
  terminalStore.addSession(`Terminal ${terminalStore.sessions.length + 1}`);
  renderTerminal();
});

function handleCommandHistory(e) {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (cmdHistoryIndex < cmdHistory.length - 1) {
      cmdHistoryIndex++;
      const commandInput = document.getElementById("command-input");
      if (commandInput) commandInput.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (cmdHistoryIndex > 0) {
      cmdHistoryIndex--;
      const commandInput = document.getElementById("command-input");
      if (commandInput) commandInput.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    } else if (cmdHistoryIndex === 0) {
      cmdHistoryIndex = -1;
      const commandInput = document.getElementById("command-input");
      if (commandInput) commandInput.value = "";
    }
  }
}

// ── Settings ───────────────────────────────────────────────────────────────
const settingsOverlay = document.getElementById("settings-overlay");
const settingsProvider = document.getElementById("settings-provider");
const settingsKey = document.getElementById("settings-key");
const settingsModel = document.getElementById("settings-model");
const settingsEndpoint = document.getElementById("settings-endpoint");
const settingsCapability = document.getElementById("settings-capability");
const settingsTemperature = document.getElementById("settings-temperature");
const settingsTempValue = document.getElementById("settings-temp-value");
const settingsPreset = document.getElementById("settings-preset");
const settingsModelList = document.getElementById("settings-model-list");
const settingsSaveBtn = document.getElementById("settings-save-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const settingsTestBtn = document.getElementById("settings-test-btn");
const settingsRevealBtn = document.getElementById("settings-reveal-btn");
const settingsKeyToggle = document.getElementById("settings-key-visibility");
const settingsProfileName = document.getElementById("settings-profile-name");
const settingsProfileSelect = document.getElementById("settings-profile-select");
const settingsProfileSaveBtn = document.getElementById("settings-profile-save-btn");
const settingsProfileLoadBtn = document.getElementById("settings-profile-load-btn");
const settingsProfileDelBtn = document.getElementById("settings-profile-delete-btn");
const settingsSmartModel = document.getElementById("settings-smart-model");
const smartModeStatus = document.getElementById("smart-mode-status");
const settingsModelHint = document.getElementById("settings-model-hint");
const activeModelBadge = document.getElementById("active-model-badge");

function updateSmartModeUI(isOn) {
  if (!smartModeStatus) return;
  smartModeStatus.innerHTML = isOn
    ? `<span class="smart-mode-pill on">● Smart ON — agent auto-selects model per task</span>`
    : `<span class="smart-mode-pill off">○ Smart OFF — using model override below</span>`;
  if (settingsModelHint) {
    settingsModelHint.textContent = isOn
      ? "Smart Selection is ON — leave blank to auto-select"
      : "Smart Selection is OFF — model set here will always be used";
  }
}

function updateModelBadge(model, smart) {
  if (!activeModelBadge) return;
  if (smart) {
    activeModelBadge.textContent = model ? `auto: ${model}` : "auto";
    activeModelBadge.className = "model-badge smart";
    activeModelBadge.title = "Smart Selection active — model chosen per task";
  } else {
    activeModelBadge.textContent = model || "no model";
    activeModelBadge.className = "model-badge manual";
    activeModelBadge.title = "Fixed model — set in ⚙ Settings";
  }
}

settingsSmartModel?.addEventListener("change", () => {
  updateSmartModeUI(settingsSmartModel.checked);
});

function renderProfilesList() {
  if (!settingsProfileSelect) return;
  const profiles = settingsStore.profiles || [];
  settingsProfileSelect.innerHTML = `<option value="">— load profile —</option>` +
    profiles.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
}

let _providerModels = [];

function renderProviderOptions() {
  const providers = listProviders();
  const html = providers.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  if (settingsProvider) settingsProvider.innerHTML = html;
  if (agentSelector) {
    agentSelector.innerHTML = providers.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  }
}

async function refreshProviderModels({ provider, capability, apiKey, endpoint, activeModel }) {
  if (!provider) return;
  if (settingsModelList) {
    settingsModelList.innerHTML = `<span class="settings-field-hint">Loading available models…</span>`;
  }
  try {
    const models = await fetchProviderModels({ provider, apiKey, endpoint });
    _providerModels = filterModelsByCapability(models, capability || "chat");
    if (_providerModels.length === 0) {
      _providerModels = models;
    }
  } catch {
    _providerModels = [];
  }

  if (_providerModels.length === 0 && activeModel) {
    _providerModels = [{ id: activeModel, label: activeModel, capabilities: [capability || "chat"] }];
  }

  const best = pickBestModel(_providerModels, capability || "chat");
  if (!settingsModel.value || !_providerModels.some((m) => m.id === settingsModel.value)) {
    settingsModel.value = activeModel && _providerModels.some((m) => m.id === activeModel) ? activeModel : best;
  }
  renderModelChips(provider, settingsModel.value);
}

function renderModelChips(provider, activeModel) {
  if (!settingsModelList) return;
  settingsModelList.innerHTML = _providerModels.map(m => {
    const modelId = m.id || m;
    const active = modelId === activeModel ? "active" : "";
    return `<button class="settings-model-chip ${active}" data-model="${modelId}">${modelId}</button>`;
  }).join("");
}

async function showSettings() {
  await settingsStore.load();
  await loadProviders();
  renderProviderOptions();
  const cfg = settingsStore.config;
  settingsProvider.value = cfg.provider || listProviders()[0]?.id || "";
  settingsKey.value = cfg.apiKey;
  settingsModel.value = cfg.model;
  settingsEndpoint.value = cfg.endpoint;
  if (settingsCapability) settingsCapability.value = cfg.capability || "chat";
  if (settingsPreset) settingsPreset.value = cfg.preset || "balanced";
  if (settingsKeyToggle) settingsKeyToggle.checked = false;
  if (settingsKey) settingsKey.type = "password";
  if (settingsTemperature) settingsTemperature.value = cfg.temperature ?? 0.7;
  if (settingsTempValue) settingsTempValue.textContent = cfg.temperature ?? 0.7;
  // Smart model toggle
  const smartOn = cfg.smartModelSelection !== false;
  if (settingsSmartModel) settingsSmartModel.checked = smartOn;
  updateSmartModeUI(smartOn);
  await refreshProviderModels({
    provider: settingsProvider.value,
    capability: settingsCapability?.value || "chat",
    apiKey: settingsKey.value.trim(),
    endpoint: settingsEndpoint.value.trim(),
    activeModel: cfg.model
  });
  updateModelBadge(cfg.model || settingsModel?.value || "", smartOn);
  renderProfilesList();
  settingsOverlay.style.display = "flex";
}

function hideSettings() {
  settingsOverlay.style.display = "none";
}

// Live temperature display
settingsTemperature?.addEventListener("input", () => {
  if (settingsTempValue) settingsTempValue.textContent = settingsTemperature.value;
});

settingsSaveBtn?.addEventListener("click", async () => {
  const smartOn = settingsSmartModel ? settingsSmartModel.checked : true;
  await settingsStore.save({
    provider: settingsProvider.value,
    apiKey: settingsKey.value,
    model: settingsModel.value,
    endpoint: settingsEndpoint.value,
    capability: settingsCapability?.value || "chat",
    temperature: parseFloat(settingsTemperature?.value ?? 0.7),
    preset: settingsPreset?.value || "balanced",
    smartModelSelection: smartOn,
  });
  if (agentSelector && agentSelector.value !== settingsProvider.value) {
    agentSelector.value = settingsProvider.value;
  }
  updateModelBadge(settingsModel.value, smartOn);
  hideSettings();
  showNotification("Settings saved", "success");
  appendLine("sys", `[settings] Saved — Smart Selection: ${smartOn ? "ON" : "OFF"}, Provider: ${settingsProvider.value}`, Date.now());
});

// Test Connection
settingsTestBtn?.addEventListener("click", async () => {
  settingsTestBtn.disabled = true;
  settingsTestBtn.textContent = "Testing…";
  const provider = settingsProvider.value;
  const apiKey = settingsKey.value.trim();
  const endpoint = settingsEndpoint.value.trim();
  try {
    let ok = false;
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      ok = res.ok;
    } else if (provider === "openai") {
      const base = endpoint || "https://api.openai.com/v1";
      const res = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      });
      ok = res.ok;
    } else if (provider === "anthropic") {
      const base = endpoint || "https://api.anthropic.com";
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      ok = res.ok || res.status === 400; // 400 means bad request format but the API key authenticated successfully
    } else if (provider === "ollama") {
      const base = endpoint || "http://localhost:11434";
      const res = await fetch(`${base}/api/tags`);
      ok = res.ok;
    }
    showNotification(ok ? "Connection successful!" : "Connection failed", ok ? "success" : "error");
  } catch (err) {
    showNotification(`Connection error: ${err.message}`, "error");
  } finally {
    settingsTestBtn.disabled = false;
    settingsTestBtn.textContent = "Test Connection";
  }
});

// Profile: Save
settingsProfileSaveBtn?.addEventListener("click", async () => {
  const name = settingsProfileName?.value.trim();
  if (!name) { showNotification("Enter a profile name", "error"); return; }
  await settingsStore.saveProfile(name);
  renderProfilesList();
  if (settingsProfileName) settingsProfileName.value = "";
  showNotification(`Profile "${name}" saved`, "success");
});

// Profile: Load
settingsProfileLoadBtn?.addEventListener("click", async () => {
  const name = settingsProfileSelect?.value;
  if (!name) { showNotification("Select a profile to load", "error"); return; }
  await settingsStore.loadProfile(name);
  await showSettings(); // refresh all fields with newly loaded config
  showNotification(`Profile "${name}" loaded`, "success");
});

// Profile: Delete
settingsProfileDelBtn?.addEventListener("click", async () => {
  const name = settingsProfileSelect?.value;
  if (!name) { showNotification("Select a profile to delete", "error"); return; }
  await settingsStore.deleteProfile(name);
  renderProfilesList();
  showNotification(`Profile "${name}" deleted`, "info");
});

settingsCloseBtn?.addEventListener("click", hideSettings);
settingsOverlay?.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) hideSettings();
});

// ── Settings tab switching ────────────────────────────────────────────────
document.querySelectorAll('.settings-tab[data-stab]').forEach(tab => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.stab;
    document.querySelectorAll('.settings-tab[data-stab]').forEach(b => b.classList.toggle('active', b === tab));
    document.querySelectorAll('.settings-pane[data-stab]').forEach(p => p.classList.toggle('active', p.dataset.stab === t));
  });
});

// ── Live Issues Feed ──────────────────────────────────────────────────────
(function () {
  const feed = document.getElementById('issues-feed');
  const badge = document.getElementById('issues-error-count');
  const clearBtn = document.getElementById('issues-clear-btn');
  let errorCount = 0;

  function pushIssue(type, msg, src) {
    if (!feed) return;
    const empty = feed.querySelector('.issues-empty-state');
    if (empty) empty.remove();
    if (type === 'error') {
      errorCount++;
      if (badge) { badge.textContent = String(errorCount); badge.style.display = ''; }
    }
    const row = document.createElement('div');
    row.className = 'issue-row';
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.innerHTML =
      `<span class="issue-badge issue-badge-${type}">${type}</span>` +
      `<span class="issue-msg">${String(msg).replace(/</g, '&lt;')}</span>` +
      `<span class="issue-src">${src ? String(src).replace(/</g, '&lt;') : ''}</span>` +
      `<span class="issue-time">${ts}</span>`;
    feed.insertBefore(row, feed.firstChild);
    if (type === 'error') {
      const issuesTab = document.querySelector('.terminal-tab[data-target="rc-issues"]');
      if (issuesTab && !issuesTab.classList.contains('active')) {
        issuesTab.classList.remove('issues-tab-pulse');
        void issuesTab.offsetWidth;
        issuesTab.classList.add('issues-tab-pulse');
        setTimeout(() => issuesTab.classList.remove('issues-tab-pulse'), 2200);
      }
    }
  }

  window.addEventListener('error', e => {
    const src = e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : '';
    pushIssue('error', e.message || 'Unknown JS error', src);
  });

  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason?.message || String(e.reason) || 'Unhandled promise rejection';
    pushIssue('error', msg, 'promise');
  });

  clearBtn?.addEventListener('click', () => {
    errorCount = 0;
    if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
    if (feed) feed.innerHTML = '<div class="issues-empty-state">Cleared.</div>';
  });

  window.__IDE_pushIssue = pushIssue;
})();

settingsKeyToggle?.addEventListener("change", () => {
  if (!settingsKey) return;
  settingsKey.type = settingsKeyToggle.checked ? "text" : "password";
});

let settingsModelFetchTimeout = null;
function debouncedRefreshSettingsModels() {
  if (settingsModelFetchTimeout) clearTimeout(settingsModelFetchTimeout);
  settingsModelFetchTimeout = setTimeout(() => {
    refreshProviderModels({
      provider: settingsProvider?.value || "",
      capability: settingsCapability?.value || "chat",
      apiKey: settingsKey?.value?.trim() || "",
      endpoint: settingsEndpoint?.value?.trim() || "",
      activeModel: settingsModel?.value || ""
    });
  }, 600);
}

settingsKey?.addEventListener("input", debouncedRefreshSettingsModels);
settingsEndpoint?.addEventListener("input", debouncedRefreshSettingsModels);

settingsProvider?.addEventListener("change", () => {
  const providerMeta = getProvider(settingsProvider.value);
  if (providerMeta && settingsEndpoint && !settingsEndpoint.value.trim()) {
    settingsEndpoint.value = providerMeta.defaultEndpoint || "";
  }
  refreshProviderModels({
    provider: settingsProvider.value,
    capability: settingsCapability?.value || "chat",
    apiKey: settingsKey?.value?.trim() || "",
    endpoint: settingsEndpoint?.value?.trim() || "",
    activeModel: settingsModel?.value || ""
  });
});

settingsCapability?.addEventListener("change", () => {
  refreshProviderModels({
    provider: settingsProvider?.value || "",
    capability: settingsCapability.value,
    apiKey: settingsKey?.value?.trim() || "",
    endpoint: settingsEndpoint?.value?.trim() || "",
    activeModel: settingsModel?.value || ""
  });
});

settingsModelList?.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("settings-model-chip")) return;
  const model = target.dataset.model;
  if (!model) return;
  settingsModel.value = model;
  renderModelChips(settingsProvider.value, model);
});

settingsRevealBtn?.addEventListener("click", async () => {
  if (window.ide?.revealSettings) {
    await window.ide.revealSettings();
    showNotification("Settings file revealed", "success");
    return;
  }
  showNotification("Reveal only available in desktop app", "warning");
});

// Settings gear button in topbar
document.getElementById("settings-btn")?.addEventListener("click", () => {
  if (settingsOverlay?.style?.display === "flex") {
    hideSettings();
    return;
  }
  showSettings();
});

commandPalette.register('ui.settings', 'Open API Settings', 'Settings', showSettings);

// ── Command Palette / Quick Open ──────────────────────────────────────────
const cpOverlay = document.getElementById("cp-overlay");
const cpInput = document.getElementById("cp-input");
const cpList = document.getElementById("cp-list");

let paletteMode = 'command';
let paletteResults = [];
let paletteSelectedIndex = 0;

async function showPalette(mode = 'command') {
  paletteMode = mode;
  cpOverlay.style.display = "flex";
  cpInput.focus();
  cpInput.value = "";
  cpInput.placeholder = mode === 'command' ? "Type a command..." : "Type a file name...";

  if (mode === 'file' && currentProject) {
    await quickOpen.loadFiles(currentProject);
  }

  updatePaletteResults();
}

function hidePalette() {
  cpOverlay.style.display = "none";
}

function dismissBlockingOverlays() {
  if (settingsOverlay) settingsOverlay.style.display = "none";
  if (cpOverlay) cpOverlay.style.display = "none";
  const findReplaceOverlay = document.getElementById("find-replace-overlay");
  if (findReplaceOverlay) findReplaceOverlay.hidden = true;
}

function updatePaletteResults() {
  const query = cpInput.value;
  if (paletteMode === 'command') {
    paletteResults = commandPalette.search(query);
  } else {
    paletteResults = quickOpen.search(query);
  }
  paletteSelectedIndex = 0;
  renderPaletteList();
}

function renderPaletteList() {
  cpList.innerHTML = paletteResults.map((item, i) => {
    const isSelected = i === paletteSelectedIndex;
    if (paletteMode === 'command') {
      return `
        <div class="cp-item ${isSelected ? "selected" : ""}" data-index="${i}">
          <div class="cp-item-left">
            <span class="cp-item-name">${item.name}</span>
            <span class="cp-item-cat">${item.category}</span>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="cp-item ${isSelected ? "selected" : ""}" data-index="${i}">
          <div class="cp-item-left">
            <span class="cp-item-name">${item.name}</span>
            <span class="cp-item-cat">${item.path.replace(currentProject, '')}</span>
          </div>
        </div>
      `;
    }
  }).join("");

  cpList.querySelectorAll(".cp-item").forEach(el => {
    el.addEventListener("click", () => {
      executePaletteItem(paletteResults[el.dataset.index]);
    });
  });
}

async function executePaletteItem(item) {
  hidePalette();
  if (!item) return;

  if (paletteMode === 'command') {
    if (item.callback) item.callback();
  } else {
    const result = await window.ide.readFile(item.path);
    onFileSelected(item.path, result);
  }
}

cpInput?.addEventListener("input", updatePaletteResults);
cpInput?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteSelectedIndex = (paletteSelectedIndex + 1) % paletteResults.length;
    renderPaletteList();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteSelectedIndex = (paletteSelectedIndex - 1 + paletteResults.length) % paletteResults.length;
    renderPaletteList();
  } else if (e.key === "Enter") {
    e.preventDefault();
    executePaletteItem(paletteResults[paletteSelectedIndex]);
  } else if (e.key === "Escape") {
    hidePalette();
  }
});

cpOverlay?.addEventListener("click", (e) => {
  if (e.target === cpOverlay) hidePalette();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  const settingsOpen = settingsOverlay?.style?.display === "flex";
  const paletteOpen = cpOverlay?.style?.display === "flex";
  const findReplaceOverlay = document.getElementById("find-replace-overlay");
  const findReplaceOpen = Boolean(findReplaceOverlay && !findReplaceOverlay.hidden);

  if (!settingsOpen && !paletteOpen && !findReplaceOpen) return;

  dismissBlockingOverlays();
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener("run-command", (e) => {
  runCommand(e.detail);
});
window.addEventListener("run-authorized-command", (e) => {
  const { command, port } = e.detail;
  Promise.resolve(runCommand(command))
    .then(res => port.postMessage({ ok: true, result: res }))
    .catch(err => port.postMessage({ ok: false, error: err }));
});

// ── Editor ─────────────────────────────────────────────────────────────────
const editorPanesEl = document.getElementById("editor-panes");
let activeEditorTextarea = null; // tracked for global undo/redo
let suggestionPopup = null;
let currentSuggestions = [];
let selectedSuggestionIndex = 0;

// ── Ghost text ──────────────────────────────────────────────────────────────
let ghostTextEl = null;

function showGhostText(textarea, suggestion, prefix) {
  const suffix = suggestion.substring(prefix.length);
  if (!suffix) { hideGhostText(); return; }
  if (!ghostTextEl) {
    ghostTextEl = document.createElement("div");
    ghostTextEl.className = "ghost-text";
    document.body.appendChild(ghostTextEl);
  }
  const rect = textarea.getBoundingClientRect();
  const lineHeight = 19.2;
  const charWidth = 7.2;
  const textBefore = textarea.value.substring(0, textarea.selectionStart);
  const lines = textBefore.split("\n");
  const row = lines.length - 1;
  const col = lines[row].length;
  ghostTextEl.textContent = suffix;
  ghostTextEl.style.top = `${rect.top + row * lineHeight - textarea.scrollTop + 14}px`;
  ghostTextEl.style.left = `${rect.left + col * charWidth - textarea.scrollLeft + 54}px`;
  ghostTextEl.style.display = "block";
}

function hideGhostText() {
  if (ghostTextEl) ghostTextEl.style.display = "none";
}

// ── Bracket matching ────────────────────────────────────────────────────────
const BRACKET_PAIRS = { "{": "}", "(": ")", "[": "]" };
const BRACKET_CLOSES = { "}": "{", ")": "(", "]": "[" };

function updateBracketMatch(textarea, lineNumbers) {
  lineNumbers.querySelectorAll(".bracket-match-line").forEach(el => el.classList.remove("bracket-match-line"));
  const text = textarea.value;
  const pos = textarea.selectionStart;
  // Check char at cursor, or one before cursor
  const ch = text[pos] && (BRACKET_PAIRS[text[pos]] || BRACKET_CLOSES[text[pos]]) ? text[pos]
    : text[pos - 1] && (BRACKET_PAIRS[text[pos - 1]] || BRACKET_CLOSES[text[pos - 1]]) ? text[pos - 1]
      : null;
  if (!ch) return;
  const searchPos = (text[pos] === ch) ? pos : pos - 1;
  let matchPos = -1;
  if (BRACKET_PAIRS[ch]) {
    let depth = 0;
    for (let i = searchPos; i < text.length; i++) {
      if (text[i] === ch) depth++;
      if (text[i] === BRACKET_PAIRS[ch]) { depth--; if (depth === 0) { matchPos = i; break; } }
    }
  } else {
    const open = BRACKET_CLOSES[ch];
    let depth = 0;
    for (let i = searchPos; i >= 0; i--) {
      if (text[i] === ch) depth++;
      if (text[i] === open) { depth--; if (depth === 0) { matchPos = i; break; } }
    }
  }
  if (matchPos < 0) return;
  const lineOf = p => text.substring(0, p).split("\n").length;
  const l1 = lineOf(searchPos);
  const l2 = lineOf(matchPos);
  const n1 = lineNumbers.querySelector(`.line-number[data-line="${l1}"]`);
  const n2 = lineNumbers.querySelector(`.line-number[data-line="${l2}"]`);
  if (n1) n1.classList.add("bracket-match-line");
  if (n2) n2.classList.add("bracket-match-line");
}

// ── Code folding ────────────────────────────────────────────────────────────
// Per-tab fold state: Map<tabPath, Set<foldedLineIndex>>  (0-indexed)
const foldState = new Map();

function getFoldedSet(tabPath) {
  if (!foldState.has(tabPath)) foldState.set(tabPath, new Set());
  return foldState.get(tabPath);
}

function getFoldRange(lines, startIdx) {
  const startIndent = lines[startIdx].match(/^\s*/)[0].length;
  let end = startIdx + 1;
  while (end < lines.length) {
    const l = lines[end].trim();
    if (l === "") { end++; continue; }
    if (lines[end].match(/^\s*/)[0].length <= startIndent) break;
    end++;
  }
  return end - 1; // inclusive last hidden line index
}

function applyFoldsToHighlight(code, lang, tabPath) {
  const lines = code.split("\n");
  const htmlLines = highlighter.highlightLines(code, lang);
  const folded = getFoldedSet(tabPath);
  const hidden = new Set();
  for (const startIdx of folded) {
    const endIdx = getFoldRange(lines, startIdx);
    for (let i = startIdx + 1; i <= endIdx; i++) hidden.add(i);
  }
  return htmlLines.map((hl, i) => {
    if (hidden.has(i)) return null;
    if (folded.has(i)) return hl + '<span class="fold-ellipsis"> ⋯}</span>';
    return hl;
  }).filter(l => l !== null).join("\n");
}

function updateFoldGutter(lineNumbers, code, lang, tabPath, pre) {
  const lines = code.split("\n");
  const folded = getFoldedSet(tabPath);
  const hidden = new Set();
  for (const startIdx of folded) {
    const endIdx = getFoldRange(lines, startIdx);
    for (let i = startIdx + 1; i <= endIdx; i++) hidden.add(i);
  }
  lineNumbers.querySelectorAll(".line-number").forEach((el, i) => {
    el.style.display = hidden.has(i) ? "none" : "";
    const trimmed = (lines[i] || "").trimEnd();
    const foldable = trimmed.endsWith("{") || trimmed.endsWith("(") || trimmed.endsWith("[");
    let foldBtn = el.querySelector(".fold-btn");
    if (foldable) {
      if (!foldBtn) {
        foldBtn = document.createElement("span");
        foldBtn.className = "fold-btn";
        el.appendChild(foldBtn);
      }
      foldBtn.textContent = folded.has(i) ? "▶" : "▼";
      foldBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (folded.has(i)) folded.delete(i); else folded.add(i);
        pre.innerHTML = applyFoldsToHighlight(code, lang, tabPath);
        updateFoldGutter(lineNumbers, code, lang, tabPath, pre);
      };
    } else if (foldBtn) {
      foldBtn.remove();
    }
  });
}

function isImage(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext);
}

function renderEditor() {
  if (!editorPanesEl) return;
  editorPanesEl.innerHTML = "";

  const dirtyPaths = editorStore.tabs.filter(t => t.isDirty).map(t => t.path);
  const activePaneId = editorStore.activePaneId;
  const activePaneObj = editorStore.panes.find(p => p.id === activePaneId);
  updateHighlights(activePaneObj?.activeTabPath, dirtyPaths);

  editorStore.panes.forEach(pane => {
    const paneEl = document.createElement("div");
    paneEl.className = `editor-pane ${editorStore.activePaneId === pane.id ? "active-pane" : ""}`;
    paneEl.dataset.paneId = pane.id;

    const tabsEl = document.createElement("div");
    tabsEl.className = "pane-tabs";

    if (pane.tabPaths.length === 0) {
      const defaultTab = document.createElement("div");
      defaultTab.className = `tab ${!pane.activeTabPath ? "active" : ""}`;
      defaultTab.innerHTML = '<span class="tab-label">Bridge Status</span>';
      defaultTab.addEventListener("click", () => {
        editorStore.setActiveTab(pane.id, null);
        renderEditor();
      });
      tabsEl.appendChild(defaultTab);
    }

    pane.tabPaths.forEach(path => {
      const tab = editorStore.tabs.find(t => t.path === path);
      if (!tab) return;
      const tabEl = document.createElement("div");
      tabEl.className = `tab ${path === pane.activeTabPath ? "active" : ""} ${tab.isDirty ? "dirty" : ""} ${tab.readOnly ? "readonly" : ""}`;
      tabEl.innerHTML = `
        <span class="tab-label" title="${path}">${tab.name}</span>
        <span class="tab-close" data-path="${path}">×</span>
      `;
      tabEl.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) {
          e.stopPropagation();
          editorStore.closeTab(pane.id, path);
        } else {
          editorStore.setActiveTab(pane.id, path);
        }
        renderEditor();
      });
      tabsEl.appendChild(tabEl);
    });

    paneEl.appendChild(tabsEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "pane-body";

    if (!pane.activeTabPath) {
      const bridgeStatusOrig = document.getElementById("bridge-status");
      if (pane.id === 'left' && bridgeStatusOrig) {
        const bridgeClone = bridgeStatusOrig.cloneNode(true);
        bridgeClone.id = "";
        bridgeClone.hidden = false;
        bodyEl.appendChild(bridgeClone);
      } else {
        bodyEl.innerHTML = '<div class="pane-empty"><div class="pane-empty-title">LETTERBLACK CEP IDE</div><div class="pane-empty-hint">Open a project → click a file to edit</div><div class="pane-empty-hint" style="margin-top:4px;font-size:10px;color:#2a2a2a">Ctrl+P  Quick Open &nbsp;|&nbsp; Ctrl+Shift+P  Commands</div></div>';
      }
    } else {
      const tab = editorStore.tabs.find(t => t.path === pane.activeTabPath);
      if (tab) {
        if (isImage(tab.path)) {
          const imgContainer = document.createElement("div");
          imgContainer.className = "image-preview";
          const img = document.createElement("img");
          img.src = isElectron ? `file://${tab.path}` : tab.path;
          imgContainer.appendChild(img);
          bodyEl.appendChild(imgContainer);
        } else if (tab.path.endsWith('.build-report') || tab.path.includes('.report.json')) {
          bodyEl.innerHTML = reportViewer.render(tab.content);
        } else {
          const container = document.createElement("div");
          container.className = "editor-container";

          const lineNumbers = document.createElement("div");
          lineNumbers.className = "line-numbers";

          const editorMain = document.createElement("div");
          editorMain.className = "editor-main";

          const activeLineBg = document.createElement("div");
          activeLineBg.className = "active-line-bg";

          const textarea = document.createElement("textarea");
          textarea.className = "file-editor";
          textarea.spellcheck = false;
          textarea.value = tab.content;
          textarea.readOnly = tab.readOnly;

          const pre = document.createElement("pre");
          pre.className = "editor-highlight";
          const lang = highlighter.detectLanguage(tab.path);
          pre.innerHTML = applyFoldsToHighlight(tab.content, lang, tab.path);

          function updateLineNumbers() {
            const lines = textarea.value.split('\n').length;
            lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) =>
              `<div class="line-number" data-line="${i + 1}">${i + 1}</div>`
            ).join('');
          }

          function updateActiveLine() {
            const textBefore = textarea.value.substring(0, textarea.selectionStart);
            const lines = textBefore.split('\n');
            const lineIndex = lines.length - 1;
            const col = lines[lineIndex].length + 1;
            activeLineBg.style.top = `${lineIndex * 19.2 + 14}px`;
            lineNumbers.querySelectorAll(".line-number").forEach((el, i) => {
              el.classList.toggle("active", i === lineIndex);
            });
            updateBracketMatch(textarea, lineNumbers);
            updateStatusBar(tab.path, lineIndex + 1, col, lang);
          }

          // capture snapshot before each edit for history
          let _prevContent = tab.content;
          textarea.addEventListener("input", (e) => {
            const val = e.target.value;
            editorStore.pushHistory(tab.path, _prevContent, val);
            _prevContent = val;
            editorStore.updateContent(tab.path, val);
            pre.innerHTML = applyFoldsToHighlight(val, lang, tab.path);
            const tabEl = tabsEl.querySelector(`.tab[title="${tab.path}"]`);
            if (tabEl) tabEl.classList.toggle("dirty", tab.isDirty);
            handleAutocomplete(textarea, lang);
            updateLineNumbers();
            updateFoldGutter(lineNumbers, val, lang, tab.path, pre);
            updateActiveLine();
            const updatedDirtyPaths = editorStore.tabs.filter(t => t.isDirty).map(t => t.path);
            updateHighlights(pane.activeTabPath, updatedDirtyPaths);
          });

          textarea.addEventListener("keydown", (e) => {
            // Suggestion popup navigation
            if (suggestionPopup) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
                updateSuggestionPopup();
                return;
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                updateSuggestionPopup();
                return;
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applySuggestion(textarea, currentSuggestions[selectedSuggestionIndex], lang);
                return;
              } else if (e.key === "Escape") {
                hideSuggestions();
              }
            }

            // Tab key: try snippet expansion first
            if (e.key === "Tab" && !suggestionPopup) {
              const pos = textarea.selectionStart;
              const beforeCaret = textarea.value.substring(0, pos);
              const match = beforeCaret.match(/\b(\w+)$/);
              if (match) {
                const snippetBody = autocomplete.getSnippet(match[1], lang);
                if (snippetBody) {
                  e.preventDefault();
                  const { text: expanded, cursorOffset } = autocomplete.expandSnippet(snippetBody);
                  const afterCaret = textarea.value.substring(pos);
                  const newBefore = beforeCaret.substring(0, beforeCaret.length - match[1].length) + expanded;
                  textarea.value = newBefore + afterCaret;
                  const newCursor = beforeCaret.length - match[1].length + cursorOffset;
                  textarea.setSelectionRange(newCursor, newCursor);
                  editorStore.updateContent(tab.path, textarea.value);
                  pre.innerHTML = applyFoldsToHighlight(textarea.value, lang, tab.path);
                  updateLineNumbers();
                  updateFoldGutter(lineNumbers, textarea.value, lang, tab.path, pre);
                  updateActiveLine();
                  return;
                }
              }
            }

            // ── Bracket auto-close ───────────────────────────────────────
            const BRACKET_PAIRS = { '(': ')', '{': '}', '[': ']', '"': '"', "'": "'" };
            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key in BRACKET_PAIRS) {
              const open = e.key;
              const close = BRACKET_PAIRS[open];
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const selected = textarea.value.slice(start, end);
              if (selected.length > 0) {
                e.preventDefault();
                const newVal = textarea.value.slice(0, start) + open + selected + close + textarea.value.slice(end);
                textarea.value = newVal;
                textarea.setSelectionRange(start + 1, end + 1);
                editorStore.pushHistory(tab.path, _prevContent, newVal);
                _prevContent = newVal;
                editorStore.updateContent(tab.path, newVal);
                pre.innerHTML = applyFoldsToHighlight(newVal, lang, tab.path);
                updateLineNumbers();
                updateFoldGutter(lineNumbers, newVal, lang, tab.path, pre);
                updateActiveLine();
                return;
              }
              if (open !== close) {
                e.preventDefault();
                const before = textarea.value.slice(0, start);
                const after = textarea.value.slice(start);
                const newVal = before + open + close + after;
                textarea.value = newVal;
                textarea.setSelectionRange(start + 1, start + 1);
                editorStore.pushHistory(tab.path, _prevContent, newVal);
                _prevContent = newVal;
                editorStore.updateContent(tab.path, newVal);
                pre.innerHTML = applyFoldsToHighlight(newVal, lang, tab.path);
                updateLineNumbers();
                updateFoldGutter(lineNumbers, newVal, lang, tab.path, pre);
                updateActiveLine();
                return;
              }
            }

            setTimeout(updateActiveLine, 0);
          });

          textarea.addEventListener("mousedown", () => setTimeout(updateActiveLine, 0));

          textarea.addEventListener("scroll", () => {
            pre.scrollTop = lineNumbers.scrollTop = textarea.scrollTop;
            pre.scrollLeft = textarea.scrollLeft;
          });

          textarea.addEventListener("focus", () => {
            activeEditorTextarea = textarea;
            editorStore.setActivePane(pane.id);
            renderEditor();
          });

          textarea.addEventListener("blur", () => {
            if (activeEditorTextarea === textarea) activeEditorTextarea = null;
          });

          updateLineNumbers();
          updateFoldGutter(lineNumbers, tab.content, lang, tab.path, pre);
          updateActiveLine();

          editorMain.appendChild(activeLineBg);
          editorMain.appendChild(pre);
          editorMain.appendChild(textarea);
          container.appendChild(lineNumbers);
          container.appendChild(editorMain);
          bodyEl.appendChild(container);
        }
      }
    }

    paneEl.appendChild(bodyEl);
    editorPanesEl.appendChild(paneEl);
  });
}

function handleAutocomplete(textarea, lang) {
  const pos = textarea.selectionStart;
  const text = textarea.value;
  const beforeCaret = text.substring(0, pos);
  const match = beforeCaret.match(/\b(\w+)$/);

  if (match) {
    const prefix = match[1];
    currentSuggestions = autocomplete.getSuggestions(prefix, lang);
    if (currentSuggestions.length > 0) {
      selectedSuggestionIndex = 0;
      showSuggestions(textarea, prefix);
      showGhostText(textarea, currentSuggestions[0], prefix);
    } else {
      hideSuggestions();
    }
  } else {
    hideSuggestions();
  }
}

function showSuggestions(textarea, prefix) {
  if (!suggestionPopup) {
    suggestionPopup = document.createElement("div");
    suggestionPopup.className = "suggestion-popup";
    document.body.appendChild(suggestionPopup);
  }

  const rect = textarea.getBoundingClientRect();
  const lineHeight = 19.2;
  const charWidth = 7.2;
  const textBefore = textarea.value.substring(0, textarea.selectionStart);
  const lines = textBefore.split("\n");
  const row = lines.length - 1;
  const col = lines[row].length - prefix.length;

  suggestionPopup.style.top = `${rect.top + (row + 1) * lineHeight - textarea.scrollTop + 14}px`;
  suggestionPopup.style.left = `${rect.left + col * charWidth + 40 - textarea.scrollLeft + 14}px`;
  suggestionPopup.style.display = "block";

  updateSuggestionPopup();
}

function updateSuggestionPopup() {
  if (!suggestionPopup) return;
  suggestionPopup.innerHTML = currentSuggestions.map((s, i) => `
    <div class="suggestion-item ${i === selectedSuggestionIndex ? "selected" : ""}" data-index="${i}">
      <span class="suggestion-icon"><svg class="btn-icon"><use href="#ic-file-text"/></svg></span>
      <span class="suggestion-label">${s}</span>
    </div>
  `).join("");

  suggestionPopup.querySelectorAll(".suggestion-item").forEach(item => {
    item.addEventListener("click", () => {
      const textarea = document.activeElement;
      if (textarea && textarea.classList.contains("file-editor")) {
        const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
        const tab = editorStore.tabs.find(t => t.path === pane.activeTabPath);
        applySuggestion(textarea, currentSuggestions[item.dataset.index], highlighter.detectLanguage(tab.path));
      }
    });
  });
}

function applySuggestion(textarea, suggestion, lang) {
  const pos = textarea.selectionStart;
  const text = textarea.value;
  const beforeCaret = text.substring(0, pos);
  const afterCaret = text.substring(pos);
  const match = beforeCaret.match(/\b(\w+)$/);

  if (match) {
    const prefix = match[1];
    const newBefore = beforeCaret.substring(0, beforeCaret.length - prefix.length) + suggestion;
    textarea.value = newBefore + afterCaret;
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;

    const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    const tab = editorStore.tabs.find(t => t.path === pane.activeTabPath);
    editorStore.updateContent(tab.path, textarea.value);
    const pre = textarea.previousSibling;
    if (pre) pre.innerHTML = highlighter.highlight(textarea.value, lang);
  }
  hideSuggestions(); // also calls hideGhostText()
  textarea.focus();
}

function hideSuggestions() {
  if (suggestionPopup) {
    suggestionPopup.style.display = "none";
    suggestionPopup = null;
  }
  hideGhostText();
}

// ── Find / Replace ─────────────────────────────────────────────────────────
(function initFindReplace() {
  const overlay = document.getElementById("find-replace-overlay");
  const findInput = document.getElementById("fr-find-input");
  const replaceInput = document.getElementById("fr-replace-input");
  const btnPrev = document.getElementById("fr-prev");
  const btnNext = document.getElementById("fr-next");
  const btnRepOne = document.getElementById("fr-replace-one");
  const btnRepAll = document.getElementById("fr-replace-all");
  const countEl = document.getElementById("fr-count");
  const btnToggle = document.getElementById("fr-toggle-replace");
  const btnClose = document.getElementById("fr-close");

  if (!overlay) return;

  let _matches = [];
  let _matchIndex = -1;
  let _replaceVisible = false;

  function getTextarea() { return activeEditorTextarea; }

  function findMatches(needle, haystack) {
    if (!needle) return [];
    const results = [];
    let start = 0;
    const lower = haystack.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    while (true) {
      const idx = lower.indexOf(lowerNeedle, start);
      if (idx === -1) break;
      results.push(idx);
      start = idx + 1;
    }
    return results;
  }

  function highlight() {
    const ta = getTextarea();
    if (!ta) return;
    const needle = findInput.value;
    _matches = findMatches(needle, ta.value);
    if (_matches.length === 0) {
      countEl.textContent = needle ? "No results" : "";
      _matchIndex = -1;
      return;
    }
    if (_matchIndex < 0 || _matchIndex >= _matches.length) _matchIndex = 0;
    const pos = _matches[_matchIndex];
    ta.focus();
    ta.setSelectionRange(pos, pos + needle.length);
    countEl.textContent = `${_matchIndex + 1} / ${_matches.length}`;
  }

  function step(dir) {
    const ta = getTextarea();
    if (!ta) return;
    const needle = findInput.value;
    _matches = findMatches(needle, ta.value);
    if (_matches.length === 0) { countEl.textContent = "No results"; return; }
    _matchIndex = (_matchIndex + dir + _matches.length) % _matches.length;
    const pos = _matches[_matchIndex];
    ta.focus();
    ta.setSelectionRange(pos, pos + needle.length);
    countEl.textContent = `${_matchIndex + 1} / ${_matches.length}`;
  }

  function replaceOne() {
    const ta = getTextarea();
    if (!ta) return;
    const needle = findInput.value;
    const replacement = replaceInput.value;
    if (!needle || _matchIndex < 0 || _matchIndex >= _matches.length) return;
    const pos = _matches[_matchIndex];
    if (ta.selectionStart !== pos || ta.selectionEnd !== pos + needle.length) {
      step(0); return;
    }
    const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    const path = pane && pane.activeTabPath;
    if (!path) return;
    const prev = ta.value;
    const newVal = prev.slice(0, pos) + replacement + prev.slice(pos + needle.length);
    ta.value = newVal;
    editorStore.pushHistory(path, prev, newVal);
    editorStore.updateContent(path, newVal);
    const lang = highlighter.detectLanguage(path);
    const pre = ta.previousSibling;
    if (pre) pre.innerHTML = applyFoldsToHighlight(newVal, lang, path);
    _matches = findMatches(needle, newVal);
    _matchIndex = Math.min(_matchIndex, _matches.length - 1);
    if (_matches.length > 0) {
      const np = _matches[_matchIndex];
      ta.setSelectionRange(np, np + needle.length);
    }
    countEl.textContent = _matches.length ? `${_matchIndex + 1} / ${_matches.length}` : "No results";
  }

  function replaceAll() {
    const ta = getTextarea();
    if (!ta) return;
    const needle = findInput.value;
    const replacement = replaceInput.value;
    if (!needle) return;
    const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    const path = pane && pane.activeTabPath;
    if (!path) return;
    const prev = ta.value;
    const lowerNeedle = needle.toLowerCase();
    let result = "";
    let remaining = prev;
    let count = 0;
    while (true) {
      const idx = remaining.toLowerCase().indexOf(lowerNeedle);
      if (idx === -1) { result += remaining; break; }
      result += remaining.slice(0, idx) + replacement;
      remaining = remaining.slice(idx + needle.length);
      count++;
    }
    ta.value = result;
    editorStore.pushHistory(path, prev, result);
    editorStore.updateContent(path, result);
    const lang = highlighter.detectLanguage(path);
    const pre = ta.previousSibling;
    if (pre) pre.innerHTML = applyFoldsToHighlight(result, lang, path);
    countEl.textContent = `${count} replaced`;
    _matches = [];
    _matchIndex = -1;
  }

  window.showFindReplace = function (withReplace = false) {
    _replaceVisible = withReplace;
    replaceInput.hidden = !withReplace;
    btnRepOne.hidden = !withReplace;
    btnRepAll.hidden = !withReplace;
    overlay.hidden = false;
    findInput.focus();
    findInput.select();
    highlight();
  };

  findInput.addEventListener("input", () => {
    _matchIndex = -1;
    highlight();
  });
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { e.preventDefault(); overlay.hidden = true; }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); overlay.hidden = true; }
  });
  btnPrev.addEventListener("click", () => step(-1));
  btnNext.addEventListener("click", () => step(1));
  btnRepOne.addEventListener("click", replaceOne);
  btnRepAll.addEventListener("click", replaceAll);
  btnToggle.addEventListener("click", () => {
    _replaceVisible = !_replaceVisible;
    replaceInput.hidden = !_replaceVisible;
    btnRepOne.hidden = !_replaceVisible;
    btnRepAll.hidden = !_replaceVisible;
  });
  btnClose.addEventListener("click", () => { overlay.hidden = true; });
})();

// Save on Ctrl+S
window.addEventListener("keydown", async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    showPalette('command');
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
    e.preventDefault();
    showPalette('file');
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    edePanel.toggle();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    const searchTab = explorerTabs.querySelector('.terminal-tab[data-target="search-content"]');
    if (searchTab) searchTab.click();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (typeof window.showFindReplace === "function") window.showFindReplace(false);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "h") {
    e.preventDefault();
    if (typeof window.showFindReplace === "function") window.showFindReplace(true);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (!isElectron) {
      notifyActionResult(false, "", "Save is available only in Electron desktop mode", "file");
      return;
    }
    const activePane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    if (activePane && activePane.activeTabPath && isElectron) {
      const tab = editorStore.tabs.find(t => t.path === activePane.activeTabPath);
      if (tab && !tab.readOnly) {
        setActionState("running", "file save");
        const ok = await window.ide.writeFile(tab.path, tab.content);
        if (ok) {
          await syncFileFromDisk(tab.path);
          editorStore.markSaved(tab.path);
          renderEditor();
          notifyActionResult(true, `Saved ${tab.name}`, "", "file");
          appendLine("sys", `[file] saved: ${tab.path}`, Date.now());
        } else {
          notifyActionResult(false, "", `Failed to save ${tab.name}`, "file");
          appendLine("error", `[file] failed to save: ${tab.path}`, Date.now());
        }
      }
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
    e.preventDefault();
    editorStore.splitPane();
    renderEditor();
  }

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
    const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    if (pane && pane.activeTabPath && activeEditorTextarea) {
      e.preventDefault();
      const content = editorStore.undo(pane.activeTabPath);
      if (content !== null) {
        const textarea = activeEditorTextarea;
        const path = pane.activeTabPath;
        textarea.value = content;
        editorStore.updateContent(path, content);
        const tab = editorStore.tabs.find(t => t.path === path);
        const pre = textarea.previousSibling;
        const lang = highlighter.detectLanguage(path);
        if (pre) pre.innerHTML = applyFoldsToHighlight(content, lang, path);
        const tabEl = document.querySelector(`.tab[title="${path}"]`);
        if (tab && tabEl) tabEl.classList.toggle("dirty", tab.isDirty);
        renderStatusBar && renderStatusBar();
      }
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
    const pane = editorStore.panes.find(p => p.id === editorStore.activePaneId);
    if (pane && pane.activeTabPath && activeEditorTextarea) {
      e.preventDefault();
      const content = editorStore.redo(pane.activeTabPath);
      if (content !== null) {
        const textarea = activeEditorTextarea;
        const path = pane.activeTabPath;
        textarea.value = content;
        editorStore.updateContent(path, content);
        const tab = editorStore.tabs.find(t => t.path === path);
        const pre = textarea.previousSibling;
        const lang = highlighter.detectLanguage(path);
        if (pre) pre.innerHTML = applyFoldsToHighlight(content, lang, path);
        const tabEl = document.querySelector(`.tab[title="${path}"]`);
        if (tab && tabEl) tabEl.classList.toggle("dirty", tab.isDirty);
        renderStatusBar && renderStatusBar();
      }
    }
    return;
  }

  // ── Find / Replace overlay ────────────────────────────────────────────────
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && activeEditorTextarea) {
    e.preventDefault();
    showFindReplace(false);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h" && activeEditorTextarea) {
    e.preventDefault();
    showFindReplace(true);
    return;
  }
});

onFileSelected((filePath, result) => {
  const name = filePath.split(/[\\/]/).pop();
  // Single-file-tab: close all other tabs before opening the new one
  editorStore.panes.forEach(p => {
    p.tabPaths = p.tabPaths.filter(tp => tp === filePath);
    if (!p.tabPaths.includes(filePath)) p.activeTabPath = null;
  });
  if (isImage(filePath)) {
    editorStore.addTab(filePath, name, "", true);
  } else if (result?.ok) {
    editorStore.addTab(filePath, name, result.content);
  } else {
    editorStore.addTab(filePath, name, `Error reading file:\n${result?.error || "unknown"}`, true);
  }
  const lang = highlighter.detectLanguage(filePath);
  updateStatusBar(filePath, 1, 1, lang);
  renderEditor();
  showFileInRightPanel(filePath, name);
});

// ── Electron bridge detection ──────────────────────────────────────────────
const isElectron = typeof window.ide !== "undefined";

const sysModeEl = document.getElementById("sys-mode");
const sysPlatformEl = document.getElementById("sys-platform");
const stageNextEl = document.getElementById("stage-next");

if (sysModeEl) sysModeEl.textContent = isElectron ? "Electron desktop" : "web shell";
if (stageNextEl) stageNextEl.textContent = isElectron ? "add file ops" : "wrap in Electron";
if (sysPlatformEl && isElectron) sysPlatformEl.textContent = window.ide.platform;

// ── Project open ───────────────────────────────────────────────────────────
const projectStatusItem = document.getElementById("project-status-item");
const sysProjectEl = document.getElementById("sys-project");

// ── Project Info Panel ─────────────────────────────────────────────────────
function renderProjectPanel() {
  if (!currentProject) return;
  const name = currentProject.split(/[\\/]/).pop();

  const nameEl = document.getElementById("proj-name");
  const pathEl = document.getElementById("proj-path");
  const fileCountEl = document.getElementById("proj-file-count");
  const tabCountEl = document.getElementById("proj-tab-count");
  const treeSummaryEl = document.getElementById("proj-tree-summary");

  if (nameEl) nameEl.textContent = name;
  if (pathEl) pathEl.textContent = currentProject;
  if (tabCountEl) tabCountEl.textContent = `${editorStore.tabs.length} open`;

  // Shallow readDir only — no recursion, capped at 20 entries
  if (isElectron) {
    window.ide.readDir(currentProject).then(entries => {
      const files = entries.filter(e => !e.isDir);
      const dirs = entries.filter(e => e.isDir);
      if (fileCountEl) fileCountEl.textContent = `${files.length} files, ${dirs.length} folders`;
      if (treeSummaryEl) {
        treeSummaryEl.innerHTML = entries.slice(0, 20).map(e => {
          const safeName = e.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          return `<div class="proj-entry ${e.isDir ? "proj-dir" : "proj-file"}">${e.isDir ? "▶" : "—"} ${safeName}</div>`;
        }).join("");
      }
    }).catch(() => { });
  }
}

async function handleProjectOpen(dirPath) {
  await openProject(dirPath);
  await projectContext.refresh(dirPath);
  await intelligenceStore.analyze(dirPath);
  await persistentMemory.load(dirPath);
  window.__LB_PROJECT_ROOT__ = dirPath;
  const name = dirPath.split(/[\\/]/).pop();
  appendLine("sys", `[project] opened: ${dirPath}`, Date.now());
  showNotification(`Opened project: ${name}`, "success");

  if (projectStatusItem) projectStatusItem.hidden = false;
  if (sysProjectEl) sysProjectEl.textContent = name;

  if (isElectron && window.ide.recoverTransactions) {
    const recovered = await window.ide.recoverTransactions(dirPath);
    if (recovered.length > 0) {
      showNotification(`Recovered ${recovered.length} interrupted transactions`, "warning");
      appendLine("sys", `[recovery] Marked ${recovered.length} transactions as interrupted`, Date.now());
    }
  }

  renderProjectPanel();
  loadHistory();
  refreshGitStatus();

  if (isElectron && window.ide?.gitBranch && window.ide?.gitCreateBranch) {
    try {
      const b = await window.ide.gitBranch(dirPath);
      const current = b?.ok ? String(b.branch || "") : "";
      if (current === "main" || current === "master") {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const task = (name || "work").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "work";
        const autoBranch = `feature/${y}-${m}-${day}-${task}`;
        const created = await window.ide.gitCreateBranch(dirPath, autoBranch);
        if (created?.ok) {
          appendLine("sys", `[git] auto-created branch: ${autoBranch}`, Date.now());
          showNotification(`Git: switched to ${autoBranch}`, "success");
          refreshGitStatus();
        }
      }
    } catch { }
  }
}

if (isElectron) {
  window.ide.onProjectOpened((dirPath) => handleProjectOpen(dirPath));

  // Open Project button → folder dialog → same handler as menu
  window.addEventListener('project-open-requested', (e) => handleProjectOpen(e.detail));

  window.ide.onFileOpened(async (filePath) => {
    const result = await window.ide.readFile(filePath);
    openFileInEditor(filePath);
    onFileSelected?.(filePath, result);
  });
  window.ide.onRunCommand((cmd) => runCommand(cmd));

  window.ide.onDependencyStatus((deps) => {
    if (!deps.java.ok) {
      showNotification(`Java not found: ${deps.java.error || "Please install JRE/JDK"}`, "error", 10000);
      appendLine("error", "[sys] Java missing. Extension signing will fail.", Date.now());
    }
    if (!deps.buildKit.ok) {
      showNotification(`Build Kit missing: ${deps.buildKit.error}`, "error", 10000);
      appendLine("error", "[sys] LBE Build Kit not found in sibling directory.", Date.now());
    }
    if (!deps.adobeDebug.ok) {
      showNotification(`Adobe Debug Mode: ${deps.adobeDebug.status}. ${deps.adobeDebug.error}`, "warning", 10000);
      appendLine("sys", `[sys] Adobe PlayerDebugMode is ${deps.adobeDebug.status}.`, Date.now());
    }
  });
}

// ── Editor Jumping & Linkification ──────────────────────────────────────────
document.addEventListener("click", (e) => {
  const link = e.target.closest(".terminal-link");
  if (!link) return;

  const file = link.dataset.file;
  const line = parseInt(link.dataset.line, 10);
  if (file && !isNaN(line)) {
    editorStore.jumpToLine(file, line);
  }
});

window.addEventListener("editor-jump", (e) => {
  const { path, line } = e.detail;

  // Resolve relative paths if possible
  let absPath = path;
  if (isElectron && currentProject && !path.startsWith(currentProject)) {
    try {
      const resolved = resolveProjectWritePath(path);
      absPath = resolved.absolutePath;
    } catch { }
  }

  // Open the tab if not open
  const existingTab = editorStore.tabs.find(t => t.path === absPath);
  if (!existingTab) {
    if (isElectron) {
      window.ide.readFile(absPath).then(res => {
        if (res.ok) {
          editorStore.addTab(absPath, absPath.split(/[\\/]/).pop(), res.content);
          renderEditor();
          setTimeout(() => performJump(absPath, line), 100);
        } else {
          showNotification(`Could not open ${path}`, "error");
        }
      });
    }
  } else {
    // Switch to tab and pane
    const pane = editorStore.panes.find(p => p.tabPaths.includes(absPath));
    if (pane) {
      editorStore.setActivePane(pane.id);
      editorStore.setActiveTab(pane.id, absPath);
    }
    renderEditor();
    setTimeout(() => performJump(absPath, line), 100);
  }
});

function performJump(path, line) {
  const paneEls = document.querySelectorAll(".editor-pane");
  paneEls.forEach(paneEl => {
    const paneId = paneEl.dataset.paneId;
    const pane = editorStore.panes.find(p => p.id === paneId);
    if (pane?.activeTabPath === path) {
      const textarea = paneEl.querySelector("textarea");
      if (textarea) {
        const lineHeight = 19.2;
        const targetScroll = (line - 1) * lineHeight;
        textarea.scrollTop = Math.max(0, targetScroll - (textarea.clientHeight / 3));

        // Focus and pulse highlight
        textarea.focus();
        const lineNum = paneEl.querySelector(`.line-number[data-line="${line}"]`);
        if (lineNum) {
          lineNum.classList.add("line-highlight-pulse");
          setTimeout(() => lineNum.classList.remove("line-highlight-pulse"), 1500);
        }

        // Set cursor position
        const lines = textarea.value.split("\n");
        let charPos = 0;
        for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
          charPos += lines[i].length + 1;
        }
        textarea.setSelectionRange(charPos, charPos);
      }
    }
  });
}

// ── History panel ──────────────────────────────────────────────────────────
const historyList = document.getElementById("history-list");

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function makeHistoryItem(entry) {
  const li = document.createElement("li");
  li.className = "history-item";
  li.dataset.id = entry.id ?? "";
  li.innerHTML = `
    <span class="h-dot ${entry.status ?? ""}"></span>
    <span class="h-cmd">${entry.command}</span>
    <span class="h-time">${formatTime(entry.startedAt)}</span>
  `;
  if (entry.id && !entry.command.startsWith("[Txn]")) {
    li.addEventListener("click", () => {
      selectCommand(entry.id);
      store.ui.selectedCommandId = entry.id;
      renderTerminal();
      renderPanels();
    });
  }
  return li;
}

function prependHistoryItem(entry) {
  if (!historyList) return;
  historyList.insertBefore(makeHistoryItem(entry), historyList.firstChild);
  for (const el of [...historyList.children]) {
    if (el.classList.contains("history-empty")) el.remove();
  }
}

function updateHistoryDot(id, status) {
  const li = historyList?.querySelector(`[data-id="${id}"]`);
  const dot = li?.querySelector(".h-dot");
  if (dot) dot.className = `h-dot ${status}`;
}

function auditEventToTimelineItem(event) {
  if (!event) return null;
  switch (event.eventType) {
    case "txn.intent": return { time: event.timestamp, label: `Suggested files (${event.summary.fileCount})`, status: "pending", type: "write_intent", txnId: event.txnId };
    case "txn.commit_completed": return { time: event.timestamp, label: `Committed grouped write`, status: "success", type: "write_commit", txnId: event.txnId };
    case "txn.rollback_completed": return { time: event.timestamp, label: `Rolled back grouped write`, status: "warning", type: "write_rollback", txnId: event.txnId };
    case "txn.failed": return { time: event.timestamp, label: event.payload?.error?.message || `Grouped write failed`, status: "error", type: "write_failed", txnId: event.txnId };
    default: return null;
  }
}

function auditToolEventToTimelineItem(event) {
  if (!event || !event.eventType) return null;
  const tool = event.summary?.tool || event.payload?.tool || "tool";
  switch (event.eventType) {
    case "tool.ok":
      return { time: event.timestamp, label: `Tool OK: ${tool}`, status: "success", type: "tool_ok", id: event.eventId };
    case "tool.error":
      return { time: event.timestamp, label: `Tool ERROR: ${tool}`, status: "error", type: "tool_error", id: event.eventId };
    case "tool.denied":
      return { time: event.timestamp, label: `Tool DENIED: ${tool}`, status: "warning", type: "tool_denied", id: event.eventId };
    case "tool.fault_injected":
      return { time: event.timestamp, label: `Tool FAULT: ${tool}`, status: "warning", type: "tool_fault", id: event.eventId };
    default:
      return null;
  }
}

async function loadHistory() {
  if (!historyList) return;

  let allItems = [];
  try {
    const res = await fetch("/api/commands");
    const data = await res.json();
    const list = data.commands ?? [];

    if (list.length === 0) {
      const sRes = await fetch("/api/session");
      const sData = await sRes.json();
      allItems = (sData.session?.recentCommands ?? []).slice();
    } else {
      allItems = list.slice();
    }
  } catch { }

  if (isElectron && window.ide.readAuditLog && currentProject) {
    try {
      const auditLogs = await window.ide.readAuditLog(currentProject);

      // ── Transaction events (grouped by txnId) ──────────────────────────
      const txnEvents = auditLogs.filter(e => ["txn.intent", "txn.commit_completed", "txn.rollback_completed", "txn.failed"].includes(e.eventType));
      const txnMap = new Map();
      txnEvents.forEach(e => {
        txnMap.set(e.txnId, e); // The last event (e.g. commit or fail) overrides the intent
      });

      const txnTimeline = Array.from(txnMap.values())
        .map(auditEventToTimelineItem)
        .filter(Boolean)
        .map(item => ({
          id: item.txnId,
          command: `[Txn] ${item.label}`,
          status: item.status,
          startedAt: new Date(item.time).toISOString()
        }));

      // ── Tool events (un-grouped; keep most recent) ──────────────────────
      const toolEvents = auditLogs
        .filter(e => ["tool.ok", "tool.error", "tool.denied", "tool.fault_injected"].includes(e.eventType))
        .slice(-120)
        .map(auditToolEventToTimelineItem)
        .filter(Boolean)
        .map(item => ({
          id: item.id,
          command: `[Tool] ${item.label}`,
          status: item.status,
          startedAt: new Date(item.time).toISOString()
        }));

      allItems = [...allItems, ...txnTimeline, ...toolEvents];
    } catch (err) {
      console.error("Failed to load audit logs", err);
    }
  }

  allItems.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  historyList.innerHTML = "";
  if (allItems.length === 0) {
    historyList.innerHTML = `<li class="history-empty">No commands yet</li>`;
  } else {
    allItems.reverse();
    for (const e of allItems) historyList.appendChild(makeHistoryItem(e));
  }
}

// ── Command execution ──────────────────────────────────────────────────────
async function runCommand(commandName) {
  return _runCommandInternal(commandName);
}

async function _runCommandInternal(commandName) {
  appendLine("sys", `> ${commandName}`, Date.now());
  setActionState("running", `running ${commandName}`);

  if (!cmdHistory.includes(commandName)) {
    cmdHistory.push(commandName);
    localStorage.setItem('terminal_history', JSON.stringify(cmdHistory));
  }
  cmdHistoryIndex = -1;

  let id;
  try {
    const res = await fetch("/api/command/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: commandName, args: [] }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? "Start failed");
    id = data.id;
  } catch (err) {
    appendLine("error", `[error] ${err.message}`, Date.now());
    showNotification(err.message, "error");
    throw err;
  }

  createCommand(id, commandName);
  bindCommandTerminal(id, commandName);
  prependHistoryItem({ id, command: commandName, status: "running", startedAt: new Date().toISOString() });
  renderPanels();

  return new Promise((resolve, reject) => {
    let watchdog = setTimeout(() => {
      streamFinalized = true;
      if (source) source.close();
      setError(id, { code: "COMMAND_TIMEOUT", message: `Command timed out after 180s: ${commandName}`, stage: "terminal", raw: null });
      finalizeCommand(id, "timed_out");
      updateHistoryDot(id, "error");
      appendLineForCommand(id, "error", `[ERROR]\nmessage: Command timed out after 180s\nsource: terminal`, Date.now());
      notifyActionResult(false, "", `Command timed out: ${commandName}`, "terminal");
      renderPanels();
      reject(new Error(`Command timed out: ${commandName}`));
    }, 180000);

    let streamFinalized = false;

    const source = openCommandStream(id, {
      onStatus({ status, phase }) {
        if (streamFinalized) return;
        updateStatus(id, { status, phase });
        renderPanels();
      },
      onStdout({ line }) {
        if (streamFinalized) return;
        appendStdout(id, line);
        appendLineForCommand(id, "info", line, Date.now());
      },
      onStderr({ line }) {
        if (streamFinalized) return;
        appendStderr(id, line);
        appendLineForCommand(id, "error", line, Date.now());
      },
      onResult({ result }) {
        if (streamFinalized) return;
        if (result) {
          setResult(id, result);
        }
        renderPanels();
      },
      onCommandError({ error }) {
        if (streamFinalized) return;
        streamFinalized = true;
        clearTimeout(watchdog);
        setError(id, error || { code: "COMMAND_ERROR", message: "Command failed", stage: "terminal", raw: null });
        finalizeCommand(id, "error");
        updateHistoryDot(id, "error");
        appendLineForCommand(id, "error", `[ERROR]\nmessage: ${(error?.message || "Command failed")}\nsource: terminal`, Date.now());
        notifyActionResult(false, "", error?.message || `Command ${commandName} failed`, "terminal");
        renderPanels();
        reject(error || new Error("Command failed"));
      },
      onDone({ status }) {
        if (streamFinalized) return;
        streamFinalized = true;
        finalizeCommand(id, status);
        clearTimeout(watchdog);
        updateHistoryDot(id, status);
        appendLineForCommand(id, "sys", `[done] ${commandName} → ${String(status || "success").toUpperCase()}`, Date.now());
        notifyActionResult(status === "success", `Command ${commandName} success`, `Command ${commandName} failed`, "terminal");
        renderPanels();
        if (status === "success") {
          const cmd = store.commands.byId[id];
          resolve(cmd?.result);
        } else {
          reject(new Error(`Command completed with status: ${status}`));
        }
      },
      onError(err) {
        if (streamFinalized) return;
        streamFinalized = true;
        clearTimeout(watchdog);
        setError(id, { code: "SSE_ERROR", message: err.message, stage: "bridge", raw: null });
        addDebugCatcherItem({
          id: `catch_${Date.now()}`,
          source: "bridge",
          message: err.message,
          time: Date.now(),
          details: null,
        });
        updateHistoryDot(id, "error");
        appendLineForCommand(id, "error", `[ERROR]\nmessage: ${err.message}\nsource: terminal`, Date.now());
        notifyActionResult(false, "", `Stream error: ${err.message}`, "terminal");
        renderPanels();
        reject(err);
      },
    });
  });
}

// ── Debug catcher: global error funnels (non-kit issues) ───────────────────
window.addEventListener("error", (e) => {
  addDebugCatcherItem({
    id: `catch_${Date.now()}`,
    source: "ui",
    message: e?.message || "Unhandled UI error",
    time: Date.now(),
    details: null,
  });
  renderPanels();
});

window.addEventListener("unhandledrejection", (e) => {
  addDebugCatcherItem({
    id: `catch_${Date.now()}`,
    source: "ui",
    message: e?.reason?.message || String(e?.reason || "Unhandled promise rejection"),
    time: Date.now(),
    details: null,
  });
  renderPanels();
});

// Debug catcher filter clicks
const debugContent = document.getElementById("debug-content");
debugContent?.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("catcher-filter")) {
    const filter = target.dataset.filter || "all";
    setDebugCatcherFilter(filter);
    renderPanels();
  }
});

// ── Terminal input ─────────────────────────────────────────────────────────
const commandInput = document.getElementById("command-input");
const runBtn = document.getElementById("run-btn");

runBtn?.addEventListener("click", () => {
  const value = commandInput.value.trim();
  if (!value) return;
  commandInput.value = "";
  runCommand(value);
});

commandInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runBtn.click();
  } else {
    handleCommandHistory(e);
  }
});

for (const btn of document.querySelectorAll("[data-command]")) {
  btn.addEventListener("click", async () => {
    const command = btn.getAttribute("data-command");
    btn.disabled = true;
    try { await runCommand(command); } finally { btn.disabled = false; }
  });
}

// ── System Health Panel ────────────────────────────────────────────────────
const runAuditBtn = document.getElementById("run-audit-btn");
const healthStatusChip = document.getElementById("health-status-chip");
const healthSummary = document.getElementById("health-summary");
const healthIssuesList = document.getElementById("health-issues-list");

let currentAuditResult = null;

function renderSystemHealth(result) {
  if (!result) return;
  currentAuditResult = result;

  // Dedupe issues
  if (result.issues) {
    const map = {};
    result.issues = result.issues.filter(issue => {
      const key = `${issue.type}::${issue.location}`;
      if (!map[key]) {
        map[key] = true;
        return true;
      }
      return false;
    });
  }

  const buildState = mapAuditToBuildState(result);

  // Update Status Chip
  const crit = result.summary?.critical || 0;
  const high = result.summary?.high || 0;

  if (crit > 0) {
    healthStatusChip.textContent = "Blocked";
    healthStatusChip.className = "health-status-chip blocked";
  } else if (high > 0) {
    healthStatusChip.textContent = "Warning";
    healthStatusChip.className = "health-status-chip warning";
  } else {
    healthStatusChip.textContent = "Clean";
    healthStatusChip.className = "health-status-chip clean";
  }

  if (healthStatusChip) {
    healthStatusChip.title = `Build State: ${buildState}`;
  }

  // Render Summary Cards
  const sh = result.system_health || {};
  let cardsHtml = "";
  for (const [key, value] of Object.entries(sh)) {
    cardsHtml += `
      <div class="health-card">
        <span class="health-card-title">${key.replace(/_/g, ' ')}</span>
        <span class="health-card-value ${value.replace(/ /g, '_')}">${value.toUpperCase()}</span>
      </div>
    `;
  }
  healthSummary.innerHTML = cardsHtml;

  // Render Issues
  if (!result.issues || result.issues.length === 0) {
    healthIssuesList.innerHTML = `<div class="health-empty">System is clean. No issues detected.</div>`;
    return;
  }

  healthIssuesList.innerHTML = result.issues.map(issue => `
    <div class="health-issue ${issue.severity}">
      <div class="health-issue-header">
        <span class="health-issue-id">${issue.id}</span>
        <span class="health-issue-cat">${issue.category}</span>
      </div>
      <div class="health-issue-type">${issue.type}</div>
      <div class="health-issue-desc">${issue.description}</div>
      <div class="health-issue-loc">${issue.location}</div>
    </div>
  `).join("");
}

function mapAuditToBuildState(result) {
  const s = result.summary;
  if (s.critical > 0) return setBuildState("AUDIT_BLOCKED");
  if (s.high > 0) return setBuildState("AUDIT_WARNING");
  if (s.total_issues === 0) return setBuildState("AUDIT_CLEAN");
  return setBuildState("AUDIT_PASS_WITH_NOTES");
}

function setBuildState(state) {
  window.__BUILD_STATE__ = state;
  return state;
}

let _auditDebounceTimer = null;
function enqueueAuditAfter(eventType, ctx) {
  if (_auditDebounceTimer) clearTimeout(_auditDebounceTimer);
  _auditDebounceTimer = setTimeout(() => {
    appendLine("sys", `[audit] Auto-trigger after ${eventType}`, Date.now());
    auditRunner.runAudit(currentProject, null, (res) => {
      if (res) renderSystemHealth(res);
    });
  }, 1000);
}

runAuditBtn?.addEventListener("click", () => {
  if (runAuditBtn.disabled) return;
  runAuditBtn.disabled = true;
  runAuditBtn.textContent = "Auditing...";
  healthIssuesList.innerHTML = `<div class="health-empty">Analyzing system layers...</div>`;

  auditRunner.runAudit(currentProject,
    (progressMsg) => {
      healthIssuesList.innerHTML = `<div class="health-empty">${progressMsg}</div>`;
    },
    (result, err) => {
      runAuditBtn.disabled = false;
      runAuditBtn.textContent = "Run Audit";
      if (err) {
        healthIssuesList.innerHTML = `<div class="health-empty" style="color:var(--error)">Audit failed: ${err.message}</div>`;
      } else {
        renderSystemHealth(result);

        // Show notification based on severity
        if (result.summary?.critical > 0) {
          showNotification(`System Audit: ${result.summary.critical} CRITICAL issues found`, "error");
        } else if (result.summary?.high > 0) {
          showNotification(`System Audit: ${result.summary.high} High issues found`, "warning");
        } else {
          showNotification(`System Audit: Clean`, "success");
        }
      }
    }
  );
});

// ── Bridge status ──────────────────────────────────────────────────────────
async function loadBridgeStatus() {
  const res = await fetch("/api/status");
  const data = await res.json();
  renderBridgeStatus(data.bridge);
  appendLine("sys", `[bridge] ${data.bridge.commands.length} commands available`, Date.now());
  renderPanels();
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function bootApp() {
  appendLine("sys", `[shell] LB CEP Developer booted — ${isElectron ? "Electron" : "web shell"}`, Date.now());
  dismissBlockingOverlays();
  sessionMemory.load();
  renderPanels();
  terminalStore.loadFromSession();
  renderTerminal();
  await settingsStore.load();
  if (!settingsStore.config.provider) {
    settingsStore.config.provider = listProviders()[0]?.id || "openai";
  }
  // Sync agent selector and model badge from saved config
  const _bc = settingsStore.config;
  if (agentSelector && _bc.provider) agentSelector.value = _bc.provider;
  updateModelBadge(_bc.model, _bc.smartModelSelection !== false);
  updateSmartModeUI(_bc.smartModelSelection !== false);
  confidenceEngine.init();
  chatStore.load();
  renderChat();

  if (!isElectron) {
    [gitRefreshBtn, gitCreateBranchBtn, gitCommitPushBtn, gitNewBranchInput, gitCommitMessageEl].forEach((el) => {
      if (!el) return;
      el.disabled = true;
      el.title = "Available in Electron desktop mode";
    });
  }

  // Sync agent selector to stored provider (loop-guarded, runs after settingsStore.load())
  if (agentSelector) {
    const storedProvider = settingsStore.config.provider || listProviders()[0]?.id || "openai";
    if (agentSelector.value !== storedProvider) {
      agentSelector.value = storedProvider;
    }
  }

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') document.body.classList.add('light-theme');

  if (editorStore.loadFromSession()) {
    renderEditor();
  }
  loadBridgeStatus().catch((err) => appendLine("error", `[bridge] ${err.message}`, Date.now()));
  loadHistory();
}

bootApp();
