import fs from "node:fs";
import path from "node:path";

function getPaths(projectRoot) {
  const stateDir = path.join(projectRoot, ".build-report");
  return {
    stateDir,
    lockFile: path.join(stateDir, ".release-lock.json"),
    stateFile: path.join(stateDir, ".release-state.json"),
  };
}

export function readReleaseState(projectRoot) {
  const { stateFile } = getPaths(projectRoot);
  if (!fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

export function writeReleaseState(projectRoot, state) {
  const { stateDir, stateFile } = getPaths(projectRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function markReleaseStep(projectRoot, step, status = "PASS") {
  const state = readReleaseState(projectRoot);
  state[step] = status;
  writeReleaseState(projectRoot, state);
  console.log(`[release-lock] ${step} -> ${status}`);
}

export function checkReleasePrerequisites(projectRoot, steps) {
  const state = readReleaseState(projectRoot);
  for (const step of steps) {
    if (state[step] !== "PASS") {
      throw new Error(`[release-lock] BLOCKED: Step '${step}' has not been successfully completed.`);
    }
  }
}

export function isReleaseLocked(projectRoot) {
  const { lockFile } = getPaths(projectRoot);
  if (!fs.existsSync(lockFile)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    return data.locked === true;
  } catch {
    return false;
  }
}

export function setReleaseLock(projectRoot, locked) {
  const { stateDir, lockFile } = getPaths(projectRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(lockFile, `${JSON.stringify({ locked, timestamp: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log(`[release-lock] Lock state set to: ${locked}`);
}

export function resetReleaseLockAndState(projectRoot) {
  const { lockFile, stateFile } = getPaths(projectRoot);
  let removed = false;

  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    removed = true;
  }
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    removed = true;
  }

  if (removed) {
    console.log("[release-lock] Release lock and state files reset.");
  } else {
    console.log("[release-lock] Release lock and state are already clean.");
  }
}
