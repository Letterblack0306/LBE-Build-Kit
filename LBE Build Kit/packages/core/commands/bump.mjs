function bumpVersion(current, type) {
  const parts = String(current).split(".").map((p) => Number.parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  const [major, minor, patch] = parts;
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeVersionToSpec(spec, newVersion, deps) {
  const { readText, writeText, readJson, writeJson } = deps;

  if (spec.kind === "manifest") {
    const xml = readText(spec.absolutePath);
    const updated = xml.replace(/(ExtensionBundleVersion=")[^"]+(")/g, `$1${newVersion}$2`);
    writeText(spec.absolutePath, updated);
    return;
  }

  if (spec.kind === "uxp-manifest") {
    const json = readJson(spec.absolutePath);
    json.version = newVersion;
    writeJson(spec.absolutePath, json);
    return;
  }

  if (spec.kind === "regex" && spec.pattern) {
    const text = readText(spec.absolutePath);
    const regex = new RegExp(spec.pattern);
    const match = regex.exec(text);
    if (!match || match[1] === undefined) {
      throw new Error(`Pattern ${spec.pattern} did not capture a version in ${spec.path}`);
    }
    const captureStart = match.index + match[0].indexOf(match[1]);
    const updated = text.slice(0, captureStart) + newVersion + text.slice(captureStart + match[1].length);
    writeText(spec.absolutePath, updated);
    return;
  }

  // JSON (default)
  const json = readJson(spec.absolutePath);
  const field = spec.field ?? "version";
  json[field] = newVersion;
  writeJson(spec.absolutePath, json);
}

export function runBump(config, options = {}, deps) {
  const { createCheck, readJson, readText, readManifestInfo, writeText, writeJson } = deps;
  const checks = [];
  const type = options.type ?? "patch";

  if (!["major", "minor", "patch"].includes(type)) {
    return {
      ok: false,
      message: `Invalid bump type: "${type}". Use: major | minor | patch`,
      checks: [createCheck("bump.type", false, `invalid bump type: ${type}`)],
      artifacts: [],
      version: null,
    };
  }

  const specs = config.absolute.versionFiles;
  if (specs.length === 0) {
    return {
      ok: false,
      message: "No versioning.files configured.",
      checks: [createCheck("bump.source", false, "no versioning.files in config")],
      artifacts: [],
      version: null,
    };
  }

  // Read current canonical version (prefer package.json, then first readable)
  let currentVersion = null;
  const canonical = specs.find((s) => s.path === "package.json") ?? specs[0];
  const ordered = canonical ? [canonical, ...specs.filter((s) => s !== canonical)] : specs;

  for (const spec of ordered) {
    try {
      if (spec.kind === "manifest") {
        currentVersion = readManifestInfo(spec.absolutePath).bundleVersion;
      } else if (spec.kind === "uxp-manifest") {
        currentVersion = readManifestInfo(spec.absolutePath).bundleVersion;
      } else if (spec.kind === "regex" && spec.pattern) {
        const match = readText(spec.absolutePath).match(new RegExp(spec.pattern));
        currentVersion = match ? match[1] : null;
      } else {
        currentVersion = readJson(spec.absolutePath)[spec.field ?? "version"];
      }
      if (currentVersion) break;
    } catch {
      // try next
    }
  }

  if (!currentVersion) {
    return {
      ok: false,
      message: "Could not read current version from any configured versioning file.",
      checks: [createCheck("bump.read", false, "version unreadable from all configured files")],
      artifacts: [],
      version: null,
    };
  }

  const nextVersion = bumpVersion(currentVersion, type);
  checks.push(createCheck("bump.compute", true, `${currentVersion} → ${nextVersion} (${type})`));

  for (const spec of specs) {
    try {
      writeVersionToSpec(spec, nextVersion, { readText, writeText, readJson, writeJson });
      checks.push(createCheck(`bump.write:${spec.label}`, true, `updated to ${nextVersion}`));
    } catch (error) {
      checks.push(createCheck(
        `bump.write:${spec.label}`,
        false,
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    message: ok
      ? `Bumped ${currentVersion} → ${nextVersion}`
      : `Bump partially failed: ${currentVersion} → ${nextVersion}`,
    checks,
    artifacts: [],
    version: nextVersion,
  };
}
