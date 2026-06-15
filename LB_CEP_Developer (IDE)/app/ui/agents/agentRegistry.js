export const agentRegistry = {
    locator: {
        id: "locator",
        label: "Locator Agent",
        role: "Find files, references, and likely error locations",
        version: "1.0.0",
        allowedTools: ["searchFiles", "readFile", "listFiles"],
        allowedIntents: ["find_error", "find_symbol", "find_file"],
        inputSchema: {
            required: ["task", "context"],
            properties: { task: "string", context: "object", constraints: "object" }
        },
        outputSchema: {
            required: ["status", "summary", "result"],
            properties: {
                status: ["success", "failed", "partial_success", "skipped"],
                summary: "string",
                result: "object",
                error: "object|null"
            }
        },
        execution: { timeoutMs: 15000, maxRetries: 1, retryableErrors: ["TIMEOUT", "TRANSIENT_READ_ERROR"] }
    },
    patcher: {
        id: "patcher",
        label: "Patcher Agent",
        role: "Generate file patches and edit proposals",
        version: "1.0.0",
        allowedTools: ["readFile", "diffBuilder"],
        allowedIntents: ["apply_fix", "refactor", "generate_patch"],
        inputSchema: {
            required: ["task", "context", "targets"],
            properties: { task: "string", context: "object", targets: "array" }
        },
        outputSchema: {
            required: ["status", "summary", "patches"],
            properties: {
                status: ["success", "failed", "partial_success", "skipped"],
                summary: "string",
                patches: "array",
                error: "object|null"
            }
        },
        execution: { timeoutMs: 30000, maxRetries: 1, retryableErrors: ["MODEL_TIMEOUT", "TRANSIENT_PARSE_ERROR"] }
    },
    builder: {
        id: "builder",
        label: "Builder Agent",
        role: "Run build and validation commands",
        version: "1.0.0",
        allowedTools: ["runCommand", "readCommandOutput"],
        allowedIntents: ["run_build", "run_validate", "run_check"],
        inputSchema: {
            required: ["task", "command"],
            properties: { task: "string", command: "string", cwd: "string" }
        },
        outputSchema: {
            required: ["status", "summary", "exitCode"],
            properties: {
                status: ["success", "failed", "partial_success", "skipped"],
                summary: "string",
                exitCode: "number",
                stdout: "string",
                stderr: "string",
                error: "object|null"
            }
        },
        execution: { timeoutMs: 120000, maxRetries: 0, retryableErrors: [] }
    },
    validator: {
        id: "validator",
        label: "Validator Agent",
        role: "Check syntax, rules, and policy compliance",
        version: "1.0.0",
        allowedTools: ["readFile", "runValidation"],
        allowedIntents: ["validate_patch", "validate_project"],
        inputSchema: {
            required: ["task", "targets"],
            properties: { task: "string", targets: "array", ruleset: "string" }
        },
        outputSchema: {
            required: ["status", "summary", "checks"],
            properties: {
                status: ["success", "failed", "partial_success", "skipped"],
                summary: "string",
                checks: "array",
                error: "object|null"
            }
        },
        execution: { timeoutMs: 45000, maxRetries: 0, retryableErrors: [] }
    },
    "git-agent": {
        id: "git-agent",
        label: "Git Agent",
        role: "Stage, commit, and push approved changes",
        version: "1.0.0",
        allowedTools: ["gitStatus", "gitStage", "gitCommit", "gitPush"],
        allowedIntents: ["stage_changes", "commit_changes", "push_changes"],
        inputSchema: {
            required: ["task", "files"],
            properties: { task: "string", files: "array", commitMessage: "string" }
        },
        outputSchema: {
            required: ["status", "summary"],
            properties: {
                status: ["success", "failed", "partial_success", "skipped"],
                summary: "string",
                branch: "string",
                commitHash: "string",
                error: "object|null"
            }
        },
        execution: { timeoutMs: 30000, maxRetries: 0, retryableErrors: [] }
    }
};

export const AgentRegistry = {
    get(agentId) { return agentRegistry[agentId] || null; },
    exists(agentId) { return Boolean(agentRegistry[agentId]); },
    list() { return Object.values(agentRegistry); },
    getAllowedTools(agentId) { return agentRegistry[agentId]?.allowedTools || []; },
    validateIntent(agentId, intent) {
        const agent = agentRegistry[agentId];
        return !!agent && agent.allowedIntents.includes(intent);
    }
};

export function normalizeAgentStepResult(partial = {}) {
    const startedAt = partial.startedAt || Date.now();
    const endedAt = partial.endedAt || Date.now();
    return {
        agentId: partial.agentId || "unknown",
        stepId: partial.stepId || `step_${Date.now()}`,
        status: partial.status || "failed",
        summary: partial.summary || "No summary",
        result: partial.result || {},
        error: partial.error || null,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt)
    };
}
