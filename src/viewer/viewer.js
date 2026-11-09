// viewer.js - просмотр одного слепка (GET {BASE_URL}/api/snaps/{id})

const DEFAULT_BASE_URL = 'http://localhost:8080';

const params = new URLSearchParams(location.search);
const snapId = params.get('id') || '';
const backQuery = params.get('q') || '';

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const backBtn = document.getElementById('backBtn');
const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('panels');

let rawText = '';

backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    try { window.close(); } catch (err) { /* ignore */ }
    if (history.length > 1) history.back();
});

async function getBaseUrl() {
    try {
        const data = await chrome.storage.local.get(['base_url']);
        const url = String(data.base_url || '').trim();
        if (url) {
            let u = /^https?:\/\//i.test(url) ? url : `http://${url}`;
            try { return new URL(u).origin; } catch (e) { /* fallthrough */ }
        }
    } catch (e) {
        console.warn('ApexShot: failed to read base_url', e);
    }
    return DEFAULT_BASE_URL;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function safeUrl(value) {
    try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) ? url.href : '#';
    } catch (e) {
        return '#';
    }
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeSnap(row) {
    let meta = row && row.metadata;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch (e) { meta = null; }
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};

    let inner = meta;
    for (let depth = 0; depth < 4; depth++) {
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            if (inner.apex && typeof inner.apex === 'object' && !Array.isArray(inner.apex)) {
                inner = inner.apex; continue;
            }
            if (inner.metadata_ai && typeof inner.metadata_ai === 'object' && !Array.isArray(inner.metadata_ai)) {
                inner = inner.metadata_ai; continue;
            }
            if (inner.metadata && typeof inner.metadata === 'object' && !Array.isArray(inner.metadata)) {
                inner = inner.metadata; continue;
            }
        }
        break;
    }
    const flat = Object.assign({}, meta, inner);
    if (row && typeof row === 'object') {
        for (const k of ['title', 'summary', 'overview', 'description', 'search_text']) {
            if (flat[k] == null && row[k] != null) flat[k] = row[k];
        }
    }
    return flat;
}

function pickText(data, keys, minLen) {
    minLen = minLen || 15;
    for (const k of keys) {
        const v = data && data[k];
        if (typeof v === 'string') {
            const s = v.replace(/\s+/g, ' ').trim();
            if (s.length >= minLen) return s;
        }
    }
    return '';
}

function badge(text, cls) {
    return `<span class="badge${cls ? ' ' + cls : ''}">${escapeHtml(text)}</span>`;
}

async function load() {
    if (!snapId) {
        statusEl.textContent = 'Не указан id слепка';
        statusEl.classList.add('error');
        return;
    }
    document.getElementById('snapId').textContent = snapId;

    const baseUrl = await getBaseUrl();
    try {
        const response = await fetch(`${baseUrl}/api/snaps/${encodeURIComponent(snapId)}`);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const row = await response.json();
        render(row);
    } catch (e) {
        console.error('ApexShot: snapshot load error', e);
        statusEl.textContent = `Не удалось загрузить слепок: сервер ${baseUrl} недоступен`;
        statusEl.classList.add('error');
    }
}

