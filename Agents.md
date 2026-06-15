UI + Mapping Blueprint (IDE → Command System)

This defines how your IDE panels, state, and APIs connect to the async command system. It stays aligned with the rule: IDE = UX, Build Kit = execution.

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