import path from "node:path";
import { execSync } from "node:child_process";

const T = process.stdout.isTTY;
const G = s => T ? `\x1b[32m${s}\x1b[0m` : s;
const R = s => T ? `\x1b[31m${s}\x1b[0m` : s;
const Y = s => T ? `\x1b[33m${s}\x1b[0m` : s;
const D = s => T ? `\x1b[2m${s}\x1b[0m` : s;
const B = s => T ? `\x1b[1m${s}\x1b[0m` : s;
const CY = s => T ? `\x1b[36m${s}\x1b[0m` : s;

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-([\w.]+))?(?:\+([\w.]+))?$/;

const JUNK_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".AppleDouble", ".LSOverride"]);
const JUNK_EXTS  = new Set([".log", ".tmp", ".bak", ".swp", ".swo"]);

// External URL patterns — anything https?:// that isn't local
const URL_RE = /https?:\/\/[^\s"'`)\]>,\\]+/g;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
const SCHEMA_HOSTS = ["schema.org", "json-schema.org", "www.w3.org", "schemas.microsoft.com", "adobe.com/ns", "adobe.com/xdp"];

function git(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", timeout: 8000 }) };
  } catch {
    return { ok: false, out: "" };
  }
}

function stepLine(name, ok, msg, warn = false) {
  const icon = ok ? (warn ? Y("⚠") : G("✓")) : R("✗");
  console.log(`  ${icon} ${name.padEnd(18)} ${D(msg)}`);
}

