// Lógica de la interfaz: pinta el dock o el panel según ?view=dock|panel
/* global WIDGET_DEFS, ICONS, SEARCH_EXTRAS, LOCAL_ACTIONS, LOCAL, iconImg, icon, esc, attr */
const params = new URLSearchParams(location.search);
const VIEW = params.get('view') || 'dock';
const STYLE = params.get('style') || 'glass';
document.documentElement.className = `view-${VIEW} style-${STYLE}`;

const api = window.nimbo;
const root = document.getElementById('root');
let S = null;              // último estado recibido
const local = { battery: null };
let openWidget = null;     // widget del panel (en la vista panel) o resaltado (en la vista dock)

const ctx = () => ({ s: S, now: new Date(Date.now()), local });

// ------------------------------------------------------------------ dock
const tileCache = new Map();
function renderDock() {
  if (!S) return;
  let dock = root.querySelector('.dock');
  if (!dock) {
    root.innerHTML = '<div class="dock"></div>';
    dock = root.querySelector('.dock');
    new ResizeObserver(() => api.dockSize(dock.getBoundingClientRect().width)).observe(dock);
  }
  const c = ctx();
  const ids = S.settings.widgets.filter((w) => w.enabled).map((w) => w.id).concat('_gear');
  // separar grupos: inicio + apps | widgets | reloj
  const html = [];
  for (const id of ids) {
    let h = '';
    if (id === '_gear') h = `<button class="tile tile-icon gear" data-panel="settings" title="Ajustes">${icon('gear', 18)}</button>`;
    else { try { h = WIDGET_DEFS[id]?.tile?.(c) || ''; } catch (e) { console.error(id, e); h = ''; } }
    if (h) html.push({ id, h });
  }
  // reconciliar por id para no repintar imágenes que no cambian
  const existing = new Map([...dock.children].map((el) => [el.dataset.w, el]));
  let prev = null;
  for (const { id, h } of html) {
    let el = existing.get(id);
    if (!el) { el = document.createElement('div'); el.className = 'slot'; el.dataset.w = id; }
    existing.delete(id);
    if (tileCache.get(id) !== h) { el.innerHTML = h; tileCache.set(id, h); }
    el.classList.toggle('open', openWidget != null && el.querySelector(`[data-panel="${openWidget}"]`) != null);
    el.classList.toggle('sep-before', id === 'apps' || (prev === 'apps'));
    const ref = prev ? prev.nextSibling : dock.firstChild;
    if (ref !== el) dock.insertBefore(el, ref);
    prev = el;
  }
  for (const [id, el] of existing) { el.remove(); tileCache.delete(id); }
}

// ------------------------------------------------------------------ panel
function renderPanel(force) {
  if (!S || !openWidget) return;
  const def = WIDGET_DEFS[openWidget];
  if (!def?.panel) return;
  let panel = root.querySelector('.panel');
  if (!panel) {
    root.innerHTML = '<div class="panel"></div>';
    panel = root.querySelector('.panel');
    new ResizeObserver(() => sendPanelSize()).observe(panel);
  }
  // no repintar mientras se escribe en un campo (perdería el foco)
  const focused = document.activeElement;
  if (!force && def.noAutoRender) return;
  if (!force && def.keepWhileTyping && focused && panel.contains(focused) && /INPUT|TEXTAREA|SELECT/.test(focused.tagName)) return;
  let html;
  try { html = def.panel(ctx()); } catch (e) { console.error(e); html = `<div class="err">${e.message}</div>`; }
  if (panel.dataset.w === openWidget && panel._html === html) return;
  const scroll = panel.scrollTop;
  panel.innerHTML = html;
  panel._html = html;
  panel.dataset.w = openWidget;
  panel.style.width = (def.width || 340) + 'px';
  panel.scrollTop = scroll;
  sendPanelSize();
}
function sendPanelSize() {
  const panel = root.querySelector('.panel');
  if (!panel || !openWidget) return;
  const r = panel.getBoundingClientRect();
  api.panelSize({ width: r.width, height: Math.min(panel.scrollHeight, 900) });
}

