import path from "node:path";

export function scaffoldProject(targetDir, options = {}, deps) {
  const {
    fileExists,
    writeJson,
    writeText,
    loadLocalTemplate,
    slugifyPackageName,
    CONFIG_FILE,
  } = deps;

  const targetRoot = path.resolve(process.cwd(), targetDir ?? ".");
  const configPath = path.join(targetRoot, CONFIG_FILE);
  const manifestPath = path.join(targetRoot, "src", "CSXS", "manifest.xml");
  const versionJsonPath = path.join(targetRoot, "src", "CSXS", "version.json");
  const debugPath = path.join(targetRoot, "src", ".debug");
  const hostScriptPath = path.join(targetRoot, "src", "jsx", "hostscript.jsx");
  const indexPath = path.join(targetRoot, "src", "index.html");
  const mainJsPath = path.join(targetRoot, "src", "main.js");
  const stylePath = path.join(targetRoot, "src", "style.css");
  const packageJsonPath = path.join(targetRoot, "package.json");
  const readmePath = path.join(targetRoot, "README.md");
  const projectName = "My CEP Extension";
  const extensionId = "com.example.my-extension";
  const version = "0.1.0";
  const debugPort = 8088;
  const packageName = slugifyPackageName(projectName);
  const liveMode = options.liveMode === "dist-live" ? "dist-live" : "workspace-sync";
  const replacements = {
    PROJECT_NAME: projectName,
    EXTENSION_ID: extensionId,
    VERSION: version,
    PACKAGE_NAME: packageName,
    DEBUG_PORT: debugPort,
  };

  if (!fileExists(configPath)) {
    writeJson(configPath, {
      project: {
        name: projectName,
        type: "cep",
      },
      identity: {
        extensionId,
      },
      paths: {
        source: "src",
        dist: "dist",
        manifest: "src/CSXS/manifest.xml",
      },
      versioning: {
        files: ["package.json", "src/CSXS/version.json", "src/CSXS/manifest.xml"],
      },
      artifacts: {
        zxp: true,
        windowsExe: false,
        macDmg: false,
      },
      validation: {
        requiredFiles: ["index.html", "CSXS/manifest.xml"],
        forbiddenPatterns: [".env", "*.map", "manifest.dev.xml", "**/tests/**"],
        requiredEnv: [],
        requiredTools: [],
      },
      release: {
        checksumAlgorithm: "sha256",
        tagRequired: false,
        outputDir: "release-out",
        requiredArtifacts: [],
        artifactVersionFiles: [
          {
            path: "CSXS/manifest.xml",
            kind: "manifest",
            label: "dist manifest",
            base: "dist"
          }
        ],
        bundle: {
          requiredFiles: ["index.html", "CSXS/manifest.xml"],
          requiredDirectories: []
        },
        adapters: {
          zxp: {
            enabled: liveMode === "dist-live",
            command: null,
            outputPath: null
          },
          inno: {
            enabled: false,
            command: null,
            outputPath: null
          },
          electronDmg: {
            enabled: false,
            command: null,
            outputPath: null
          },
          githubRelease: {
            enabled: false,
            command: null,
            outputPath: null
          }
        }
      },
      dev: {
        liveMode,
        source: "src",
        extensionId,
        targetDir: null,
        buildCommand: liveMode === "dist-live" ? "npm run build" : null,
        debugPort,
        hostName: "AEFT",
        csxsVersions: ["12", "11"],
        browserUrl: `http://localhost:${debugPort}`,
        syncExcludes: ["node_modules", ".git", ".build-report"],
        localServer: {
          enabled: false,
          root: "src",
          port: 3000
        },
        reload: {
          panelPatterns: ["**/*.html", "**/*.css", "**/*.js", "**/*.json", "assets/**"],
          restartPatterns: ["CSXS/manifest.xml", "**/*.jsx", "jsx/**", ".debug"]
        }
      },
    });
  }

  if (!fileExists(packageJsonPath)) {
    writeText(packageJsonPath, loadLocalTemplate("template.cep.package.json", replacements));
  }

  if (!fileExists(versionJsonPath)) {
    writeJson(versionJsonPath, { version });
  }

  if (!fileExists(indexPath)) {
    writeText(indexPath, loadLocalTemplate("template.cep.index.html", replacements));
  }

  if (!fileExists(mainJsPath)) {
    writeText(mainJsPath, loadLocalTemplate("template.cep.main.js", replacements));
  }

  if (!fileExists(stylePath)) {
    writeText(stylePath, loadLocalTemplate("template.cep.style.css", replacements));
  }

  if (!fileExists(manifestPath)) {
    writeText(manifestPath, loadLocalTemplate("template.cep.manifest.xml", replacements));
  }

  if (!fileExists(hostScriptPath)) {
    writeText(hostScriptPath, loadLocalTemplate("template.cep.hostscript.jsx", replacements));
  }

  if (!fileExists(debugPath)) {
    writeText(debugPath, loadLocalTemplate("template.cep.debug.xml", replacements));
  }

  if (!fileExists(readmePath)) {
    writeText(readmePath, loadLocalTemplate("template.cep.README.md", replacements));
  }

  return {
    ok: true,
    message: `Scaffolded ${configPath}`,
    checks: [],
    artifacts: [],
    diff: null,
    version,
    config: null,
    reportRoot: targetRoot,
  };
}
