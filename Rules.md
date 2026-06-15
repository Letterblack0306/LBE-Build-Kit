## Active Rules

### Territory
- Gemini owns: `D:\Developement\LBE Build Kit (Extention release engine)\LBE Build Kit`
- Codex owns: `D:\Developement\LBE Build Kit (Extention release engine)\LB_CEP_Developer (IDE)`

### Coordination
- Update shared coordination in `D:\Developement\LBE Build Kit (Extention release engine)\Agents.md`
- Keep project-specific implementation inside the correct territory
- Use the root workspace as a shared coordination layer only

### Ownership Split
- `LB_CEP_Developer (IDE)` owns the IDE shell, explorer, editor surface, chat, terminal, debug UI, and workflow UX
- `LBE Build Kit` owns the `ext-build` engine, config loading, validators, reporting, dev adapters, and release adapters

### Integration Rule
- IDE calls Build Kit
- Build Kit returns structured results
- IDE renders the results
- Do not duplicate Build Kit logic inside the IDE project

### Current Active Direction
- Build Kit side first: keep Plan 2 behavior frozen while using extracted `packages/core`, validated dev adapters, and the staged local release workflow
- IDE side after stabilization: continue shell/product work, explorer/session UX, debug-browser UX, and Build Kit integration

### Build Kit Rule
- Keep the modular extraction and local release workflow behavior frozen
- Keep command names stable
- Keep config schema stable
- Keep CLI/report output contract stable

### IDE Rule
- IDE must use Build Kit through CLI/JSON integration
- IDE owns shell UX, not validator or release logic

### Current Workspace Shape
```text
root/
  LB_CEP_Developer (IDE)/
  LBE Build Kit/
  Agents.md
  Rules.md
  PROJECT_STATUS.md
```
