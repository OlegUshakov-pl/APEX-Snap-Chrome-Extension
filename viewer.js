// viewer.js - single snapshot viewer page (GET /api/snaps/{id})

const DEFAULT_SERVER = "http://127.0.0.1:8000";

const params = new URLSearchParams(location.search);
const snapId = params.get('id') || '';
const backQuery = params.get('q') || '';

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const backBtn = document.getElementById('backBtn');
const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('panels');

let rawText = '';

backBtn.href = 'index.html' + (backQuery ? `?q=${encodeURIComponent(backQuery)}` : '');

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

// Escapes HTML to prevent markup injection from server data
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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

function badge(text, cls) {
    return `<span class="badge${cls ? ' ' + cls : ''}">${escapeHtml(text)}</span>`;
}

async function load() {
    if (!snapId) {
        statusEl.textContent = 'No snapshot id specified';
        statusEl.classList.add('error');
        return;
    }
    document.getElementById('snapId').textContent = snapId;

    const serverUrl = await getServerUrl();
    try {
        const response = await fetch(`${serverUrl}/api/snaps/${encodeURIComponent(snapId)}`);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const row = await response.json();
        render(row);
    } catch (e) {
        console.error('Snapshot load error:', e);
        statusEl.textContent = `Failed to load snapshot: server ${serverUrl} is not available`;
        statusEl.classList.add('error');
    }
}

function render(row) {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const apex = meta.apex && typeof meta.apex === 'object' ? meta.apex : null;

    const title = (apex && apex.title) || meta.summary || row.url || row.id;
    const summary = (apex && apex.summary) || meta.summary || '';
    const sections = Array.isArray(apex && apex.sections) ? apex.sections : [];
    const questions = Array.isArray(apex && apex.questions) ? apex.questions : [];
    const facts = Array.isArray(apex && apex.facts) ? apex.facts : [];
    const highlights = Array.isArray(apex && apex.highlights) ? apex.highlights : [];
    const entities = apex && apex.entities && typeof apex.entities === 'object' ? apex.entities : {};
    const tags = (apex && Array.isArray(apex.tags) && apex.tags.length)
        ? apex.tags
        : (Array.isArray(meta.tags) ? meta.tags : []);
    const confidence = apex && typeof apex.confidence === 'number' ? apex.confidence : null;

    // ---- header ----
    document.getElementById('title').textContent = title;

    const srcUrl = safeUrl(row.url || (apex && apex.source_url) || '');
    const subtitle = document.getElementById('subtitle');
    const subtitleParts = [];
    if (srcUrl !== '#') {
        subtitleParts.push(`<a href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener">${escapeHtml(row.url || srcUrl)}</a>`);
    } else if (row.url) {
        subtitleParts.push(escapeHtml(row.url));
    }
    if (row.created_at) subtitleParts.push(escapeHtml(row.created_at));
    subtitle.innerHTML = subtitleParts.join(' · ');

    const badges = [];
    if (row.type) badges.push(badge(row.type, 'badge-type'));
    if (apex && (apex.provider || apex.model)) {
        badges.push(badge([apex.provider, apex.model].filter(Boolean).join(' / ')));
    }
    if (apex && apex.template_name) badges.push(badge(apex.template_name));
    if (confidence !== null && !isNaN(confidence)) {
        const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
        const cls = pct >= 75 ? 'badge-conf-high' : (pct >= 50 ? 'badge-conf-mid' : 'badge-conf-low');
        badges.push(badge(`confidence ${confidence.toFixed(2)}`, cls));
    }
    if (meta.category) badges.push(badge(meta.category));
    document.getElementById('badges').innerHTML = badges.join('');

    const thumb = document.getElementById('thumb');
    if (typeof row.thumbnail === 'string' && row.thumbnail.startsWith('data:image')) {
        thumb.src = row.thumbnail;
        thumb.style.display = 'block';
    }

    // ---- tabs ----
    const tabs = [{ key: 'overview', label: 'Overview' }];
    if (facts.length) tabs.push({ key: 'facts', label: `Facts (${facts.length})` });
    if (highlights.length) tabs.push({ key: 'highlights', label: `Highlights (${highlights.length})` });
    if (Object.keys(entities).length) tabs.push({ key: 'entities', label: 'Entities' });
    tabs.push({ key: 'raw', label: 'Raw JSON' });

    rawText = JSON.stringify(row, null, 2);

    const panels = {
        overview: overviewHtml(summary, sections, questions, tags),
        facts: factsHtml(facts),
        highlights: highlightsHtml(highlights),
        entities: entitiesHtml(entities),
        raw: rawHtml()
    };

    tabsEl.innerHTML = tabs.map((t, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" data-key="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>`
    ).join('');
    panelsEl.innerHTML = tabs.map((t, i) =>
        `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${escapeHtml(t.key)}">${panels[t.key]}</div>`
    ).join('');

    tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        panelsEl.querySelectorAll('.tab-panel').forEach(p =>
            p.classList.toggle('active', p.dataset.panel === btn.dataset.key));
    });

    const copyBtn = document.getElementById('copyRawBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyRaw);

    statusEl.style.display = 'none';
    contentEl.style.display = 'block';
}

