/* SAP · Settings & APIs — one place for every connection the dashboard uses.
   Stores config in localStorage only. Keys typed here never leave this browser except
   to the provider they belong to (a BYOK Groq key goes straight to api.groq.com). */
(function () {
  'use strict';
  const KEY = 'sap.cfg.v1';
  const DEF = {
    apiBase: '',                         // S.A.P. backend (market, free Asimov questions, connector)
    userId: '',                          // pseudonymous player id
    groqKey: '', groqModel: 'llama-3.1-8b-instant',
    flags: { partners: true, nvidia: true, chain: false, lowgpu: false },
  };
  const load = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}'), { flags: Object.assign({}, DEF.flags, (JSON.parse(localStorage.getItem(KEY) || '{}').flags || {})) }); } catch (_) { return JSON.parse(JSON.stringify(DEF)); } };
  const cfg = load();
  if (!cfg.userId) cfg.userId = 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const qs = new URLSearchParams(location.search); if (qs.get('api')) cfg.apiBase = qs.get('api').replace(/\/+$/, '');
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {} applyFlags(); window.dispatchEvent(new CustomEvent('sapcfg', { detail: cfg })); };
  function applyFlags() { const b = document.body.classList; b.toggle('no-partners', !cfg.flags.partners); b.toggle('no-nvidia', !cfg.flags.nvidia); b.toggle('lowgpu', !!cfg.flags.lowgpu); }

  /* API helper: null when no backend is configured (callers fall back to demo mode). */
  async function api(path, opts = {}) {
    if (!cfg.apiBase) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeout || 8000);
    try {
      const r = await fetch(cfg.apiBase + path, { method: opts.method || 'GET', signal: ctl.signal,
        headers: Object.assign({ 'x-sap-user': cfg.userId }, opts.body ? { 'Content-Type': 'application/json' } : {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.code = j.code; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }

  /* Cloud brain for Asimov: backend free questions → BYOK Groq. Returns {text, via} or throws. */
  async function cloudAsk(q, history, context) {
    if (cfg.apiBase) {
      try { const r = await api('/api/sap/asimov/chat', { method: 'POST', body: { question: q, history, context }, timeout: 30000 }); return { text: r.answer, via: `${r.provider} · ${r.remaining} free left today` }; }
      catch (e) { if (!cfg.groqKey) throw e; }
    }
    if (cfg.groqKey) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.groqKey },
        body: JSON.stringify({ model: cfg.groqModel, temperature: .5, max_tokens: 400,
          messages: [{ role: 'system', content: (window.agentSystem ? window.agentSystem() : 'You are Asimov.') }, ...history.slice(-6), { role: 'user', content: q }] }) });
      if (!r.ok) throw new Error('Groq HTTP ' + r.status);
      const j = await r.json(); return { text: j.choices[0].message.content, via: 'groq · your key' };
    }
    throw new Error('no cloud brain configured');
  }
  window.SAPCFG = { cfg, save, api, cloudAsk, hasCloud: () => !!(cfg.apiBase || cfg.groqKey) };

  /* ── Settings view ─────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    const root = document.getElementById('settings-root'); if (!root) return;
    const f = cfg.flags;
    root.innerHTML = `
    <div class="pagehead"><div><div class="cap">Asimov Center</div><h1>Settings &amp; APIs</h1><p class="mut">Every connection in one place. Stored in this browser only.</p></div></div>
    <div class="setgrid">
      <div class="glass card"><h3>Asimov's brain <span class="pill g" id="setBrain">checking…</span></h3>
        <p class="mut sm">Asimov uses the first one that answers: your local Ollama → the S.A.P. server's free questions → your own Groq key → the built-in guide.</p>
        <div class="srow"><span>Local Ollama</span><b id="setOllama">—</b><button class="btn sm" id="setOllamaTest">Detect</button></div>
        <div class="srow"><span>Server free questions</span><b>${cfg.apiBase ? 'via backend' : 'needs a backend URL'}</b></div>
        <label class="fld"><span>Your Groq key (optional, free at console.groq.com)</span>
          <input type="password" id="setGroq" placeholder="gsk_…" value="${esc(cfg.groqKey)}" autocomplete="off"></label>
        <label class="fld"><span>Groq model</span><input id="setGroqModel" value="${esc(cfg.groqModel)}"></label>
        <p class="mut xs">Your key is saved only in this browser and sent only to api.groq.com. Never paste a key you share with other apps.</p>
        <div class="btns"><button class="btn sm" id="setGroqSave">Save key</button><button class="btn sm" id="setGroqClear">Forget key</button></div>
      </div>
      <div class="glass card"><h3>S.A.P. backend <span class="pill ${cfg.apiBase ? 'cy' : 'am'}" id="setApiPill">${cfg.apiBase ? 'CONFIGURED' : 'DEMO MODE'}</span></h3>
        <p class="mut sm">Powers the shared marketplace, the free Asimov questions and the public connector. Without it, the Garden and Market run as a local demo.</p>
        <label class="fld"><span>Backend URL</span><input id="setApi" placeholder="https://your-sap-backend.onrender.com" value="${esc(cfg.apiBase)}"></label>
        <div class="btns"><button class="btn sm" id="setApiSave">Save &amp; test</button><button class="btn sm" id="setApiClear">Use demo</button></div>
        <pre class="probe" id="setApiOut">${cfg.apiBase ? 'Press “Save & test”.' : 'No backend set.'}</pre>
      </div>
      <div class="glass card"><h3>Feature switches</h3>
        <p class="mut sm">Shaddai must work as plain Shaddai. Every outside integration is a switch.</p>
        ${[['partners', 'Planting-partner verification', 'Proof-of-planting cards and plot listings'],
           ['nvidia', 'Physical-AI narrative', 'Omniverse / Cosmos story cards (knowledge only)'],
           ['chain', 'On-chain features', 'Off: value adapter = none. Nothing on-chain runs from this page.'],
           ['lowgpu', 'Low-GPU mode', 'Fewer effects for older laptops']].map(([k, t, d]) =>
          `<label class="tog"><input type="checkbox" data-flag="${k}" ${f[k] ? 'checked' : ''} ${k === 'chain' ? 'disabled' : ''}><span class="sw"></span><span><b>${t}</b><small>${d}</small></span></label>`).join('')}
      </div>
      <div class="glass card"><h3>Identity &amp; data</h3>
        <div class="srow"><span>Player id</span><b class="mono">${esc(cfg.userId)}</b></div>
        <p class="mut sm">Pseudonymous, made in this browser. No email, no wallet, no tracking.</p>
        <div class="btns"><button class="btn sm" id="setReset">Reset local garden &amp; settings</button></div>
        <h3 style="margin-top:16px">Live data sources</h3>
        <p class="mut sm">Weather &amp; air quality: Open-Meteo · Green space: OpenStreetMap (Overpass) · Coastlines: Natural Earth · All free, no keys.</p>
      </div>
    </div>`;
    const $ = s => root.querySelector(s);
    root.querySelectorAll('[data-flag]').forEach(c => c.onchange = () => { cfg.flags[c.dataset.flag] = c.checked; save(); });
    $('#setGroqSave').onclick = () => { cfg.groqKey = $('#setGroq').value.trim(); cfg.groqModel = $('#setGroqModel').value.trim() || DEF.groqModel; save(); brain(); };
    $('#setGroqClear').onclick = () => { cfg.groqKey = ''; save(); render(); };
    $('#setApiClear').onclick = () => { cfg.apiBase = ''; save(); render(); };
    $('#setApiSave').onclick = async () => {
      cfg.apiBase = $('#setApi').value.trim().replace(/\/+$/, ''); save();
      const out = $('#setApiOut'); out.textContent = 'testing ' + cfg.apiBase + ' …';
      try { const h = await api('/api/health'); const m = await api('/api/sap/v1/manifest'); out.textContent = '✓ health: ' + JSON.stringify(h).slice(0, 160) + '\n✓ connector v' + m.version + ' · paused: ' + m.paused; $('#setApiPill').textContent = 'CONNECTED'; }
      catch (e) { out.textContent = '✗ ' + e.message + '\n(Is the backend running and reachable? Is CORS allowed?)'; $('#setApiPill').textContent = 'UNREACHABLE'; }
    };
    $('#setOllamaTest').onclick = () => window.detectOllama && window.detectOllama().then(brain);
    $('#setReset').onclick = () => { if (confirm('Reset your local garden, demo market and settings in this browser?')) { Object.keys(localStorage).filter(k => k.startsWith('sap.')).forEach(k => localStorage.removeItem(k)); location.reload(); } };
    brain();
  }
  function brain() {
    const o = document.getElementById('setOllama'), b = document.getElementById('setBrain'); if (!b) return;
    const A = (typeof AG !== 'undefined') ? AG : null, ol = A && A.on;
    if (o) o.textContent = ol ? '● ' + (A.model || 'connected') : 'not found';
    b.textContent = ol ? 'OLLAMA' : cfg.apiBase ? 'SERVER' : cfg.groqKey ? 'GROQ · YOUR KEY' : 'BUILT-IN GUIDE';
  }
  window.addEventListener('sapview', e => { if (e.detail === 'settings') render(); });
  applyFlags();
  if (document.getElementById('v-settings').classList.contains('active')) render();
})();
