import path from "node:path";

// External URL patterns: anything http(s):// that isn't localhost or a known schema host
const URL_RE = /https?:\/\/[^\s"'`)\]>,\\]+/g;
const LOCAL_HOSTS   = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
const SCHEMA_HOSTS  = ["schema.org", "json-schema.org", "www.w3.org", "schemas.microsoft.com", "adobe.com/ns", "adobe.com/xdp"];

export function runCheck(config, deps) {
  const { createCheck, fileExists, runVersionSync, runManifestIdentityCheck, runForbiddenPatternsCheck,
          listFilesRecursive, fs } = deps;
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

  // ── 3. No hardcoded extension ID in source ───────────────────────────────
  const extId = config.identity?.extensionId;
  if (extId && fileExists(config.absolute.source) && listFilesRecursive && fs) {
    const escaped = extId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe    = new RegExp(`["'\`]${escaped}["'\`]`);
    const scanExts = new Set([".js", ".mjs", ".jsx", ".ts", ".html"]);
    const hits = [];
    for (const rel of listFilesRecursive(config.absolute.source)) {
      if (!scanExts.has(path.extname(rel).toLowerCase())) continue;
      let content = "";
      try { content = fs.readFileSync(path.join(config.absolute.source, rel), "utf8"); } catch { continue; }
      if (idRe.test(content)) hits.push(rel);
    }
    checks.push(createCheck(
      "source.no-hardcoded-id",
      hits.length === 0,
      hits.length === 0
        ? `extension ID not hardcoded in source`
        : `extension ID "${extId}" hardcoded as literal in: ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ` … +${hits.length - 3} more` : ""}`,
    ));
  }

  // ── 4. External links scan (WARN only — non-blocking) ────────────────────
  if (fileExists(config.absolute.source) && listFilesRecursive && fs) {
    const allowlist  = new Set(config.validation?.externalLinksAllowlist ?? []);
    const scanExts   = new Set([".js", ".mjs", ".jsx", ".html", ".htm"]);
    const found      = new Map(); // url → first file
    for (const rel of listFilesRecursive(config.absolute.source)) {
      if (!scanExts.has(path.extname(rel).toLowerCase())) continue;
      let content = "";
      try { content = fs.readFileSync(path.join(config.absolute.source, rel), "utf8"); } catch { continue; }
      for (const m of content.matchAll(URL_RE)) {
        const url = m[0].replace(/[.,;:)\]}>'"]+$/, "");
        if (LOCAL_HOSTS.some(h => url.includes(h))) continue;
        if (SCHEMA_HOSTS.some(h => url.includes(h))) continue;
        if (allowlist.has(url)) continue;
        if (!found.has(url)) found.set(url, rel);
      }
    }
    const urls = [...found.keys()];
    // ok: true — warnings don't fail the gate, but appear in the check list
    checks.push(createCheck(
      "source.external-links",
      true,
      urls.length === 0
        ? "no external URLs found in source"
        : `${urls.length} external URL(s) — review: ${urls.slice(0, 3).join(", ")}${urls.length > 3 ? ` … +${urls.length - 3} more` : ""}`,
    ));
    // Individual URL entries for JSON consumers / AI parsing
    for (const url of urls) {
      checks.push(createCheck(`external-link:${url}`, true, `found in ${found.get(url)}`));
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
