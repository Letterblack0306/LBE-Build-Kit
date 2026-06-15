import { runDev } from "./dev.mjs";
import { runSync } from "./sync.mjs";
import { runReload } from "./reload.mjs";

export async function runWatch(config, options = {}, deps) {
  const {
    toPosix,
    runConfiguredCommand,
    createCheck,
    watchFiles,
  } = deps;

  const initial = await runDev(config, { ...options, watch: true }, deps);
  const sourceRoot = config.absolute.devSource;

  if (options.once || options.dryRun) {
    const changed = options.changed
      ? String(options.changed)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const reload = runReload(config, { changed: changed.join(",") }, deps);
    return {
      ok: initial.ok && reload.ok,
      message: options.dryRun ? "Watch plan generated." : "Watch single-run completed.",
      checks: [...initial.checks, ...reload.checks],
      artifacts: [],
      diff: null,
      version: null,
    };
  }

  console.log(`Watching ${sourceRoot} ... Press Ctrl+C to stop.`);
  let pending = false;
  
  watchFiles(sourceRoot, async (fileName) => {
    if (!fileName || pending) {
      return;
    }

    pending = true;
    const relativePath = toPosix(fileName);
    const checks = [];

    if (config.dev.liveMode === "dist-live" && config.dev.buildCommand) {
      const build = runConfiguredCommand(config.dev.buildCommand, config.absolute.root);
      checks.push(
        createCheck(
          "watch.build-command",
          build.ok,
          build.ok ? `ran ${config.dev.buildCommand}` : `build command failed: ${config.dev.buildCommand}`,
        ),
      );
    }

    const sync = runSync(config, options, deps);
    const reload = runReload(config, { changed: relativePath }, deps);
    console.log(`[watch] ${relativePath}`);
    for (const check of [...checks, ...sync.checks, ...reload.checks]) {
      console.log(`[${check.ok ? "OK " : "ERR"}] ${check.name} - ${check.message}`);
    }
    pending = false;
  }, deps);

  return {
    ok: initial.ok,
    message: "Watch mode active.",
    checks: initial.checks,
    artifacts: [],
    diff: null,
    version: null,
  };
}
