export function runDiff(config, againstPath, deps) {
  const {
    resolvePath,
    fileExists,
    listFilesRecursive,
    sha256File,
    createCheck,
  } = deps;

  const compareRoot = againstPath
    ? resolvePath(process.cwd(), againstPath)
    : config.release.previousArtifactPath
      ? resolvePath(config.absolute.root, config.release.previousArtifactPath)
      : null;

  if (!compareRoot) {
    return {
      ok: false,
      message: "diff requires --against <path> or release.previousArtifactPath in config.",
      checks: [createCheck("diff.against", false, "comparison target missing")],
      artifacts: [],
      diff: { added: [], removed: [], changed: [] },
      version: null,
    };
  }

  if (!fileExists(config.absolute.dist)) {
    return {
      ok: false,
      message: `dist path not found: ${config.absolute.dist}`,
      checks: [createCheck("diff.dist", false, "current dist path missing")],
      artifacts: [],
      diff: { added: [], removed: [], changed: [] },
      version: null,
    };
  }

  if (!fileExists(compareRoot)) {
    return {
      ok: false,
      message: `comparison path not found: ${compareRoot}`,
      checks: [createCheck("diff.against", false, "comparison target missing on disk")],
      artifacts: [],
      diff: { added: [], removed: [], changed: [] },
      version: null,
    };
  }

  const currentFiles = listFilesRecursive(config.absolute.dist, deps);
  const previousFiles = listFilesRecursive(compareRoot, deps);
  const currentSet = new Set(currentFiles);
  const previousSet = new Set(previousFiles);
  const added = currentFiles.filter((file) => !previousSet.has(file));
  const removed = previousFiles.filter((file) => !currentSet.has(file));
  const changed = currentFiles.filter((file) => {
    if (!previousSet.has(file)) {
      return false;
    }

    return sha256File(resolvePath(config.absolute.dist, file)) !== sha256File(resolvePath(compareRoot, file));
  });

  const diff = { added, removed, changed };
  const ok = added.length === 0 && removed.length === 0 && changed.length === 0;

  return {
    ok,
    message: ok
      ? "No artifact drift detected."
      : `Artifact drift detected: +${added.length} / -${removed.length} / ~${changed.length}`,
    checks: [createCheck("diff.compare", ok, ok ? "current dist matches comparison target" : "artifact drift detected")],
    artifacts: [],
    diff,
    version: null,
  };
}
