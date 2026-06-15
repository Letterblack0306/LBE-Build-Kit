/**
 * Intent Contract - Layer 2: Contract Validator
 *
 * Agents don't see this layer.
 * They submit intents, and either:
 *   - Intent proceeds (they see success)
 *   - Intent rejected (they see helpful error to fix)
 *
 * The 4-layer pipeline is invisible to agents.
 */

import capabilityMap from "../../../../contracts/capability-map.json" assert { type: "json" };

export const intentContract = {
  /**
   * Validate an intent from an agent
   * Returns result that controller uses to approve/reject
   */
  validate(intentPayload) {
    const violations = [];
    const warnings = [];

    // STEP 1: Structure validation
    const structureCheck = this._validateStructure(intentPayload);
    if (!structureCheck.valid) {
      violations.push({
        type: "STRUCTURE_VIOLATION",
        message: structureCheck.reason,
        severity: "CRITICAL"
      });
      return this._reject(violations, warnings);
    }

    // STEP 2: Contract version
    if (intentPayload.contractVersion !== "1.0") {
      violations.push({
        type: "VERSION_VIOLATION",
        message: `Unsupported contract version: ${intentPayload.contractVersion}`,
        severity: "CRITICAL"
      });
    }

    // STEP 3: Intent whitelist
    const allowedIntents = Object.keys(capabilityMap.intentCapabilities);
    if (!allowedIntents.includes(intentPayload.intent)) {
      violations.push({
        type: "UNKNOWN_INTENT",
        message: `Intent '${intentPayload.intent}' not recognized. Available: ${allowedIntents.join(", ")}`,
        severity: "CRITICAL"
      });
    }

    // STEP 4: Capability check
    if (intentPayload.requestedCapabilities) {
      const capabilityCheck = this._validateCapabilities(
        intentPayload.intent,
        intentPayload.requestedCapabilities
      );
      if (!capabilityCheck.valid) {
        violations.push({
          type: "CAPABILITY_VIOLATION",
          message: capabilityCheck.reason,
          severity: "CRITICAL"
        });
      }
    }

    // STEP 5: Payload validation
    const payloadCheck = this._validatePayload(intentPayload);
    if (!payloadCheck.valid) {
      violations.push({
        type: "PAYLOAD_VIOLATION",
        message: payloadCheck.reason,
        severity: "CRITICAL"
      });
    }

    // STEP 6: Security check - no raw code
    const securityCheck = this._validateSecurity(intentPayload);
    if (!securityCheck.valid) {
      violations.push({
        type: "SECURITY_VIOLATION",
        message: securityCheck.reason,
        severity: "CRITICAL"
      });
    }

    if (violations.length > 0) {
      return this._reject(violations, warnings);
    }

    return this._approve(intentPayload);
  },

  /**
   * Validate structure matches schema
   */
  _validateStructure(payload) {
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "Intent must be an object" };
    }

    const required = ["contractVersion", "intent", "payload"];
    const missing = required.filter(field => !(field in payload));

    if (missing.length > 0) {
      return { valid: false, reason: `Missing required fields: ${missing.join(", ")}` };
    }

    return { valid: true };
  },

  /**
   * Validate requested capabilities match intent
   */
  _validateCapabilities(intent, requestedCaps) {
    const intentDef = capabilityMap.intentCapabilities[intent];
    if (!intentDef) {
      return { valid: false, reason: "Unknown intent" };
    }

    const required = intentDef.capabilities || [];
    const missing = required.filter(cap => !requestedCaps.includes(cap));

    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Missing required capabilities: ${missing.join(", ")}`
      };
    }

    return { valid: true };
  },

  /**
   * Validate payload structure
   */
  _validatePayload(intentPayload) {
    const payload = intentPayload.payload;

    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "Payload must be an object" };
    }

    // Check for forbidden fields that would indicate raw code
    const forbidden = ["code", "script", "jsx", "eval", "exec", "cmd", "command", "raw"];
    const present = forbidden.filter(field => field in payload);

    if (present.length > 0) {
      return {
        valid: false,
        reason: `Forbidden fields in payload: ${present.join(", ")}. Use structured data only.`
      };
    }

    return { valid: true };
  },

  /**
   * Security validation
   */
  _validateSecurity(intentPayload) {
    const payload = JSON.stringify(intentPayload);

    // Check for dangerous patterns
    const dangerous = [
      /eval\s*\(/,
      /Function\s*\(/,
      /document\.write/,
      /<script/i
    ];

    for (const pattern of dangerous) {
      if (pattern.test(payload)) {
        return {
          valid: false,
          reason: "Payload contains potentially dangerous patterns"
        };
      }
    }

    return { valid: true };
  },

  /**
   * Build approval result
   */
  _approve(intentPayload) {
    const intentDef = capabilityMap.intentCapabilities[intentPayload.intent];

    return {
      valid: true,
      status: "approved",
      intent: intentPayload.intent,
      risk: intentDef?.risk || "low",
      requiresConfirmation: intentDef?.requiresConfirmation || false,
      validation: {
        structure: "valid",
        capabilities: "valid",
        security: "passed",
        timestamp: new Date().toISOString()
      }
    };
  },

  /**
   * Build rejection result
   */
  _reject(violations, warnings) {
    return {
      valid: false,
      status: "rejected",
      violations,
      warnings,
      hardFail: true
    };
  },

  /**
   * Get allowed intents for documentation
   */
  getAllowedIntents() {
    return Object.keys(capabilityMap.intentCapabilities);
  },

  /**
   * Get intent documentation
   */
  getIntentDocs(intentName) {
    return capabilityMap.intentCapabilities[intentName] || null;
  }
};

export default intentContract;
