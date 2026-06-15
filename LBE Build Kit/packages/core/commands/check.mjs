export function runCheck(config, deps) {
  const { createCheck, fileExists, runVersionSync, runManifestIdentityCheck } = deps;
  const checks = [];

  checks.push(
    createCheck(
      "config.paths.source",
      fileExists(config.absolute.source),
      fileExists(config.absolute.source)
        ? `source path found: ${config.paths.source}`
        : `missing source path: ${config.paths.source}`,
    ),
  );
  checks.push(
    createCheck(
      "config.paths.manifest",
      fileExists(config.absolute.manifest),
      fileExists(config.absolute.manifest)
        ? `manifest found: ${config.paths.manifest}`
        : `missing manifest: ${config.paths.manifest}`,
    ),
  );

  const versionSync = runVersionSync(config, deps);
  checks.push(...versionSync.checks);
  checks.push(runManifestIdentityCheck(config.absolute.manifest, config.identity.extensionId, deps));

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok ? "Source configuration checks passed." : "One or more source checks failed.",
    checks,
    artifacts: [],
    diff: null,
    version: versionSync.version,
  };
}
