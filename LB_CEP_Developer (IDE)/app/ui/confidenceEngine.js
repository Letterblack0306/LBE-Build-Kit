import { sessionMemory } from "./sessionMemory.js";

export const confidenceEngine = {
  learnedThresholds: { safe: 85, review: 60 },

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('confidence_thresholds') || 'null');
      if (saved) this.learnedThresholds = { ...this.learnedThresholds, ...saved };
    } catch {}
  },

  // Call after each transaction outcome with the file's score and whether it succeeded
  learn(score, success) {
    const { safe, review } = this.learnedThresholds;
    if (score >= safe && !success) {
      // something we rated safe actually failed → raise the safe bar
      this.learnedThresholds.safe = Math.min(97, safe + 2);
    } else if (score < review && success) {
      // something we rated risky actually succeeded → lower review threshold
      this.learnedThresholds.review = Math.max(40, review - 2);
    } else if (score >= safe && success) {
      // correct safe prediction → slightly relax threshold
      this.learnedThresholds.safe = Math.max(75, safe - 1);
    }
    localStorage.setItem('confidence_thresholds', JSON.stringify(this.learnedThresholds));
  },

  score(file, context = {}) {
    let score = 100;

    // 1. Content-based Risk Deductions
    if (file.content.length > 2000) score -= 20;
    if (file.content.includes("eval(")) score -= 50;
    if (file.content.includes("innerHTML")) score -= 15;
    if (file.content.includes("import ")) score -= 40;
    if (file.content.includes("require(")) score -= 40;

    // 2. Structural Deductions
    if (!file.isPatch) score -= 15;
    if (context.fileCount > 3) score -= 20;

    // 3. History-based Deductions
    const memory = sessionMemory.getSummary();
    const recentErrors = (memory.errors || []).map(e => e.code);
    if (recentErrors.includes("SYNTAX_ERROR")) score -= 10;
    if (recentErrors.includes("PATH_TRAVERSAL_BLOCKED")) score -= 15;

    // 4. Escalation Penalty — escalated sessions cannot score into "safe" tier
    if (memory.escalated) {
      score -= 40;  // forces score below safe threshold regardless of content
    } else if ((memory.securityViolations || 0) > 0) {
      score -= 10 * memory.securityViolations;  // progressive penalty per violation
    }

    // 4. Rewards
    if (file.isPatch && file.target) score += 10;

    return Math.max(0, Math.min(100, score));
  },

  classify(score) {
    if (score >= this.learnedThresholds.safe)   return { level: "safe",   label: "SAFE",   color: "var(--success)" };
    if (score >= this.learnedThresholds.review) return { level: "review", label: "REVIEW", color: "var(--warn)" };
    return { level: "risky", label: "RISKY", color: "var(--error)" };
  }
};
