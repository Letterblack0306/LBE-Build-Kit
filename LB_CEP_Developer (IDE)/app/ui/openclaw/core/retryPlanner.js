import { failureClassifier } from "./failureClassifier.js";
import { executionPlan } from "./executionPlan.js";

/**
 * OpenClaw Retry Planner
 *
 * Builds minimal, dependency-correct retry plans from a previous plan result.
 * Only retryable steps and their newly-unblocked dependents are included.
 * Previously-completed steps are NEVER re-run.
 *
 * Three entry points:
 *
 *  buildRetryPlan(originalPlan, planResult)
 *    → Minimal plan covering all retryable failures + unblocked dependents.
 *
 *  buildStepRetryPlan(originalPlan, planResult, stepId)
 *    → Minimal plan for a single step (no dependency chain).
 *
 *  buildGroupReplayPlan(originalPlan, planResult, fromGroupIndex)
 *    → Replay all steps in groups >= fromGroupIndex, filtering already-completed ones.
 *
 * All return: { ok, plan, classification, retryIds } | { ok: false, reason }
 */
export const retryPlanner = {

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build a minimal retry plan covering all retryable failures.
   *
   * Algorithm:
   *  1. Classify all non-completed steps.
   *  2. Collect retryable step IDs.
   *  3. Find skipped steps that become unblocked when retryable steps succeed.
   *     (A skipped step is unblocked if every failed dep it had is now being retried.)
   *  4. Build a new plan: retryable + unblocked steps, with trimmed dependsOn.
   *  5. Validate the resulting plan.
   */
  buildRetryPlan(originalPlan, planResult) {
    const classification  = failureClassifier.classifyPlan(planResult);
    const retryableIds    = new Set(classification.retryable.map(e => e.id));

    if (retryableIds.size === 0) {
      return { ok: false, reason: "NO_RETRYABLE_STEPS", classification };
    }

    // Steps that were skipped and can now be unblocked
    const unblockedIds = this._findUnblockable(originalPlan, planResult, retryableIds);

    const retryIds = new Set([...retryableIds, ...unblockedIds]);
    const plan     = this._buildPlan(originalPlan, retryIds, "retry");

    const valid = executionPlan.validate(plan);
    if (!valid.ok) {
      return { ok: false, reason: `RETRY_PLAN_INVALID:${valid.reason}`, classification };
    }

    return { ok: true, plan, classification, retryIds: [...retryIds] };
  },

  /**
   * Build a single-step retry plan (no dependency tracking).
   * The step runs in isolation — its dependsOn is cleared.
   */
  buildStepRetryPlan(originalPlan, planResult, stepId) {
    const stepDef = originalPlan.steps.find(s => s.id === stepId);
    if (!stepDef) {
      return { ok: false, reason: `STEP_NOT_FOUND:${stepId}` };
    }

    const currentState = planResult.steps[stepId];
    if (currentState?.status === "completed") {
      return { ok: false, reason: `STEP_ALREADY_COMPLETED:${stepId}` };
    }

    const strategy = failureClassifier.classifyReason(currentState?.reason ?? currentState?.error);
    if (strategy === failureClassifier.STRATEGIES.NON_RETRYABLE) {
      return { ok: false, reason: `STEP_NON_RETRYABLE:${stepId}:${strategy}` };
    }

    const plan = {
      name:  `${originalPlan.name}:retry:${stepId}`,
      steps: [{ ...stepDef, dependsOn: [] }],  // isolated — no dep wait
    };

    return { ok: true, plan, retryIds: [stepId] };
  },

  /**
   * Build a replay plan starting from a specific group index.
   * Steps that already completed are excluded from the replay.
   * dependsOn within the replay set is preserved; external completed deps are dropped.
   */
  buildGroupReplayPlan(originalPlan, planResult, fromGroupIndex) {
    if (typeof fromGroupIndex !== "number" || fromGroupIndex < 0) {
      return { ok: false, reason: `INVALID_GROUP_INDEX:${fromGroupIndex}` };
    }

    const groups = executionPlan.resolveGroups(originalPlan.steps);
    if (!groups) {
      return { ok: false, reason: "CANNOT_RESOLVE_GROUPS" };
    }
    if (fromGroupIndex >= groups.length) {
      return { ok: false, reason: `GROUP_INDEX_OUT_OF_RANGE:${fromGroupIndex}/${groups.length}` };
    }

    // All steps in groups from the start index onwards, excluding completed ones
    const replayIds = new Set(
      groups
        .slice(fromGroupIndex)
        .flatMap(g => g.map(s => s.id))
        .filter(id => planResult.steps[id]?.status !== "completed")
    );

    if (replayIds.size === 0) {
      return { ok: false, reason: "ALL_REPLAY_STEPS_ALREADY_COMPLETED" };
    }

    const plan = this._buildPlan(originalPlan, replayIds, `replay_g${fromGroupIndex}`);

    const valid = executionPlan.validate(plan);
    if (!valid.ok) {
      return { ok: false, reason: `REPLAY_PLAN_INVALID:${valid.reason}` };
    }

    return { ok: true, plan, retryIds: [...replayIds] };
  },

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Find skipped steps that become executable if retryableIds succeed.
   * A step is unblockable if every dep that previously failed is now in retryableIds,
   * and all other deps either completed or are also being unblocked (recursive).
   */
  _findUnblockable(originalPlan, planResult, retryableIds) {
    const unblocked = new Set();
    let changed     = true;

    // Iterate until no new steps are unblocked (handles transitive unblocking)
    while (changed) {
      changed = false;

      for (const step of originalPlan.steps) {
        if (unblocked.has(step.id)) continue;
        const state = planResult.steps[step.id];
        if (!state || state.status !== "skipped") continue;
        if (state.reason === "plan_rejected_before_execution") continue;

        // Check: every dep that was failed is now being retried or unblocked
        const canUnblock = (step.dependsOn || []).every(dep => {
          const depState = planResult.steps[dep];
          if (!depState || depState.status === "completed") return true;
          return retryableIds.has(dep) || unblocked.has(dep);
        });

        if (canUnblock) {
          unblocked.add(step.id);
          changed = true;
        }
      }
    }

    return unblocked;
  },

  /**
   * Build a new plan from a subset of original plan steps.
   * Trims dependsOn to only reference steps within the subset.
   */
  _buildPlan(originalPlan, stepIds, suffix) {
    const steps = originalPlan.steps
      .filter(s => stepIds.has(s.id))
      .map(s => ({
        ...s,
        // Drop deps that are not in this retry plan (they already completed)
        dependsOn: (s.dependsOn || []).filter(dep => stepIds.has(dep)),
      }));

    return {
      name:  `${originalPlan.name}:${suffix}`,
      steps,
    };
  },
};
