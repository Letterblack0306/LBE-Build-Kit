export function runDoctor(config, deps) {
  const { createCheck, isAtLeastVersion, fileExists, commandExists, listFilesRecursive, joinPath } = deps;
  const checks = [];
  const requiredEnv = [...new Set([...(config.validation.requiredEnv ?? []), ...(config.release.requiredEnv ?? [])])];
  const requiredTools = [...new Set(config.validation.requiredTools ?? [])];

  checks.push(
    createCheck(
      "node.version",
      isAtLeastVersion(process.versions.node, "18.0.0"),
      `detected ${process.versions.node}, requires >= 18.0.0`,
    ),
  );

  checks.push(
    createCheck(
      "paths.source",
      fileExists(config.absolute.source),
      fileExists(config.absolute.source) ? config.absolute.source : `missing ${config.absolute.source}`,
    ),
  );

  checks.push(
    createCheck(
      "paths.manifest",
      fileExists(config.absolute.manifest),
      fileExists(config.absolute.manifest) ? config.absolute.manifest : `missing ${config.absolute.manifest}`,
    ),
  );

  for (const spec of config.absolute.versionFiles) {
    checks.push(
      createCheck(
        `version-file:${spec.path}`,
        fileExists(spec.absolutePath),
        fileExists(spec.absolutePath) ? spec.absolutePath : `missing ${spec.absolutePath}`,
      ),
    );
  }

  for (const envName of requiredEnv) {
    const present = Boolean(process.env[envName]);
    checks.push(createCheck(`env:${envName}`, present, present ? "present" : "missing"));
  }

  for (const tool of requiredTools) {
    const present = commandExists(tool);
    checks.push(createCheck(`tool:${tool}`, present, present ? "available" : "not found on PATH"));
  }

  // ── CEP icon files ────────────────────────────────────────────────────────
  // Non-blocking — warns when icons appear to be missing so the extension
  // shows a blank tile in the CC app, but doesn't stop the dev workflow.
  if (fileExists(config.absolute.source)) {
    const iconDirs = [
      joinPath(config.absolute.source, "CSXS", "icons"),
      joinPath(config.absolute.source, "CSXS"),
      joinPath(config.absolute.root, "CSXS", "icons"),
    ];

    const iconDir = iconDirs.find(d => fileExists(d));
    if (!iconDir) {
      checks.push(createCheck(
        "icons.directory",
        true, // non-blocking — warn only
        "no CSXS/icons directory found (extension may show blank icon in CC panel)",
      ));
    } else {
      let pngFiles = [];
      try { pngFiles = listFilesRecursive(iconDir).filter(f => f.toLowerCase().endsWith(".png")); } catch { /* skip */ }
      checks.push(createCheck(
        "icons.directory",
        true, // non-blocking — icon absence is cosmetic, not functional
        pngFiles.length > 0
          ? `${pngFiles.length} icon file(s) found`
          : `CSXS/icons exists but contains no PNG files — CC panel will show blank icon`,
      ));
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    message: checks.every((check) => check.ok) ? "Environment diagnostics passed." : "Environment diagnostics failed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
  };
}
