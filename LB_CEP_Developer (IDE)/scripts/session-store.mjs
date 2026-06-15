import fs from "node:fs";
import path from "node:path";

const SESSION_DIR = path.resolve(".ide-session");
const SESSION_FILE = path.join(SESSION_DIR, "session.json");

// Keep only the last N entries to avoid unbounded growth
const MAX_HISTORY = 50;

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return { recentCommands: [], lastUpdated: null };
  }
}

export function persistCommand(state) {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const session = readSession();

    session.recentCommands.push({
      id: state.id,
      command: state.command,
      status: state.status,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      error: state.error ?? null,
      reportPath: state.reportPath ?? null,
      summary: state.result?.summary ?? null,
    });

    if (session.recentCommands.length > MAX_HISTORY) {
      session.recentCommands = session.recentCommands.slice(-MAX_HISTORY);
    }

    session.lastUpdated = new Date().toISOString();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
  } catch {
    // Non-fatal — session write failures must never crash the server
  }
}

export function loadSession() {
  return readSession();
}
