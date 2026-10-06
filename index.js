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
async function runSearch(query, offset = 0) {
    query = String(query || '').trim();
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

// Full snapshot row (title, summary, tags) for one search item
async function fetchSnap(serverUrl, id) {
    try {
        const response = await fetch(`${serverUrl}/api/snaps/${encodeURIComponent(id)}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
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

    const snaps = await Promise.all(items.map(item => fetchSnap(serverUrl, item.id)));

    resultsDiv.innerHTML = items.map((item, i) => renderCard(item, snaps[i])).join('');
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

function renderCard(item, snap) {
    const meta = snap && snap.metadata && typeof snap.metadata === 'object' ? snap.metadata : {};
    const apex = meta.apex && typeof meta.apex === 'object' ? meta.apex : null;

    const rawTitle = (apex && apex.title) || meta.summary || item.snippet || item.url || 'Snapshot';
    const title = truncate(rawTitle, 140);
    let summary = (apex && apex.summary) || meta.summary || item.snippet || '';
    if (summary === rawTitle) summary = '';

    const tags = pickTags(apex, meta);
    const confidence = apex && typeof apex.confidence === 'number' ? apex.confidence : null;
    const href = safeUrl(item.url || (apex && apex.source_url) || '');
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

function pickTags(apex, meta) {
    let tags = apex && Array.isArray(apex.tags) ? apex.tags : (Array.isArray(meta.tags) ? meta.tags : []);
    return tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
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

// Focus the search field on load and show the list (recent snapshots for an empty query)
window.addEventListener('load', () => {
    const q = new URLSearchParams(location.search).get('q') || '';
    searchInput.value = q;
    searchInput.focus();
    runSearch(q, 0);
});
