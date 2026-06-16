// aiClient.js — LetterBlack CEP IDE AI streaming client
// Routes by protocol field, not provider id — any provider with the same protocol works.
// Supported protocols: "openai" | "anthropic" | "gemini" | "ollama"

/**
 * Stream chat completions from any configured provider.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{protocol: string, apiKey?: string, model: string, endpoint?: string}} config
 * @yields {string} text chunks as they arrive
 */
export async function* streamChat(messages, config) {
  const { protocol, apiKey, model, endpoint } = config;

  switch (protocol) {
    case "openai":
      yield* streamOpenAI(messages, { apiKey, model, endpoint });
      break;
    case "anthropic":
      yield* streamAnthropic(messages, { apiKey, model, endpoint });
      break;
    case "gemini":
      yield* streamGemini(messages, { apiKey, model, temperature: config.temperature });
      break;
    case "ollama":
      yield* streamOllama(messages, { endpoint, model });
      break;
    default:
      throw { code: "UNSUPPORTED_PROTOCOL", message: `Unsupported protocol: ${protocol}`, stage: "chat" };
  }
}

// ── OpenAI-compatible streaming ───────────────────────────────────────────
// Works for: OpenAI, LM Studio, vLLM, OpenRouter, Groq, Together AI, etc.

async function* streamOpenAI(messages, { apiKey, model, endpoint }) {
  const url = `${endpoint || "https://api.openai.com/v1"}/chat/completions`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model: model || "gpt-4o", messages, stream: true }),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "OPENAI_HTTP_ERROR", message: `OpenAI-compatible request failed with ${resp.status}`, stage: "openai", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

// ── Anthropic streaming ───────────────────────────────────────────────────

async function* streamAnthropic(messages, { apiKey, model, endpoint }) {
  const base = endpoint || "https://api.anthropic.com";
  const url = `${base}/v1/messages`;

  const systemMsg = messages.find((m) => m.role === "system");
  const filtered = messages.filter((m) => m.role !== "system");

  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: 8192,
    stream: true,
    messages: filtered,
    ...(systemMsg ? { system: systemMsg.content } : {}),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "ANTHROPIC_HTTP_ERROR", message: `Anthropic request failed with ${resp.status}`, stage: "anthropic", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          yield json.delta.text;
        }
      } catch {}
    }
  }
}

// ── Google Gemini streaming ───────────────────────────────────────────────

async function* streamGemini(messages, { apiKey, model, temperature }) {
  const geminiModel = model || "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey || ""}&alt=sse`;

  const systemMsg = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body = {
    contents,
    generationConfig: { temperature: temperature ?? 0.7, maxOutputTokens: 8192 },
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "GEMINI_HTTP_ERROR", message: `Gemini request failed with ${resp.status}`, stage: "gemini", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {}
    }
  }
}

// ── Ollama streaming ──────────────────────────────────────────────────────

async function* streamOllama(messages, { endpoint, model }) {
  const url = `${endpoint || "http://localhost:11434"}/api/chat`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || "llama3", messages, stream: true }),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "OLLAMA_HTTP_ERROR", message: `Ollama request failed with ${resp.status}`, stage: "ollama", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: false });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed);
        const delta = json.message?.content || json.response;
        if (delta) yield delta;
        if (json.done) return;
      } catch {}
    }
  }
}
