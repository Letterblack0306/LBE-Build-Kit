import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "ext-build.config.json";

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inferVersionSpec(entry) {
  if (typeof entry !== "string") {
    return {
      path: entry.path,
      kind: entry.kind ?? "json",
      field: entry.field ?? "version",
      label: entry.label ?? entry.path,
      pattern: entry.pattern ?? null,
      base: entry.base ?? "root",
    };
  }

  if (entry.toLowerCase().endsWith(".xml")) {
    return {
      path: entry,
      kind: "manifest",
      field: "ExtensionBundleVersion",
      label: entry,
      pattern: null,
      base: "root",
    };
  }

  // UXP manifest: JSON file whose name contains "manifest"
  if (/manifest[^/]*\.json$/i.test(entry)) {
    return {
      path: entry,
      kind: "uxp-manifest",
      field: "version",
      label: entry,
      pattern: null,
      base: "root",
    };
  }

  return {
    path: entry,
    kind: "json",
    field: "version",
    label: entry,
    pattern: null,
    base: "root",
  };
}

function resolveSpecPath(root, dist, spec) {
  const baseDir = spec.base === "dist" ? dist : root;
  return path.resolve(baseDir, spec.path);
}

export function normalizeConfig(rawConfig, configPath) {
  const root = path.dirname(configPath);
  const project = { ...(rawConfig.project ?? {}) };
  const identity = { ...(rawConfig.identity ?? {}) };
  const paths = { ...(rawConfig.paths ?? {}) };
  const versioning = { ...(rawConfig.versioning ?? {}) };
  const validation = { ...(rawConfig.validation ?? {}) };
  const release = { ...(rawConfig.release ?? {}) };
  const artifacts = { ...(rawConfig.artifacts ?? {}) };
  const dev = { ...(rawConfig.dev ?? {}) };

  if (!project.name && rawConfig.name) {
    project.name = rawConfig.name;
  }

  if (!identity.extensionId) {
    identity.extensionId = rawConfig.extensionId ?? rawConfig.bundleId ?? null;
  }

  paths.source = paths.source ?? rawConfig.sourcePath ?? "src";
  paths.dist = paths.dist ?? rawConfig.distPath ?? "dist";
  paths.manifest = paths.manifest ?? rawConfig.manifestPath ?? "src/CSXS/manifest.xml";

  validation.requiredFiles = validation.requiredFiles ?? rawConfig.requiredFiles ?? [];
  validation.forbiddenPatterns = validation.forbiddenPatterns ?? rawConfig.forbiddenPatterns ?? [];
  validation.requiredEnv = validation.requiredEnv ?? rawConfig.requiredEnv ?? [];
  validation.requiredTools = validation.requiredTools ?? rawConfig.requiredTools ?? [];
  release.requiredArtifacts = release.requiredArtifacts ?? [];
  release.tagRequired = release.tagRequired ?? false;
  release.outputDir = release.outputDir ?? "release-out";
  release.bundle = release.bundle ?? {};
  release.bundle.requiredFiles = release.bundle.requiredFiles ?? [];
  release.bundle.requiredDirectories = release.bundle.requiredDirectories ?? [];
  release.artifactVersionFiles = (release.artifactVersionFiles ?? []).map(inferVersionSpec);
  release.adapters = {
    zxp: {
      enabled: release.adapters?.zxp?.enabled ?? artifacts.zxp ?? false,
      command: release.adapters?.zxp?.command ?? null,
      outputPath: release.adapters?.zxp?.outputPath ?? null,
    },
    inno: {
      enabled: release.adapters?.inno?.enabled ?? artifacts.windowsExe ?? false,
      command: release.adapters?.inno?.command ?? null,
      outputPath: release.adapters?.inno?.outputPath ?? null,
    },
    electronDmg: {
      enabled: release.adapters?.electronDmg?.enabled ?? artifacts.macDmg ?? false,
      command: release.adapters?.electronDmg?.command ?? null,
      outputPath: release.adapters?.electronDmg?.outputPath ?? null,
    },
    githubRelease: {
      enabled: release.adapters?.githubRelease?.enabled ?? false,
      command: release.adapters?.githubRelease?.command ?? null,
      outputPath: release.adapters?.githubRelease?.outputPath ?? null,
    },
  };
  dev.source = dev.source ?? paths.source;
  dev.liveMode = dev.liveMode ?? "workspace-sync";
  dev.extensionId = dev.extensionId ?? identity.extensionId;
  dev.debugPort = dev.debugPort ?? 8088;
  dev.hostName = dev.hostName ?? "AEFT";
  dev.csxsVersions = dev.csxsVersions ?? ["12", "11"];
  dev.browserUrl = dev.browserUrl ?? `http://localhost:${dev.debugPort}`;
  dev.targetDir = dev.targetDir ?? null;
  dev.buildCommand = dev.buildCommand ?? null;
  dev.syncExcludes = dev.syncExcludes ?? ["node_modules", ".git", ".build-report", "build-report.summary.json", "build-report.summary.txt"];
  dev.localServer = {
    enabled: dev.localServer?.enabled ?? false,
    root: dev.localServer?.root ?? dev.source,
    port: dev.localServer?.port ?? 3000,
  };
  dev.reload = {
    panelPatterns: dev.reload?.panelPatterns ?? ["**/*.html", "**/*.css", "**/*.js", "**/*.json", "assets/**"],
    restartPatterns: dev.reload?.restartPatterns ?? ["CSXS/manifest.xml", "**/*.jsx", "jsx/**", ".debug"],
  };

  const versionFiles = versioning.files ?? rawConfig.versionFiles ?? [];
  const specs = versionFiles.map(inferVersionSpec);

  if (!identity.extensionId) {
    throw new Error("Missing identity.extensionId in ext-build config.");
  }

  if (specs.length === 0) {
    throw new Error("Missing versioning.files in ext-build config.");
  }

  return {
    project,
    identity,
    paths,
    versioning: {
      files: specs,
      tagFormat: versioning.tagFormat ?? "v{version}",
    },
    validation,
    release,
    artifacts,
    dev,
    configPath,
    absolute: {
      root,
      source: path.resolve(root, paths.source),
      dist: path.resolve(root, paths.dist),
      manifest: path.resolve(root, paths.manifest),
      devSource: path.resolve(root, dev.source),
      localServerRoot: path.resolve(root, dev.localServer.root),
      versionFiles: specs.map((spec) => ({
        ...spec,
        absolutePath: resolveSpecPath(root, path.resolve(root, paths.dist), spec),
      })),
      artifactVersionFiles: release.artifactVersionFiles.map((spec) => ({
        ...spec,
        absolutePath: resolveSpecPath(root, path.resolve(root, paths.dist), spec),
      })),
    },
  };
}

export function loadConfig(cwd, explicitConfigPath) {
  const configPath = explicitConfigPath
    ? path.resolve(cwd, explicitConfigPath)
    : path.join(cwd, CONFIG_FILE);

  if (!fileExists(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  return normalizeConfig(readJson(configPath), configPath);
}
