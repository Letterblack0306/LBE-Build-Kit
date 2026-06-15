import { terminalStore } from "./terminalStore.js";

const tabsContainer = document.getElementById("terminal-tabs");
const sessionsContainer = document.getElementById("terminal-sessions");

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function createLine(text, type, time) {
  const div = document.createElement("div");
  div.className = `line ${type}`;

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = formatTime(time ?? Date.now());

  const content = document.createElement("span");
  content.className = "line-text";

  // Linkify file:line patterns (e.g., src/app.js:396 or C:/path/to/file.js:10)
  // We use a regex that looks for typical path characters followed by :line
  const linkRegex = /([a-zA-Z0-9_\/\.-]+):(\d+)/g;

  if (linkRegex.test(text)) {
    const parts = text.split(linkRegex);
    // split with capturing group returns [prefix, file, line, prefix, file, line, ...]
    linkRegex.lastIndex = 0;
    let match;
    let lastIdx = 0;
    while ((match = linkRegex.exec(text)) !== null) {
      // Add text before the match
      content.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));

      const link = document.createElement("span");
      link.className = "terminal-link";
      link.textContent = match[0];
      link.dataset.file = match[1];
      link.dataset.line = match[2];
      content.appendChild(link);

      lastIdx = linkRegex.lastIndex;
    }
    // Add remaining text
    content.appendChild(document.createTextNode(text.substring(lastIdx)));
  } else {
    content.textContent = text;
  }

  div.appendChild(ts);
  div.appendChild(content);
  return div;
}

export function appendLine(type, text, time) {
  const sessionId = terminalStore.activeSessionId;
  terminalStore.appendLog(sessionId, type, text);

  const sessionEl = document.querySelector(`.terminal-session[data-id="${sessionId}"]`);
  if (sessionEl) {
    sessionEl.appendChild(createLine(text, type, time));
    sessionEl.scrollTop = sessionEl.scrollHeight;
  }
}

export function bindCommandTerminal(commandId, commandName) {
  return terminalStore.ensureCommandSession(commandId, commandName);
}

export function appendLineForCommand(commandId, type, text, time) {
  const sessionId = terminalStore.getSessionForCommand(commandId) || terminalStore.ensureCommandSession(commandId);
  terminalStore.appendLog(sessionId, type, text);

  const sessionEl = document.querySelector(`.terminal-session[data-id="${sessionId}"]`);
  if (sessionEl) {
    sessionEl.appendChild(createLine(text, type, time));
    sessionEl.scrollTop = sessionEl.scrollHeight;
  }
}

export function renderTerminal() {
  if (!tabsContainer || !sessionsContainer) return;

  const filter = document.getElementById("log-filter")?.value || "all";

  tabsContainer.innerHTML = "";
  sessionsContainer.innerHTML = "";

  terminalStore.sessions.forEach(session => {
    // Tab
    const tabEl = document.createElement("div");
    tabEl.className = `terminal-tab ${session.active ? "active" : ""}`;
    tabEl.textContent = session.name;
    tabEl.addEventListener("click", () => {
      terminalStore.setActiveSession(session.id);
      renderTerminal();
    });
    tabsContainer.appendChild(tabEl);

    // Session Container
    const sessionEl = document.createElement("div");
    sessionEl.className = `terminal-session ${session.active ? "active" : ""}`;
    sessionEl.dataset.id = session.id;

    session.logs.forEach(log => {
      if (filter === "all" || log.type === filter) {
        sessionEl.appendChild(createLine(log.text, log.type, log.time));
      }
    });

    sessionsContainer.appendChild(sessionEl);
    if (session.active) sessionEl.scrollTop = sessionEl.scrollHeight;
  });
}

document.getElementById("log-filter")?.addEventListener("change", renderTerminal);
