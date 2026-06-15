import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBridgeStatus, runBuildKitCommand } from "./build-kit-bridge.mjs";
import { createCommandState, getCommandState, listCommands } from "./command-registry.mjs";
import { addSseClient, removeSseClient } from "./sse-manager.mjs";
import { persistCommand, loadSession } from "./session-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../app/ui");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const { pathname } = url;
  const method = req.method || "GET";

  // ─── GET /api/status ─────────────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/status") {
    sendJson(res, 200, { ok: true, ideRoot: process.cwd(), bridge: getBridgeStatus() });
    return;
  }

  // ─── GET /api/commands — in-memory list ──────────────────────────────────
  if (method === "GET" && pathname === "/api/commands") {
    sendJson(res, 200, { ok: true, commands: listCommands().slice(0, 50) });
    return;
  }

  // ─── GET /api/session — persisted history ────────────────────────────────
  if (method === "GET" && pathname === "/api/session") {
    sendJson(res, 200, { ok: true, session: loadSession() });
    return;
  }

  // ─── POST /api/command/start ──────────────────────────────────────────────
  if (method === "POST" && pathname === "/api/command/start") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      const command = String(body.command || "").trim();
      const args = Array.isArray(body.args) ? body.args : [];

      if (!command) {
        sendJson(res, 400, { ok: false, error: "Missing command" });
        return;
      }

      const state = createCommandState(command, args);

      // Persist after completion (runs in background via emitSse done)
      // We poll for completion by hooking into the sse-manager indirectly
      // via a synthetic SSE client that only persists
      schedulePersistOnDone(state.id);

      runBuildKitCommand(state);
      sendJson(res, 200, { ok: true, id: state.id, status: state.status });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // ─── GET /api/command/result?id=... ──────────────────────────────────────
  if (method === "GET" && pathname === "/api/command/result") {
    const id = url.searchParams.get("id");
    const cmd = id ? getCommandState(id) : null;
    if (!cmd) {
      sendJson(res, 404, { ok: false, error: "Command not found" });
      return;
    }
    sendJson(res, 200, { ok: true, command: cmd });
    return;
  }

  // ─── GET /api/command/stream?id=... — SSE ────────────────────────────────
  if (method === "GET" && pathname === "/api/command/stream") {
    const id = url.searchParams.get("id");
    const cmd = id ? getCommandState(id) : null;

    if (!cmd) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Command not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });

    const write = (event, payload) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    // Replay buffered state for late-joining clients
    write("status", { id: cmd.id, status: cmd.status, phase: cmd.phase });
    for (const entry of cmd.logs) {
      write(entry.type, { id: cmd.id, line: entry.line });
    }

    // If already finished, send terminal events and close
    if (cmd.status === "success" || cmd.status === "error" || cmd.status === "timed_out") {
      if (cmd.result) write("result", { id: cmd.id, result: cmd.result });
      if (cmd.error) {
        write("command-error", { id: cmd.id, error: cmd.error });
      }
      write("done", { id: cmd.id, status: cmd.status });
      res.end();
      return;
    }

    // Subscribe for live events
    addSseClient(id, res);
    req.on("close", () => removeSseClient(id, res));
    return;
  }

  // ─── Static file serving ─────────────────────────────────────────────────
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  serveFile(res, filePath);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LB CEP Developer running at http://127.0.0.1:${port}`);
  console.log(`Build Kit bridge ${fs.existsSync(getBridgeStatus().buildKitCli) ? "ready" : "missing"}`);
});

// Persist command to session when done — uses a synthetic SSE subscriber
function schedulePersistOnDone(id) {
  let checkCount = 0;
  const interval = setInterval(() => {
    const cmd = getCommandState(id);
    checkCount++;
    if (!cmd || cmd.status === "success" || cmd.status === "error" || cmd.status === "timed_out") {
      clearInterval(interval);
      if (cmd) persistCommand(cmd);
    }
    if (checkCount > 600) clearInterval(interval); // 10 min safety cutoff
  }, 1000);
}
