export function runReleaseIntegrity(config, deps) {
  const {
    createCheck,
    runVersionSync,
    renderTag,
    getGitMetadata,
    fileExists,
    runBundleStructureCheck,
    runArtifactVersionChecks,
    collectArtifacts,
  } = deps;

  const checks = [];
  const versionSync = runVersionSync(config, deps);
  checks.push(...versionSync.checks);

  const canonical = versionSync.version;
  const git = getGitMetadata(deps);
  const expectedTag = canonical ? renderTag(config.versioning.tagFormat, canonical, deps) : null;

  if (expectedTag) {
    if (git.tag) {
      checks.push(
        createCheck(
          "release.tag",
          git.tag === expectedTag,
          git.tag === expectedTag ? `tag ${git.tag}` : `expected ${expectedTag}, found ${git.tag}`,
        ),
      );
    } else if (config.release.tagRequired) {
      checks.push(createCheck("release.tag", false, `expected tag ${expectedTag} on current commit`));
    } else {
      checks.push(createCheck("release.tag", true, "no git tag on current commit; skipped"));
    }
  }

  const requiredArtifacts = config.release.requiredArtifacts ?? [];
  const missingArtifacts = requiredArtifacts.filter((entry) => !fileExists(deps.resolvePath(config.absolute.root, entry)));
  checks.push(
    createCheck(
      "release.required-artifacts",
      missingArtifacts.length === 0,
      missingArtifacts.length === 0 ? "all required release artifacts present" : `${missingArtifacts.length} required artifact(s) missing`,
      { missingArtifacts },
    ),
  );

  if (fileExists(config.absolute.dist)) {
    checks.push(runBundleStructureCheck(config, deps));
  }

  checks.push(...runArtifactVersionChecks(config.absolute.artifactVersionFiles, canonical, "release-artifact-version", deps));

  const artifacts = fileExists(config.absolute.dist) ? collectArtifacts(config.absolute.dist, deps) : [];
  return {
    ok: checks.every((check) => check.ok),
    message: checks.every((check) => check.ok)
      ? "Release integrity checks passed."
      : "Release integrity checks failed.",
    checks,
    artifacts,
    diff: null,
    version: canonical,
    git,
  };
}
