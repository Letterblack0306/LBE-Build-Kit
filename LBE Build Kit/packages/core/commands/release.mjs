import path from "node:path";
import { spawnSync } from "node:child_process";

import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { runVerify } from "./verify.mjs";
import { runReleaseIntegrity } from "./integrity.mjs";
import { runChangelog, buildChangelogContent } from "./changelog.mjs";

import { runZxpPackage } from "../../adapters/zxp/index.mjs";
import { runInnoSetup } from "../../adapters/inno/index.mjs";
import { runDmgPackage } from "../../adapters/electron-dmg/index.mjs";
import { runGitHubReleaseAdapter } from "../../adapters/github-release/index.mjs";

import {
  isReleaseLocked,
  setReleaseLock,
  markReleaseStep,
  checkReleasePrerequisites,
  resetReleaseLockAndState,
  readReleaseState,
} from "../controller/release-lock.mjs";

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function relativeIfInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return toPosix(relative);
}

function hasSeparateDist(config) {
  return path.resolve(config.absolute.source) !== path.resolve(config.absolute.dist);
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

function runGitCommand(args, cwd, timeoutMs = 30000) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs });
  if (res.signal === "SIGTERM" || (res.error && res.error.code === "ETIMEDOUT")) {
    return { timedOut: true };
  }
  if (res.status !== 0) {
    return null;
  }
  return res.stdout.trim();
}

