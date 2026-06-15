import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { verifyWorkspaceSync } from "../../adapters/workspace-sync/index.mjs";
import { verifyDistLive } from "../../adapters/dist-live/index.mjs";

export async function runDevVerify(config, options = {}, deps) {
  const {
    createCheck,
    runConfiguredCommand,
  } = deps;

  const checks = [];
  const doctor = runDoctor(config, deps);
  const sourceCheck = runCheck(config, deps);
  let prepareCheck = null;

  if (config.dev.liveMode === "dist-live" && config.dev.buildCommand) {
    if (options.dryRun) {
      prepareCheck = createCheck("dev-verify.build-command", true, `dry-run: would run ${config.dev.buildCommand}`);
    } else {
      const build = runConfiguredCommand(config.dev.buildCommand, config.absolute.root);
      prepareCheck = createCheck(
        "dev-verify.build-command",
        build.ok,
        build.ok ? `ran ${config.dev.buildCommand}` : `build command failed: ${config.dev.buildCommand}`,
      );
    }
  }

  checks.push(...doctor.checks, ...sourceCheck.checks);
  if (prepareCheck) {
    checks.push(prepareCheck);
  }

  let adapterResult = { checks: [], artifacts: [] };
  if (config.dev.liveMode === "workspace-sync") {
    adapterResult = verifyWorkspaceSync(config, options, deps);
  } else if (config.dev.liveMode === "dist-live") {
    adapterResult = verifyDistLive(config, { ...options, canonicalVersion: sourceCheck.version }, deps);
  }

  checks.push(...adapterResult.checks);

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok ? "Active dev adapter verification passed." : "Active dev adapter verification failed.",
    checks,
    artifacts: adapterResult.artifacts,
    diff: null,
    version: sourceCheck.version,
  };
}
