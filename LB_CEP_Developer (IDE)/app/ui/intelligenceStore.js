export const intelligenceStore = {
  insights: {
    frequentErrors: [],
    successfulCommitRatio: 1,
    topProblematicFiles: []
  },

  async analyze(projectRoot) {
    if (!window.ide?.readAuditLog || !projectRoot) return;

    try {
      const logs = await window.ide.readAuditLog(projectRoot);
      const stats = {
        total: 0,
        failed: 0,
        errors: {},
        fileFailures: {}
      };

      logs.forEach(entry => {
        if (entry.eventType === "txn.commit_completed") {
          stats.total++;
        }
        if (entry.eventType === "txn.failed") {
          stats.failed++;
          const code = entry.payload?.error?.code || "UNKNOWN";
          stats.errors[code] = (stats.errors[code] || 0) + 1;
          
          // Track which files are causing issues
          (entry.summary?.files || []).forEach(f => {
            const path = f.relativePath || f.path;
            stats.fileFailures[path] = (stats.fileFailures[path] || 0) + 1;
          });
        }
      });

      this.insights.successfulCommitRatio = stats.total / (stats.total + stats.failed || 1);
      this.insights.frequentErrors = Object.entries(stats.errors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(e => e[0]);

      this.insights.topProblematicFiles = Object.entries(stats.fileFailures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(e => e[0]);

    } catch (e) {
      console.warn("Failed to analyze audit logs for intelligence", e);
    }
  },

  getExpertHints() {
    const hints = [];
    const { frequentErrors, topProblematicFiles } = this.insights;

    if (frequentErrors.includes("PATH_TRAVERSAL_BLOCKED")) {
      hints.push("History shows frequent path blocks. Be extremely careful with relative path strings.");
    }
    if (frequentErrors.includes("COMMIT_FAILED")) {
      hints.push("Recent writes failed to commit. Ensure code syntax is perfect before suggesting.");
    }
    if (topProblematicFiles.length > 0) {
      hints.push(`Historical data indicates issues modifying: ${topProblematicFiles.join(", ")}. Use PATCH mode surgically.`);
    }

    return hints;
  }
};
