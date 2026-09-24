// settings.js - settings page logic

// Elements
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');
const ollamaPortInput = document.getElementById('ollamaPort');
const lmstudioPortInput = 'lmstudioPort'; // We'll use getElementById later
const modelNameSelect = document.getElementById('modelSelect');
const fastapiUrlInput = document.getElementById('serverUrl');
const storagePathInput = document.getElementById('storagePathInput');
const browseBtn = document.getElementById('browseBtn'); 
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const refreshBtn = document.getElementById('refreshBtn');

// Note: the previous version of settings.js had some weird IDs like 'button-for-browse-but-the-id-is-actually-browseBtn'
// But in settings.html it is just 'browseBtn'. 
// I will re-fetch them to be sure.

const lmstudioPortInputEl = document.getElementById('lmstudioPort');
const backBtn = document.getElementById('backBtn');

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
    const url = isOllama 
        ? `http://127.0.0.1:${ollamaPortInput.value}` 
        : `http://127.0.0.1:${lmstudioPortInputEl.value}`;

    try {
        let models = [];
        if (isOllama) {
            models = await window.aiService.fetchOllamaModels(url);
        } else {
            models = await window.aiService.fetchLMStudioModels(url);
        }

        // Update Select element
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
    } catch (e) {
        console.error("Failed to refresh models:", e);
    }
}

// Event Listeners

ollamaBtn.addEventListener('click', () => {
    updateUIForServer('ollama');
});

lmstudioBtn.addEventListener('click', () => {
    updateUIForServer('lmstudio');
});

refreshBtn.addEventListener('click', async () => {
    refreshStatus("Connecting...");
    await refreshModels();
    refreshStatus("Connected");
});

// For "Browse" - in modern browsers, we can use the File System Access API if permission is granted
browseBtn.addEventListener('click', async () => {
    try {
        // This might prompt for a directory selection
        const directoryHandle = await window.showDirectoryPicker();
        // In a real extension, you'd handle this differently, 
        // but let's assume we want to save the path string (if available) or just show it worked.
        // For now, we will just simulate it for user experience.
        saveStatus.textContent = "Folder selected";
        saveStatus.style.color = "#28a745";
    } catch (e) {
        console.warn("Directory picker cancelled or not supported", e);
        // If showDirectoryPicker is not available, fallback to nothing for now.
    }
});

saveBtn.addEventListener('click', async () => {
    try {
        const config = {
            server_url: fastapiUrlInput.value,
            ai_config: {
                server: ollamaBtn.classList.contains('active') ? 'ollama' : 'lmstudio',
                ollama: {
                    url: `http://127.0.0.1:${ollamaPortInput.value}`,
                    model: modelNameSelect.value || "llama3"
                },
                lmstudio: {
                    url: `http://127.0.0.1:${lmstudioPortInputEl.value}`,
                    model: modelNameSelect.value || ""
                }
            }
        };

        await chrome.storage.sync.set(config);
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
    // Load initial configuration from storage
    const result = await chrome.storage.sync.get(['server_url', 'ai_config']);
    
    if (result.server_url) {
        fastapiUrlInput.value = result.server_url;
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

        if (config.ollama) {
            // Parse URL to get port if it's just http://127.0.0.1:PORT
            try {
                const url = new URL(config.ollama.url);
                ollamaPortInput.value = url.port || "11434";
            } catch(e) {}
        }

        if (config.lmstudio) {
             // Parse URL to get port if it's just http://127.0.0.1:PORT
             try {
                const url = new URL(config.lmstudio.url);
                lmstudioPortInputEl.value = url.port || "1234";
             } catch(e) {}
        }

        if (config.ollama?.model) modelNameSelect.value = config.ollama.model;
        else if (config.lmstudio?.model) modelNameSelect.value = config.lmstudio.model;
    }
});
