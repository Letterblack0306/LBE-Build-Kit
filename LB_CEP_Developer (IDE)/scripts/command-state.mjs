import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// commandId → { state, emitter }
const store = new Map();

export function createCommand(commandName) {
  const commandId = randomUUID();
  const state = {
    commandId,
    command: commandName,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    logs: [],
    result: null,
  };
  const emitter = new EventEmitter();
  store.set(commandId, { state, emitter });
  return commandId;
}

export function getCommandState(commandId) {
  return store.get(commandId)?.state ?? null;
}

export function getCommandEmitter(commandId) {
  return store.get(commandId)?.emitter ?? null;
}

export function appendLog(commandId, line) {
  const entry = store.get(commandId);
  if (!entry) return;
  entry.state.logs.push(line);
  entry.emitter.emit("log", line);
}

export function completeCommand(commandId, result) {
  const entry = store.get(commandId);
  if (!entry) return;
  entry.state.status = result.ok ? "success" : "error";
  entry.state.result = result;
  entry.state.completedAt = new Date().toISOString();
  entry.emitter.emit("complete", entry.state);
}

export function failCommand(commandId, message) {
  completeCommand(commandId, { ok: false, message });
}
