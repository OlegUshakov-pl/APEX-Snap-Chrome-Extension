// popup.js - logic for Binary Snap AI extension

const snapBtn = document.getElementById('snapBtn');
const folderBtn = document.getElementById('folderBtn');
const statusDiv = document.getElementById('status');
const aiResultDiv = document.getElementById('aiResult');

// Server selection buttons
const ollamaBtn = document.getElementById('ollamaBtn');
const lmstudioBtn = document.getElementById('lmstudioBtn');

// Configuration inputs
const serverUrlInput = document.getElementById('serverUrl');
const modelNameInput = document.getElementById('modelName');

let currentSnapData = null;
let selectedServer = "ollama"; // default: ollama or lmstudio

// Get current AI configuration on startup
async function initConfig() {
    const config = await aiService.getAIConfig();
    
    if (config) {
        // Populate fields from storage
        serverUrlInput.value = config.ollama?.url?.replace('http://localhost:', '') || '11161';
        modelNameInput.value = config.ollama?.model || 'llama3';
        
        selectedServer = config.server || "ollama";
        updateServerButtons();
    }
}

// Updates server selection buttons
function updateServerButtons() {
    ollamaBtn.classList.toggle('active', selectedServer === "ollama");
    lmstudioBtn.classList.toggle('active', selectedServer === "lmstudio");
    
    // Update label text dynamically
    const modelLabel = document.getElementById('modelLabel');
    if (modelLabel) {
        modelLabel.textContent = selectedServer === 'ollama' ? 'Model (for Ollama):' : 'Model (for LM Studio):';
    }
}

// Server switcher
ollamaBtn.addEventListener('click', () => {
    selectedServer = "ollama";
    updateServerButtons();
    saveCurrentConfig();
    // Refresh model display on server switch
    updateAvailableModelsDisplay();
    checkConnectionStatus();
});

lmstudioBtn.addEventListener('click', () => {
    selectedServer = "lmstudio";
    updateServerButtons();
    saveCurrentConfig();
    // Refresh model display on server switch
    updateAvailableModelsDisplay();
    checkConnectionStatus();
});

// Refresh models when server URL changes
serverUrlInput.addEventListener('change', () => {
    updateAvailableModelsDisplay();
    checkConnectionStatus();
});

// Saves current configuration
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

// Handler for "Generate Snapshot" button
snapBtn.addEventListener('click', async () => {
    statusDiv.textContent = "Generating snapshot...";
    aiResultDiv.textContent = "";
    
    // 1. Get active tab data
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url) {
        statusDiv.textContent = "No active page found.";
        return;
    }
    
    // 2. Send command to content script to capture data
    const pageData = await sendMessageToContent("CAPTURE");
    
    if (pageData) {
        // 3. Analyze text via AI service
        statusDiv.textContent = "Analyzing via AI...";
        
        try {
            const aiMetadata = await window.aiService.analyzePageText(
                pageData.textSnippet, 
                selectedServer
            );
            
            // 4. Build snapshot with real data
            currentSnapData = {
                source_url: tab.url,
                thumbnail_base64: pageData.thumbnail || "",
                binary_data: generateBinaryHash(tab.url + Date.now()),
                metadata_ai: aiMetadata
            };
            
            // Display AI analysis result
            aiResultDiv.innerHTML = formatAIResult(aiMetadata);
            
            statusDiv.textContent = "Sending to server...";
            
            // 5. Send data to FastAPI server
            const result = await sendSnapToServer(currentSnapData);
            
            if (result?.status === "success") {
                statusDiv.innerHTML = `Snapshot saved!<br>ID: ${result.snap_id}`;
            } else {
                // Even if server is unavailable, show AI result
                statusDiv.textContent = "Snapshot generated locally.";
            }
            
        } catch (error) {
            console.error("AI error:", error);
            statusDiv.textContent = "AI analysis failed. Using fallback...";
            
            // Fallback: use basic metadata without AI
            currentSnapData = {
                source_url: tab.url,
                thumbnail_base64: "",
                binary_data: generateBinaryHash(tab.url + Date.now()),
                metadata_ai: { tags: [], sentiment: 0, summary: "AI unavailable", category: "other" }
            };
        }
    } else {
        statusDiv.textContent = "Failed to capture page.";
    }
});

