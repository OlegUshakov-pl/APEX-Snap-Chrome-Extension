// settings.js - settings page logic (was the old popup.js)

// Server selection buttons
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');

// Configuration inputs
const ollamaPortInput = document.getElementById('ollamaPort');
const lmstudioPortInput = document.getElementById('lmstudioPort');
const modelNameSelect = document.getElementById('modelSelect');
const fastapiUrlInput = document.getElementById('serverUrl');

// Save controls
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const backBtn = document.getElementById('backBtn');

let selectedServer = "ollama"; // ollama | lmstudio
let lmstudioSelectedModel = ""; // last loaded model in LM Studio (set from the model list)

// ---------- Initialization ----------

// Load saved config and populate the form
async function init() {
    // 1. FastAPI server URL (used by the search page)
    const saved = await chrome.storage.sync.get(['server_url']);
    if (saved.server_url) {
        fastapiUrlInput.value = saved.server_url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    // 2. AI config
    const config = await aiService.getAIConfig();
    if (config) {
        selectedServer = config.server || "ollama";
        ollamaPortInput.value = config.ollama?.url?.replace('http://localhost:', '') || '11434';
        lmstudioPortInput.value = config.lmstudio?.url?.replace('http://localhost:', '') || '1234';
        modelNameSelect.value = config.ollama?.model || 'llama3';
        updateServerButtons();
    }

    // 3. Connection status + model lists + model dropdown
    await checkConnectionStatus();
    await updateAvailableModelsDisplay();
    refreshModelSelect();

    // Back link returns to the search page
    backBtn.href = chrome.runtime.getURL('search.html');
}

// Updates server selection button styles
function updateServerButtons() {
    ollamaBtn.classList.toggle('active', selectedServer === "ollama");
    lmstudioBtn.classList.toggle('active', selectedServer === "lmstudio");

    // Update model label text dynamically
    const modelLabel = document.getElementById('modelLabel');
    if (modelLabel) {
        modelLabel.textContent = selectedServer === 'ollama'
            ? 'Model (for Ollama):'
            : 'Model (for LM Studio):';
    }

    // Refresh the model dropdown to show only installed models for the active server
    refreshModelSelect();
}

// Refills the model dropdown with only the installed models of the selected server
function refreshModelSelect() {
    const modelsDiv = document.getElementById('availableModels');
    if (!modelsDiv) return;

    const prevValue = modelNameSelect.value;

    // Keep only the options that belong to the currently selected server
    const options = Array.from(modelNameSelect.options);
    options.forEach(opt => {
        if (!opt.value) return; // keep the placeholder
        if (opt.dataset.server && opt.dataset.server !== selectedServer) {
            modelNameSelect.remove(modelNameSelect.options.indexOf(opt));
        }
    });

    // Ensure the previous selection is still valid for the new server
    const hasPrev = Array.from(modelNameSelect.options).some(o => o.value === prevValue);
    if (!hasPrev) {
        modelNameSelect.value = '';
    }

    if (modelNameSelect.value === '') {
        const first = Array.from(modelNameSelect.options).find(o => o.value);
        if (first) {
            modelNameSelect.value = first.value;
            if (selectedServer === 'lmstudio') lmstudioSelectedModel = first.value;
        }
    }
}

// ---------- Save ----------

// Persists all settings (AI config + FastAPI URL)
async function saveSettings() {
    try {
        const config = (await aiService.getAIConfig()) || {};
        if (!config.ollama) config.ollama = { url: '', model: '' };
        if (!config.lmstudio) config.lmstudio = { url: '' };

        config.server = selectedServer;
        config.ollama.url = `http://localhost:${ollamaPortInput.value || '11434'}`;
        config.ollama.model = modelNameSelect.value || "llama3";
        config.lmstudio.url = `http://localhost:${lmstudioPortInput.value || '1234'}`;
        // Save the model actually chosen for the active server
        config.lmstudio.model = (selectedServer === 'lmstudio' && modelNameSelect.value) || lmstudioSelectedModel || '';

        // Store the raw FastAPI URL (with http:// prefix) for the search page
        let fastapiUrl = fastapiUrlInput.value.trim();
        if (!/^https?:\/\//i.test(fastapiUrl)) {
            fastapiUrl = `http://${fastapiUrl}`;
        }
        fastapiUrl = fastapiUrl.replace(/\/+$/, '');

        await chrome.storage.sync.set({
            ai_config: config,
            server_url: fastapiUrl
        });

        saveStatus.textContent = 'Settings saved ✓';
        saveStatus.style.color = '#28a745';
        setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    } catch (error) {
        console.error("Save error:", error);
        saveStatus.textContent = 'Save failed';
        saveStatus.style.color = '#dc3545';
    }
}

saveBtn.addEventListener('click', saveSettings);

// ---------- Server switching ----------

ollamaBtn.addEventListener('click', () => {
    selectedServer = "ollama";
    updateServerButtons();
    checkConnectionStatus();
});

lmstudioBtn.addEventListener('click', () => {
    selectedServer = "lmstudio";
    updateServerButtons();
    checkConnectionStatus();
});

// ---------- Connection check (lamp indicators) ----------

async function checkConnectionStatus() {
    const ollamaLamp = document.getElementById('ollamaLamp');
    const lmstudioLamp = document.getElementById('lmstudioLamp');
    if (!ollamaLamp || !lmstudioLamp) return;

    const ollamaUrl = `http://localhost:${ollamaPortInput.value || '11434'}`;
    const lmstudioUrl = `http://localhost:${lmstudioPortInput.value || '1234'}`;

    // Try Ollama
    let ollamaOk = false;
    try {
        const response = await fetch(`${ollamaUrl}/api/models`);
        ollamaOk = response.ok;
    } catch (e) { /* Ollama not available */ }

    // Try LM Studio
    let lmstudioOk = false;
    try {
        const response = await fetch(`${lmstudioUrl}/v1/models`);
        lmstudioOk = response.ok;
    } catch (e) { /* LM Studio not available */ }

    ollamaLamp.className = `lamp-indicator ${ollamaOk ? 'lamp-green' : 'lamp-red'}`;
    lmstudioLamp.className = `lamp-indicator ${lmstudioOk ? 'lamp-green' : 'lamp-red'}`;
}

// Refresh button handler (set lamps to yellow while checking)
const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
        const ollamaLamp = document.getElementById('ollamaLamp');
        const lmstudioLamp = document.getElementById('lmstudioLamp');
        if (ollamaLamp) ollamaLamp.className = 'lamp-indicator lamp-yellow';
        if (lmstudioLamp) lmstudioLamp.className = 'lamp-indicator lamp-yellow';

        await checkConnectionStatus();
        await updateAvailableModelsDisplay();
        refreshModelSelect();
    });
}

