1. UI Architecture (Panel-Level)
Layout (VSCode-style shell)
┌───────────────────────────────────────────────┐
│ Top Bar (Project | Status | Active Command)   │
├───────────────┬───────────────────────────────┤
│ Explorer      │ Editor                        │
│               │                               │
├───────────────┼───────────────┬───────────────┤
│ Terminal      │ Debug Panel   │ Status Panel  │
└───────────────┴───────────────┴───────────────┘
2. UI → Data Mapping
Core Principle

Every UI panel reads from Command State Store, not directly from API.

A. Command State Store (Single Source of Truth)
{
  commands: {
    byId: {
      cmd_1: {
        id,
        command,
        status,
        phase,
        stdout: [],
        stderr: [],
        result,
        error
      }
    },
    allIds: []
  },

  ui: {
    activeCommandId: null,
    selectedCommandId: null
  }
}
3. Panel Mapping
3.1 Terminal Panel
Purpose

Real-time execution visibility

Developer feedback loop

Data Mapping
UI Element	Source
Output lines	commands.byId[id].stdout
Errors	commands.byId[id].stderr
Status badge	commands.byId[id].status
Render Logic
const cmd = store.commands.byId[activeCommandId];

renderLines([
  ...cmd.stdout.map(l => ({ type: 'info', text: l })),
  ...cmd.stderr.map(l => ({ type: 'error', text: l }))
]);
UX Enhancements

Prefix lines with timestamps

Color coding:

info → gray

success → green

error → red

3.2 Debug Panel
Purpose

Structured inspection (not logs)

Data Mapping
Section	Source
Command Info	command, args
Status	status, phase
Result JSON	result
Error Object	error
Report Path	reportPath
Layout
[Command: doctor]

Status: running
Phase: parsing-json

Result:
{ ...formatted JSON... }

Error:
{ ...if exists... }
Render Logic
renderJSON(cmd.result || {});
renderError(cmd.error || null);
3.3 Status Bar
Purpose

Global system awareness

Data Mapping
UI Element	Source
Active status	latest running command
Indicator	derived from status
Logic
const running = commands.find(c => c.status === 'running');

if (running) {
  show("Running: " + running.command);
} else {
  show("Idle");
}
3.4 Explorer Panel
Phase 1 Mapping

(Not yet connected to commands)

Future:

Map selected file → command context

Example:

selectedFile → ext-build.config.json
→ run verify command
3.5 Editor Panel
Role

Config editing (ext-build.config.json)

Script preview

Future:

inline command execution buttons

4. UI Event → API Mapping
A. Run Command (Button / Terminal Input)
UI Action
runCommand("doctor", []);
API Call
POST /api/command/start
Store Update
store.ui.activeCommandId = response.id;
B. Stream Connection
Trigger

Immediately after command start

connectToStream(id);
SSE Handler
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch(event.type) {
    case 'stdout':
      appendStdout(id, data.line);
      break;

    case 'stderr':
      appendStderr(id, data.line);
      break;

    case 'status':
      updateStatus(id, data);
      break;

    case 'result':
      setResult(id, data);
      break;

    case 'done':
      finalizeCommand(id);
      break;
  }
};
5. State Mutations (Critical)
Required Functions
function appendStdout(id, line) {
  store.commands.byId[id].stdout.push(line);
}

function appendStderr(id, line) {
  store.commands.byId[id].stderr.push(line);
}

function updateStatus(id, payload) {
  Object.assign(store.commands.byId[id], payload);
}

function setResult(id, result) {
  store.commands.byId[id].result = result;
}

function finalizeCommand(id) {
  store.commands.byId[id].status = 'success';
}
6. Command History (UI Mapping)
Data
store.commands.allIds
UI

Terminal sidebar or dropdown:

> doctor ✔
> verify ✖
> release ✔
Click Behavior
onSelectCommand(id) {
  store.ui.selectedCommandId = id;
}

→ Debug panel updates

7. Debug Browser Panel (Advanced)
Purpose

Deep inspection

Add Sections

Raw stdout stream

Parsed JSON

Execution timeline

Timeline UI
[10:00:01] init
[10:00:02] process started
[10:00:03] running
[10:00:05] parsing
[10:00:06] completed
Mapping

Use:

