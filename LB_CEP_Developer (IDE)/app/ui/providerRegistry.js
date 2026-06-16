// providerRegistry.js — loads provider definitions from config/providers.json via IPC.
// Protocol field drives routing in aiClient.js — any provider with protocol "openai"
// works with the OpenAI streaming path (LM Studio, vLLM, OpenRouter, Groq, etc.).

const DEFAULT_PROVIDERS = [
  { id: "openai",    label: "OpenAI",          protocol: "openai",    endpoint: "https://api.openai.com/v1",                       defaultModel: "gpt-4o",                 apiKeyRequired: true,  enabled: true },
  { id: "anthropic", label: "Anthropic",        protocol: "anthropic", endpoint: "https://api.anthropic.com",                       defaultModel: "claude-sonnet-4-6",      apiKeyRequired: true,  enabled: true },
  { id: "gemini",    label: "Google Gemini",    protocol: "gemini",    endpoint: "https://generativelanguage.googleapis.com",       defaultModel: "gemini-1.5-pro",         apiKeyRequired: true,  enabled: true },
  { id: "ollama",    label: "Ollama (Local)",   protocol: "ollama",    endpoint: "http://localhost:11434",                          defaultModel: "llama3",                 apiKeyRequired: false, enabled: true },
];

let _providers = null;

export async function loadProviders() {
  if (_providers) return _providers;
  try {
    if (typeof window !== "undefined" && window.ide?.loadProviders) {
      const config = await window.ide.loadProviders();
      if (Array.isArray(config?.providers)) {
        _providers = config.providers.filter((p) => p.enabled !== false);
        return _providers;
      }
    }
  } catch {}
  _providers = DEFAULT_PROVIDERS;
  return _providers;
}

export function listProviders() {
  return _providers || DEFAULT_PROVIDERS;
}

export function getProvider(providerId) {
  return listProviders().find((p) => p.id === providerId) || null;
}

export async function saveProviders(providers) {
  if (typeof window !== "undefined" && window.ide?.saveProviders) {
    return window.ide.saveProviders({ version: "1.0", providers });
  }
  return { ok: false, error: "saveProviders IPC not available" };
}

function inferCapabilities(modelName = "") {
  const name = String(modelName).toLowerCase();
  const caps = new Set(["chat"]);
  if (/code|coder|dev|program/.test(name)) caps.add("code");
  if (/vision|image|multimodal|omni|vl|pix/.test(name)) { caps.add("image"); caps.add("multimodal"); }
  if (/mini|flash|haiku|small|tiny/.test(name)) caps.add("fast");
  return [...caps];
}

export async function fetchProviderModels({ provider, apiKey, endpoint }) {
  const def = getProvider(provider);
  if (!def) return [];
  const protocol = def.protocol;
  const base = endpoint || def.endpoint || "";

  if (protocol === "openai") {
    const res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`Model list failed (${res.status})`);
    const json = await res.json();
    return (Array.isArray(json?.data) ? json.data : [])
      .map((m) => ({ id: m.id, label: m.id, capabilities: inferCapabilities(m.id) }))
      .filter((m) => !!m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  if (protocol === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey || ""}`);
    if (!res.ok) throw new Error(`Model list failed (${res.status})`);
    const json = await res.json();
    return (Array.isArray(json?.models) ? json.models : [])
      .map((m) => { const id = (m.name || "").replace(/^models\//, ""); return { id, label: id, capabilities: inferCapabilities(id) }; })
      .filter((m) => !!m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  if (protocol === "anthropic") {
    return [
      { id: "claude-opus-4-8",      label: "Claude Opus 4.8",    capabilities: ["chat", "code"] },
      { id: "claude-sonnet-4-6",    label: "Claude Sonnet 4.6",  capabilities: ["chat", "code"] },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", capabilities: ["chat", "code", "fast"] },
    ];
  }

  if (protocol === "ollama") {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Model list failed (${res.status})`);
    const json = await res.json();
    return (Array.isArray(json?.models) ? json.models : [])
      .map((m) => { const id = m.name || m.model || ""; return { id, label: id, capabilities: inferCapabilities(id) }; })
      .filter((m) => !!m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  return [];
}

export function filterModelsByCapability(models = [], capability = "chat") {
  if (!capability || capability === "any") return models;
  return models.filter((m) => Array.isArray(m.capabilities) && m.capabilities.includes(capability));
}

export function pickBestModel(models = [], capability = "chat") {
  if (!Array.isArray(models) || models.length === 0) return "";
  const candidates = filterModelsByCapability(models, capability);
  const list = candidates.length ? candidates : models;
  const score = (id) => {
    const s = String(id || "").toLowerCase();
    let v = 0;
    if (capability === "code" && /code|coder|dev/.test(s)) v += 40;
    if (capability === "image" && /vision|image|omni|multimodal/.test(s)) v += 40;
    if (capability === "chat" && /chat|gpt|gemini|llama|mistral|qwen|claude/.test(s)) v += 20;
    if (/pro|4o|4\.1|opus|1\.5-pro/.test(s)) v += 10;
    if (/mini|flash|small|tiny|haiku/.test(s)) v -= 3;
    return v;
  };
  return [...list].sort((a, b) => score(b.id) - score(a.id))[0]?.id || list[0]?.id || "";
}
