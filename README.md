# LetterBlack CEP Developer Workspace

This repository houses a unified, production-ready environment for developing, testing, validating, and packaging Adobe CEP (Common Extensibility Platform) extensions. Operating under a single, solo-developer workflow boundary, the workspace integrates a CLI-driven build engine with a custom native Electron desktop IDE.

---

## Workspace Subsystems

The workspace consists of two tightly integrated subsystems:

### 1. `LBE Build Kit` (Release Compilation Engine)
A modular, CLI-based framework for local extension compilation, verification, and package distribution.
* **Core Capabilities:** Validation of version syncs across files, manifest integrity verification, ES3 compatibility analysis for JSX scripts, preflight cleanup, and multi-platform packaging (ZXP, Windows EXE, macOS DMG).
* **Technical Stack:** Node.js (ESM), dry-run validators, and platform release adapters.

### 2. `LB_CEP_Developer (IDE)` (Desktop Developer Shell)
An Electron-wrapped developer environment providing a graphical web shell, interactive terminals, and a secure gateway for autonomous AI coding agents.
* **Core Capabilities:** Real-time terminal output streaming (Server-Sent Events), workspace exploration, code editing, transaction-safe file writing, and a smart **Model Selection Governance Layer** (IIFE/global) with session-locking and multi-provider fallbacks (OpenAI, Anthropic, Gemini, Ollama).
* **Technical Stack:** Electron, Node.js background bridge, HTML/CSS/JS web UI, and OpenClaw agent orchestrator.

---

## Architectural Fixes & Crash Resolvents

A deep deterministic audit of the workspace revealed and successfully eliminated several critical runtime crashes and state machine race conditions:

### 1. Native Folder Dialogue Crash (`ReferenceError` - Fixed)
* **Symptom:** Clicking the **"Open Project Folder"** button in the desktop IDE failed to trigger the directory selection dialogue.
* **Root Cause:** The IPC handler in `electron/main.mjs` referenced an out-of-scope variable (`win`) instead of the correct global window instance (`mainWindow`), throwing an unhandled `ReferenceError` in the Electron main process.
* **Resolution:** Replaced the out-of-scope reference with `mainWindow`. Folder opening is now fully operational in desktop mode.

### 2. Agent CustomEvent Payload Signature Crash (`TypeError` - Fixed)
* **Symptom:** Sub-agents executing build tools threw an immediate `TypeError: Cannot read properties of undefined (reading 'postMessage')` and stalled.
* **Root Cause:** OpenClaw's `toolDispatcher.js` dispatched the `"run-authorized-command"` event with a raw command string (`detail: input.command`), but the listener in `app.js` expected a destructured object containing `command` and a `MessagePort` (`const { command, port } = e.detail`).
* **Resolution:** Aligned the emitter payload signature to construct and dispatch a proper `{ command, port }` object using a `MessageChannel` port wrapper.

### 3. Programmatic CLI Command Resolution (Fixed)
* **Symptom:** AI coding assistants calling build operations received an instant resolution of `undefined` while the background compilation process was still spawning.
* **Root Cause:** `_runCommandInternal` was designed for fire-and-forget UI updates. It returned instantly after establishing the SSE connection instead of returning a Promise that settles when the build process terminates.
* **Resolution:** Promisified `_runCommandInternal` in `app.js` to return a standard JS Promise. It now resolves with the true parsed JSON compilation output on process completion, or rejects on error, enabling programmatic callers to properly `await` execution results.

### 4. Late Event State Corruption (Watchdog Race Condition - Fixed)
* **Symptom:** A command that timed out in the UI (marked with a red dot) would suddenly change to a green success state and emit duplicate notifications when delayed Server-Sent Events arrived late.
* **Root Cause:** When the client watchdog fired, it wrote a `timed_out` state but failed to set `streamFinalized = true` or close the `EventSource` connection, allowing late network packets to bypass the event guards.
* **Resolution:** Updated the watchdog handler to immediately mark `streamFinalized = true` and call `source.close()` to cleanly terminate the SSE subscription upon timeout, locking the command state from further mutations.

---

## Directory Organization

```text
root/
├── docs/                             # Relocated workspace planning, rules, and research
│   ├── Agents.md                     # Agent-to-UI coordination mapping
│   ├── Rules.md                      # Unified, solo-developer workspace paths and boundaries
│   ├── SYSTEM_CONTRACT.md            # Execution boundaries, risk lanes, and safety contracts
│   ├── PROJECT_STATUS.md             # Milestone tracking and development history
│   ├── Research.md                   # Engineering, performance, and optimization research
│   └── CEP_Runtime_IDE_Plan...       # Planning documents and requirements
│
├── LBE Build Kit/                    # Release Compilation Engine
│   ├── packages/                     # Core validators, adapters, config loaders
│   └── ext-build.mjs                 # CLI entry point script
│
├── LB_CEP_Developer (IDE)/           # Desktop Electron Wrapper and Web Shell UI
│   ├── app/ui/                       # Frontend web shell scripts and styling
│   │   ├── modelSelectionGovernance/ # Smart model selection, fallback registries, and audit logs
│   │   ├── openclaw/                 # OpenClaw agent orchestrator core and runners
│   │   └── app.js                    # UI orchestration, terminals, resizers, and hotkey bindings
│   │
│   ├── electron/                     # Electron main process and preload definitions
│   └── scripts/                      # Developer HTTP servers, background bridges, and IPC managers
│
└── README.md                         # Main workspace documentation (This file)
```

---

## Getting Started

### 1. Launch the Background Dev Server
Boot up the HTTP local development server in the IDE directory:
```bash
cd "LB_CEP_Developer (IDE)"
npm install
npm run dev
```

### 2. Launch the Electron Desktop Wrapper
In a new terminal pane, launch the native desktop window wrapper:
```bash
cd "LB_CEP_Developer (IDE)"
npm run electron
```
Both processes will boot and sync with the release engine automatically. Enjoy your fully robust, crash-free local extension IDE!
