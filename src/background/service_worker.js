// service_worker.js - minimal service worker for ApexShot.
// Seeds default settings on install; all search logic lives in the popup,
// which talks to the local FastAPI app directly.

const STORAGE_DEFAULTS = {
    base_url: 'http://localhost:8080',
    top_k: 10
};

// Migrate old defaults (port 8000) to 8080
const LEGACY_BASE_URLS = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);

// Set defaults on first install (existing user values are preserved)
chrome.runtime.onInstalled.addListener(async () => {
    try {
        const data = await chrome.storage.local.get(Object.keys(STORAGE_DEFAULTS));
        const toSet = {};
        for (const [key, value] of Object.entries(STORAGE_DEFAULTS)) {
            if (data[key] == null) toSet[key] = value;
        }
        // Migration: old port 8000 -> 8080
        if (data.base_url && LEGACY_BASE_URLS.has(String(data.base_url).trim())) {
            toSet.base_url = STORAGE_DEFAULTS.base_url;
        }
        if (Object.keys(toSet).length) {
            await chrome.storage.local.set(toSet);
        }
        console.info('ApexShot: defaults ensured', toSet);
    } catch (e) {
        console.warn('ApexShot: failed to seed defaults', e);
    }
});
