/**
 * Contract Validator - Hard enforcement for agent operations
 *
 * This is NOT advisory - violations HARD FAIL.
 * Agents don't see this layer - they just get corrected if they violate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load contract configuration
const CONTRACT_PATH = path.join(__dirname, "../../../contracts/operation-contract.json");
let CONTRACT = null;

try {
  CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
} catch (e) {
  console.error("[ContractValidator] Failed to load operation-contract.json:", e.message);
  CONTRACT = { enforcementRules: { hardFail: true }, forbiddenPatterns: {} };
}

export class ContractValidator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.violations = [];
    this.telemetry = [];
    this.warnings = [];
  }

  /**
   * Main validation entry point
   * @param {Object} intentPayload - The structured intent from agent
   * @param {string[]} affectedFiles - Files that would be modified
   * @returns {Object} { valid: boolean, violations: [], warnings: [], telemetry: [] }
   */
  validate(intentPayload, affectedFiles = []) {
    this.violations = [];
    this.warnings = [];
    this.telemetry = [];

    // STEP 1: Validate intent structure
    const structureResult = this._validateIntentStructure(intentPayload);
    if (!structureResult.valid) {
      this._recordTelemetry("contract.violation.structure", { reason: structureResult.reason });
      return this._fail(structureResult.reason);
    }

    // STEP 2: Validate contract version
    if (!this._validateContractVersion(intentPayload.contractVersion)) {
      return this._fail(`Invalid contract version: ${intentPayload.contractVersion}`);
    }

    // STEP 3: Validate intent is in allowed list
    const allowedIntents = this._getAllowedIntents();
    if (!allowedIntents.includes(intentPayload.intent)) {
      return this._fail(`Intent '${intentPayload.intent}' is not in allowed list`);
    }

    // STEP 4: Scan affected files for forbidden patterns
    const patternViolations = this._scanFilesForPatterns(affectedFiles);
    if (patternViolations.length > 0) {
      this.violations.push(...patternViolations);
      return this._fail("Forbidden patterns detected in affected files");
    }

    // STEP 5: Validate runtime phase requirements
    const phaseResult = this._validatePhaseRequirements(intentPayload, affectedFiles);
    if (!phaseResult.valid) {
      return this._fail(phaseResult.reason);
    }

    // STEP 6: Validate capabilities
    const capabilityResult = this._validateCapabilities(intentPayload);
    if (!capabilityResult.valid) {
      return this._fail(capabilityResult.reason);
    }

    // All checks passed
    return {
      valid: true,
      violations: [],
      warnings: this.warnings,
      telemetry: this.telemetry,
      message: "Contract compliance verified",
      intent: intentPayload.intent
    };
  }

  /**
   * Validate intent structure matches schema
   */
  _validateIntentStructure(payload) {
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "Intent payload must be an object" };
    }

    const required = CONTRACT.intentSchema?.required || ["contractVersion", "intent", "payload"];
    const missing = required.filter(field => !(field in payload));

    if (missing.length > 0) {
      return { valid: false, reason: `Missing required fields: ${missing.join(", ")}` };
    }

    // Check for forbidden fields that would indicate raw code output
    const forbiddenFields = ["code", "script", "jsx", "eval", "exec", "cmd", "command"];
    const present = forbiddenFields.filter(field => field in payload);
    if (present.length > 0) {
      return { valid: false, reason: `Forbidden fields present: ${present.join(", ")}. Use structured payload only.` };
    }

    return { valid: true };
  }

  /**
   * Validate contract version
   */
  _validateContractVersion(version) {
    return version === "1.0";
  }

  /**
   * Get list of allowed intents
   */
  _getAllowedIntents() {
    return [
      "analyze_project",
      "analyze_comp",
      "scaffold_extension",
      "add_jsx_script",
      "update_manifest",
      "organize_project",
      "run_dev",
      "run_build",
      "run_verify",
      "run_release",
      "debug_extension",
      "sync_workspace"
    ];
  }

  /**
   * Scan files for forbidden patterns
   */
  _scanFilesForPatterns(files) {
    const violations = [];
    const es3Patterns = CONTRACT.forbiddenPatterns?.es3Violations || [];
    const securityPatterns = CONTRACT.forbiddenPatterns?.securityViolations || [];

    for (const filePath of files) {
      if (!this._shouldScanFile(filePath)) continue;

      try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, "utf8");

        // Check ES3 violations (for .jsx files)
        if (filePath.endsWith(".jsx") || filePath.endsWith(".jsxinc")) {
          for (const rule of es3Patterns) {
            const regex = new RegExp(rule.pattern, "g");
            const matches = content.match(regex);
            if (matches) {
              violations.push({
                file: filePath,
                type: "ES3_VIOLATION",
                severity: rule.severity,
                message: rule.message,
                fixSuggestion: rule.fixSuggestion,
                line: this._findLineNumber(content, matches[0])
              });
            }
          }
        }

        // Check security violations (all files)
        for (const rule of securityPatterns) {
          const regex = new RegExp(rule.pattern, "g");
          if (regex.test(content)) {
            violations.push({
              file: filePath,
              type: "SECURITY_VIOLATION",
              severity: rule.severity,
              message: rule.message,
              line: this._findLineNumber(content, content.match(regex)[0])
            });
          }
        }
      } catch (e) {
        this.warnings.push(`Could not scan ${filePath}: ${e.message}`);
      }
    }

    return violations;
  }

  /**
   * Determine if file should be scanned
   */
  _shouldScanFile(filePath) {
    const scanExtensions = [".js", ".jsx", ".mjs", ".html", ".xml", ".json"];
    return scanExtensions.some(ext => filePath.endsWith(ext));
  }

  /**
   * Find line number for a match
   */
  _findLineNumber(content, match) {
    const index = content.indexOf(match);
    if (index === -1) return null;
    return content.substring(0, index).split("\n").length;
  }

  /**
   * Validate phase requirements based on affected files
   */
  _validatePhaseRequirements(intentPayload, affectedFiles) {
    const requiresRuntime = affectedFiles.some(file =>
      this._fileRequiresRuntime(file)
    );

    if (requiresRuntime && !intentPayload.phases?.includes("verify")) {
      return {
        valid: false,
        reason: `Files [${affectedFiles.filter(f => this._fileRequiresRuntime(f)).join(", ")}] require runtime testing. Include 'verify' phase.`
      };
    }

    return { valid: true };
  }

  /**
   * Check if file type requires runtime validation
   */
  _fileRequiresRuntime(filePath) {
    const runtimePatterns = CONTRACT.runtimePhaseRequiredIf || [];
    return runtimePatterns.some(rule => {
      const regex = new RegExp(rule.pathPattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"));
      return regex.test(filePath);
    });
  }

  /**
   * Validate requested capabilities
   */
  _validateCapabilities(intentPayload) {
    const capabilities = intentPayload.requestedCapabilities || [];

    // Define capability requirements per intent
    const intentCapabilities = {
      "analyze_project": ["project:read"],
      "analyze_comp": ["project:read", "cep:read"],
      "scaffold_extension": ["project:write", "template:read"],
      "add_jsx_script": ["project:write", "extendscript:write"],
      "update_manifest": ["project:write", "manifest:write"],
      "organize_project": ["project:write"],
      "run_dev": ["dev:execute"],
      "run_build": ["build:execute"],
      "run_verify": ["verify:execute"],
      "run_release": ["release:execute"],
      "debug_extension": ["debug:execute"],
      "sync_workspace": ["sync:execute"]
    };

    const required = intentCapabilities[intentPayload.intent] || [];
    const missing = required.filter(cap => !capabilities.includes(cap));

    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Missing required capabilities: ${missing.join(", ")}`
      };
    }

    return { valid: true };
  }

  /**
   * Record telemetry event
   */
  _recordTelemetry(event, data = {}) {
    this.telemetry.push({
      event,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  /**
   * Return failure result
   */
  _fail(reason) {
    return {
      valid: false,
      violations: this.violations,
      warnings: this.warnings,
      telemetry: this.telemetry,
      message: reason,
      hardFail: CONTRACT.enforcementRules?.hardFail ?? true
    };
  }
}

/**
 * Convenience function for quick validation
 */
export function validateIntent(intentPayload, affectedFiles, projectRoot) {
  const validator = new ContractValidator(projectRoot);
  return validator.validate(intentPayload, affectedFiles);
}

export default ContractValidator;
