import { agentRegistry } from "./agentRegistry.js";
import { executionContract } from "./executionContract.js";
import { jobManager } from "./jobManager.js";
import { patchManager } from "../../patchManager.js";
import { persistentMemory } from "../../persistentMemory.js";
import { sessionMemory } from "../../sessionMemory.js";
import { faultInjector } from "./faultInjector.js";
import { edeEventBus } from "./edeEventBus.js";

/**
 * OpenClaw Tool Dispatcher
 *
 * Single gateway for ALL tool calls. No code may invoke a tool directly.
 *
 * Every call returns: { ok, tool, output } | { ok, tool, error }
 *
 * Two entry points:
 *  - run(jobId, agentName, toolName, input)
 *      For parent agents calling tools directly.
 *  - runSubAgent(parentJobId, parentAgentName, subAgentName, toolName, input)
 *      For spawning a sub-agent tool call. Creates a child job, validates
 *      the result against executionContract, completes the child job.
 *      The parent job is NEVER touched.
 *
 * Tools (replace direct use of patchEngine / validator / transactionManager):
 *  - file_read          → window.ide.readFile
 *  - patchEngine        → patchManager.applyPatch    (replaces direct patchEngine calls)
 *  - validator          → patchManager.validate       (replaces direct validator calls)
 *  - transactionManager → window.ide.executeWriteTransaction (replaces direct txn calls)
 *  - memoryStore        → persistentMemory.log
 *  - buildKit           → fire-and-forget command event (results arrive via SSE)
 */
