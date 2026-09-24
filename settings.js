// settings.js - settings page logic

// Elements
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');
const ollamaPortInput = document.getElementById('ollamaPort');
const lmstudioPortInput = document.getElementById('lmstudioPort');
const modelNameSelect = document.getElementById('modelSelect');
const fastapiUrlInput = document.getElementById('serverUrl');
const storagePathInput = document.getElementById('storagePathInput');
const browseBtn = document.getElementById('browseBtn'); 
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const refreshBtn = document.getElementById('refreshBtn');
const ollamaLamp = document.getElementById('ollamaLamp');
const lmstudioLamp = document.getElementById('lmstudioLamp');
const ollamaStatus = document.getElementById('ollamaStatus');
const lmstudioStatus = document.getElementById('lmstudioStatus');

const backBtn = document.getElementById('backBtn');

// Storage path display element
const storagePathLabel = document.createElement('div');
storagePathLabel.style.cssText = 'margin-top: 8px; font-size: 12px; color: #444; min-height: 18px;';
storagePathLabel.textContent = 'Path: Not selected';
storagePathInput.parentNode.insertBefore(storagePathLabel, browseBtn);

// Get port from button data attribute
function getSelectedPort(server) {
    return server === 'ollama' 
        ? ollamaBtn.getAttribute('data-port') || '11434' 
        : lmstudioBtn.getAttribute('data-port') || '1234';
}

/**
 * Updates the UI based on which AI server is selected.
 */
function updateUIForServer(server) {
    if (server === 'ollama') {
        ollamaBtn.classList.add('active');
        lmstudioBtn.classList.remove('active');
        // Show Ollama-related inputs, hide LM Studio ones if applicable
        const portLabel = document.getElementById('portLabel');
        if (portLabel) portLabel.style.display = 'block';
    } else {
        lmstudioBtn.classList.add('active');
        ollamaBtn.classList.remove('active');
        // Show LM Studio-related inputs, hide Ollama ones if applicable
        const lmLabel = document.getElementById('lmstudioPortLabel');
        if (lmLabel) lmLabel.style.display = 'block';
    }
}

/**
 * Fetches models for the selected server and updates the dropdown.
 */
async function refreshModels() {
    const isOllama = ollamaBtn.classList.contains('active');
    const port = getSelectedPort(isOllama ? 'ollama' : 'lmstudio');
    const url = `http://127.0.0.1:${port}`;

    try {
        let models = [];
        if (isOllama) {
            models = await window.aiService.fetchOllamaModels(url);
        } else {
            models = await window.aiService.fetchLMStudioModels(url);
        }

        // Update lamp indicator - green if connection works
        ollamaLamp.className = 'lamp-indicator ' + (isOllama ? 'lamp-green' : 'lamp-red');
        lmstudioLamp.className = 'lamp-indicator ' + (!isOllama ? 'lamp-green' : 'lamp-red');
        ollamaStatus.textContent = isOllama ? (models.length > 0 ? 'Connected' : 'Not connected') : 'Not active';
        lmstudioStatus.textContent = !isOllama ? (models.length > 0 ? 'Connected' : 'Not connected') : 'Not active';

        // Update Select element
        modelNameSelect.innerHTML = '<option value="">Select a model...</option>';
        if (models.length === 0) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.text = models.length === 1 ? "No models found" : "No models found";
            modelNameSelect.appendChild(opt);
        } else {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.text = m;
                modelNameSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Failed to refresh models:", e);
    }
}

/**
 * Checks if the selected server is installed
 */
async function checkServerInstallation(server) {
    if (server === 'ollama') {
        try {
            const res = await fetch('http://127.0.0.1:11434/api/version', { method: 'HEAD' });
            ollamaStatus.textContent = res.ok ? 'Installed' : 'isn\'t installed';
            ollamaStatus.style.color = res.ok ? '#28a745' : '#dc3545';
        } catch (e) {
            ollamaStatus.textContent = 'isn\'t installed';
            ollamaStatus.style.color = '#dc3545';
        }
    } else {
        try {
            const res = await fetch('http://127.0.0.1:1234/v1/models', { method: 'HEAD' });
            lmstudioStatus.textContent = res.ok ? 'Installed' : 'isn\'t installed';
            lmstudioStatus.style.color = res.ok ? '#28a745' : '#dc3545';
        } catch (e) {
            lmstudioStatus.textContent = 'isn\'t installed';
            lmstudioStatus.style.color = '#dc3545';
        }
    }
}

/**
 * Handles directory selection via File System Access API
 */
