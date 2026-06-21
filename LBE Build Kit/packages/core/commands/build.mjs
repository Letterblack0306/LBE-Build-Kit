import fs from "node:fs";
import path from "node:path";
import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { runES3Check } from "./es3-check.mjs";
import { runVerify } from "./verify.mjs";

const T = process.stdout.isTTY;
const G = s => T ? `\x1b[32m${s}\x1b[0m` : s;
const R = s => T ? `\x1b[31m${s}\x1b[0m` : s;
const D = s => T ? `\x1b[2m${s}\x1b[0m` : s;
const B = s => T ? `\x1b[1m${s}\x1b[0m` : s;
const CY = s => T ? `\x1b[36m${s}\x1b[0m` : s;

const DEFAULT_BUILD_EXCLUDES = new Set([
  ".git",
  ".build-report",
  ".gpt-sync",
  ".release-verify",
  "CI_FAILED_LOG.txt",
  "CI_BUILD_FAILED_LOG.txt",
  "CI_BUILD2_FAILED_LOG.txt",
  "dev-target",
  "node_modules",
  "release-dist",
  "release-out",
  "temp-dist-live-smoke",
]);

function logStep(name, result) {
  const icon = result.ok ? G("✓") : R("✗");
  const info = (result.checks ?? []).filter(c => c.ok).map(c => c.message).join(" · ").slice(0, 72);
  console.log(`  ${icon} ${name.padEnd(10)} ${D(info)}`);
  for (const f of (result.checks ?? []).filter(c => !c.ok)) {
    console.log(`     ${R("└─")} ${f.name}: ${R(f.message)}`);
  }
}

function runDefaultBuildCopy(sourceDir, distDir) {
  fs.mkdirSync(distDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (DEFAULT_BUILD_EXCLUDES.has(entry.name)) continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(distDir, entry.name);
    fs.cpSync(from, to, { recursive: true, force: true, errorOnExist: false });
  }
}

export async function runBuild(config, options = {}, deps) {
  const { createCheck, runConfiguredCommand } = deps;

  console.log(`\n${B(CY("▸"))} ${B("ext-build build")}\n`);

  const allChecks = [];
  const pipeline = [];

  const step = async (name, fn) => {
    const r = await Promise.resolve(fn());
    logStep(name, r);
    allChecks.push(...(r.checks ?? []));
    pipeline.push({ step: name, ok: r.ok, message: r.message ?? null });
    return r;
  };

  const bail = (msg) => {
    console.log(`\n${R("▸ stopped")} — ${msg}\n`);
    return { ok: false, message: msg, checks: allChecks, artifacts: [], diff: null, version: null, pipeline };
  };

  // Gate 1: environment check
  const doctor = await step("doctor", () => runDoctor(config, deps));
  if (!doctor.ok) return bail(doctor.message ?? "environment check failed");

  // Gate 2: project validation
  const check = await step("check", () => runCheck(config, deps));
  if (!check.ok) return bail(check.message ?? "project validation failed");

  // Gate 3: ExtendScript ES3 compatibility
  const es3 = await step("es3-check", () => runES3Check(config, deps));
  if (!es3.ok) return bail(es3.message ?? "ES3 compatibility check failed");

  // Gate 4a: dist must be clean before build (no stale artifact contamination)
  if (config.absolute.dist) {
    const { fileExists, listFilesRecursive } = deps;
    const distExists = fileExists(config.absolute.dist);
    let distFiles = [];
    if (distExists) {
      try { distFiles = listFilesRecursive(config.absolute.dist); } catch { /* non-fatal */ }
    }
    const distClean = !distExists || distFiles.length === 0;
    const distCheck = createCheck(
      "build.dist-pre-build",
      distClean,
      distClean
        ? "dist/ is clean — ready for fresh build"
        : `dist/ contains ${distFiles.length} stale file(s) — wipe dist/ before building to prevent artifact contamination`,
    );
    logStep("dist-pre-build", { ok: distCheck.ok, checks: [distCheck] });
    allChecks.push(distCheck);
    pipeline.push({ step: "dist-pre-build", ok: distCheck.ok, message: distCheck.message });
    if (!distCheck.ok) return bail(distCheck.message);
  }

  // Gate 4b: build command, or default source-to-dist staging when no project build command is configured
  if (config.dev?.buildCommand) {
    const built = options.dryRun
      ? { ok: true, stdout: "", stderr: "" }
      : runConfiguredCommand(config.dev.buildCommand, config.absolute.root);
    const msg = built.ok
      ? `ran: ${config.dev.buildCommand}`
      : `failed: ${config.dev.buildCommand}${built.stderr ? `\n${built.stderr}` : ""}`.trim();
    const bc = createCheck("build.command", built.ok, msg);
    logStep("build", { ok: built.ok, checks: [bc] });
    allChecks.push(bc);
    pipeline.push({ step: "build", ok: built.ok, message: msg });
    if (!built.ok) return bail(msg);
  } else if (config.absolute.source && config.absolute.dist) {
    let ok = true;
    let msg = `staged source into dist: ${config.absolute.dist}`;
    if (!options.dryRun) {
      try {
        runDefaultBuildCopy(config.absolute.source, config.absolute.dist);
      } catch (error) {
        ok = false;
        msg = `failed to stage source into dist: ${error?.message ?? error}`;
      }
    }
    const bc = createCheck("build.default-copy", ok, msg);
    logStep("build", { ok, checks: [bc] });
    allChecks.push(bc);
    pipeline.push({ step: "build", ok, message: msg });
    if (!ok) return bail(msg);
  }

  // Gate 5: verify build output
  const verify = await step("verify", () => runVerify(config, deps));
  if (!verify.ok) return bail(verify.message ?? "output verification failed");

  const ver = verify.version ? ` ${D("v" + verify.version)}` : "";
  console.log(`\n${G("▸ done")}${ver}\n`);

  return {
    ok: true,
    message: "Build complete.",
    checks: allChecks,
    artifacts: verify.artifacts ?? [],
    diff: null,
    version: verify.version ?? null,
    pipeline,
  };
}
