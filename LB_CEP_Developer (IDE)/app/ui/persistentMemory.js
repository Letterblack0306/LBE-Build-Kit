export const persistentMemory = {
  history: [],

  async log(projectRoot, entry) {
    if (!window.ide?.appendMemoryLog || !projectRoot) return;
    await window.ide.appendMemoryLog(projectRoot, entry);
    this.history.push({ ...entry, timestamp: Date.now() });
  },

  async load(projectRoot) {
    if (!window.ide?.readMemoryLog || !projectRoot) return;
    this.history = await window.ide.readMemoryLog(projectRoot);
  },

  getPastBehaviorSnippet() {
    if (this.history.length === 0) return "";

    // Extract key patterns from history
    const errors   = this.history.filter(h => h.type === "error");
    const txns     = this.history.filter(h => h.type === "transaction");
    const blocked  = this.history.filter(h => h.type === "blocked_file");

    let summary = `\n\n[PAST BEHAVIOR & EXPERIENCE]\n`;

    if (errors.length > 0) {
      summary += `Historical Errors:\n`;
      const uniqueErrors = [...new Set(errors.slice(-10).map(e => e.message || e.code))];
      uniqueErrors.forEach(msg => {
        summary += `- ${msg}\n`;
      });
    }

    if (txns.length > 0) {
      const failures = txns.filter(t => t.status === "error" || t.status === "failed");
      if (failures.length > 0) {
        summary += `Frequent failure points:\n`;
        const failedFiles = [...new Set(failures.slice(-10).flatMap(t => t.files || []))];
        failedFiles.forEach(f => {
          summary += `- Issue detected during previous writes to: ${f}\n`;
        });
      }
    }

    // Analyze retries
    const retryInitiated = this.history.filter(h => h.type === "retry_initiated").length;
    const retrySuccess   = this.history.filter(h => h.type === "retry_success").length;
    if (retryInitiated > 0) {
      summary += `\nAuto-fix Reliability:\n`;
      summary += `- Successful autonomous fixes: ${retrySuccess}/${retryInitiated}\n`;
      if (retrySuccess / retryInitiated < 0.5) {
        summary += `- Reliability is low. Be more conservative and double-check logic before output.\n`;
      }
    }

    // Learned restrictions — aggregate blocked_file history by category
    if (blocked.length > 0) {
      const byCategory = { SECURITY: [], POLICY: [], SYNTAX: [] };
      blocked.slice(-20).forEach(b => {
        const cat = b.category || "SYNTAX";
        if (byCategory[cat]) byCategory[cat].push(b.file);
      });

      summary += `\nLEARNED RESTRICTIONS (enforced by validation gate):\n`;

      if (byCategory.SECURITY.length > 0) {
        const uniqueFiles = [...new Set(byCategory.SECURITY)];
        summary += `- SECURITY violations detected in: ${uniqueFiles.join(", ")}. ` +
                   `Do NOT use eval(), dynamic script injection, or dangerous patterns in these files.\n`;
      }
      if (byCategory.POLICY.length > 0) {
        const uniqueFiles = [...new Set(byCategory.POLICY)];
        summary += `- POLICY violations detected in: ${uniqueFiles.join(", ")}. ` +
                   `Avoid innerHTML assignment, forbidden API calls, and protected path access.\n`;
      }
      if (byCategory.SYNTAX.length > 0) {
        const uniqueFiles = [...new Set(byCategory.SYNTAX)];
        summary += `- SYNTAX blocks on: ${uniqueFiles.join(", ")}. ` +
                   `Ensure all braces, brackets, and parentheses are balanced and complete.\n`;
      }
    }

    return summary;
  }
};
