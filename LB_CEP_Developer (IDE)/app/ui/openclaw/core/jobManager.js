import { executionContract } from "./executionContract.js";
import { sessionMemory } from "../../sessionMemory.js";

/**
 * OpenClaw Job Manager
 * Tracks execution chains, parent-child relationships, and job states.
 *
 * Boundary rules enforced here:
 *  - Parent jobs (parentJobId = null) → completed via completeJob()
 *  - Child jobs  (parentJobId set)    → completed via completeSubJob()
 *  - Calling completeJob() on a child job is blocked.
 *  - Calling completeSubJob() on a parent job is blocked.
 *  - Sub-agents completing a parent job ID is structurally impossible
 *    because the dispatcher never gives sub-agents the parent's jobId.
 */
export const jobManager = {
  registry: new Map(), // jobId → jobState

  // ── Job creation ──────────────────────────────────────────────────────────

  createJob(type, agentName, parentJobId = null) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const state = {
      id:          jobId,
      type:        type,
      agent:       agentName,
      parentJobId: parentJobId,
      status:      "running",
      startTime:   Date.now(),
      endTime:     null,
      steps:       [],
      result:      null,
      error:       null,
      summary:     "",
    };
    this.registry.set(jobId, state);
    this.logStep(jobId, `Started ${type} by ${agentName}`);
    return state;
  },

  logStep(jobId, message) {
    const job = this.registry.get(jobId);
    if (!job) return;
    job.steps.push({ time: Date.now(), message });
    sessionMemory.logTransaction(jobId, "info", [{ path: message }]);
  },

  // ── Parent-job completion ─────────────────────────────────────────────────

  /**
   * Complete a PARENT job (parentJobId = null).
   * Blocked if called on a child/sub-agent job — use completeSubJob() instead.
   */
  async completeJob(jobId, payload) {
    const job = this.registry.get(jobId);
    if (!job) return null;

    // Enforce boundary: parent jobs only
    if (job.parentJobId !== null) {
      return this.failJob(jobId, {
        code:    "USE_COMPLETE_SUB_JOB",
        message: `Job ${jobId} is a child job — call completeSubJob() instead`,
      });
    }

    // Validate result against parent contract
    const validation = executionContract.validateResult(payload);
    if (!validation.ok) {
      return this.failJob(jobId, { code: "CONTRACT_VIOLATION", message: validation.reason });
    }

    job.status  = "completed";
    job.endTime = Date.now();
    job.result  = payload.result;
    job.summary = payload.summary;
    job.error   = payload.error;

    this.logStep(jobId, `Completed: ${payload.summary}`);
    return job;
  },

  // ── Sub-job completion ────────────────────────────────────────────────────

  /**
   * Complete a CHILD/sub-agent job (parentJobId must be set).
   * Blocked if called on a parent job — use completeJob() instead.
   * Validates the sub-agent contract (parentJobId required, restricted status).
   */
  async completeSubJob(childJobId, payload) {
    const job = this.registry.get(childJobId);
    if (!job) return null;

    // Enforce boundary: child jobs only
    if (!job.parentJobId) {
      return this.failJob(childJobId, {
        code:    "USE_COMPLETE_JOB",
        message: `Job ${childJobId} is a parent job — call completeJob() instead`,
      });
    }

    // Validate result against sub-agent contract
    const validation = executionContract.validateSubAgentResult(payload);
    if (!validation.ok) {
      return this.failJob(childJobId, { code: "CONTRACT_VIOLATION", message: validation.reason });
    }

    job.status  = payload.status;   // "completed" | "failed" only
    job.endTime = Date.now();
    job.result  = payload.result;
    job.summary = payload.summary;
    job.error   = payload.error;

    this.logStep(childJobId, `Sub-job ${payload.status}: ${payload.summary}`);
    return job;
  },

  // ── Failure ───────────────────────────────────────────────────────────────

  failJob(jobId, error) {
    const job = this.registry.get(jobId);
    if (!job) return null;

    job.status  = "failed";
    job.endTime = Date.now();
    job.error   = error;

    this.logStep(jobId, `Failed: ${error.message || error}`);
    sessionMemory.logError(error.code || "JOB_FAILURE", error.message, "job-manager");
    return job;
  },

  // ── Queries ───────────────────────────────────────────────────────────────

  getJob(jobId) {
    return this.registry.get(jobId) || null;
  },

  getChildJobs(parentJobId) {
    return Array.from(this.registry.values()).filter(j => j.parentJobId === parentJobId);
  },

  /**
   * Returns the full job tree rooted at jobId.
   * Each node is the job state object extended with a `children` array.
   */
  getJobTree(jobId) {
    const job = this.getJob(jobId);
    if (!job) return null;
    const children = this.getChildJobs(jobId).map(c => this.getJobTree(c.id));
    return { ...job, children };
  },

  /**
   * Returns true once all child jobs under parentJobId have finished
   * (status is not "running"). Returns false if there are no child jobs yet.
   */
  isPlanComplete(parentJobId) {
    const children = this.getChildJobs(parentJobId);
    return children.length > 0 && children.every(c => c.status !== "running");
  },

  /**
   * Returns true if any direct child job has status "failed".
   */
  hasFailedChildren(parentJobId) {
    return this.getChildJobs(parentJobId).some(c => c.status === "failed");
  },
};
