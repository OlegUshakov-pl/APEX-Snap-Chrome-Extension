// settings.js - settings page logic

const fastapiUrlInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');

// "127.0.0.1:8000" -> "http://127.0.0.1:8000"
function normalizeServerUrl(value) {
    let url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return 'http://127.0.0.1:8000';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url;
}

saveBtn.addEventListener('click', async () => {
    try {
        const url = normalizeServerUrl(fastapiUrlInput.value);
        await chrome.storage.sync.set({ server_url: url });
        fastapiUrlInput.value = url;
        saveStatus.textContent = "Settings saved successfully!";
        saveStatus.style.color = "#28a745";
    } catch (e) {
        console.error("Failed to save settings:", e);
        saveStatus.textContent = "Error saving settings.";
        saveStatus.style.color = "#dc3545";
    }
});

// Initialization on load
window.addEventListener('load', async () => {
    try {
        const result = await chrome.storage.sync.get(['server_url']);
        fastapiUrlInput.value = result.server_url || 'http://127.0.0.1:8000';
        saveStatus.textContent = 'Settings loaded';
    } catch (e) {
        console.error('Settings load error:', e);
        saveStatus.textContent = 'Failed to load settings';
    }
});