// Handler for folder analysis button
folderBtn.addEventListener('click', async () => {
    try {
        // Check File System Access API support
        if ('showDirectoryPicker' in window) {
            const handle = await window.showDirectoryPicker();
            statusDiv.textContent = `Selected folder: ${handle.name}`;
            
            // Get list of files in folder
            const files = [];
            for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                    files.push(entry);
                }
            }
            
            statusDiv.textContent = `Found ${files.length} files for analysis...`;
            aiResultDiv.innerHTML = `<strong>Files:</strong><br>${files.map(f => `- ${f.name}`).join('<br>')}`;
            
            // Create folder snapshot
            currentSnapData = {
                source_url: `file://${handle.root.path}`,
                thumbnail_base64: "",
                binary_data: generateBinaryHash(handle.root.path + Date.now()),
                metadata_ai: await aiService.analyzePageText(files.map(f => f.name).join('\n'), 'ollama')
            };
            
            statusDiv.textContent = `Folder snapshot generated! ID: ${generateSnapId()}`;
        } else {
            statusDiv.textContent = "Your browser doesn't support folder selection. Use Chrome/Edge.";
        }
    } catch (error) {
        console.error("Folder error:", error);
        statusDiv.textContent = "Error selecting folder";
    }
});

// Generates snapshot ID
function generateSnapId() {
    return 'snap_' + Date.now().toString(36).toUpperCase();
}

// Sends message to content script and returns response
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

