#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE, loadConfig as loadCoreConfig } from "./packages/core/config/index.mjs";
import { parseArgs as parseCoreArgs, executeRoutedCommand } from "./packages/core/cli/router.mjs";
import { writeReport as writeCoreReport, printResult as printCoreResult } from "./packages/core/reporting/index.mjs";

import { runDoctor as runDoctorCommand } from "./packages/core/commands/doctor.mjs";
import { runCheck as runCheckCommand } from "./packages/core/commands/check.mjs";
import { runDevVerify as runDevVerifyCommand } from "./packages/core/commands/dev-verify.mjs";
import { runVerify as runVerifyCommand } from "./packages/core/commands/verify.mjs";
import { runSync as runSyncCommand } from "./packages/core/commands/sync.mjs";
import { runDebug as runDebugCommand } from "./packages/core/commands/debug.mjs";
import { runReload as runReloadCommand } from "./packages/core/commands/reload.mjs";
import { runDev as runDevCommand } from "./packages/core/commands/dev.mjs";
import { runWatch as runWatchCommand } from "./packages/core/commands/watch.mjs";
import { runBuild as runBuildCommand } from "./packages/core/commands/build.mjs";
import { runPreflight as runPreflightCommand } from "./packages/core/commands/preflight.mjs";
import { runHygiene as runHygieneCommand } from "./packages/core/commands/hygiene.mjs";
import { runSignVerify as runSignVerifyCommand } from "./packages/core/commands/sign-verify.mjs";
import { runSimulate as runSimulateCommand } from "./packages/core/commands/simulate.mjs";
import { runRelease as runReleaseCommand } from "./packages/core/commands/release.mjs";
import { scaffoldProject } from "./packages/core/commands/init.mjs";
import { runBump as runBumpCommand } from "./packages/core/commands/bump.mjs";
import { runChangelog as runChangelogCommand } from "./packages/core/commands/changelog.mjs";
import { runES3Check as runES3CheckCommand } from "./packages/core/commands/es3-check.mjs";

import {
  runVersionSync as runCoreVersionSync,
  runManifestIdentityCheck as runCoreManifestIdentityCheck,
  runRequiredFilesCheck as runCoreRequiredFilesCheck,
  runForbiddenFilesCheck as runCoreForbiddenFilesCheck,
  collectArtifacts as collectCoreArtifacts,
  runBundleStructureCheck as runCoreBundleStructureCheck,
  resolveDistManifestPath as resolveCoreDistManifestPath,
  resolveLiveManifestPath as resolveCoreLiveManifestPath,
  runArtifactVersionChecks as runCoreArtifactVersionChecks,
  runForbiddenPatternsCheck as runCoreForbiddenPatternsCheck,
} from "./packages/core/validators/index.mjs";

import {
  toPosix,
  ensureDir,
  fileExists,
  readJson,
  readText,
  writeJson,
  writeText,
  slugifyPackageName,
  loadLocalTemplate,
  createCheck,
  renameCheck,
  matchesAnyPattern,
  listFilesRecursive,
  sha256File,
  readManifestInfo,
  renderTag,
  getGitMetadata,
  shouldExcludeSyncPath,
  copyDirectoryRecursive,
  detectReloadAction,
  openUrl,
  runConfiguredCommand,
  startStaticServer,
  isAtLeastVersion,
  commandExists,
  buildDebugFileContent,
  enablePlayerDebugMode,
  signContent,
  verifySignature,
} from "./packages/core/utils/index.mjs";

import {
  getCepExtensionsRoot,
  getWorkspaceSyncTargetPath,
} from "./packages/adapters/workspace-sync/index.mjs";

function printHelp() {
  const isTTY = process.stdout.isTTY;
  const B = s => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
  const D = s => isTTY ? `\x1b[2m${s}\x1b[0m` : s;
  const CY = s => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
  console.log(`
${B("ext-build")}  — CEP Extension Build Tool

${B("Primary commands:")}
  ${CY("ext-build init")}                scaffold a new project
  ${CY("ext-build dev")}                 start dev (doctor → sync → debug)
  ${CY("ext-build watch")}               dev + watch for changes  ${D("(runs until Ctrl+C)")}
  ${CY("ext-build build")}               production bundle (doctor → check → es3 → build → verify)

${B("Diagnostics:")}
  ${CY("ext-build doctor")}              check Node, paths, env, icons
  ${CY("ext-build check")}               validate manifest, version sync, external links
  ${CY("ext-build verify")}              verify build output
  ${CY("ext-build simulate")}            dry-run all checks without writing files
  ${CY("ext-build es3-check")}           scan ExtendScript files for ES3 violations
  ${CY("ext-build preflight")}           workspace clean + env parity + secret scan
  ${CY("ext-build hygiene")}             source hygiene + semver + changelog + external links
  ${CY("ext-build sign-verify")}         verify ZXP Adobe signature (post-sign)

${B("Versioning:")}
  ${CY("ext-build bump")} [patch|minor|major]
  ${CY("ext-build changelog")} [--since <tag>] [--output <file>]

${D("Flags:")}
  ${D("--json        machine-readable output  (AI / IDE bridge)")}
  ${D("--dry-run     plan only, no writes")}
  ${D("--cwd <path>  run from a different directory")}
`);
}

function getLiveSourceRoot(config) {
  return config.dev.liveMode === "dist-live" ? config.absolute.dist : config.absolute.devSource;
}

function getDevTargetPath(config, explicitTarget) {
  if (config.dev.liveMode === "workspace-sync") return getWorkspaceSyncTargetPath(config, explicitTarget);
  if (explicitTarget) return path.resolve(process.cwd(), explicitTarget);
  if (config.dev.targetDir) return path.resolve(config.absolute.root, config.dev.targetDir);
  if (config.dev.liveMode === "dist-live") return config.absolute.dist;
  return path.join(getCepExtensionsRoot(), config.dev.extensionId);
}

