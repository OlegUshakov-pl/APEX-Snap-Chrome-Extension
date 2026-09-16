// popup.js - Обновленная версия с отправкой данных

const snapBtn = document.getElementById('snapBtn');
const payBtn = document.getElementById('payBtn'); // Кнопка оплаты пока остается
const statusDiv = document.getElementById('status');

let currentSnapData = null;

snapBtn.addEventListener('click', async () => {
    statusDiv.textContent = "Генерация слепка...";

    // 1. Получаем данные страницы (упрощенно для теста)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Симуляция данных от AI и скриншота
    const thumbnailBase64 = "data:image/png;base64,iVBORw0KG5..."; // Здесь будет реальное фото
    const binaryData = "010010110...";
    const metadataAI = { tags: ["news", "politics"], sentiment: 0.8 };

    currentSnapData = {
        source_url: tab.url,
        thumbnail_base64: thumbnailBase64,
        binary_data: binaryData,
        metadata_ai: metadataAI
    };

    statusDiv.textContent = "Отправка на сервер...";

    // 2. Отправляем данные на твой FastAPI сервер
    try {
        const response = await fetch('http://127.0.0.1:8000/api/add-snap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentSnapData)
        });

        const result = await response.json();

        if (result.status === "success") {
            statusDiv.innerHTML = `Слепок сохранен!<br>ID: ${result.snap_id}`;
            // Теперь можно показать кнопку оплаты или сразу открыть окно Blik
            payBtn.style.display = 'block';
        } else {
            statusDiv.textContent = "Ошибка при сохранении.";
        }

    } catch (error) {
        console.error(error);
        statusDiv.textContent = "Не удалось подключиться к серверу.";
    }
});

payBtn.addEventListener('click', () => {
    if (!currentSnapData) return;

    // Симуляция оплаты Blik
    statusDiv.innerHTML = "Открывается окно Blik...";

    setTimeout(() => {
        statusDiv.innerHTML = "Оплата прошла успешно!<br>Слепок активирован.";
    }, 2000);
});
