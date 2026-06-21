import fs from "node:fs";
import path from "node:path";
// Lock TTL in minutes (default: 30 minutes)
const LOCK_TTL_MINUTES = 30;

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

export function isReleaseLocked(projectRoot, ttlMinutes = LOCK_TTL_MINUTES) {
  const { lockFile } = getPaths(projectRoot);
  if (!fs.existsSync(lockFile)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (data.locked !== true) return false;

    // Check TTL - if lock is older than TTL, consider it expired
    if (data.timestamp) {
      const lockTime = new Date(data.timestamp).getTime();
      const now = Date.now();
      const ttlMs = ttlMinutes * 60 * 1000;
      if (now - lockTime > ttlMs) {
        console.log('[release-lock] Lock expired (older than ' + ttlMinutes + ' minutes), auto-releasing');
        return false;
      }
    }
    return true;
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

export function forceReleaseLock(projectRoot) {
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
    console.log('[release-lock] Release lock and state files force-released (TTL expired or manual reset).');
  } else {
    console.log('[release-lock] Release lock and state are already clean.');
  }
}

export function resetReleaseLockAndState(projectRoot) {
  forceReleaseLock(projectRoot);
}
