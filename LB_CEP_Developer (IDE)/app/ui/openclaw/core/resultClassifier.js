/**
 * OpenClaw Result Classifier
 *
 * Separates dispatcher-level success from tool-level semantic success.
 * Every step execution produces one of three classifications:
 *
 *  "success"          — dispatcher ok + tool output ok
 *  "business_failure" — dispatcher ok, tool output ok:false
 *                       (tool ran, but the operation itself failed)
 *  "system_failure"   — dispatcher ok:false
 *                       (tool could not be invoked: throw, permission denied,
 *                        schema violation, unknown agent, etc.)
 *
 * Why this matters:
 *  - business_failure → likely retryable with different input or after a fix
 *  - system_failure   → likely requires configuration change before retry
 *  - Different retry strategies, different analytics, different escalation triggers
 */
export const resultClassifier = {

  CLASS: {
    SUCCESS:          "success",
    BUSINESS_FAILURE: "business_failure",
    SYSTEM_FAILURE:   "system_failure",
  },

  /**
   * Classify a dispatcher result object.
   * @param {object} result — { ok, output?, error? } from toolDispatcher.run / runSubAgent
   * @returns {"success"|"business_failure"|"system_failure"}
   */
  classify(result) {
    if (!result || !result.ok)               return this.CLASS.SYSTEM_FAILURE;
    if (result.output?.ok === false)         return this.CLASS.BUSINESS_FAILURE;
    return this.CLASS.SUCCESS;
  },

  isSuccess(result)         { return this.classify(result) === this.CLASS.SUCCESS; },
  isBusinessFailure(result) { return this.classify(result) === this.CLASS.BUSINESS_FAILURE; },
  isSystemFailure(result)   { return this.classify(result) === this.CLASS.SYSTEM_FAILURE; },
};
