import path from "node:path";

import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { runVerify } from "./verify.mjs";
import { runReleaseIntegrity } from "./integrity.mjs";
import { runChangelog, buildChangelogContent } from "./changelog.mjs";

import { runZxpPackage } from "../../adapters/zxp/index.mjs";
import { runInnoSetup } from "../../adapters/inno/index.mjs";
import { runDmgPackage } from "../../adapters/electron-dmg/index.mjs";
import { runGitHubReleaseAdapter } from "../../adapters/github-release/index.mjs";

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function relativeIfInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return toPosix(relative);
}

function buildReleaseNotes(config, version, git, stageArtifacts, adapterResults) {
  const lines = [
    `Project: ${config.project.name}`,
    `Extension ID: ${config.identity.extensionId}`,
    `Version: ${version ?? "unknown"}`,
    `Generated: ${new Date().toISOString()}`,
    `Branch: ${git?.branch ?? "unknown"}`,
    `Commit: ${git?.commit ?? "unknown"}`,
    `Tag: ${git?.tag ?? "none"}`,
    "",
    `Bundle files: ${stageArtifacts.length}`,
  ];

  for (const adapterResult of adapterResults) {
    const label = adapterResult.name;
    lines.push(`${label}: ${adapterResult.ok ? "ready" : "failed"}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function runRelease(config, options = {}, deps) {
  const {
    createCheck,
    ensureDir,
    fileExists,
    copyDirectoryRecursive,
    collectArtifacts,
    writeJson,
    writeText,
    resolvePath,
    joinPath,
    fs,
    signContent,
  } = deps;
  const checks = [];

  const doctor = runDoctor(config, deps);
  const check = runCheck(config, deps);
  const verify = await runVerify(config, deps);
  const integrity = runReleaseIntegrity(config, deps);
  checks.push(...doctor.checks, ...check.checks, ...verify.checks, ...integrity.checks);
  const preflightOk = doctor.ok && check.ok && verify.ok && integrity.ok;

  if (!preflightOk) {
    return {
      ok: false,
      message: "Release preflight failed. Fix environment or integrity errors first.",
      checks,
      artifacts: [],
      version: integrity.version || null
    };
  }

  const version = integrity.version ?? verify.version ?? check.version ?? null;
  const git = integrity.git ?? null;
  const stageRoot = resolvePath(config.absolute.root, config.release.outputDir ?? "release-out");
  const bundleDir = joinPath(stageRoot, "bundle");
  const adaptersDir = joinPath(stageRoot, "adapters");
  const manifestPath = joinPath(stageRoot, "release-manifest.json");
  const notesPath = joinPath(stageRoot, "release-notes.txt");
  const checksumsPath = joinPath(stageRoot, "checksums.sha256");

  const copyExcludes = new Set([
    ...(config.dev.syncExcludes ?? []),
    ".build-report",
    "release.iss",
    "temp-dist-live-smoke",
  ]);
  const stageRelative = relativeIfInside(config.absolute.dist, stageRoot);
  if (stageRelative) copyExcludes.add(stageRelative);

  if (options.dryRun) {
    checks.push(createCheck("release.stage.bundle", true, `dry-run: would stage bundle at ${bundleDir}`));
    checks.push(createCheck("release.stage.manifest", true, `dry-run: would write ${manifestPath}`));
    checks.push(createCheck("release.stage.notes", true, `dry-run: would write ${notesPath}`));
    checks.push(createCheck("release.stage.checksums", true, `dry-run: would write ${checksumsPath}`));
  } else {
    if (fileExists(stageRoot)) {
      fs.rmSync(stageRoot, { recursive: true, force: true });
    }

    ensureDir(bundleDir);
    ensureDir(adaptersDir);
    copyDirectoryRecursive(config.absolute.dist, bundleDir, [...copyExcludes]);
    checks.push(createCheck("release.stage.bundle", true, bundleDir, { excludes: [...copyExcludes] }));

    const bundleArtifacts = collectArtifacts(bundleDir, deps);
    writeText(
      checksumsPath,
      bundleArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join("\n").concat(bundleArtifacts.length > 0 ? "\n" : ""),
    );
    checks.push(createCheck("release.stage.checksums", true, checksumsPath));

    writeJson(manifestPath, {
      project: config.project,
      identity: config.identity,
      version,
      git,
      generatedAt: new Date().toISOString(),
      stageRoot: toPosix(path.relative(config.absolute.root, stageRoot)),
      bundleDir: toPosix(path.relative(stageRoot, bundleDir)),
      adaptersDir: toPosix(path.relative(stageRoot, adaptersDir)),
      bundleArtifacts,
    });
    checks.push(createCheck("release.stage.manifest", true, manifestPath));

    // Sign release manifest if secret is present
    const signSecret = process.env.EXT_BUILD_SIGN_SECRET;
    if (signSecret && signContent) {
      const manifestContent = fs.readFileSync(manifestPath, "utf8");
      const sig = signContent(manifestContent, signSecret);
      const sigPath = manifestPath.replace(/\.json$/, ".sig");
      writeText(sigPath, sig);
      checks.push(createCheck("release.stage.manifest.sig", true, sigPath));
    } else {
      checks.push(createCheck("release.stage.manifest.sig", true, "signing skipped: EXT_BUILD_SIGN_SECRET not set"));
    }

    writeText(notesPath, buildReleaseNotes(config, version, git, bundleArtifacts, []));
    checks.push(createCheck("release.stage.notes", true, notesPath));

    // Auto-generate changelog
    const changelogPath = joinPath(stageRoot, "CHANGELOG.md");
    const changelogResult = runChangelog(config, {
      version: version ?? "unreleased",
      outputPath: changelogPath,
      dryRun: false,
    }, deps);
    checks.push(...changelogResult.checks);
  }

  const adapterContext = {
    cwd: stageRoot,
    stageRoot,
    bundleDir,
    adaptersDir,
    version,
  };
  const adapterResults = [];

  if (config.release.adapters.zxp.enabled) {
    const zxp = runZxpPackage(config, options, adapterContext, deps);
    adapterResults.push({ name: "zxp", ok: zxp.ok });
    checks.push(...zxp.checks);
  }

  if (config.release.adapters.inno.enabled) {
    const inno = runInnoSetup(config, options, adapterContext, deps);
    adapterResults.push({ name: "inno", ok: inno.ok });
    checks.push(...inno.checks);
  }

  if (config.release.adapters.electronDmg.enabled) {
    const dmg = runDmgPackage(config, options, adapterContext, deps);
    adapterResults.push({ name: "electron-dmg", ok: dmg.ok });
    checks.push(...dmg.checks);
  }

  if (config.release.adapters.githubRelease.enabled) {
    if (options.publish) {
      const githubRelease = runGitHubReleaseAdapter(config, adapterContext, deps);
      adapterResults.push({ name: "github-release", ok: githubRelease.ok });
      checks.push(
        createCheck(
          "release.github-release",
          githubRelease.ok,
          githubRelease.ok ? "GitHub release adapter completed" : "GitHub release adapter failed",
        ),
      );
      checks.push(...githubRelease.checks);
    } else {
      checks.push(createCheck("release.github-release", true, "publish not requested; skipped"));
    }
  }

  if (!options.dryRun && fileExists(notesPath)) {
    const stageArtifacts = collectArtifacts(bundleDir, deps);
    writeText(notesPath, buildReleaseNotes(config, version, git, stageArtifacts, adapterResults));
  }

  const ok = checks.every(c => c.ok);
  const artifacts = !options.dryRun && fileExists(stageRoot) ? collectArtifacts(stageRoot, deps) : [];

  return {
    ok,
    message: ok ? "Production release artifacts generated successfully." : "Release packaging failed.",
    checks,
    artifacts,
    version,
    git,
    releaseDir: stageRoot,
  };
}
