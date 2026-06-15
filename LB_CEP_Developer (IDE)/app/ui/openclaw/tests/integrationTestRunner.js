/**
 * OpenClaw Integration Test Runner
 *
 * Tests the full integrated execution path against real module singletons.
 * Uses controlled test tools injected into the dispatcher — no mocking of
 * module internals, no fake module substitution.
 *
 * Run from DevTools console:
 *   const { integrationTestRunner } = await import('./openclaw/tests/integrationTestRunner.js');
 *   await integrationTestRunner.run();
 *
 * Six scenarios:
 *   S1 — Happy path             (all steps succeed, 2 parallel groups)
 *   S2 — Partial success        (critical:false step fails, plan continues)
 *   S3 — Critical failure       (critical step fails, remaining groups abort)
 *   S4 — Dispatcher denial      (unknown agent / tool not allowed / escalation / read-only)
 *   S5 — Escalation lifecycle   (trigger, confirm, tool block, confidence penalty, reset/decay)
 *   S6 — Confidence + write     (score correctness, escalation penalty, retry eligibility)
 */

import { agentOrchestrator }  from "../core/agentOrchestrator.js";
import { toolDispatcher }     from "../core/toolDispatcher.js";
import { agentRegistry }      from "../core/agentRegistry.js";
import { jobManager }         from "../core/jobManager.js";
import { failureClassifier }  from "../core/failureClassifier.js";
import { retryPlanner }       from "../core/retryPlanner.js";
import { stateDiffValidator } from "../core/stateDiffValidator.js";
import { sessionMemory }      from "../../sessionMemory.js";
import { confidenceEngine }   from "../../confidenceEngine.js";
import { faultInjector }      from "../core/faultInjector.js";
import { edeEventBus }        from "../core/edeEventBus.js";

// ── Test infrastructure ───────────────────────────────────────────────────────

const PASS = "✅ PASS";
const FAIL = "❌ FAIL";

function assert(report, scenario, name, condition, extra = "") {
  const status = condition ? PASS : FAIL;
  report.push({ scenario, name, ok: condition, extra });
  console.log(`  ${status} ${name}${extra ? " — " + extra : ""}`);
}

function assertEq(report, scenario, name, actual, expected) {
  const ok = actual === expected;
  assert(report, scenario, name, ok, ok ? "" : `got "${actual}", expected "${expected}"`);
}

function assertContains(report, scenario, name, str, token) {
  const ok = String(str ?? "").includes(token);
  assert(report, scenario, name, ok, ok ? "" : `"${str}" does not contain "${token}"`);
}

function createParentJob(label) {
  return jobManager.createJob(`test_${label}`, "test-agent");
}

// ── Test infrastructure: inject/remove test tools + agents ────────────────────

function setupTestInfra() {
  // test_succeed: signals operation success (no throw, ok:true output)
  toolDispatcher.toolMap["test_succeed"] = (input) => ({
    ok:      true,
    content: input.value ?? "ok",
  });

  // test_fail: throws so the dispatcher returns ok:false with the reason message
  // This is the production-equivalent path (same as network errors, IPC failures)
  toolDispatcher.toolMap["test_fail"] = (input) => {
    throw new Error(input.failReason ?? "TEST_FORCED_FAILURE");
  };

  // test-agent: parent agent with access to test tools + real memoryStore
  agentRegistry.registry["test-agent"] = {
    tools:            ["test_succeed", "test_fail", "memoryStore"],
    allowedSubagents: ["test-subagent"],
    isSubAgent:       false,
  };

  // test-subagent: terminal sub-agent used by orchestrator scenarios
  agentRegistry.registry["test-subagent"] = {
    tools:            ["test_succeed", "test_fail", "memoryStore"],
    allowedSubagents: [],
    isSubAgent:       true,
  };
}

function teardownTestInfra() {
  delete toolDispatcher.toolMap["test_succeed"];
  delete toolDispatcher.toolMap["test_fail"];
  delete agentRegistry.registry["test-agent"];
  delete agentRegistry.registry["test-subagent"];
  sessionMemory.resetEscalation();
  faultInjector.reset();
  edeEventBus.clear();
}