function render(row) {
    const data = normalizeSnap(row);

    const sections = asArray(data.sections);
    const questions = asArray(data.questions);
    const facts = asArray(data.facts);
    const highlights = asArray(data.highlights);
    const entities = (data.entities && typeof data.entities === 'object' && !Array.isArray(data.entities))
        ? data.entities : {};
    const tags = asArray(data.tags);
    const confidence = typeof data.confidence === 'number' ? data.confidence : null;
    const searchSnippet = String(row.search_text || row.snippet || '').replace(/\s+/g, ' ').trim();

    const title = pickText(data, ['title', 'summary', 'overview', 'description'], 3)
        || searchSnippet.slice(0, 140) || row.url || data.source_url || row.id || snapId;

    let summary = pickText(data, ['summary', 'overview', 'description', 'content', 'text', 'search_text'], 15);
    if (!summary && searchSnippet.length >= 15) summary = searchSnippet.slice(0, 900);
    if (!summary && sections.length) {
        const firstSec = sections.map(s => {
            const sec = s && typeof s === 'object' ? s : {};
            return String(sec.text || sec.content || '').replace(/\s+/g, ' ').trim();
        }).find(t => t.length >= 15);
        if (firstSec) summary = firstSec.slice(0, 900);
    }
    if (!summary && searchSnippet) summary = searchSnippet.slice(0, 900);

    document.getElementById('title').textContent = title;

    const srcUrl = safeUrl(row.url || data.source_url || '');
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
    if (data.provider || data.model) badges.push(badge([data.provider, data.model].filter(Boolean).join(' / ')));
    if (data.template_name) badges.push(badge(data.template_name));
    if (confidence !== null && !isNaN(confidence)) {
        const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
        const cls = pct >= 75 ? 'badge-conf-high' : (pct >= 50 ? 'badge-conf-mid' : 'badge-conf-low');
        badges.push(badge(`confidence ${confidence.toFixed(2)}`, cls));
    }
    if (data.category) badges.push(badge(data.category));
    document.getElementById('badges').innerHTML = badges.join('');

    const thumb = document.getElementById('thumb');
    if (typeof row.thumbnail === 'string' && row.thumbnail.startsWith('data:image')) {
        thumb.src = row.thumbnail;
        thumb.style.display = 'block';
    }

    const tabs = [{ key: 'overview', label: 'Overview' }];
    if (facts.length) tabs.push({ key: 'facts', label: `Facts (${facts.length})` });
    if (highlights.length) tabs.push({ key: 'highlights', label: `Highlights (${highlights.length})` });
    if (Object.keys(entities).length) tabs.push({ key: 'entities', label: 'Entities' });
    tabs.push({ key: 'raw', label: 'Raw JSON' });

    rawText = JSON.stringify(row, null, 2);

    const panels = {
        overview: overviewHtml(summary, sections, questions, tags, row),
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

function overviewHtml(summary, sections, questions, tags, row) {
    const parts = [];
    parts.push('<div class="section-title">Summary</div>');
    parts.push(summary
        ? `<p class="summary-text">${escapeHtml(summary)}</p>`
        : `<p class="summary-text">Нет описания. <span style="color:#999;">${escapeHtml(String(row.url || row.id || ''))}</span></p>`);

    if (sections.length) {
        parts.push('<div class="section-title">Sections</div>');
        sections.forEach(s => {
            const sec = s && typeof s === 'object' ? s : {};
            const head = sec.heading || sec.title || '';
            const body = sec.text || sec.content || '';
            if (!head && !body) return;
            parts.push(`<div class="snap-section">${head ? `<h4>${escapeHtml(head)}</h4>` : ''}<p>${escapeHtml(body)}</p></div>`);
        });
    }
    if (questions.length) {
        parts.push('<div class="section-title">Questions</div>');
        parts.push('<ul class="questions">' + questions.map(q => `<li>${escapeHtml(q)}</li>`).join('') + '</ul>');
    }
    if (tags.length) {
        parts.push('<div class="section-title">Tags</div>');
        parts.push('<div class="tag-list">' + tags.filter(t => typeof t === 'string').map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') + '</div>');
    }
    return parts.join('');
}

function factsHtml(facts) {
    const rows = facts.map(f => {
        const fact = f && typeof f === 'object' ? f : {};
        const conf = typeof fact.confidence === 'number' ? fact.confidence.toFixed(2) : '—';
        const status = fact.verified ? '<span class="pill pill-ok">verified</span>' : '<span class="pill pill-warn">unverified</span>';
        const quality = fact.quality === 'low_quality' ? ' <span class="pill pill-warn">low quality</span>' : '';
        return `<tr>
            <td class="claim">${escapeHtml(fact.claim || fact.statement || '')}</td>
            <td class="quote">${escapeHtml(fact.quote || fact.evidence || '')}</td>
            <td>${conf}</td>
            <td>${escapeHtml(fact.type || '')}</td>
            <td>${status}${quality}</td>
        </tr>`;
    }).join('');
    return `<table class="facts"><thead><tr><th>claim</th><th>quote</th><th>confidence</th><th>type</th><th>status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function highlightsHtml(highlights) {
    return highlights.map(h => {
        const item = h && typeof h === 'object' ? h : {};
        const status = item.verified ? '<span class="pill pill-ok">verified</span>' : '<span class="pill pill-warn">unverified</span>';
        return `<div class="highlight"><div class="highlight-head"><p>&laquo;${escapeHtml(item.quote || item.text || '')}&raquo;</p>${status}</div>${item.reason ? `<div class="reason">${escapeHtml(item.reason)}</div>` : ''}</div>`;
    }).join('');
}

function entitiesHtml(entities) {
    return Object.keys(entities).map(key => {
        const list = asArray(entities[key]);
        const body = list.length ? `<div class="tag-list">${list.map(v => `<span class="tag">${escapeHtml(v)}</span>`).join('')}</div>` : '<span class="entity-empty">—</span>';
        return `<div class="entity-group"><h4>${escapeHtml(key)}</h4>${body}</div>`;
    }).join('');
}

function rawHtml() {
    return `<div class="raw-head"><button class="raw-btn" id="copyRawBtn">Copy</button><span id="copyMsg"></span></div><pre class="raw">${escapeHtml(rawText)}</pre>`;
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