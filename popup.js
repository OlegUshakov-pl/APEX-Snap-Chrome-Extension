// popup.js - ApexScan popup: capture page, AI analysis, send snapshot to server

const snapBtn = document.getElementById('snapBtn');
const folderBtn = document.getElementById('folderBtn');
const statusDiv = document.getElementById('status');
const aiResultDiv = document.getElementById('aiResult');
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');
const refreshBtn = document.getElementById('refreshBtn');
const aiPortInput = document.getElementById('aiPort');
const aiPortLabel = document.getElementById('aiPortLabel');
const modelSelect = document.getElementById('modelSelect');
const modelLabel = document.getElementById('modelLabel');
const serverUrlText = document.getElementById('serverUrlText');

let selectedServer = "ollama"; // "ollama" or "lmstudio"
let currentSnapData = null;

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function defaultPort(server) {
    return server === 'ollama' ? '11434' : '1234';
}

// ---------- JSON server address (configured on the settings page) ----------

async function getServerUrl() {
    try {
        const result = await chrome.storage.sync.get(['server_url']);
        const url = String(result.server_url || '').trim();
        if (url) {
            return (/^https?:\/\//i.test(url) ? url : `http://${url}`).replace(/\/+$/, '');
        }
    } catch (e) {
        console.warn("Failed to read server_url from storage", e);
    }
    return 'http://127.0.0.1:8000';
}

async function showServerUrl() {
    if (serverUrlText) serverUrlText.textContent = await getServerUrl();
}

// ---------- configuration ----------

async function initConfig() {
    const config = await aiService.getAIConfig();

    selectedServer = config.server || "ollama";
    aiPortInput.value = config[selectedServer]?.port || defaultPort(selectedServer);

    updateServerButtons();
    await showServerUrl();
}

function updateServerButtons() {
    ollamaBtn.classList.toggle('active', selectedServer === "ollama");
    lmstudioBtn.classList.toggle('active', selectedServer === "lmstudio");

    const isOllama = selectedServer === 'ollama';
    if (aiPortLabel) aiPortLabel.textContent = isOllama ? 'Ollama port:' : 'LM Studio port:';
    if (modelLabel) modelLabel.textContent = isOllama ? 'Model (for Ollama):' : 'Model (for LM Studio):';
}

async function saveCurrentConfig() {
    const config = await aiService.getAIConfig();
    config.server = selectedServer;

    const port = String(aiPortInput.value || '').trim() || defaultPort(selectedServer);
    config[selectedServer].port = port;
    config[selectedServer].url = `http://127.0.0.1:${port}`;

    const model = modelSelect.value;
    if (model) config[selectedServer].model = model;

    await aiService.saveAIConfig(config);
}

async function switchServer(server) {
    selectedServer = server;
    updateServerButtons();
    aiPortInput.value = (await aiService.getAIConfig())[server]?.port || defaultPort(server);
    await saveCurrentConfig();

    await Promise.all([
        updateAvailableModelsDisplay(),
        checkConnectionStatus(),
        refreshModelSelectForServer()
    ]);
}

ollamaBtn.addEventListener('click', () => switchServer('ollama'));
lmstudioBtn.addEventListener('click', () => switchServer('lmstudio'));

aiPortInput.addEventListener('change', async () => {
    await saveCurrentConfig();
    await Promise.all([updateAvailableModelsDisplay(), checkConnectionStatus()]);
});

modelSelect.addEventListener('change', () => saveCurrentConfig());

// ---------- snapshot ----------

snapBtn.addEventListener('click', async () => {
    statusDiv.textContent = "Generating snapshot...";
    aiResultDiv.textContent = "";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
        statusDiv.textContent = "No active page found.";
        return;
    }

    const pageData = await capturePage(tab);
    if (!pageData) {
        statusDiv.textContent = "Cannot read this page (browser page?).";
        return;
    }

    statusDiv.textContent = "Analyzing via AI...";

    let thumbnail = "";
    try {
        thumbnail = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
    } catch (e) {
        console.warn("Screenshot unavailable:", e.message);
    }

    let aiMetadata;
    try {
        aiMetadata = await aiService.analyzePageText(pageData.textSnippet, selectedServer);
    } catch (error) {
        console.error("AI error:", error);
        aiMetadata = { tags: [], sentiment: 0, summary: "AI unavailable", category: "other" };
        statusDiv.textContent = "AI analysis failed. Using fallback...";
    }

    currentSnapData = {
        source_url: tab.url,
        thumbnail_base64: thumbnail,
        metadata_ai: aiMetadata
    };

    aiResultDiv.innerHTML = formatAIResult(aiMetadata);
    statusDiv.textContent = "Sending to server...";

    const result = await sendSnapToServer(currentSnapData);
    if (result?.status === "success") {
        statusDiv.innerHTML = `Snapshot saved!<br>ID: ${escapeHtml(result.snap_id)}`;
    } else {
        statusDiv.textContent = "Server unavailable - snapshot kept locally.";
    }
});

