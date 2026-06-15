/**
 * Agent Registry
 * Defines capabilities and permissions for different agent types.
 */
export const agentRegistry = {
  agents: {
    "gemini": {
      name: "Gemini Engine",
      capabilities: ["file_read", "file_write", "build_kit_command", "terminal_link"],
      riskLevel: "governed"
    },
    "local": {
      name: "Local Executor",
      capabilities: ["file_read", "build_kit_command"],
      riskLevel: "restricted"
    },
    "sub-agent": {
      name: "Specialized Sub-Agent",
      capabilities: ["file_read", "file_write"],
      riskLevel: "isolated"
    }
  },

  getAgent(id) {
    return this.agents[id] || this.agents["sub-agent"];
  },

  canExecute(agentId, toolId) {
    const agent = this.getAgent(agentId);
    return agent.capabilities.includes(toolId);
  }
};
