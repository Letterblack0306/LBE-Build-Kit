import path from "node:path";

/**
 * GitHub Release adapter.
 *
 * Requires the GitHub CLI (`gh`) to be installed and authenticated.
 * Called only when `config.release.adapters.githubRelease.enabled = true`
 * and the release command is run with `--publish`.
 *
 * If an external command is configured in config, that command is used instead
 * of the built-in `gh release create` invocation.
 */
export function runGitHubReleaseAdapter(config, context, deps) {
  const {
    createCheck,
    runConfiguredCommand,
    commandExists,
    fileExists,
    fs,
    resolvePath,
    collectArtifacts,
    sha256File,
  } = deps;

  const adapterConfig = config.release.adapters.githubRelease;

  if (!adapterConfig?.enabled) {
    return {
      ok: true,
      checks: [createCheck("adapter.github-release", true, "adapter disabled")],
      artifacts: [],
    };
  }

  // If an explicit external command is configured, delegate to it
  if (adapterConfig.command) {
    const result = runConfiguredCommand(adapterConfig.command, context.cwd);
    const checks = [
      createCheck(
        "adapter.github-release",
        result.ok,
        result.ok ? `ran: ${adapterConfig.command}` : `command failed: ${adapterConfig.command}`,
      ),
    ];
    return { ok: result.ok, checks, artifacts: [] };
  }

  // Built-in: use GitHub CLI (`gh release create`)
  if (!commandExists("gh")) {
    return {
      ok: false,
      checks: [createCheck(
        "adapter.github-release",
        false,
        "gh CLI not found in PATH — install from https://cli.github.com or set adapters.githubRelease.command",
      )],
      artifacts: [],
    };
  }

  const version = context.version ?? "unreleased";
  const tag = `v${version}`;
  const notesFile = path.join(context.stageRoot, "release-notes.txt");
  const hasNotes = fileExists(notesFile);

  const ghArgs = ["release", "create", tag];
  if (hasNotes) {
    ghArgs.push("--notes-file", notesFile);
  } else {
    ghArgs.push("--generate-notes");
  }
  ghArgs.push("--title", `${config.project.name} ${tag}`);

  // Attach bundle artifacts if they exist
  const bundleArtifacts = fileExists(context.bundleDir)
    ? collectArtifacts(context.bundleDir, deps).map((a) => resolvePath(context.bundleDir, a.path))
    : [];

  const command = ["gh", ...ghArgs, ...bundleArtifacts].join(" ");
  const result = runConfiguredCommand(command, context.cwd);

  const checks = [
    createCheck(
      "adapter.github-release",
      result.ok,
      result.ok ? `GitHub release created: ${tag}` : `gh release create failed for tag ${tag}`,
    ),
  ];

  return {
    ok: result.ok,
    checks,
    artifacts: [],
  };
}
