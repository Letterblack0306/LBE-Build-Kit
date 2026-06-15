import { store } from "./commandStore.js";

const statusBarEl    = document.getElementById("status-bar");
const activeLabelEl  = document.getElementById("active-command-label");
const bridgeStatusEl = document.getElementById("bridge-status");

const phaseLabel = {
  "init":             "Initializing",
  "process-spawned":  "Starting",
  "streaming-output": "Running",
  "parsing-json":     "Parsing",
  "completed":        "Done",
};

export function renderStatusBar() {
  const id = store.ui.activeCommandId;

  if (!id) {
    if (statusBarEl) { statusBarEl.textContent = "● Idle"; statusBarEl.className = "topbar-status"; }
    if (activeLabelEl) activeLabelEl.textContent = "No command running";
    return;
  }

  const cmd = store.commands.byId[id];
  if (!cmd) return;

  const phase = phaseLabel[cmd.phase] ?? cmd.phase ?? "";
  const statusText = cmd.status === "success" ? "Done" : cmd.status === "error" ? "Failed" : phase || cmd.status;

  if (statusBarEl) {
    statusBarEl.textContent = `● ${statusText}`;
    statusBarEl.className = `topbar-status ${cmd.status}`;
  }
  if (activeLabelEl) {
    activeLabelEl.textContent = phase && cmd.status === "running"
      ? `${cmd.command}  —  ${phase}`
      : cmd.command;
  }
}

export function renderBridgeStatus(bridge) {
  if (!bridgeStatusEl || !bridge) return;
  bridgeStatusEl.innerHTML = `
    <div class="bridge-row"><span class="bridge-dot connected"></span>Connected</div>
    <div class="bridge-path muted">${bridge.buildKitRoot}</div>
    <ul class="bridge-cmd-list">
      ${bridge.commands.map((c) => `<li>${c}</li>`).join("")}
    </ul>
  `;
}
