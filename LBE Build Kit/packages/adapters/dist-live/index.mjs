import path from "node:path";

export function getDistLiveTargetPath(config, explicitTarget) {
  if (explicitTarget) {
    return path.resolve(process.cwd(), explicitTarget);
  }

  if (config.dev.targetDir) {
    return path.resolve(config.absolute.root, config.dev.targetDir);
  }

  return config.absolute.dist;
}

export function verifyDistLive(config, options, deps) {
  const {
    createCheck,
    fileExists,
    runRequiredFilesCheck,
    runForbiddenFilesCheck,
    resolveLiveManifestPath,
    renameCheck,
    runManifestIdentityCheck,
    runArtifactVersionChecks,
    collectArtifacts,
  } = deps;

  const checks = [];
  const liveRoot = config.absolute.dist;
  const liveRootExpected =
    options.dryRun &&
    !fileExists(liveRoot) &&
    Boolean(config.dev.buildCommand);

  checks.push(
    createCheck(
      "dev-verify.live-root",
      fileExists(liveRoot) || liveRootExpected,
      fileExists(liveRoot)
        ? liveRoot
        : liveRootExpected
          ? `dry-run: ${liveRoot} will be produced by ${config.dev.buildCommand}`
          : `missing ${liveRoot}`,
    ),
  );

  let artifacts = [];
  if (fileExists(liveRoot)) {
    const liveRequired = runRequiredFilesCheck(liveRoot, config.validation.requiredFiles ?? [], deps);
    const liveForbidden = runForbiddenFilesCheck(liveRoot, config.validation.forbiddenPatterns ?? [], deps);
    const liveManifestPath = resolveLiveManifestPath(config, liveRoot);

    checks.push(renameCheck(liveRequired.check, "dev-verify.required-files"));
    checks.push(renameCheck(liveForbidden.check, "dev-verify.forbidden-files"));
    checks.push(
      fileExists(liveManifestPath)
        ? renameCheck(runManifestIdentityCheck(liveManifestPath, config.identity.extensionId, deps), "dev-verify.manifest.identity")
        : createCheck("dev-verify.manifest", false, `live manifest not found: ${liveManifestPath}`),
    );

    checks.push(...runArtifactVersionChecks(config.absolute.artifactVersionFiles, options.canonicalVersion, "dev-verify.artifact-version", deps));

    artifacts = collectArtifacts(liveRoot, deps);
  }

  return { checks, artifacts };
}

export function runDistLiveSync(config, options = {}, deps) {
  const {
    createCheck,
    fileExists,
    listFilesRecursive,
    shouldExcludeSyncPath,
    copyDirectoryRecursive,
  } = deps;

  const sourceRoot = config.absolute.dist;
  const targetRoot = getDistLiveTargetPath(config, options.target);
  const checks = [];
  const isDistPlanning =
    options.dryRun &&
    !fileExists(sourceRoot) &&
    Boolean(config.dev.buildCommand);

  checks.push(
    createCheck(
      "dev.live-source",
      fileExists(sourceRoot) || isDistPlanning,
      fileExists(sourceRoot)
        ? sourceRoot
        : isDistPlanning
          ? `dry-run: ${sourceRoot} will be produced by ${config.dev.buildCommand}`
          : `missing ${sourceRoot}`,
    ),
  );

  checks.push(createCheck("dev.target", Boolean(targetRoot), targetRoot));

  const sourceFiles = fileExists(sourceRoot) ? listFilesRecursive(sourceRoot, deps) : [];
  const plannedFiles = sourceFiles.filter((file) => !shouldExcludeSyncPath(file, config.dev.syncExcludes, deps));

  if (fileExists(sourceRoot) && path.resolve(sourceRoot) === path.resolve(targetRoot)) {
    checks.push(createCheck("dev.sync-mode", true, "AE should read this folder directly; no sync copy needed."));

    return {
      ok: checks.every((check) => check.ok),
      message: "Sync skipped because live source equals live target.",
      checks,
      artifacts: [],
      diff: null,
      version: null,
      targetPath: targetRoot,
      syncedFiles: plannedFiles,
    };
  }

  if (!options.dryRun && fileExists(sourceRoot)) {
    try {
      copyDirectoryRecursive(sourceRoot, targetRoot, config.dev.syncExcludes, deps);
      checks.push(createCheck("dev.sync-write", true, `synced ${plannedFiles.length} file(s)`));
    } catch (error) {
      checks.push(createCheck("dev.sync-write", false, error instanceof Error ? error.message : String(error)));
    }
  } else {
    checks.push(createCheck("dev.sync-write", true, `dry-run: would sync ${plannedFiles.length} file(s)`));
  }

  return {
    ok: checks.every((check) => check.ok),
    message: options.dryRun ? "Sync plan generated." : "Sync completed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
    targetPath: targetRoot,
    syncedFiles: plannedFiles,
  };
}
