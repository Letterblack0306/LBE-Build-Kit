export const retryPolicy = {
    locator: { maxRetries: 1, backoffMs: [500], retryOn: ["TIMEOUT", "TRANSIENT_READ_ERROR"] },
    patcher: { maxRetries: 1, backoffMs: [1000], retryOn: ["MODEL_TIMEOUT", "TRANSIENT_PARSE_ERROR"] },
    builder: { maxRetries: 0, backoffMs: [], retryOn: [] },
    validator: { maxRetries: 0, backoffMs: [], retryOn: [] },
    "git-agent": { maxRetries: 0, backoffMs: [], retryOn: [] },
};

export function normalizeError(error, source = "agent") {
    const code = error?.code || error?.name || "UNKNOWN";
    return {
        code,
        message: error?.message || String(error || "Unknown error"),
        retryable: false,
        source,
        details: error?.details || null
    };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

export async function executeWithRetry(step, runner) {
    const policy = retryPolicy[step.agent] || { maxRetries: 0, backoffMs: [], retryOn: [] };
    let attempt = 0;

    while (true) {
        const result = await runner(step, attempt);
        if (result.status !== "failed") {
            return { ...result, attempts: attempt + 1 };
        }

        const errorCode = result.error?.code;
        const canRetry = attempt < policy.maxRetries && policy.retryOn.includes(errorCode);
        if (!canRetry) {
            return { ...result, attempts: attempt + 1 };
        }

        const waitMs = policy.backoffMs[attempt] || 0;
        if (waitMs > 0) await delay(waitMs);
        attempt += 1;
    }
}
