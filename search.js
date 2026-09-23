// search.js - search page logic (search is handled by the FastAPI server)

const DEFAULT_SERVER = "http://127.0.0.1:8000";

const searchInput = document.getElementById('searchInput');
const searchBar = document.getElementById('searchBar');
const resultsDiv = document.getElementById('results');
const errorDiv = document.getElementById('searchError');
const settingsBtn = document.getElementById('settingsBtn');

// Read the configured server URL (saved by the settings page)
async function getServerUrl() {
    try {
        const result = await chrome.storage.sync.get(['server_url']);
        const url = result.server_url;
        if (url) {
            // Normalization: ensure it starts with http and has no trailing slash
            let normalized = url.trim();
            if (!/^https?:\/\//i.test(normalized)) {
                normalized = `http://${normalized}`;
            }
            return normalized.replace(/\/+$/, '');
        }
    } catch (e) {
        console.warn("Failed to read server_url from storage, using default", e);
    }
    return DEFAULT_SERVER;
}

// Runs the search on the FastAPI server
async function runSearch(query) {
    query = query.trim();
    if (!query) return;

    const serverUrl = await getServerUrl();

    // Reset UI into the loading state
    resultsDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    searchBar.classList.add('loading');

    try {
        const response = await fetch(`${serverUrl}/api/search?query=${encodeURIComponent(query)}`);

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        renderResults(data);
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
function renderResults(data) {
    const results = Array.isArray(data) ? data : (data.results || []);

    if (!results.length) {
        resultsDiv.innerHTML = '<div class="result-empty">No results found</div>';
    } else {
        resultsDiv.innerHTML = results.map(r => `
            <div class="result-item">
                <a class="result-title" href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener">${escapeHtml(r.title || r.url || 'Result')}</a>
                <div class="result-url">${escapeHtml(r.url || '')}</div>
                <div class="result-snippet">${escapeHtml(r.snippet || '')}</div>
            </div>
        `).join('');
    }

    resultsDiv.style.display = 'block';
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

// Settings gear opens the settings page
settingsBtn.addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('settings.html');
});

// Focus the search field on load
window.addEventListener('load', () => {
    searchInput.focus();
});
