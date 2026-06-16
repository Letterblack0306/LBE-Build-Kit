const MAX_SESSION_LOGS = 2000;
const TRIM_TO_LOGS = 1500;

export const terminalStore = {
  sessions: [
    { id: 'main', name: 'Terminal', logs: [], active: true }
  ],
  activeSessionId: 'main',
  commandToSession: {},
  _saveTimer: null,

  addSession(name) {
    const id = `session-${Date.now()}`;
    this.sessions.push({ id, name, logs: [], active: false });
    this.setActiveSession(id);
    this.saveToSession();
    return id;
  },

  setActiveSession(id) {
    this.sessions.forEach(s => s.active = (s.id === id));
    this.activeSessionId = id;
    this.saveToSession();
  },

  appendLog(sessionId, type, text) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.logs.push({ type, text, time: Date.now() });
      if (session.logs.length > MAX_SESSION_LOGS) {
        session.logs = session.logs.slice(-TRIM_TO_LOGS);
      }
      this.saveToSession();
    }
  },

  ensureCommandSession(commandId, name = null) {
    if (!commandId) return this.activeSessionId;
    const existing = this.commandToSession[commandId];
    if (existing && this.sessions.some(s => s.id === existing)) return existing;
    const id = `cmd-${commandId}`;
    const label = name || `Cmd ${String(commandId).slice(-6)}`;
    this.sessions.push({ id, name: label, logs: [], active: false });
    this.commandToSession[commandId] = id;
    this.saveToSession();
    return id;
  },

  getSessionForCommand(commandId) {
    if (!commandId) return null;
    const mapped = this.commandToSession[commandId];
    if (mapped && this.sessions.some(s => s.id === mapped)) return mapped;
    return null;
  },

  clearSession(sessionId) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.logs = [];
      this.saveToSession();
    }
  },

  closeSession(sessionId) {
    if (this.sessions.length <= 1) return;
    const index = this.sessions.findIndex(s => s.id === sessionId);
    if (index !== -1) {
      Object.keys(this.commandToSession).forEach((cid) => {
        if (this.commandToSession[cid] === sessionId) delete this.commandToSession[cid];
      });
      this.sessions.splice(index, 1);
      if (this.activeSessionId === sessionId) {
        this.setActiveSession(this.sessions[0].id);
      }
      this.saveToSession();
    }
  },

  // Debounced — batches rapid log appends (e.g. streaming build output) into
  // a single localStorage write per 500ms instead of one per line.
  saveToSession() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      const state = {
        sessions: this.sessions,
        activeSessionId: this.activeSessionId,
        commandToSession: this.commandToSession
      };
      try {
        localStorage.setItem('terminal_session', JSON.stringify(state));
      } catch {
        // localStorage full — trim all sessions and retry once
        this.sessions.forEach(s => { if (s.logs.length > 200) s.logs = s.logs.slice(-200); });
        try { localStorage.setItem('terminal_session', JSON.stringify(state)); } catch { /* give up */ }
      }
    }, 500);
  },

  loadFromSession() {
    try {
      const saved = localStorage.getItem('terminal_session');
      if (saved) {
        const state = JSON.parse(saved);
        this.sessions = state.sessions || [{ id: 'main', name: 'Terminal', logs: [], active: true }];
        this.activeSessionId = state.activeSessionId || 'main';
        this.commandToSession = state.commandToSession || {};
        return true;
      }
    } catch (e) {
      console.error('Failed to load terminal session', e);
    }
    return false;
  }
};
