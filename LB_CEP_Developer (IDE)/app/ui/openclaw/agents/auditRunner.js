import { streamChat } from "../../aiClient.js";
import { settingsStore } from "../../settingsStore.js";
import { jobManager } from "../core/jobManager.js";
import { executionContract } from "../core/executionContract.js";

export const auditRunner = {
  _running: false,

  async runAudit(projectRoot, onProgress, onComplete) {
    if (this._running || !projectRoot) return;
    this._running = true;
    
    const jobId = jobManager.createJob("system_audit", "system_auditor").id;
    jobManager.logStep(jobId, "Starting deep system audit");

    if (onProgress) onProgress("Initializing audit agent...");

    settingsStore.load();
    const cfg = settingsStore.config;

    // Load the agent contract
    let agentPrompt = "";
    try {
      const res = await window.ide.readFile(`${projectRoot}/app/ui/openclaw/agents/AUDIT_AGENT.md`);
      if (res.ok) agentPrompt = res.content;
    } catch (e) {
      console.error("Could not load AUDIT_AGENT.md", e);
    }

    const messages = [
      { role: "system", content: agentPrompt },
      { role: "user", content: `Execute full system audit on project root: ${projectRoot}. Return strictly valid JSON.` }
    ];

    let fullResponse = "";
    try {
      if (onProgress) onProgress("Analyzing execution layers...");
      for await (const chunk of streamChat(messages, cfg)) {
        fullResponse += chunk;
      }

      // Extract JSON from response
      const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/) || fullResponse.match(/{[\s\S]*}/);
      const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : fullResponse;
      
      const auditResult = JSON.parse(jsonString);

      // Validate against strict contract shape
      if (!this.isValidAuditResult(auditResult)) {
        throw new Error("Audit result missing required schema fields.");
      }

      jobManager.completeJob(
        jobId,
        executionContract.wrapResult(
          "completed",
          `Found ${auditResult.summary.total_issues} issues (${auditResult.summary.critical} critical)`,
          auditResult,
          null
        )
      );

      if (onComplete) onComplete(auditResult);
      return auditResult;

    } catch (err) {
      jobManager.failJob(jobId, err);
      console.error("Audit failed:", err);
      if (onComplete) onComplete(null, err);
      return null;
    } finally {
      this._running = false;
    }
  },

  isValidAuditResult(r) {
    if (!r || !r.summary || !r.issues || !r.system_health) return false;
    if (typeof r.summary.total_issues !== "number") return false;
    return true;
  }
};