cmd.logs = [
  { time, event, data }
]
8. UI State Flow
User clicks Run
→ API start
→ state created
→ SSE connected
→ logs streamed
→ state updated
→ panels react automatically

No panel talks directly to API except the trigger.

9. Styling Guidance (Based on Your UI Direction)
Theme

Dark glass UI

Black / charcoal base

Accent: red (Letterblack identity)

Components
Element	Style
Panels	soft blur + border
Terminal	monospace + subtle glow
JSON	syntax-highlighted
Status	pill indicators
10. Minimal Component Structure
src/js/
  components/
    Terminal/
    Debug/
    Explorer/
    StatusBar/

  state/
    commandStore.js

  services/
    api.js
    sse.js
11. Critical Design Rule

All UI must depend on:

STATE → RENDER

Never:

API → DIRECT UI
12. Result

After this mapping:

Terminal becomes live (not static)

Debug becomes meaningful (not empty panel)

IDE becomes execution-aware system

Ready for:

OpenClaw

Multi-command workflows

Automation pipelines

13. Recommended Immediate Implementation Order

Command store (frontend)

SSE client

Terminal panel live binding

Debug panel JSON binding

Status bar integration

Command history UI

If required, next step can be:

Full UI component code (HTML/CSS/JS) for Terminal + Debug

Or React/Vanilla implementation scaffold matching your current shell

UI component code (HTML/CSS/JS) for Terminal + Debug + self made letterblack shell no thirdparty
UI Components — Terminal + Debug + LetterBlack Shell (Vanilla, No Third-Party)

This is a plug-and-play baseline UI layer aligned with your IDE architecture:

Pure HTML/CSS/JS (no frameworks)

State-driven rendering

Ready to connect to /api/command/* + SSE

Designed for your dark + red LetterBlack identity

1. File Structure (Drop-in)
src/
  index.html
  css/
    base.css
    layout.css
    components.css
  js/
    state/
      commandStore.js
    services/
      api.js
      sse.js
    components/
      terminal.js
      debug.js
      statusbar.js
    app.js
2. HTML — Shell Layout
index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>LetterBlack IDE</title>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
</head>
<body>

<div class="app">

  <!-- Top Bar -->
  <div class="topbar">
    <div class="brand">LETTERBLACK</div>
    <div id="statusBar" class="status">Idle</div>
  </div>

  <!-- Main Grid -->
  <div class="main">

    <!-- Explorer -->
    <div class="panel explorer">
      <div class="panel-title">Explorer</div>
    </div>

    <!-- Editor -->
    <div class="panel editor">
      <div class="panel-title">Editor</div>
    </div>

    <!-- Terminal -->
    <div class="panel terminal">
      <div class="panel-title">Terminal</div>
      <div id="terminalOutput" class="terminal-output"></div>
      <div class="terminal-input">
        <input id="commandInput" placeholder="Run command (e.g. doctor)" />
        <button id="runBtn">Run</button>
      </div>
    </div>

    <!-- Debug -->
    <div class="panel debug">
      <div class="panel-title">Debug</div>
      <div id="debugContent" class="debug-content"></div>
    </div>

  </div>
</div>

<script type="module" src="js/app.js"></script>
</body>
</html>
3. CSS — LetterBlack Theme
base.css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Inter", sans-serif;
}

body {
  background: #0b0b0c;
  color: #e5e5e5;
}
layout.css
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  background: #111;
  border-bottom: 1px solid #222;
}

.brand {
  color: #ff2a2a;
  font-weight: 600;
  letter-spacing: 1px;
}

.main {
  flex: 1;
  display: grid;
  grid-template-columns: 250px 1fr;
  grid-template-rows: 1fr 300px;
  gap: 8px;
  padding: 8px;
}

.panel {
  background: rgba(20,20,22,0.8);
  border: 1px solid #222;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.explorer { grid-row: span 2; }
.editor { }
.terminal { }
.debug { }
components.css
.panel-title {
  padding: 8px;
  font-size: 12px;
  color: #aaa;
  border-bottom: 1px solid #222;
}

/* Terminal */
.terminal-output {
  flex: 1;
  padding: 8px;
  font-family: monospace;
  font-size: 12px;
  overflow-y: auto;
}

.line {
  margin-bottom: 2px;
}

