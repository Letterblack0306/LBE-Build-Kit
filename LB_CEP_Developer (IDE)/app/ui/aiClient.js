// aiClient.js — LetterBlack CEP IDE AI streaming client
// Unified async generator interface for OpenAI, Gemini, and Local LLM (Ollama)

/**
 * Stream chat completions from any configured provider.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{provider: string, apiKey: string, model: string, endpoint: string}} config
 * @yields {string} text chunks as they arrive
 */
export async function* streamChat(messages, config) {
  const { provider, apiKey, model, endpoint } = config;

  if (provider === "openai") {
    yield* streamOpenAI(messages, { apiKey, model, endpoint });
  } else if (provider === "gemini") {
    yield* streamGemini(messages, { apiKey, model, temperature: config.temperature });
  } else if (provider === "local") {
    yield* streamLocal(messages, { endpoint, model });
  } else {
    throw { code: "UNSUPPORTED_PROVIDER", message: `Unsupported provider: ${provider}`, stage: "chat" };
  }
}

// ── OpenAI-compatible streaming ───────────────────────────────────────────

async function* streamOpenAI(messages, { apiKey, model, endpoint }) {
  const url = endpoint || "https://api.openai.com/v1/chat/completions";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "OPENAI_HTTP_ERROR", message: `OpenAI request failed with ${resp.status}`, stage: "openai", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Partial chunk or malformed — skip safely
      }
    }
  }
}

// ── Google Gemini streaming ───────────────────────────────────────────────

async function* streamGemini(messages, { apiKey, model, temperature }) {
  const geminiModel = model || "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}&alt=sse`;

  // Gemini does NOT accept role "assistant" or "system" inside contents.
  // system → systemInstruction (separate field, not in contents array)
  // assistant → model
  const systemMsg = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: 8192
    },
    ...(systemMsg
      ? { systemInstruction: { parts: [{ text: systemMsg.content }] } }
      : {}),
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
      } catch {
        // Partial chunk — skip
      }
    }
  }
}

// ── Local LLM (Ollama-compatible) ────────────────────────────────────────

async function* streamLocal(messages, { endpoint, model }) {
  // Ollama: POST /api/chat → newline-delimited JSON (NDJSON)
  const url = endpoint || "http://localhost:11434/api/chat";

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3",
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    let details = "";
    try { details = await resp.text(); } catch {}
    throw { code: "LOCAL_HTTP_ERROR", message: `Local model request failed with ${resp.status}`, stage: "local", details };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: false });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep partial last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed);
        const delta = json.message?.content || json.response;
        if (delta) yield delta;
        if (json.done) return;
      } catch {
        // Malformed NDJSON line — skip
      }
    }
  }
}