// ------------------------------------------------------------------ eventos
function argsOf(el) { try { return JSON.parse(el.dataset.args || '{}'); } catch { return {}; } }

root.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-panel], [data-act], [data-key], [data-result], [data-todo-del], [data-todo-clear], [data-clear-secret]');
  if (!t) return;
  if (t.dataset.key) { hoverCancel(); return api.action('appClick', { key: t.dataset.key }); }
  const pinBtn = e.target.closest('[data-pin]');
  if (pinBtn) {
    const r = results[Number(pinBtn.dataset.pin)];
    if (r && !(S.settings.pins || []).some((p) => p.id === r.id)) {
      S.settings.pins = [...(S.settings.pins || []), { id: r.id, name: r.name }];
      api.action('pinApp', { id: r.id, name: r.name });
      renderResults();
    }
    return;
  }
  if (t.dataset.result != null) return openResult(Number(t.dataset.result));
  if (t.dataset.panel) {
    const r = t.getBoundingClientRect();
    api.log?.('clic en', t.dataset.panel);
    api.openPanel(t.dataset.panel, window.screenX + r.left + r.width / 2);
    return;
  }
  if (t.dataset.act === '_move') {
    const { i, dir } = argsOf(t);
    const list = S.settings.widgets.slice();
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return api.action('settings', { patch: { widgets: list } });
  }
  if (t.dataset.act && LOCAL_ACTIONS[t.dataset.act]) {
    const patch = LOCAL_ACTIONS[t.dataset.act](argsOf(t), S);
    if (patch) { Object.assign(S.settings, patch); api.action('settings', { patch }); }
    renderPanel(true);
    return;
  }
  if (t.dataset.act) return api.action(t.dataset.act, argsOf(t));
  if (t.dataset.todoDel) return saveTodos(S.data.todos.filter((x) => x.id !== t.dataset.todoDel));
  if (t.dataset.todoClear != null) return saveTodos(S.data.todos.filter((x) => !x.done));
  if (t.dataset.clearSecret) return api.action('secret', { name: t.dataset.clearSecret, value: '' });
});

root.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const a = e.target.closest('[data-key]');
  if (a) { hoverCancel(); api.action('appMenu', { key: a.dataset.key }); return; }
  if (VIEW === 'dock') api.action('dockMenu');
});

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.todoToggle) return saveTodos(S.data.todos.map((x) => (x.id === t.dataset.todoToggle ? { ...x, done: t.checked } : x)));
  if (t.dataset.setting) {
    const v = t.type === 'checkbox' ? t.checked : t.value;
    return api.action('settings', { patch: { [t.dataset.setting]: v } });
  }
  if (t.dataset.settingNum) {
    const v = Math.max(1, Math.min(600, parseInt(t.value, 10) || 1));
    return api.action('settings', { patch: { [t.dataset.settingNum]: v } });
  }
  if (t.dataset.widget) {
    const list = S.settings.widgets.map((w) => (w.id === t.dataset.widget ? { ...w, enabled: t.checked } : w));
    return api.action('settings', { patch: { widgets: list } });
  }
});