function runReleaseGitChecks(config, deps, checks) {
  const { createCheck } = deps;
  const root = config.absolute.root;
  let ok = true;

  // 1. Detached HEAD Check
  const branchResult = runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (!branchResult) {
    checks.push(createCheck("release.git.detached", true, "Git not available or not inside repo; skipped"));
    return { ok: true, branch: null };
  }
  if (typeof branchResult === "object" && branchResult.timedOut) {
    checks.push(createCheck("release.git.detached", false, "Git branch check timed out"));
    return { ok: false, branch: null };
  }
  const branch = branchResult;

  if (branch === "HEAD") {
    checks.push(createCheck("release.git.detached", false, "Detached HEAD state detected — cannot release"));
    ok = false;
  } else {
    checks.push(createCheck("release.git.detached", true, `Not detached HEAD: current branch is ${branch}`));
  }

  // 2. Allowed Branch Check
  const allowedBranches = config.release?.allowedBranches ?? ["main"];
  const allowedPrefixes = config.release?.allowedBranchPrefixes ?? ["release/"];
  const isBranchAllowed = branch === "HEAD" || allowedBranches.includes(branch) || allowedPrefixes.some(p => branch.startsWith(p));
  if (!isBranchAllowed) {
    checks.push(
      createCheck(
        "release.git.branch",
        false,
        `Release from disallowed branch: ${branch}. Allowed: ${allowedBranches.join(", ")} or ${allowedPrefixes.join(", ")}*`
      )
    );
    ok = false;
  } else if (branch !== "HEAD") {
    checks.push(createCheck("release.git.branch", true, `Branch approved for release: ${branch}`));
  }

  // 3. Workspace Clean Check
  const status = runGitCommand(["status", "--short"], root);
  if (typeof status === "object" && status.timedOut) {
    checks.push(createCheck("release.git.clean", false, "Git workspace status check timed out"));
    ok = false;
  } else if (status && status.length > 0) {
    checks.push(createCheck("release.git.clean", false, `Workspace is not clean:\n${status}`));
    ok = false;
  } else {
    checks.push(createCheck("release.git.clean", true, "Workspace clean"));
  }

  // 4. Remote Sync Check
  try {
    spawnSync("git", ["fetch", "origin", "--quiet"], { cwd: root, timeout: 30000 });
  } catch (_) {}
  const syncStatus = runGitCommand(["status", "-sb"], root);
  if (typeof syncStatus === "object" && syncStatus.timedOut) {
    checks.push(createCheck("release.git.sync", false, "Git sync status check timed out"));
    ok = false;
  } else if (syncStatus && (syncStatus.includes("ahead") || syncStatus.includes("behind") || syncStatus.includes("diverged"))) {
    checks.push(createCheck("release.git.sync", false, `Branch not synced with remote:\n${syncStatus}`));
    ok = false;
  } else {
    checks.push(createCheck("release.git.sync", true, "Branch synced with origin"));
  }

  // 5. HEAD Matches Origin Check
  if (branch !== "HEAD" && isBranchAllowed) {
    const localSha = runGitCommand(["rev-parse", "HEAD"], root);
    const remoteSha = runGitCommand(["rev-parse", `origin/${branch}`], root);
    if ((typeof localSha === "object" && localSha.timedOut) || (typeof remoteSha === "object" && remoteSha.timedOut)) {
      checks.push(createCheck("release.git.head-match", false, "Git HEAD comparison timed out"));
      ok = false;
    } else if (localSha && remoteSha && localSha !== remoteSha) {
      checks.push(createCheck("release.git.head-match", false, "Local HEAD does not match remote branch tip"));
      ok = false;
    } else {
      checks.push(createCheck("release.git.head-match", true, "HEAD matches remote"));
    }
  }

  // 6. Dist Not Tracked Check
  const trackedDist = runGitCommand(["ls-files", "dist"], root);
  const stagedDist = runGitCommand(["diff", "--cached", "--name-only"], root) || "";
  if ((typeof trackedDist === "object" && trackedDist.timedOut) || (typeof stagedDist === "object" && stagedDist.timedOut)) {
    checks.push(createCheck("release.git.dist-policy", false, "Git dist policy check timed out"));
    ok = false;
  } else if ((trackedDist && trackedDist.length > 0) || stagedDist.includes("dist/")) {
    checks.push(createCheck("release.git.dist-policy", false, "dist/ directory is tracked or staged in Git. Clean Git index."));
    ok = false;
  } else {
    checks.push(createCheck("release.git.dist-policy", true, "dist/ is not tracked or staged in Git"));
  }

  return { ok, branch };
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
    runForbiddenPatternsCheck,
  } = deps;
  const checks = [];
  const root = config.absolute.root;

  // ── RELEASE LOCK OR RESET MECHANICS ─────────────────────────────────────────
  if (options.reset) {
    resetReleaseLockAndState(root);
    return {
      ok: true,
      message: "Release lock and state have been successfully reset.",
      checks: [createCheck("release.lock.reset", true, "Release lock and state reset requested and completed.")],
      artifacts: [],
      version: null,
    };
  }

  if (isReleaseLocked(root)) {
    const previousState = readReleaseState(root);
    return {
      ok: false,
      message: "Release execution is locked. A previous validation check or release step failed. Fix issues and run 'npm run release --reset' to unlock.",
      checks: [createCheck("release.lock", false, `Lock is active. Previous states: ${JSON.stringify(previousState)}`)],
      artifacts: [],
      version: null,
    };
  }

  // Lock fail-closed at start of checks
  setReleaseLock(root, true);

  try {
    // ── STEP 1: GIT PRE-FLIGHT VERIFICATIONS ──────────────────────────────────
    const gitVerification = runReleaseGitChecks(config, deps, checks);
    if (!gitVerification.ok) {
      markReleaseStep(root, "git-preflight", "FAIL");
      return {
        ok: false,
        message: "Git preflight assertions failed. Branch rules, sync status, or unstaged dist files are violating release controls.",
        checks,
        artifacts: [],
        version: null,
      };
    }
    markReleaseStep(root, "git-preflight", "PASS");

    // ── STEP 2: FRAMEWORK SANITY GATES (DOCTOR / CHECK / VERIFY / INTEGRITY) ──
    const doctor = runDoctor(config, deps);
    const check = runCheck(config, deps);
    const verify = await runVerify(config, deps);
    const integrity = runReleaseIntegrity(config, deps);
    checks.push(...doctor.checks, ...check.checks, ...verify.checks, ...integrity.checks);

    const preflightOk = doctor.ok && check.ok && verify.ok && integrity.ok;
    if (!preflightOk) {
      markReleaseStep(root, "preflight-checks", "FAIL");
      return {
        ok: false,
        message: "Framework preflight diagnostics failed. Run 'npm run check' or 'npm run doctor' directly to troubleshoot.",
        checks,
        artifacts: [],
        version: integrity.version || null,
      };
    }
    markReleaseStep(root, "preflight-checks", "PASS");

    const version = integrity.version ?? verify.version ?? check.version ?? null;
    const git = integrity.git ?? null;

    if (!options.dryRun && !hasSeparateDist(config)) {
      checks.push(
        createCheck(
          "release.paths.dist",
          false,
          `paths.dist ("${config.paths.dist}") resolves to the same directory as paths.source ("${config.paths.source}"). Use a separate output folder before producing release artifacts.`,
        ),
      );
      markReleaseStep(root, "path-policy", "FAIL");
      return {
        ok: false,
        message: "Release artifact staging requires paths.dist to be separate from paths.source.",
        checks,
        artifacts: [],
        version,
        git,
      };
    }
    markReleaseStep(root, "path-policy", "PASS");

    // ── STEP 3: SOURCE CONTENT FORBIDDEN PATTERNS SCAN ────────────────────────
    const forbiddenPatterns = config.release?.forbiddenPatterns ?? [
      { name: "no-unsafe-eval", regex: "\\beval\\s*\\(", severity: "BLOCK" },
      { name: "no-hardcoded-local-paths", regex: "[A-Za-z]:\\\\(?!node_modules)", severity: "BLOCK" },
      { name: "secret-google-api-key", regex: "AIza[0-9A-Za-z\\-_]{35}", severity: "BLOCK" },
      { name: "secret-openai-key", regex: "sk-[A-Za-z0-9]{20,}", severity: "BLOCK" },
      { name: "secret-anthropic-key", regex: "sk-ant-[A-Za-z0-9\\-_]{20,}", severity: "BLOCK" },
      { name: "secret-github-token", regex: "gh[pousr]_[A-Za-z0-9]{36,}", severity: "BLOCK" },
    ];
    if (runForbiddenPatternsCheck) {
      const scanResult = runForbiddenPatternsCheck(config.absolute.source, forbiddenPatterns, deps);
      checks.push(...scanResult.checks);
      if (!scanResult.ok) {
        markReleaseStep(root, "content-scan", "FAIL");
        return {
          ok: false,
          message: "Forbidden patterns (such as unsafe evals or absolute paths) were detected in the source code.",
          checks,
          artifacts: [],
          version,
        };
      }
    }
    markReleaseStep(root, "content-scan", "PASS");

    // ── STEP 4: STAGING BUNDLE & MANIFEST GENERATION ──────────────────────────
    const stageRoot = resolvePath(root, config.release.outputDir ?? "release-out");
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
        stageRoot: toPosix(path.relative(root, stageRoot)),
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
    markReleaseStep(root, "staging", "PASS");

    // ── STEP 5: INTEGRATION ADAPTER RUNS ──────────────────────────────────────
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

    markReleaseStep(root, "packaging", "PASS");

    const ok = checks.every(c => c.ok);
    const artifacts = !options.dryRun && fileExists(stageRoot) ? collectArtifacts(stageRoot, deps) : [];

    if (ok && !options.dryRun) {
      // ── STEP 6: EVIDENCE & FINALIZATION ─────────────────────────────────────
      const reportLines = [
        "=========================================",
        "         RELEASE EVIDENCE REPORT         ",
        "=========================================",
        `Generated: ${new Date().toISOString()}`,
        `Branch: ${gitVerification.branch ?? "unknown"}`,
        `Commit: ${git?.commit ?? "unknown"}`,
        `Tag: ${git?.tag ?? "none"}`,
        "",
        "CHECKPOINT RESULTS:",
      ];

      for (const check of checks) {
        reportLines.push(`  [${check.ok ? "PASS" : "FAIL"}] ${check.name}: ${check.message}`);
      }

      reportLines.push("", "GENERATED ARTIFACTS:");
      for (const art of artifacts) {
        reportLines.push(`  - ${art.path} (size: ${art.size} bytes, sha256: ${art.sha256})`);
      }

      reportLines.push("", "FINAL VERDICT: PASS");

      const reportPath = path.join(root, ".build-report", "release-evidence-report.txt");
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, reportLines.join("\n") + "\n", "utf8");

      checks.push(createCheck("release.evidence-report", true, `Evidence report written to ${reportPath}`));
      markReleaseStep(root, "finalize", "PASS");

      // Successful release: unlock repo and reset states
      setReleaseLock(root, false);
      resetReleaseLockAndState(root);
    } else {
      // Failed during packaging steps
      setReleaseLock(root, true);
    }

    return {
      ok,
      message: ok ? "Production release artifacts generated successfully." : "Release packaging failed.",
      checks,
      artifacts,
      version,
      git,
      releaseDir: stageRoot,
    };

  } catch (error) {
    // Fatal unexpected crash
    setReleaseLock(root, true);
    return {
      ok: false,
      message: `Fatal error in release pipeline: ${error instanceof Error ? error.message : String(error)}`,
      checks: [
        ...checks,
        createCheck("release.fatal-exception", false, error instanceof Error ? error.stack : String(error))
      ],
      artifacts: [],
      version: null,
    };
  }
}