// Sends snapshot to FastAPI server
async function sendSnapToServer(data) {
    try {
        // Determine endpoint based on source type
        const endpoint = data.source_url.startsWith('file://') 
            ? '/api/add-folder-snap'  // Local folder
            : '/api/add-snap';         // Web page
        
        console.log(`Sending to ${endpoint}...`);
        
        const response = await fetch(serverUrlInput.value + endpoint, {
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

// Generates binary hash from string
function generateBinaryHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash.toString(2);
}

// Formats AI result for display
function formatAIResult(metadata) {
    if (!metadata) return "";
    
    let html = `<strong>Tags:</strong> ${metadata.tags?.join(', ') || 'none'}<br>`;
    html += `<strong>Sentiment:</strong> ${metadata.sentiment}<br>`;
    html += `<strong>Category:</strong> ${metadata.category}<br>`;
    html += `<em>${metadata.summary}</em>`;
    
    return html;
}

// Checks connection status and updates the lamp indicator
async function checkConnectionStatus() {
    const connLamp = document.getElementById('connLamp');
    const connLabel = document.getElementById('connLabel');
    const connText = document.getElementById('connText');
    
    if (!connLamp || !connLabel || !connText) return;
    
    const ollamaUrl = `http://localhost:${serverUrlInput.value || '11161'}`;
    const lmstudioUrl = `http://localhost:${serverUrlInput.value || '8080'}`;
    
    // Try Ollama first
    let ollamaOk = false;
    try {
        const response = await fetch(`${ollamaUrl}/api/models`);
        ollamaOk = response.ok;
    } catch (e) {
        /* Ollama not available */
    }
    
    // Try LM Studio
    let lmstudioOk = false;
    try {
        const response = await fetch(`${lmstudioUrl}/v1/models`);
        lmstudioOk = response.ok;
    } catch (e) {
        /* LM Studio not available */
    }
    
    // Update lamp color based on connection
    if (ollamaOk && lmstudioOk) {
        connLamp.className = 'lamp-indicator lamp-yellow';
        connLabel.textContent = 'Both:';
        connText.textContent = 'Ollama + LM Studio connected';
    } else if (ollamaOk) {
        connLamp.className = 'lamp-indicator lamp-green';
        connLabel.textContent = 'Ollama:';
        connText.textContent = 'Connected ✓';
    } else if (lmstudioOk) {
        connLamp.className = 'lamp-indicator lamp-green';
        connLabel.textContent = 'LM Studio:';
        connText.textContent = 'Connected ✓';
    } else {
        connLamp.className = 'lamp-indicator lamp-red';
        connLabel.textContent = 'Status:';
        connText.textContent = 'No connection';
    }
}

// Fetches available models from the selected server
async function fetchAvailableModels(config) {
    try {
        if (selectedServer === "ollama") {
            const url = `http://localhost:${serverUrlInput.value || '11161'}/api/models`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch Ollama models");
            const data = await response.json();
            // Handle both array and object formats
            const models = Array.isArray(data) ? data : (data?.models || []);
            return models.map(m => typeof m === 'string' ? m : (m?.id || '')).filter(Boolean);
        } else {
            // LM Studio: model list comes from /v1/models endpoint (OpenAI-compatible)
            const url = `${config?.lmstudio?.url || `http://localhost:${serverUrlInput.value || '8080'}`}/v1/models`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch LM Studio models");
            const data = await response.json();
            // Handle both array and object formats
            const models = Array.isArray(data) ? data : (data?.data || []);
            return models.map(m => typeof m === 'string' ? m : (m.id || '')).filter(Boolean);
        }
    } catch (error) {
        console.error("Model fetch error:", error);
        return [];
    }
}

// Updates the model select dropdown with fetched models
async function updateModelSelect(models) {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;
    
    // Clear existing options except the first default one
    while (modelSelect.options.length > 1) {
        modelSelect.remove(1);
    }
    
    // Add fetched models
    for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    }
}

// Updates the available models display section
async function updateAvailableModelsDisplay() {
    const modelsDiv = document.getElementById('availableModels');
    if (!modelsDiv) return;
    
    try {
        // Fetch models from both Ollama and LM Studio
        const ollamaUrl = `http://localhost:${serverUrlInput.value || '11161'}`;
        const lmstudioUrl = `http://localhost:${serverUrlInput.value || '8080'}`;
        
        // Try fetching from Ollama
        let ollamaModels = [];
        try {
            const response = await fetch(`${ollamaUrl}/api/models`);
            if (response.ok) {
                const data = await response.json();
                ollamaModels = Array.isArray(data) ? data : (data?.models || []);
            }
        } catch (e) { /* Ollama not available */ }
        
        // Try fetching from LM Studio
        let lmstudioModels = [];
        try {
            const response = await fetch(`${lmstudioUrl}/v1/models`);
            if (response.ok) {
                const data = await response.json();
                lmstudioModels = Array.isArray(data) ? data : (data?.data || []).map(m => m.id || '');
            }
        } catch (e) { /* LM Studio not available */ }
        
        // Display results
        let html = '';
        if (ollamaModels.length > 0) {
            html += '<strong>Ollama:</strong><br>';
            ollamaModels.forEach(m => {
                const modelName = typeof m === 'string' ? m : (m.id || '');
                if (modelName) html += `- ${modelName}<br>`;
            });
            html += '<br>';
        }
        
        if (lmstudioModels.length > 0) {
            html += '<strong>LM Studio:</strong><br>';
            lmstudioModels.forEach(m => {
                html += `- ${m}<br>`;
            });
        }
        
        if (!html) {
            html = 'No models detected (ensure Ollama or LM Studio is running)';
        }
        
        modelsDiv.innerHTML = html;
    } catch (error) {
        console.error('Model display error:', error);
        document.getElementById('availableModels').innerHTML = 'Error fetching models';
    }
}

// Initialize on popup load
async function initPopup() {
    await initConfig();
    
    // Check connection status and update lamp
    await checkConnectionStatus();
    
    // Fetch available models and update dropdown
    const config = await aiService.getAIConfig();
    const models = await fetchAvailableModels(config);
    await updateModelSelect(models);
    
    // Also update the available models display section
    await updateAvailableModelsDisplay();
}

initPopup();
