import { store } from "./commandStore.js";

const container = document.getElementById("debug-content");

function section(label, content, cls = "") {
  return `<div class="debug-section ${cls}">
    <div class="debug-label">${label}</div>
    <div class="debug-value">${content}</div>
  </div>`;
}

function jsonBlock(obj, label = "Data") {
  return `
    <div class="collapsible">
      <div class="collapsible-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
        <span>${label}</span>
        <span class="muted">▾ JSON</span>
      </div>
      <pre class="debug-json">${JSON.stringify(obj, null, 2)}</pre>
    </div>
  `;
}

export function renderDebug() {
  const id = store.ui.selectedCommandId ?? store.ui.activeCommandId;

  if (!id) {
    container.innerHTML = `<div class="debug-empty">No command selected</div>`;
    return;
  }

  const cmd = store.commands.byId[id];
  if (!cmd) return;

  const elapsed = cmd.endedAt
    ? `${((new Date(cmd.endedAt) - new Date(cmd.startedAt)) / 1000).toFixed(2)}s`
    : "running…";

  let html = "";
  html += section("Command", `<code>${cmd.command}</code>`);
  
  // Timeline — phases match bridge lifecycle exactly
  const phases = ["init", "process-spawned", "streaming-output", "parsing-json", "completed"];
  const phaseLabels = {
    "init":             "Init",
    "process-spawned":  "Starting",
    "streaming-output": "Running",
    "parsing-json":     "Parsing",
    "completed":        "Done",
  };
  const currentPhase = cmd.status === "error" ? "completed" : (cmd.phase || "init");
  const currentPhaseIndex = phases.indexOf(currentPhase);

  html += '<div class="debug-section"><div class="debug-label">Timeline</div><div class="timeline">';
  phases.forEach((p, i) => {
    const active = i <= currentPhaseIndex;
    const isCurrent = i === currentPhaseIndex;
    const isError = cmd.status === "error" && i === currentPhaseIndex;
    html += `
      <div class="timeline-step ${active ? "active" : ""} ${isCurrent ? "current" : ""} ${isError ? "error" : ""}">
        <div class="step-dot"></div>
        <div class="step-label">${phaseLabels[p]}</div>
      </div>
    `;
  });
  html += '</div></div>';

  html += section("Status", `<span class="status-pill ${cmd.status}">${cmd.status}</span>  <span class="muted">${elapsed}</span>`);

  if (cmd.result) {
    const summary = cmd.result.summary;
    if (summary) {
      html += section(
        "Summary",
        `<span class="pass-count">✓ ${summary.checksPassed} passed</span>` +
        (summary.checksFailed ? `  <span class="fail-count">✗ ${summary.checksFailed} failed</span>` : "") +
        (summary.artifactCount ? `  <span class="muted">${summary.artifactCount} artifacts</span>` : "")
      );
    }
    html += jsonBlock(cmd.result, "Result Payload");
  }

  if (cmd.error) {
    html += `<div class="debug-section error"><div class="debug-label">Error Details</div>${jsonBlock(cmd.error)}</div>`;
  }

  if (cmd.result?.reportPath) {
    html += section("Report Path", `<span class="muted path">${cmd.result.reportPath}</span>`);
  }

  // Debug catcher feed (non-kit issues)
  if (store.debugCatcher.items.length > 0) {
    const activeFilter = store.debugCatcher.filter || "all";
    html += '<div class="debug-section"><div class="debug-label">Debugger Catcher</div>';
    html += `<div class="catcher-filters">
      <button class="catcher-filter ${activeFilter === "all" ? "active" : ""}" data-filter="all">All</button>
      <button class="catcher-filter ${activeFilter === "ui" ? "active" : ""}" data-filter="ui">UI</button>
      <button class="catcher-filter ${activeFilter === "bridge" ? "active" : ""}" data-filter="bridge">Bridge</button>
    </div>`;
    html += '<div class="log-timeline">';

    const items = store.debugCatcher.items.filter(item =>
      activeFilter === "all" ? true : item.source === activeFilter
    );

    items.slice(0, 12).forEach(item => {
      const t = new Date(item.time).toLocaleTimeString();
      const safeText = String(item.message || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      html += `<div class="log-event log-event-${item.source}">
        <span class="log-event-time">${t}</span>
        <span class="log-event-type">${item.source}</span>
        <span class="log-event-text">${safeText}</span>
      </div>`;
    });
    html += "</div></div>";
  }

  // Event log timeline — reads from cmd.logs (populated by commandStore)
  if (cmd.logs && cmd.logs.length > 0) {
    html += '<div class="debug-section"><div class="debug-label">Event Log</div>';
    html += '<div class="log-timeline">';

    const firstLog = cmd.logs[0];
    const startTime = typeof firstLog.time === "number"
      ? firstLog.time
      : new Date(firstLog.time).getTime();

    cmd.logs.slice(-30).forEach(log => {
      const t = typeof log.time === "number" ? log.time : new Date(log.time).getTime();
      const relSec = ((t - startTime) / 1000).toFixed(2);
      const raw = log.line || "";
      const shortLine = raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
      const safeText = shortLine
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      html += `<div class="log-event log-event-${log.type}">
        <span class="log-event-time">+${relSec}s</span>
        <span class="log-event-type">${log.type}</span>
        <span class="log-event-text">${safeText}</span>
      </div>`;
    });

    html += "</div></div>";
  }

  container.innerHTML = html;
}
