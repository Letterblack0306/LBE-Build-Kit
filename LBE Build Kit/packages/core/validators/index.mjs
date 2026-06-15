import path from "node:path";

export function readVersionFromSpec(spec, deps) {
  const { readManifestInfo, readText, readJson } = deps;

  if (spec.kind === "manifest" || spec.kind === "uxp-manifest") {
    return readManifestInfo(spec.absolutePath).bundleVersion;
  }

  if (spec.kind === "regex" && spec.pattern) {
    const match = readText(spec.absolutePath).match(new RegExp(spec.pattern));
    return match ? match[1] : null;
  }

  return readJson(spec.absolutePath)[spec.field ?? "version"];
}

export function runVersionSync(config, deps) {
  const { createCheck } = deps;
  const versions = config.absolute.versionFiles.map((spec) => {
    try {
      return {
        spec,
        value: readVersionFromSpec(spec, deps),
      };
    } catch (error) {
      return {
        spec,
        error: error instanceof Error ? error.message : String(error),
        value: null,
      };
    }
  });

  const canonical =
    versions.find((entry) => entry.spec.path === "package.json" && entry.value)?.value ??
    versions.find((entry) => entry.value)?.value ??
    null;

  const checks = versions.map((entry) => {
    if (entry.error) {
      return createCheck(`version-sync:${entry.spec.label}`, false, entry.error);
    }

    if (!entry.value) {
      return createCheck(`version-sync:${entry.spec.label}`, false, "version value could not be read");
    }

    const ok = canonical !== null && entry.value === canonical;
    return createCheck(
      `version-sync:${entry.spec.label}`,
      ok,
      ok ? `version ${entry.value}` : `expected ${canonical ?? "unknown"}, found ${entry.value}`,
    );
  });

  return { checks, version: canonical };
}

export function runManifestIdentityCheck(manifestPath, expectedExtensionId, deps) {
  const { createCheck, readManifestInfo } = deps;
  const info = readManifestInfo(manifestPath);

  if (!info.exists) {
    return createCheck("manifest.identity", false, `manifest not found: ${manifestPath}`);
  }

  const ok = info.bundleId === expectedExtensionId || info.extensionIds.includes(expectedExtensionId);
  return createCheck(
    "manifest.identity",
    ok,
    ok
      ? `manifest identity matches ${expectedExtensionId}`
      : `expected ${expectedExtensionId}, found bundleId=${info.bundleId ?? "missing"}`,
    info,
  );
}

export function runRequiredFilesCheck(baseDir, requiredFiles, deps) {
  const { createCheck, fileExists } = deps;
  const missing = requiredFiles.filter((relativePath) => !fileExists(path.join(baseDir, relativePath)));
  return {
    check: createCheck(
      "required-files",
      missing.length === 0,
      missing.length === 0 ? "all required files present" : `${missing.length} required file(s) missing`,
      { missing },
    ),
    missing,
  };
}

export function runForbiddenFilesCheck(baseDir, forbiddenPatterns, deps) {
  const { createCheck, fileExists, listFilesRecursive, matchesAnyPattern } = deps;
  if (!fileExists(baseDir)) {
    return {
      check: createCheck("forbidden-files", false, `path not found: ${baseDir}`),
      matches: [],
    };
  }

  const matches = listFilesRecursive(baseDir).filter((file) => matchesAnyPattern(file, forbiddenPatterns));
  return {
    check: createCheck(
      "forbidden-files",
      matches.length === 0,
      matches.length === 0 ? "no forbidden files found" : `${matches.length} forbidden file(s) found`,
      { matches },
    ),
    matches,
  };
}

export function collectArtifacts(baseDir, deps) {
  const { listFilesRecursive, fs, sha256File } = deps;
  return listFilesRecursive(baseDir).map((relativePath) => {
    const absolutePath = path.join(baseDir, relativePath);
    const stat = fs.statSync(absolutePath);
    return {
      path: relativePath,
      size: stat.size,
      sha256: sha256File(absolutePath),
    };
  });
}