let notesTimer = null;
root.addEventListener('input', (e) => {
  if (e.target.dataset.notes != null) {
    clearTimeout(notesTimer);
    const v = e.target.value;
    notesTimer = setTimeout(() => api.action('data', { patch: { notes: v } }), 400);
  }
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const fd = new FormData(f);
  switch (f.dataset.form) {
    case 'addTodo': {
      const text = String(fd.get('text') || '').trim();
      if (!text) return;
      f.reset();
      return saveTodos([{ id: Math.random().toString(36).slice(2, 10), text, done: false }, ...S.data.todos]);
    }
    case 'customTimer': {
      const m = parseFloat(fd.get('min'));
      if (m > 0) api.action('timer', { op: 'start', minutes: m });
      return;
    }
    case 'secret': {
      await api.action('secret', { name: f.dataset.name, value: String(fd.get('value') || '') });
      f.reset(); document.activeElement?.blur(); renderPanel(true);
      return;
    }
    case 'city': {
      const msg = root.querySelector('[data-msg="city"]');
      try { await api.action('setCity', { city: String(fd.get('city') || '') }); document.activeElement?.blur(); renderPanel(true); }
      catch (err) { if (msg) msg.textContent = 'No se encontró esa ciudad.'; }
      return;
    }
    case 'calendars': {
      const urls = String(fd.get('urls') || '').split(/\s+/).map((u) => u.trim()).filter((u) => /^(https?|webcal):\/\//i.test(u));
      await api.action('settings', { patch: { calendars: urls } });
      document.activeElement?.blur(); renderPanel(true);
      return;
    }
    case 'addSymbol': {
      const syms = String(fd.get('sym') || '').toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Z0-9.^=\-]{1,15}$/.test(x));
      if (!syms.length) return;
      const tab = Math.min(LOCAL.stocksTab, S.settings.watchlists.length - 1);
      const watchlists = S.settings.watchlists.map((l, i) => (i === tab ? { ...l, symbols: [...new Set([...l.symbols, ...syms])] } : l));
      S.settings.watchlists = watchlists; f.reset(); renderPanel(true);
      return api.action('settings', { patch: { watchlists } });
    }
    case 'newList': {
      const name = String(fd.get('name') || '').trim(); if (!name) return;
      const watchlists = [...S.settings.watchlists, { name, symbols: [] }];
      LOCAL.stocksTab = watchlists.length - 1; LOCAL.newList = false;
      S.settings.watchlists = watchlists; renderPanel(true);
      return api.action('settings', { patch: { watchlists } });
    }
    case 'addTarget': {
      const symbol = String(fd.get('sym') || '').trim().toUpperCase(); const price = parseFloat(fd.get('price'));
      if (!symbol || !(price > 0)) return;
      const stockTargets = [...(S.settings.stockTargets || []), { id: Math.random().toString(36).slice(2, 9), symbol, op: fd.get('op') === '<' ? '<' : '>', price }];
      const patch = { stockTargets };
      if (!S.settings.watchlists.some((l) => l.symbols.includes(symbol))) patch.watchlists = S.settings.watchlists.map((l, i) => (i === 0 ? { ...l, symbols: [...l.symbols, symbol] } : l));
      Object.assign(S.settings, patch); f.reset(); renderPanel(true);
      return api.action('settings', { patch });
    }
    case 'githubUser': {
      await api.action('settings', { patch: { githubUser: String(fd.get('user') || '').trim() } });
      document.activeElement?.blur(); renderPanel(true);
      return;
    }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && VIEW === 'panel') api.closePanel(); });

function saveTodos(todos) { S.data.todos = todos; renderPanel(true); renderDock(); return api.action('data', { patch: { todos } }); }

// ------------------------------------------------------------------ arranque
function onState(s) {
  S = s;
  if (VIEW === 'dock') renderDock(); else if (VIEW === 'panel') renderPanel();
}

// ------------------------------------------------------------------ íconos de apps
api.icons().then((m) => { Object.assign(ICONS, m); rerender(); });
api.onIcons((patch) => { Object.assign(ICONS, patch); rerender(); });
function rerender() {
  if (VIEW === 'dock') renderDock();
  else if (VIEW === 'panel') { if (openWidget === 'search') renderResults(); else renderPanel(); }
  else if (VIEW === 'preview') renderPreview();
}

