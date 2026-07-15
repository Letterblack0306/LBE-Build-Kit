import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("electron/main.mjs");
const preload = read("electron/preload.mjs");
const server = read("scripts/dev-server.mjs");
const packageJson = JSON.parse(read("package.json"));

const failures = [];
const requireText = (source, pattern, description) => {
  if (!pattern.test(source)) failures.push(`Missing: ${description}`);
};
const forbidText = (source, pattern, description) => {
  if (pattern.test(source)) failures.push(`Forbidden: ${description}`);
};

requireText(main, /contextIsolation:\s*true/, "context isolation");
requireText(main, /sandbox:\s*true/, "renderer sandbox");
requireText(main, /nodeIntegration:\s*false/, "Node integration disabled");
requireText(main, /WORKSPACE_SCOPE_BLOCKED/, "workspace containment enforcement");
requireText(main, /DIRECT_WRITE_DISABLED/, "direct mutation APIs disabled");
requireText(main, /SECURE_STORAGE_UNAVAILABLE/, "fail-closed secret persistence");
requireText(main, /!app\.isPackaged\s*&&\s*process\.env\.LBE_IDE_ENABLE_CDP/, "development-only CDP gate");
forbidText(preload, /invoke:\s*\(channel/, "generic IPC invoke escape hatch");
forbidText(preload, /writeFile:\s*\(/, "direct renderer write API");
forbidText(preload, /deleteFile:\s*\(/, "direct renderer delete API");
requireText(server, /LBE_IDE_SESSION_TOKEN/, "loopback session token");
requireText(server, /timingSafeEqual/, "constant-time token comparison");
requireText(server, /MAX_BODY_BYTES/, "request body limit");
requireText(server, /Invalid origin/, "origin validation");
requireText(server, /Invalid host/, "host validation");

if (packageJson.build?.asar !== true) failures.push("Packaging must enable asar");
const targets = packageJson.build?.win?.target || [];
if (!JSON.stringify(targets).includes("nsis")) failures.push("Windows NSIS installer target is required");
if (!Array.isArray(packageJson.build?.extraResources) || packageJson.build.extraResources.length === 0) failures.push("Packaged runtime resources are missing");

if (failures.length) {
  console.error("IDE security contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("PASS security");
console.log("Electron, IPC, workspace, loopback API, secret storage, and packaging contracts are present.");
