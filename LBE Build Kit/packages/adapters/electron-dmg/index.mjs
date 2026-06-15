import path from "node:path";

import { runCommandAdapter } from "../shared/command-adapter.mjs";

function toSlug(value) {
  return String(value ?? "release")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "release";
}

export function runDmgPackage(config, options = {}, context, deps) {
  const { createCheck, ensureDir, writeJson } = deps;
  const checks = [];
  const adapterConfig = config.release.adapters.electronDmg;
  const releaseName = `${toSlug(config.project.name)}-${context.version ?? "0.0.0"}`;
  const specPath = path.join(context.adaptersDir, `${releaseName}.dmg-spec.json`);

  if (!adapterConfig?.enabled) {
    checks.push(createCheck("release.dmg", true, "DMG packaging disabled"));
    return { ok: true, checks, artifacts: [] };
  }

  if (options.dryRun) {
    checks.push(createCheck("release.dmg", true, `dry-run: would write ${specPath}`));
    return { ok: true, checks, artifacts: [] };
  }

  ensureDir(context.adaptersDir);
  writeJson(specPath, {
    title: config.project.name,
    version: context.version ?? null,
    sourceBundle: context.bundleDir,
    note: "Configure release.adapters.electronDmg.command for real DMG packaging.",
  });

  if (adapterConfig.command) {
    const commandResult = runCommandAdapter("electron-dmg", adapterConfig, context, deps);
    const ok = commandResult.ok;
    checks.push(
      createCheck(
        "release.dmg",
        ok,
        ok ? `DMG packaging completed${adapterConfig.outputPath ? `: ${adapterConfig.outputPath}` : ""}` : `adapter command failed: ${adapterConfig.command}`,
      ),
    );
    return { ok, checks, artifacts: commandResult.artifacts };
  }

  checks.push(
    createCheck(
      "release.dmg",
      true,
      `DMG packaging spec staged at ${specPath}; configure release.adapters.electronDmg.command for real packaging`,
    ),
  );
  return { ok: true, checks, artifacts: [] };
}
