/**
 * OpenClaw Execution Debug Environment — Panel UI
 *
 * Mounts a floating debug panel into the document body.
 * Shows real-time orchestration observability across four tabs:
 *
 *  Timeline        — step execution events in chronological order
 *  Retry Decisions — retry/replay outcomes and regression guards
 *  Permission State — agent registry state + escalation level
 *  Fault Injection  — control panel for test flags
 *
 * Usage:
 *   import { edePanel } from "./openclaw/ede/edePanel.js";
 *   edePanel.mount();   // shows the panel
 *   edePanel.unmount(); // removes it
 *   edePanel.toggle();  // keyboard shortcut target
 *
 * The panel injects its own CSS. No external stylesheet is required.
 */
import { edeEventBus }  from "../core/edeEventBus.js";
import { faultInjector } from "../core/faultInjector.js";
import { agentRegistry } from "../core/agentRegistry.js";
import { sessionMemory } from "../../sessionMemory.js";

// ── Styles ────────────────────────────────────────────────────────────────────

const EDE_STYLES = `
#ede-panel {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 480px;
  height: 380px;
  background: #0e0e12;
  border: 1px solid #2a2a3a;
  border-bottom: none;
  border-right: none;
  border-radius: 8px 0 0 0;
  display: flex;
  flex-direction: column;
  font-family: "Consolas", "Menlo", monospace;
  font-size: 11px;
  color: #c0c0d0;
  z-index: 9999;
  box-shadow: -4px -4px 20px rgba(0,0,0,0.6);
  user-select: none;
}
#ede-panel.ede-collapsed {
  height: 32px;
}
#ede-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: #13131a;
  border-bottom: 1px solid #2a2a3a;
  border-radius: 8px 0 0 0;
  cursor: pointer;
  flex-shrink: 0;
}
#ede-header .ede-badge {
  background: #7c3aed;
  color: #e0d0ff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 8px;
  letter-spacing: 0.05em;
}
#ede-header .ede-badge.fault-active {
  background: #b91c1c;
  color: #fecaca;
  animation: ede-pulse 1.4s ease-in-out infinite;
}
@keyframes ede-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
#ede-header .ede-title {
  flex: 1;
  font-weight: 600;
  color: #a0a0c0;
}
#ede-header .ede-controls {
  display: flex;
  gap: 6px;
}
#ede-header button {
  background: none;
  border: none;
  color: #606080;
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}
#ede-header button:hover { color: #c0c0d0; }
#ede-tabs {
  display: flex;
  border-bottom: 1px solid #2a2a3a;
  background: #10101a;
  flex-shrink: 0;
}
.ede-tab {
  padding: 5px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  color: #606080;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: color 0.15s;
}
.ede-tab:hover { color: #a0a0c0; }
.ede-tab.active {
  color: #a78bfa;
  border-bottom-color: #7c3aed;
}
#ede-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ede-pane {
  display: none;
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}
.ede-pane.active { display: flex; flex-direction: column; gap: 2px; }
.ede-event {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 3px;
}
.ede-event:hover { background: #18181f; }
.ede-event .ede-ts {
  color: #404060;
  min-width: 52px;
  font-size: 10px;
}
.ede-event .ede-type {
  min-width: 90px;
  font-size: 10px;
  font-weight: 600;
}
.ede-event .ede-detail { color: #808098; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* type colours */
.ede-type-plan  { color: #60a5fa; }
.ede-type-step  { color: #34d399; }
.ede-type-tool  { color: #fbbf24; }
.ede-type-retry { color: #f472b6; }
.ede-type-fault { color: #f87171; }
/* permission pane */
.ede-kv { display: flex; gap: 8px; margin-bottom: 3px; }
.ede-key { color: #7c6aaa; min-width: 130px; }
.ede-val { color: #c0c0d0; }
.ede-val.ok   { color: #34d399; }
.ede-val.warn { color: #fbbf24; }
.ede-val.err  { color: #f87171; }
.ede-section-header { color: #7c3aed; font-weight: 700; margin: 8px 0 4px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
/* fault controls */
.ede-fault-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ede-fault-row label { color: #a0a0c0; flex: 1; }
.ede-fault-row input[type=checkbox] { accent-color: #7c3aed; width: 13px; height: 13px; cursor: pointer; }
.ede-fault-row input[type=number] { background: #1a1a24; border: 1px solid #2a2a3a; color: #c0c0d0; width: 70px; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
.ede-fault-row input[type=text] { background: #1a1a24; border: 1px solid #2a2a3a; color: #c0c0d0; width: 180px; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
.ede-btn { background: #1e1e2e; border: 1px solid #3a3a5a; color: #a0a0c0; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.ede-btn:hover { background: #2a2a3e; color: #c0c0d0; }
.ede-btn.danger { border-color: #7f1d1d; color: #f87171; }
.ede-btn.danger:hover { background: #2d1414; }
.ede-empty { color: #404060; font-style: italic; padding: 12px 0; text-align: center; }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTs(ts) {
  const s = ((Date.now() - ts) / 1000).toFixed(1);
  return `${s}s`;
}

function typeClass(type) {
  if (type.startsWith("plan"))   return "ede-type-plan";
  if (type.startsWith("step"))   return "ede-type-step";
  if (type.startsWith("tool.fault")) return "ede-type-fault";
  if (type.startsWith("tool"))   return "ede-type-tool";
  if (type.startsWith("retry"))  return "ede-type-retry";
  return "";
}

function eventDetail(ev) {
  switch (ev.type) {
    case "plan.start":    return `"${ev.planName}" agent=${ev.agent}`;
    case "plan.complete": return `"${ev.planName}" → ${ev.status} (${ev.counts?.completed}/${ev.counts?.total})`;
    case "step.intent":   return `${ev.stepId} → ${ev.agentName}:${ev.toolName}`;
    case "step.complete": return `${ev.stepId} [${ev.execClass}]`;
    case "step.fail":     return `${ev.stepId} [${ev.execClass}]: ${ev.error}`;
    case "step.skip":     return `${ev.stepId} — ${ev.reason}`;
    case "tool.call":     return `${ev.agentName}.${ev.toolName}`;
    case "tool.ok":       return `${ev.agentName}.${ev.toolName}`;
    case "tool.denied":   return `${ev.agentName}.${ev.toolName} — ${ev.reason}`;
    case "tool.error":    return `${ev.toolName}: ${ev.error}`;
    case "tool.fault_injected": return `${ev.toolName}: ${ev.reason}`;
    case "retry.start":   return `mode=${ev.mode} steps=${ev.retryCount ?? 1}`;
    case "retry.complete": return `+${ev.improvements} improved`;
    case "retry.rejected": return `REGRESSION: ${ev.reason}`;
    default: return JSON.stringify(ev).slice(0, 80);
  }
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export const edePanel = {

  _el:          null,
  _unsub:       null,
  _tab:         "timeline",
  _collapsed:   false,
  _refreshTimer: null,

  mount() {
    if (this._el) return;

    // Inject styles
    if (!document.getElementById("ede-style")) {
      const s = document.createElement("style");
      s.id = "ede-style";
      s.textContent = EDE_STYLES;
      document.head.appendChild(s);
    }

    // Build DOM
    this._el = document.createElement("div");
    this._el.id = "ede-panel";
    this._el.innerHTML = this._template();
    document.body.appendChild(this._el);

    this._bindEvents();

    // Subscribe to the event bus — re-render timeline tab on new events
    this._unsub = edeEventBus.subscribe(() => {
      if (this._tab === "timeline") this._renderTimeline();
      if (this._tab === "retry")    this._renderRetry();
    });

    // Periodic refresh for permission + fault tabs (state can change externally)
    this._refreshTimer = setInterval(() => {
      if (!this._collapsed) {
        if (this._tab === "permission") this._renderPermission();
        if (this._tab === "fault")      this._renderFault();
        // Also refresh badge if fault state changed
        this._refreshBadge();
      }
    }, 2000);

    this._switchTab(this._tab);
  },

  unmount() {
    if (!this._el) return;
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    this._el.remove();
    this._el = null;
  },

  toggle() {
    if (this._el) { this.unmount(); } else { this.mount(); }
  },

  // ── Template ────────────────────────────────────────────────────────────────

  _template() {
    return `
      <div id="ede-header">
        <span class="ede-badge" id="ede-badge">EDE</span>
        <span class="ede-title">Execution Debug Environment</span>
        <div class="ede-controls">
          <button id="ede-clear" title="Clear events">✕ Clear</button>
          <button id="ede-collapse" title="Collapse">▼</button>
          <button id="ede-close" title="Close">✕</button>
        </div>
      </div>
      <div id="ede-tabs">
        <div class="ede-tab active" data-tab="timeline">Timeline</div>
        <div class="ede-tab" data-tab="retry">Retry</div>
        <div class="ede-tab" data-tab="permission">Permissions</div>
        <div class="ede-tab" data-tab="fault">Fault Inject</div>
      </div>
      <div id="ede-body">
        <div class="ede-pane active" id="ede-pane-timeline"></div>
        <div class="ede-pane" id="ede-pane-retry"></div>
        <div class="ede-pane" id="ede-pane-permission"></div>
        <div class="ede-pane" id="ede-pane-fault"></div>
      </div>
    `;
  },

  // ── Events ──────────────────────────────────────────────────────────────────

  _bindEvents() {
    const el = this._el;

    el.querySelector("#ede-header").addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      this._toggleCollapse();
    });

    el.querySelector("#ede-close").addEventListener("click", () => this.unmount());
    el.querySelector("#ede-collapse").addEventListener("click", () => this._toggleCollapse());
    el.querySelector("#ede-clear").addEventListener("click", () => {
      edeEventBus.clear();
      this._renderTimeline();
      this._renderRetry();
    });

    el.querySelectorAll(".ede-tab").forEach(tab => {
      tab.addEventListener("click", () => this._switchTab(tab.dataset.tab));
    });
  },

  _toggleCollapse() {
    this._collapsed = !this._collapsed;
    this._el.classList.toggle("ede-collapsed", this._collapsed);
    this._el.querySelector("#ede-collapse").textContent = this._collapsed ? "▲" : "▼";
  },

  _switchTab(name) {
    this._tab = name;
    this._el.querySelectorAll(".ede-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    this._el.querySelectorAll(".ede-pane").forEach(p => p.classList.toggle("active", p.id === `ede-pane-${name}`));

    if (name === "timeline")   this._renderTimeline();
    if (name === "retry")      this._renderRetry();
    if (name === "permission") this._renderPermission();
    if (name === "fault")      this._renderFault();
  },

  // ── Timeline Tab ────────────────────────────────────────────────────────────

  _renderTimeline() {
    const pane = this._el?.querySelector("#ede-pane-timeline");
    if (!pane) return;

    // Filter out pure tool.call events (intent-level noise) to keep timeline clean
    const events = edeEventBus.getEvents().filter(e => e.type !== "tool.call").slice(-100);

    if (!events.length) {
      pane.innerHTML = `<div class="ede-empty">No events yet. Run a plan to see execution flow.</div>`;
      return;
    }

    pane.innerHTML = events.map(ev => `
      <div class="ede-event">
        <span class="ede-ts">${relTs(ev.ts)}</span>
        <span class="ede-type ${typeClass(ev.type)}">${ev.type}</span>
        <span class="ede-detail">${_esc(eventDetail(ev))}</span>
      </div>
    `).join("");

    // Auto-scroll to bottom
    pane.scrollTop = pane.scrollHeight;
  },

  // ── Retry Tab ───────────────────────────────────────────────────────────────

  _renderRetry() {
    const pane = this._el?.querySelector("#ede-pane-retry");
    if (!pane) return;

    const events = edeEventBus.getEvents("retry.");

    if (!events.length) {
      pane.innerHTML = `<div class="ede-empty">No retry or replay events yet.</div>`;
      return;
    }

    pane.innerHTML = events.map(ev => `
      <div class="ede-event">
        <span class="ede-ts">${relTs(ev.ts)}</span>
        <span class="ede-type ${typeClass(ev.type)}">${ev.type}</span>
        <span class="ede-detail">${_esc(eventDetail(ev))}</span>
      </div>
    `).join("");

    pane.scrollTop = pane.scrollHeight;
  },

  // ── Permission Tab ──────────────────────────────────────────────────────────

  _renderPermission() {
    const pane = this._el?.querySelector("#ede-pane-permission");
    if (!pane) return;

    const mem = sessionMemory.getSummary?.() ?? {};
    const escalated  = mem.escalated ?? false;
    const violations = mem.securityViolations ?? 0;
    const remainMs   = sessionMemory.escalationRemainingMs?.() ?? 0;

    const agents = agentRegistry._agents ?? agentRegistry.agents ?? {};
    const agentNames = Object.keys(agents);

    pane.innerHTML = `
      <div class="ede-section-header">Session Escalation</div>
      <div class="ede-kv"><span class="ede-key">escalated</span><span class="ede-val ${escalated ? "err" : "ok"}">${escalated}</span></div>
      <div class="ede-kv"><span class="ede-key">violations</span><span class="ede-val ${violations > 0 ? "warn" : ""}">${violations} / 3</span></div>
      ${escalated ? `<div class="ede-kv"><span class="ede-key">decays in</span><span class="ede-val warn">${Math.ceil(remainMs / 1000)}s</span></div>` : ""}
      ${escalated ? `<div class="ede-kv"><span class="ede-key">action</span><button class="ede-btn danger" id="ede-reset-escalation">Reset Escalation</button></div>` : ""}

      <div class="ede-section-header">Agent Registry (${agentNames.length})</div>
      ${agentNames.length === 0 ? '<div class="ede-empty">No agents registered.</div>' : ""}
      ${agentNames.map(name => {
        const a = agents[name];
        const tools = a.allowedTools ?? a.tools ?? [];
        return `
          <div class="ede-kv">
            <span class="ede-key">${_esc(name)}</span>
            <span class="ede-val">${tools.length ? _esc(tools.join(", ")) : "<em>no tools</em>"}</span>
          </div>
        `;
      }).join("")}
    `;

    const resetBtn = pane.querySelector("#ede-reset-escalation");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        sessionMemory.resetEscalation?.();
        this._renderPermission();
      });
    }
  },

  // ── Fault Injection Tab ─────────────────────────────────────────────────────

  _renderFault() {
    const pane = this._el?.querySelector("#ede-pane-fault");
    if (!pane) return;

    const snap = faultInjector.snapshot();

    pane.innerHTML = `
      <div class="ede-section-header">Fault Flags</div>

      <div class="ede-fault-row">
        <input type="checkbox" id="ede-fi-fail" ${snap.FORCE_TOOL_FAIL ? "checked" : ""}>
        <label for="ede-fi-fail">FORCE_TOOL_FAIL — all tool calls fail</label>
      </div>

      <div class="ede-fault-row">
        <input type="checkbox" id="ede-fi-val" ${snap.FORCE_VALIDATOR_FAIL ? "checked" : ""}>
        <label for="ede-fi-val">FORCE_VALIDATOR_FAIL — validator returns ok:false</label>
      </div>

      <div class="ede-fault-row">
        <label for="ede-fi-delay">DELAY_EXECUTION (ms)</label>
        <input type="number" id="ede-fi-delay" value="${snap.DELAY_EXECUTION}" min="0" max="30000" step="100">
      </div>

      <div class="ede-fault-row">
        <label for="ede-fi-tools">FAIL_TOOLS (comma-separated, blank=all)</label>
      </div>
      <div class="ede-fault-row">
        <input type="text" id="ede-fi-tools" placeholder="patchEngine,validator" value="${snap.FAIL_TOOLS ? snap.FAIL_TOOLS.join(",") : ""}">
      </div>

      <div class="ede-fault-row">
        <label for="ede-fi-steps">FAIL_STEP_IDS (comma-separated, blank=all)</label>
      </div>
      <div class="ede-fault-row">
        <input type="text" id="ede-fi-steps" placeholder="step-1,step-2" value="${snap.FAIL_STEP_IDS ? snap.FAIL_STEP_IDS.join(",") : ""}">
      </div>

      <div class="ede-fault-row" style="margin-top:8px;">
        <button class="ede-btn" id="ede-fi-apply">Apply</button>
        <button class="ede-btn danger" id="ede-fi-reset">Reset All</button>
      </div>

      ${snap.active ? `<div style="color:#f87171;margin-top:6px;">⚠ Fault injection is ACTIVE</div>` : ""}
    `;

    pane.querySelector("#ede-fi-apply").addEventListener("click", () => {
      const fail   = pane.querySelector("#ede-fi-fail").checked;
      const valFail = pane.querySelector("#ede-fi-val").checked;
      const delay  = parseInt(pane.querySelector("#ede-fi-delay").value, 10) || 0;
      const toolsRaw = pane.querySelector("#ede-fi-tools").value.trim();
      const stepsRaw = pane.querySelector("#ede-fi-steps").value.trim();

      faultInjector.setFlag("FORCE_TOOL_FAIL",      fail);
      faultInjector.setFlag("FORCE_VALIDATOR_FAIL",  valFail);
      faultInjector.setFlag("DELAY_EXECUTION",       delay);
      faultInjector.setFlag("FAIL_TOOLS",  toolsRaw ? new Set(toolsRaw.split(",").map(s => s.trim())) : null);
      faultInjector.setFlag("FAIL_STEP_IDS", stepsRaw ? new Set(stepsRaw.split(",").map(s => s.trim())) : null);

      this._renderFault();
      this._refreshBadge();
    });

    pane.querySelector("#ede-fi-reset").addEventListener("click", () => {
      faultInjector.reset();
      this._renderFault();
      this._refreshBadge();
    });
  },

  // ── Badge ────────────────────────────────────────────────────────────────────

  _refreshBadge() {
    const badge = this._el?.querySelector("#ede-badge");
    if (!badge) return;
    badge.classList.toggle("fault-active", faultInjector.isActive());
  },
};

// XSS guard for panel-injected HTML
function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
