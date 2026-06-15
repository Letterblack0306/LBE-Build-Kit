import { spawnSync } from "node:child_process";

function getLastGitTag() {
  const result = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function getGitLogSince(tag) {
  const args = ["log", "--pretty=format:%s", "--no-merges"];
  if (tag) args.push(`${tag}..HEAD`);
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

const PREFIX_GROUPS = {
  feat: "Features",
  feature: "Features",
  fix: "Bug Fixes",
  bugfix: "Bug Fixes",
  chore: "Chores",
  docs: "Documentation",
  refactor: "Refactoring",
  perf: "Performance",
  test: "Tests",
  style: "Styling",
  ci: "CI",
  build: "Build",
};

const GROUP_ORDER = [
  "Features", "Bug Fixes", "Performance", "Refactoring",
  "Documentation", "Build", "CI", "Tests", "Styling", "Chores", "Other",
];

function groupCommits(lines) {
  const groups = {};
  const uncategorized = [];
  for (const line of lines) {
    const match = line.match(/^(\w+)(?:\([^)]*\))?:\s*(.+)/);
    if (match) {
      const group = PREFIX_GROUPS[match[1].toLowerCase()] ?? "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(match[2]);
    } else {
      uncategorized.push(line);
    }
  }
  return { groups, uncategorized };
}

export function buildChangelogContent(version, sinceTag, lines) {
  const date = new Date().toISOString().slice(0, 10);
  const header = sinceTag ? `${version} (since ${sinceTag})` : version;
  const out = [`# ${header} — ${date}`, ""];

  if (lines.length === 0) {
    out.push("_No changes recorded._", "");
    return out.join("\n");
  }

  const { groups, uncategorized } = groupCommits(lines);

  for (const groupName of GROUP_ORDER) {
    if (groups[groupName]?.length > 0) {
      out.push(`## ${groupName}`, "");
      for (const msg of groups[groupName]) out.push(`- ${msg}`);
      out.push("");
    }
  }

  if (uncategorized.length > 0) {
    out.push("## Changes", "");
    for (const msg of uncategorized) out.push(`- ${msg}`);
    out.push("");
  }

  return out.join("\n");
}

export function runChangelog(config, options = {}, deps) {
  const { createCheck, writeText, resolvePath, joinPath } = deps;
  const checks = [];

  const sinceTag = options.since !== undefined ? (options.since || null) : getLastGitTag();
  const commits = getGitLogSince(sinceTag);

  checks.push(createCheck(
    "changelog.source",
    true,
    sinceTag
      ? `${commits.length} commit(s) since ${sinceTag}`
      : `${commits.length} commit(s) (no previous tag found)`,
  ));

  const version = options.version ?? config.project?.name ?? "unreleased";
  const content = buildChangelogContent(version, sinceTag, commits);

  const outputPath = options.outputPath ?? joinPath(
    resolvePath(config.absolute.root, config.release.outputDir ?? "release-out"),
    "CHANGELOG.md",
  );

  if (!options.dryRun) {
    try {
      writeText(outputPath, content);
      checks.push(createCheck("changelog.write", true, outputPath));
    } catch (error) {
      checks.push(createCheck(
        "changelog.write",
        false,
        error instanceof Error ? error.message : String(error),
      ));
    }
  } else {
    checks.push(createCheck("changelog.write", true, `dry-run: would write ${outputPath}`));
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    message: ok
      ? `Changelog written: ${commits.length} commit(s)`
      : "Changelog generation failed.",
    checks,
    artifacts: [],
    version: null,
    changelog: content,
  };
}
