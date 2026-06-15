import path from "node:path";

export function runCheck(config, deps) {
  const { createCheck, fileExists, runVersionSync, runManifestIdentityCheck, runForbiddenPatternsCheck } = deps;
  const checks = [];

  checks.push(
    createCheck(
      "config.paths.source",
      fileExists(config.absolute.source),
      fileExists(config.absolute.source)
        ? `source path found: ${config.paths.source}`
        : `missing source path: ${config.paths.source}`,
    ),
  );
  checks.push(
    createCheck(
      "config.paths.manifest",
      fileExists(config.absolute.manifest),
      fileExists(config.absolute.manifest)
        ? `manifest found: ${config.paths.manifest}`
        : `missing manifest: ${config.paths.manifest}`,
    ),
  );

  const versionSync = runVersionSync(config, deps);
  checks.push(...versionSync.checks);
  checks.push(runManifestIdentityCheck(config.absolute.manifest, config.identity.extensionId, deps));

  // ── GREEN GATES: SOURCE SECURITIES AND SCANS ───────────────────────────────
  if (fileExists(config.absolute.source) && runForbiddenPatternsCheck) {
    // 1. Unsafe Eval and EvalScript Check (gate-no-unsafe-eval)
    const evalPatterns = [
      { name: "no-unsafe-eval", regex: "\\beval\\s*\\(", severity: "BLOCK" },
      { name: "no-unsafe-evalscript", regex: "\\bevalScript\\s*\\(", severity: "BLOCK" },
    ];
    // Exclude adapter files or templates which must declare eval calls natively
    const srcPath = fileExists(path.join(config.absolute.root, "src"))
      ? path.join(config.absolute.root, "src")
      : config.absolute.source;

    if (fileExists(srcPath)) {
      const evalCheck = runForbiddenPatternsCheck(srcPath, evalPatterns, deps);
      checks.push(...evalCheck.checks);
    }

    // 2. Secret Scan Check (gate-secret-scan)
    const secretPatterns = [
      { name: "google-api-key", regex: "\\bAIza[0-9A-Za-z\\-_]{20,}\\b", severity: "BLOCK" },
      { name: "openai-api-key", regex: "\\bsk-[A-Za-z0-9\\-_]{16,}\\b", severity: "BLOCK" },
      { name: "anthropic-api-key", regex: "\\bsk-ant-[A-Za-z0-9\\-_]{16,}\\b", severity: "BLOCK" },
      { name: "github-token", regex: "\\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\\b", severity: "BLOCK" },
    ];
    if (fileExists(srcPath)) {
      const secretCheck = runForbiddenPatternsCheck(srcPath, secretPatterns, deps);
      checks.push(...secretCheck.checks);
    }
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok ? "Source configuration checks passed." : "One or more source checks failed.",
    checks,
    artifacts: [],
    diff: null,
    version: versionSync.version,
  };
}