.line.info { color: #bbb; }
.line.error { color: #ff4d4d; }
.line.success { color: #4dff88; }

.terminal-input {
  display: flex;
  border-top: 1px solid #222;
}

.terminal-input input {
  flex: 1;
  padding: 6px;
  background: #111;
  border: none;
  color: #fff;
}

.terminal-input button {
  background: #ff2a2a;
  border: none;
  color: white;
  padding: 6px 12px;
  cursor: pointer;
}

/* Debug */
.debug-content {
  padding: 8px;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
4. State Store
commandStore.js
export const store = {
  commands: {
    byId: {},
    allIds: []
  },
  ui: {
    activeCommandId: null
  }
};

export function createCommand(id, command) {
  store.commands.byId[id] = {
    id,
    command,
    status: "running",
    stdout: [],
    stderr: [],
    result: null,
    error: null
  };
  store.commands.allIds.push(id);
  store.ui.activeCommandId = id;
}

export function appendStdout(id, line) {
  store.commands.byId[id].stdout.push(line);
}

export function appendStderr(id, line) {
  store.commands.byId[id].stderr.push(line);
}

export function setResult(id, result) {
  store.commands.byId[id].result = result;
  store.commands.byId[id].status = "success";
}

export function setError(id, error) {
  store.commands.byId[id].error = error;
  store.commands.byId[id].status = "error";
}
5. API Service
api.js
export async function startCommand(command) {
  const res = await fetch("/api/command/start", {
    method: "POST",
    body: JSON.stringify({ command, args: [] })
  });

  return res.json();
}
6. SSE Service
sse.js
export function connectStream(id, handlers) {
  const es = new EventSource(`/api/command/stream?id=${id}`);

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    handlers.message(data);
  };

  return es;
}
7. Terminal Component
terminal.js
import { store } from "../state/commandStore.js";

export function renderTerminal() {
  const container = document.getElementById("terminalOutput");
  container.innerHTML = "";

  const id = store.ui.activeCommandId;
  if (!id) return;

  const cmd = store.commands.byId[id];

  cmd.stdout.forEach(line => {
    addLine(container, line, "info");
  });

  cmd.stderr.forEach(line => {
    addLine(container, line, "error");
  });

  container.scrollTop = container.scrollHeight;
}

function addLine(container, text, type) {
  const div = document.createElement("div");
  div.className = "line " + type;
  div.textContent = text;
  container.appendChild(div);
}
8. Debug Component
debug.js
import { store } from "../state/commandStore.js";

export function renderDebug() {
  const el = document.getElementById("debugContent");

  const id = store.ui.activeCommandId;
  if (!id) return;

  const cmd = store.commands.byId[id];

  el.textContent = JSON.stringify({
    command: cmd.command,
    status: cmd.status,
    result: cmd.result,
    error: cmd.error
  }, null, 2);
}
9. Status Bar
statusbar.js
import { store } from "../state/commandStore.js";

export function renderStatus() {
  const el = document.getElementById("statusBar");

  const id = store.ui.activeCommandId;
  if (!id) {
    el.textContent = "Idle";
    return;
  }

  const cmd = store.commands.byId[id];
  el.textContent = cmd.status.toUpperCase();
}
10. App Controller
app.js
import { createCommand, appendStdout, appendStderr, setResult } from "./state/commandStore.js";
import { startCommand } from "./services/api.js";
import { connectStream } from "./services/sse.js";

import { renderTerminal } from "./components/terminal.js";
import { renderDebug } from "./components/debug.js";
import { renderStatus } from "./components/statusbar.js";

function renderAll() {
  renderTerminal();
  renderDebug();
  renderStatus();
}

document.getElementById("runBtn").onclick = async () => {
  const input = document.getElementById("commandInput").value;

  const res = await startCommand(input);
  const id = res.id;

  createCommand(id, input);
  renderAll();

  connectStream(id, {
    message: (data) => {
      if (data.type === "stdout") appendStdout(id, data.line);
      if (data.type === "stderr") appendStderr(id, data.line);
      if (data.type === "result") setResult(id, data.result);

      renderAll();
    }
  });
};
11. Result

You now have:

Terminal

Live streaming logs

Error separation

Scroll behavior

Debug Panel

Structured JSON output

Command state visibility

Shell

LetterBlack themed UI

Clean panel system

No third-party dependency

12. Next Logical Upgrade

When ready, extend:

Command history sidebar

Multi-command tabs

Timeline visualization (phase-based)

Explorer → command binding