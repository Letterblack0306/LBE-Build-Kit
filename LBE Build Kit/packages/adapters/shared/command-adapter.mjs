import { spawnSync } from "node:child_process";

export function runCommandAdapter(adapterName, adapterConfig, context, deps) {
  const {
    createCheck,
    runConfiguredCommand,
    fileExists,
    fs,
    resolvePath,
    collectArtifacts,
    sha256File,
  } = deps;

  if (!adapterConfig?.enabled) {
    return {
      ok: true,
      checks: [createCheck(`adapter.${adapterName}`, true, "adapter disabled")],
      artifacts: [],
    };
  }

  if (!adapterConfig.command) {
    return {
      ok: false,
      checks: [createCheck(`adapter.${adapterName}`, false, "adapter enabled but no command configured")],
      artifacts: [],
    };
  }

  // Get timeout from config (default: 5 minutes = 300000ms)
  const timeoutMs = adapterConfig.timeout ?? 300000;

  const commandResult = runConfiguredCommandWithTimeout(adapterConfig.command, context.cwd, timeoutMs);
  const checks = [
    createCheck(
      `adapter.${adapterName}`,
      commandResult.ok,
      commandResult.ok
        ? `ran ${adapterConfig.command}`
        : `adapter command failed: ${adapterConfig.command}${commandResult.timedOut ? " (TIMEOUT)" : ""}`,
    ),
  ];

  const artifacts = [];
  if (adapterConfig.outputPath) {
    const absoluteOutput = resolvePath(context.cwd, adapterConfig.outputPath);
    const exists = fileExists(absoluteOutput);
    checks.push(
      createCheck(
        `adapter.${adapterName}.output`,
        exists,
        exists ? absoluteOutput : `missing ${absoluteOutput}`,
      ),
    );

    if (exists) {
      const stat = fs.statSync(absoluteOutput);
      if (stat.isDirectory()) {
        artifacts.push(...collectArtifacts(absoluteOutput, deps).map((artifact) => ({
          ...artifact,
          path: `${adapterName}/${artifact.path}`,
        })));
      } else {
        artifacts.push({
          path: `${adapterName}/${absoluteOutput.split(/[/\\]/).pop()}`,
          size: stat.size,
          sha256: sha256File(absoluteOutput),
        });
      }
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    artifacts,
  };
}

function runConfiguredCommandWithTimeout(command, cwd, timeoutMs) {
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timedOut = result.signal === "SIGTERM" || (result.error && result.error.code === "ETIMEDOUT");

  return {
    ok: result.status === 0 && !timedOut,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
    signal: result.signal,
    timedOut,
  };
}
