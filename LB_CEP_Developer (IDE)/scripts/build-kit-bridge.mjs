import path from "node:path";
import { spawn } from "node:child_process";
import { updateCommand, pushStdout, pushStderr } from "./command-registry.mjs";
import { emitSse } from "./sse-manager.mjs";

export const buildKitRoot = path.resolve(process.cwd(), "..", "LBE Build Kit");
const buildKitCli = path.join(buildKitRoot, "ext-build.mjs");

const commandMap = {
  "ext-build doctor": ["doctor", "--json"],
  "ext-build check": ["check", "--json"],
  "ext-build dev-verify": ["dev-verify", "--json"],
  "ext-build dev": ["dev", "--dry-run", "--json"],
  "ext-build sync": ["sync", "--dry-run", "--json"],
  "ext-build reload": ["reload", "--changed", "index.html", "--json"],
  "ext-build debug": ["debug", "--dry-run", "--json"],
  "ext-build simulate": ["simulate", "--json"],
  "ext-build bump patch": ["bump", "patch", "--json"],
  "ext-build bump minor": ["bump", "minor", "--json"],
  "ext-build bump major": ["bump", "major", "--json"],
  "ext-build changelog": ["changelog", "--json"],
};
const COMMAND_TIMEOUT_MS = 180000;

export function getBridgeStatus() {
  return {
    buildKitRoot,
    buildKitCli,
    commands: Object.keys(commandMap),
    connected: true,
  };
}

function safeLines(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
}

function extractTaggedJson(lines) {
  // Search newest lines first — tagged line is always last
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("__EXT_BUILD_JSON__")) {
      try {
        return JSON.parse(lines[i].slice("__EXT_BUILD_JSON__".length));
      } catch {
        return null;
      }
    }
  }
  return null;
}


export function runBuildKitCommand(state) {
  const { id, command } = state;
  const args = commandMap[command];
  let finalized = false;
  let timeoutHandle = null;

  const finalize = ({ status, phase = "completed", error = null, result = null, reportPath = null, emitResult = false }) => {
    if (finalized) return;
    finalized = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const patch = {
      status,
      phase,
      endedAt: new Date().toISOString(),
      error: error || null,
      result: result || null,
      reportPath: reportPath || null,
    };
    updateCommand(id, patch);

    if (emitResult && result) emitSse(id, "result", { id, result });
    if (error) {
      emitSse(id, "command-error", { id, error });
    }
    emitSse(id, "done", { id, status });
  };

  if (!args) {
    const error = {
      code: "UNSUPPORTED_COMMAND",
      message: `Unsupported command: ${command}`,
      details: null,
      stage: "bridge",
      raw: null,
    };
    finalize({ status: "error", error });
    return;
  }

  updateCommand(id, { status: "starting", phase: "process-spawned" });
  emitSse(id, "status", { id, status: "starting", phase: "process-spawned" });

  const child = spawn(process.execPath, [buildKitCli, ...args], {
    cwd: buildKitRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const allStdout = [];

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  updateCommand(id, { status: "running", phase: "streaming-output" });
  emitSse(id, "status", { id, status: "running", phase: "streaming-output" });

  timeoutHandle = setTimeout(() => {
    const error = {
      code: "COMMAND_TIMEOUT",
      message: `Build Kit command timed out after ${Math.floor(COMMAND_TIMEOUT_MS / 1000)}s`,
      details: command,
      stage: "bridge",
      raw: null,
    };
    try { child.kill("SIGTERM"); } catch { }
    finalize({ status: "timed_out", error });
  }, COMMAND_TIMEOUT_MS);

  child.stdout.on("data", (chunk) => {
    if (finalized) return;
    for (const line of safeLines(chunk)) {
      allStdout.push(line);
      pushStdout(id, line);
      emitSse(id, "stdout", { id, line });
    }
  });

  child.stderr.on("data", (chunk) => {
    if (finalized) return;
    for (const line of safeLines(chunk)) {
      pushStderr(id, line);
      emitSse(id, "stderr", { id, line });
    }
  });

  child.on("error", (err) => {
    if (finalized) return;
    const error = {
      code: "PROCESS_SPAWN_FAILED",
      message: "Failed to start Build Kit process",
      details: err.message,
      stage: "bridge",
      raw: null,
    };
    finalize({ status: "error", error });
  });

  child.on("close", (exitCode) => {
    if (finalized) return;
    updateCommand(id, { exitCode, phase: "parsing-json" });
    emitSse(id, "status", { id, status: "running", phase: "parsing-json" });

    const parsed = extractTaggedJson(allStdout);

    if (parsed) {
      finalize({ status: "success", result: parsed, reportPath: parsed.reportPath ?? null, emitResult: true });
      return;
    }

    // No tagged JSON — hard fail, no fallback
    const error = {
      code: exitCode !== 0 ? "PROCESS_EXIT_NONZERO" : "MISSING_TAGGED_JSON",
      message: exitCode !== 0 ? "Build Kit command failed" : "Build Kit did not emit tagged JSON output",
      details: exitCode !== 0 ? `Exit code ${exitCode}` : "Expected __EXT_BUILD_JSON__ prefix on structured output. Ensure Build Kit is called with --json.",
      stage: "bridge",
      raw: { stdoutTail: allStdout.slice(-10) },
    };
    finalize({ status: "error", error });
  });
}
