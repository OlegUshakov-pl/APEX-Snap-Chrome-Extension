// content.js - работает внутри веб-страницы

async function capturePage() {
    // 1. Получаем текст страницы
    const textContent = document.body.innerText;

    // 2. Делаем скриншот (используем API браузера для захвата)
    // В реальном приложении мы используем fetch к серверу для AI обработки

    // Пример: собираем данные
    const data = {
        url: window.location.href,
        title: document.title,
        textSnippet: textContent.substring(0, 500), // Берем кусок текста для анализа
        timestamp: Date.now()
    };

    console.log("Данные страницы собраны:", data);

    // Здесь мы передадим данные в popup или напрямую на сервер
    return data;
}

// Слушаем команду от popup'а
chrome.runtime.onMessage.addListener((message, sender, response) => {
    if (message.type === "CAPTURE") {
        capturePage().then(data => {
            // Отправляем данные обратно в popup или на сервер
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                // Для простоты в MVP мы просто вернем данные в popup через callback
            });

            // В реальном сценарии здесь будет fetch к твоему API
            console.log("Слепок готов для отправки");
        });
    }
});
