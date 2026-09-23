// background.js - service worker for ApexScan
// Clicking the extension icon opens the search page in a new tab.
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
});
