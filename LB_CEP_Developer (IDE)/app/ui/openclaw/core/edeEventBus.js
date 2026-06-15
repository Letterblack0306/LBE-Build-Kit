/**
 * OpenClaw EDE Event Bus
 *
 * Collects real-time orchestration events and pushes them to subscribed panels.
 * Events are emitted by toolDispatcher and agentOrchestrator during execution.
 *
 * Consumed by: edePanel.js (timeline, retry decisions, permission state)
 * Emitted by:  toolDispatcher, agentOrchestrator
 *
 * ── Event Types ───────────────────────────────────────────────────────────────
 *  plan.start          — orchestrator began executing a plan
 *  plan.complete       — orchestrator finished (includes final status)
 *  step.intent         — step registered for execution (pre-execution audit)
 *  step.complete       — step finished successfully
 *  step.fail           — step failed
 *  step.skip           — step skipped (blocked / frozen / idempotent)
 *  tool.call           — tool invocation began (pre-execution)
 *  tool.ok             — tool returned ok:true
 *  tool.denied         — tool blocked by permission / escalation gate
 *  tool.fault_injected — tool call overridden by fault injector
 *  tool.error          — tool threw or returned ok:false
 *  retry.start         — retry or replay began
 *  retry.complete      — retry finished (includes diff stats)
 *  retry.rejected      — retry rejected due to regression
 */
export const edeEventBus = {

  _events:      [],            // chronological event log (capped at MAX_EVENTS)
  _subscribers: new Set(),     // active subscriber functions
  MAX_EVENTS:   2000,

  // ── Emit ──────────────────────────────────────────────────────────────────

  emit(type, payload = {}) {
    const event = {
      id:  `ede_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      ts:  Date.now(),
      ...payload,
    };

    this._events.push(event);

    // Cap log — drop oldest entries to prevent runaway growth
    if (this._events.length > this.MAX_EVENTS) {
      this._events.splice(0, this._events.length - this.MAX_EVENTS);
    }

    for (const sub of this._subscribers) {
      try { sub(event); } catch { /* subscriber errors must never interrupt execution */ }
    }

    return event;
  },

  // ── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to all events.
   * @param {function} fn — called with each new event
   * @returns {function} unsubscribe handle
   */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  },

  // ── Query ─────────────────────────────────────────────────────────────────

  /** All events, optionally filtered by type prefix ("plan.", "step.", "tool.", "retry.") */
  getEvents(typePrefix = null) {
    if (!typePrefix) return [...this._events];
    return this._events.filter(e => e.type.startsWith(typePrefix));
  },

  /** All events for a specific planId */
  getPlanEvents(planId) {
    return this._events.filter(e => e.planId === planId);
  },

  /** Most recent N events */
  getTail(n = 50) {
    return this._events.slice(-n);
  },

  clear() {
    this._events = [];
  },

  /**
   * Snapshot grouped by planId — consumed by the EDE timeline panel.
   */
  snapshot() {
    const byPlan = {};
    for (const e of this._events) {
      const key = e.planId ?? "__global__";
      if (!byPlan[key]) byPlan[key] = [];
      byPlan[key].push(e);
    }
    return { total: this._events.length, byPlan };
  },
};
