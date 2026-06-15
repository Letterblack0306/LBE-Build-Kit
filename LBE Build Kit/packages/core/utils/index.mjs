import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";

export function toPosix(value) {
  return value.replace(/\\/g, "/");
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

export function slugifyPackageName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "my-cep-extension";
}

export function applyTemplate(content, replacements) {
  let output = content;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, String(value));
  }
  return output;
}

export function loadLocalTemplate(fileName, replacements) {
  const templatePath = path.join(process.cwd(), fileName);
  return applyTemplate(readText(templatePath), replacements);
}

export function createCheck(name, ok, message, details = {}) {
  return { name, ok, message, details };
}

export function renameCheck(check, name) {
  return { ...check, name };
}

export function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern) {
  const normalized = toPosix(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*" || char === "?") {
      source += char === "*" ? "[^/]*" : "[^/]";
      continue;
    }
    source += escapeRegex(char);
  }
  source += "$";
  return new RegExp(source);
}

export function matchesAnyPattern(filePath, patterns) {
  const normalized = toPosix(filePath);
  return patterns.some((pattern) => {
    if (globToRegExp(pattern).test(normalized)) return true;
    if (pattern.startsWith("**/")) return globToRegExp(pattern.slice(3)).test(normalized);
    return false;
  });
}

export function listFilesRecursive(rootDir) {
  const files = [];
  function walk(currentDir) {
    if (!fileExists(currentDir)) return;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else {
        files.push(toPosix(path.relative(rootDir, absolutePath)));
      }
    }
  }
  walk(rootDir);
  return files.sort();
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function readManifestInfo(filePath) {
  if (!fileExists(filePath)) {
    return { exists: false, bundleId: null, bundleVersion: null, extensionIds: [], type: "unknown" };
  }

  // UXP manifest: JSON file with id + version fields
  if (filePath.toLowerCase().endsWith(".json")) {
    try {
      const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        exists: true,
        bundleId: json.id ?? null,
        bundleVersion: json.version ?? null,
        extensionIds: json.id ? [json.id] : [],
        type: "uxp",
      };
    } catch {
      return { exists: false, bundleId: null, bundleVersion: null, extensionIds: [], type: "unknown" };
    }
  }

  // CEP manifest: XML file
  const xml = readText(filePath);
  return {
    exists: true,
    bundleId: (xml.match(/ExtensionBundleId="([^"]+)"/) || [])[1] ?? null,
    bundleVersion: (xml.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1] ?? null,
    extensionIds: [...xml.matchAll(/<Extension\b[^>]*Id="([^"]+)"/g)].map((match) => match[1]),
    type: "cep",
  };
}

export function signContent(content, secret) {
  return crypto.createHmac("sha256", secret).update(content).digest("hex");
}

export function verifySignature(content, expectedSig, secret) {
  const actualSig = signContent(content, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(actualSig, "hex"), Buffer.from(expectedSig.trim(), "hex"));
  } catch {
    return false;
  }
}

export function renderTag(tagFormat, version) {
  return String(tagFormat ?? "v{version}").replaceAll("{version}", version);
}

