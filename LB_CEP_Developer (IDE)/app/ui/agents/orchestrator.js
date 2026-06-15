import { AgentRegistry, normalizeAgentStepResult } from "./agentRegistry.js";
import { executeWithRetry, normalizeError } from "./retryPolicy.js";

export const ParallelFailurePolicy = {
    FAIL_FAST: "fail_fast",
    COMPLETE_GROUP: "complete_group",
    ISOLATE_FAILURES: "isolate_failures"
};

export const ResourceLocks = {
    active: new Set(),
    acquire(resourceKey) {
        if (this.active.has(resourceKey)) return false;
        this.active.add(resourceKey);
        return true;
    },
    release(resourceKey) {
        this.active.delete(resourceKey);
    }
};

export function groupReadyStepsForParallel(steps) {
    const groups = [];
    const parallelBuckets = new Map();

    for (const step of steps) {
        if (step.parallelGroup) {
            if (!parallelBuckets.has(step.parallelGroup)) {
                parallelBuckets.set(step.parallelGroup, []);
            }
            parallelBuckets.get(step.parallelGroup).push(step);
        } else {
            groups.push({ mode: "serial", steps: [step] });
        }
    }

    for (const bucket of parallelBuckets.values()) {
        groups.push({ mode: "parallel", steps: bucket });
    }

    return groups;
}

function summarizePlan(plan, results, completed, failed) {
    const status = failed.size > 0
        ? (completed.size > 0 ? "partial_success" : "failed")
        : "success";
    return {
        planId: plan.planId,
        strategy: plan.strategy,
        status,
        totals: {
            total: plan.steps.length,
            completed: completed.size,
            failed: failed.size,
            pending: plan.steps.length - completed.size - failed.size,
        },
        results,
    };
}

export async function runPlan(plan, executeStep, options = {}) {
    const results = {};
    const completed = new Set();
    const failed = new Set();
    const failurePolicy = options.failurePolicy || ParallelFailurePolicy.COMPLETE_GROUP;

    while (completed.size + failed.size < plan.steps.length) {
        const readySteps = plan.steps.filter((step) => {
            if (completed.has(step.id) || failed.has(step.id)) return false;
            return (step.dependsOn || []).every((dep) => completed.has(dep));
        });

        if (!readySteps.length) break;

        const grouped = groupReadyStepsForParallel(readySteps);

        for (const group of grouped) {
            if (group.mode === "parallel") {
                const settled = await Promise.allSettled(
                    group.steps.map((step) => executeWithRetry(step, (s) => executeStep(s, results)))
                );

                settled.forEach((item, index) => {
                    const step = group.steps[index];
                    if (item.status === "fulfilled") {
                        const value = normalizeAgentStepResult({ stepId: step.id, ...item.value });
                        results[step.id] = value;
                        if (value.status === "failed") failed.add(step.id);
                        else completed.add(step.id);
                    } else {
                        results[step.id] = normalizeAgentStepResult({
                            stepId: step.id,
                            agentId: step.agent,
                            status: "failed",
                            summary: `Step ${step.id} failed`,
                            error: normalizeError(item.reason, step.agent),
                        });
                        failed.add(step.id);
                    }
                });

                if (failurePolicy === ParallelFailurePolicy.FAIL_FAST && [...group.steps].some((s) => failed.has(s.id))) {
                    return summarizePlan(plan, results, completed, failed);
                }
            } else {
                for (const step of group.steps) {
                    if (!AgentRegistry.exists(step.agent)) {
                        results[step.id] = normalizeAgentStepResult({
                            stepId: step.id,
                            agentId: step.agent,
                            status: "failed",
                            summary: `Unknown agent: ${step.agent}`,
                            error: normalizeError({ code: "UNKNOWN_AGENT", message: `Agent not registered: ${step.agent}` }, step.agent),
                        });
                        failed.add(step.id);
                        continue;
                    }

                    const result = normalizeAgentStepResult({
                        stepId: step.id,
                        ...(await executeWithRetry(step, (s) => executeStep(s, results)))
                    });

                    results[step.id] = result;
                    if (result.status === "failed") failed.add(step.id);
                    else completed.add(step.id);

                    if (failurePolicy === ParallelFailurePolicy.FAIL_FAST && result.status === "failed") {
                        return summarizePlan(plan, results, completed, failed);
                    }
                }
            }
        }
    }

    return summarizePlan(plan, results, completed, failed);
}
