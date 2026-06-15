import path from "node:path";

import { runCommandAdapter } from "../shared/command-adapter.mjs";

function toSlug(value) {
  return String(value ?? "release")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "release";
}

export function runInnoSetup(config, options = {}, context, deps) {
  const { createCheck, ensureDir, writeText } = deps;
  const checks = [];
  const adapterConfig = config.release.adapters.inno;
  const releaseName = `${toSlug(config.project.name)}-${context.version ?? "0.0.0"}`;
  const scriptPath = path.join(context.adaptersDir, `${releaseName}.iss`);
  const helperPath = path.join(context.adaptersDir, `${releaseName}.build-installer.cmd`);
  const expectedExe = path.join(context.adaptersDir, `${releaseName}-installer.exe`);

  if (!adapterConfig?.enabled) {
    checks.push(createCheck("release.inno.build", true, "Inno Setup packaging disabled"));
    return { ok: true, checks, artifacts: [] };
  }

  if (options.dryRun) {
    checks.push(createCheck("release.inno.script", true, `dry-run: would write ${scriptPath}`));
    checks.push(createCheck("release.inno.build", true, "dry-run: would build Windows installer"));
    return { ok: true, checks, artifacts: [] };
  }

  ensureDir(context.adaptersDir);

  const setupScript = [
    "[Setup]",
    `AppName=${config.project.name}`,
    `AppVersion=${context.version ?? "0.0.0"}`,
    `DefaultDirName={userappdata}\\Adobe\\CEP\\extensions\\${config.identity.extensionId}`,
    "DisableDirPage=yes",
    "DisableProgramGroupPage=yes",
    `OutputDir=${context.adaptersDir}`,
    `OutputBaseFilename=${releaseName}-installer`,
    "Compression=lzma",
    "SolidCompression=yes",
    "",
    "[Files]",
    `Source: "${path.join(context.bundleDir, "*")}"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion`,
    "",
  ].join("\n");
  writeText(scriptPath, setupScript);
  writeText(helperPath, `@echo off\r\nISCC "${scriptPath}"\r\n`);
  checks.push(createCheck("release.inno.script", true, scriptPath));

  if (adapterConfig.command) {
    const commandResult = runCommandAdapter("inno", adapterConfig, context, deps);
    const ok = commandResult.ok;
    checks.push(
      createCheck(
        "release.inno.build",
        ok,
        ok ? `installer build completed${adapterConfig.outputPath ? `: ${adapterConfig.outputPath}` : ""}` : `adapter command failed: ${adapterConfig.command}`,
      ),
    );
    return { ok, checks, artifacts: commandResult.artifacts };
  }

  checks.push(
    createCheck(
      "release.inno.build",
      true,
      `installer script staged at ${scriptPath}; configure release.adapters.inno.command to emit ${expectedExe}`,
    ),
  );
  return { ok: true, checks, artifacts: [] };
}
