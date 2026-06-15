import { runDoctor } from "./doctor.mjs";
import { runSync } from "./sync.mjs";
import { runDebug } from "./debug.mjs";

export async function runDev(config, options = {}, deps) {
  const {
    createCheck,
    runConfiguredCommand,
    startStaticServer,
  } = deps;

  const checks = [];
  const doctor = runDoctor(config, deps);
  let prepareCheck = null;

  if (config.dev.liveMode === "dist-live" && config.dev.buildCommand) {
    if (options.dryRun) {
      prepareCheck = createCheck("dev.build-command", true, `dry-run: would run ${config.dev.buildCommand}`);
    } else {
      const build = runConfiguredCommand(config.dev.buildCommand, config.absolute.root);
      prepareCheck = createCheck(
        "dev.build-command",
        build.ok,
        build.ok ? `ran ${config.dev.buildCommand}` : `build command failed: ${config.dev.buildCommand}`,
      );
    }
  }

  const sync = runSync(config, options, deps);
  const debug = runDebug(config, options, deps);

  checks.push(...doctor.checks);
  if (prepareCheck) {
    checks.push(prepareCheck);
  }
  checks.push(...sync.checks, ...debug.checks);

  let serverInfo = null;
  if (config.dev.localServer.enabled) {
    if (options.dryRun) {
      checks.push(
        createCheck(
          "dev.local-server",
          true,
          `dry-run: would serve ${config.absolute.localServerRoot} on http://127.0.0.1:${config.dev.localServer.port}`,
        ),
      );
    } else {
      const server = await startStaticServer(config.absolute.localServerRoot, config.dev.localServer.port, deps);
      serverInfo = {
        root: config.absolute.localServerRoot,
        url: `http://127.0.0.1:${config.dev.localServer.port}`,
      };
      checks.push(createCheck("dev.local-server", true, serverInfo.url));
      if (!options.watch) {
        server.close();
      }
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    message: options.dryRun ? "Dev workflow plan generated." : "Dev workflow ready.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
    browserUrl: debug.browserUrl,
    targetPath: sync.targetPath,
    server: serverInfo,
  };
}