// Folder analysis button
folderBtn.addEventListener('click', async () => {
    try {
        if (!('showDirectoryPicker' in window)) {
            statusDiv.textContent = "Your browser doesn't support folder selection. Use Chrome/Edge.";
            return;
        }

        const handle = await window.showDirectoryPicker();
        statusDiv.textContent = `Selected folder: ${handle.name}`;

        const files = [];
        for await (const entry of handle.values()) {
            if (entry.kind === 'file') files.push(entry.name);
        }

        statusDiv.textContent = `Found ${files.length} files, analyzing...`;
        aiResultDiv.innerHTML = `<strong>Files:</strong><br>${files.map(f => `- ${escapeHtml(f)}`).join('<br>')}`;

        currentSnapData = {
            source_url: `file:///${handle.name}`,
            thumbnail_base64: "",
            metadata_ai: await aiService.analyzePageText(files.join('\n'), selectedServer)
        };

        const result = await sendSnapToServer(currentSnapData);
        statusDiv.textContent = result?.status === 'success'
            ? `Folder snapshot saved! ID: ${result.snap_id}`
            : `Folder snapshot generated locally (${files.length} files).`;
    } catch (error) {
        console.error("Folder error:", error);
        statusDiv.textContent = error?.name === 'AbortError' ? "Folder selection cancelled" : "Error selecting folder";
    }
});

// ---------- page capture ----------

async function capturePage(tab) {
    // 1) content script from the manifest
    try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE" });
        if (response && typeof response.textSnippet === 'string') return response;
    } catch (e) {
        console.warn("Content script not available, injecting:", e.message);
    }

    // 2) fallback: inject on demand
    try {
        const [injected] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({
                url: location.href,
                title: document.title,
                textSnippet: (document.body && document.body.innerText ? document.body.innerText : '').substring(0, 2000),
                timestamp: Date.now()
            })
        });
        return injected?.result || null;
    } catch (e) {
        console.warn("Page capture failed:", e.message);
        return null;
    }
}

// ---------- server ----------

