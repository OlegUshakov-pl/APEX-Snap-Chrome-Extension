// service_worker.js - minimal service worker for ApexShot.
// Seeds default settings on install; all search logic lives in the popup,
// which talks to the local FastAPI app directly.

const STORAGE_DEFAULTS = {
    base_url: 'http://localhost:8000',
    top_k: 10
};

// Set defaults on first install (existing user values are preserved)
chrome.runtime.onInstalled.addListener(async () => {
    try {
        const data = await chrome.storage.local.get(Object.keys(STORAGE_DEFAULTS));
        const toSet = {};
        for (const [key, value] of Object.entries(STORAGE_DEFAULTS)) {
            if (data[key] == null) toSet[key] = value;
        }
        if (Object.keys(toSet).length) {
            await chrome.storage.local.set(toSet);
        }
        console.info('ApexShot: defaults ensured', toSet);
    } catch (e) {
        console.warn('ApexShot: failed to seed defaults', e);
    }
});
