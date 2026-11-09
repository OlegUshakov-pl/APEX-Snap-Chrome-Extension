// options.js - ApexShot settings page: BASE_URL, TOP_K, connection test.

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_TOP_K = 10;

const baseUrlInput = document.getElementById('baseUrl');
const topKInput = document.getElementById('topK');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const saveStatus = document.getElementById('saveStatus');
const testStatus = document.getElementById('testStatus');

// ---- Helpers --------------------------------------------------------------

// "localhost:8000/x" -> "http://localhost:8000": scheme + origin only
function normalizeBaseUrl(value) {
    let url = String(value || '').trim();
    if (!url) return DEFAULT_BASE_URL;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    try {
        return new URL(url).origin;
    } catch (e) {
        return DEFAULT_BASE_URL;
    }
}

function clampTopK(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TOP_K;
    return Math.min(50, Math.max(1, Math.floor(n)));
}

// GET {BASE_URL}/api/health, returns parsed JSON or null when unavailable.
// 8 s instead of a tight 3 s: Chrome adds a few seconds to the first request
// in some environments; a dead port still fails in milliseconds.
async function checkHealth(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn('ApexShot: connection test failed', e);
        return null;
    }
}

// Health payload is backend-defined; read snapshot count / ollama status
// defensively across common field names.
function describeHealth(health) {
    if (!health) return null;
    const count = Number(
        health.snapshot_count ?? health.snap_count ?? health.snapshots ??
        health.count ?? health.total ?? health.docs ?? health.documents ?? 0
    );
    // ollama может быть объектом {available, model} или булевой
    const rawOllama = health.ollama;
    const ollama = Boolean(
        (rawOllama && typeof rawOllama === 'object')
            ? rawOllama.available ?? rawOllama.ok
            : rawOllama ?? health.ollama_ok ?? health.ollama_up ?? health.ollama_available
    );
    return { count, ollama };
}

// ---- Save -----------------------------------------------------------------

saveBtn.addEventListener('click', async () => {
    try {
        const baseUrl = normalizeBaseUrl(baseUrlInput.value);
        const topK = clampTopK(topKInput.value);
        await chrome.storage.local.set({ base_url: baseUrl, top_k: topK });
        baseUrlInput.value = baseUrl;
        topKInput.value = topK;
        saveStatus.className = 'status';
        saveStatus.textContent = 'Настройки сохранены.';
    } catch (e) {
        console.error('ApexShot: failed to save settings', e);
        saveStatus.className = 'status fail';
        saveStatus.textContent = 'Ошибка при сохранении настроек.';
    }
});

// ---- Connection test ------------------------------------------------------

testBtn.addEventListener('click', async () => {
    const baseUrl = normalizeBaseUrl(baseUrlInput.value);
    testBtn.disabled = true;
    testStatus.className = 'status';
    testStatus.textContent = 'Проверка соединения…';

    const health = await checkHealth(baseUrl);
    const info = describeHealth(health);

    if (info) {
        testStatus.className = 'status ok';
        testStatus.textContent =
            `✓ Подключено (${info.count} слепков, Ollama: ${info.ollama ? 'да' : 'нет'})`;
    } else {
        testStatus.className = 'status fail';
        testStatus.textContent = `✗ Не подключено (${baseUrl} недоступен).`;
    }

    testBtn.disabled = false;
});

// Editing values marks the test result as stale
for (const input of [baseUrlInput, topKInput]) {
    input.addEventListener('input', () => {
        testStatus.className = 'status';
        testStatus.textContent = '';
    });
}

// ---- Init -----------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await chrome.storage.local.get(['base_url', 'top_k']);
        baseUrlInput.value = normalizeBaseUrl(data.base_url);
        topKInput.value = data.top_k == null ? DEFAULT_TOP_K : clampTopK(data.top_k);
    } catch (e) {
        console.error('ApexShot: failed to load settings', e);
        baseUrlInput.value = DEFAULT_BASE_URL;
        topKInput.value = DEFAULT_TOP_K;
    }
    baseUrlInput.focus();
});