// ── Scenario builders ─────────────────────────────────────────────────────────

// Plan: [A] → [B, C]  (all succeed)
const PLAN_HAPPY = {
  name:  "test-happy",
  steps: [
    { id: "A", subAgent: "test-subagent", tool: "test_succeed", input: { value: "A" } },
    { id: "B", subAgent: "test-subagent", tool: "test_succeed", input: { value: "B" }, dependsOn: ["A"] },
    { id: "C", subAgent: "test-subagent", tool: "test_succeed", input: { value: "C" }, dependsOn: ["A"] },
  ],
};

// Plan: [A, C] → [B(dep:A, fail, non-critical)] → [D(dep:B)]
const PLAN_PARTIAL = {
  name:  "test-partial",
  steps: [
    { id: "A", subAgent: "test-subagent", tool: "test_succeed", input: { value: "A" } },
    { id: "C", subAgent: "test-subagent", tool: "test_succeed", input: { value: "C" } },
    { id: "B", subAgent: "test-subagent", tool: "test_fail",    input: { failReason: "TRANSIENT_ERROR" }, dependsOn: ["A"], critical: false },
    { id: "D", subAgent: "test-subagent", tool: "test_succeed", input: { value: "D" }, dependsOn: ["B"] },
  ],
};

// Plan: [A(fail, critical)] → [B(dep:A), C(dep:A)]
const PLAN_CRITICAL = {
  name:  "test-critical",
  steps: [
    { id: "A", subAgent: "test-subagent", tool: "test_fail",    input: { failReason: "FATAL_ERROR" }, critical: true },
    { id: "B", subAgent: "test-subagent", tool: "test_succeed", input: { value: "B" }, dependsOn: ["A"] },
    { id: "C", subAgent: "test-subagent", tool: "test_succeed", input: { value: "C" }, dependsOn: ["A"] },
  ],
};

// ── S1: Happy Path ─────────────────────────────────────────────────────────────

async function s1_happyPath(report) {
  console.group("S1 — Happy Path");
  const job    = createParentJob("s1");
  const result = await agentOrchestrator.runPlan(job.id, "test-agent", PLAN_HAPPY);

  assertEq(report, "S1", "plan status = success",        result.status,              "success");
  assertEq(report, "S1", "ok = true",                    result.ok,                  true);
  assertEq(report, "S1", "counts.completed = 3",         result.counts.completed,    3);
  assertEq(report, "S1", "counts.failed = 0",            result.counts.failed,       0);
  assertEq(report, "S1", "counts.skipped = 0",           result.counts.skipped,      0);
  assertEq(report, "S1", "step A = completed",           result.steps.A?.status,     "completed");
  assertEq(report, "S1", "step B = completed",           result.steps.B?.status,     "completed");
  assertEq(report, "S1", "step C = completed",           result.steps.C?.status,     "completed");
  assertEq(report, "S1", "step B groupIndex = 1",        result.steps.B?.groupIndex, 1);
  assertEq(report, "S1", "step C groupIndex = 1",        result.steps.C?.groupIndex, 1);
  assert(report,   "S1", "B executionHash stable",       result.steps.B?.executionHash === "test-subagent:test_succeed:B");
  assertEq(report, "S1", "phase = completed",            result.phase,               "completed");

  console.groupEnd();
}

// ── S2: Partial Success ────────────────────────────────────────────────────────

async function s2_partialSuccess(report) {
  console.group("S2 — Partial Success");
  const job    = createParentJob("s2");
  const result = await agentOrchestrator.runPlan(job.id, "test-agent", PLAN_PARTIAL);

  assertEq(report, "S2", "plan status = partial_success",    result.status,              "partial_success");
  assertEq(report, "S2", "ok = true",                        result.ok,                  true);
  assertEq(report, "S2", "step A = completed",               result.steps.A?.status,     "completed");
  assertEq(report, "S2", "step C = completed",               result.steps.C?.status,     "completed");
  assertEq(report, "S2", "step B = failed",                  result.steps.B?.status,     "failed");
  assertEq(report, "S2", "step D = skipped",                 result.steps.D?.status,     "skipped");
  assertEq(report, "S2", "D skip reason = blocked_by_dep",   result.steps.D?.reason,     "blocked_by_failed_dependency");
  assertContains(report, "S2", "B error contains failure reason", result.steps.B?.error, "TRANSIENT_ERROR");
  assertEq(report, "S2", "counts.failed = 1",                result.counts.failed,       1);
  assertEq(report, "S2", "counts.skipped = 1",               result.counts.skipped,      1);

  console.groupEnd();
}

