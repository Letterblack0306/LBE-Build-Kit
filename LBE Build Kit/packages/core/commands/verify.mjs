import { runES3Check } from "./es3-check.mjs";

export async function runVerify(config, deps) {
  const {
    createCheck,
    fileExists,
    runRequiredFilesCheck,
    runForbiddenFilesCheck,
    runVersionSync,
    resolveDistManifestPath,
    runManifestIdentityCheck,
    runArtifactVersionChecks,
    collectArtifacts,
    runBundleStructureCheck,
  } = deps;

  if (!fileExists(config.absolute.dist)) {
    return {
      ok: false,
      message: `dist path not found: ${config.absolute.dist}`,
      checks: [createCheck("verify.dist", false, "build output directory is missing")],
      artifacts: [],
      diff: null,
      version: null,
    };
  }

  const checks = [];
  const requiredFiles = runRequiredFilesCheck(config.absolute.dist, config.validation.requiredFiles ?? [], deps);
  const forbiddenFiles = runForbiddenFilesCheck(config.absolute.dist, config.validation.forbiddenPatterns ?? [], deps);
  const versionSync = runVersionSync(config, deps);
  const distManifestPath = resolveDistManifestPath(config, deps);

  checks.push(requiredFiles.check);
  checks.push(forbiddenFiles.check);
  checks.push(runBundleStructureCheck(config, deps));
  checks.push(...versionSync.checks);
  checks.push(
    fileExists(distManifestPath)
      ? runManifestIdentityCheck(distManifestPath, config.identity.extensionId, deps)
      : createCheck("verify.dist-manifest", false, `dist manifest not found: ${distManifestPath}`),
  );

  checks.push(...runArtifactVersionChecks(config.absolute.artifactVersionFiles, versionSync.version, "verify.artifact-version", deps));

  const es3Result = await runES3Check(config, deps);
  checks.push(...es3Result.checks);

  const artifacts = collectArtifacts(config.absolute.dist, deps);

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok ? "Build output verification passed." : "Build output verification failed.",
    checks,
    artifacts,
    diff: null,
    version: versionSync.version,
  };
}
