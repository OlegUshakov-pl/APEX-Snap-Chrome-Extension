// content.js - runs within web page to capture data

// Listens for commands from popup via chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAPTURE") {
        // 1. Get page text
        const textContent = document.body.innerText;
        
        // 2. Take text snippet for AI analysis (first 2000 characters)
        const textSnippet = textContent.substring(0, 2000);
        
        // 3. Collect page data
        const pageData = {
            url: window.location.href,
            title: document.title,
            textSnippet: textSnippet,
            timestamp: Date.now()
        };
        
        console.log("Page data collected:", pageData);
        
        // Send response back to popup
        sendResponse(pageData);
    }
});

// Additionally: can take screenshot if needed (via HTML5 Canvas)
function captureScreenshot() {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Render page on canvas
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Get all page elements
        document.querySelectorAll('*').forEach((el) => {
            if (el.children.length === 0 && el.innerText.trim()) {
                ctx.font = `${getComputedStyle(el).fontSize}`;
                ctx.fillStyle = getComputedStyle(el).color;
                ctx.fillText(el.innerText, el.offsetLeft, el.offsetTop);
            }
        });
        
        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    });
}

window.aiService = window.aiService || {}; // for compatibility with ai-service.js
