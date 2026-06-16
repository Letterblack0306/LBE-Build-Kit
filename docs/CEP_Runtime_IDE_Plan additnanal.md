# Letterblack CEP Runtime IDE / Inspector Plan

## 1. Purpose

Build a **DEV ONLY CEP Runtime IDE / Inspector** inside the existing Letterblack CEP extension.

This is not a generic IDE. It is a runtime diagnostic console for the live AE CEP panel.

Primary goal:

```text
Use live CEP runtime probes as the source of truth.
Do not trust static repo structure for runtime status.
```

---

## 2. Scope Decision

```text
CEP_SPECIFIC_IDE → YES
GENERIC_IDE      → NOT YET
```

The current available runtime systems are enough for a CEP-focused dev console:

```text
- window.ErrorTelemetry
- TelemetryDashboard
- DebugStatePanel
- BootManager watchpoints
- ModuleRegistry
- StateManager
- StorageUtils
- LaunchSelfTest
- BuildInvariants
- EvalScriptContract
- ExecutionPayloadRunner
- LibraryManager
```

---

## 3. Hard Boundaries

### Must Do

```text
- Build as DEV ONLY tab inside the existing extension.
- Connect only to live AE CEP runtime probes.
- Reuse existing telemetry systems.
- Export evidence as JSON.
- Fail production build if debug/IDE code leaks into production.
```

### Must Not Do

```text
- Do not create a standalone random HTML tool first.
- Do not replace the current extension UI.
- Do not duplicate TelemetryDashboard.
- Do not ship this in production.
- Do not infer runtime status from static source files.
```

---

## 4. UI Layout

```text
Letterblack CEP Runtime IDE

Left:
- Runtime modules
- Buttons / actions
- Events
- Storage
- Execution lanes
- Guards

Center:
- selected module/button/action details
- probe results
- ownership state
- last proof result

Right:
- live logs
- errors
- state trace
- telemetry summary

Bottom:
- command console
- evidence export
```

---

## 5. Required Tabs

## 5.1 Runtime

Show live panel/runtime state.

Required fields:

```text
- CEP connected
- AE host detected
- extension ID
- extension version
- manifest version
- panel build hash
- CEF version
- JSX bridge version
- boot status
- environment: DEV / STAGING / PRODUCTION
- active project/session ID if available
```

Status source:

```text
BootManager
LaunchSelfTest
BuildInvariants
EvalScriptContract
runtime globals
```

---

## 5.2 Modules

Show module state from runtime probes.

Required fields:

```text
- module ID
- display name
- source path
- global object / probe name
- source present
- loaded
- enabled
- init status
- last seen timestamp
- last error
- owner ID if ResourceTracker is used
```

Visual grouping:

```text
Left column:
- LOADED
- ENABLED

Right column:
- SOURCE_PRESENT only
- DISABLED
- ERROR
- UNKNOWN
```

Required source:

```text
ModuleRegistry
BootManager watchpoints
DebugStatePanel
```

---

## 5.3 Buttons / Actions

Show all registered user-facing actions.

Group by behavior lane:

```text
EXECUTION
SAVE
COPY
EDIT
FILE OPEN
FILE EXPORT
PROVIDER
SETTINGS
LIBRARY
```

Required fields:

```text
- action ID
- selector
- owner/module
- behavior lane
- expected behavior
- current enabled/disabled state
- listener attached yes/no
- last click timestamp
- last click proof
- last result/error
```

Required source:

```text
Button/action registry
StateManager
ExecutionPayloadRunner
ErrorTelemetry
```

---

## 5.4 Event Bus Trace

Show runtime event wiring and failures.

Required fields:

```text
- event name
- source module
- listener count
- last fired time
- payload shape
- failed listener
- last error
```

Purpose:

```text
Detect dead buttons, missing listeners, duplicate listeners, and broken runtime wiring.
```

---

## 5.5 Execution Trace

Show one selected action from click to AE boundary.

Required trace path:

