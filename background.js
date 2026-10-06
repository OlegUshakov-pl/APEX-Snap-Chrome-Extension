// background.js - service worker for ApexScan

// Seed the default JSON server address on first install
chrome.runtime.onInstalled.addListener(async () => {
    const data = await chrome.storage.sync.get(['server_url']);
    if (!data.server_url) {
        await chrome.storage.sync.set({ server_url: 'http://127.0.0.1:8000' });
    }
});

// Open the search page in a new tab on extension icon click
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
