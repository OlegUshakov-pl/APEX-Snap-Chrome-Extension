// content.js - работает внутри веб-страницы для захвата данных

// Слушает команды от popup'а через chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAPTURE") {
        // 1. Получаем текст страницы
        const textContent = document.body.innerText;
        
        // 2. Берем фрагмент текста для AI анализа (первые 2000 символов)
        const textSnippet = textContent.substring(0, 2000);
        
        // 3. Собираем данные страницы
        const pageData = {
            url: window.location.href,
            title: document.title,
            textSnippet: textSnippet,
            timestamp: Date.now()
        };
        
        console.log("Данные страницы собраны:", pageData);
        
        // Отправляем ответ обратно в popup
        sendResponse(pageData);
    }
});

// Дополнительно: можно сделать скриншот если нужно (через HTML5 Canvas)
function captureScreenshot() {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Рендерим страницу на canvas
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Получаем все элементы страницы
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

window.aiService = window.aiService || {}; // для совместимости с ai-service.js