export function getGitValue(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export function getGitMetadata() {
  return {
    branch: process.env.GITHUB_REF_NAME && !String(process.env.GITHUB_REF).startsWith("refs/tags/")
      ? process.env.GITHUB_REF_NAME
      : getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: process.env.GITHUB_SHA ?? getGitValue(["rev-parse", "HEAD"]),
    tag:
      process.env.GITHUB_REF_NAME && String(process.env.GITHUB_REF).startsWith("refs/tags/")
        ? process.env.GITHUB_REF_NAME
        : getGitValue(["describe", "--exact-match", "--tags", "HEAD"]),
  };
}

export function shouldExcludeSyncPath(relativePath, excludes) {
  const normalized = toPosix(relativePath);
  return excludes.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

export function copyDirectoryRecursive(sourceRoot, targetRoot, excludes) {
  function copyInto(currentSource, currentTargetBase) {
    const relative = toPosix(path.relative(sourceRoot, currentSource));
    if (relative && shouldExcludeSyncPath(relative, excludes)) return;
    const stat = fs.statSync(currentSource);
    if (stat.isDirectory()) {
      ensureDir(currentTargetBase);
      for (const entry of fs.readdirSync(currentSource)) {
        copyInto(path.join(currentSource, entry), path.join(currentTargetBase, entry));
      }
    } else {
      ensureDir(path.dirname(currentTargetBase));
      fs.copyFileSync(currentSource, currentTargetBase);
    }
  }
  copyInto(sourceRoot, targetRoot);
}

export function detectReloadAction(config, changedFiles) {
  const panelMatches = [];
  const restartMatches = [];
  for (const file of changedFiles) {
    if (matchesAnyPattern(file, config.dev.reload.restartPatterns)) {
      restartMatches.push(file);
    } else if (matchesAnyPattern(file, config.dev.reload.panelPatterns)) {
      panelMatches.push(file);
    }
  }
  if (restartMatches.length > 0) return { action: "ae-restart", message: "After Effects restart required.", matches: restartMatches, panelMatches };
  if (panelMatches.length > 0) return { action: "panel-reload", message: "Panel reload should be sufficient.", matches: panelMatches, panelMatches };
  return { action: "no-reload", message: "No known reload action required.", matches: [], panelMatches: [] };
}

export function openUrl(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

export function runConfiguredCommand(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, stdio: "ignore" });
  return { ok: result.status === 0, status: result.status };
}

function getMimeType(filePath) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
  return types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function startStaticServer(rootDir, port) {
  const server = http.createServer((request, response) => {
    const safePath = (request.url === "/" ? "/index.html" : request.url ?? "/index.html").split("?")[0].replace(/^\/+/, "");
    const absolutePath = path.resolve(rootDir, safePath);
    if (!absolutePath.startsWith(rootDir) || !fileExists(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
      response.statusCode = 404; response.end("Not Found"); return;
    }
    response.setHeader("Content-Type", getMimeType(absolutePath));
    response.end(fs.readFileSync(absolutePath));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function parseVersion(value) {
  return String(value).split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function isAtLeastVersion(current, minimum) {
  const left = parseVersion(current);
  const right = parseVersion(minimum);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0; const b = right[i] ?? 0;
    if (a > b) return true; if (a < b) return false;
  }
  return true;
}

export function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [command], { stdio: "ignore" }).status === 0;
}

export function buildDebugFileContent(config) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ExtensionList>",
    `  <Extension Id="${config.dev.extensionId}">`,
    "    <HostList>",
    `      <Host Name="${config.dev.hostName}" Port="${config.dev.debugPort}"/>`,
    "    </HostList>",
    "  </Extension>",
    "</ExtensionList>",
    "",
  ].join("\n");
}

export function enablePlayerDebugMode(csxsVersions, dryRun) {
  const checks = [];

  if (process.platform === "win32") {
    for (const version of csxsVersions) {
      const label = `debug.registry.CSXS.${version}`;
      if (dryRun) {
        checks.push(createCheck(label, true, "dry-run: would enable PlayerDebugMode"));
        continue;
      }

      const command = `reg add "HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.${version}" /v PlayerDebugMode /t REG_SZ /d 1 /f`;
      const result = spawnSync(command, { shell: true, stdio: "ignore" });
      checks.push(
        createCheck(
          label,
          result.status === 0,
          result.status === 0 ? "PlayerDebugMode enabled" : "failed to enable PlayerDebugMode",
        ),
      );
    }
    return checks;
  }

  if (process.platform === "darwin") {
    for (const version of csxsVersions) {
      const label = `debug.defaults.CSXS.${version}`;
      if (dryRun) {
        checks.push(createCheck(label, true, "dry-run: would enable PlayerDebugMode"));
        continue;
      }

      const result = spawnSync("defaults", ["write", `com.adobe.CSXS.${version}`, "PlayerDebugMode", "1"], {
        stdio: "ignore",
      });
      checks.push(
        createCheck(
          label,
          result.status === 0,
          result.status === 0 ? "PlayerDebugMode enabled" : "failed to enable PlayerDebugMode",
        ),
      );
    }
    return checks;
  }

  checks.push(createCheck("debug.registry", true, "PlayerDebugMode setup skipped on this platform"));
  return checks;
}