// ------------------------------------------------------------------ vista previa al dejar el mouse sobre una app
let hoverTimer = null;
let previewOpen = false;
let hoverKey = null;
function hoverCancel() { clearTimeout(hoverTimer); hoverKey = null; }
if (VIEW === 'dock') {
  root.addEventListener('mouseover', (e) => {
    const b = e.target.closest('.app[data-key]');
    if (!b || b.dataset.key === hoverKey) return;
    hoverKey = b.dataset.key;
    clearTimeout(hoverTimer);
    if (!b.classList.contains('running')) { if (previewOpen) api.previewLeave(); return; }
    const go = () => { const r = b.getBoundingClientRect(); previewOpen = true; api.previewShow(b.dataset.key, window.screenX + r.left + r.width / 2); };
    if (previewOpen) go(); else hoverTimer = setTimeout(go, 450);
  });
  root.addEventListener('mouseout', (e) => {
    const b = e.target.closest('.app[data-key]');
    if (!b || b.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer); hoverKey = null;
    if (previewOpen) api.previewLeave();
  });
  api.onPreviewClosed(() => { previewOpen = false; });
}

// ------------------------------------------------------------------ buscador
let allApps = [];
let results = [];
let sel = 0;
const fold = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function score(name, q) {
  const n = fold(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(/[\s\-_.()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 60;
  if (words.map((w) => w[0]).join('').startsWith(q)) return 50;
  if (n.includes(q)) return 40;
  return 0;
}
function renderResults() {
  const box = root.querySelector('[data-results]');
  const input = root.querySelector('[data-search]');
  if (!box || !input) return;
  const raw = input.value.trim();
  const q = fold(raw);
  if (!q) {
    results = [];
    box.innerHTML = allApps.length ? `<div class="muted small res-title">Todas las apps (${allApps.length})</div>` + allApps.slice(0, 60).map((a, i) => { results.push({ kind: 'app', ...a }); return row(results[i], i); }).join('')
      : '<div class="empty">Cargando tus apps…</div>';
  } else {
    const ranked = allApps.map((a) => ({ kind: 'app', ...a, sc: score(a.name, q) }))
      .concat(SEARCH_EXTRAS.map((x) => ({ ...x, sc: score(x.name, q) - 5 })))
      .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || a.name.length - b.name.length).slice(0, 9);
    results = ranked.concat([{ kind: 'web', name: `Buscar «${raw}» en la web`, q: raw, icon: 'globe' }]);
    box.innerHTML = results.map(row).join('');
  }
  sel = Math.min(sel, Math.max(0, results.length - 1));
  box.querySelectorAll('.res')[sel]?.classList.add('sel');
  const missing = results.filter((r) => r.kind === 'app' && !(r.iconKey in ICONS)).map((r) => r.iconKey);
  if (missing.length) api.needIcons(missing);
}
function row(r, i) {
  const ic = r.kind === 'app' ? iconImg(r.iconKey, 26) : `<span class="res-ic">${icon(r.icon || 'gear', 18)}</span>`;
  const sub = { app: 'App', setting: 'Configuración', keys: 'Sistema', web: 'Web' }[r.kind];
  const pinned = r.kind === 'app' && (S?.settings.pins || []).some((p) => p.id === r.id);
  const pin = r.kind === 'app' ? `<span class="res-pin ${pinned ? 'on' : ''}" data-pin="${i}" title="${pinned ? 'Anclada en el dock' : 'Anclar en el dock'}">${icon('pin', 15)}</span>` : '';
  return `<button class="res" data-result="${i}">${ic}<span class="res-name ellipsis">${esc(r.name)}</span>${pin}<small class="muted">${sub}</small></button>`;
}
function openResult(i) {
  const r = results[i]; if (!r) return;
  if (r.kind === 'app') api.action('launchApp', { id: r.id, name: r.name });
  else if (r.kind === 'setting') api.action('openSettingsUri', { uri: r.uri });
  else if (r.kind === 'keys') api.action('winKeys', { keys: r.keys });
  else if (r.kind === 'web') api.action('searchWeb', { q: r.q });
}
root.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('[data-search]')) return;
  const n = results.length;
  if (e.key === 'ArrowDown') { sel = (sel + 1) % n; e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = (sel - 1 + n) % n; e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); openResult(sel); return; }
  else return;
  const rows = root.querySelectorAll('.res');
  rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
  rows[sel]?.scrollIntoView({ block: 'nearest' });
});
root.addEventListener('input', (e) => { if (e.target.matches?.('[data-search]')) { sel = 0; renderResults(); } });
async function startSearch() {
  const input = root.querySelector('[data-search]');
  input?.focus();
  renderResults();
  allApps = await api.appsList().catch(() => []) || [];
  renderResults();
}

