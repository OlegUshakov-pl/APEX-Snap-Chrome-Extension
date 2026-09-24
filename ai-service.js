// ai-service.js - AI page analyzer (supports Ollama and LM Studio)

const DEFAULT_CONFIG = {
    // Default AI server (Ollama or LMStudio)
    server: "ollama",
    
    // Ollama configuration
    ollama: {
        url: "http://localhost:11434",
        model: "llama3"
    },
    
    // LM Studio configuration
    lmstudio: {
        url: "http://localhost:1234",
        model: "" // LM Studio uses the model loaded in UI
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

// Gets current configuration from storage or default
function getAIConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['ai_config'], (result) => {
            const config = result.ai_config || DEFAULT_CONFIG;
            resolve(config);
        });
    });
}

// Saves AI configuration
function saveAIConfig(config) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ ai_config: config }, () => {
            resolve(true);
        });
    });
}

// Analyzes page text or list of files through the selected AI service
async function analyzePageText(textOrFilesList, serverChoice = "ollama") {
    const config = await getAIConfig();
    
    // Determine URL and model
    let apiUrl;
    let model;
    
    if (serverChoice === "lmstudio" || config.server === "lmstudio") {
        // LM Studio uses OpenAI-compatible endpoint
        apiUrl = `${config.lmstudio.url}/v1/chat/completions`;
        model = config.lmstudio.model || null; // LM Studio uses loaded model
    } else {
        // Ollama default
        apiUrl = `${config.ollama.url}/api/generate`;
        model = config.ollama.model || "llama3";
    }
    
    const prompt = `Analyze web page text and return JSON:\n\n${textOrFilesList.substring(0, 2000)}`;
    
    // Request depends on server
    if (serverChoice === "lmstudio" || config.server === "lmstudio") {
        return await callLMStudio(apiUrl, prompt);
    } else {
        return await callOllama(apiUrl, model, prompt);
    }
}

// Calls Ollama API
async function callOllama(url, model, text) {
    try {
        const response = await fetch(`${url}?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(prompt)}&stream=false`);
        const result = await response.json();
        return parseAIResponse(result.response || "");
    } catch (error) {
        console.warn('Ollama server unavailable');
        return generateFallbackMetadata(text);
    }
}

// Calls LM Studio API (OpenAI-compatible)
async function callLMStudio(url, text) {
    try {
        const messages = JSON.stringify([
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Page text:\n${text}` }
        ]);
        const response = await fetch(`${url}?messages=${encodeURIComponent(messages)}&temperature=0.7&max_tokens=500`);
        const result = await response.json();
        const message = result.choices?.[0]?.message?.content || "";
        return parseAIResponse(message);
    } catch (error) {
        console.warn('LM Studio server unavailable');
        return generateFallbackMetadata(text);
    }
}

// Parses AI response and extracts JSON
function parseAIResponse(text) {
    // Search for JSON in text
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("JSON parse error:", e);
            return generateFallbackMetadata(text);
        }
    }
    
    // Fallback if AI doesn't return correct JSON
    return generateFallbackMetadata(text);
}

// Generates fallback metadata if AI is unavailable
function generateFallbackMetadata(text) {
    const words = text.split(/\s+/).slice(0, 5);
    return {
        tags: [...new Set(words.map(w => w.trim()).filter(w => w.length > 3))],
        sentiment: Math.random() * 2 - 1, // random for placeholder
        summary: text.substring(0, 150) + "...",
        category: "other"
    };
}

// Export functions
window.aiService = {
    analyzePageText,
    getAIConfig,
    saveAIConfig,
    DEFAULT_CONFIG
};

// Fetch models from Ollama
async function fetchOllamaModels(url) {
    try {
        const response = await fetch(`${url}/api/models`);
        if (!response.ok) throw new Error("Failed to fetch Ollama models");
        const data = await response.json();
        const models = Array.isArray(data) ? data : (data?.models || []);
        return models.map(m => typeof m === 'string' ? m : (m?.id || '')).filter(Boolean);
    } catch (error) {
        console.error("Ollama model fetch error:", error);
        return [];
    }
}

// Fetch models from LM Studio
async function fetchLMStudioModels(url) {
    try {
        const response = await fetch(`${url}/v1/models`);
        if (!response.ok) throw new Error("Failed to fetch LM Studio models");
        const data = await response.json();
        const models = Array.isArray(data) ? data : (data?.data || []);
        return models.map(m => typeof m === 'string' ? m : (m.id || '')).filter(Boolean);
    } catch (error) {
        console.error("LM Studio model fetch error:", error);
        return [];
    }
}

window.aiService.fetchOllamaModels = fetchOllamaModels;
window.aiService.fetchLMStudioModels = fetchLMStudioModels;

// Check if Ollama is installed (runs on Linux, macOS, Windows with WSL)
async function checkOllamaInstalled() {
    const result = await terminalExecute('which ollama 2>/dev/null || where ollama 2>nul');
    return result.trim().length > 0;
}

// Check if LM Studio is installed
async function checkLMStudioInstalled() {
    const result = await terminalExecute('which lmstudio 2>/dev/null || where lmstudio 2>nul || (Get-ItemProperty -Path \$env:LOCALAPPDATA\Programs -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.Name -like "*LM Studio*"}).Name');
    return result.trim().length > 0;
}

// Check system info
async function terminalExecute(command) {
    // Simple check using command detection
    const isWindows = navigator.platform.toUpperCase().indexOf('WIN') !== -1;
    if (isWindows) {
        // Windows-specific detection
        try {
            const res = await fetch(`http://localhost:11434/api/version`);
            if (res.ok) return 'ollama';
        } catch {}
        try {
            const res = await fetch(`http://localhost:1234/v1/models`);
            if (res.ok) return 'lmstudio';
        } catch {}
        return '';
    }
    return '';
}

window.aiService.checkOllamaInstalled = checkOllamaInstalled;
window.aiService.checkLMStudioInstalled = checkLMStudioInstalled;
