(function () {
  'use strict';

  const SAMPLE = {
    name: 'JSONDesk',
    version: 1,
    active: true,
    tags: ['json', 'pretty', 'validate'],
    user: {
      id: 42,
      email: 'demo@example.com',
      prefs: { theme: 'dark', indent: 2 },
    },
    items: [
      { sku: 'A-100', price: 9.99 },
      { sku: 'B-200', price: 14.5 },
    ],
    note: null,
  };

  const input = document.getElementById('input');
  const statusEl = document.getElementById('status');
  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('searchResults');
  const treeEl = document.getElementById('tree');
  const treeToggle = document.getElementById('treeToggle');
  const toast = document.getElementById('toast');

  let treeVisible = false;
  let toastTimer = null;

  function showStatus(ok, message) {
    statusEl.hidden = false;
    statusEl.className = 'status ' + (ok ? 'ok' : 'err');
    statusEl.textContent = message;
  }

  function hideStatus() {
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  function showToast(msg) {
    toast.textContent = msg || 'Copied';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 1600);
  }

  /** Parse JSON and return { ok, value } or { ok:false, error, position, line, column }. */
  function parseJson(text) {
    const raw = String(text ?? '');
    if (!raw.trim()) {
      return { ok: false, error: 'Empty input — paste some JSON first.', position: 0, line: 1, column: 1 };
    }
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const posMatch = message.match(/position\s+(\d+)/i);
      const position = posMatch ? Number(posMatch[1]) : null;
      let line = null;
      let column = null;
      if (position != null && !Number.isNaN(position)) {
        const before = raw.slice(0, position);
        const lines = before.split(/\n/);
        line = lines.length;
        column = lines[lines.length - 1].length + 1;
      }
      return { ok: false, error: message, position, line, column };
    }
  }

  function formatError(parsed) {
    let msg = 'Invalid JSON: ' + parsed.error;
    if (parsed.line != null && parsed.column != null) {
      msg += '\nLine ' + parsed.line + ', column ' + parsed.column;
      if (parsed.position != null) msg += ' (position ' + parsed.position + ')';
    } else if (parsed.position != null) {
      msg += '\nPosition ' + parsed.position;
    }
    return msg;
  }

  function summarizeValue(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array[' + value.length + ']';
    const t = typeof value;
    if (t === 'object') return 'object{' + Object.keys(value).length + ' keys}';
    if (t === 'string') {
      const s = JSON.stringify(value);
      return s.length > 60 ? s.slice(0, 57) + '…"' : s;
    }
    return String(value);
  }

  function walk(value, path, keyFilter, hits, limit) {
    if (hits.length >= limit) return;
    const key = path.split('.').pop() || '';
    const lastSeg = path.match(/([^.\[\]]+)(?:\[\d+\])?$/);
    const leafKey = lastSeg ? lastSeg[1] : '';
    const q = keyFilter.toLowerCase();

    if (path && (path.toLowerCase().includes(q) || leafKey.toLowerCase() === q || leafKey.toLowerCase().includes(q))) {
      hits.push({ path: path || '(root)', value: summarizeValue(value) });
    }

    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (hits.length >= limit) break;
          const childPath = path ? path + '[' + i + ']' : '[' + i + ']';
          walk(value[i], childPath, keyFilter, hits, limit);
        }
      } else {
        Object.keys(value).forEach((k) => {
          if (hits.length >= limit) return;
          const childPath = path ? path + '.' + k : k;
          walk(value[k], childPath, keyFilter, hits, limit);
        });
      }
    }
  }

  function renderSearch(value, query) {
    const q = query.trim();
    if (!q) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      return;
    }
    const hits = [];
    walk(value, '', q, hits, 80);
    searchResults.hidden = false;
    if (!hits.length) {
      searchResults.innerHTML = '<div class="search-hit">No matches for <span class="path">' + escapeHtml(q) + '</span></div>';
      return;
    }
    searchResults.innerHTML = hits
      .map(
        (h) =>
          '<div class="search-hit"><span class="path">' +
          escapeHtml(h.path) +
          '</span> <span class="val">→ ' +
          escapeHtml(h.val || h.value) +
          '</span></div>'
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildTree(value, indent) {
    const pad = '  '.repeat(indent);
    if (value === null) return pad + 'null\n';
    if (typeof value !== 'object') {
      return pad + (typeof value === 'string' ? JSON.stringify(value) : String(value)) + '\n';
    }
    if (Array.isArray(value)) {
      if (!value.length) return pad + '[]\n';
      let out = pad + '[\n';
      value.forEach((item, i) => {
        out += pad + '  [' + i + ']\n';
        out += buildTree(item, indent + 2);
      });
      out += pad + ']\n';
      return out;
    }
    const keys = Object.keys(value);
    if (!keys.length) return pad + '{}\n';
    let out = pad + '{\n';
    keys.forEach((k) => {
      out += pad + '  ' + k + ':\n';
      out += buildTree(value[k], indent + 2);
    });
    out += pad + '}\n';
    return out;
  }

  function refreshTreeIfVisible() {
    if (!treeVisible) return;
    const parsed = parseJson(input.value);
    if (!parsed.ok) {
      treeEl.textContent = '(fix invalid — fix errors to see tree)';
      return;
    }
    treeEl.textContent = buildTree(parsed.value, 0).trimEnd() || '(empty)';
  }

  function doPretty() {
    const parsed = parseJson(input.value);
    input.classList.toggle('invalid', !parsed.ok);
    if (!parsed.ok) {
      showStatus(false, formatError(parsed));
      return;
    }
    input.value = JSON.stringify(parsed.value, null, 2);
    input.classList.remove('invalid');
    showStatus(true, 'Valid JSON — pretty-printed (2-space indent).');
    refreshTreeIfVisible();
  }

  function doMinify() {
    const parsed = parseJson(input.value);
    input.classList.toggle('invalid', !parsed.ok);
    if (!parsed.ok) {
      showStatus(false, formatError(parsed));
      return;
    }
    input.value = JSON.stringify(parsed.value);
    input.classList.remove('invalid');
    showStatus(true, 'Valid JSON — minified.');
    refreshTreeIfVisible();
  }

  function doValidate() {
    const parsed = parseJson(input.value);
    input.classList.toggle('invalid', !parsed.ok);
    if (!parsed.ok) {
      showStatus(false, formatError(parsed));
      return;
    }
    const summary = summarizeValue(parsed.value);
    showStatus(true, 'Valid JSON — ' + summary + '.');
    refreshTreeIfVisible();
  }

  function doSearch() {
    const parsed = parseJson(input.value);
    input.classList.toggle('invalid', !parsed.ok);
    if (!parsed.ok) {
      showStatus(false, formatError(parsed));
      searchResults.hidden = true;
      return;
    }
    const q = searchInput.value.trim();
    if (!q) {
      showStatus(false, 'Enter a path or key to search (e.g. user.email or email).');
      searchResults.hidden = true;
      return;
    }
    hideStatus();
    renderSearch(parsed.value, q);
  }

  document.getElementById('prettyBtn').addEventListener('click', doPretty);
  document.getElementById('minifyBtn').addEventListener('click', doMinify);
  document.getElementById('validateBtn').addEventListener('click', doValidate);
  document.getElementById('sampleBtn').addEventListener('click', () => {
    input.value = JSON.stringify(SAMPLE, null, 2);
    input.classList.remove('invalid');
    showStatus(true, 'Sample JSON loaded.');
    refreshTreeIfVisible();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    input.value = '';
    input.classList.remove('invalid');
    hideStatus();
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    if (treeVisible) treeEl.textContent = '';
  });
  document.getElementById('copyBtn').addEventListener('click', async () => {
    const text = input.value;
    if (!text) {
      showStatus(false, 'Nothing to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {
      input.focus();
      input.select();
      showToast('Select & copy (clipboard blocked)');
    }
  });
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  });

  treeToggle.addEventListener('click', () => {
    treeVisible = !treeVisible;
    treeEl.hidden = !treeVisible;
    treeToggle.textContent = treeVisible ? 'Hide tree' : 'Show tree';
    if (treeVisible) refreshTreeIfVisible();
  });

  input.addEventListener('input', () => {
    input.classList.remove('invalid');
  });

  // Load empty; user can click Sample
})();