```text
selected action
→ dispatcher
→ lock
→ route
→ payload validation
→ EvalScriptContract / CEPExec
→ JSX boundary
→ result/error
```

Required fields:

```text
- trace ID
- action ID
- dispatcher name
- lock state
- route
- payload size
- JSX function
- start time
- end time
- duration
- result type
- error code/message
```

Required source:

```text
ExecutionPayloadRunner
EvalScriptContract
ErrorTelemetry
StateManager
```

---

## 5.6 Telemetry

Reuse existing telemetry UI.

Rule:

```text
Do not rebuild TelemetryDashboard.
Embed or route to existing TelemetryDashboard.
```

Required views:

```text
- recent runtime errors
- warning count
- fatal count
- grouped errors by module
- last telemetry event
- console bridge events
```

Required missing bridge:

```text
console.log / console.warn / console.error
→ ErrorTelemetry bridge
```

---

## 5.7 Storage

Show current extension storage health.

Required fields:

```text
- library count
- active provider
- settings keys
- last write
- last read
- storage namespace
- corrupted/missing key detection
- quota or size estimate if available
```

Required source:

```text
StorageUtils
LibraryManager
StateManager
provider settings
```

Security rule:

```text
Never display API key values.
Only show key presence: PRESENT / MISSING.
```

---

## 5.8 Guards

This tab is required.

Show runtime and build safety gates.

Required fields:

```text
- BuildInvariants status
- EvalScriptContract status
- CEPExec contract status
- payload size guard
- CSP/dev flag status
- production-strip check
- debug global leakage check
- provider/API safety state
```

Purpose:

```text
This is where the IDE proves that dev-only tooling is safe and isolated.
```

---

## 5.9 Evidence Export

Export current runtime proof state.

Required exports:

```text
runtime-status.json
modules.json
buttons.json
events.json
execution-trace.json
errors.json
storage.json
environment.json
guards.json
```

Export format:

```json
{
  "schemaVersion": "1.0.0",
  "exportedAt": 123456789,
  "source": "AE_CEP_RUNTIME",
  "environment": "DEV",
  "status": "OK",
  "items": []
}
```

---

## 6. Runtime Probe Contract

Every probe must return the same structure.

```json
{
  "id": "module.name",
  "label": "Module Name",
  "status": "LOADED",
  "severity": "info",
  "source": "AE_CEP_RUNTIME",
  "lastSeen": 123456789,
  "owner": "module-owner-id",
  "details": {},
  "error": null
}
```

Required statuses:

```text
SOURCE_PRESENT
LOADED
ENABLED
DISABLED
ERROR
UNKNOWN
```

Required severities:

```text
info
warning
error
blocker
```

Rule:

```text
Status and severity must be separate.
A DISABLED module may be intentional and should not always be an error.
```

---

## 7. evalScript / CEPExec Roundtrip Proof

The IDE must show both violations and successful calls.

Required proof fields:

```text
- request ID
- action ID
- JSX function
- payload size
- payload hash
- start time
- end time
- duration
- result type
- result size
- error code
- error message
```

Purpose:

```text
Prove that a button/action reached the AE JSX boundary and returned correctly.
```

---

## 8. Payload Size Guard

Add payload guard visibility.

Required fields:

```text
- raw payload size
- compressed payload size
- base64 size
- CEPExec payload size
- blocked oversized request
- compression proof
```

Important image rule:

```text
Chat/Vision context images should be compressed before API calls.
Never send raw 4K/8K images unless using a dedicated upscaler flow.
```

---

## 9. Provider / API Status

Required provider fields:

```text
- provider configured
- API key present: yes/no only
- active model
- fallback model
- selected capability
- last request time
- last failure
- rate-limit state
- smart model selection state
```

Rule:

```text
Never expose secret values.
Never show fake provider status.
```

---

## 10. Resource Ownership Tracking

Track cleanup and leaks.

Required fields:

