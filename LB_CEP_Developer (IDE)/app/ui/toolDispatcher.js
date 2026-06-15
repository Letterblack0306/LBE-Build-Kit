import { agentRegistry } from "./agentRegistry.js";
import { sessionMemory } from "./sessionMemory.js";
import { persistentMemory } from "./persistentMemory.js";
import { patchManager } from "./patchManager.js";

/**
 * Tool Dispatcher
 * The single entry point for all tool execution.
 * Enforces execution contracts and capability checks.
 */
export const toolDispatcher = {
  _ok(output) {
    return { ok: true, output };
  },
  _err(error) {
    return { ok: false, error };
  },
  async execute(agentId, toolId, payload, context = {}) {
    // 1. Capability Check
    if (!agentRegistry.canExecute(agentId, toolId)) {
      const err = { code: "UNAUTHORIZED_TOOL", message: `Agent ${agentId} is not authorized to use tool ${toolId}` };
      this.logFailure(agentId, toolId, err);
      throw err;
    }

    // 2. Execution Contract Validation
    const validation = this.validateContract(toolId, payload);
    if (!validation.ok) {
      const err = { code: "CONTRACT_VIOLATION", message: validation.error };
      this.logFailure(agentId, toolId, err);
      throw err;
    }

    // 3. Dispatch to internal handlers
    try {
      let result;
      let ok = true;
      switch (toolId) {
        case "file_read":
          result = await window.ide.readFile(payload.path);
          ok = Boolean(result?.ok);
          break;
        case "file_search":
          result = await window.ide.searchFiles(payload.rootPath, payload.query, payload.options || {});
          ok = Array.isArray(result);
          break;
        case "file_write":
          result = await window.ide.executeWriteTransaction(payload);
          ok = Boolean(result?.ok);
          break;
        case "transactionManager":
          result = await window.ide.executeWriteTransaction(payload);
          ok = Boolean(result?.ok);
          break;
        case "validator":
          result = patchManager.validate(payload?.patch || "");
          ok = Boolean(result?.ok);
          break;
        case "build_kit_command":
          result = await this.runBuildKit(payload.command);
          ok = true;
          break;
        default:
          throw { code: "UNKNOWN_TOOL", message: `Tool ${toolId} not implemented in dispatcher` };
      }
      
      if (ok) {
        this.logSuccess(agentId, toolId, payload);
        return this._ok(result);
      }
      const err = result?.error || result?.message || "Tool failed";
      this.logFailure(agentId, toolId, err);
      return this._err(err);
    } catch (err) {
      this.logFailure(agentId, toolId, err);
      return this._err(err);
    }
  },

  validateContract(toolId, payload) {
    if (!payload) return { ok: false, error: "Missing payload" };

    switch (toolId) {
      case "file_read":
        if (!payload.path) return { ok: false, error: "Missing path for file_read" };
        break;
      case "file_search":
        if (!payload.rootPath || !payload.query) return { ok: false, error: "Missing rootPath or query for file_search" };
        break;
      case "file_write":
        if (!payload.projectRoot || !payload.files) return { ok: false, error: "Malformed transaction payload" };
        break;
      case "build_kit_command":
        if (!payload.command || !payload.command.startsWith("ext-build")) {
          return { ok: false, error: "Unauthorized command string" };
        }
        break;
    }
    return { ok: true };
  },

  async runBuildKit(command) {
    return new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (e) => {
        if (e.data.ok) resolve(e.data.result);
        else reject(e.data.error);
      };
      window.dispatchEvent(new CustomEvent('run-authorized-command', {
        detail: { command, port: port2 }
      }));
    });
  },

  // run(jobId, provider, toolName, payload) — maps to execute() for app.js call sites
  async run(jobId, provider, toolName, payload, context = {}) {
    return this.execute(provider, toolName, payload, { jobId, ...context });
  },

  // runSubAgent(agentId, payload, context) — sub-agent dispatch alias
  async runSubAgent(agentId, payload, context = {}) {
    return this.execute(agentId, 'subagent', payload, context);
  },

  logSuccess(agentId, toolId, payload) {
    sessionMemory.logTransaction(`disp_${Date.now()}`, "success", [{ path: toolId }]);
  },

  logFailure(agentId, toolId, error) {
    sessionMemory.logError(error.code || "DISPATCH_ERROR", error.message, "dispatcher");
    persistentMemory.log(null, { type: "error", code: error.code, message: error.message, stage: "dispatcher" });
  }
};
