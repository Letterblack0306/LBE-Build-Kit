const PROVIDERS = {
    openai: {
        id: "openai",
        label: "OpenAI",
        capabilities: ["chat", "code", "image", "multimodal"],
        defaultEndpoint: "https://api.openai.com/v1",
    },
    gemini: {
        id: "gemini",
        label: "Gemini",
        capabilities: ["chat", "code", "image", "multimodal"],
        defaultEndpoint: "",
    },
    local: {
        id: "local",
        label: "Local LLM",
        capabilities: ["chat", "code"],
        defaultEndpoint: "http://localhost:11434",
    },
};

export function listProviders() {
    return Object.values(PROVIDERS);
}

export function getProvider(providerId) {
    return PROVIDERS[providerId] || null;
}

function inferCapabilities(modelName = "") {
    const name = String(modelName).toLowerCase();
    const caps = new Set(["chat"]);
    if (/code|coder|dev|program/.test(name)) caps.add("code");
    if (/vision|image|multimodal|omni|vl|pix/.test(name)) {
        caps.add("image");
        caps.add("multimodal");
    }
    if (/mini|flash|haiku|small|tiny/.test(name)) caps.add("fast");
    return [...caps];
}

export async function fetchProviderModels({ provider, apiKey, endpoint }) {
    if (provider === "openai") {
        const base = endpoint || "https://api.openai.com/v1";
        const res = await fetch(`${base}/models`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        });
        if (!res.ok) throw new Error(`OpenAI models failed (${res.status})`);
        const json = await res.json();
        const models = Array.isArray(json?.data) ? json.data : [];
        return models
            .map((m) => ({ id: m.id, label: m.id, capabilities: inferCapabilities(m.id) }))
            .filter((m) => !!m.id)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey || ""}`);
        if (!res.ok) throw new Error(`Gemini models failed (${res.status})`);
        const json = await res.json();
        const models = Array.isArray(json?.models) ? json.models : [];
        return models
            .map((m) => {
                const full = m.name || "";
                const id = full.replace(/^models\//, "");
                return { id, label: id, capabilities: inferCapabilities(id) };
            })
            .filter((m) => !!m.id)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    if (provider === "local") {
        const base = endpoint || "http://localhost:11434";
        const res = await fetch(`${base}/api/tags`);
        if (!res.ok) throw new Error(`Local model list failed (${res.status})`);
        const json = await res.json();
        const models = Array.isArray(json?.models) ? json.models : [];
        return models
            .map((m) => {
                const id = m.name || m.model || "";
                return { id, label: id, capabilities: inferCapabilities(id) };
            })
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
        if (capability === "chat" && /chat|gpt|gemini|llama|mistral|qwen/.test(s)) v += 20;
        if (/pro|4o|4\.1|1\.5-pro/.test(s)) v += 10;
        if (/mini|flash|small|tiny/.test(s)) v -= 3;
        return v;
    };
    return [...list].sort((a, b) => score(b.id) - score(a.id))[0]?.id || list[0]?.id || "";
}
