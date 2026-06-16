import path from "node:path";
import { execSync } from "node:child_process";

const T = process.stdout.isTTY;
const G = s => T ? `\x1b[32m${s}\x1b[0m` : s;
const R = s => T ? `\x1b[31m${s}\x1b[0m` : s;
const Y = s => T ? `\x1b[33m${s}\x1b[0m` : s;
const D = s => T ? `\x1b[2m${s}\x1b[0m` : s;
const B = s => T ? `\x1b[1m${s}\x1b[0m` : s;
const CY = s => T ? `\x1b[36m${s}\x1b[0m` : s;

const BINARY_EXTS = new Set([
  ".zxp", ".exe", ".dmg", ".pkg", ".msi",
  ".p12", ".pfx", ".pem", ".key", ".cer", ".crt", ".der",
]);

function git(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", timeout: 8000 }) };
  } catch {
    return { ok: false, out: "" };
  }
}

function parseEnvKeys(text) {
  return text.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")[0].trim())
    .filter(Boolean);
}

function stepLine(name, ok, msg) {
  const icon = ok ? G("✓") : R("✗");
  console.log(`  ${icon} ${name.padEnd(18)} ${D(msg)}`);
}

export async function runPreflight(config, deps) {
  const { createCheck, fileExists, readText, runForbiddenPatternsCheck } = deps;
  const root = config.absolute.root;
  const srcPath = config.absolute.source;

  console.log(`\n${B(CY("▸"))} ${B("ext-build preflight")}\n`);

  const checks = [];

  // ── 1. workspace clean ────────────────────────────────────────────────────
  {
    const r = git("git status --porcelain", root);
    let c;
    if (!r.ok) {
      c = createCheck("workspace.clean", true, "git not available — skipped");
    } else {
      const lines = r.out.trim().split("\n").filter(Boolean);
      c = createCheck(
        "workspace.clean",
        lines.length === 0,
        lines.length === 0
          ? "working tree is clean"
          : `${lines.length} uncommitted change(s): ${lines.slice(0, 3).map(l => l.trim()).join(", ")}${lines.length > 3 ? ` … +${lines.length - 3} more` : ""}`,
      );
    }
    stepLine("workspace-clean", c.ok, c.message);
    checks.push(c);
  }

  // ── 2. no committed binaries ──────────────────────────────────────────────
  {
    const r = git("git ls-files", root);
    let c;
    if (!r.ok) {
      c = createCheck("git.no-committed-binaries", true, "git not available — skipped");
    } else {
      const found = r.out.split("\n")
        .map(f => f.trim()).filter(Boolean)
        .filter(f => BINARY_EXTS.has(path.extname(f).toLowerCase()));
      c = createCheck(
        "git.no-committed-binaries",
        found.length === 0,
        found.length === 0
          ? "no binary artifacts tracked in git"
          : `binary files tracked in git: ${found.slice(0, 5).join(", ")}${found.length > 5 ? ` … +${found.length - 5} more` : ""}`,
      );
    }
    stepLine("no-bin-commits", c.ok, c.message);
    checks.push(c);
  }

  // ── 3. .env parity ───────────────────────────────────────────────────────
  {
    const examplePath = path.join(root, ".env.example");
    const envPath = path.join(root, ".env");
    let c;
    if (!fileExists(examplePath)) {
      c = createCheck("env.parity", true, "no .env.example found — skipped");
    } else if (!fileExists(envPath)) {
      c = createCheck("env.parity", false, ".env.example exists but .env is missing");
    } else {
      const exampleKeys = parseEnvKeys(readText(examplePath));
      const actualKeys = new Set(parseEnvKeys(readText(envPath)));
      const missing = exampleKeys.filter(k => !actualKeys.has(k));
      c = createCheck(
        "env.parity",
        missing.length === 0,
        missing.length === 0
          ? `all ${exampleKeys.length} key(s) present in .env`
          : `missing from .env: ${missing.join(", ")}`,
      );
    }
    stepLine("env-parity", c.ok, c.message);
    checks.push(c);
  }

  // ── 4. extended secret scan ───────────────────────────────────────────────
  if (fileExists(srcPath) && runForbiddenPatternsCheck) {
    const patterns = [
      { name: "aws-access-key",     regex: "\\bAKIA[0-9A-Z]{16}\\b",                                      severity: "BLOCK" },
      { name: "stripe-secret",      regex: "\\bsk_(?:live|test)_[A-Za-z0-9]{24,}\\b",                    severity: "BLOCK" },
      { name: "slack-token",        regex: "\\bxox[baprs]-[A-Za-z0-9\\-]+\\b",                           severity: "BLOCK" },
      { name: "private-key-pem",    regex: "-----BEGIN (?:RSA |EC )?PRIVATE KEY-----",                    severity: "BLOCK" },
      { name: "hardcoded-password", regex: "(?:password|passwd|secret|api_key)\\s*=\\s*['\"][^'\"]{6,}['\"]", severity: "WARN_REVIEW" },
    ];
    const result = runForbiddenPatternsCheck(srcPath, patterns, deps);
    for (const c of result.checks) {
      const ok = c.ok;
      const icon = ok ? G("✓") : R("✗");
      // warnings keep ok=true but use yellow label
      const warnHint = ok && c.message.includes("warning") ? Y("⚠ ") : "";
      console.log(`  ${icon} ${"secret-scan".padEnd(18)} ${warnHint}${D(c.message)}`);
    }
    checks.push(...result.checks);
  }

  console.log("");

  const ok = checks.every(c => c.ok);
  if (!ok) console.log(`${R("▸ preflight failed")} — fix errors above before building\n`);

  return {
    ok,
    message: ok ? "Preflight checks passed." : "Preflight checks failed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
  };
}