function overviewHtml(summary, sections, questions, tags) {
    const parts = [];
    parts.push('<div class="section-title">Summary</div>');
    parts.push(summary
        ? `<p class="summary-text">${escapeHtml(summary)}</p>`
        : '<p class="summary-text">—</p>');

    if (sections.length) {
        parts.push('<div class="section-title">Sections</div>');
        sections.forEach(s => {
            const sec = s && typeof s === 'object' ? s : {};
            parts.push(`<div class="snap-section"><h4>${escapeHtml(sec.heading || '')}</h4><p>${escapeHtml(sec.text || '')}</p></div>`);
        });
    }

    if (questions.length) {
        parts.push('<div class="section-title">Questions</div>');
        parts.push('<ul class="questions">' +
            questions.map(q => `<li>${escapeHtml(q)}</li>`).join('') + '</ul>');
    }

    if (tags.length) {
        parts.push('<div class="section-title">Tags</div>');
        parts.push('<div class="tag-list">' +
            tags.filter(t => typeof t === 'string').map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') +
            '</div>');
    }

    return parts.join('');
}

function factsHtml(facts) {
    const rows = facts.map(f => {
        const fact = f && typeof f === 'object' ? f : {};
        const conf = typeof fact.confidence === 'number' ? fact.confidence.toFixed(2) : '—';
        const status = fact.verified
            ? '<span class="pill pill-ok">verified</span>'
            : '<span class="pill pill-warn">unverified</span>';
        const quality = fact.quality === 'low_quality' ? ' <span class="pill pill-warn">low quality</span>' : '';
        return `<tr>
            <td class="claim">${escapeHtml(fact.claim || '')}</td>
            <td class="quote">${escapeHtml(fact.quote || '')}</td>
            <td>${conf}</td>
            <td>${escapeHtml(fact.type || '')}</td>
            <td>${status}${quality}</td>
        </tr>`;
    }).join('');

    return `<table class="facts">
        <thead><tr><th>claim</th><th>quote</th><th>confidence</th><th>type</th><th>status</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function highlightsHtml(highlights) {
    return highlights.map(h => {
        const item = h && typeof h === 'object' ? h : {};
        const status = item.verified
            ? '<span class="pill pill-ok">verified</span>'
            : '<span class="pill pill-warn">unverified</span>';
        return `<div class="highlight">
            <div class="highlight-head">
                <p>&laquo;${escapeHtml(item.quote || '')}&raquo;</p>
                ${status}
            </div>
            ${item.reason ? `<div class="reason">${escapeHtml(item.reason)}</div>` : ''}
        </div>`;
    }).join('');
}

function entitiesHtml(entities) {
    return Object.keys(entities).map(key => {
        const list = Array.isArray(entities[key]) ? entities[key] : [];
        const body = list.length
            ? `<div class="tag-list">${list.map(v => `<span class="tag">${escapeHtml(v)}</span>`).join('')}</div>`
            : '<span class="entity-empty">—</span>';
        return `<div class="entity-group"><h4>${escapeHtml(key)}</h4>${body}</div>`;
    }).join('');
}

function rawHtml() {
    return `<div class="raw-head">
        <button class="raw-btn" id="copyRawBtn">Copy</button>
        <span id="copyMsg"></span>
    </div>
    <pre class="raw">${escapeHtml(rawText)}</pre>`;
}

async function copyRaw() {
    const msg = document.getElementById('copyMsg');
    try {
        await navigator.clipboard.writeText(rawText);
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = rawText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    if (msg) {
        msg.textContent = 'Copied';
        setTimeout(() => { msg.textContent = ''; }, 2000);
    }
}

load();
