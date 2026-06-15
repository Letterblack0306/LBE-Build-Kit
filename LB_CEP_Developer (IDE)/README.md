# LB CEP Developer (IDE)

Project workspace for the CEP IDE.

## Current scope

- VSCode-like shell preview
- CEP runtime/build/debug module boundaries
- local preview server with no external dependencies
- local bridge to the sibling `LBE Build Kit` project
- **Atomic AI Write Transaction Layer** with audit logging and recovery

## Atomic Transaction System

The IDE implements a robust file-write system for AI-suggested changes:

- **Atomic Batches**: Multiple files are validated, staged, and committed as a single transaction.
- **Audit Logging**: All actions are logged to `.letterblack/audit/audit-log.ndjson` using a strict event schema (`txn.intent`, `txn.commit_completed`, etc.).
- **Automatic Backups**: Existing files are snapshotted to `.letterblack/transactions/<txn_id>/backup/` before being overwritten.
- **Atomic Rollback**: If a commit fails halfway through, earlier writes in the batch are automatically reverted.
- **Timeline Projection**: Audit events are dynamically merged into the UI's history panel.
- **Crash Recovery**: Interrupted transactions (e.g., app crash during staging) are detected and marked on project load.

## Intelligent Execution Layer

The IDE features an advanced AI interaction layer designed for surgical precision and cross-session learning:

- **Surgical Patch System**: The AI can modify specific functions or line ranges (using `// PATCH` and `// TARGET` blocks) instead of rewriting entire files. This reduces risk and ensures minimal diffs.
- **Adaptive Behavior Layer**: A real-time feedback loop translates session events (like blocked paths or failed commits) into immediate AI constraints, preventing the AI from repeating the same mistake twice in a session.
- **Long-Term Intelligence**: On project load, the IDE analyzes historical audit logs to identify recurring patterns and provides "Expert Guidance" to the AI regarding problematic files or frequent environment errors.
- **Context Awareness**: Automatically injects project metadata from `manifest.xml` and `package.json` into the AI system prompt to ensure environment-appropriate code generation.

## Quick start

```bash
npm run dev
```

Then open `http://127.0.0.1:4173`.

The preview server exposes:

- `GET /api/status`
- `POST /api/command`
- `GET /api/commands` (command history)
- `GET /api/session` (persisted state)

## Folder structure

- `app/ui`: Shell UI (Vanilla JS/CSS)
- `electron/main.mjs`: Native process handling and Transaction Manager
- `electron/preload.mjs`: Secure IPC bridge
- `scripts/dev-server.mjs`: Local API gateway and SSE manager
- `scripts/build-kit-bridge.mjs`: Bridge to the sibling `LBE Build Kit` CLI
- `core/build`: Build-engine integration
- `core/runtime`: Sync/install/reload orchestration
- `core/debug`: CEP debug browser flow
- `adapters/cep` & `adapters/ae`: Host-specific bridges
- `browser/cef-debug`: Internal debug-browser surface

This folder is intentionally separate from the standalone build framework in the sibling `LBE Build Kit` project.
