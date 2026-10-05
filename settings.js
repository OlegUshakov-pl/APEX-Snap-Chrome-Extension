// settings.js - settings page logic

const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');
const ollamaPortInput = document.getElementById('ollamaPort');
const lmstudioPortInput = document.getElementById('lmstudioPort');
const modelNameSelect = document.getElementById('modelSelect');
const fastapiUrlInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const refreshBtn = document.getElementById('refreshBtn');
const ollamaLamp = document.getElementById('ollamaLamp');
const lmstudioLamp = document.getElementById('lmstudioLamp');
const ollamaStatus = document.getElementById('ollamaStatus');
const lmstudioStatus = document.getElementById('lmstudioStatus');
const portLabel = document.getElementById('portLabel');
const lmstudioPortLabel = document.getElementById('lmstudioPortLabel');

function getSelectedServer() {
    return ollamaBtn.classList.contains('active') ? 'ollama' : 'lmstudio';
}

// Port taken from the visible input field (not from data-port attributes)
function getSelectedPort(server) {
    const input = server === 'ollama' ? ollamaPortInput : lmstudioPortInput;
    const fallback = server === 'ollama' ? '11434' : '1234';
    return String(input.value || '').trim() || fallback;
}

function portOr(value, server) {
    return String(value || '').trim() || (server === 'ollama' ? '11434' : '1234');
}

// "127.0.0.1:8000" -> "http://127.0.0.1:8000"
function normalizeServerUrl(value) {
    let url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return 'http://127.0.0.1:8000';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url;
}

/**
 * Updates the UI based on which AI server is selected.
 */
function updateUIForServer(server) {
    const isOllama = server === 'ollama';
    ollamaBtn.classList.toggle('active', isOllama);
    lmstudioBtn.classList.toggle('active', !isOllama);

    portLabel.style.display = isOllama ? 'block' : 'none';
    ollamaPortInput.style.display = isOllama ? 'block' : 'none';
    lmstudioPortLabel.style.display = isOllama ? 'none' : 'block';
    lmstudioPortInput.style.display = isOllama ? 'none' : 'block';
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * Pings both AI servers, updates lamps/statuses and fills the model dropdown.
 * Returns the model list of the selected server.
 */
async function refreshModels() {
    const selected = getSelectedServer();
    const ollamaUrl = `http://127.0.0.1:${portOr(ollamaPortInput.value, 'ollama')}`;
    const lmstudioUrl = `http://127.0.0.1:${portOr(lmstudioPortInput.value, 'lmstudio')}`;

    const [ollamaModels, lmstudioModels] = await Promise.all([
        window.aiService.fetchOllamaModels(ollamaUrl),
        window.aiService.fetchLMStudioModels(lmstudioUrl)
    ]);

    const ollamaOk = ollamaModels.length > 0;
    const lmstudioOk = lmstudioModels.length > 0;

    ollamaLamp.className = 'lamp-indicator ' + (ollamaOk ? 'lamp-green' : 'lamp-red');
    lmstudioLamp.className = 'lamp-indicator ' + (lmstudioOk ? 'lamp-green' : 'lamp-red');
    ollamaStatus.textContent = ollamaOk ? `Connected (${ollamaModels.length})` : "isn't installed";
    lmstudioStatus.textContent = lmstudioOk ? `Connected (${lmstudioModels.length})` : "isn't installed";

    const models = selected === 'ollama' ? ollamaModels : lmstudioModels;

    modelNameSelect.innerHTML = '<option value="">Select a model...</option>';
    if (models.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.text = "No models found";
        modelNameSelect.appendChild(opt);
    } else {
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.text = m;
            modelNameSelect.appendChild(opt);
        });
    }

    const modelsDiv = document.getElementById('availableModels');
    if (modelsDiv) {
        let html = '';
        if (ollamaModels.length) {
            html += '<strong>Ollama:</strong><br>' + ollamaModels.map(m => `- ${escapeHtml(m)}`).join('<br>') + '<br>';
        }
        if (lmstudioModels.length) {
            html += '<strong>LM Studio:</strong><br>' + lmstudioModels.map(m => `- ${escapeHtml(m)}`).join('<br>');
        }
        modelsDiv.innerHTML = html || '<em>No AI servers detected on the configured ports.</em>';
    }

    return models;
}

// Event listeners: server switch

ollamaBtn.addEventListener('click', () => updateUIForServer('ollama'));

lmstudioBtn.addEventListener('click', () => updateUIForServer('lmstudio'));

refreshBtn.addEventListener('click', async () => {
    refreshStatus("Checking connection...");
    const models = await refreshModels();
    refreshStatus(models.length > 0 ? "Connected" : "Check installation or connection");
});

modelNameSelect.addEventListener('change', () => {
    // Save the model for the currently selected server immediately
    saveSettings(false);
});

saveBtn.addEventListener('click', () => saveSettings(true));

async function saveSettings(showStatus) {
    try {
        const isOllama = getSelectedServer() === 'ollama';
        const prev = await window.aiService.getAIConfig();

        const ollamaPort = getSelectedPort('ollama');
        const lmstudioPort = getSelectedPort('lmstudio');

        const config = {
            server: isOllama ? 'ollama' : 'lmstudio',
            ollama: {
                port: ollamaPort,
                url: `http://127.0.0.1:${ollamaPort}`,
                model: isOllama
                    ? (modelNameSelect.value || prev.ollama.model || 'llama3')
                    : (prev.ollama.model || 'llama3')
            },
            lmstudio: {
                port: lmstudioPort,
                url: `http://127.0.0.1:${lmstudioPort}`,
                model: !isOllama
                    ? (modelNameSelect.value || prev.lmstudio.model || '')
                    : (prev.lmstudio.model || '')
            }
        };

        await chrome.storage.sync.set({
            server_url: normalizeServerUrl(fastapiUrlInput.value),
            ai_config: config
        });
        fastapiUrlInput.value = normalizeServerUrl(fastapiUrlInput.value);

        if (showStatus !== false) {
            saveStatus.textContent = "Settings saved successfully!";
            saveStatus.style.color = "#28a745";
        }
    } catch (e) {
        console.error("Failed to save settings:", e);
        saveStatus.textContent = "Error saving settings.";
        saveStatus.style.color = "#dc3545";
    }
}

function refreshStatus(msg) {
    saveStatus.textContent = msg;
    saveStatus.style.color = "#444";
}

// Initialization on load
window.addEventListener('load', async () => {
    refreshStatus('Checking connection...');

    try {
        const result = await chrome.storage.sync.get(['server_url']);
        fastapiUrlInput.value = result.server_url || 'http://127.0.0.1:8000';

        const config = await window.aiService.getAIConfig();
        updateUIForServer(config.server);
        ollamaPortInput.value = config.ollama.port;
        lmstudioPortInput.value = config.lmstudio.port;

        await refreshModels();

        const savedModel = config.server === 'ollama' ? config.ollama.model : config.lmstudio.model;
        if (savedModel && [...modelNameSelect.options].some(o => o.value === savedModel)) {
            modelNameSelect.value = savedModel;
        }

        refreshStatus('Settings loaded');
    } catch (e) {
        console.error('Settings load error:', e);
        refreshStatus('Failed to load settings');
    }
});
