import path from "node:path";
import { spawnSync } from "node:child_process";

import { runCommandAdapter } from "../shared/command-adapter.mjs";

function toSlug(value) {
  return String(value ?? "release")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "release";
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

export function runZxpPackage(config, options = {}, context, deps) {
  const { createCheck, ensureDir, fileExists } = deps;
  const checks = [];
  const adapterConfig = config.release.adapters.zxp;
  const releaseName = `${toSlug(config.project.name)}-${context.version ?? "0.0.0"}`;
  const zxpPath = path.join(context.adaptersDir, `${releaseName}.unsigned.zxp`);

  if (!adapterConfig?.enabled) {
    checks.push(createCheck("release.zxp", true, "ZXP packaging disabled"));
    return { ok: true, checks, artifacts: [] };
  }

  if (options.dryRun) {
    checks.push(createCheck("release.zxp", true, `dry-run: would stage unsigned ZXP archive at ${zxpPath}`));
    return { ok: true, checks, artifacts: [] };
  }

  ensureDir(context.adaptersDir);

  if (adapterConfig.command) {
    const commandResult = runCommandAdapter("zxp", adapterConfig, context, deps);
    const outputCheck = commandResult.checks.find((check) => check.name === "adapter.zxp.output");
    checks.push(
      createCheck(
        "release.zxp",
        commandResult.ok,
        outputCheck?.ok ? outputCheck.message : commandResult.ok ? `ran ${adapterConfig.command}` : `adapter command failed: ${adapterConfig.command}`,
      ),
    );
    return { ok: commandResult.ok, checks, artifacts: commandResult.artifacts };
  }

  if (process.platform !== "win32") {
    checks.push(createCheck("release.zxp", true, "staged bundle only; configure release.adapters.zxp.command for signed packaging on this platform"));
    return { ok: true, checks, artifacts: [] };
  }

  const archiveCommand = [
    "powershell",
    "-NoProfile",
    "-Command",
    `if (Test-Path '${psQuote(zxpPath)}') { Remove-Item '${psQuote(zxpPath)}' -Force }; Compress-Archive -Path '${psQuote(path.join(context.bundleDir, "*"))}' -DestinationPath '${psQuote(zxpPath)}' -Force`,
  ];
  const result = spawnSync(archiveCommand[0], archiveCommand.slice(1), { stdio: "ignore" });
  const ok = result.status === 0 && fileExists(zxpPath);
  checks.push(
    createCheck(
      "release.zxp",
      ok,
      ok ? `unsigned ZXP archive staged at ${zxpPath}` : "failed to stage unsigned ZXP archive",
    ),
  );

  return { ok, checks, artifacts: [] };
}
