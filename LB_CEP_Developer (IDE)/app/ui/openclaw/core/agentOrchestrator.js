import { toolDispatcher }   from "./toolDispatcher.js";
import { executionPlan }    from "./executionPlan.js";
import { jobManager }       from "./jobManager.js";
import { executionContract } from "./executionContract.js";
import { retryPlanner }     from "./retryPlanner.js";
import { stateDiffValidator } from "./stateDiffValidator.js";
import { resultClassifier } from "./resultClassifier.js";
import { edeEventBus }      from "./edeEventBus.js";

/**
 * OpenClaw Agent Orchestrator
 *
 * Coordinates multi-step execution plans on behalf of a parent agent.
 * The orchestrator is NOT an agent — it is a coordination layer that routes
 * sub-agent calls through toolDispatcher.runSubAgent().
 *
 * Execution model:
 *  1. Validate plan structure.
 *  2. Resolve steps into parallel execution groups (topological levels).
 *  3. For each group: skip blocked steps, run eligible steps via Promise.allSettled.
 *  4. If a CRITICAL step fails → abort remaining groups (all become "skipped").
 *  5. If a NON-CRITICAL step fails → dependents skip, plan continues, status = partial_success.
 *  6. Return canonical state — the CALLER settles the parent job via settlePlan().
 *
 * ── Plan Status Enum ──────────────────────────────────────────────────────────
 *  "success"         — all steps completed
 *  "partial_success" — some non-critical steps failed; plan continued
 *  "failed"          — a critical step failed; remaining steps aborted
 *
 * ── Canonical Step Shape ─────────────────────────────────────────────────────
 *  {
 *    status:        "completed" | "failed" | "skipped",
 *    reason:        string | null,        — failure or skip reason
 *    groupIndex:    number,               — which execution group this step belonged to
 *    agentName:     string,               — sub-agent that ran (or was assigned) the step
 *    toolName:      string,               — tool called
 *    result:        any | null,           — tool output on success
 *    error:         any | null,           — error on failure
 *    childJobId:    string | null,        — child job created by dispatcher
 *    executionHash: string,               — deterministic step identity for retry targeting
 *  }
 *
 * ── Return Shape of runPlan() ─────────────────────────────────────────────────
 *  {
 *    ok:          boolean,
 *    status:      "success" | "partial_success" | "failed",
 *    planId:      string,
 *    planName:    string,
 *    parentJobId: string,
 *    agent:       string,
 *    groupCount:  number,
 *    phase:       "completed" | "failed",
 *    steps:       { [stepId]: <canonical step shape> },
 *    counts:      { completed, failed, skipped, total },
 *  }
 */
