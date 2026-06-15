// Push-based SSE client registry — tracks active HTTP response objects per command
const clientsByCommand = new Map(); // commandId → Set<res>

export function addSseClient(commandId, res) {
  if (!clientsByCommand.has(commandId)) {
    clientsByCommand.set(commandId, new Set());
  }
  clientsByCommand.get(commandId).add(res);
}

export function removeSseClient(commandId, res) {
  const set = clientsByCommand.get(commandId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clientsByCommand.delete(commandId);
}

export function emitSse(commandId, eventName, payload) {
  const set = clientsByCommand.get(commandId);
  if (!set || set.size === 0) return;
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      set.delete(res);
    }
  }
}
