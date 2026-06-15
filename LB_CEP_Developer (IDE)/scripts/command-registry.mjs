import { randomUUID } from "node:crypto";

// Pure data store — no EventEmitters. SSE delivery is handled by sse-manager.
const commandMap = new Map(); // id → state
const FINAL_STATUSES = new Set(["success", "error", "timed_out"]);

function makeId() {
  return `cmd_${Date.now()}_${randomUUID().slice(0, 6)}`;
}

export function createCommandState(command, args = []) {
  const id = makeId();
  const state = {
    id,
    command,
    args,
    status: "queued",
    phase: "init",
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    stdout: [],
    stderr: [],
    logs: [],   // { type, time, line }
    result: null,
    error: null,
    reportPath: null,
  };
  commandMap.set(id, state);
  return state;
}

export function getCommandState(id) {
  return commandMap.get(id) ?? null;
}

export function updateCommand(id, patch) {
  const cmd = commandMap.get(id);
  if (!cmd) return;
  if (FINAL_STATUSES.has(cmd.status)) {
    // Allow attaching final artifacts once, but block status regressions.
    const nextStatus = patch?.status;
    if (nextStatus && nextStatus !== cmd.status) return;
  }
  Object.assign(cmd, patch);
}

export function pushStdout(id, line) {
  const cmd = commandMap.get(id);
  if (!cmd) return;
  const entry = { type: "stdout", time: new Date().toISOString(), line };
  cmd.stdout.push(line);
  cmd.logs.push(entry);
}

export function pushStderr(id, line) {
  const cmd = commandMap.get(id);
  if (!cmd) return;
  const entry = { type: "stderr", time: new Date().toISOString(), line };
  cmd.stderr.push(line);
  cmd.logs.push(entry);
}

export function listCommands() {
  return [...commandMap.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  );
}