// ── S3: Critical Failure ───────────────────────────────────────────────────────

async function s3_criticalFailure(report) {
  console.group("S3 — Critical Failure");
  const job    = createParentJob("s3");
  const result = await agentOrchestrator.runPlan(job.id, "test-agent", PLAN_CRITICAL);

  assertEq(report, "S3", "plan status = failed",                result.status,          "failed");
  assertEq(report, "S3", "ok = false",                          result.ok,              false);
  assertEq(report, "S3", "step A = failed",                     result.steps.A?.status, "failed");
  assertEq(report, "S3", "step B = skipped",                    result.steps.B?.status, "skipped");
  assertEq(report, "S3", "step C = skipped",                    result.steps.C?.status, "skipped");
  assertEq(report, "S3", "B skip reason = plan_aborted",        result.steps.B?.reason, "plan_aborted_due_to_critical_failure");
  assertEq(report, "S3", "C skip reason = plan_aborted",        result.steps.C?.reason, "plan_aborted_due_to_critical_failure");
  assertEq(report, "S3", "counts.completed = 0",                result.counts.completed, 0);
  assertEq(report, "S3", "phase = failed",                      result.phase,           "failed");

  console.groupEnd();
}

// ── S4: Dispatcher Denial ──────────────────────────────────────────────────────

async function s4_dispatcherDenial(report) {
  console.group("S4 — Dispatcher Denial");
  const job = createParentJob("s4");

  // 4a: Unknown agent
  const r1 = await toolDispatcher.run(job.id, "ghost-agent", "test_succeed", {});
  assertEq(report,    "S4", "unknown agent → ok=false",         r1.ok,    false);
  assertContains(report, "S4", "unknown agent → UNKNOWN_AGENT", r1.error, "UNKNOWN_AGENT");

  // 4b: Tool not in allowlist (test-agent does not have transactionManager)
  const r2 = await toolDispatcher.run(job.id, "test-agent", "transactionManager", {});
  assertEq(report,    "S4", "disallowed tool → ok=false",          r2.ok,    false);
  assertEq(report,    "S4", "disallowed tool → TOOL_NOT_ALLOWED",  r2.error, "TOOL_NOT_ALLOWED");

  // 4c: Escalation blocks HIGH-risk tool for an otherwise-permitted agent
  sessionMemory.escalated   = true;
  sessionMemory.escalatedAt = Date.now();
  const r3 = await toolDispatcher.run(job.id, "gemini", "patchEngine", { original: "", patch: {} });
  sessionMemory.resetEscalation();
  assertEq(report, "S4", "escalated + HIGH-risk → ok=false",                    r3.ok,    false);
  assertEq(report, "S4", "escalated + HIGH-risk → ESCALATION_TOOL_BLOCKED",     r3.error, "ESCALATION_TOOL_BLOCKED");

  // 4d: Read-only agent attempting mutation
  const r4 = await toolDispatcher.run(job.id, "system_auditor", "patchEngine", {});
  assertEq(report, "S4", "read-only mutation → ok=false",                              r4.ok,    false);
  assertEq(report, "S4", "read-only mutation → READ_ONLY_AGENT_MUTATION_BLOCKED",      r4.error, "READ_ONLY_AGENT_MUTATION_BLOCKED");

  console.groupEnd();
}

// ── S5: Escalation Lifecycle ───────────────────────────────────────────────────