// ------------------------------------------------------------------ ventana de vistas previas
let PV = null;
function renderPreview() {
  if (!PV) return;
  let wrap = root.querySelector('.preview');
  if (!wrap) {
    root.innerHTML = '<div class="preview"></div>';
    wrap = root.querySelector('.preview');
    wrap.addEventListener('mouseenter', () => api.previewHover(true));
    wrap.addEventListener('mouseleave', () => api.previewHover(false));
    new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); api.previewSize({ width: r.width, height: r.height }); }).observe(wrap);
  }
  wrap.innerHTML = PV.windows.map((w) => {
    const th = PV.thumbs?.[String(w.hwnd)];
    return `<div class="pv-card ${w.active ? 'active' : ''}" data-hwnd="${w.hwnd}">
      <div class="pv-head">${iconImg(PV.iconKey, 16)}<span class="ellipsis">${esc(w.title)}</span><button class="pv-close" data-close="${w.hwnd}" title="Cerrar ventana">${icon('x', 14)}</button></div>
      <div class="pv-thumb">${th ? `<img src="${th}" alt="">` : `<div class="pv-ph">${iconImg(PV.iconKey, 40)}${w.minimized ? '<small class="muted">Minimizada</small>' : ''}</div>`}</div></div>`;
  }).join('');
  const r = wrap.getBoundingClientRect();
  api.previewSize({ width: r.width, height: r.height });
}
if (VIEW === 'preview') {
  api.onPreviewData((d) => { PV = d; renderPreview(); });
  api.onPreviewThumbs((t) => { if (PV) { PV.thumbs = t; renderPreview(); } });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) {
      e.stopPropagation();
      const hwnd = Number(c.dataset.close);
      api.action('closeWindow', { hwnd });
      PV.windows = PV.windows.filter((w) => w.hwnd !== hwnd);
      if (!PV.windows.length) api.previewHover(false);
      renderPreview();
      return;
    }
    const card = e.target.closest('[data-hwnd]');
    if (card) api.action('previewFocus', { hwnd: Number(card.dataset.hwnd) });
  }, true);
}

window.addEventListener('error', (e) => api.log?.(VIEW, 'error:', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => api.log?.(VIEW, 'promesa:', String(e.reason)));
api.onState(onState);
api.state().then(onState);

if (VIEW === 'dock') {
  api.onPanelOpened((w) => { openWidget = w; renderDock(); });
  api.onPanelClosed(() => { openWidget = null; renderDock(); });
  setInterval(renderDock, 1000);
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => { local.battery = { level: b.level, charging: b.charging, chargingTime: b.chargingTime }; renderDock(); };
      ['levelchange', 'chargingchange'].forEach((ev) => b.addEventListener(ev, upd));
      upd();
    }).catch(() => {});
  }
} else {
  api.onPanelShow((w) => {
    openWidget = w;
    root.innerHTML = '';
    renderPanel(true);
    sendPanelSize();
    setTimeout(sendPanelSize, 50);
    if (w === 'search') { sel = 0; startSearch(); }
    // poner el cursor en el primer campo de texto útil
    setTimeout(() => root.querySelector('[data-search], [data-form="addTodo"] input, textarea[data-notes]')?.focus(), 60);
  });
  // los paneles con temporizadores se actualizan cada segundo (el cronómetro, cada 100 ms)
  setInterval(() => { if (openWidget === 'timer' && S?.timers.stopwatch.running) renderPanel(); }, 100);
  setInterval(() => { if (openWidget && openWidget !== 'settings' && openWidget !== 'search') renderPanel(); }, 1000);
}
