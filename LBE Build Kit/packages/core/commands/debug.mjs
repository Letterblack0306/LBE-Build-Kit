export function runDebug(config, options = {}, deps) {
  const {
    getDevTargetPath,
    joinPath,
    createCheck,
    ensureDir,
    writeText,
    buildDebugFileContent,
    enablePlayerDebugMode,
    openUrl,
  } = deps;

  const checks = [];
  const targetPath = getDevTargetPath(config, options.target, deps);
  const debugFilePath = joinPath(targetPath, ".debug");
  const browserUrl = config.dev.browserUrl;

  if (options.dryRun) {
    checks.push(createCheck("debug.file", true, `dry-run: would write ${debugFilePath}`));
  } else {
    try {
      ensureDir(targetPath);
      writeText(debugFilePath, buildDebugFileContent(config, deps));
      checks.push(createCheck("debug.file", true, debugFilePath));
    } catch (error) {
      checks.push(
        createCheck("debug.file", false, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  checks.push(...enablePlayerDebugMode(config.dev.csxsVersions, options.dryRun, deps));

  if (options.open) {
    const opened = options.dryRun ? true : openUrl(browserUrl, deps);
    checks.push(
      createCheck("debug.browser", opened, options.dryRun ? `dry-run: would open ${browserUrl}` : browserUrl),
    );
  } else {
    checks.push(createCheck("debug.browser", true, browserUrl));
  }

  return {
    ok: checks.every((check) => check.ok),
    message: options.dryRun ? "Debug setup plan generated." : "Debug setup completed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
    browserUrl,
    targetPath,
  };
}
