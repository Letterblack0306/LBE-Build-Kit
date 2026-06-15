// SSE client — wraps EventSource for typed command stream events
export function openCommandStream(id, handlers = {}) {
  const source = new EventSource(`/api/command/stream?id=${encodeURIComponent(id)}`);

  if (handlers.onStatus) {
    source.addEventListener("status", (e) => handlers.onStatus(JSON.parse(e.data)));
  }
  if (handlers.onStdout) {
    source.addEventListener("stdout", (e) => handlers.onStdout(JSON.parse(e.data)));
  }
  if (handlers.onStderr) {
    source.addEventListener("stderr", (e) => handlers.onStderr(JSON.parse(e.data)));
  }
  if (handlers.onResult) {
    source.addEventListener("result", (e) => handlers.onResult(JSON.parse(e.data)));
  }
  if (handlers.onCommandError) {
    source.addEventListener("command-error", (e) => handlers.onCommandError(JSON.parse(e.data)));
  }

  source.addEventListener("done", (e) => {
    source.close();
    if (handlers.onDone) handlers.onDone(JSON.parse(e.data));
  });

  source.onerror = () => {
    source.close();
    if (handlers.onError) handlers.onError(new Error("SSE connection failed"));
  };

  return source;
}