function getCoreCommandDeps() {
  return {
    createCheck, renameCheck, fileExists, readManifestInfo, readText, readJson, listFilesRecursive, matchesAnyPattern, sha256File, fs, isAtLeastVersion, commandExists, signContent, verifySignature,
    runVersionSync: runCoreVersionSync,
    runManifestIdentityCheck: runCoreManifestIdentityCheck,
    runConfiguredCommand, getLiveSourceRoot,
    runRequiredFilesCheck: runCoreRequiredFilesCheck,
    runForbiddenFilesCheck: runCoreForbiddenFilesCheck,
    runForbiddenPatternsCheck: runCoreForbiddenPatternsCheck,
    resolveLiveManifestPath: resolveCoreLiveManifestPath,
    runArtifactVersionChecks: runCoreArtifactVersionChecks,
    collectArtifacts: collectCoreArtifacts,
    resolveDistManifestPath: resolveCoreDistManifestPath,
    runBundleStructureCheck: runCoreBundleStructureCheck,
    renderTag, getGitMetadata, resolvePath: path.resolve, getDevTargetPath, shouldExcludeSyncPath, copyDirectoryRecursive,
    joinPath: path.join, ensureDir, writeText, writeJson, buildDebugFileContent, enablePlayerDebugMode,
    openUrl, toPosix, detectReloadAction, startStaticServer,
    loadLocalTemplate, slugifyPackageName, CONFIG_FILE,
    watchFiles: (sourceRoot, callback) => {
      fs.watch(sourceRoot, { recursive: true }, (_eventType, fileName) => callback(fileName));
    }
  };
}

function getReportingDeps() {
  return { ensureDir, writeJson, writeText, getGitMetadata };
}

async function main() {
  const args = parseCoreArgs(process.argv.slice(2));
  const command = args._[0] ?? "help";
  if (args.cwd) process.chdir(args.cwd);

  if (command === "help" || args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  let result;
  let config = null;
  let reportRoot = process.cwd();

  try {
    if (command === "init") {
      result = scaffoldProject(args.target ?? args._[1], { liveMode: args.mode ?? null }, getCoreCommandDeps());
      reportRoot = result.reportRoot;
    } else {
      config = loadCoreConfig(process.cwd(), args.config);
      reportRoot = config.absolute.root;
      result = await executeRoutedCommand(command, {
        doctor:      () => runDoctorCommand(config, getCoreCommandDeps()),
        check:       () => runCheckCommand(config, getCoreCommandDeps()),
        verify:      () => runVerifyCommand(config, getCoreCommandDeps()),
        "dev-verify": () => runDevVerifyCommand(config, { dryRun: Boolean(args["dry-run"]) }, getCoreCommandDeps()),
        sync:        () => runSyncCommand(config, { target: args.target, dryRun: Boolean(args["dry-run"]) }, getCoreCommandDeps()),
        debug:       () => runDebugCommand(config, { target: args.target, dryRun: Boolean(args["dry-run"]), open: Boolean(args.open) }, getCoreCommandDeps()),
        reload:      () => runReloadCommand(config, { changed: args.changed ?? args._[1] ?? "" }, getCoreCommandDeps()),
        dev:         () => runDevCommand(config, { target: args.target, dryRun: Boolean(args["dry-run"]), open: Boolean(args.open) }, getCoreCommandDeps()),
        watch:       () => runWatchCommand(config, { target: args.target, dryRun: Boolean(args["dry-run"]), open: Boolean(args.open), once: Boolean(args.once), changed: args.changed ?? "" }, getCoreCommandDeps()),
        build:         () => runBuildCommand(config, { dryRun: Boolean(args["dry-run"]) }, getCoreCommandDeps()),
        preflight:     () => runPreflightCommand(config, getCoreCommandDeps()),
        hygiene:       () => runHygieneCommand(config, getCoreCommandDeps()),
        "sign-verify": () => runSignVerifyCommand(config, getCoreCommandDeps()),
        simulate:      () => runSimulateCommand(config, getCoreCommandDeps()),
        "es3-check": () => runES3CheckCommand(config, getCoreCommandDeps()),
        bump:        () => runBumpCommand(config, { type: args._[1] ?? "patch" }, getCoreCommandDeps()),
        changelog:   () => runChangelogCommand(config, {
          since: args.since,
          version: args._[1] ?? null,
          outputPath: args.output ?? null,
          dryRun: Boolean(args["dry-run"]),
        }, getCoreCommandDeps()),
        release: async () => {
          if (!process.env.CI && !args["allow-local-release"]) throw new Error("release is CI-only for now. Re-run with --allow-local-release to bypass.");
          return await runReleaseCommand(config, { dryRun: Boolean(args["dry-run"]), publish: Boolean(args.publish), reset: Boolean(args.reset) }, getCoreCommandDeps());
        },
      });
    }
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error), checks: [], artifacts: [], diff: null, version: null };
  }

  const finalResult = {
    command, configPath: config?.configPath ?? null, ok: result.ok, message: result.message, checks: result.checks, artifacts: result.artifacts, diff: result.diff, version: result.version,
    pipeline: result.pipeline ?? null,
    holdOpen: command === "watch" && !args.once && !args["dry-run"],
    reportDir: writeCoreReport(reportRoot, { command, ok: result.ok, message: result.message, checks: result.checks, artifacts: result.artifacts, diff: result.diff, version: result.version, git: result.git ?? null, config }, getReportingDeps()),
  };

  printCoreResult(finalResult, Boolean(args.json));
  if (finalResult.holdOpen) return;
  process.exit(finalResult.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("ERR ext-build");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
