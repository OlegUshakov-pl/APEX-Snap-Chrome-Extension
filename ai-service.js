// ai-service.js - AI page analyzer (supports Ollama and LM Studio)

const DEFAULT_CONFIG = {
    // Default AI server ("ollama" or "lmstudio")
    server: "ollama",

    ollama: {
        url: "http://127.0.0.1:11434",
        port: "11434",
        model: "llama3"
    },

    lmstudio: {
        url: "http://127.0.0.1:1234",
        port: "1234",
        model: "" // LM Studio uses the model loaded in its UI
    }
};

// System prompt for page analysis
const SYSTEM_PROMPT = `You are a web page AI analyzer. Analyze the text and return JSON with these fields:
- tags: array of 3-5 keyword tags (strings)
- sentiment: number from -1 to 1 (negative to positive)
- summary: brief description of the page (up to 2 sentences)
- category: page category (news, tech, sports, politics, entertainment, education, other)

Example output:
{
  "tags": ["tag1", "tag2"],
  "sentiment": 0.5,
  "summary": "Brief description...",
  "category": "news"
}`;

function portFromUrl(url) {
    try {
        return new URL(url).port || "";
    } catch (e) {
        return "";
    }
}

// Fills missing fields so every consumer sees one consistent config shape
function normalizeConfig(raw) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, raw || {});
    cfg.ollama = Object.assign({}, DEFAULT_CONFIG.ollama, raw?.ollama || {});
    cfg.lmstudio = Object.assign({}, DEFAULT_CONFIG.lmstudio, raw?.lmstudio || {});

    if (!cfg.ollama.port) cfg.ollama.port = portFromUrl(cfg.ollama.url) || DEFAULT_CONFIG.ollama.port;
    if (!cfg.lmstudio.port) cfg.lmstudio.port = portFromUrl(cfg.lmstudio.url) || DEFAULT_CONFIG.lmstudio.port;

    cfg.ollama.url = `http://127.0.0.1:${cfg.ollama.port}`;
    cfg.lmstudio.url = `http://127.0.0.1:${cfg.lmstudio.port}`;

    if (cfg.server !== "ollama" && cfg.server !== "lmstudio") cfg.server = "ollama";
    return cfg;
}

// Gets current configuration from storage (or defaults)
function getAIConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['ai_config'], (result) => {
            resolve(normalizeConfig(result.ai_config));
        });
    });
}

// Saves AI configuration
function saveAIConfig(config) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ ai_config: normalizeConfig(config) }, () => {
            resolve(true);
        });
    });
}

// Base URL of a configured AI server, e.g. "http://127.0.0.1:11434"
function serverBaseUrl(config, key) {
    const section = (config && config[key]) || DEFAULT_CONFIG[key];
    return String(section.url || `http://127.0.0.1:${section.port}`).replace(/\/+$/, '');
}

// Analyzes page text (or a file list) through the selected AI service
async function analyzePageText(textOrFilesList, serverChoice) {
    const config = await getAIConfig();
    const useLmStudio = (serverChoice || config.server) === "lmstudio";

    const text = String(textOrFilesList || "").substring(0, 2000);
    const prompt = `Analyze web page text and return JSON:\n\n${text}`;

    if (useLmStudio) {
        return await callLMStudio(serverBaseUrl(config, "lmstudio"), config.lmstudio.model, prompt);
    }
    return await callOllama(serverBaseUrl(config, "ollama"), config.ollama.model || "llama3", prompt);
}

/**
 * Calls Ollama: POST /api/generate
 */
async function callOllama(baseUrl, model, promptText) {
    try {
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: `${SYSTEM_PROMPT}\n\n${promptText}`,
                stream: false
            })
        });
        if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
        const result = await response.json();
        return parseAIResponse(result.response || "");
    } catch (error) {
        console.warn('Ollama server unavailable:', error.message);
        return generateFallbackMetadata(promptText);
    }
}

/**
 * Calls LM Studio: POST /v1/chat/completions (OpenAI-compatible)
 */
async function callLMStudio(baseUrl, model, promptText) {
    try {
        const body = {
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: promptText }
            ],
            temperature: 0.3,
            max_tokens: 500
        };
        if (model) body.model = model;

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`LM Studio responded with ${response.status}`);
        const result = await response.json();
        const message = result.choices?.[0]?.message?.content || "";
        return parseAIResponse(message);
    } catch (error) {
        console.warn('LM Studio server unavailable:', error.message);
        return generateFallbackMetadata(promptText);
    }
}

// Parses AI response and extracts JSON
function parseAIResponse(text) {
    const cleaned = String(text || "")
        .replace(/```(?:json)?/gi, "")
        .trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try {
            return JSON.parse(cleaned.substring(start, end + 1));
        } catch (e) {
            console.error("JSON parse error:", e);
        }
    }
    return generateFallbackMetadata(cleaned);
}

// Generates fallback metadata if AI is unavailable
function generateFallbackMetadata(text) {
    const words = String(text || "").split(/\s+/).slice(0, 5);
    return {
        tags: [...new Set(words.map(w => w.trim()).filter(w => w.length > 3))],
        sentiment: 0,
        summary: String(text || "").substring(0, 150),
        category: "other"
    };
}

// Fetches models from Ollama (GET /api/tags)
async function fetchOllamaModels(baseUrl) {
    try {
        const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/api/tags`);
        if (!response.ok) throw new Error("Failed to fetch Ollama models");
        const data = await response.json();
        const models = Array.isArray(data) ? data : (data?.models || []);
        return models.map(m => typeof m === 'string' ? m : (m?.name || m?.id || '')).filter(Boolean);
    } catch (error) {
        console.warn("Ollama model fetch error:", error.message);
        return [];
    }
}

// Fetches models from LM Studio (GET /v1/models)
async function fetchLMStudioModels(baseUrl) {
    try {
        const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/v1/models`);
        if (!response.ok) throw new Error("Failed to fetch LM Studio models");
        const data = await response.json();
        const models = Array.isArray(data) ? data : (data?.data || []);
        return models.map(m => typeof m === 'string' ? m : (m?.id || '')).filter(Boolean);
    } catch (error) {
        console.warn("LM Studio model fetch error:", error.message);
        return [];
    }
}

// Export functions
window.aiService = {
    analyzePageText,
    getAIConfig,
    saveAIConfig,
    normalizeConfig,
    serverBaseUrl,
    fetchOllamaModels,
    fetchLMStudioModels,
    DEFAULT_CONFIG
};