export function runBundleStructureCheck(config, deps) {
  const { createCheck, fileExists, fs } = deps;
  const requiredFiles = config.release.bundle?.requiredFiles ?? [];
  const requiredDirectories = config.release.bundle?.requiredDirectories ?? [];
  const missingFiles = requiredFiles.filter((entry) => !fileExists(path.join(config.absolute.dist, entry)));
  const missingDirectories = requiredDirectories.filter((entry) => {
    const absolutePath = path.join(config.absolute.dist, entry);
    return !(fileExists(absolutePath) && fs.statSync(absolutePath).isDirectory());
  });

  return createCheck(
    "bundle-structure",
    missingFiles.length === 0 && missingDirectories.length === 0,
    missingFiles.length === 0 && missingDirectories.length === 0
      ? "bundle structure matches config"
      : "bundle structure is missing required files or directories",
    { missingFiles, missingDirectories },
  );
}

export function resolveDistManifestPath(config, deps) {
  const { fileExists } = deps;
  const relative = path.relative(config.absolute.source, config.absolute.manifest);
  const candidate = path.join(config.absolute.dist, relative);
  if (fileExists(candidate)) {
    return candidate;
  }
  return path.join(config.absolute.dist, "CSXS", "manifest.xml");
}

export function resolveLiveManifestPath(config, liveRoot) {
  const relative = path.relative(config.absolute.devSource, config.absolute.manifest);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return path.join(liveRoot, relative);
  }

  return path.join(liveRoot, "CSXS", "manifest.xml");
}

export function runArtifactVersionChecks(specs, canonicalVersion, namePrefix, deps) {
  const { createCheck } = deps;
  const checks = [];

  for (const spec of specs) {
    try {
      const value = readVersionFromSpec(spec, deps);
      const ok = Boolean(canonicalVersion) && value === canonicalVersion;
      checks.push(
        createCheck(
          `${namePrefix}:${spec.label}`,
          ok,
          ok ? `version ${value}` : `expected ${canonicalVersion ?? "unknown"}, found ${value ?? "missing"}`,
        ),
      );
    } catch (error) {
      checks.push(
        createCheck(
          `${namePrefix}:${spec.label}`,
          false,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  return checks;
}

export function runForbiddenPatternsCheck(baseDir, forbiddenPatterns, deps) {
  const { createCheck, fileExists, listFilesRecursive, fs } = deps;
  if (!fileExists(baseDir)) {
    return {
      checks: [createCheck("forbidden-patterns", true, `directory not found: ${baseDir}; skipped`)],
      findings: []
    };
  }

  const checks = [];
  const findings = [];

  const files = listFilesRecursive(baseDir).filter((file) => {
    const parts = file.split("/");
    return !parts.some(
      (p) =>
        p === "node_modules" ||
        p === ".git" ||
        p === ".build-report" ||
        p === "dist" ||
        p === "release-out" ||
        p === "temp-dist-live-smoke" ||
        p === "dev-target"
    );
  });

  for (const relativePath of files) {
    const ext = path.extname(relativePath).toLowerCase();
    if (ext !== ".js" && ext !== ".jsx" && ext !== ".mjs" && ext !== ".cjs" && ext !== ".html" && ext !== ".xml") {
      continue;
    }

    const absolutePath = path.join(baseDir, relativePath);
    let content = "";
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    for (const pattern of forbiddenPatterns) {
      const re = new RegExp(pattern.regex, "g");
      re.lastIndex = 0;
      if (re.test(content)) {
        findings.push({
          file: relativePath,
          patternName: pattern.name,
          severity: pattern.severity || "BLOCK"
        });
      }
    }
  }

  const blockFindings = findings.filter(f => f.severity === "BLOCK");
  const warnFindings = findings.filter(f => f.severity === "WARN_REVIEW" || f.severity === "WARN");

  if (blockFindings.length > 0) {
    checks.push(
      createCheck(
        "forbidden-patterns.block",
        false,
        `${blockFindings.length} blocking pattern(s) detected in source code.`,
        { findings: blockFindings }
      )
    );
  } else {
    checks.push(createCheck("forbidden-patterns.block", true, "no blocking code patterns found"));
  }

  if (warnFindings.length > 0) {
    checks.push(
      createCheck(
        "forbidden-patterns.warn",
        true,
        `${warnFindings.length} code warning(s) detected. Human review recommended.`,
        { findings: warnFindings }
      )
    );
  }

  return { checks, ok: blockFindings.length === 0, findings };
}