export const toolDispatcher = {
  _auditLimit: 400,

  _summarizeText(value) {
    if (!value) return null;
    const text = String(value);
    if (text.length <= this._auditLimit) return text;
    return text.slice(0, this._auditLimit) + "…";
  },

  _summarizeInput(toolName, input) {
    if (!input) return null;
    switch (toolName) {
      case "file_read":
        return { path: input.path };
      case "file_search":
        return { rootPath: input.rootPath, query: this._summarizeText(input.query), options: input.options || {} };
      case "patchEngine":
        return { patchId: input?.patch?.id || null };
      case "validator":
        return { size: typeof input?.patch === "string" ? input.patch.length : null };
      case "transactionManager":
        return { fileCount: Array.isArray(input?.files) ? input.files.length : null };
      case "buildKit":
        return { command: this._summarizeText(input?.command) };
      case "memoryStore":
        return { type: input?.entry?.type || null };
      default:
        return null;
    }
  },

  _summarizeOutput(toolName, output) {
    if (!output) return null;
    switch (toolName) {
      case "file_read":
        return { ok: output.ok, size: typeof output.content === "string" ? output.content.length : null };
      case "file_search":
        return { count: Array.isArray(output) ? output.length : null };
      case "patchEngine":
        return { ok: true };
      case "validator":
        return { ok: output.ok };
      case "transactionManager":
        return { ok: output.ok, txnId: output.txnId || null };
      case "buildKit":
        return { ok: true, dispatched: output.dispatched || false };
      case "memoryStore":
        return { ok: output.ok };
      default:
        return null;
    }
  },

  async _auditToolEvent(eventType, jobId, agentName, toolName, input, output, error) {
    const projectRoot = window.__LB_PROJECT_ROOT__ || null;
    if (!window.ide?.appendAuditLog || !projectRoot) return;
    const entry = {
      eventType,
      jobId,
      actor: { type: "agent", name: agentName },
      summary: { tool: toolName },
      payload: {
        input: this._summarizeInput(toolName, input),
        output: this._summarizeOutput(toolName, output),
        error: error ? this._summarizeText(error) : null,
      },
    };
    await window.ide.appendAuditLog(projectRoot, entry);
  },

  // ── Output schemas — per-tool structural validation ───────────────────────
  //
  // Each entry is a function(output) → null | string
  // Returns null if valid, or an error string describing the violation.
  // Missing schema = no output validation (safe default for read-only tools).

  outputSchemas: {
    file_read: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (typeof o.ok !== "boolean") return "missing ok boolean";
      return null;
    },
    patchEngine: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (typeof o.ok !== "boolean") return "missing ok boolean";
      if (o.ok && typeof o.content === "undefined") return "missing content on success";
      return null;
    },
    validator: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (typeof o.ok !== "boolean") return "missing ok boolean";
      return null;
    },
    transactionManager: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (typeof o.ok !== "boolean") return "missing ok boolean";
      return null;
    },
    memoryStore: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (typeof o.ok !== "boolean") return "missing ok boolean";
      return null;
    },
    buildKit: (o) => {
      if (o === null || o === undefined) return "output is null";
      if (o.ok !== true) return "buildKit must always return ok: true";
      if (typeof o.dispatched !== "boolean") return "missing dispatched boolean";
      return null;
    },
  },

  _validateOutput(toolName, output) {
    const schema = this.outputSchemas[toolName];
    if (!schema) return null; // no schema defined — pass
    return schema(output);
  },

  // ── Tool implementations ──────────────────────────────────────────────────

  toolMap: {
    file_read: async (input) => {
      const res = await window.ide.readFile(input.path);
      // Normalise: IPC returns { ok, content } — surface as { ok, content }
      return res;
    },

    // replaces: direct patchEngine usage
    patchEngine: (input) => {
      const result = patchManager.applyPatch(input.original, input.patch);
      return { ok: true, content: result };
    },

    // replaces: direct validator usage
    validator: (input) => {
      const result = patchManager.validate(input.patch);
      // patchManager.validate returns { ok, error? }
      return result;
    },

    // replaces: direct transactionManager usage
    transactionManager: async (input) => {
      const res = await window.ide.executeWriteTransaction(input);
      return res;
    },

    memoryStore: async (input) => {
      await persistentMemory.log(input.projectRoot, input.entry);
      return { ok: true };
    },

    // buildKit is fire-and-forget — results arrive via SSE stream
    buildKit: (input) => {
      window.dispatchEvent(
        new CustomEvent("run-authorized-command", { detail: input.command })
      );
      return { ok: true, dispatched: true, command: input.command };
    },
  },

  // ── Parent-agent tool call ────────────────────────────────────────────────

  /**
   * Run a tool on behalf of a parent agent.
   * Returns { ok, tool, output } | { ok: false, tool, error }
   */
  async run(jobId, agentName, toolName, input) {
    // 1. Unknown agent rejection — must be registered before calling any tool
    if (!agentRegistry.get(agentName)) {
      await this._logDeny(jobId, agentName, toolName, "UNKNOWN_AGENT");
      return { ok: false, tool: toolName, error: `UNKNOWN_AGENT: ${agentName}` };
    }

    // 2. Permission check (includes escalation context)
    const escalated = sessionMemory.isEscalated();
    if (!agentRegistry.canUseTool(agentName, toolName, { escalated })) {
      const reason = escalated && agentRegistry.isHighRisk(toolName)
        ? "ESCALATION_TOOL_BLOCKED"
        : "TOOL_NOT_ALLOWED";
      await this._logDeny(jobId, agentName, toolName, reason);
      return { ok: false, tool: toolName, error: reason };
    }

    // 3. Hard safety: read-only agents cannot call mutating tools
    const MUTATING = ["patchEngine", "transactionManager", "buildKit"];
    if (agentRegistry.isReadOnly(agentName) && MUTATING.includes(toolName)) {
      const msg = `${agentName} is read-only — blocked mutation tool: ${toolName}`;
      console.error("[ToolDispatcher] BLOCKED:", msg);
      await this._logDeny(jobId, agentName, toolName, "READ_ONLY_AGENT_MUTATION_BLOCKED");
      return { ok: false, tool: toolName, error: "READ_ONLY_AGENT_MUTATION_BLOCKED" };
    }

    // 4. Implementation check
    if (!this.toolMap[toolName]) {
      await this._auditToolEvent("tool.error", jobId, agentName, toolName, input, null, "TOOL_NOT_FOUND");
      return { ok: false, tool: toolName, error: "TOOL_NOT_FOUND" };
    }

    // 5. Fault injection (EDE only — no-op in normal operation)
    const faultErr = faultInjector.shouldFail(toolName, input?.__stepId ?? null);
    if (faultErr) {
      edeEventBus.emit("tool.fault_injected", { jobId, agentName, toolName, reason: faultErr });
      jobManager.logStep(jobId, `[EDE] Fault injected: ${toolName} — ${faultErr}`);
      await this._auditToolEvent("tool.fault_injected", jobId, agentName, toolName, input, null, faultErr);
      return { ok: false, tool: toolName, error: faultErr };
    }

    // 6. Execution
    try {
      await faultInjector.applyDelay();
      edeEventBus.emit("tool.call", { jobId, agentName, toolName });
      jobManager.logStep(jobId, `Tool: ${toolName}`);
      await this._auditToolEvent("tool.call", jobId, agentName, toolName, input, null, null);
      const output = await this.toolMap[toolName](input);

      // 7. Output schema validation
      const schemaError = this._validateOutput(toolName, output);
      if (schemaError) {
        const msg = `OUTPUT_SCHEMA_VIOLATION: ${toolName} — ${schemaError}`;
        console.error("[ToolDispatcher]", msg);
        edeEventBus.emit("tool.error", { jobId, agentName, toolName, error: msg });
        await this._auditToolEvent("tool.error", jobId, agentName, toolName, input, null, msg);
        await this._logResult(jobId, agentName, toolName, false, msg);
        return { ok: false, tool: toolName, error: msg };
      }

      edeEventBus.emit("tool.ok", { jobId, agentName, toolName });
      await this._auditToolEvent("tool.ok", jobId, agentName, toolName, input, output, null);
      await this._logResult(jobId, agentName, toolName, true);
      return { ok: true, tool: toolName, output };
    } catch (err) {
      const errMsg = err?.message || String(err);
      edeEventBus.emit("tool.error", { jobId, agentName, toolName, error: errMsg });
      await this._auditToolEvent("tool.error", jobId, agentName, toolName, input, null, errMsg);
      await this._logResult(jobId, agentName, toolName, false, errMsg);
      return { ok: false, tool: toolName, error: errMsg };
    }
  },

  // ── Sub-agent tool call ───────────────────────────────────────────────────

  /**
   * Spawn a sub-agent to run a single tool.
   *
   * Enforces:
   *  - Parent must be allowed to spawn this sub-agent (agentRegistry.canSpawn)
   *  - Sub-agent must be allowed to use the tool
   *  - Sub-agent result is validated against executionContract.validateSubAgentResult
   *  - A child job is created and completed — the PARENT JOB IS NOT TOUCHED
   *
   * Returns { ok, tool, output, childJobId } | { ok: false, tool, error, childJobId? }
   */
  async runSubAgent(parentJobId, parentAgentName, subAgentName, toolName, input) {
    // 1. Spawn permission
    if (!agentRegistry.canSpawn(parentAgentName, subAgentName)) {
      await this._logDeny(parentJobId, parentAgentName, toolName, "SPAWN_NOT_ALLOWED");
      return { ok: false, tool: toolName, error: `SPAWN_NOT_ALLOWED: ${parentAgentName} → ${subAgentName}` };
    }

    // 2. Sub-agent tool permission
    if (!agentRegistry.canUseTool(subAgentName, toolName)) {
      await this._logDeny(parentJobId, subAgentName, toolName, "SUB_AGENT_TOOL_NOT_ALLOWED");
      return { ok: false, tool: toolName, error: `SUB_AGENT_TOOL_NOT_ALLOWED: ${subAgentName}.${toolName}` };
    }

    // 3. Create child job (parent job untouched from here)
    const childJob = jobManager.createJob(`subagent_${toolName}`, subAgentName, parentJobId);

    // 4. Run the tool through the standard path (inherits all safety checks)
    const toolResult = await this.run(childJob.id, subAgentName, toolName, input);

    // 5. Build sub-agent contract payload
    const subPayload = executionContract.wrapResult(
      toolResult.ok ? "completed" : "failed",
      toolResult.ok ? `${subAgentName}:${toolName} succeeded` : `${subAgentName}:${toolName} failed: ${toolResult.error}`,
      toolResult.ok ? toolResult.output : null,
      toolResult.ok ? null : toolResult.error,
      parentJobId  // parentJobId is mandatory for sub-agent payloads
    );

    // 6. Validate against sub-agent contract
    const validation = executionContract.validateSubAgentResult(subPayload);
    if (!validation.ok) {
      jobManager.failJob(childJob.id, { code: "CONTRACT_VIOLATION", message: validation.reason });
      return {
        ok:         false,
        tool:       toolName,
        error:      `CONTRACT_VIOLATION:${validation.reason}`,
        childJobId: childJob.id,
      };
    }

    // 7. Complete the child job — NOT the parent
    await jobManager.completeSubJob(childJob.id, subPayload);

    return {
      ok:         toolResult.ok,
      tool:       toolName,
      output:     toolResult.output,
      childJobId: childJob.id,
    };
  },

  // ── Internal logging ──────────────────────────────────────────────────────

  async _logDeny(jobId, agentName, toolName, reason) {
    edeEventBus.emit("tool.denied", { jobId, agentName, toolName, reason });
    jobManager.logStep(jobId, `DENIED: ${agentName}.${toolName} — ${reason}`);
    await this._auditToolEvent("tool.denied", jobId, agentName, toolName, null, null, reason);
    sessionMemory.logError("DISPATCH_DENIED", `${agentName}.${toolName}: ${reason}`, "dispatcher");
  },

  async _logResult(jobId, agentName, toolName, ok, error = null) {
    jobManager.logStep(jobId, `Tool ${ok ? "OK" : "ERR"}: ${toolName}${error ? " — " + error : ""}`);
    if (!ok) {
      sessionMemory.logError("TOOL_FAILURE", `${agentName}.${toolName}: ${error}`, "dispatcher");
    }
  },
};