export const agentOrchestrator = {

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute a full multi-step plan.
   * Returns the canonical plan result — does NOT complete the parent job.
   * Call settlePlan() afterwards to close the parent job.
   */
  async runPlan(parentJobId, parentAgentName, plan) {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    edeEventBus.emit("plan.start", { planId, planName: plan?.name, parentJobId, agent: parentAgentName });

    // ── Phase: planning ───────────────────────────────────────────────────────
    jobManager.logStep(parentJobId, `[planning] "${plan?.name}" planId=${planId}`);

    // 1. Validate
    const validation = executionPlan.validate(plan);
    if (!validation.ok) {
      jobManager.logStep(parentJobId, `[failed] plan rejected: ${validation.reason}`);
      return this._buildResult(
        planId, plan?.name ?? "unknown", parentJobId, parentAgentName,
        0, "failed", {}, plan?.steps ?? []
      );
    }

    // 2. Resolve groups
    const groups = executionPlan.resolveGroups(plan.steps);
    if (!groups) {
      jobManager.logStep(parentJobId, `[failed] cyclic dependency detected`);
      return this._buildResult(
        planId, plan.name, parentJobId, parentAgentName,
        0, "failed", {}, plan.steps
      );
    }

    jobManager.logStep(
      parentJobId,
      `[planning] resolved: ${plan.steps.length} steps → ${groups.length} group(s)`
    );

    // ── Phase: execution ──────────────────────────────────────────────────────
    const steps      = {};          // canonical step map — single source of truth
    const failedIds  = new Set();
    const seenHashes = new Set();   // idempotency guard — one execution per hash per plan run
    let   planStatus = "success";
    let   aborted    = false;       // set when a critical step fails

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];

      jobManager.logStep(
        parentJobId,
        `[running_group_${gi + 1}/${groups.length}] [${group.map(s => s.id).join(", ")}]`
      );

      // Partition group: steps that can run vs steps that must be skipped
      const toRun  = [];
      const toSkip = [];

      for (const step of group) {
        // ① Immutability guard — completed steps are frozen; cannot re-enter execution
        if (steps[step.id]?.status === "completed") {
          jobManager.logStep(parentJobId, `[frozen] "${step.id}" already completed — skipping`);
          continue;
        }

        if (aborted) {
          toSkip.push({ step, reason: "plan_aborted_due_to_critical_failure" });
          continue;
        }

        // ② Idempotency guard — same executionHash cannot run twice in one plan
        const hash = `${step.subAgent}:${step.tool}:${step.id}`;
        if (seenHashes.has(hash)) {
          toSkip.push({ step, reason: "duplicate_execution_hash" });
          jobManager.logStep(parentJobId, `[idempotent] "${step.id}" hash already seen — skipped`);
          continue;
        }

        const blockedBy = (step.dependsOn || []).find(dep => failedIds.has(dep));
        if (blockedBy) {
          toSkip.push({ step, reason: "blocked_by_failed_dependency" });
        } else {
          seenHashes.add(hash);   // register before execution
          toRun.push(step);
        }
      }

      // Record skipped steps immediately (immutability guard applies here too)
      for (const { step, reason } of toSkip) {
        if (steps[step.id]?.status === "completed") continue;
        steps[step.id] = this._stepRecord(step, gi, "skipped", null, null, null, reason, null);
        edeEventBus.emit("step.skip", { planId, stepId: step.id, groupIndex: gi, reason });
        jobManager.logStep(parentJobId, `[skipped] "${step.id}" — ${reason}`);
      }

      // ③ Pre-execution intent audit — logged before any async call
      for (const step of toRun) {
        edeEventBus.emit("step.intent", { planId, stepId: step.id, groupIndex: gi, agentName: step.subAgent, toolName: step.tool });
        jobManager.logStep(parentJobId,
          `[intent] "${step.id}" → ${step.subAgent}:${step.tool} | hash=${step.subAgent}:${step.tool}:${step.id}`
        );
      }

      // Run eligible steps — Promise.allSettled guarantees all settle regardless of throws
      if (toRun.length > 0) {
        const settled = await Promise.allSettled(
          toRun.map(step => this._runStep(parentJobId, parentAgentName, step))
        );

        for (let i = 0; i < toRun.length; i++) {
          const step    = toRun[i];
          const outcome = settled[i];

          // ① Immutability guard (post-execution) — re-check in case of race
          if (steps[step.id]?.status === "completed") {
            jobManager.logStep(parentJobId, `[frozen] "${step.id}" already completed — result discarded`);
            continue;
          }

          // Normalise: fulfilled = dispatcher result, rejected = unexpected throw
          const result = outcome.status === "fulfilled"
            ? outcome.value
            : { ok: false, tool: step.tool, error: outcome.reason?.message ?? "UNEXPECTED_THROW" };

          // A step is successful only if BOTH the dispatcher and the tool itself report ok.
          // Tools like `validator` return { ok: false, error } without throwing — the dispatcher
          // still returns ok:true in that case. Check output?.ok to catch tool-level failures.
          const stepOk = result.ok && (result.output?.ok !== false);
          const errMsg = !result.ok
            ? (result.error ?? "UNKNOWN_FAILURE")
            : (!stepOk ? (result.output?.error ?? result.output?.reason ?? "TOOL_RETURNED_FAILURE") : null);

          // ④ Execution classification — separates system failures from business failures
          const execClass = resultClassifier.classify(result);

          if (stepOk) {
            steps[step.id] = this._stepRecord(
              step, gi, "completed",
              result.output ?? null, null,
              result.childJobId ?? null,
              null, execClass
            );
            edeEventBus.emit("step.complete", { planId, stepId: step.id, groupIndex: gi, execClass });
            jobManager.logStep(parentJobId, `[ok] "${step.id}" [${execClass}]`);

          } else {
            failedIds.add(step.id);

            steps[step.id] = this._stepRecord(
              step, gi, "failed",
              null, errMsg,
              result.childJobId ?? null,
              errMsg, execClass
            );
            edeEventBus.emit("step.fail", { planId, stepId: step.id, groupIndex: gi, execClass, error: errMsg });
            jobManager.logStep(parentJobId, `[failed] "${step.id}" [${execClass}]: ${errMsg}`);

            const isCritical = step.critical !== false;
            if (isCritical) {
              aborted    = true;
              planStatus = "failed";
              jobManager.logStep(parentJobId, `[abort] critical step "${step.id}" failed — aborting plan`);
            } else if (planStatus === "success") {
              planStatus = "partial_success";
            }
          }
        }
      }
    }

    // ── Phase: settling ───────────────────────────────────────────────────────
    jobManager.logStep(parentJobId, `[settling] status=${planStatus}`);

    const planResult = this._buildResult(
      planId, plan.name, parentJobId, parentAgentName,
      groups.length, planStatus, steps, []
    );

    edeEventBus.emit("plan.complete", {
      planId, planName: plan.name, parentJobId, agent: parentAgentName,
      status: planStatus, counts: planResult.counts,
    });

    return planResult;
  },

  /**
   * Wrap a plan result into a parent-job contract payload and complete the job.
   * Call after runPlan() when the parent job should be closed.
   */
  async settlePlan(parentJobId, planResult) {
    // Map plan status → contract status (contract only accepts completed / failed)
    const contractStatus = planResult.status === "failed" ? "failed" : "completed";

    const c = planResult.counts;
    const summary =
      `Plan "${planResult.planName}" [${planResult.status}]: ` +
      `${c.completed}/${c.total} completed, ${c.failed} failed, ${c.skipped} skipped`;

    const payload = executionContract.wrapResult(
      contractStatus,
      summary,
      contractStatus === "completed" ? planResult : null,
      contractStatus === "failed"    ? { status: planResult.status, steps: planResult.steps } : null
    );

    jobManager.logStep(parentJobId, `[${contractStatus}] ${summary}`);
    await jobManager.completeJob(parentJobId, payload);
    return payload;
  },

  // ── Retry / Replay ─────────────────────────────────────────────────────────

  /**
   * Retry all retryable failed steps from a previous plan run.
   * Builds a minimal retry plan, runs it, validates the diff, and merges.
   *
   * Returns the merged plan result (original + retry outcomes combined).
   * Does NOT settle the parent job — call settlePlan() when done.
   */
  async retryFailed(parentJobId, parentAgentName, originalPlan, planResult) {
    const planned = retryPlanner.buildRetryPlan(originalPlan, planResult);
    if (!planned.ok) {
      jobManager.logStep(parentJobId, `[retry] aborted — ${planned.reason}`);
      return { ...planResult, retryAbortReason: planned.reason };
    }

    edeEventBus.emit("retry.start", { parentJobId, retryCount: planned.retryIds.length, mode: "failed" });
    jobManager.logStep(parentJobId, `[retry] retrying ${planned.retryIds.length} step(s)`);
    const retryResult = await this.runPlan(parentJobId, parentAgentName, planned.plan);

    const diff = stateDiffValidator.validate(planResult, retryResult);
    jobManager.logStep(
      parentJobId,
      `[retry] diff: ${diff.improvements.length} improved, ` +
      `${diff.regressions.length} regressions, ${diff.unchanged.length} unchanged`
    );

    if (!diff.ok) {
      // Regression detected — do not merge, return original with annotation
      edeEventBus.emit("retry.rejected", { parentJobId, reason: diff.reason, regressions: diff.regressions });
      jobManager.logStep(parentJobId, `[retry] rejected — ${diff.reason}`);
      return { ...planResult, retryRejected: true, retryDiff: diff };
    }

    edeEventBus.emit("retry.complete", { parentJobId, improvements: diff.improvements.length, unchanged: diff.unchanged.length });
    return stateDiffValidator.merge(planResult, retryResult);
  },

  /**
   * Retry a single specific step by ID.
   * The step runs in isolation (no dependency chain).
   * Returns the merged plan result.
   */
  async retryStep(parentJobId, parentAgentName, originalPlan, planResult, stepId) {
    const planned = retryPlanner.buildStepRetryPlan(originalPlan, planResult, stepId);
    if (!planned.ok) {
      jobManager.logStep(parentJobId, `[retry:${stepId}] aborted — ${planned.reason}`);
      return { ...planResult, retryAbortReason: planned.reason };
    }

    edeEventBus.emit("retry.start", { parentJobId, stepId, mode: "step" });
    jobManager.logStep(parentJobId, `[retry:${stepId}] running isolated retry`);
    const retryResult = await this.runPlan(parentJobId, parentAgentName, planned.plan);

    const diff = stateDiffValidator.validate(planResult, retryResult);
    if (!diff.ok) {
      edeEventBus.emit("retry.rejected", { parentJobId, stepId, reason: diff.reason });
      jobManager.logStep(parentJobId, `[retry:${stepId}] rejected — ${diff.reason}`);
      return { ...planResult, retryRejected: true, retryDiff: diff };
    }

    edeEventBus.emit("retry.complete", { parentJobId, stepId, improvements: diff.improvements.length });
    return stateDiffValidator.merge(planResult, retryResult);
  },

  /**
   * Replay all steps in groups >= fromGroupIndex, skipping already-completed steps.
   * Returns the merged plan result.
   */
  async replayFrom(parentJobId, parentAgentName, originalPlan, planResult, fromGroupIndex) {
    const planned = retryPlanner.buildGroupReplayPlan(originalPlan, planResult, fromGroupIndex);
    if (!planned.ok) {
      jobManager.logStep(parentJobId, `[replay:g${fromGroupIndex}] aborted — ${planned.reason}`);
      return { ...planResult, retryAbortReason: planned.reason };
    }

    edeEventBus.emit("retry.start", { parentJobId, fromGroupIndex, retryCount: planned.retryIds.length, mode: "replay" });
    jobManager.logStep(
      parentJobId,
      `[replay:g${fromGroupIndex}] replaying ${planned.retryIds.length} step(s)`
    );
    const replayResult = await this.runPlan(parentJobId, parentAgentName, planned.plan);

    const diff = stateDiffValidator.validate(planResult, replayResult);
    if (!diff.ok) {
      edeEventBus.emit("retry.rejected", { parentJobId, fromGroupIndex, reason: diff.reason });
      jobManager.logStep(parentJobId, `[replay:g${fromGroupIndex}] rejected — ${diff.reason}`);
      return { ...planResult, retryRejected: true, retryDiff: diff };
    }

    edeEventBus.emit("retry.complete", { parentJobId, fromGroupIndex, improvements: diff.improvements.length });
    return stateDiffValidator.merge(planResult, replayResult);
  },

  // ── Internal ───────────────────────────────────────────────────────────────

  async _runStep(parentJobId, parentAgentName, step) {
    try {
      return await toolDispatcher.runSubAgent(
        parentJobId,
        parentAgentName,
        step.subAgent,
        step.tool,
        step.input
      );
    } catch (err) {
      return { ok: false, tool: step.tool, error: err?.message ?? String(err) };
    }
  },

  /** Build the canonical per-step state record. */
  _stepRecord(step, groupIndex, status, result, error, childJobId, reason, executionClass = null) {
    return {
      status,
      // ④ Execution classification: "success" | "business_failure" | "system_failure" | null
      executionClass: executionClass ?? null,
      reason:         reason ?? null,
      groupIndex,
      agentName:      step.subAgent,
      toolName:       step.tool,
      result:         result ?? null,
      error:          error  ?? null,
      childJobId:     childJobId ?? null,
      // Deterministic identity for retry targeting — stable across runs
      executionHash:  `${step.subAgent}:${step.tool}:${step.id}`,
    };
  },

  /** Build the top-level plan result object from canonical steps map. */
  _buildResult(planId, planName, parentJobId, agent, groupCount, planStatus, steps, pendingSteps) {
    // Any step in pendingSteps was never processed (validation/cycle failure)
    for (const step of pendingSteps) {
      if (!steps[step.id]) {
        steps[step.id] = this._stepRecord(
          step, -1, "skipped", null, null, null,
          "plan_rejected_before_execution"
        );
      }
    }

    const all       = Object.values(steps);
    const completed = all.filter(s => s.status === "completed").length;
    const failed    = all.filter(s => s.status === "failed").length;
    const skipped   = all.filter(s => s.status === "skipped").length;

    const phase = planStatus === "failed" ? "failed" : "completed";

    return {
      ok:          planStatus !== "failed",
      status:      planStatus,
      planId,
      planName,
      parentJobId,
      agent,
      groupCount,
      phase,
      steps,
      counts:      { completed, failed, skipped, total: all.length },
    };
  },
};
