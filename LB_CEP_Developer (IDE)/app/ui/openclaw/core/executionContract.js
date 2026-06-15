/**
 * OpenClaw Execution Contract
 *
 * Enforces structured outputs for all agent and sub-agent results.
 *
 * Every agent/sub-agent MUST return a payload shaped:
 *   { status, summary, result, error }
 *
 * Sub-agents additionally MUST carry:
 *   { parentJobId }
 *
 * Sub-agents are restricted to status values: "completed" | "failed"
 * Parent agents may also use: "stalled" | "cancelled"
 */
export const executionContract = {
  // Full set of valid parent-agent statuses
  VALID_STATUS: new Set(["completed", "failed", "stalled", "cancelled"]),

  // Sub-agents are terminal: they cannot stall or cancel a parent flow
  SUBAGENT_STATUS: new Set(["completed", "failed"]),

  // ── Parent-agent result validation ────────────────────────────────────────

  /**
   * Validate a parent-agent result payload.
   * opts.requireParentJobId = true  →  parentJobId field must be present
   */
  validateResult(payload, opts = {}) {
    const base = this._checkBase(payload, this.VALID_STATUS);
    if (!base.ok) return base;

    if (opts.requireParentJobId && !payload.parentJobId) {
      return { ok: false, reason: "PARENT_JOB_ID_MISSING" };
    }

    return { ok: true };
  },

  // ── Sub-agent result validation ───────────────────────────────────────────

  /**
   * Validate a sub-agent result payload.
   * parentJobId is ALWAYS required for sub-agent results.
   * Only "completed" / "failed" are accepted (no stall/cancel).
   */
  validateSubAgentResult(payload) {
    const base = this._checkBase(payload, this.SUBAGENT_STATUS);
    if (!base.ok) return base;

    if (!payload.parentJobId) {
      return { ok: false, reason: "PARENT_JOB_ID_MISSING" };
    }

    return { ok: true };
  },

  // ── Utility builder ───────────────────────────────────────────────────────

  /**
   * Build a valid agent result payload.
   * Callers use this instead of constructing the object manually.
   */
  wrapResult(status, summary, result = null, error = null, parentJobId = null) {
    const payload = { status, summary, result, error };
    if (parentJobId !== null) payload.parentJobId = parentJobId;
    return payload;
  },

  // ── Internal ──────────────────────────────────────────────────────────────

  _checkBase(payload, allowedStatus) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "RESULT_MISSING" };
    }
    if (!allowedStatus.has(payload.status)) {
      return { ok: false, reason: `INVALID_STATUS:${payload.status}` };
    }
    if (typeof payload.summary !== "string") {
      return { ok: false, reason: "SUMMARY_MISSING" };
    }
    if (!("result" in payload)) {
      return { ok: false, reason: "RESULT_FIELD_MISSING" };
    }
    if (!("error" in payload)) {
      return { ok: false, reason: "ERROR_FIELD_MISSING" };
    }
    return { ok: true };
  },
};