export async function runHygiene(config, deps) {
  const { createCheck, fileExists, readText, readJson, listFilesRecursive, fs } = deps;
  const root  = config.absolute.root;
  const src   = config.absolute.source;
  const allowlist = new Set(config.validation?.externalLinksAllowlist ?? []);

  console.log(`\n${B(CY("▸"))} ${B("ext-build hygiene")}\n`);

  const checks = [];

  // ── 1. source hygiene (junk files) ───────────────────────────────────────
  {
    const r = git("git ls-files", root);
    let c;
    if (!r.ok) {
      c = createCheck("source.hygiene", true, "git not available — scanned directory instead");
    } else {
      const junk = r.out.split("\n").map(f => f.trim()).filter(f => {
        const base = path.basename(f);
        const ext  = path.extname(f).toLowerCase();
        return JUNK_NAMES.has(base) || JUNK_EXTS.has(ext);
      });
      c = createCheck(
        "source.hygiene",
        junk.length === 0,
        junk.length === 0
          ? "no OS junk or temp files tracked in git"
          : `junk files tracked in git: ${junk.slice(0, 5).join(", ")}${junk.length > 5 ? ` … +${junk.length - 5} more` : ""}`,
      );
    }
    stepLine("source-hygiene", c.ok, c.message);
    checks.push(c);
  }

  // ── 2. version governance ─────────────────────────────────────────────────
  {
    let version = null;
    const pkgPath = path.join(root, "package.json");
    try { version = readJson(pkgPath)?.version ?? null; } catch { /* no package.json */ }

    const c = version == null
      ? createCheck("version.governance", true, "no package.json version — skipped")
      : createCheck(
          "version.governance",
          SEMVER_RE.test(version),
          SEMVER_RE.test(version)
            ? `${version} is valid semver`
            : `"${version}" is not valid semver (expected X.Y.Z)`,
        );
    stepLine("version-governance", c.ok, c.message);
    checks.push(c);

    // ── 3. changelog entry ───────────────────────────────────────────────────
    const changelogPath = path.join(root, "CHANGELOG.md");
    if (!fileExists(changelogPath)) {
      const cc = createCheck("changelog.exists", false, "CHANGELOG.md not found");
      stepLine("changelog-entry", cc.ok, cc.message);
      checks.push(cc);
    } else if (!version) {
      const cc = createCheck("changelog.entry", true, "no version available — skipped");
      stepLine("changelog-entry", cc.ok, cc.message);
      checks.push(cc);
    } else {
      const content = readText(changelogPath);
      const escaped = version.replace(/\./g, "\\.");
      const hasEntry = new RegExp(`## [\\[v]?${escaped}`, "m").test(content);
      const isStub   = hasEntry && /changelog-stub|_Release notes pending_/i.test(content);
      const cc = createCheck(
        "changelog.entry",
        hasEntry,
        hasEntry
          ? (isStub ? `v${version} entry found (stub — add real notes before release)` : `v${version} entry found`)
          : `no entry for v${version} in CHANGELOG.md`,
      );
      stepLine("changelog-entry", cc.ok, cc.message, isStub);
      checks.push(cc);
    }
  }

  // ── 4. no hardcoded extension ID ──────────────────────────────────────────
  {
    const extId = config.identity?.extensionId;
    if (!extId || !fileExists(src)) {
      const c = createCheck("source.no-hardcoded-id", true, !extId ? "no extensionId configured — skipped" : "source dir not found — skipped");
      stepLine("no-hardcoded-id", c.ok, c.message);
      checks.push(c);
    } else {
      const escaped = extId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const files = listFilesRecursive(src).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return [".js", ".mjs", ".jsx", ".ts", ".html"].includes(ext);
      });
      const hits = [];
      for (const rel of files) {
        const abs = path.join(src, rel);
        let content = "";
        try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
        if (new RegExp(`["'\`]${escaped}["'\`]`).test(content)) hits.push(rel);
      }
      const c = createCheck(
        "source.no-hardcoded-id",
        hits.length === 0,
        hits.length === 0
          ? `extension ID "${extId}" not hardcoded in source`
          : `extension ID hardcoded as string literal in: ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ` … +${hits.length - 3} more` : ""}`,
      );
      stepLine("no-hardcoded-id", c.ok, c.message);
      checks.push(c);
    }
  }

  // ── 5. external links scan ────────────────────────────────────────────────
  {
    if (!fileExists(src)) {
      const c = createCheck("source.external-links", true, "source dir not found — skipped");
      stepLine("external-links", c.ok, c.message);
      checks.push(c);
    } else {
      const found = new Map(); // url → first file
      const scanExts = new Set([".js", ".mjs", ".jsx", ".html", ".htm", ".css"]);
      const files = listFilesRecursive(src).filter(f => scanExts.has(path.extname(f).toLowerCase()));

      for (const rel of files) {
        const abs = path.join(src, rel);
        let content = "";
        try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
        const matches = [...content.matchAll(URL_RE)].map(m => m[0].replace(/[.,;:)\]}>'"]+$/, ""));
        for (const url of matches) {
          if (LOCAL_HOSTS.some(h => url.includes(h))) continue;
          if (SCHEMA_HOSTS.some(h => url.includes(h))) continue;
          if (allowlist.has(url)) continue;
          if (!found.has(url)) found.set(url, rel);
        }
      }

      const urls = [...found.keys()];
      // External links are WARN only — non-blocking (ok: true) but listed for review
      const c = createCheck(
        "source.external-links",
        true,
        urls.length === 0
          ? `no external URLs found in ${files.length} source file(s)`
          : `${urls.length} external URL(s) — review for hardcoding: ${urls.slice(0, 3).join(", ")}${urls.length > 3 ? ` … +${urls.length - 3} more` : ""}`,
      );
      stepLine("external-links", c.ok, c.message, urls.length > 0);
      // Emit individual URL checks so JSON consumers can see the full list
      const urlChecks = urls.map(url =>
        createCheck(`external-links:${url}`, true, `found in ${found.get(url)}`)
      );
      checks.push(c, ...urlChecks);
    }
  }

  console.log("");

  const ok = checks.filter(c => !c.name.startsWith("external-links:")).every(c => c.ok);
  if (!ok) console.log(`${R("▸ hygiene failed")} — fix errors above\n`);

  return {
    ok,
    message: ok ? "Hygiene checks passed." : "Hygiene checks failed.",
    checks,
    artifacts: [],
    diff: null,
    version: null,
  };
}
