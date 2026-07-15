import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getBridgeStatus, runBuildKitCommand } from "./build-kit-bridge.mjs";
import { createCommandState, getCommandState, listCommands } from "./command-registry.mjs";
import { addSseClient, removeSseClient } from "./sse-manager.mjs";
import { persistCommand, loadSession } from "./session-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../app/ui");
const port = Number(process.env.PORT || 4173);
const expectedOrigin = `http://127.0.0.1:${port}`;
const sessionToken = String(process.env.LBE_IDE_SESSION_TOKEN || "");
const cookieName = "lbe_ide_session";
const MAX_BODY_BYTES = 64 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const result = {};
  for (const pair of String(req.headers.cookie || "").split(";")) {
    const index = pair.indexOf("=");
    if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return result;
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
  if (!sessionToken) return process.env.NODE_ENV !== "production";
  const cookies = parseCookies(req);
  return timingSafeEqualText(cookies[cookieName] || "", sessionToken);
}

function validateRequest(req, pathname, method) {
  const host = String(req.headers.host || "");
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "Invalid host";
  if (pathname.startsWith("/api/")) {
    if (!isAuthorized(req)) return "Unauthorized";
    const origin = req.headers.origin;
    if (origin && origin !== expectedOrigin) return "Invalid origin";
    if (method === "POST" && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return "JSON content type required";
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveFile(req, res, pathname, url) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  const boundary = path.relative(ROOT, filePath);
  if (boundary.startsWith("..") || path.isAbsolute(boundary)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const headers = {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
  if (pathname === "/" && sessionToken && timingSafeEqualText(url.searchParams.get("token") || "", sessionToken)) {
    headers["Set-Cookie"] = `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", expectedOrigin);
  const pathname = url.pathname;
  const method = req.method || "GET";
  const validationError = validateRequest(req, pathname, method);
  if (validationError) {
    sendJson(res, validationError === "Unauthorized" ? 401 : 403, { ok: false, error: validationError });
    return;
  }

  if (method === "GET" && pathname === "/api/status") {
    sendJson(res, 200, { ok: true, bridge: getBridgeStatus() });
    return;
  }
  if (method === "GET" && pathname === "/api/commands") {
    sendJson(res, 200, { ok: true, commands: listCommands().slice(0, 50) });
    return;
  }
  if (method === "GET" && pathname === "/api/session") {
    sendJson(res, 200, { ok: true, session: loadSession() });
    return;
  }
  if (method === "POST" && pathname === "/api/command/start") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const command = String(body.command || "").trim();
      const args = Array.isArray(body.args) ? body.args.slice(0, 20) : [];
      if (!command) {
        sendJson(res, 400, { ok: false, error: "Missing command" });
        return;
      }
      const state = createCommandState(command, args);
      schedulePersistOnDone(state.id);
      runBuildKitCommand(state);
      sendJson(res, 202, { ok: true, id: state.id, status: state.status });
    } catch (error) {
      sendJson(res, error.code === "BODY_TOO_LARGE" ? 413 : 400, { ok: false, error: error.message });
    }
    return;
  }
  if (method === "GET" && pathname === "/api/command/result") {
    const command = getCommandState(url.searchParams.get("id"));
    if (!command) {
      sendJson(res, 404, { ok: false, error: "Command not found" });
      return;
    }
    sendJson(res, 200, { ok: true, command });
    return;
  }
  if (method === "GET" && pathname === "/api/command/stream") {
    const id = url.searchParams.get("id");
    const command = id ? getCommandState(id) : null;
    if (!command) {
      res.writeHead(404);
      res.end("Command not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const write = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    write("status", { id: command.id, status: command.status, phase: command.phase });
    for (const entry of command.logs) write(entry.type, { id: command.id, line: entry.line });
    if (["success", "error", "timed_out"].includes(command.status)) {
      if (command.result) write("result", { id: command.id, result: command.result });
      if (command.error) write("command-error", { id: command.id, error: command.error });
      write("done", { id: command.id, status: command.status });
      res.end();
      return;
    }
    addSseClient(id, res);
    req.on("close", () => removeSseClient(id, res));
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  serveFile(req, res, pathname, url);
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, "127.0.0.1", () => console.log(`LB CEP Developer running at ${expectedOrigin}`));

function schedulePersistOnDone(id) {
  let checks = 0;
  const timer = setInterval(() => {
    const command = getCommandState(id);
    checks += 1;
    if (!command || ["success", "error", "timed_out"].includes(command.status)) {
      clearInterval(timer);
      if (command) persistCommand(command);
    } else if (checks > 600) {
      clearInterval(timer);
    }
  }, 1000);
}
