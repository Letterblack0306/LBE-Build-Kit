Next Step Package: Command State Manager + Async Bridge

This is the correct next implementation block. It upgrades the IDE from a static shell into an actual execution surface, while keeping the Build Kit contract intact. The separation rule remains unchanged: the IDE manages UX state, the Build Kit remains the engine.

1. Target Outcome

Move from this:

Button click
→ spawnSync
→ wait
→ full JSON result
→ render

To this:

Button click
→ async command launch
→ running state created
→ live stdout/stderr streamed
→ final JSON parsed
→ state finalized
→ UI panels updated

This fits the current IDE direction and the pending debug-browser / session UX work already identified in your project files.

2. Architecture Update
Existing
IDE UI
  → /api/command
    → build-kit-bridge.mjs
      → spawnSync(ext-build.mjs)
Updated
IDE UI
  → /api/command/start
    → build-kit-bridge.mjs
      → spawn(ext-build.mjs)

IDE UI
  → /api/command/stream?id=...
    → SSE / long-poll stream for logs + status

IDE UI
  → /api/command/result?id=...
    → final normalized payload
3. Command State Manager Design

The IDE needs an in-memory execution registry.

Core State Shape
{
  "id": "cmd_20260320_001",
  "command": "doctor",
  "args": [],
  "status": "queued",
  "phase": "init",
  "startedAt": "2026-03-20T10:00:00.000Z",
  "endedAt": null,
  "exitCode": null,
  "stdout": [],
  "stderr": [],
  "logs": [],
  "result": null,
  "error": null,
  "reportPath": null
}
Recommended Fields
Field	Purpose
id	unique command instance ID
command	Build Kit command name
args	command arguments
status	queued / running / success / error / killed
phase	UI-friendly lifecycle stage
startedAt / endedAt	timing + history
stdout / stderr	raw process lines
logs	normalized event stream
result	parsed final JSON
error	normalized error object
reportPath	path to .build-report artifact if returned
4. State Lifecycle
Status Flow
queued
→ starting
→ running
→ parsing-result
→ success | error
Phase Flow
init
→ process-spawned
→ streaming-output
→ awaiting-exit
→ parsing-json
→ completed

This gives the Debug panel a deterministic timeline even before the Build Kit exposes deeper step-level events.

5. API Contract for IDE Server
A. Start Command
POST /api/command/start

Request:

{
  "command": "doctor",
  "args": []
}

Response:

{
  "ok": true,
  "id": "cmd_20260320_001",
  "status": "starting"
}
B. Stream Command Events
GET /api/command/stream?id=cmd_20260320_001

Use SSE. Events:

event: status
data: {"status":"running","phase":"process-spawned"}

event: stdout
data: {"line":"[info] Running doctor..."}

event: stderr
data: {"line":"[warn] Missing optional tool..."}

event: result
data: {"status":"success"}

event: done
data: {"id":"cmd_20260320_001"}
C. Read Final Result
GET /api/command/result?id=cmd_20260320_001

Response:

{
  "id": "cmd_20260320_001",
  "status": "success",
  "exitCode": 0,
  "result": {},
  "error": null,
  "reportPath": ".build-report/doctor.json"
}
D. Optional History Endpoint
GET /api/commands

Returns recent command sessions for Terminal / Debug history.

6. Bridge Implementation Strategy
Replace spawnSync with spawn

In scripts/build-kit-bridge.mjs, use async child process execution.

Responsibilities of bridge

launch child process

assign command ID

append stdout/stderr line-by-line

detect exit code

parse final JSON safely

normalize errors

expose state to server endpoints

7. Parsing Strategy

Build Kit outputs structured JSON, but stdout may also contain logs. Since schema stability is important, the bridge should parse defensively.

Recommended rule

Treat the last valid JSON block as the final result.

Safer option

Have Build Kit emit one explicit tagged line:

__EXT_BUILD_JSON__{"success":true,...}

Then the bridge extracts only that line for final parsing.

This avoids corruption from mixed logs.

8. Normalized Error Model

Use one IDE-facing error structure regardless of source.

{
  "code": "PROCESS_EXIT_NONZERO",
  "message": "Build Kit command failed",
  "details": "exit code 1",
  "stage": "bridge",
  "raw": null
}

