/**
 * OpenClaw Execution Plan
 *
 * Defines the schema for multi-step agent plans and resolves
 * step execution order by dependency analysis.
 *
 * Plan shape:
 *   {
 *     name: string,
 *     steps: [
 *       {
 *         id:         string,     // unique within this plan
 *         subAgent:   string,     // registered sub-agent name
 *         tool:       string,     // tool the sub-agent will call
 *         input:      object,     // tool input payload
 *         dependsOn?: string[],   // step IDs that must complete first
 *         critical?:  boolean,    // default true — abort plan on failure
 *       }
 *     ]
 *   }
 *
 * resolveGroups() returns steps ordered into parallel execution groups.
 * All steps in group N can run concurrently; group N+1 waits for group N.
 */
export const executionPlan = {

  // ── Validation ─────────────────────────────────────────────────────────────

  validate(plan) {
    if (!plan || typeof plan !== "object") {
      return { ok: false, reason: "PLAN_MISSING" };
    }
    if (typeof plan.name !== "string" || plan.name.trim() === "") {
      return { ok: false, reason: "PLAN_NAME_MISSING" };
    }
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      return { ok: false, reason: "PLAN_STEPS_EMPTY" };
    }

    const ids = new Set();
    for (const step of plan.steps) {
      if (!step.id || typeof step.id !== "string") {
        return { ok: false, reason: "STEP_ID_MISSING" };
      }
      if (ids.has(step.id)) {
        return { ok: false, reason: `STEP_ID_DUPLICATE:${step.id}` };
      }
      ids.add(step.id);

      if (!step.subAgent || typeof step.subAgent !== "string") {
        return { ok: false, reason: `STEP_SUB_AGENT_MISSING:${step.id}` };
      }
      if (!step.tool || typeof step.tool !== "string") {
        return { ok: false, reason: `STEP_TOOL_MISSING:${step.id}` };
      }
      if (!step.input || typeof step.input !== "object") {
        return { ok: false, reason: `STEP_INPUT_MISSING:${step.id}` };
      }
    }

    // Validate that dependsOn references exist
    for (const step of plan.steps) {
      for (const dep of (step.dependsOn || [])) {
        if (!ids.has(dep)) {
          return { ok: false, reason: `STEP_UNKNOWN_DEPENDENCY:${step.id}→${dep}` };
        }
        if (dep === step.id) {
          return { ok: false, reason: `STEP_SELF_DEPENDENCY:${step.id}` };
        }
      }
    }

    // Detect cycles via topological sort attempt
    const ordered = this._topoSort(plan.steps);
    if (!ordered) {
      return { ok: false, reason: "PLAN_CYCLIC_DEPENDENCY" };
    }

    return { ok: true };
  },

  // ── Group Resolution ────────────────────────────────────────────────────────

  /**
   * Returns an array of step-groups where all steps in each group
   * can run in parallel. Groups must execute sequentially.
   *
   * Example output for a 3-step chain A → B → C:
   *   [ [stepA], [stepB], [stepC] ]
   *
   * Example output for A, B independent, both feeding C:
   *   [ [stepA, stepB], [stepC] ]
   */
  resolveGroups(steps) {
    const resolved = new Set();   // step IDs that have been placed in a group
    const groups   = [];

    const remaining = () => steps.filter(s => !resolved.has(s.id));

    while (resolved.size < steps.length) {
      // Find all steps whose dependencies are fully resolved
      const ready = remaining().filter(s =>
        (s.dependsOn || []).every(dep => resolved.has(dep))
      );

      if (ready.length === 0) {
        // Cycle or unresolvable dependency — return null to signal error
        return null;
      }

      groups.push(ready);
      ready.forEach(s => resolved.add(s.id));
    }

    return groups;
  },

  // ── Internal ───────────────────────────────────────────────────────────────

  // Returns step array in topological order, or null if cycle detected
  _topoSort(steps) {
    const inDegree = new Map(steps.map(s => [s.id, 0]));
    const edges    = new Map(steps.map(s => [s.id, []]));

    for (const step of steps) {
      for (const dep of (step.dependsOn || [])) {
        edges.get(dep).push(step.id);
        inDegree.set(step.id, inDegree.get(step.id) + 1);
      }
    }

    const queue  = steps.filter(s => inDegree.get(s.id) === 0).map(s => s.id);
    const sorted = [];

    while (queue.length > 0) {
      const id = queue.shift();
      sorted.push(id);
      for (const next of (edges.get(id) || [])) {
        const deg = inDegree.get(next) - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }

    return sorted.length === steps.length ? sorted : null;
  },
};
