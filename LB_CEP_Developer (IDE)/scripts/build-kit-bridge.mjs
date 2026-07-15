import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { updateCommand, pushStdout, pushStderr } from "./command-registry.mjs";
import { emitSse } from "./sse-manager.mjs";

const configuredRoot = process.env.LBE_BUILD_KIT_ROOT ? path.resolve(process.env.LBE_BUILD_KIT_ROOT) : null;
const packagedRoot = path.resolve(process.cwd(), "LBE Build Kit");
const developmentRoot = path.resolve(process.cwd(), "..", "LBE Build Kit");
export const buildKitRoot = configuredRoot || (fs.existsSync(path.join(packagedRoot, "ext-build.mjs")) ? packagedRoot : developmentRoot);
const buildKitCli = path.join(buildKitRoot, "ext-build.mjs");

const commandMap = Object.freeze({
  "ext-build doctor": ["doctor", "--json"],
  "ext-build check": ["check", "--json"],
  "ext-build dev-verify": ["dev-verify", "--json"],
  "ext-build dev": ["dev", "--dry-run", "--json"],
  "ext-build watch": ["watch", "--json"],
  "ext-build build": ["build", "--json"],
  "ext-build preflight": ["preflight", "--json"],
  "ext-build hygiene": ["hygiene", "--json"],
  "ext-build sign-verify": ["sign-verify", "--json"],
  "ext-build sync": ["sync", "--dry-run", "--json"],
  "ext-build reload": ["reload", "--changed", "index.html", "--json"],
  "ext-build debug": ["debug", "--dry-run", "--json"],
  "ext-build simulate": ["simulate", "--json"],
  "ext-build bump patch": ["bump", "patch", "--json"],
  "ext-build bump minor": ["bump", "minor", "--json"],
  "ext-build bump major": ["bump", "major", "--json"],
  "ext-build changelog": ["changelog", "--json"]
});
const COMMAND_TIMEOUT_MS = 180000;

export function getBridgeStatus() {
  return {
    buildKitRoot,
    buildKitCli,
    commands: Object.keys(commandMap),
    connected: fs.existsSync(buildKitCli)
  };
}

function safeLines(chunk) {
  return chunk.toString().split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function extractTaggedJson(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("__EXT_BUILD_JSON__")) continue;
    try { return JSON.parse(lines[index].slice("__EXT_BUILD_JSON__".length)); } catch { return null; }
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
    updateCommand(id, { status, phase, endedAt: new Date().toISOString(), error, result, reportPath });
    if (emitResult && result) emitSse(id, "result", { id, result });
    if (error) emitSse(id, "command-error", { id, error });
    emitSse(id, "done", { id, status });
  };

  if (!args) {
    finalize({ status: "error", error: { code: "UNSUPPORTED_COMMAND", message: `Unsupported command: ${command}`, stage: "bridge" } });
    return;
  }
  if (!fs.existsSync(buildKitCli)) {
    finalize({ status: "error", error: { code: "BUILD_KIT_NOT_FOUND", message: "Build Kit CLI was not found", details: buildKitCli, stage: "bridge" } });
    return;
  }

  updateCommand(id, { status: "starting", phase: "process-spawned" });
  emitSse(id, "status", { id, status: "starting", phase: "process-spawned" });
  const child = spawn(process.execPath, [buildKitCli, ...args], {
    cwd: buildKitRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  });
  const stdout = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  updateCommand(id, { status: "running", phase: "streaming-output" });
  emitSse(id, "status", { id, status: "running", phase: "streaming-output" });

  timeoutHandle = setTimeout(() => {
    try { child.kill("SIGTERM"); } catch { }
    finalize({ status: "timed_out", error: { code: "COMMAND_TIMEOUT", message: `Build Kit command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`, details: command, stage: "bridge" } });
  }, COMMAND_TIMEOUT_MS);

  child.stdout.on("data", (chunk) => {
    if (finalized) return;
    for (const line of safeLines(chunk)) {
      stdout.push(line);
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
  child.on("error", (error) => finalize({ status: "error", error: { code: "PROCESS_SPAWN_FAILED", message: "Failed to start Build Kit process", details: error.message, stage: "bridge" } }));
  child.on("close", (exitCode) => {
    if (finalized) return;
    const parsed = extractTaggedJson(stdout);
    if (exitCode === 0 && parsed) {
      finalize({ status: "success", result: parsed, reportPath: parsed.reportPath ?? null, emitResult: true });
      return;
    }
    finalize({ status: "error", error: { code: exitCode !== 0 ? "PROCESS_EXIT_NONZERO" : "MISSING_TAGGED_JSON", message: exitCode !== 0 ? "Build Kit command failed" : "Build Kit did not emit tagged JSON output", details: exitCode !== 0 ? `Exit code ${exitCode}` : "Expected __EXT_BUILD_JSON__ output", stage: "bridge", raw: { stdoutTail: stdout.slice(-10) } } });
  });
}