Adapter/build errors can also map into this shape:

{
  "code": "ZXP_SIGN_FAILED",
  "message": "ZXP signing failed",
  "details": "Certificate not found",
  "stage": "adapter:zxp",
  "raw": {}
}
Minimum stages

bridge

cli

core

adapter:zxp

adapter:inno

adapter:dmg

config

reporting

9. Frontend UI Mapping
Explorer

No change yet.

Terminal Panel

Render:

live stdout

stderr

command input history

timestamps

Debug Panel

Render:

command metadata

current status

lifecycle phase

parsed JSON result

normalized error

raw .build-report path

Status Bar

Show:

idle / running / success / failed

active command count

Session Store

Track:

active command ID

recent commands

selected debug session

10. Recommended Frontend Store Shape
{
  commands: {
    byId: {},
    allIds: []
  },
  activeCommandId: null,
  terminal: {
    lines: [],
    history: []
  },
  debug: {
    selectedCommandId: null
  }
}
11. Session Persistence

Phase 1 can be in-memory only.

Phase 2 should persist lightweight session metadata to a local file:

LB_CEP_Developer (IDE)/.ide-session/session.json

Persist:

recent commands

panel state

selected command

last known result summaries

Do not persist full raw stdout forever unless needed.

12. Suggested File Additions

Inside LB_CEP_Developer (IDE):

scripts/
  build-kit-bridge.mjs
  command-registry.mjs
  command-events.mjs

src/js/
  state/
    commandStore.js
  services/
    commandApi.js
    sseClient.js
  panels/
    terminalPanel.js
    debugPanel.js
13. Minimal Backend Pseudocode
// command-registry.mjs
const commands = new Map();

export function createCommandState(command, args) {
  const id = makeId();
  const state = {
    id,
    command,
    args,
    status: 'queued',
    phase: 'init',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    stdout: [],
    stderr: [],
    logs: [],
    result: null,
    error: null,
    reportPath: null
  };
  commands.set(id, state);
  return state;
}

export function getCommandState(id) {
  return commands.get(id);
}
// build-kit-bridge.mjs
import { spawn } from 'node:child_process';

export function runBuildKitCommand(state, onEvent) {
  state.status = 'running';
  state.phase = 'process-spawned';
  onEvent('status', { status: state.status, phase: state.phase });

  const child = spawn('node', ['ext-build.mjs', state.command, ...state.args], {
    cwd: BUILD_KIT_PATH
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      state.stdout.push(line);
      onEvent('stdout', { line });
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      state.stderr.push(line);
      onEvent('stderr', { line });
    }
  });

  child.on('close', (code) => {
    state.exitCode = code;
    state.endedAt = new Date().toISOString();
    state.phase = 'parsing-json';
    onEvent('status', { status: state.status, phase: state.phase });

    // parse final JSON here
    // set success/error
    // emit result + done
  });
}
14. Build Kit Compatibility Recommendation

To keep the IDE simple, the Build Kit should standardize final JSON like:

{
  "success": true,
  "command": "doctor",
  "reportPath": ".build-report/doctor.json",
  "summary": {
    "checksPassed": 8,
    "checksFailed": 0
  },
  "details": {}
}

That aligns with the current structured-report direction already defined for the Build Kit.

15. Implementation Order
Step 1

Create command-registry.mjs

in-memory store

create/get/update helpers

Step 2

Refactor bridge to async spawn

no frontend change yet

verify one command runs end-to-end

Step 3

Add /api/command/start

returns command ID immediately

Step 4

Add SSE /api/command/stream

stream stdout/stderr/status

Step 5

Add /api/command/result

final normalized result

Step 6

Connect Terminal panel

live log rendering

Step 7

Connect Debug panel

metadata + parsed JSON + errors

Step 8

Add recent command history

session UX foundation

16. Key Guardrails

Maintain these rules exactly:

IDE does not reimplement Build Kit logic

IDE only launches commands and renders returned structure

Build Kit command names and result schema remain stable

Debug/terminal state belongs to IDE only

This is already your defined contract and should remain locked.

17. Best Immediate Deliverable

The most effective next concrete task is:

Implement async bridge + in-memory command registry first

That unlocks:

terminal streaming

debug panel

command history

future OpenClaw compatibility

Without that, the IDE remains a static wrapper.