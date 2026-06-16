// File explorer — only functional inside Electron (requires window.ide IPC bridge)
const treeRoot = document.getElementById("file-tree");
const openProjectBtn = document.getElementById("open-project-btn");
const projectLabel = document.getElementById("project-label");

export let currentProject = null;
let expandedPaths = new Set();
let selectedPaths = new Set();  // multi-select tracking
let dragSrcPath = null;          // HTML5 drag source

// Load expanded paths from session
const savedExpanded = localStorage.getItem('explorer_expanded');
if (savedExpanded) {
  try {
    expandedPaths = new Set(JSON.parse(savedExpanded));
  } catch (e) {}
}

function saveExpanded() {
  localStorage.setItem('explorer_expanded', JSON.stringify([...expandedPaths]));
}

// ── File viewer callback (set by app.js) ──────────────────────────────────
let onFileSelect = null;
export function onFileSelected(cb) { onFileSelect = cb; }

// ── Public API ─────────────────────────────────────────────────────────────
export async function openProject(dirPath) {
  currentProject = dirPath;
  const name = dirPath.split(/[\\/]/).pop();
  if (projectLabel) projectLabel.textContent = name;
  treeRoot.innerHTML = "";
  await renderDir(dirPath, treeRoot, 0);
  updateHighlights();
}

export function openFileInEditor(filePath) {
  loadFile(filePath);
}

export function updateHighlights(activePath, dirtyPaths = []) {
  const items = treeRoot.querySelectorAll(".tree-item");
  items.forEach(item => {
    const path = item.dataset.path;
    item.classList.toggle("active", path === activePath);
    item.classList.toggle("dirty", dirtyPaths.includes(path));
  });
}

