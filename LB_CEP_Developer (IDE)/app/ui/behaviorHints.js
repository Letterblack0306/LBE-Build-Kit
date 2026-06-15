import { intelligenceStore } from "./intelligenceStore.js";

export const behaviorHints = {
  generate(memory) {
    const hints = [];

    // 1. Expert Hints (Historical/Persistent from Audit Logs)
    const expertHints = intelligenceStore.getExpertHints();
    hints.push(...expertHints);

    // 2. Session Hints (Short-term)
    const recentErrors = memory.errors || [];
    const recentTxns   = memory.transactions || [];

    // Analyze path errors
    if (recentErrors.some(e => e.code === "PATH_TRAVERSAL_BLOCKED" || e.code === "OUT_OF_PROJECT_BLOCKED")) {
      hints.push("CRITICAL: Your previous file path suggestions were blocked. Ensure all file paths are relative to the project root and do not contain '../' or absolute paths.");
    }

    // Analyze failed commits
    const failures = recentTxns.filter(t => t.status === "error" || t.status === "failed");
    if (failures.length > 0) {
      hints.push("NOTICE: Some recent file writes failed. double-check that your code blocks are complete and valid before suggesting them.");
    }

    // Generic adaptive hints
    if (recentErrors.some(e => e.stage === "chat" && e.code === "ABORT_ERROR")) {
      hints.push("The user stopped your last response. Try to be more concise and get to the point faster.");
    }

    // 3. Escalation hints — triggered by repeated SECURITY violations
    const violations = memory.securityViolations || 0;
    if (memory.escalated) {
      hints.push(
        "CRITICAL SECURITY RESTRICTION ACTIVE: Multiple security violations have been detected in this session. " +
        "All file writes require manual approval — auto-commit is disabled. " +
        "Do NOT use eval(), dynamic script injection, innerHTML, or any pattern flagged as dangerous."
      );
    } else if (violations > 0) {
      hints.push(
        `WARNING: ${violations} security violation(s) detected this session. ` +
        `${3 - violations} more will trigger full agent restriction. Avoid dangerous code patterns.`
      );
    }

    return hints;
  },

  getHintsPrompt(memory) {
    const hints = this.generate(memory);
    if (hints.length === 0) return "";

    return `\n\n[EXPERT GUIDANCE (Based on history and session)]\n- ${hints.join("\n- ")}\n`;
  }
};