async function sendSnapToServer(data) {
    try {
        const base = await getServerUrl();
        const endpoint = data.source_url.startsWith('file://')
            ? '/api/add-folder-snap'
            : '/api/add-snap';

        console.log(`Sending to ${base}${endpoint}...`);
        const response = await fetch(`${base}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            console.warn(`Server responded with ${response.status}`);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.warn('Server unavailable:', error.message);
        return null;
    }
}

// ---------- display ----------

function formatAIResult(metadata) {
    if (!metadata) return "";

    let html = `<strong>Tags:</strong> ${escapeHtml((metadata.tags || []).join(', ') || 'none')}<br>`;
    html += `<strong>Sentiment:</strong> ${escapeHtml(metadata.sentiment)}<br>`;
    html += `<strong>Category:</strong> ${escapeHtml(metadata.category || 'other')}<br>`;
    html += `<em>${escapeHtml(metadata.summary || '')}</em>`;
    return html;
}

// ---------- connection status / models ----------

async function ping(url) {
    try {
        const response = await fetch(url);
        return response.ok;
    } catch (e) {
        return false;
    }
}

async function checkConnectionStatus() {
    const ollamaLamp = document.getElementById('ollamaLamp');
    const lmstudioLamp = document.getElementById('lmstudioLamp');
    if (!ollamaLamp || !lmstudioLamp) return;

    const config = await aiService.getAIConfig();
    const ollamaBase = aiService.serverBaseUrl(config, 'ollama');
    const lmstudioBase = aiService.serverBaseUrl(config, 'lmstudio');

    const [ollamaOk, lmstudioOk] = await Promise.all([
        ping(`${ollamaBase}/api/tags`),
        ping(`${lmstudioBase}/v1/models`)
    ]);

    ollamaLamp.className = `lamp-indicator ${ollamaOk ? 'lamp-green' : 'lamp-red'}`;
    lmstudioLamp.className = `lamp-indicator ${lmstudioOk ? 'lamp-green' : 'lamp-red'}`;
}

async function fetchAvailableModels(config) {
    if (selectedServer === 'ollama') {
        return aiService.fetchOllamaModels(aiService.serverBaseUrl(config, 'ollama'));
    }
    return aiService.fetchLMStudioModels(aiService.serverBaseUrl(config, 'lmstudio'));
}

async function updateModelSelect(models, config) {
    if (!modelSelect) return;

    while (modelSelect.options.length > 1) {
        modelSelect.remove(1);
    }

    for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.dataset.server = selectedServer;
        option.textContent = model;
        modelSelect.appendChild(option);
    }

    const saved = config[selectedServer]?.model;
    if (saved && [...modelSelect.options].some(o => o.value === saved)) {
        modelSelect.value = saved;
    }
}

async function updateAvailableModelsDisplay() {
    const modelsDiv = document.getElementById('availableModels');
    if (!modelsDiv) return;

    try {
        const config = await aiService.getAIConfig();
        const [ollamaModels, lmstudioModels] = await Promise.all([
            aiService.fetchOllamaModels(aiService.serverBaseUrl(config, 'ollama')),
            aiService.fetchLMStudioModels(aiService.serverBaseUrl(config, 'lmstudio'))
        ]);

        let html = '';
        if (ollamaModels.length) {
            html += '<strong>Ollama:</strong><br>' + ollamaModels.map(m => `- ${escapeHtml(m)}`).join('<br>') + '<br>';
        }
        if (lmstudioModels.length) {
            html += '<strong>LM Studio:</strong><br>' + lmstudioModels.map(m => `- ${escapeHtml(m)}`).join('<br>');
        }

        modelsDiv.innerHTML = html || '<em>No AI servers detected on the configured ports.</em>';
    } catch (error) {
        console.warn('Model display error:', error.message);
        modelsDiv.innerHTML = '<em>Unable to list models.</em>';
    }
}

async function refreshModelSelectForServer() {
    const config = await aiService.getAIConfig();
    const models = await fetchAvailableModels(config);
    await updateModelSelect(models, config);
}

async function initPopup() {
    try {
        await initConfig();
        await checkConnectionStatus();
        await refreshModelSelectForServer();
        await updateAvailableModelsDisplay();
    } catch (e) {
        console.error("Popup init error:", e);
    }
}

initPopup();

if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
        const ollamaLamp = document.getElementById('ollamaLamp');
        const lmstudioLamp = document.getElementById('lmstudioLamp');
        if (ollamaLamp) ollamaLamp.className = 'lamp-indicator lamp-yellow';
        if (lmstudioLamp) lmstudioLamp.className = 'lamp-indicator lamp-yellow';

        await checkConnectionStatus();
        await refreshModelSelectForServer();
        await updateAvailableModelsDisplay();
    });
}
