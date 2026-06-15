// Escalation auto-resets after 30 minutes — prevents permanent over-restriction across sessions
const ESCALATION_TTL_MS = 30 * 60 * 1000;

export const sessionMemory = {
  recentTransactions: [],
  recentErrors: [],
  maxEntries: 10,
  securityViolations: 0,
  escalated: false,
  escalatedAt: null,

  load() {
    try {
      const saved = localStorage.getItem('session_memory');
      if (saved) {
        const data = JSON.parse(saved);
        this.recentTransactions  = data.transactions       || [];
        this.recentErrors        = data.errors             || [];
        this.securityViolations  = data.securityViolations || 0;
        this.escalated           = data.escalated          || false;
        this.escalatedAt         = data.escalatedAt        || null;
        // Auto-decay on load — if TTL expired while app was closed, clear escalation
        if (this.escalated && this.escalatedAt && Date.now() - this.escalatedAt >= ESCALATION_TTL_MS) {
          this._decayEscalation();
        }
      }
    } catch (e) {}
  },

  save() {
    const data = {
      transactions:       this.recentTransactions,
      errors:             this.recentErrors,
      securityViolations: this.securityViolations,
      escalated:          this.escalated,
      escalatedAt:        this.escalatedAt,
    };
    localStorage.setItem('session_memory', JSON.stringify(data));
  },

  logTransaction(id, status, files) {
    this.recentTransactions.push({
      id,
      status,
      files: files.map(f => f.relativePath || f.path),
      timestamp: Date.now()
    });
    if (this.recentTransactions.length > this.maxEntries) this.recentTransactions.shift();
    this.save();
  },

  logError(code, message, stage) {
    this.recentErrors.push({
      code,
      message,
      stage,
      timestamp: Date.now()
    });
    if (this.recentErrors.length > this.maxEntries) this.recentErrors.shift();
    this.save();
  },

  logSecurityViolation() {
    this.securityViolations += 1;
    if (this.securityViolations >= 3 && !this.escalated) {
      this.escalated   = true;
      this.escalatedAt = Date.now();
    }
    this.save();
  },

  isEscalated() {
    if (!this.escalated) return false;
    // TTL check — auto-decay if cooldown window has passed
    if (this.escalatedAt && Date.now() - this.escalatedAt >= ESCALATION_TTL_MS) {
      this._decayEscalation();
      return false;
    }
    return true;
  },

  // Returns how many ms remain in the escalation cooldown, or 0 if not escalated
  escalationRemainingMs() {
    if (!this.escalated || !this.escalatedAt) return 0;
    const remaining = ESCALATION_TTL_MS - (Date.now() - this.escalatedAt);
    return Math.max(0, remaining);
  },

  resetEscalation() {
    this._decayEscalation();
  },

  _decayEscalation() {
    this.escalated          = false;
    this.escalatedAt        = null;
    this.securityViolations = 0;
    this.save();
  },

  getSummary() {
    return {
      transactions:       this.recentTransactions,
      errors:             this.recentErrors,
      securityViolations: this.securityViolations,
      escalated:          this.isEscalated(),
      escalatedAt:        this.escalatedAt,
    };
  }
};
