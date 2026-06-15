import path from "node:path";
import fs from "node:fs";

const ES3_RULES = [
  { id: "no-const", pattern: /\bconst\b/, message: "const is not supported in ExtendScript (ES3)" },
  { id: "no-let", pattern: /\blet\b/, message: "let is not supported in ExtendScript (ES3)" },
  { id: "no-arrow-functions", pattern: /=>/, message: "Arrow functions are not supported in ExtendScript (ES3)" },
  { id: "no-template-literals", pattern: /`/, message: "Template literals are not supported in ExtendScript (ES3)" },
  { id: "no-classes", pattern: /\bclass\b/, message: "Class syntax is not supported in ExtendScript (ES3)" },
  { id: "no-destructuring-object", pattern: /(?:\bvar|\blet|\bconst)\s*\{[^}]*\}\s*=/, message: "Object destructuring is not supported in ExtendScript (ES3)" },
  { id: "no-destructuring-array", pattern: /(?:\bvar|\blet|\bconst)\s*\[[^\]]*\]\s*=/, message: "Array destructuring is not supported in ExtendScript (ES3)" },
  { id: "no-destructured-params", pattern: /\bfunction\s*[a-zA-Z0-9_]*\s*\(\s*\{[^}]*\}/, message: "Destructured parameters are not supported in ExtendScript (ES3)" },
  { id: "no-spread-rest", pattern: /\.\.\./, message: "Spread/rest (...) operator is not supported in ExtendScript (ES3)" },
  { id: "no-optional-chaining", pattern: /\?\./, message: "Optional chaining (?.) is not supported in ExtendScript (ES3)" },
  { id: "no-nullish-coalescing", pattern: /\?\?/, message: "Nullish coalescing (??) is not supported in ExtendScript (ES3)" },
  { id: "no-async-await", pattern: /\basync\b|\bawait\b/, message: "async/await is not supported in ExtendScript (ES3)" },
  { id: "no-import-export", pattern: /\bimport\b|\bexport\b/, message: "import/export statements are not supported in JSX/ExtendScript files" }
];

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    // Keep line breaks intact to preserve exact line numbers
    return match.replace(/[^\r\n]/g, "");
  });
}

function stripSingleLineComment(line) {
  return line.replace(/\/\/.*$/, "");
}

function findViolations(filePath, content) {
  const cleanContent = stripBlockComments(content);
  const lines = cleanContent.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const cleanLine = stripSingleLineComment(rawLine);

    for (const rule of ES3_RULES) {
      if (rule.pattern.test(cleanLine)) {
        violations.push({
          file: filePath,
          line: i + 1,
          ruleId: rule.id,
          message: rule.message,
        });
      }
    }
  }
  return violations;
}

export async function runES3Check(config, deps) {
  const { createCheck, listFilesRecursive, fileExists } = deps;
  const checks = [];
  const violations = [];

  const srcRoot = config.absolute.source;
  if (!fileExists(srcRoot)) {
    checks.push(createCheck("es3.source-dir", false, `source directory not found: ${srcRoot}`));
    return { ok: false, checks, violations };
  }

  const jsxFiles = listFilesRecursive(srcRoot)
    .filter(f => f.endsWith(".jsx") || f.endsWith(".jsxinc"));

  if (jsxFiles.length === 0) {
    checks.push(createCheck("es3.no-jsx", true, "No JSX/ExtendScript files found to validate"));
    return { ok: true, checks, violations };
  }

  for (const relativePath of jsxFiles) {
    const absolutePath = path.join(srcRoot, relativePath);
    let content;
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      checks.push(createCheck(`es3.${relativePath}`, false, `Could not read file`));
      continue;
    }
    const fileViolations = findViolations(relativePath, content);
    violations.push(...fileViolations);
  }

  if (violations.length === 0) {
    checks.push(createCheck("es3.compatibility", true, `All ${jsxFiles.length} JSX file(s) are ES3 compatible`));
  } else {
    checks.push(createCheck("es3.compatibility", false, `${violations.length} ES3 violation(s) found across ${jsxFiles.length} file(s)`));
    for (const v of violations.slice(0, 20)) {
      checks.push(createCheck(`es3.${v.file}:${v.line}`, false, `[${v.ruleId}] ${v.message}`));
    }
    if (violations.length > 20) {
      checks.push(createCheck("es3.overflow", true, `...and ${violations.length - 20} more violations`));
    }
  }

  return {
    ok: violations.length === 0,
    message: violations.length === 0
      ? `ES3 check passed — ${jsxFiles.length} file(s) verified`
      : `ES3 check failed — ${violations.length} violation(s) found`,
    checks,
    violations,
    jsxFilesChecked: jsxFiles.length,
    artifacts: [],
    diff: null,
    version: null,
  };
}

export default runES3Check;
