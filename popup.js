// popup.js - логика расширения Binary Snap AI

const snapBtn = document.getElementById('snapBtn');
const payBtn = document.getElementById('payBtn');
const statusDiv = document.getElementById('status');
const aiResultDiv = document.getElementById('aiResult');

// Кнопки выбора сервера
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');

// Поля конфигурации
const serverUrlInput = document.getElementById('serverUrl');
const modelNameInput = document.getElementById('modelName');

let currentSnapData = null;
let selectedServer = "ollama"; // default: ollama или lmstudio

// Получаем текущую конфигурацию AI на старте
async function initConfig() {
    const config = await aiService.getAIConfig();
    
    if (config) {
        // Заполняем поля из storage
        serverUrlInput.value = config.ollama?.url?.replace('http://localhost:', '') || '11161';
        modelNameInput.value = config.ollama?.model || 'llama3';
        
        selectedServer = config.server || "ollama";
        updateServerButtons();
    }
}

// Обновляет кнопки выбора сервера
function updateServerButtons() {
    ollamaBtn.classList.toggle('active', selectedServer === "ollama");
    lmstudioBtn.classList.toggle('active', selectedServer === "lmstudio");
}

// Переключатель серверов
ollamaBtn.addEventListener('click', () => {
    selectedServer = "ollama";
    updateServerButtons();
    saveCurrentConfig();
});

lmstudioBtn.addEventListener('click', () => {
    selectedServer = "lmstudio";
    updateServerButtons();
    saveCurrentConfig();
});

// Сохраняет текущую конфигурацию
async function saveCurrentConfig() {
    const config = await aiService.getAIConfig();
    config.server = selectedServer;
    
    if (selectedServer === "ollama") {
        config.ollama.url = `http://localhost:${serverUrlInput.value || '11161'}`;
        config.ollama.model = modelNameInput.value || "llama3";
    } else {
        config.lmstudio.url = `http://localhost:${serverUrlInput.value || '8080'}`;
    }
    
    await aiService.saveAIConfig(config);
}

// Обработчик кнопки "Сгенерировать слепок"
snapBtn.addEventListener('click', async () => {
    statusDiv.textContent = "Генерация слепка...";
    aiResultDiv.textContent = "";
    
    // 1. Получаем данные активной вкладки
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url) {
        statusDiv.textContent = "Нет активной страницы.";
        return;
    }
    
    // 2. Отправляем команду content script'у для захвата данных
    const pageData = await sendMessageToContent("CAPTURE");
    
    if (pageData) {
        // 3. Анализируем текст через AI сервис
        statusDiv.textContent = "Анализ через AI...";
        
        try {
            const aiMetadata = await window.aiService.analyzePageText(
                pageData.textSnippet, 
                selectedServer
            );
            
            // 4. Формируем слепок с реальными данными
            currentSnapData = {
                source_url: tab.url,
                thumbnail_base64: pageData.thumbnail || "",
                binary_data: generateBinaryHash(tab.url + Date.now()),
                metadata_ai: aiMetadata
            };
            
            // Показываем результат AI анализа
            aiResultDiv.innerHTML = formatAIResult(aiMetadata);
            
            statusDiv.textContent = "Отправка на сервер...";
            
            // 5. Отправляем данные на FastAPI сервер
            const result = await sendSnapToServer(currentSnapData);
            
            if (result?.status === "success") {
                statusDiv.innerHTML = `Слепок сохранен!<br>ID: ${result.snap_id}`;
                payBtn.style.display = 'block';
            } else {
                // Даже если сервер недоступен, показываем результат AI
                statusDiv.textContent = "Слепок сгенерирован локально.";
                payBtn.style.display = 'block';
            }
            
        } catch (error) {
            console.error("AI error:", error);
            statusDiv.textContent = "Ошибка AI анализа. Использую fallback...";
            
            // Fallback: используем basic metadata без AI
            currentSnapData = {
                source_url: tab.url,
                thumbnail_base64: "",
                binary_data: generateBinaryHash(tab.url + Date.now()),
                metadata_ai: { tags: [], sentiment: 0, summary: "AI недоступен", category: "other" }
            };
            
            payBtn.style.display = 'block';
        }
    } else {
        statusDiv.textContent = "Не удалось захватить страницу.";
    }
});

// Обработчик кнопки оплаты
payBtn.addEventListener('click', () => {
    if (!currentSnapData) return;
    
    statusDiv.innerHTML = "Открывается окно Blik...";
    
    setTimeout(() => {
        statusDiv.innerHTML = "Оплата прошла успешно!<br>Слепок активирован.";
    }, 2000);
});

// Отправляет сообщение content script'у и получает ответ
function sendMessageToContent(type) {
    return new Promise((resolve) => {
        const [tab] = chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab?.id) {
            resolve(null);
            return;
        }
        
        chrome.tabs.sendMessage(tab.id, { type }, (response) => {
            resolve(response || null);
        });
    });
}

// Отправляет слепок на FastAPI сервер
async function sendSnapToServer(data) {
    try {
        const response = await fetch('http://127.0.0.1:8000/api/add-snap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        return await response.json();
    } catch (error) {
        console.error("Server error:", error);
        return null;
    }
}

// Генерирует бинарный hash из строки
function generateBinaryHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash.toString(2);
}

// Форматирует результат AI для отображения
function formatAIResult(metadata) {
    if (!metadata) return "";
    
    let html = `<strong>Tags:</strong> ${metadata.tags?.join(', ') || 'none'}<br>`;
    html += `<strong>Sentiment:</strong> ${metadata.sentiment}<br>`;
    html += `<strong>Category:</strong> ${metadata.category}<br>`;
    html += `<em>${metadata.summary}</em>`;
    
    return html;
}

// Инициализация при загрузке popup'а
initConfig();