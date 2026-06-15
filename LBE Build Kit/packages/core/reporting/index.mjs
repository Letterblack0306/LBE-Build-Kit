import fs from "node:fs";
import path from "node:path";

export const REPORT_DIR = ".build-report";

function buildGitHubSummary(payload) {
  const status = payload.ok ? "✅ PASS" : "❌ FAIL";
  const lines = [
    `## ext-build \`${payload.command}\` — ${status}`,
    "",
  ];
  if (payload.message) lines.push(`> ${payload.message}`, "");
  if (payload.version) lines.push(`**Version:** \`${payload.version}\``, "");

  lines.push("### Checks", "");
  for (const check of payload.checks) {
    lines.push(`- [${check.ok ? "x" : " "}] \`${check.name}\` — ${check.message}`);
  }

  if (payload.artifacts.length > 0) {
    lines.push("", `### Artifacts (${payload.artifacts.length})`, "");
    for (const a of payload.artifacts) {
      lines.push(`- \`${a.path}\` — ${a.size} bytes`);
    }
  }
  return lines.join("\n") + "\n";
}

function buildSarif(payload) {
  const rules = [];
  const results = [];
  const seen = new Set();

  for (const check of payload.checks) {
    if (!seen.has(check.name)) {
      seen.add(check.name);
      rules.push({ id: check.name, name: check.name, shortDescription: { text: check.name } });
    }
    if (!check.ok) {
      results.push({
        ruleId: check.name,
        level: "error",
        message: { text: check.message },
        locations: [],
      });
    }
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "ext-build", version: payload.config?.project?.name ?? "0.0.0", rules } },
      results,
    }],
  };
}

export function writeReport(rootDir, payload, deps) {
  const { ensureDir, writeJson, writeText, getGitMetadata } = deps;
  let reportRoot = path.join(rootDir, REPORT_DIR);
  let useDirectoryLayout = true;

  try {
    ensureDir(reportRoot);
  } catch {
    reportRoot = rootDir;
    useDirectoryLayout = false;
  }

  const reportPath = (fileName) =>
    useDirectoryLayout ? path.join(reportRoot, fileName) : path.join(reportRoot, `build-report.${fileName}`);

  const summary = {
    timestamp: new Date().toISOString(),
    command: payload.command,
    ok: payload.ok,
    message: payload.message,
    project: payload.config?.project?.name ?? null,
    extensionId: payload.config?.identity?.extensionId ?? null,
    version: payload.version ?? null,
    git: payload.git ?? getGitMetadata(),
    platform: process.platform,
    node: process.versions.node,
    checks: payload.checks,
    artifactCount: payload.artifacts.length,
    diff: payload.diff,
  };

  try {
    writeJson(reportPath("summary.json"), summary);
    writeJson(reportPath("artifacts.json"), { artifacts: payload.artifacts });
    writeJson(reportPath("drift-report.json"), payload.diff ?? { status: "not-run" });
    writeJson(reportPath("release-metadata.json"), {
      project: payload.config?.project?.name ?? null,
      extensionId: payload.config?.identity?.extensionId ?? null,
      version: payload.version ?? null,
      command: payload.command,
      git: payload.git ?? getGitMetadata(),
      platform: process.platform,
      node: process.versions.node,
      generatedAt: new Date().toISOString(),
    });

    const checksums = payload.artifacts
      .filter((artifact) => artifact.sha256)
      .map((artifact) => `${artifact.sha256}  ${artifact.path}`)
      .join("\n");

    writeText(reportPath("checksums.txt"), checksums ? `${checksums}\n` : "");
    writeText(
      reportPath("summary.txt"),
      [
        `Command: ${payload.command}`,
        `Status: ${payload.ok ? "PASS" : "FAIL"}`,
        payload.message ? `Message: ${payload.message}` : null,
        payload.version ? `Version: ${payload.version}` : null,
        `Checks: ${payload.checks.length}`,
        `Artifacts: ${payload.artifacts.length}`,
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );

    // GitHub Actions step summary
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, buildGitHubSummary(payload));
      } catch { /* non-fatal */ }
    }

    // SARIF for GitHub code scanning
    writeJson(reportPath("results.sarif"), buildSarif(payload));

    return useDirectoryLayout ? reportRoot : `${reportRoot} (build-report.* files)`;
  } catch {
    return null;
  }
}

export function printResult(result, json) {
  if (json) {
    const checks = result.checks ?? [];
    const artifacts = result.artifacts ?? [];
    const normalized = {
      ...result,
      success: result.ok,
      summary: {
        checksPassed: checks.filter((c) => c.ok).length,
        checksFailed: checks.filter((c) => !c.ok).length,
        artifactCount: artifacts.length,
      },
      reportPath: result.reportDir ?? null,
    };
    // Tagged line lets the IDE bridge extract JSON reliably even if future
    // adapters emit mixed stdout. The tag must be the last line.
    console.log(`__EXT_BUILD_JSON__${JSON.stringify(normalized)}`);
    return;
  }

  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.command}`);
  if (result.message) {
    console.log(result.message);
  }

  if (result.checks.length > 0) {
    console.log("");
    for (const check of result.checks) {
      console.log(`[${check.ok ? "OK " : "ERR"}] ${check.name} - ${check.message}`);
    }
  }

  if (result.diff && (result.diff.added.length || result.diff.removed.length || result.diff.changed.length)) {
    console.log("");
    console.log(`Diff summary: +${result.diff.added.length} / -${result.diff.removed.length} / ~${result.diff.changed.length}`);
  }

  if (result.reportDir) {
    console.log("");
    console.log(`Report: ${result.reportDir}`);
  }
}
