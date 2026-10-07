// index.js - search page logic (JSON comes from the FastAPI server)

const DEFAULT_SERVER = "http://127.0.0.1:8000";
const PAGE_SIZE = 20;

const searchInput = document.getElementById('searchInput');
const searchBar = document.getElementById('searchBar');
const resultsDiv = document.getElementById('results');
const errorDiv = document.getElementById('searchError');
const settingsBtn = document.getElementById('settingsBtn');
const paginationDiv = document.getElementById('pagination');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');

let currentQuery = '';
let currentOffset = 0;
let currentTotal = 0;

// Reads the JSON server address saved on the settings page
async function getServerUrl() {
    try {
        const result = await chrome.storage.sync.get(['server_url']);
        const url = String(result.server_url || '').trim();
        if (url) {
            return (/^https?:\/\//i.test(url) ? url : `http://${url}`).replace(/\/+$/, '');
        }
    } catch (e) {
        console.warn("Failed to read server_url from storage, using default", e);
    }
    return DEFAULT_SERVER;
}

// Keeps the query in the URL so it survives navigation to the viewer page
function syncUrl() {
    try {
        const url = new URL(location.href);
        if (currentQuery) url.searchParams.set('q', currentQuery);
        else url.searchParams.delete('q');
        history.replaceState(null, '', url);
    } catch (e) {
        // ignore (e.g. file:// context)
    }
}

// Runs the search on the FastAPI server: GET /api/search?q=...
// Results are shown only for an actual query (the search page never lists everything).
async function runSearch(query, offset = 0) {
    query = String(query || '').trim();
    if (!query) {
        currentQuery = '';
        currentOffset = 0;
        currentTotal = 0;
        syncUrl();
        resultsDiv.style.display = 'none';
        paginationDiv.classList.remove('visible');
        errorDiv.style.display = 'none';
        return;
    }
    currentQuery = query;
    currentOffset = offset;
    syncUrl();

    const serverUrl = await getServerUrl();

    resultsDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    searchBar.classList.add('loading');

    try {
        const response = await fetch(
            `${serverUrl}/api/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`
        );

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        await renderResults(data, serverUrl);
    } catch (error) {
        console.error("Search error:", error);
        resultsDiv.style.display = 'none';
        paginationDiv.classList.remove('visible');
        errorDiv.textContent = `Search error: server ${serverUrl} is not available`;
        errorDiv.style.display = 'block';
    } finally {
        searchBar.classList.remove('loading');
    }
}

// Full snapshot row (title, summary, tags) for one search item.
// /api/search already returns metadata inline, so we only fetch when it is missing.
async function fetchSnap(serverUrl, id) {
    try {
        const response = await fetch(`${serverUrl}/api/snaps/${encodeURIComponent(id)}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Flattens any snapshot metadata shape into one object.
 * Server_Apex stores: {"apex": {...}} (/api/add-snapshot), {"metadata_ai": {...}}
 * (/api/add-snap), a flat object, or occasionally a JSON string.
 */
function normalizeSnap(row) {
    let meta = row && row.metadata;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch (e) { meta = null; }
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};

    let inner = meta;
    if (meta.apex && typeof meta.apex === 'object' && !Array.isArray(meta.apex)) {
        inner = meta.apex;
    } else if (meta.metadata_ai && typeof meta.metadata_ai === 'object' && !Array.isArray(meta.metadata_ai)) {
        inner = meta.metadata_ai;
    }

    return Object.assign({}, meta, inner);
}

// Renders search results from the server response
async function renderResults(data, serverUrl) {
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.results) ? data.results : []);
    currentTotal = Number(data.total) || items.length;

    if (!items.length) {
        resultsDiv.innerHTML = '<div class="result-empty">No results found</div>';
        resultsDiv.style.display = 'block';
        paginationDiv.classList.remove('visible');
        return;
    }

    // Reuse inline metadata from /api/search; fetch the full row only when absent
    const rows = await Promise.all(items.map(item =>
        item.metadata ? item : fetchSnap(serverUrl, item.id)
    ));

    resultsDiv.innerHTML = items.map((item, i) => renderCard(item, rows[i])).join('');
    resultsDiv.style.display = 'block';

    // Pagination controls
    const page = Math.floor(currentOffset / PAGE_SIZE) + 1;
    const pages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
    pageInfo.textContent = `Page ${page} of ${pages} · ${currentTotal} found`;
    prevBtn.disabled = currentOffset <= 0;
    nextBtn.disabled = currentOffset + PAGE_SIZE >= currentTotal;
    paginationDiv.classList.add('visible');

    // Click anywhere on a card opens the viewer (links keep their own behaviour)
    resultsDiv.querySelectorAll('.result-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            openSnap(card.dataset.id);
        });
    });
}

function openSnap(id) {
    const params = new URLSearchParams({ id });
    if (currentQuery) params.set('q', currentQuery);
    location.href = `viewer.html?${params.toString()}`;
}

function renderCard(item, row) {
    const data = normalizeSnap(row || item);

    const searchSnippet = String(item.snippet || (row && row.search_text) || '').replace(/\s+/g, ' ').trim();
    const rawTitle = data.title || data.summary || searchSnippet || item.url || 'Snapshot';
    const title = truncate(rawTitle, 140);

    let summary = data.summary || searchSnippet || '';
    if (summary === rawTitle) summary = '';

    const tags = asArray(data.tags).filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
    const confidence = typeof data.confidence === 'number' ? data.confidence : null;
    const href = safeUrl(item.url || data.source_url || '');
    const viewerHref = `viewer.html?id=${encodeURIComponent(item.id)}${currentQuery ? `&q=${encodeURIComponent(currentQuery)}` : ''}`;

    const parts = [];
    parts.push('<div class="result-card" data-id="' + escapeHtml(item.id) + '">');
    parts.push('<div class="result-head">');
    parts.push(`<a class="result-title" href="${escapeHtml(viewerHref)}">${escapeHtml(title)}</a>`);
    if (item.type) parts.push(`<span class="result-badge">${escapeHtml(item.type)}</span>`);
    parts.push('</div>');

    parts.push('<div class="result-meta">');
    if (href !== '#') {
        parts.push(`<a class="result-url" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(item.url || href)}</a>`);
    }
    if (item.created_at) parts.push(`<span class="result-date">${escapeHtml(item.created_at)}</span>`);
    parts.push('</div>');

    if (summary) parts.push(`<div class="result-snippet">${escapeHtml(truncate(summary, 320))}</div>`);

    if (tags.length || confidence !== null) {
        parts.push('<div class="result-footer">');
        if (tags.length) {
            parts.push('<div class="result-tags">');
            parts.push(tags.map(t => `<span class="result-tag">${escapeHtml(t)}</span>`).join(''));
            parts.push('</div>');
        }
        parts.push(confidenceHtml(confidence));
        parts.push('</div>');
    }

    parts.push('</div>');
    return parts.join('');
}

function confidenceHtml(value) {
    if (typeof value !== 'number' || isNaN(value)) return '';
    const clamped = Math.min(1, Math.max(0, value));
    const pct = Math.round(clamped * 100);
    const cls = pct >= 75 ? 'conf-high' : (pct >= 50 ? 'conf-mid' : 'conf-low');
    return `<div class="confidence" title="confidence">
        <div class="confidence-track"><div class="confidence-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="confidence-value">${value.toFixed(2)}</span>
    </div>`;
}

function truncate(str, n) {
    str = String(str || '').replace(/\s+/g, ' ').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// Only http(s) links are clickable
function safeUrl(value) {
    try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) ? url.href : '#';
    } catch (e) {
        return '#';
    }
}

// Escapes HTML to prevent markup injection from server data
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Enter key submits the search
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        runSearch(searchInput.value, 0);
    }
});

// Pagination
prevBtn.addEventListener('click', () => {
    if (currentOffset > 0) {
        runSearch(currentQuery, Math.max(0, currentOffset - PAGE_SIZE));
    }
});

nextBtn.addEventListener('click', () => {
    if (currentOffset + PAGE_SIZE < currentTotal) {
        runSearch(currentQuery, currentOffset + PAGE_SIZE);
    }
});

// Settings gear opens the settings page in a tab
if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
}

// Close button closes the search tab
const closeBtn = document.getElementById('closeBtn');
if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
        try {
            const tab = await chrome.tabs.getCurrent();
            if (tab && tab.id != null) {
                await chrome.tabs.remove(tab.id);
                return;
            }
        } catch (e) {
            console.warn("Failed to close tab:", e);
        }
        window.close();
    });
}

// Focus the search field on load; search runs only when returning from the viewer with ?q=
window.addEventListener('load', () => {
    const q = new URLSearchParams(location.search).get('q') || '';
    searchInput.value = q;
    searchInput.focus();
    if (q) runSearch(q, 0);
});
