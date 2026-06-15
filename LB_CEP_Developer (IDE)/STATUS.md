# LB CEP Developer Status

Current phase:
- Phase 1 shell with local Build Kit bridge

Implemented:
- VSCode-like shell preview under `app/ui`
- local dev server under `scripts/dev-server.mjs`
- controlled IDE-to-Build-Kit bridge under `scripts/build-kit-bridge.mjs`
- module boundaries for `core`, `adapters`, and `browser`

Current behavior:
- UI buttons call the sibling `LBE Build Kit` through a local API
- bridge is allowlisted to stable commands only
- command results render into the terminal/log area

Next IDE step:
- add file-tree data from the active workspace
- add command history/session state
- add dedicated debug-browser panel behavior
