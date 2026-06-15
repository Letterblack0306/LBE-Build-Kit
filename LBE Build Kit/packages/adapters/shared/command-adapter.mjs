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

  const commandResult = runConfiguredCommand(adapterConfig.command, context.cwd);
  const checks = [
    createCheck(
      `adapter.${adapterName}`,
      commandResult.ok,
      commandResult.ok ? `ran ${adapterConfig.command}` : `adapter command failed: ${adapterConfig.command}`,
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
