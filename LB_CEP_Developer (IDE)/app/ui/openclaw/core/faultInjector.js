/**
 * OpenClaw Fault Injector
 *
 * Global test-flag system for the Execution Debug Environment (EDE).
 * Controls artificial failure injection into the toolDispatcher execution path.
 *
 * Flags can be set from:
 *  - Integration tests (integrationTestRunner.js)
 *  - The EDE control panel (edePanel.js)
 *  - Programmatically: faultInjector.setFlag("FORCE_TOOL_FAIL", true)
 *
 * ── Available Flags ────────────────────────────────────────────────────────
 *  FORCE_TOOL_FAIL       — force all (or targeted) tool calls to fail with injection error
 *  FORCE_VALIDATOR_FAIL  — force validator tool specifically to return ok: false
 *  DELAY_EXECUTION       — add artificial delay (ms) before tool execution
 *  FAIL_STEP_IDS         — Set<string> of specific step IDs to target (null = all)
 *  FAIL_TOOLS            — Set<string> of specific tool names to target (null = all)
 */
export const faultInjector = {

  _flags: {
    FORCE_TOOL_FAIL:      false,
    FORCE_VALIDATOR_FAIL: false,
    DELAY_EXECUTION:      0,       // ms; 0 = no delay
    FAIL_STEP_IDS:        null,    // null = any step; Set<string> = targeted
    FAIL_TOOLS:           null,    // null = any tool; Set<string> = targeted
  },

  // ── Public API ────────────────────────────────────────────────────────────

  setFlag(name, value) {
    if (!(name in this._flags)) {
      console.warn(`[FaultInjector] Unknown flag: ${name}`);
      return;
    }
    this._flags[name] = value;
    // Mirror to globalThis so tests can inspect without importing this module
    globalThis.__OPENCLAW_TEST_FLAGS = this.snapshot();
  },

  getFlag(name) {
    return this._flags[name];
  },

  reset() {
    this._flags = {
      FORCE_TOOL_FAIL:      false,
      FORCE_VALIDATOR_FAIL: false,
      DELAY_EXECUTION:      0,
      FAIL_STEP_IDS:        null,
      FAIL_TOOLS:           null,
    };
    delete globalThis.__OPENCLAW_TEST_FLAGS;
  },

  /** True if any fault flag is active. */
  isActive() {
    return (
      this._flags.FORCE_TOOL_FAIL ||
      this._flags.FORCE_VALIDATOR_FAIL ||
      this._flags.DELAY_EXECUTION > 0
    );
  },

  /**
   * Check if a specific tool call should be forced to fail.
   * Called by toolDispatcher between permission check and execution.
   *
   * @param {string} toolName — tool being called
   * @param {string|null} stepId — orchestrator step ID (optional, for targeting)
   * @returns {string|null} — injected error message, or null = proceed normally
   */
  shouldFail(toolName, stepId = null) {
    // Validator-specific fault (independent of FORCE_TOOL_FAIL)
    if (toolName === "validator" && this._flags.FORCE_VALIDATOR_FAIL) {
      return "FAULT_INJECTED: validator forced to fail";
    }

    if (!this._flags.FORCE_TOOL_FAIL) return null;

    // Tool targeting — if FAIL_TOOLS is set, only fail listed tools
    if (this._flags.FAIL_TOOLS instanceof Set && !this._flags.FAIL_TOOLS.has(toolName)) {
      return null;
    }

    // Step targeting — if FAIL_STEP_IDS is set, only fail listed steps
    if (stepId && this._flags.FAIL_STEP_IDS instanceof Set && !this._flags.FAIL_STEP_IDS.has(stepId)) {
      return null;
    }

    return "FAULT_INJECTED: tool forced to fail";
  },

  /**
   * Apply configured execution delay before a tool runs.
   * No-op when DELAY_EXECUTION is 0.
   */
  async applyDelay() {
    const ms = this._flags.DELAY_EXECUTION;
    if (!ms || ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Snapshot current flags — safe to send to the EDE panel.
   */
  snapshot() {
    return {
      active:               this.isActive(),
      FORCE_TOOL_FAIL:      this._flags.FORCE_TOOL_FAIL,
      FORCE_VALIDATOR_FAIL: this._flags.FORCE_VALIDATOR_FAIL,
      DELAY_EXECUTION:      this._flags.DELAY_EXECUTION,
      FAIL_STEP_IDS:        this._flags.FAIL_STEP_IDS ? [...this._flags.FAIL_STEP_IDS] : null,
      FAIL_TOOLS:           this._flags.FAIL_TOOLS ? [...this._flags.FAIL_TOOLS] : null,
    };
  },
};
