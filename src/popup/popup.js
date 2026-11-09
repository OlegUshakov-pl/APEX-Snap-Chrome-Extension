// popup.js - ApexShot thin-client search logic.
// All search math (embeddings, ChromaDB, BM25, RRF) lives in the local FastAPI
// app; the extension only sends POST /api/search and renders the response.

const DEFAULT_BASE_URL = 'http://localhost:8000';
const DEFAULT_TOP_K = 10;
const HEALTH_TIMEOUT_MS = 8000; // запас на холодный старт сети Chrome (~2-4 с на первый fetch)
const SEARCH_TIMEOUT_MS = 30000;
const SNIPPET_LENGTH = 200;

const queryInput = document.getElementById('queryInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const messageDiv = document.getElementById('message');
const statusBanner = document.getElementById('statusBanner');
const degradedBanner = document.getElementById('degradedBanner');
const optionsBtn = document.getElementById('optionsBtn');

// ---- Settings -------------------------------------------------------------

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

async function getSettings() {
    try {
        const data = await chrome.storage.local.get(['base_url', 'top_k']);
        return {
            baseUrl: normalizeBaseUrl(data.base_url),
            topK: clampTopK(data.top_k)
        };
    } catch (e) {
        console.warn('ApexShot: failed to read settings, using defaults', e);
        return { baseUrl: DEFAULT_BASE_URL, topK: DEFAULT_TOP_K };
    }
}

// ---- HTTP -----------------------------------------------------------------

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// GET {BASE_URL}/api/health, returns parsed JSON or null when unavailable
async function checkHealth(baseUrl) {
    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/health`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn('ApexShot: health check failed', e);
        return null;
    }
}

// POST {BASE_URL}/api/search {"query", "top_k"}
async function runSearchRequest(baseUrl, topK, query) {
    const response = await fetchWithTimeout(`${baseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: topK })
    }, SEARCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

// ---- Rendering ------------------------------------------------------------

const OFFLINE_MESSAGE = 'Локальное приложение не запущено. Откройте его (uvicorn main:app --port 8000) и повторите.';

function showMessage(text, isError) {
    messageDiv.textContent = text;
    messageDiv.className = isError ? 'message error' : 'message';
    messageDiv.classList.remove('hidden');
}

function hideMessage() {
    messageDiv.classList.add('hidden');
}

function showBanner(el, on) {
    el.classList.toggle('hidden', !on);
}

function isHttpsLikeUrl(value) {
    try {
        return /^https?:$/.test(new URL(value).protocol);
    } catch (e) {
        return false;
    }
}

function truncate(str, n) {
    str = String(str || '').replace(/\s+/g, ' ').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Normalizes one search hit into a fixed shape, tolerant to response variants
function normalizeHit(item) {
    const meta = (item && typeof item.metadata === 'object' && !Array.isArray(item.metadata)) ? item.metadata : {};
    const matched = (item && (item.matched_fields || item.matchedFields)) || meta.matched_fields || [];
    const sourceUrl = (item && (item.source_url || item.url)) || meta.source_url || '';

    return {
        title: String((item && (item.title || item.name)) || meta.title || 'Слепок'),
        score: Number(item && item.score) || 0,
        matchedFields: (Array.isArray(matched) ? matched : [matched]).filter(v => v).join(', '),
        snippet: truncate((item && (item.snippet || item.text || item.summary)) || '', SNIPPET_LENGTH),
        sourceUrl: String(sourceUrl)
    };
}

function renderResults(items, degraded) {
    showBanner(degradedBanner, !!degraded);

    if (!items.length) {
        resultsDiv.innerHTML = '';
        showMessage('Ничего не найдено', false);
        return;
    }

    hideMessage();
    const template = document.getElementById('resultTemplate');

    resultsDiv.innerHTML = '';
    for (const raw of items) {
        const hit = normalizeHit(raw);
        const card = template.content.firstElementChild.cloneNode(true);

        card.querySelector('.result-title').textContent = hit.title;
        card.querySelector('.result-score').textContent = hit.score.toFixed(2);
        card.querySelector('.result-fields').textContent = hit.matchedFields;
        card.querySelector('.result-snippet').textContent = hit.snippet;

        const titleLink = card.querySelector('.result-title');
        const sourceBtn = card.querySelector('.open-source');

        if (hit.sourceUrl && isHttpsLikeUrl(hit.sourceUrl)) {
            titleLink.href = hit.sourceUrl;
            titleLink.target = '_blank';
            titleLink.rel = 'noopener';
            // "Открыть источник" -> chrome.tabs.create({url: source_url})
            sourceBtn.addEventListener('click', () => {
                chrome.tabs.create({ url: hit.sourceUrl });
            });
        } else {
            titleLink.removeAttribute('href');
            sourceBtn.disabled = true;
            sourceBtn.title = 'Источник недоступен';
        }

        resultsDiv.appendChild(card);
    }
}

// ---- Search flow ----------------------------------------------------------

async function search() {
    const query = String(queryInput.value || '').trim();
    if (!query) return;

    const { baseUrl, topK } = await getSettings();

    hideMessage();
    resultsDiv.innerHTML = '';
    showBanner(degradedBanner, false);
    showBanner(statusBanner, false);
    searchBtn.disabled = true;
    searchBtn.textContent = 'Искать…';

    try {
        const data = await runSearchRequest(baseUrl, topK, query);
        const items = Array.isArray(data.items) ? data.items
            : (Array.isArray(data.results) ? data.results : []);
        // degraded приходит на каждом элементе; учтём и top-level вариант
        const degraded = !!(data && data.degraded)
            || items.some(item => item && (item.degraded || item.degraded_reason));
        renderResults(items, degraded);
    } catch (e) {
        console.error('ApexShot: search failed', e);
        resultsDiv.innerHTML = '';
        showBanner(degradedBanner, false);
        showMessage(OFFLINE_MESSAGE, true);
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Искать';
    }
}

// ---- Events / init --------------------------------------------------------

searchBtn.addEventListener('click', search);
queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        search();
    }
});

optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// On open: silent health check (3 s). If down, show a banner; the search input
// stays usable and a retry search shows the same offline message.
window.addEventListener('DOMContentLoaded', async () => {
    const { baseUrl } = await getSettings();
    const health = await checkHealth(baseUrl);
    if (!health) {
        showBanner(statusBanner, true);
        statusBanner.className = 'banner error';
        statusBanner.textContent = 'Запустите локальное приложение, затем повторите поиск.';
    }
    queryInput.focus();
});
