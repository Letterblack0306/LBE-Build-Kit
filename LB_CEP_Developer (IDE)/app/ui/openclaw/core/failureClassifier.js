/**
 * OpenClaw Failure Classifier
 *
 * Classifies step failures into retry strategies so the retry planner
 * can decide what is safe to re-run and what requires human intervention.
 *
 * ── Strategy Enum ─────────────────────────────────────────────────────────────
 *  RETRYABLE      — Same input, same agent, retry immediately (transient errors).
 *  NEEDS_FIX      — Structural problem; retry without changes won't help.
 *  NON_RETRYABLE  — Configuration error; retrying is pointless.
 *  BLOCKED        — Dependency issue; the blocking dep must be resolved first.
 */

// Error token → strategy (tokens are substrings of uppercased reason/error strings)
const ERROR_MAP = [
  // ── Non-retryable: configuration/permission errors ────────────────────────
  { token: "UNKNOWN_AGENT",                 strategy: "NON_RETRYABLE" },
  { token: "TOOL_NOT_ALLOWED",              strategy: "NON_RETRYABLE" },
  { token: "SPAWN_NOT_ALLOWED",             strategy: "NON_RETRYABLE" },
  { token: "SUB_AGENT_TOOL_NOT_ALLOWED",    strategy: "NON_RETRYABLE" },
  { token: "READ_ONLY_AGENT_MUTATION",      strategy: "NON_RETRYABLE" },
  { token: "TOOL_NOT_FOUND",               strategy: "NON_RETRYABLE" },

  // ── Needs fix: structural/semantic errors ─────────────────────────────────
  { token: "ESCALATION_TOOL_BLOCKED",       strategy: "NEEDS_FIX" },
  { token: "OUTPUT_SCHEMA_VIOLATION",       strategy: "NEEDS_FIX" },
  { token: "CONTRACT_VIOLATION",            strategy: "NEEDS_FIX" },
  { token: "PLAN_INVALID",                  strategy: "NEEDS_FIX" },
  { token: "PLAN_CYCLIC",                   strategy: "NEEDS_FIX" },
  { token: "SYNTAX",                        strategy: "NEEDS_FIX" },
  { token: "MALFORMED",                     strategy: "NEEDS_FIX" },
  { token: "PLAN_REJECTED_BEFORE",          strategy: "NEEDS_FIX" },

  // ── Blocked: dependency-induced skips ────────────────────────────────────
  { token: "BLOCKED_BY_FAILED_DEPENDENCY",        strategy: "BLOCKED" },
  { token: "PLAN_ABORTED_DUE_TO_CRITICAL",        strategy: "BLOCKED" },
  { token: "PLAN_REJECTED_BEFORE",               strategy: "NEEDS_FIX" },

  // ── Non-retryable: idempotency and frozen state ───────────────────────────
  { token: "DUPLICATE_EXECUTION_HASH",           strategy: "NON_RETRYABLE" },
  { token: "FROZEN",                             strategy: "NON_RETRYABLE" },

  // ── Retryable: transient / unknown ────────────────────────────────────────
  // (matched last — anything not caught above is assumed retryable)
  { token: "UNEXPECTED_THROW",              strategy: "RETRYABLE" },
  { token: "UNKNOWN_FAILURE",               strategy: "RETRYABLE" },
  { token: "NETWORK",                       strategy: "RETRYABLE" },
  { token: "TIMEOUT",                       strategy: "RETRYABLE" },
  { token: "FETCH",                         strategy: "RETRYABLE" },
];

export const failureClassifier = {

  STRATEGIES: {
    RETRYABLE:     "retryable",
    NEEDS_FIX:     "needs_fix",
    NON_RETRYABLE: "non_retryable",
    BLOCKED:       "blocked",
  },

  /**
   * Classify a single step's failure reason.
   * Input is the step's `reason` or `error` string.
   * Returns one of the four strategy strings.
   */
  classifyReason(reason) {
    if (!reason) return this.STRATEGIES.RETRYABLE;

    const upper = String(reason).toUpperCase();

    for (const { token, strategy } of ERROR_MAP) {
      if (upper.includes(token)) {
        return this.STRATEGIES[strategy] ?? strategy;
      }
    }

    // Default: unknown errors are worth one retry
    return this.STRATEGIES.RETRYABLE;
  },

  /**
   * Classify every step in a plan result.
   *
   * Returns:
   *  {
   *    retryable:     [{ id, step }],  — can be retried as-is
   *    needsFix:      [{ id, step }],  — need structural changes before retry
   *    nonRetryable:  [{ id, step }],  — should not be retried
   *    blocked:       [{ id, step }],  — skipped due to dep failure (not standalone failures)
   *    byId:          { [stepId]: strategy }
   *  }
   */
  classifyPlan(planResult) {
    const retryable    = [];
    const needsFix     = [];
    const nonRetryable = [];
    const blocked      = [];
    const byId         = {};

    for (const [id, step] of Object.entries(planResult.steps)) {
      // Only classify non-completed steps
      if (step.status === "completed") continue;

      const strategy = this.classifyReason(step.reason ?? step.error);
      byId[id] = strategy;

      const entry = { id, step };
      if (strategy === this.STRATEGIES.RETRYABLE)     retryable.push(entry);
      else if (strategy === this.STRATEGIES.NEEDS_FIX)     needsFix.push(entry);
      else if (strategy === this.STRATEGIES.NON_RETRYABLE) nonRetryable.push(entry);
      else if (strategy === this.STRATEGIES.BLOCKED)       blocked.push(entry);
    }

    return { retryable, needsFix, nonRetryable, blocked, byId };
  },

  /**
   * Quick check — can any step in this plan result be retried?
   */
  canRetry(planResult) {
    const classification = this.classifyPlan(planResult);
    return classification.retryable.length > 0;
  },
};
