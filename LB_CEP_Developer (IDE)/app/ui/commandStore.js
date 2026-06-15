// Single source of truth for all UI state.
// Panels read from this store — never directly from the API.
export const store = {
  commands: {
    byId: {},
    allIds: [],
  },
  ui: {
    activeCommandId: null,
    selectedCommandId: null,
  },
  debugCatcher: {
    items: [], // { id, source, message, time, details }
    filter: "all",
  },
};

export function createCommand(id, command) {
  store.commands.byId[id] = {
    id,
    command,
    status: "starting",
    phase: "init",
    stdout: [],
    stderr: [],
    logs: [],  // { type, line, time }
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  store.commands.allIds.push(id);
  store.ui.activeCommandId = id;
  store.ui.selectedCommandId = id;
}

export function appendStdout(id, line) {
  const cmd = store.commands.byId[id];
  if (!cmd) return;
  cmd.stdout.push(line);
  cmd.logs.push({ type: "stdout", line, time: Date.now() });
}

export function appendStderr(id, line) {
  const cmd = store.commands.byId[id];
  if (!cmd) return;
  cmd.stderr.push(line);
  cmd.logs.push({ type: "stderr", line, time: Date.now() });
}

export function updateStatus(id, payload) {
  const cmd = store.commands.byId[id];
  if (!cmd) return;
  if (cmd.status === "success" || cmd.status === "error" || cmd.status === "timed_out") return;
  Object.assign(cmd, payload);
}

export function setResult(id, result) {
  const cmd = store.commands.byId[id];
  if (!cmd) return;
  cmd.result = result;
  cmd.status = "success";
  cmd.endedAt = new Date().toISOString();
}

export function setError(id, error) {
  const cmd = store.commands.byId[id];
  if (!cmd) return;
  cmd.error = error;
  cmd.status = error?.code === "COMMAND_TIMEOUT" ? "timed_out" : "error";
  cmd.endedAt = new Date().toISOString();
}

export function finalizeCommand(id, status) {
  const cmd = store.commands.byId[id];
  if (cmd && cmd.status !== "success" && cmd.status !== "error" && cmd.status !== "timed_out") {
    cmd.status = status ?? "success";
    cmd.endedAt = new Date().toISOString();
  }
}

export function selectCommand(id) {
  store.ui.selectedCommandId = id;
}

export function addDebugCatcherItem(item) {
  store.debugCatcher.items.unshift(item);
  if (store.debugCatcher.items.length > 200) {
    store.debugCatcher.items = store.debugCatcher.items.slice(0, 200);
  }
}

export function setDebugCatcherFilter(filter) {
  store.debugCatcher.filter = filter;
}
