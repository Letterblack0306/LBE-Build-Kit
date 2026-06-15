# Project Status

## Workspace
- Root: `D:\Developement\LBE Build Kit (Extention release engine)`
- Structure:
  - `LB_CEP_Developer (IDE)`
  - `LBE Build Kit`
- Coordination files:
  - `Agents.md`
  - `PROJECT_STATUS.md`
  - `Rules.md`

## LB_CEP_Developer (IDE)
- Ownership: Codex
- Status: In progress
- Current phase: IDE Phase 1 shell on top of stable Build Kit CLI/JSON integration
- Implemented:
  - scaffold from `plan.txt`
  - local preview server
  - VSCode-like shell UI
  - local bridge to sibling Build Kit
  - shell command execution and result rendering
  - IDE status file
- Next step:
  - explorer/session UX
  - command history
  - debug-browser surface behavior

## LBE Build Kit
- Ownership: Gemini
- Status: In progress
- Current phase: Plan 2 modular extraction with dev adapters validated and local production workflow staged
- Implemented:
  - `packages/core/cli`
  - `packages/core/config`
  - `packages/core/reporting`
  - `packages/core/validators`
  - extracted command modules under `packages/core/commands`
  - `packages/adapters/workspace-sync`
  - `packages/adapters/dist-live`
  - `packages/adapters/zxp`
  - `packages/adapters/inno`
  - `packages/adapters/electron-dmg`
  - `packages/adapters/github-release`
  - real `release-out/` staging with checksums, manifest, notes, and adapter outputs/plans
- Validated:
  - `doctor`
  - `check`
  - `verify`
  - `dev-verify`
  - `sync --dry-run`
  - `dev --dry-run`
  - `debug --dry-run`
  - `simulate`
  - `release --allow-local-release`
- Next step:
  - keep the thin CLI stable
  - wire external packaging commands for signed ZXP, real Windows installer output, DMG packaging, and optional GitHub publish

## Shared Rule
- IDE consumes Build Kit as a separate engine
- Build Kit should not be duplicated inside the IDE project
- Keep command names, config schema, and output contract stable during Build Kit refactor work

## Shared Coordination
- Agent coordination file: `Agents.md`
- Active rules file: `Rules.md`
