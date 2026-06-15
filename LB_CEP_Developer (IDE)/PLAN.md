# LB CEP Developer (IDE) — Execution Plan

## Scope
Upgrade the IDE shell into a stable execution surface for Build Kit, then expand UX.

## Phase 0 — Execution Backbone (DONE)
- Async Build Kit bridge with spawn + SSE streaming.
- Command registry with status, stdout/stderr, result, error.
- `/api/command/start`, `/api/command/stream`, `/api/command/result`.
- Session persistence for recent commands.

## Phase 1 — UI Wiring (IN PROGRESS)
- Terminal panel consumes command stream.
- Debug panel renders structured result + error.
- Status bar reflects active command.
- History list wired to in-memory and persisted session.

## Phase 1.1 — Build Kit Output Contract (NEXT)
- Accept tagged JSON (`__EXT_BUILD_JSON__`) as primary.
- Provide safe fallback for plain JSON output.
- Warn when tagged output is missing (bridge-level).

## Phase 2 — Workspace + Editor (NEXT)
- File explorer bound to project root (Electron only).
- Editor tabs, dirty state, reopen session.
- Quick open + search bindings.

## Phase 3 — IDE Feel (LATER)
- Command palette actions tied to Build Kit.
- Terminal multi-session UX refinement.
- Debug browser panel improvements.

## Current Priority
1) Harden Build Kit result parsing (tagged JSON + fallback).
2) Tighten UI status + history updates after completion.
3) Expand editor + explorer UX (tabs, reopen, search).
