## Active Rules

### Workspace Paths
- Root: `Z:\02_LBE Build Kit (Extention release engine)\`
- Build Kit Path: `Z:\02_LBE Build Kit (Extention release engine)\LBE Build Kit`
- IDE Path: `Z:\02_LBE Build Kit (Extention release engine)\LB_CEP_Developer (IDE)`

### System Ownership
- Unified, solo developer ownership across the entire codebase (both IDE and Build Kit projects).
- Maintain strict modular boundary and clean interfaces between the execution engine and the user interface.

### Project Separation of Concerns
- `LB_CEP_Developer (IDE)` owns the IDE shell, explorer, editor surface, chat, terminal, debug UI, and workflow UX.
- `LBE Build Kit` owns the `ext-build` engine, config loading, validators, reporting, dev adapters, and release adapters.

### Integration Rule
- The IDE calls the Build Kit CLI.
- The Build Kit returns structured results.
- The IDE renders the results.
- Do not duplicate Build Kit logic inside the IDE project.

### Current Active Direction
- Keep the modular extraction and local release workflow behavior frozen.
- Expand and stabilize the IDE companion shell UX, explorer, command execution, and debug-browser surfaces.

### Build Kit Rule
- Keep the modular extraction and local release workflow behavior stable.
- Keep command names, config schema, and the CLI/report output contract stable.

### IDE Rule
- The IDE must use the Build Kit exclusively through CLI/JSON integration.
- The IDE owns the shell UX, not the validator or release logic.

### Current Workspace Shape
```text
root/
  LB_CEP_Developer (IDE)/
  LBE Build Kit/
  Agents.md
  Rules.md
  PROJECT_STATUS.md
```
