import path from "node:path";
import fs from "node:fs";
import { ContractValidator } from "../validators/contract-validator.mjs";

/**
 * Run ES3/ExtendScript compatibility check
 * Validates that .jsx files only use ES3 syntax
 */
export async function runES3Check(config, deps) {
  const { createCheck, fileExists, listFilesRecursive, readText } = deps;
  const checks = [];
  const violations = [];

  // Find all .jsx and .jsxinc files
  const jsxFiles = listFilesRecursive(config.absolute.root, deps)
    .filter(f => f.endsWith(".jsx") || f.endsWith(".jsxinc"));

  if (jsxFiles.length === 0) {
    checks.push(createCheck("es3.no-jsx", true, "No JSX files to validate"));
    return { ok: true, checks, violations: [] };
  }

  const validator = new ContractValidator(config.absolute.root);

  for (const filePath of jsxFiles) {
    const fullPath = path.join(config.absolute.root, filePath);

    try {
      const content = readText(fullPath, deps);

      // Create a mock intent to trigger ES3 validation
      const mockIntent = {
        contractVersion: "1.0",
        intent: "analyze_comp",
        payload: {},
        phases: ["analyze"]
      };

      const result = validator.validate(mockIntent, [filePath]);

      if (!result.valid && result.violations.length > 0) {
        const fileViolations = result.violations.filter(v => v.file === filePath);
        violations.push(...fileViolations);
      }
    } catch (e) {
      checks.push(createCheck(`es3.${filePath}`, false, `Failed to check ${filePath}: ${e.message}`));
    }
  }

  // Report results
  if (violations.length === 0) {
    checks.push(createCheck("es3.compatibility", true, `All ${jsxFiles.length} JSX files are ES3 compatible`));
  } else {
    const es3Violations = violations.filter(v => v.type === "ES3_VIOLATION");
    const criticalViolations = violations.filter(v => v.severity === "CRITICAL");

    checks.push(createCheck("es3.compatibility", false,
      `${es3Violations.length} ES3 violations, ${criticalViolations.length} critical`));

    // Log detailed violations
    for (const v of es3Violations.slice(0, 10)) {
      checks.push(createCheck(`es3.${v.file}:${v.line}`, false,
        `${v.message} (line ${v.line})${v.fixSuggestion ? ` → ${v.fixSuggestion}` : ""}`));
    }

    if (es3Violations.length > 10) {
      checks.push(createCheck("es3.more", true, `... and ${es3Violations.length - 10} more violations`));
    }
  }

  return {
    ok: violations.filter(v => v.severity === "CRITICAL").length === 0,
    checks,
    violations,
    jsxFilesChecked: jsxFiles.length
  };
}

export default runES3Check;
