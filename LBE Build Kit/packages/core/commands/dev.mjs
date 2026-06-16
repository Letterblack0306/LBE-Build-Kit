import { runDoctor } from "./doctor.mjs";
import { runSync } from "./sync.mjs";
import { runDebug } from "./debug.mjs";

const T = process.stdout.isTTY;
const G = s => T ? `\x1b[32m${s}\x1b[0m` : s;
const R = s => T ? `\x1b[31m${s}\x1b[0m` : s;
const D = s => T ? `\x1b[2m${s}\x1b[0m` : s;
const B = s => T ? `\x1b[1m${s}\x1b[0m` : s;
const CY = s => T ? `\x1b[36m${s}\x1b[0m` : s;

function logStep(name, result) {
  const icon = result.ok ? G("✓") : R("✗");
  const info = (result.checks ?? []).filter(c => c.ok).map(c => c.message).join(" · ").slice(0, 72);
  console.log(`  ${icon} ${name.padEnd(10)} ${D(info)}`);
  for (const f of (result.checks ?? []).filter(c => !c.ok)) {
    console.log(`     ${R("└─")} ${f.name}: ${R(f.message)}`);
  }
}

export async function runDev(config, options = {}, deps) {
  const { createCheck, runConfiguredCommand, startStaticServer } = deps;

  // Watch mode suppresses the header — watch.mjs owns the outer narrative
  if (!options.watch) {
    console.log(`\n${B(CY("▸"))} ${B("ext-build dev")}\n`);
  }

  const allChecks = [];
  const pipeline = [];

  const bail = (r) => {
    console.log(`\n${R("▸ stopped")} — ${r.message ?? "setup failed"}\n`);
    return { ok: false, message: r.message ?? "Dev setup failed.", checks: allChecks, artifacts: [], diff: null, version: null, pipeline };
  };

  // Gate 1: environment
  const doctor = runDoctor(config, deps);
  logStep("doctor", doctor);
  allChecks.push(...doctor.checks);
  pipeline.push({ step: "doctor", ok: doctor.ok, message: doctor.message ?? null });
  if (!doctor.ok) return bail(doctor);

  // Gate 2: build command (dist-live mode only)
  if (config.dev.liveMode === "dist-live" && config.dev.buildCommand) {
    let prepareOk, prepareMsg;
    if (options.dryRun) {
      prepareOk = true;
      prepareMsg = `dry-run: would run ${config.dev.buildCommand}`;
    } else {
      const built = runConfiguredCommand(config.dev.buildCommand, config.absolute.root);
      prepareOk = built.ok;
      prepareMsg = built.ok
        ? `ran ${config.dev.buildCommand}`
        : `build command failed: ${config.dev.buildCommand}`;
    }
    const prepareCheck = createCheck("dev.build-command", prepareOk, prepareMsg);
    logStep("build", { ok: prepareOk, checks: [prepareCheck] });
    allChecks.push(prepareCheck);
    pipeline.push({ step: "build", ok: prepareOk, message: prepareMsg });
    if (!prepareOk) return bail({ message: prepareMsg });
  }

  // Gate 3: sync source to CEP target
  const sync = runSync(config, options, deps);
  logStep("sync", sync);
  allChecks.push(...sync.checks);
  pipeline.push({ step: "sync", ok: sync.ok, message: sync.message ?? null });
  if (!sync.ok) return bail(sync);

  // Step 4: start debug server (non-fatal — debug can fail without blocking watch)
  const debug = runDebug(config, options, deps);
  logStep("debug", debug);
  allChecks.push(...debug.checks);
  pipeline.push({ step: "debug", ok: debug.ok, message: debug.message ?? null });

  // Optional: local static server
  let serverInfo = null;
  if (config.dev.localServer.enabled) {
    if (options.dryRun) {
      allChecks.push(createCheck("dev.local-server", true,
        `dry-run: would serve ${config.absolute.localServerRoot} on http://127.0.0.1:${config.dev.localServer.port}`));
    } else {
      const server = await startStaticServer(config.absolute.localServerRoot, config.dev.localServer.port, deps);
      serverInfo = { root: config.absolute.localServerRoot, url: `http://127.0.0.1:${config.dev.localServer.port}` };
      allChecks.push(createCheck("dev.local-server", true, serverInfo.url));
      if (!options.watch) server.close();
    }
  }

  return {
    ok: allChecks.every(c => c.ok),
    message: options.dryRun ? "Dev workflow plan generated." : "Dev workflow ready.",
    checks: allChecks,
    artifacts: [],
    diff: null,
    version: null,
    pipeline,
    browserUrl: debug.browserUrl,
    targetPath: sync.targetPath,
    server: serverInfo,
  };
}
