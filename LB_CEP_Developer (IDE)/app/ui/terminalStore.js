export const terminalStore = {
  sessions: [
    { id: 'main', name: 'Terminal', logs: [], active: true }
  ],
  activeSessionId: 'main',
  commandToSession: {},

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

  saveToSession() {
    const state = {
      sessions: this.sessions,
      activeSessionId: this.activeSessionId,
      commandToSession: this.commandToSession
    };
    localStorage.setItem('terminal_session', JSON.stringify(state));
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
