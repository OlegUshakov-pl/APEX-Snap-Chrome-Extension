// index.js - search page logic (JSON comes from the FastAPI server)

const DEFAULT_SERVER = "http://127.0.0.1:8000";

const searchInput = document.getElementById('searchInput');
const searchBar = document.getElementById('searchBar');
const resultsDiv = document.getElementById('results');
const errorDiv = document.getElementById('searchError');
const settingsBtn = document.getElementById('settingsBtn');

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

// Runs the search on the FastAPI server: GET /api/search?q=...
async function runSearch(query) {
    query = query.trim();
    if (!query) return;

    const serverUrl = await getServerUrl();

    resultsDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    searchBar.classList.add('loading');

    try {
        const response = await fetch(`${serverUrl}/api/search?q=${encodeURIComponent(query)}`);

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        renderResults(data, serverUrl);
    } catch (error) {
        console.error("Search error:", error);
        resultsDiv.style.display = 'none';
        errorDiv.textContent = `Search error: server ${serverUrl} is not available`;
        errorDiv.style.display = 'block';
    } finally {
        searchBar.classList.remove('loading');
    }
}

// Renders search results from the server response
function renderResults(data, serverUrl) {
    const items = Array.isArray(data) ? data : (data.items || data.results || []);

    if (!items.length) {
        resultsDiv.innerHTML = '<div class="result-empty">No results found</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = items.map(item => {
        const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
        // /api/add-snapshot wraps payloads as metadata.apex
        const inner = meta.apex && typeof meta.apex === 'object' ? meta.apex : meta;

        const url = String(item.url || '');
        const href = safeUrl(url);
        const title = inner.title || inner.summary || url || 'Result';
        const snippetParts = [];
        if (inner.summary && inner.summary !== title) snippetParts.push(inner.summary);
        if (Array.isArray(inner.tags) && inner.tags.length) snippetParts.push(inner.tags.join(', '));
        const snippet = snippetParts.join(' — ');

        return `
            <div class="result-item">
                <a class="result-title" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
                <div class="result-url">${escapeHtml(url)}${item.type ? ` · ${escapeHtml(item.type)}` : ''}</div>
                <div class="result-snippet">${escapeHtml(snippet)}</div>
            </div>
        `;
    }).join('');

    resultsDiv.style.display = 'block';
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
        runSearch(searchInput.value);
    }
});

// Settings gear opens the settings page in a tab
if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
}

// Close button closes the popup window
const closeBtn = document.getElementById('closeBtn');
if (closeBtn) {
    closeBtn.addEventListener('click', () => window.close());
}

// Focus the search field on load
window.addEventListener('load', () => {
    searchInput.focus();
});
