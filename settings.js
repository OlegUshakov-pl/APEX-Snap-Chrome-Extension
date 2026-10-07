// settings.js - settings page logic

const fastapiUrlInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const testBtn = document.getElementById('testBtn');
const testStatus = document.getElementById('testStatus');

// "127.0.0.1:8000" -> "http://127.0.0.1:8000"
function normalizeServerUrl(value) {
    let url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return 'http://127.0.0.1:8000';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url;
}

function resetTestStatus() {
    testStatus.textContent = '';
    testStatus.className = 'test-status';
}

// Pings the JSON server and shows green (available) / red (unavailable)
testBtn.addEventListener('click', async () => {
    const url = normalizeServerUrl(fastapiUrlInput.value);
    testBtn.disabled = true;
    testStatus.className = 'test-status';
    testStatus.textContent = 'Checking…';
    testStatus.style.color = '#444';

    let httpCode = null;
    try {
        let res = await fetch(`${url}/api/status`, { method: 'GET' });
        if (!res.ok) res = await fetch(`${url}/`, { method: 'GET' });
        httpCode = res.status;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        testStatus.style.color = '';
        testStatus.className = 'test-status ok';
        testStatus.textContent = `✓ Server available (HTTP ${httpCode})`;
    } catch (e) {
        testStatus.style.color = '';
        testStatus.className = 'test-status fail';
        const detail = httpCode ? `HTTP ${httpCode}` : 'no response';
        testStatus.textContent = `✗ Server unavailable (${detail})`;
    } finally {
        testBtn.disabled = false;
    }
});

// Editing the URL invalidates the previous test result
fastapiUrlInput.addEventListener('input', resetTestStatus);

saveBtn.addEventListener('click', async () => {
    try {
        const url = normalizeServerUrl(fastapiUrlInput.value);
        await chrome.storage.sync.set({ server_url: url });
        fastapiUrlInput.value = url;
        saveStatus.textContent = "Settings saved successfully!";
        saveStatus.style.color = "#28a745";
        resetTestStatus();
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