```text
- ResourceTracker owner
- active timers
- active listeners
- active intervals
- unreleased handles
- destroyed/disposed status
- cleanup error
```

Purpose:

```text
Detect duplicate listeners, stuck timers, and leaked runtime state.
```

---

## 11. Production Strip Rules

Production build must fail if any dev-only runtime IDE code leaks.

Fail production build if any of these are present:

```text
- Runtime IDE tab markup
- Runtime IDE CSS
- proof APIs
- debug export APIs
- window.__DEV_* globals
- telemetry export endpoint
- debug-only command console
- development-only probe registry
```

Suggested validator:

```text
scripts/validate-no-dev-runtime-ide-in-prod.mjs
```

Required checks:

```text
- scan manifest
- scan HTML
- scan JS bundle
- scan CSS
- scan global names
- scan route registry
```

---

## 12. Implementation Phases

## Phase 1 — Probe Foundation

Build probe contracts only.

Deliverables:

```text
RuntimeProbeContract
ModuleProbeRegistry
ActionProbeRegistry
EventProbeRegistry
EvidenceExport schema
```

Do not build full UI yet.

Success check:

```text
window.LBDevRuntimeInspector.collectAll()
→ returns structured JSON from live runtime
```

---

## Phase 2 — DEV ONLY IDE Tab

Add the UI tab inside the extension.

Deliverables:

```text
Runtime tab
Modules tab
Buttons tab
Execution Trace tab
Storage tab
Guards tab
Evidence Export tab
```

Success check:

```text
DEV build shows Runtime IDE tab.
PRODUCTION build does not show Runtime IDE tab.
```

---

## Phase 3 — Execution Proof

Wire button/action proof.

Deliverables:

```text
button click proof
single-lane execution trace
EvalScriptContract roundtrip proof
payload size proof
result/error proof
```

Success check:

```text
Click any registered action
→ trace appears from selector to AE boundary
```

---

## Phase 4 — Telemetry Bridge

Connect browser console to ErrorTelemetry.

Deliverables:

```text
console error bridge
unhandledrejection bridge
runtime warning bridge
TelemetryDashboard embed/reuse
```

Success check:

```text
Thrown UI error appears in ErrorTelemetry and Runtime IDE Telemetry tab.
```

---

## Phase 5 — Production Gate

Add hard production validator.

Deliverables:

```text
validate-no-dev-runtime-ide-in-prod.mjs
build script integration
CI gate
production fail-closed rule
```

Success check:

```text
Inject any Runtime IDE marker into production bundle
→ build fails
```

---

## 13. Agent Instruction

Use this instruction for implementation agents.

```text
TASK:
Plan and implement a DEV ONLY CEP Runtime IDE using existing CEP runtime systems.

Do not create a generic IDE.
Do not replace the current extension UI.
Do not ship this in production.
Do not duplicate TelemetryDashboard.

All status must come from live AE CEP runtime probes.
Static repo data is not runtime truth.

Use existing systems:
- ErrorTelemetry
- TelemetryDashboard
- DebugStatePanel
- BootManager
- ModuleRegistry
- StateManager
- StorageUtils
- LaunchSelfTest
- BuildInvariants
- EvalScriptContract
- ExecutionPayloadRunner
- LibraryManager

Required tabs:
1. Runtime
2. Modules
3. Buttons
4. Event Bus Trace
5. Execution Trace
6. Telemetry
7. Storage
8. Guards
9. Evidence Export

Required probe contract:
Every probe must return id, label, status, severity, source, lastSeen, owner, details, and error.

Production rule:
Fail production build if Runtime IDE tab, proof APIs, debug globals, telemetry export endpoints, or debug CSS are included.
```

---

## 14. Final Verdict

```text
Your current list is enough to start.
The missing critical layer was:

- formal runtime probe contract
- event bus tracing
- resource ownership tracking
- evalScript roundtrip proof
- payload guard visibility
- production strip validator
- Guards tab
```

Recommended next build target:

```text
Phase 1 — Probe Foundation
```
