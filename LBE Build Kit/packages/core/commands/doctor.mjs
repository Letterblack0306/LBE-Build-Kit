export function runDoctor(config, deps) {
  const { createCheck, isAtLeastVersion, fileExists, commandExists } = deps;
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

  return {
    ok: checks.every((check) => check.ok),
    message: checks.every((check) => check.ok) ? "Environment diagnostics passed." : "Environment diagnostics failed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
  };
}
