export const chatStore = {
  messages: [],

  addMessage(role, content, extra = {}) {
    this.messages.push({
      id: extra.id || `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      role,
      content,
      type: extra.type || (role === "user" ? "USER" : "AI_TEXT"),
      status: extra.status || null,
      meta: extra.meta || null,
      actions: Array.isArray(extra.actions) ? extra.actions : [],
      time: Date.now()
    });
    this.save();
    return this.messages.length - 1;
  },

  updateMessage(index, patch = {}) {
    if (index < 0 || index >= this.messages.length) return;
    this.messages[index] = { ...this.messages[index], ...patch };
    this.save();
  },

  addExecutionMessage(content, status = "executing", meta = {}, actions = []) {
    return this.addMessage("ai", content, {
      type: "EXECUTION",
      status,
      meta,
      actions
    });
  },

  addPlanMessage(content, meta = {}) {
    return this.addMessage("ai", content, {
      type: "AI_PLAN",
      status: "planned",
      meta
    });
  },

  addResultMessage(content, status = "completed", meta = {}, actions = []) {
    return this.addMessage("ai", content, {
      type: "RESULT",
      status,
      meta,
      actions
    });
  },

  addErrorMessage(content, meta = {}, actions = []) {
    return this.addMessage("ai", content, {
      type: "ERROR",
      status: "failed",
      meta,
      actions
    });
  },

  save() {
    localStorage.setItem('chat_history', JSON.stringify(this.messages));
  },

  load() {
    const saved = localStorage.getItem('chat_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.messages = Array.isArray(parsed) ? parsed.map((m) => ({
          id: m.id || `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          role: m.role || "ai",
          content: m.content || "",
          type: m.type || (m.role === "user" ? "USER" : "AI_TEXT"),
          status: m.status || null,
          meta: m.meta || null,
          actions: Array.isArray(m.actions) ? m.actions : [],
          time: m.time || Date.now()
        })) : [];
      } catch (e) { }
    }
  },

  updateLastMessage(content) {
    if (this.messages.length === 0) return;
    // Update without saving — caller saves when streaming is done
    this.messages[this.messages.length - 1].content = content;
  },

  clear() {
    this.messages = [];
    this.save();
  }
};