async function s5_escalation(report) {
  console.group("S5 — Escalation Lifecycle");

  // Fresh state
  sessionMemory.resetEscalation();
  assertEq(report, "S5", "initial: not escalated",          sessionMemory.isEscalated(),         false);
  assertEq(report, "S5", "initial: violations = 0",         sessionMemory.securityViolations,    0);

  // Approach threshold
  sessionMemory.logSecurityViolation();  // 1
  sessionMemory.logSecurityViolation();  // 2
  assertEq(report, "S5", "2 violations: not yet escalated", sessionMemory.isEscalated(),         false);
  assertEq(report, "S5", "2 violations: count = 2",         sessionMemory.securityViolations,    2);

  // Cross threshold
  sessionMemory.logSecurityViolation();  // 3
  assertEq(report, "S5", "3 violations: escalated = true",  sessionMemory.isEscalated(),         true);
  assertEq(report, "S5", "3 violations: count = 3",         sessionMemory.securityViolations,    3);
  assert(report,   "S5", "escalatedAt is set",              sessionMemory.escalatedAt !== null);
  assert(report,   "S5", "remainingMs > 0",                 sessionMemory.escalationRemainingMs() > 0);

  // Tool blocking via dispatcher (uses real agentRegistry.canUseTool with escalation ctx)
  const job = createParentJob("s5");
  const r   = await toolDispatcher.run(job.id, "gemini", "patchEngine", { original: "", patch: {} });
  assertEq(report, "S5", "patchEngine blocked while escalated", r.ok,    false);
  assertEq(report, "S5", "error = ESCALATION_TOOL_BLOCKED",     r.error, "ESCALATION_TOOL_BLOCKED");

  // Confidence penalty
  confidenceEngine.init();
  const score = confidenceEngine.score({ content: "const x = 1;", isPatch: true, target: "x.js" }, { fileCount: 1 });
  assert(report, "S5", "confidence < safe threshold (85) while escalated", score < 85, `score=${score}`);

  // LOW-risk tools still work while escalated
  const r2 = await toolDispatcher.run(job.id, "gemini", "memoryStore", { projectRoot: null, entry: { type: "test" } });
  // memoryStore may fail on null root but it won't be ESCALATION_TOOL_BLOCKED
  assert(report, "S5", "LOW-risk tool (memoryStore) not blocked by escalation", r2.error !== "ESCALATION_TOOL_BLOCKED");

  // Manual reset
  sessionMemory.resetEscalation();
  assertEq(report, "S5", "after reset: not escalated",      sessionMemory.isEscalated(),         false);
  assertEq(report, "S5", "after reset: violations = 0",     sessionMemory.securityViolations,    0);
  assert(report,   "S5", "after reset: escalatedAt = null", sessionMemory.escalatedAt === null);

  // TTL decay simulation: set escalatedAt to 31 minutes ago
  sessionMemory.logSecurityViolation();
  sessionMemory.logSecurityViolation();
  sessionMemory.logSecurityViolation();  // escalates
  sessionMemory.escalatedAt = Date.now() - (31 * 60 * 1000);  // expire
  assertEq(report, "S5", "TTL expired: isEscalated() auto-decays", sessionMemory.isEscalated(), false);
  assertEq(report, "S5", "TTL decay cleared escalated flag",        sessionMemory.escalated,     false);

  console.groupEnd();
}

// ── S6: Confidence Scoring + Retry Planner ────────────────────────────────────

