# SYSTEM CONTRACT

> This document is the authoritative reference for how these two systems interact.
> Any agent reading this file must treat it as the source of truth — not the code, not memory, not prior conversation.

---

## 1. System Roles

| System | Role | Must NOT |
|--------|------|----------|
| **LBE Build Kit** | Execution, validation, packaging of CEP extensions | Contain UI, orchestration logic, or runtime extension control |
| **LB_CEP_Developer (IDE)** | UI, visualization, user interaction, Build Kit orchestration | Re-implement Build Kit logic, control CEP extensions at runtime |

**Separation is absolute.** These systems are decoupled by design. The IDE calls the Build Kit. The Build Kit never calls the IDE.

---

## 2. Output Contract

### Format

```
__EXT_BUILD_JSON__{ ...valid JSON... }
```

### Rules

| Rule | Detail |
|------|--------|
| Emitter | Build Kit (`packages/core/reporting/index.mjs` → `printResult`) |
| Trigger | Only emitted when `--json` flag is passed |
| Consumers | IDE bridge (`scripts/build-kit-bridge.mjs`) |
| Validation | Bridge rejects ALL output that does not start with `__EXT_BUILD_JSON__` |
| Tag position | Always the last line of stdout |
| Mixing | Raw log lines (stdout/stderr) are allowed before the tag — tag must be isolated on its own line |
| Missing tag | Hard fail → error surfaced in debug panel — no fallback, no silent parsing |
| Invalid JSON after tag | Hard fail → error surfaced in debug panel |
| Partial output | Hard fail |

**Tagged JSON is the ONLY machine-readable communication between Build Kit and IDE.
Any change to this format will break the system.**

---

## 3. Command Lifecycle

```
User triggers command in IDE
  → POST /api/command/start
  → bridge spawns: node ext-build.mjs <cmd> --json
  → stdout lines streamed via SSE → terminal panel (raw logs)
  → stderr lines streamed via SSE → terminal panel (errors)
  → process exits
  → bridge searches stdout for __EXT_BUILD_JSON__ line
  → if found: parse JSON → store result → SSE "result" event → debug panel renders
  → if not found: hard fail → SSE "error" event → debug panel shows error
```

---

## 4. Failure Rules

| Condition | Behavior |
|-----------|----------|
| `__EXT_BUILD_JSON__` tag missing | Hard fail — command marked as error with code `MISSING_TAGGED_JSON` |
| JSON after tag is invalid | Hard fail — command marked as error with code `MISSING_TAGGED_JSON` |
| Process exits with non-zero code | Hard fail — command marked as error with code `PROCESS_EXIT_NONZERO` |
| Process fails to spawn | Hard fail — command marked as error with code `PROCESS_SPAWN_FAILED` |
| Unsupported command | Hard fail — command marked as error with code `UNSUPPORTED_COMMAND` |

**No fallback parsing. No silent recovery. All failures surface in the debug panel.**

---

## 5. IDE UX Rule

**All interfaces must follow INTUITIVE design. No feature should require user guesswork.**

- Every action must be visible, clearly labeled, and logically placed
- Every state must show what is happening and what comes next
- Every flow must guide the user step-by-step and eliminate ambiguity
- No hidden actions, unclear buttons, or missing feedback

---

## 6. Human Reference Dependency

All feature implementations must follow this protocol:

1. **Check for reference** — Is there an existing completed project, reference file, or prior implementation?
2. **Align with reference** — If yes, match behavior exactly unless explicitly told to improve
3. **Only extend when requested** — Do not add behavior beyond what was asked

Allowed: performance improvement, UI clarity, bug fixes
Not allowed: changing behavior, changing flow, adding automation layers

---

## 7. Product Scope

This system is responsible ONLY for:
- **Building** CEP extensions
- **Validating** CEP extensions
- **Packaging** CEP extensions

Do NOT add:
- Runtime execution layers
- Extension control systems
- Automation/agent-driven CEP operation at runtime

Generated extensions are **user-owned artifacts**. This system does not enforce how they are used.

---

## 8. Known Limitations

| Area | Status |
|------|--------|
| Editor | Not implemented — `editorStore.js` is store-only, no text rendering |
| Core modules (`core/build`, `core/runtime`, `core/debug`) | Metadata-only exports, no logic |
| Adapters (`adapters/cep`, `adapters/ae`) | Metadata-only exports, not instantiated |
| OpenClaw orchestration | Framework present, not wired to chat/command execution |
| External tools (ZXP signer, ISCC.exe, DMG) | Adapter config slots exist, paths must be set manually by user |
| GitHub Release adapter | Requires `gh` CLI in PATH or explicit `command` in config |

---

## 9. Do Not Modify

| Item | Reason |
|------|--------|
| Architecture separation | IDE and Build Kit are intentionally decoupled |
| `__EXT_BUILD_JSON__` format | Any change breaks the bridge parser |
| Atomic transaction system (`electron/main.mjs`) | Production-grade, do not touch without explicit instruction |
| Contract format (`contracts/operation-contract.json`) | Agent enforcement rules — must not change without sign-off |
| Command allowlist in bridge | Only stable, validated commands are exposed to the IDE |