// Port change re-checks connections and refreshes models
ollamaPortInput.addEventListener('change', () => {
    checkConnectionStatus();
    updateAvailableModelsDisplay().then(refreshModelSelect);
});

lmstudioPortInput.addEventListener('change', () => {
    checkConnectionStatus();
    updateAvailableModelsDisplay().then(refreshModelSelect);
});

// ---------- Available models display ----------

// Updates the "available models" section for both servers
async function updateAvailableModelsDisplay() {
    const modelsDiv = document.getElementById('availableModels');
    if (!modelsDiv) return;

    const ollamaUrl = `http://localhost:${ollamaPortInput.value || '11434'}`;
    const lmstudioUrl = `http://localhost:${lmstudioPortInput.value || '1234'}`;

    try {
        const ollamaModels = await aiService.fetchOllamaModels(ollamaUrl);
        const lmstudioModels = await aiService.fetchLMStudioModels(lmstudioUrl);

        let html = '';
        if (ollamaModels.length > 0) {
            html += '<strong>Ollama:</strong><br>';
            ollamaModels.forEach(m => { html += `- ${m}<br>`; });
            html += '<br>';
        }
        if (lmstudioModels.length > 0) {
            html += '<strong>LM Studio:</strong><br>';
            lmstudioModels.forEach(m => { html += `- ${m}<br>`; });
        }

        if (!html) {
            html = 'No models detected (ensure Ollama or LM Studio is running)';
        }
        modelsDiv.innerHTML = html;
    } catch (error) {
        console.error('Model display error:', error);
        modelsDiv.innerHTML = 'Error fetching models';
    }
}

// ---------- Start ----------
init();
