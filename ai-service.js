// ai-service.js - AI анализатор страниц (поддерживает Ollama и LM Studio)

const DEFAULT_CONFIG = {
    // Сервер AI по умолчанию (Ollama или LMStudio)
    server: "ollama",
    
    // Конфигурация Ollama
    ollama: {
        url: "http://localhost:11161",
        model: "llama3"
    },
    
    // Конфигурация LM Studio
    lmstudio: {
        url: "http://localhost:8080",
        model: "" // LM Studio использует модель загруженную в UI
    }
};

// Системный промпт для анализа страницы
const SYSTEM_PROMPT = `Ты AI-анализатор веб-страниц. Проанализируй текст и верни JSON с такими полями:
- tags: массив из 3-5 ключевых тегов (strings)
- sentiment: число от -1 до 1 (отрицательный до положительного)
- summary: краткое описание страницы (до 2 предложений)
- category: категория страницы (news, tech, sports, politics, entertainment, education, other)

Пример вывода:
{
  "tags": ["тег1", "тег2"],
  "sentiment": 0.5,
  "summary": "Краткое описание...",
  "category": "news"
}`;

// Получает текущую конфигурацию из storage или default
function getAIConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['ai_config'], (result) => {
            const config = result.ai_config || DEFAULT_CONFIG;
            resolve(config);
        });
    });
}

// Сохраняет конфигурацию AI
function saveAIConfig(config) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ ai_config: config }, () => {
            resolve(true);
        });
    });
}

// Анализирует текст страницы или список файлов через выбранный AI сервис
async function analyzePageText(textOrFilesList, serverChoice = "ollama") {
    const config = await getAIConfig();
    
    // Опредаем URL и модель
    let apiUrl;
    let model;
    
    if (serverChoice === "lmstudio" || config.server === "lmstudio") {
        // LM Studio использует OpenAI-compatible endpoint
        apiUrl = `${config.lmstudio.url}/v1/chat/completions`;
        model = config.lmstudio.model || null; // LM Studio uses loaded model
    } else {
        // Ollama default
        apiUrl = `${config.ollama.url}/api/generate`;
        model = config.ollama.model || "llama3";
    }
    
    const prompt = `Анализируй текст веб-страницы и верни JSON:\n\n${textOrFilesList.substring(0, 2000)}`;
    
    // Запрос зависит от сервера
    if (serverChoice === "lmstudio" || config.server === "lmstudio") {
        return await callLMStudio(apiUrl, prompt);
    } else {
        return await callOllama(apiUrl, model, prompt);
    }
}

// Вызов Ollama API
async function callOllama(url, model, text) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: model,
                prompt: `${SYSTEM_PROMPT}\n\nТекст страницы:\n${text}`,
                stream: false
            })
        });
        
        const result = await response.json();
        return parseAIResponse(result.response || "");
    } catch (error) {
        console.error("Ollama error:", error);
        return generateFallbackMetadata(text);
    }
}

// Вызов LM Studio API (OpenAI-compatible)
async function callLMStudio(url, text) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `Текст страницы:\n${text}` }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });
        
        const result = await response.json();
        const message = result.choices?.[0]?.message?.content || "";
        return parseAIResponse(message);
    } catch (error) {
        console.error("LM Studio error:", error);
        return generateFallbackMetadata(text);
    }
}

// Парсит ответ AI и извлекает JSON
function parseAIResponse(text) {
    // Ищет JSON в тексте
    const jsonMatch = text.match(/\{[^]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("JSON parse error:", e);
            return generateFallbackMetadata(text);
        }
    }
    
    // Fallback если AI не вернул корректный JSON
    return generateFallbackMetadata(text);
}

// Генерирует fallback metadata если AI недоступен
function generateFallbackMetadata(text) {
    const words = text.split(/\s+/).slice(0, 5);
    return {
        tags: [...new Set(words.map(w => w.trim()).filter(w => w.length > 3))],
        sentiment: Math.random() * 2 - 1, // случайное для placeholder
        summary: text.substring(0, 150) + "...",
        category: "other"
    };
}

// Экспорт функций
window.aiService = {
    analyzePageText,
    getAIConfig,
    saveAIConfig,
    DEFAULT_CONFIG
};