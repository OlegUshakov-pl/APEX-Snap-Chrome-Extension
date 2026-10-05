// content.js - runs inside web pages to collect page data for the popup

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAPTURE") {
        sendResponse(collectPageData());
    }
    return false;
});

function collectPageData() {
    const body = document.body;
    const textContent = body && body.innerText ? body.innerText : "";

    return {
        url: window.location.href,
        title: document.title,
        textSnippet: textContent.substring(0, 2000),
        timestamp: Date.now()
    };
}