async function handleDirectorySelection() {
    try {
        const dirHandle = await window.showDirectoryPicker();
        storagePathInput.value = dirHandle.name;
    } catch (e) {
        console.warn("Directory picker cancelled or not supported", e);
        if (e.name !== 'AbortError') {
            saveStatus.textContent = "Please select a folder";
            saveStatus.style.color = "#ffc107";
        }
    }
}
async function checkServerInstallation(server) {
    if (server === 'ollama') {
        try {
            const res = await fetch('http://127.0.0.1:11434/api/version', { method: 'HEAD' });
            ollamaStatus.textContent = res.ok ? 'Installed' : 'isn\'t installed';
            ollamaStatus.style.color = res.ok ? '#28a745' : '#dc3545';
        } catch (e) {
            ollamaStatus.textContent = 'isn\'t installed';
            ollamaStatus.style.color = '#dc3545';
        }
    } else {
        try {
            const res = await fetch('http://127.0.0.1:1234/v1/models', { method: 'HEAD' });
            lmstudioStatus.textContent = res.ok ? 'Installed' : 'isn\'t installed';
            lmstudioStatus.style.color = res.ok ? '#28a745' : '#dc3545';
        } catch (e) {
            lmstudioStatus.textContent = 'isn\'t installed';
            lmstudioStatus.style.color = '#dc3545';
        }
    }
}

// Event Listeners

// Event Listeners

ollamaBtn.addEventListener('click', () => {
    updateUIForServer('ollama');
    ollamaPortInput.value = '11434';
    lmstudioPortInput.value = '1234';
});

lmstudioBtn.addEventListener('click', () => {
    updateUIForServer('lmstudio');
    ollamaPortInput.value = '11434';
    lmstudioPortInput.value = '1234';
});

refreshBtn.addEventListener('click', async () => {
    refreshStatus("Checking connection...");
    // Check if server is installed
    await checkServerInstallation(ollamaBtn.classList.contains('active') ? 'ollama' : 'lmstudio');
    // Refresh models to get connection status
    await refreshModels();
    refreshStatus(models.length > 0 ? "Connected" : "Check installation or connection");
});

browseBtn.addEventListener('click', handleDirectorySelection);

saveBtn.addEventListener('click', async () => {
    try {
        const config = {
            server_url: fastapiUrlInput.value,
            ai_config: {
                server: ollamaBtn.classList.contains('active') ? 'ollama' : 'lmstudio',
                port: getSelectedPort(ollamaBtn.classList.contains('active') ? 'ollama' : 'lmstudio'),
                ollama: {
                    model: modelNameSelect.value || "llama3"
                },
                lmstudio: {
                    model: modelNameSelect.value || ""
                }
            },
            storage_path: storagePathInput.value
        };

        await chrome.storage.sync.set(config);
        
        // Update the path display
        if (config.storage_path) {
            storagePathLabel.textContent = 'Path: ' + config.storage_path;
        }
        
        saveStatus.textContent = "Settings saved successfully!";
        saveStatus.style.color = "#28a745";
    } catch (e) {
        console.error("Failed to save settings:", e);
        saveStatus.textContent = "Error saving settings.";
        saveStatus.style.color = "#dc3545";
    }
});

function refreshStatus(msg) {
    saveStatus.textContent = msg;
    saveStatus.style.color = "#444";
}

// Initialization on load
window.addEventListener('load', async () => {
    // Check installations first
    ollamaStatus.textContent = 'Checking...';
    lmstudioStatus.textContent = 'Checking...';
    
    try {
        await Promise.all([
            checkServerInstallation('ollama'),
            checkServerInstallation('lmstudio')
        ]);
    } catch (e) {
        console.error('Check installation error:', e);
    }
    
    // Load initial configuration from storage
    const result = await chrome.storage.sync.get(['server_url', 'ai_config', 'storage_path']);
    
    if (result.server_url) {
        fastapiUrlInput.value = result.server_url;
    }
    
    if (result.storage_path) {
        storagePathInput.value = result.storage_path;
        storagePathLabel.textContent = 'Path: ' + result.storage_path;
        saveStatus.textContent = "Settings loaded";
        saveStatus.style.color = "#28a745";
    }
    
    if (result.ai_config) {
        const config = result.ai_config;
        // Set server type
        if (config.server === 'ollama') {
            ollamaBtn.classList.add('active');
            lmstudioBtn.classList.remove('active');
            document.getElementById('portLabel').style.display = 'block';
            document.getElementById('lmstudioPortLabel').style.display = 'none';
        } else {
            lmstudioBtn.classList.add('active');
            ollamaBtn.classList.remove('active');
            document.getElementById('portLabel').style.display = 'none';
            document.getElementById('lmstudioPortLabel').style.display = 'block';
        }

        // Set default ports
        ollamaPortInput.value = '11434';
        lmstudioPortInput.value = '1234';

        if (config.ollama) {
            ollamaPortInput.value = config.ollama.port || '11434';
        }

        if (config.lmstudio) {
             lmstudioPortInput.value = config.lmstudio.port || '1234';
        }

        if (config.ollama?.model) modelNameSelect.value = config.ollama.model;
        else if (config.lmstudio?.model) modelNameSelect.value = config.lmstudio.model;
    }
});
