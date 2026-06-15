import path from "node:path";

export function getCepExtensionsRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "Adobe", "CEP", "extensions");
  }

  return path.join(process.env.HOME ?? "", "Library", "Application Support", "Adobe", "CEP", "extensions");
}

export function getWorkspaceSyncTargetPath(config, explicitTarget) {
  if (explicitTarget) {
    return path.resolve(process.cwd(), explicitTarget);
  }

  if (config.dev.targetDir) {
    return path.resolve(config.absolute.root, config.dev.targetDir);
  }

  return path.join(getCepExtensionsRoot(), config.dev.extensionId);
}

export function verifyWorkspaceSync(config, options, deps) {
  const {
    createCheck,
    fileExists,
    runRequiredFilesCheck,
    runForbiddenFilesCheck,
    resolveLiveManifestPath,
    renameCheck,
    runManifestIdentityCheck,
    collectArtifacts,
  } = deps;

  const checks = [];
  const liveRoot = config.absolute.devSource;

  checks.push(
    createCheck(
      "dev-verify.live-root",
      fileExists(liveRoot),
      fileExists(liveRoot) ? liveRoot : `missing ${liveRoot}`,
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

    artifacts = collectArtifacts(liveRoot, deps);
  }

  return { checks, artifacts };
}

export function runWorkspaceSync(config, options = {}, deps) {
  const {
    createCheck,
    fileExists,
    listFilesRecursive,
    shouldExcludeSyncPath,
    copyDirectoryRecursive,
  } = deps;

  const sourceRoot = config.absolute.devSource;
  const targetRoot = getWorkspaceSyncTargetPath(config, options.target);
  const checks = [];

  checks.push(
    createCheck(
      "dev.live-source",
      fileExists(sourceRoot),
      fileExists(sourceRoot) ? sourceRoot : `missing ${sourceRoot}`,
    ),
  );

  checks.push(createCheck("dev.target", Boolean(targetRoot), targetRoot));

  const sourceFiles = fileExists(sourceRoot) ? listFilesRecursive(sourceRoot, deps) : [];
  const plannedFiles = sourceFiles.filter((file) => !shouldExcludeSyncPath(file, config.dev.syncExcludes, deps));

  if (fileExists(sourceRoot) && path.resolve(sourceRoot) === path.resolve(targetRoot)) {
    checks.push(createCheck("dev.sync-mode", true, "source and target are the same folder; no sync copy needed."));

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