async function s6_confidenceAndRetry(report) {
  console.group("S6 — Confidence Scoring + Retry Planner");

  sessionMemory.resetEscalation();
  confidenceEngine.init();

  // Safe file: small pure-patch, no risky patterns
  const safeFile = { content: "const answer = 42;", isPatch: true, target: "math.js" };
  const safeScore = confidenceEngine.score(safeFile, { fileCount: 1 });
  assert(report, "S6", "safe file scores above review threshold (60)", safeScore >= 60, `score=${safeScore}`);

  // Risky file: contains eval, no patch, many files
  const riskyFile = { content: "eval(userInput);", isPatch: false };
  const riskyScore = confidenceEngine.score(riskyFile, { fileCount: 5 });
  assert(report, "S6", "risky file scores below review threshold (60)", riskyScore < 60, `score=${riskyScore}`);
  assertEq(report, "S6", "risky file classified as risky", confidenceEngine.classify(riskyScore).level, "risky");

  // Escalation penalty (-40) must push safe file below safe threshold (85)
  sessionMemory.logSecurityViolation();
  sessionMemory.logSecurityViolation();
  sessionMemory.logSecurityViolation();  // escalate
  const escalatedScore = confidenceEngine.score(safeFile, { fileCount: 1 });
  assert(report, "S6", "escalation forces score below safe threshold (85)", escalatedScore < 85, `score=${escalatedScore}`);
  sessionMemory.resetEscalation();

  // Failure classifier
  assertEq(report, "S6", "UNKNOWN_AGENT → non_retryable",         failureClassifier.classifyReason("UNKNOWN_AGENT"),              "non_retryable");
  assertEq(report, "S6", "ESCALATION_TOOL_BLOCKED → needs_fix",   failureClassifier.classifyReason("ESCALATION_TOOL_BLOCKED"),    "needs_fix");
  assertEq(report, "S6", "blocked_by_failed_dependency → blocked", failureClassifier.classifyReason("blocked_by_failed_dependency"), "blocked");
  assertEq(report, "S6", "UNEXPECTED_THROW → retryable",          failureClassifier.classifyReason("UNEXPECTED_THROW"),           "retryable");
  assertEq(report, "S6", "unknown reason → retryable (default)",  failureClassifier.classifyReason("SOME_RANDOM_ERROR"),          "retryable");

  // Retry planner: build retry plan from a partial-success result
  const job         = createParentJob("s6");
  const planResult  = await agentOrchestrator.runPlan(job.id, "test-agent", PLAN_PARTIAL);
  const retryPlan   = retryPlanner.buildRetryPlan(PLAN_PARTIAL, planResult);

  assert(report,  "S6", "retry plan built successfully",         retryPlan.ok, `reason=${retryPlan.reason}`);
  assert(report,  "S6", "retry plan includes failed step B",     retryPlan.ok && retryPlan.retryIds.includes("B"));
  assert(report,  "S6", "retry plan includes unblocked step D",  retryPlan.ok && retryPlan.retryIds.includes("D"));
  assert(report,  "S6", "retry plan excludes completed step A",  retryPlan.ok && !retryPlan.retryIds.includes("A"));

  // State diff validator: no-op merge when nothing changed
  const diff = stateDiffValidator.validate(planResult, planResult);
  assertEq(report, "S6", "self-diff: ok=true (no regressions)",  diff.ok,      true);
  assertEq(report, "S6", "self-diff: no improvements",           diff.improved, false);

  console.groupEnd();
}

// ── Runner ────────────────────────────────────────────────────────────────────

export const integrationTestRunner = {

  async run() {
    console.clear();
    console.log("═══════════════════════════════════════════════");
    console.log("  OpenClaw Integration Test Runner");
    console.log("═══════════════════════════════════════════════");

    const report = [];
    setupTestInfra();

    try {
      await s1_happyPath(report);
      await s2_partialSuccess(report);
      await s3_criticalFailure(report);
      await s4_dispatcherDenial(report);
      await s5_escalation(report);
      await s6_confidenceAndRetry(report);
    } catch (err) {
      console.error("❌ Test runner threw unexpectedly:", err);
      report.push({ scenario: "RUNNER", name: "unexpected throw", ok: false, extra: err.message });
    } finally {
      teardownTestInfra();
    }

    this._printSummary(report);
    return report;
  },

  _printSummary(report) {
    const passed  = report.filter(r => r.ok).length;
    const failed  = report.filter(r => !r.ok).length;
    const total   = report.length;

    console.log("\n═══════════════════════════════════════════════");
    console.log(`  Results: ${passed}/${total} passed   ${failed > 0 ? `(${failed} FAILED)` : ""}`);

    if (failed > 0) {
      console.log("\n  Failed assertions:");
      report.filter(r => !r.ok).forEach(r => {
        console.log(`    [${r.scenario}] ${r.name}${r.extra ? " — " + r.extra : ""}`);
      });
    }

    console.log("═══════════════════════════════════════════════\n");

    if (failed === 0) {
      console.log("🟢 All scenarios passed. Ready for Electron UI integration.");
    } else {
      console.log("🔴 Failures detected. Resolve before UI integration.");
    }
  },
};