// ── Tree rendering ─────────────────────────────────────────────────────────
async function renderDir(dirPath, parentEl, depth) {
  if (!window.ide) return;

  const entries = await window.ide.readDir(dirPath);

  for (const entry of entries) {
    if (entry.name.startsWith(".") && depth === 0) continue; // hide dotfiles at root
    if (shouldIgnore(entry.name)) continue;

    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDir ? "tree-dir" : "tree-file"}`;
    item.style.paddingLeft = `${6 + depth * 14}px`;
    item.dataset.path = entry.path;
    item.draggable = true;

    const icon = document.createElement("span");
    icon.className = "tree-icon";
    const isExpanded = expandedPaths.has(entry.path);
    icon.textContent = entry.isDir ? (isExpanded ? "▼" : "▶") : fileIcon(entry.name);

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.name;

    item.appendChild(icon);
    item.appendChild(label);
    parentEl.appendChild(item);

    // Context Menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, entry);
    });

    // ── HTML5 Drag & Drop ────────────────────────────────────────────────
    item.addEventListener("dragstart", (e) => {
      dragSrcPath = entry.path;
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      treeRoot.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    });

    if (entry.isDir) {
      const children = document.createElement("div");
      children.className = "tree-children";
      children.hidden = !isExpanded;
      parentEl.appendChild(children);

      if (isExpanded) {
        await renderDir(entry.path, children, depth + 1);
      }

      // Drop target: accept files/folders dragged onto directories
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", async (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        if (!dragSrcPath || dragSrcPath === entry.path) return;
        const srcName = dragSrcPath.split(/[\\/]/).pop();
        const sep = entry.path.includes("\\") ? "\\" : "/";
        const destPath = entry.path + sep + srcName;
        if (destPath === dragSrcPath) return;
        const res = await window.ide.renameFile(dragSrcPath, destPath);
        if (res.ok) { await openProject(currentProject); }
        else { alert(`Move failed: ${res.error}`); }
      });

      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const expanded = !children.hidden;
        children.hidden = expanded;
        icon.textContent = expanded ? "▶" : "▼";
        item.classList.toggle("expanded", !expanded);

        if (!expanded) {
          expandedPaths.add(entry.path);
          if (!children.hasChildNodes()) {
            await renderDir(entry.path, children, depth + 1);
          }
        } else {
          expandedPaths.delete(entry.path);
        }
        saveExpanded();
      });
    } else {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          // Multi-select toggle
          if (selectedPaths.has(entry.path)) {
            selectedPaths.delete(entry.path);
            item.classList.remove("multi-selected");
          } else {
            selectedPaths.add(entry.path);
            item.classList.add("multi-selected");
          }
          return;
        }
        // Regular click: clear multi-select, activate single file
        selectedPaths.clear();
        treeRoot.querySelectorAll(".multi-selected").forEach(el => el.classList.remove("multi-selected"));
        for (const el of treeRoot.querySelectorAll(".tree-item.active")) {
          el.classList.remove("active");
        }
        item.classList.add("active");
        loadFile(entry.path);
      });
    }
  }
}

async function loadFile(filePath) {
  if (!window.ide) return;
  const result = await window.ide.readFile(filePath);
  if (onFileSelect) onFileSelect(filePath, result);
}

// ── Context Menu ───────────────────────────────────────────────────────────
let contextMenu = null;

function showContextMenu(x, y, entry) {
  if (contextMenu) hideContextMenu();

  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.style.top = `${y}px`;
  contextMenu.style.left = `${x}px`;

  const actions = [];
  if (!entry.isDir) {
    actions.push({ label: "Open", action: () => loadFile(entry.path) });
    actions.push({ label: "Duplicate", action: () => duplicateEntry(entry) });
  }
  actions.push({ label: "New File", action: () => createFileInDir(entry) });
  actions.push({ label: "New Folder", action: () => createFolderInDir(entry) });
  actions.push({ separator: true });
  actions.push({ label: "Copy Path", action: () => navigator.clipboard?.writeText(entry.path) });
  if (currentProject) {
    const rel = entry.path.replace(currentProject, "").replace(/^[\\/]/, "");
    actions.push({ label: "Copy Relative Path", action: () => navigator.clipboard?.writeText(rel) });
  }
  actions.push({ separator: true });
  actions.push({ label: "Reveal in Explorer", action: () => revealInFolder(entry) });
  actions.push({ label: "Rename", action: () => renameEntry(entry) });
  actions.push({ label: "Delete", action: () => deleteEntry(entry), color: "var(--error)" });
  actions.push({ separator: true });
  actions.push({ label: "Doctor", action: () => runBK('doctor') });
  actions.push({ label: "Check", action: () => runBK('check') });
  actions.push({ label: "Dev", action: () => runBK('dev') });
  actions.push({ label: "Changelog", action: () => runBK('changelog') });

  actions.forEach(a => {
    if (a.separator) {
      const sep = document.createElement("div");
      sep.className = "cm-sep";
      contextMenu.appendChild(sep);
      return;
    }
    const item = document.createElement("div");
    item.className = "cm-item";
    if (a.color) item.style.color = a.color;
    item.textContent = a.label;
    item.addEventListener("click", () => {
      a.action();
      hideContextMenu();
    });
    contextMenu.appendChild(item);
  });

  document.body.appendChild(contextMenu);
  window.addEventListener("click", hideContextMenu, { once: true });
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

async function renameEntry(entry) {
  const newName = prompt(`Rename "${entry.name}" to:`, entry.name);
  if (!newName || newName === entry.name) return;
  if (!window.ide?.renameFile) return;

  const lastSep = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'));
  const dir = entry.path.substring(0, lastSep);
  const sep = entry.path.includes('\\') ? '\\' : '/';
  const newPath = dir + sep + newName;

  const res = await window.ide.renameFile(entry.path, newPath);
  if (res.ok) {
    await openProject(currentProject);
  } else {
    alert(`Rename failed: ${res.error}`);
  }
}

async function deleteEntry(entry) {
  const confirmed = confirm(`Delete "${entry.name}"?${entry.isDir ? '\nThis will delete the entire folder.' : ''}`);
  if (!confirmed) return;
  if (!window.ide?.deleteFile) return;

  const res = await window.ide.deleteFile(entry.path);
  if (res.ok) {
    await openProject(currentProject);
  } else {
    alert(`Delete failed: ${res.error}`);
  }
}

async function createFileInDir(entry) {
  if (!window.ide?.createFile) return;
  const dir = entry.isDir
    ? entry.path
    : entry.path.substring(0, Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\")));
  const name = prompt("New file name:");
  if (!name || !name.trim()) return;
  const sep = entry.path.includes("\\") ? "\\" : "/";
  const newPath = dir + sep + name.trim();
  const res = await window.ide.createFile(newPath, "");
  if (res.ok) { await openProject(currentProject); }
  else { alert(`Create failed: ${res.error}`); }
}

async function createFolderInDir(entry) {
  if (!window.ide?.createFolder) return;
  const dir = entry.isDir
    ? entry.path
    : entry.path.substring(0, Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\")));
  const name = prompt("New folder name:");
  if (!name || !name.trim()) return;
  const sep = entry.path.includes("\\") ? "\\" : "/";
  const newPath = dir + sep + name.trim();
  const res = await window.ide.createFolder(newPath);
  if (res.ok) { await openProject(currentProject); }
  else { alert(`Create folder failed: ${res.error}`); }
}

async function duplicateEntry(entry) {
  if (!window.ide?.createFile || !window.ide?.readFile) return;
  const base = entry.name.replace(/(\.[^.]+)$/, "") + " copy";
  const ext  = entry.name.match(/(\.[^.]+)$/)?.[1] || "";
  const name = prompt(`Duplicate "${entry.name}" as:`, base + ext);
  if (!name || !name.trim()) return;
  const lastSep = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"));
  const dir  = entry.path.substring(0, lastSep);
  const sep  = entry.path.includes("\\") ? "\\" : "/";
  const newPath = dir + sep + name.trim();
  const read = await window.ide.readFile(entry.path);
  if (!read.ok) { alert(`Read failed: ${read.error}`); return; }
  const res = await window.ide.createFile(newPath, read.content);
  if (res.ok) { await openProject(currentProject); }
  else { alert(`Duplicate failed: ${res.error}`); }
}

function revealInFolder(entry) {
  if (window.ide?.revealInFolder) window.ide.revealInFolder(entry.path);
}

function runBK(cmd) {
  window.dispatchEvent(new CustomEvent('run-command', { detail: `ext-build ${cmd}` }));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function shouldIgnore(name) {
  return ["node_modules", ".git", ".build-report", "release-out", "dist"].includes(name);
}

function fileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    js: "JS", mjs: "JS", ts: "TS", json: "{}",
    html: "HT", css: "CS", md: "MD", txt: "TX",
    xml: "XM", mxf: "MX", jsx: "JS", tsx: "TS",
  };
  return map[ext] ?? "—";
}

// ── Open Project button ────────────────────────────────────────────────────
if (openProjectBtn) {
  openProjectBtn.addEventListener("click", async () => {
    if (!window.ide) {
      alert("Open Project is only available in the Electron desktop app.\nUse File → Open Project… from the menu.");
      return;
    }
    // Use the IPC dialog to open a folder picker
    const dirPath = await window.ide.openProjectDialog();
    if (dirPath) {
      // Fire the same event the menu uses
      window.dispatchEvent(new CustomEvent('project-open-requested', { detail: dirPath }));
    }
  });
}
