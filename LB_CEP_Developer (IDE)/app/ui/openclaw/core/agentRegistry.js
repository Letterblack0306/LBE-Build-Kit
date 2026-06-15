/**
 * OpenClaw Agent Registry
 * Defines tool permissions and sub-agent spawning rules per agent.
 *
 * Rules enforced here:
 *  - Each agent has an explicit tool allowlist.
 *  - Each agent has an explicit sub-agent spawn allowlist.
 *  - Sub-agents (isSubAgent=true) cannot spawn further sub-agents.
 *  - system_auditor is permanently read-only — no mutating tools.
 *  - When session is escalated, HIGH-risk tools are blocked for all agents.
 *
 * Tool risk tiers (enforced in canUseTool when escalated):
 *  HIGH   — patchEngine, transactionManager, buildKit (write/execute state)
 *  MEDIUM — validator  (read + side effects)
 *  LOW    — file_read, memoryStore (read-only)
 */

const TOOL_RISK = {
  patchEngine:        "HIGH",
  transactionManager: "HIGH",
  buildKit:           "HIGH",
  validator:          "MEDIUM",
  file_read:          "LOW",
  memoryStore:        "LOW",
};

export const agentRegistry = {
  registry: {
    // ── Parent agents (AI providers) ───────────────────────────────────────
    gemini: {
      tools: ["file_read", "patchEngine", "validator", "transactionManager", "memoryStore", "buildKit"],
      allowedSubagents: ["syntax-agent", "diff-agent"],
      isSubAgent: false,
    },
    openai: {
      tools: ["file_read", "patchEngine", "validator", "transactionManager", "memoryStore", "buildKit"],
      allowedSubagents: ["syntax-agent", "diff-agent"],
      isSubAgent: false,
    },
    local: {
      tools: ["file_read", "patchEngine", "validator", "transactionManager", "memoryStore", "buildKit"],
      allowedSubagents: ["syntax-agent", "diff-agent"],
      isSubAgent: false,
    },

    // ── Specialised parent agent ───────────────────────────────────────────
    "patch-agent": {
      tools: ["file_read", "patchEngine", "validator", "transactionManager", "memoryStore"],
      allowedSubagents: ["syntax-agent", "diff-agent"],
      isSubAgent: false,
    },

    // ── Read-only auditor — must never mutate state ────────────────────────
    system_auditor: {
      tools: ["file_read", "memoryStore"],
      allowedSubagents: [],
      isSubAgent: false,
      readOnly: true,
    },

    // ── Sub-agents — cannot spawn further sub-agents ───────────────────────
    "syntax-agent": {
      tools: ["validator", "memoryStore"],
      allowedSubagents: [],  // sub-agents are terminal — no further spawning
      isSubAgent: true,
    },
    "diff-agent": {
      tools: ["file_read", "patchEngine", "memoryStore"],
      allowedSubagents: [],
      isSubAgent: true,
    },
  },

  // ── Lookups ───────────────────────────────────────────────────────────────

  get(agentName) {
    return this.registry[agentName] || null;
  },

  /**
   * Check if agentName is allowed to call toolName.
   *
   * @param {string}  agentName
   * @param {string}  toolName
   * @param {object}  [ctx]            Optional runtime context.
   * @param {boolean} [ctx.escalated]  If true, HIGH-risk tools are blocked for ALL agents.
   * @returns {boolean}
   */
  canUseTool(agentName, toolName, ctx = {}) {
    const entry = this.get(agentName);
    if (!entry) return false;                             // unknown agent — hard block
    if (!entry.tools.includes(toolName)) return false;    // not in allowlist

    // Escalation gate — HIGH-risk tools blocked across all agents when session is unsafe
    if (ctx.escalated && TOOL_RISK[toolName] === "HIGH") return false;

    return true;
  },

  canSpawn(agentName, subAgentName) {
    const entry = this.get(agentName);
    if (!entry) return false;
    // Sub-agents cannot spawn other sub-agents
    if (entry.isSubAgent) return false;
    return entry.allowedSubagents.includes(subAgentName);
  },

  isSubAgent(agentName) {
    return !!(this.get(agentName)?.isSubAgent);
  },

  isReadOnly(agentName) {
    return !!(this.get(agentName)?.readOnly);
  },

  isHighRisk(toolName) {
    return TOOL_RISK[toolName] === "HIGH";
  },

  getToolRisk(toolName) {
    return TOOL_RISK[toolName] || "LOW";
  },
};
