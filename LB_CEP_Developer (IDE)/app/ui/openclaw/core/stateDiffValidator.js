/**
 * OpenClaw State Diff Validator
 *
 * Validates that a retry/replay result is an improvement over the original.
 * Detects regressions (previously-completed steps that are now failing)
 * and confirms that at least one improvement occurred.
 *
 * Used between runPlan() calls to guard the merge step:
 *   originalResult → retryResult → validate → merge (or reject)
 *
 * ── Return Shape of validate() ────────────────────────────────────────────────
 *  {
 *    ok:           boolean,     — false if any regression detected
 *    improved:     boolean,     — true if at least one step went failed→completed
 *    regressions:  string[],    — step IDs: completed → failed/skipped
 *    improvements: string[],    — step IDs: failed/skipped → completed
 *    unchanged:    string[],    — step IDs: same status in both results
 *    newSteps:     string[],    — step IDs present in retry but not in original
 *    reason:       string|null, — human-readable failure summary (null if ok)
 *  }
 */
export const stateDiffValidator = {

  /**
   * Compare original plan result against a retry/replay result.
   * Only steps present in BOTH results are compared for regression.
   * Steps only in the retry result are treated as new (not regressions).
   */
  validate(originalResult, retryResult) {
    const regressions  = [];
    const improvements = [];
    const unchanged    = [];
    const newSteps     = [];

    // Check all steps in the retry result
    for (const [stepId, retryStep] of Object.entries(retryResult.steps)) {
      const origStep = originalResult.steps[stepId];

      if (!origStep) {
        // Step is new in the retry plan — not a regression
        newSteps.push(stepId);
        continue;
      }

      if (origStep.status === "completed" && retryStep.status !== "completed") {
        // A step that was working is now broken — this is a regression
        regressions.push(stepId);
      } else if (origStep.status !== "completed" && retryStep.status === "completed") {
        // A step that was failing is now working — this is an improvement
        improvements.push(stepId);
      } else {
        unchanged.push(stepId);
      }
    }

    const ok      = regressions.length === 0;
    const improved = improvements.length > 0;

    let reason = null;
    if (!ok) {
      reason = `Retry caused ${regressions.length} regression(s): ${regressions.join(", ")}`;
    } else if (!improved) {
      reason = "Retry produced no improvements";
    }

    return { ok, improved, regressions, improvements, unchanged, newSteps, reason };
  },

  /**
   * Merge a validated retry result into the original, producing a unified result.
   * The retry's steps override the original for any step that was retried.
   * Steps only in the original (not retried) are preserved unchanged.
   * Each overridden step carries a `retryOf` backreference to the original state.
   *
   * @param {object} originalResult — from the first runPlan() call
   * @param {object} retryResult    — from the retry runPlan() call
   * @returns {object}              — merged plan result with recalculated counts/status
   */
  merge(originalResult, retryResult) {
    const merged = { ...originalResult.steps };

    // Apply retry results — preserve original state as backreference.
    // Immutability guard: a step that already completed cannot be downgraded by a retry.
    // The retry planner should exclude completed steps, but this is a hard structural guarantee.
    for (const [stepId, retryStep] of Object.entries(retryResult.steps)) {
      if (merged[stepId]?.status === "completed" && retryStep.status !== "completed") {
        // Completed → worse: frozen. This should not happen in a correctly-built retry plan.
        continue;
      }
      merged[stepId] = {
        ...retryStep,
        retryOf: originalResult.steps[stepId] ?? null,
      };
    }

    const all       = Object.values(merged);
    const completed = all.filter(s => s.status === "completed").length;
    const failed    = all.filter(s => s.status === "failed").length;
    const skipped   = all.filter(s => s.status === "skipped").length;

    // Re-derive plan status from merged step counts
    const mergedStatus = failed === 0
      ? "success"
      : completed > 0
        ? "partial_success"
        : "failed";

    return {
      ...originalResult,
      status:      mergedStatus,
      ok:          mergedStatus !== "failed",
      phase:       mergedStatus === "failed" ? "failed" : "completed",
      steps:       merged,
      counts:      { completed, failed, skipped, total: all.length },
      retryPlanId: retryResult.planId,
    };
  },
};
