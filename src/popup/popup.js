// popup.js - ApexShot thin-client search logic.
// All search math (embeddings, ChromaDB, BM25, RRF) lives in the local FastAPI
// app; the extension only sends POST /api/search and renders the response.

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_TOP_K = 10;
const HEALTH_TIMEOUT_MS = 8000; // allowance for Chrome's cold network start (~2-4 s on the first fetch)
const SEARCH_TIMEOUT_MS = 30000;
const SNIPPET_LENGTH = 200;

let currentQuery = '';
let currentOffset = 0;
let currentTotal = 0;

const queryInput = document.getElementById('queryInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const messageDiv = document.getElementById('message');
const statusBanner = document.getElementById('statusBanner');
const degradedBanner = document.getElementById('degradedBanner');
const optionsBtn = document.getElementById('optionsBtn');
const paginationDiv = document.getElementById('pagination');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');

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

// POST {BASE_URL}/api/search {"query", "top_k", "offset"}
async function runSearchRequest(baseUrl, topK, query, offset) {
    const response = await fetchWithTimeout(`${baseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: topK, offset: offset || 0 })
    }, SEARCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

// ---- Rendering ------------------------------------------------------------

const OFFLINE_MESSAGE = 'The local app is not running. Start it (uvicorn main:app --port 8080) and try again.';

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

    const conf = (item && item.confidence);
    const confidence = (typeof conf === 'number' && Number.isFinite(conf)) ? conf : null;
    return {
        title: String((item && (item.title || item.name)) || meta.title || 'Snapshot'),
        score: Number(item && item.score) || 0,
        confidence: confidence,
        matchedFields: (Array.isArray(matched) ? matched : [matched]).filter(v => v).join(', '),
        snippet: truncate((item && (item.snippet || item.text || item.summary)) || '', SNIPPET_LENGTH),
        sourceUrl: String(sourceUrl)
    };
}

function renderResults(items, degraded) {
    showBanner(degradedBanner, !!degraded);

    if (!items.length) {
        resultsDiv.innerHTML = '';
        showMessage('Nothing found', false);
        return;
    }

    hideMessage();
    const template = document.getElementById('resultTemplate');

    resultsDiv.innerHTML = '';
    for (const raw of items) {
        const hit = normalizeHit(raw);
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.id = raw.id || '';

        card.querySelector('.result-title').textContent = hit.title;
        const scoreEl = card.querySelector('.result-score');
        if (hit.confidence !== null) {
            scoreEl.textContent = hit.confidence.toFixed(2);
            scoreEl.style.display = '';
        } else if (Number.isFinite(hit.score) && hit.score !== 0) {
            scoreEl.textContent = hit.score.toFixed(2);
            scoreEl.style.display = '';
        } else {
            scoreEl.textContent = '';
            scoreEl.style.display = 'none';
        }
        card.querySelector('.result-fields').textContent = hit.matchedFields;
        card.querySelector('.result-snippet').textContent = hit.snippet;

        const titleLink = card.querySelector('.result-title');
        const sourceBtn = card.querySelector('.open-source');

        if (hit.sourceUrl && isHttpsLikeUrl(hit.sourceUrl)) {
            titleLink.href = hit.sourceUrl;
            titleLink.target = '_blank';
            titleLink.rel = 'noopener';
            // "Open source" -> chrome.tabs.create({url: source_url})
            sourceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: hit.sourceUrl });
            });
        } else {
            titleLink.removeAttribute('href');
            sourceBtn.disabled = true;
            sourceBtn.title = 'Source unavailable';
        }

        // Open the viewer in a new tab when the card is clicked
        card.addEventListener('click', (e) => {
            if (e.target.closest('a, button')) return;
            const id = raw.id;
            if (!id) return;
            const url = chrome.runtime.getURL('src/viewer/viewer.html')
                + '?id=' + encodeURIComponent(id)
                + (currentQuery ? '&q=' + encodeURIComponent(currentQuery) : '');
            chrome.tabs.create({ url });
        });

        resultsDiv.appendChild(card);
    }
}

// ---- Search flow ----------------------------------------------------------

async function runSearch(query, offset = 0) {
    query = String(query || '').trim();
    if (!query) {
        currentQuery = '';
        currentOffset = 0;
        currentTotal = 0;
        hideMessage();
        resultsDiv.innerHTML = '';
        if (paginationDiv) paginationDiv.classList.add('hidden');
        return;
    }

    const { baseUrl, topK } = await getSettings();
    const pageOffset = Math.max(0, Number(offset) || 0);

    currentQuery = query;
    hideMessage();
    resultsDiv.innerHTML = '';
    showBanner(degradedBanner, false);
    showBanner(statusBanner, false);
    if (paginationDiv) paginationDiv.classList.add('hidden');
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';

    try {
        const data = await runSearchRequest(baseUrl, topK, query, pageOffset);
        const items = Array.isArray(data.items) ? data.items
            : (Array.isArray(data.results) ? data.results : []);
        currentOffset = pageOffset;
        currentTotal = Number(data.total) || items.length;

        // degraded may arrive on each item; handle the top-level variant too
        const degraded = !!(data && data.degraded)
            || items.some(item => item && (item.degraded || item.degraded_reason));
        renderResults(items, degraded);

        // Pagination
        if (paginationDiv && pageInfo && prevBtn && nextBtn) {
            const page = Math.floor(currentOffset / Math.max(1, topK)) + 1;
            const pages = Math.max(1, Math.ceil(currentTotal / Math.max(1, topK)));
            pageInfo.textContent = `Page ${page} of ${pages} · ${currentTotal} found`;
            prevBtn.disabled = currentOffset <= 0;
            nextBtn.disabled = currentOffset + topK >= currentTotal;
            paginationDiv.classList.remove('hidden');
            if (!items.length) paginationDiv.classList.add('hidden');
        }
    } catch (e) {
        console.error('ApexShot: search failed', e);
        resultsDiv.innerHTML = '';
        showBanner(degradedBanner, false);
        showMessage(OFFLINE_MESSAGE, true);
        if (paginationDiv) paginationDiv.classList.add('hidden');
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
    }
}

async function search() {
    const query = String(queryInput.value || '').trim();
    if (!query) return;
    await runSearch(query, 0);
}

// ---- Events / init --------------------------------------------------------

searchBtn.addEventListener('click', search);
queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        search();
    }
});

if (prevBtn) {
    prevBtn.addEventListener('click', () => {
        if (currentOffset > 0) {
            const topK = DEFAULT_TOP_K;
            getSettings().then(s => runSearch(currentQuery, Math.max(0, currentOffset - (s.topK || topK))));
        }
    });
}
if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        getSettings().then(s => {
            const topK = s.topK || DEFAULT_TOP_K;
            if (currentOffset + topK < currentTotal) {
                runSearch(currentQuery, currentOffset + topK);
            }
        });
    });
}

optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// On open: silent health check (3 s). If down, show a banner; the search input
// stays usable and a retry search shows the same offline message.
window.addEventListener('DOMContentLoaded', async () => {
    const { baseUrl } = await getSettings();
    const health = await checkHealth(baseUrl);
    if (!health) {
        showBanner(statusBanner, true);
        statusBanner.className = 'banner error';
        statusBanner.textContent = 'Start the local app, then retry the search.';
    }
    queryInput.focus();
});
