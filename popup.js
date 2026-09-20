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
}

// Server switcher
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

// Initialize on popup load
initConfig();
