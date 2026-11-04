// Nimbo - dock inteligente para Windows.
const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, Notification, nativeImage, dialog, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WinHelper, isWin } = require('./src/winhelper');
const { Store } = require('./src/store');
const services = require('./src/services');
const { createApps } = require('./src/apps');
const { createUpdater } = require('./src/updater');
const { createClaudeWatch } = require('./src/claudeWatch');
const VERSION = global.NIMBO?.version || VERSION;

// Si ya hay un Nimbo abierto, le pedimos que se cierre si es otra copia (p. ej. una versión vieja)
if (!app.requestSingleInstanceLock({ exe: process.execPath })) { app.quit(); process.exit(0); }
app.setAppUserModelId('xyz.nimbo.dock');

let logFile = null;
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (logFile) fs.appendFileSync(logFile, line); } catch {}
  if (!app.isPackaged) process.stdout.write(line);
}

const DOCK_H = 64;
const MARGIN = 10;

let store;
const helper = new WinHelper();       // ventanas, barra de tareas, sistema
const mediaHelper = new WinHelper();  // música, íconos y lista de apps (separado para no bloquear lo demás)
let dockWin = null;
let panelWin = null;
let previewWin = null;
let tray = null;
let panelWidget = null;
let panelAnchor = 0;
let quitting = false;
let dockWidth = 600;
let hiddenForFullscreen = false;

const live = {
  groups: [], stats: null, net: null, drives: null, recycle: null,
  music: null, weather: null, calendar: null, claudeCode: null, claudePlan: null, claudeSessions: [], stocks: null, anthropic: null, openai: null, github: null,
};
const timers = {
  pomodoro: { phase: 'work', running: false, endsAt: 0, remaining: 0, done: 0 },
  timer: { running: false, endsAt: 0, remaining: 0, total: 0 },
  stopwatch: { running: false, startedAt: 0, elapsed: 0 },
};

// ---------------------------------------------------------------- estilo / ventanas
function winBuild() { const [, , b] = os.release().split('.').map(Number); return b || 0; }
let remoteSession = false;   // conectado por escritorio remoto: sin transparencias
function effectiveStyle() {
  const s = store.settings.style;
  if (remoteSession && (s === 'acrylic' || s === 'glass')) return 'dark';
  if (s === 'acrylic' && !(isWin && winBuild() >= 22621)) return 'glass';
  return s;
}

function baseWindowOptions(extra, allowAcrylic = true) {
  const style = effectiveStyle();
  const acrylic = allowAcrylic && style === 'acrylic';
  return {
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: acrylic,
    transparent: !acrylic,
    backgroundColor: '#00000000',
    ...(acrylic ? { backgroundMaterial: 'acrylic' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    ...extra,
  };
}

function primaryBounds() { return screen.getPrimaryDisplay().bounds; }

function dockBounds() {
  const b = primaryBounds();
  const w = Math.min(dockWidth, b.width - 2 * MARGIN);
  return { x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - DOCK_H - MARGIN, width: Math.round(w), height: DOCK_H };
}

function createWindows() {
  const style = effectiveStyle();
  dockWin = new BrowserWindow(baseWindowOptions({ ...dockBounds(), focusable: true }));
  dockWin.setAlwaysOnTop(true, 'screen-saver');
  dockWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { view: 'dock', style } });
  dockWin.once('ready-to-show', () => {
    dockWin.showInactive();
    setTimeout(updateAppBar, 300);
    if (style === 'acrylic') roundCorners(dockWin);
  });
  const thisDock = dockWin;
  dockWin.on('closed', () => {
    if (dockWin !== thisDock) return;
    dockWin = null;
    if (!quitting) { log('la ventana del dock se cerró: se vuelve a crear'); setTimeout(() => { if (!dockWin && !quitting) { try { panelWin?.destroy(); } catch {} createWindows(); } }, 500); }
  });
  dockWin.webContents.on('render-process-gone', (_e, d) => { log('dock caído', d); if (!quitting) dockWin.reload(); });

  createPanelWindow();
  createPreviewWindow();
  log('ventanas creadas, estilo', style, 'pantalla', primaryBounds(), 'escala', screen.getPrimaryDisplay().scaleFactor);
}

// El panel usa vidrio por CSS (ventana transparente), no acrílico: es lo más fiable en Windows.
function createPanelWindow() {
  const style = effectiveStyle();
  const win = new BrowserWindow(baseWindowOptions({ width: 360, height: 420, x: 0, y: 0 }, false));
  panelWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { view: 'panel', style: style === 'acrylic' ? 'glass' : style } });
  win.webContents.on('did-finish-load', () => { panelReady = true; log('panel cargado'); });
  win.webContents.on('render-process-gone', (_e, d) => log('panel: proceso caído', d));
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log('panel consola:', e.message); });
  win.on('blur', () => setTimeout(() => {
    if (panelWin === win && !win.isDestroyed() && !win.isFocused()) { log('panel perdió el foco'); hidePanel(); }
  }, 150));
  win.on('closed', () => { if (panelWin === win) panelWin = null; });
}
let panelReady = false;

function roundCorners(win) {
  const buf = win.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? Number(buf.readBigInt64LE(0)) : buf.readInt32LE(0);
  helper.safe('round', { hwnd });
}

function recreateWindows() {
  hidePanel();
  if (isWin) helper.safe('appbarRemove');
  hidePreview();
  for (const w of [dockWin, panelWin, previewWin]) if (w && !w.isDestroyed()) w.destroy();
  panelReady = false;
  createWindows();
}

let lastHidden = { widget: null, at: 0 };
function hidePanel() {
  if (panelWin && panelWin.isVisible()) panelWin.hide();
  if (panelWidget) lastHidden = { widget: panelWidget, at: Date.now() };
  panelWidget = null;
  send('panel:closed', null, dockWin);
}

function positionPanel(width, height) {
  const b = primaryBounds();
  const d = dockBounds();
  const h = Math.min(height, d.y - b.y - 2 * MARGIN);
  let x = Math.round(panelAnchor - width / 2);
  x = Math.max(b.x + MARGIN, Math.min(x, b.x + b.width - width - MARGIN));
  const bounds = { x, y: d.y - h - MARGIN, width, height: Math.round(h) };
  panelWin.setBounds(bounds);
  return bounds;
}

// ---------------------------------------------------------------- estado hacia la interfaz
function snapshot() {
  return {
    platform: process.platform,
    settings: store.settings,
    data: store.data,
    secrets: store.secretStatus(),
    live, timers,
    now: Date.now(),
    version: VERSION,
    dockMax: primaryBounds().width - 2 * MARGIN,
    remote: remoteSession,
    searchShortcut,
    update: updater ? updater.last : null,
  };
}
function send(channel, payload, only) {
  for (const w of only ? [only] : [dockWin, panelWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => { broadcastQueued = false; send('state', snapshot()); });
}
function enabled(id) { return store.settings.widgets.some((w) => w.id === id && w.enabled); }

// ---------------------------------------------------------------- apps
let apps = null; // se crea al arrancar
function sendIcons(patch) { for (const w of [dockWin, panelWin, previewWin]) if (w && !w.isDestroyed()) w.webContents.send('icons', patch); }

async function pollWindows() {
  if (!isWin) return;
  const r = await helper.safe('windows');
  if (!r) return;
  const ownPid = process.pid;
  live.groups = apps.setWindows((r.windows || []).filter((w) => w.pid !== ownPid));
  if (typeof r.remote === 'boolean' && r.remote !== remoteSession) {
    const before = effectiveStyle();
    remoteSession = r.remote;
    log(remoteSession ? 'escritorio remoto detectado: fondo sólido' : 'sesión local: estilo normal');
    if (effectiveStyle() !== before) setTimeout(recreateWindows, 50);
  }
  if (preview.key) updatePreview();
  // ocultar el dock si hay algo a pantalla completa
  const shouldHide = !!(store.settings.hideOnFullscreen && r.fullscreen && !(dockWin?.isFocused() || panelWin?.isFocused()));
  if (dockWin && shouldHide !== hiddenForFullscreen) {
    hiddenForFullscreen = shouldHide;
    log(shouldHide ? `ocultar dock: pantalla completa de ${r.fullscreen}` : 'mostrar dock de nuevo');
    if (shouldHide) { hidePanel(); dockWin.hide(); } else dockWin.showInactive();
  }
  // por si acaso: el dock nunca debe quedar oculto sin motivo
  if (dockWin && !hiddenForFullscreen && !dockWin.isVisible()) { log('el dock estaba oculto sin motivo: se muestra'); dockWin.showInactive(); }
  broadcast();
}

// ---------------------------------------------------------------- sistema
let lastCpu = os.cpus();
let lastNet = null;
function cpuPercent() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times || c.times;
    const d = Object.keys(c.times).reduce((s, k) => s + (c.times[k] - p[k]), 0);
    total += d; idle += c.times.idle - p.idle;
  });
  lastCpu = now;
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

async function pollSystem() {
  const mem = { total: os.totalmem(), free: os.freemem() };
  const cpu = cpuPercent();
  const hist = live.stats?.history || [];
  hist.push(cpu); if (hist.length > 40) hist.shift();
  live.stats = { cpu, mem, cores: os.cpus().length, model: os.cpus()[0]?.model || '', uptime: os.uptime(), history: hist };
  if (enabled('network') && isWin) {
    const n = await helper.safe('net');
    if (n) {
      const t = Date.now();
      if (lastNet) {
        const dt = (t - lastNet.t) / 1000;
        live.net = { down: Math.max(0, (n.rx - lastNet.rx) / dt), up: Math.max(0, (n.tx - lastNet.tx) / dt) };
      }
      lastNet = { ...n, t };
    }
  }
  broadcast();
}

async function pollSlowSystem() {
  if (!isWin) return;
  if (enabled('storage')) { const r = await helper.safe('drives'); if (r) live.drives = r.drives; }
  if (enabled('recycle')) live.recycle = await helper.safe('recycle');
  broadcast();
}

async function pollMusic() {
  if (!enabled('music') || !isWin) return;
  live.music = await mediaHelper.safe('nowPlaying', {}, live.music);
  broadcast();
}

// ---------------------------------------------------------------- servicios de internet
async function runService(key, fn) {
  try { live[key] = await fn(); } catch (e) { live[key] = { ...(live[key] || {}), error: e.message }; }
  broadcast();
}
const refreshers = {
  weather: () => runService('weather', () => services.weather(store.settings.location)),
  calendar: () => runService('calendar', () => services.calendar(store.settings.calendars)),
  claudeCode: () => { runService('claudeCode', () => services.claudeCode()); if (store.settings.claudePlan !== false) planTick(); },
  anthropic: () => runService('anthropic', () => services.anthropicCost(store.secret('anthropicAdminKey'))),
  openai: () => runService('openai', () => services.openaiCost(store.secret('openaiAdminKey'))),
  github: () => runService('github', () => services.github(store.settings.githubUser, store.secret('githubToken'))),
  stocks: () => runService('stocks', () => services.quotes(allSymbols())),
};
const intervals = { weather: 20, calendar: 5, claudeCode: 1, anthropic: 15, openai: 15, github: 10, stocks: 1 }; // minutos
const lastRun = {};
function tickServices(force) {
  const now = Date.now();
  for (const [k, fn] of Object.entries(refreshers)) {
    if (!enabled(k)) continue;
    if (force === k || force === true || !lastRun[k] || now - lastRun[k] > intervals[k] * 60e3) { lastRun[k] = now; fn(); }
  }
}

function allSymbols() { return [...new Set(store.settings.watchlists.flatMap((l) => l.symbols))]; }

// ---------------------------------------------------------------- Claude Code en vivo
let claudeWatch = null;
function setupClaudeWatch() {
  claudeWatch = createClaudeWatch({
    log,
    onChange: () => { live.claudeSessions = claudeWatch.list(); broadcast(); },
    onEvent: (e) => {
      log('claude:', e.kind, e.project);
      if (!store.settings.claudeNotify) return;
      const focusClaude = () => {
        const g = apps.groups.find((x) => x.windows.some((w) => w.title.includes(e.project))) ||
          apps.groups.find((x) => /claude|windowsterminal|code/i.test(x.exe || '') && x.windows.length);
        if (g) helper.safe('focus', { hwnd: g.windows[0].hwnd });
      };
      if (e.kind === 'done') notify(`Claude terminó · ${e.project}`, (e.text || 'Respuesta lista').slice(0, 180), focusClaude);
      if (e.kind === 'waiting') notify(`Claude te espera · ${e.project}`, `Está esperando para usar «${e.tool}». Puede que necesite tu aprobación.`, focusClaude);
    },
  });
  setInterval(() => { if (enabled('claudeCode')) { try { claudeWatch.tick(); } catch (err) { log('claude watch', err.message); } } }, 2000);
}

// ---------------------------------------------------------------- uso del plan de Claude (cada 2 minutos)
let lastPlanAt = 0;
async function planTick(force) {
  if (!force && Date.now() - lastPlanAt < 110e3) return;
  lastPlanAt = Date.now();
  const prev = live.claudePlan;
  try { live.claudePlan = await services.claudePlan(); } catch (e) { live.claudePlan = { ...(prev || {}), error: e.message }; log('uso del plan:', e.message); }
  const p = live.claudePlan?.limits?.find((l) => l.key === 'five_hour');
  const old = prev?.limits?.find((l) => l.key === 'five_hour');
  if (p) {
    for (const th of [80, 95]) {
      const k = `plan${th}:${p.resetsAt}`;
      if (p.pct >= th && !notified.has(k)) { notified.add(k); notify(`Claude: usaste el ${Math.round(p.pct)}% de tu límite`, `Se reinicia ${p.resetsAt ? 'a las ' + new Date(p.resetsAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'pronto'}.`); }
    }
    if (old && old.pct >= 50 && p.pct < old.pct - 30) notify('Claude: tu límite se reinició', 'Ya tienes tu sesión de 5 horas disponible de nuevo.');
  }
  broadcast();
}

// ---------------------------------------------------------------- alertas de bolsa
function stockAlerts() {
  const q = live.stocks?.quotes; if (!q || !enabled('stocks')) return;
  const day = new Date().toDateString();
  const th = Math.max(0.5, Number(store.settings.stockAlertPct) || 3);
  const moves = [];
  for (const sym of allSymbols()) {
    const x = q[sym]; if (!x || x.error || x.open === false) continue;
    const level = Math.floor(Math.abs(x.pct) / th);
    if (level >= 1) {
      const k = `mv:${day}:${sym}:${Math.sign(x.pct)}:${level}`;
      if (!notified.has(k)) { notified.add(k); moves.push(x); }
    }
  }
  const pctTxt = (x) => `${x.pct > 0 ? '+' : '−'}${Math.abs(x.pct).toFixed(1).replace('.', ',')}%`;
  if (moves.length === 1) {
    const x = moves[0];
    notify(`${x.symbol} ${x.pct > 0 ? '▲' : '▼'} ${pctTxt(x)} hoy`, `${x.name}: ${x.price.toFixed(2)} ${x.currency}`, () => openPanel('stocks', null));
  } else if (moves.length > 1) {
    // varias a la vez: un solo aviso con las que más se movieron
    moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    notify(`${moves.length} acciones se mueven más de ${th}%`, moves.slice(0, 6).map((x) => `${x.symbol} ${pctTxt(x)}`).join(' · ') + (moves.length > 6 ? ' …' : ''), () => openPanel('stocks', null));
  }
  const targets = store.settings.stockTargets || [];
  const hit = targets.filter((t) => { const x = q[t.symbol]; return x && !x.error && (t.op === '>' ? x.price >= t.price : x.price <= t.price); });
  if (hit.length) {
    for (const t of hit) notify(`${t.symbol} llegó a ${t.price}`, `${t.op === '>' ? 'Subió' : 'Bajó'} a ${q[t.symbol].price.toFixed(2)} ${q[t.symbol].currency}`);
    store.setSettings({ stockTargets: targets.filter((t) => !hit.includes(t)) });
    broadcast();
  }
}

// ---------------------------------------------------------------- automatizaciones
const notified = new Set();
const liveNotifications = new Set();
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  liveNotifications.add(n);                      // guardar referencia: si no, el clic se pierde
  n.on('close', () => liveNotifications.delete(n));
  n.on('click', () => { liveNotifications.delete(n); onClick?.(); });
  n.show();
}
let lastStockCheck = 0;
async function automations() {
  const now = Date.now();
  if (live.stocks?.at && live.stocks.at !== lastStockCheck) { lastStockCheck = live.stocks.at; stockAlerts(); }
  // Reuniones: aviso 5 min antes y pausa de la música 1 min antes
  for (const ev of live.calendar?.events || []) {
    if (ev.allDay) continue;
    const t = Date.parse(ev.start);
    const k5 = 'r5' + ev.start + ev.title;
    if (t - now <= 5 * 60e3 && t - now > 4 * 60e3 && !notified.has(k5)) { notified.add(k5); notify('Reunión en 5 minutos', ev.title); }
    const k1 = 'r1' + ev.start + ev.title;
    if (t - now <= 60e3 && t - now > 0 && !notified.has(k1)) {
      notified.add(k1);
      if (live.music?.playing) { await mediaHelper.safe('media', { action: 'pause' }); notify('Música en pausa', `Empieza: ${ev.title}`); }
    }
  }
  // Claude Code: aviso cuando el bloque de 5 h se reinicia
  const a = live.claudeCode?.active;
  if (a && a.resetsAt - now < 60e3 && a.resetsAt > now && !notified.has('cc' + a.start)) {
    notified.add('cc' + a.start); notify('Claude Code', 'Tu bloque de 5 horas se reinicia en un minuto');
  }
  // Temporizadores
  const p = timers.pomodoro;
  if (p.running && now >= p.endsAt) {
    const work = p.phase === 'work';
    if (work) p.done++;
    p.phase = work ? 'break' : 'work';
    const mins = p.phase === 'work' ? store.settings.pomodoroWork : store.settings.pomodoroBreak;
    p.endsAt = now + mins * 60e3;
    notify('Pomodoro', work ? `¡Buen trabajo! Descansa ${mins} min.` : 'Descanso terminado. ¡A concentrarse!');
    broadcast();
  }
  const t = timers.timer;
  if (t.running && now >= t.endsAt) { t.running = false; t.remaining = 0; notify('Temporizador', '¡Se acabó el tiempo!'); broadcast(); }
}

// ---------------------------------------------------------------- barra de tareas de Windows
async function applyTaskbar() {
  if (!isWin) return;
  await helper.safe('taskbar', { mode: store.settings.taskbar });
}

// ---------------------------------------------------------------- acciones desde la interfaz
const actions = {
  async launchItem({ key }) { hidePreview(); await apps.launch(apps.find(key)); },
  async pinApp({ id, name }) { await pinApp(id, name); },
  async launchApp({ id, name }) { log('buscador: abrir', name, id); hidePanel(); apps.launchAumid(id); },
  async searchWeb({ q }) { hidePanel(); await shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(q)); },
  async openSettingsUri({ uri }) { hidePanel(); if (/^ms-settings:/.test(uri)) await shell.openExternal(uri); },
  async winKeys({ keys }) { hidePanel(); await helper.safe('keys', { vks: keys }); },
  async appClick({ key }) {
    hidePreview();
    const it = apps.find(key); if (!it) return;
    if (!it.windows.length) return apps.launch(it);
    const active = it.windows.find((w) => w.active);
    if (active && it.windows.length === 1) return helper.safe('minimize', { hwnd: active.hwnd });
    const idx = active ? (it.windows.indexOf(active) + 1) % it.windows.length : 0;  // varias ventanas: pasar a la siguiente
    return helper.safe('focus', { hwnd: it.windows[idx].hwnd });
  },
  async focus({ hwnd }) { await helper.safe('focus', { hwnd }); },
  async minimize({ hwnd }) { await helper.safe('minimize', { hwnd }); },
  async closeWindow({ hwnd }) { await helper.safe('close', { hwnd }); setTimeout(pollWindows, 300); },
  async previewFocus({ hwnd }) { hidePreview(); await helper.safe('focus', { hwnd }); },
  async startMenu() { await helper.safe('startMenu'); },
  async appMenu({ key }) {
    hidePreview();
    const item = apps.find(key); if (!item) return;
    const tpl = [];
    for (const w of item.windows) tpl.push({ label: w.title.slice(0, 60), click: () => helper.safe('focus', { hwnd: w.hwnd }) });
    if (tpl.length) tpl.push({ type: 'separator' });
    tpl.push({ label: item.windows.length ? 'Abrir otra ventana' : 'Abrir', click: () => apps.launch(item) });
    if (item.windows.length) tpl.push({ label: item.windows.length > 1 ? 'Cerrar todas las ventanas' : 'Cerrar ventana', click: () => item.windows.forEach((w) => helper.safe('close', { hwnd: w.hwnd })) });
    tpl.push({ type: 'separator' });
    if (item.nimbo) tpl.push({ label: 'Desanclar de Nimbo', click: () => unpinApp(item.appId) });
    else if (!item.lnk) {
      const id = item.aumid || item.exe;
      if (id) tpl.push({ label: 'Anclar en Nimbo', click: () => pinApp(id, item.name) });
    } else tpl.push({ label: 'Anclada en Windows (se cambia desde el menú Inicio)', enabled: false });
    Menu.buildFromTemplate(tpl).popup({ window: dockWin });
  },
  async dockMenu() {
    Menu.buildFromTemplate([
      { label: 'Ajustes de Nimbo', click: () => openPanel('settings', null) },
      { label: 'Configuración de Windows', click: () => shell.openExternal('ms-settings:') },
      { label: 'Administrador de tareas', click: () => helper.safe('keys', { vks: [0x11, 0x10, 0x1B] }) },
      { label: 'Actualizar widgets', click: () => tickServices(true) },
      { label: 'Abrir registro de diagnóstico', click: () => actions.openLog() },
      { label: 'Buscar actualizaciones', click: () => actions.checkUpdates().then((r) => notify('Nimbo', r.message)) },
      { type: 'separator' },
      { label: 'Salir de Nimbo', click: () => quit() },
    ]).popup({ window: dockWin });
  },
  async media({ action }) { await mediaHelper.safe('media', { action }); setTimeout(pollMusic, 400); },
  async openPath({ p }) { await shell.openPath(p); },
  async openUrl({ url }) { if (/^https?:\/\//.test(url)) await shell.openExternal(url); },
  async openRecycle() { await shell.openExternal('shell:RecycleBinFolder').catch(() => shell.openPath('shell:RecycleBinFolder')); },
  async emptyRecycle() {
    const r = await dialog.showMessageBox(panelWin, { type: 'warning', buttons: ['Vaciar', 'Cancelar'], defaultId: 1, message: '¿Vaciar la papelera de reciclaje?' });
    if (r.response === 0) { await helper.safe('emptyRecycle'); pollSlowSystem(); }
  },
  async settings({ patch }) {
    const before = { ...store.settings };
    store.setSettings(patch);
    if (patch.taskbar && patch.taskbar !== before.taskbar) await applyTaskbar();
    if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin });
    if (patch.style && patch.style !== before.style) { setTimeout(recreateWindows, 50); return; }
    if (patch.calendars) tickServices('calendar');
    if (patch.githubUser !== undefined) tickServices('github');
    if (patch.watchlists) tickServices('stocks');
    if (patch.claudePlan) planTick(true);
    if ('reserveSpace' in patch) updateAppBar();
    if (patch.widgets) { tickServices(); pollSlowSystem(); pollMusic(); }
    broadcast();
  },
  async setCity({ city }) {
    if (!city.trim()) { store.setSettings({ city: '', location: null }); live.weather = null; broadcast(); return null; }
    const loc = await services.geocode(city);
    store.setSettings({ city, location: loc });
    tickServices('weather');
    return loc;
  },
  async secret({ name, value }) {
    store.setSecret(name, value.trim());
    const map = { anthropicAdminKey: 'anthropic', openaiAdminKey: 'openai', githubToken: 'github' };
    tickServices(map[name]);
    broadcast();
  },
  async data({ patch }) { store.setData(patch); broadcast(); },
  async refresh({ key }) { tickServices(key); },
  async pomodoro({ op }) {
    const p = timers.pomodoro; const now = Date.now();
    const mins = () => (p.phase === 'work' ? store.settings.pomodoroWork : store.settings.pomodoroBreak) * 60e3;
    if (op === 'start') { p.endsAt = now + (p.remaining || mins()); p.running = true; p.remaining = 0; }
    if (op === 'pause') { p.remaining = Math.max(0, p.endsAt - now); p.running = false; }
    if (op === 'reset') { Object.assign(p, { phase: 'work', running: false, endsAt: 0, remaining: 0 }); }
    if (op === 'skip') { p.phase = p.phase === 'work' ? 'break' : 'work'; p.remaining = 0; p.endsAt = now + mins(); }
    broadcast();
  },
  async timer({ op, minutes }) {
    const t = timers.timer; const now = Date.now();
    if (op === 'start') { const ms = minutes ? minutes * 60e3 : t.remaining; if (!ms) return; t.total = minutes ? ms : t.total; t.endsAt = now + ms; t.running = true; t.remaining = 0; }
    if (op === 'pause') { t.remaining = Math.max(0, t.endsAt - now); t.running = false; }
    if (op === 'reset') Object.assign(t, { running: false, endsAt: 0, remaining: 0, total: 0 });
    broadcast();
  },
  async stopwatch({ op }) {
    const s = timers.stopwatch; const now = Date.now();
    if (op === 'start') { s.startedAt = now; s.running = true; }
    if (op === 'pause') { s.elapsed += now - s.startedAt; s.running = false; }
    if (op === 'reset') Object.assign(s, { running: false, startedAt: 0, elapsed: 0 });
    broadcast();
  },
  async quit() { quit(); },
  async checkUpdates() { const r = await updater.check({ manual: true }); broadcast(); return r; },
  async openLog() { if (logFile) await shell.openPath(logFile); },
};

function openPanel(widget, anchorX, retry = 0) {
  log('abrir panel', widget, 'x', anchorX, 'existe', !!panelWin, 'cargado', panelReady);
  if (!panelWin || panelWin.isDestroyed()) createPanelWindow();
  if (panelWidget === widget && panelWin.isVisible()) { hidePanel(); return; }
  // el clic en el mismo icono ya cerró el panel al quitarle el foco: no reabrirlo
  if (!retry && lastHidden.widget === widget && Date.now() - lastHidden.at < 350) return;
  panelWidget = widget;
  hidePreview();
  if (refreshers[widget] && Date.now() - (lastRun[widget] || 0) > 60e3) tickServices(widget);  // datos frescos al abrir
  const d = dockBounds();
  panelAnchor = anchorX ?? d.x + d.width / 2;
  const go = () => {
    send('panel:show', widget, panelWin);
    send('panel:opened', widget, dockWin);
    setTimeout(() => {
      if (!panelWin || panelWidget !== widget || panelWin.isVisible()) return;
      log('el panel no avisó su tamaño; se muestra con tamaño por defecto');
      showPanel(lastPanelSize.width, lastPanelSize.height);
    }, 300);
    setTimeout(() => {
      if (panelWidget !== widget) return;
      const ok = panelWin && !panelWin.isDestroyed() && panelWin.isVisible();
      log('panel visible:', ok, ok ? panelWin.getBounds() : '');
      if (!ok && retry < 1) {
        log('re-creando la ventana del panel');
        try { panelWin?.destroy(); } catch {}
        panelReady = false; panelWidget = null;
        createPanelWindow();
        panelWin.webContents.once('did-finish-load', () => openPanel(widget, anchorX, retry + 1));
      }
    }, 900);
  };
  if (panelReady) go(); else panelWin.webContents.once('did-finish-load', go);
}

function showPanel(width, height) {
  const b = positionPanel(width, height);
  panelWin.show();
  panelWin.moveTop();
  panelWin.focus();
  log('mostrar panel', b);
}
let lastPanelSize = { width: 360, height: 560 };

// ---------------------------------------------------------------- IPC
ipcMain.handle('state', () => snapshot());
ipcMain.handle('action', async (_e, name, args) => {
  const fn = actions[name];
  if (!fn) throw new Error('acción desconocida ' + name);
  return fn(args || {});
});
ipcMain.on('dock:size', (_e, width) => {
  dockWidth = Math.max(200, Math.ceil(width));
  if (dockWin) dockWin.setBounds(dockBounds());
});
ipcMain.on('panel:open', (_e, widget, screenX) => openPanel(widget, screenX));
ipcMain.on('log', (_e, ...a) => log('ui:', ...a));
ipcMain.handle('icons', () => apps.icons);
ipcMain.on('icons:need', (_e, keys) => apps.needIcons(keys));
ipcMain.handle('apps:list', () => apps.list());
ipcMain.on('preview:show', (_e, key, x) => showPreview(key, x));
ipcMain.on('preview:leave', () => schedulePreviewHide());
ipcMain.on('preview:hover', (_e, inside) => { preview.inside = inside; if (inside) clearTimeout(preview.hideTimer); else schedulePreviewHide(); });
ipcMain.on('preview:size', (_e, { width, height }) => placePreview(width, height));
ipcMain.on('panel:close', () => hidePanel());
ipcMain.on('panel:size', (_e, { width, height }) => {
  if (!panelWin || !panelWidget) return;
  lastPanelSize = { width: Math.ceil(width) || 360, height: Math.ceil(height) || 560 };
  if (panelWin.isVisible()) positionPanel(lastPanelSize.width, lastPanelSize.height);
  else showPanel(lastPanelSize.width, lastPanelSize.height);
});

// ---------------------------------------------------------------- reservar espacio en la pantalla (como la barra de tareas)
async function updateAppBar() {
  if (!isWin || !dockWin || dockWin.isDestroyed()) return;
  if (store.settings.reserveSpace === false) { await helper.safe('appbarRemove'); return; }
  const b = primaryBounds();
  const h = DOCK_H + 2 * MARGIN;
  const phys = screen.dipToScreenRect(dockWin, { x: b.x, y: b.y + b.height - h, width: b.width, height: h });
  const buf = dockWin.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? Number(buf.readBigInt64LE(0)) : buf.readInt32LE(0);
  const r = await helper.safe('appbar', { hwnd, left: phys.x, top: phys.y, right: phys.x + phys.width, bottom: phys.y + phys.height });
  if (r) log('espacio reservado para el dock', r.rect);
}

// ---------------------------------------------------------------- anclar apps en Nimbo
async function pinApp(id, name) {
  if (!id || store.settings.pins.some((p) => p.id === id)) return;
  store.setSettings({ pins: [...store.settings.pins, { id, name }] });
  await apps.loadPinned(store.settings.pins);
  pollWindows();
}
async function unpinApp(id) {
  store.setSettings({ pins: store.settings.pins.filter((p) => p.id !== id) });
  await apps.loadPinned(store.settings.pins);
  pollWindows();
}

// ---------------------------------------------------------------- vistas previas de ventanas (al pasar el mouse)
const preview = { key: null, anchor: 0, inside: false, hideTimer: null, thumbs: {}, capturing: false, refresh: null };

function createPreviewWindow() {
  previewWin = new BrowserWindow(baseWindowOptions({ width: 300, height: 200, x: 0, y: 0, focusable: false }, false));
  previewWin.setAlwaysOnTop(true, 'screen-saver');
  const style = effectiveStyle();
  previewWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { view: 'preview', style: style === 'acrylic' ? 'glass' : style } });
  previewWin.on('closed', () => { previewWin = null; });
}

function previewData() {
  const g = apps.find(preview.key);
  if (!g || !g.windows.length) return null;
  return { key: g.key, name: g.name, iconKey: g.iconKey, windows: g.windows, thumbs: preview.thumbs };
}

function showPreview(key, anchorX) {
  if (!previewWin || previewWin.isDestroyed()) createPreviewWindow();
  clearTimeout(preview.hideTimer);
  if (panelWidget) return;                  // con un panel abierto no mostramos vistas previas
  const changed = preview.key !== key;
  preview.key = key; preview.anchor = anchorX;
  if (changed) preview.thumbs = {};
  if (!updatePreview()) return;
  captureThumbs();
  clearInterval(preview.refresh);
  preview.refresh = setInterval(captureThumbs, 2000);
}

function updatePreview() {
  const data = previewData();
  if (!data) { hidePreview(); return false; }
  previewWin.webContents.send('preview:data', data);
  return true;
}

function placePreview(width, height) {
  if (!previewWin || !preview.key) return;
  const b = primaryBounds();
  const d = dockBounds();
  const w = Math.min(Math.ceil(width), b.width - 2 * MARGIN);
  let x = Math.round(preview.anchor - w / 2);
  x = Math.max(b.x + MARGIN, Math.min(x, b.x + b.width - w - MARGIN));
  previewWin.setBounds({ x, y: d.y - Math.ceil(height) - 8, width: w, height: Math.ceil(height) });
  if (!previewWin.isVisible()) previewWin.showInactive();
}

async function captureThumbs() {
  if (!preview.key || preview.capturing || !isWin) return;
  preview.capturing = true;
  try {
    const g = apps.find(preview.key);
    if (!g) return;
    const wanted = new Set(g.windows.filter((w) => !w.minimized).map((w) => String(w.hwnd)));
    if (!wanted.size) return;
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 440, height: 260 }, fetchWindowIcons: false });
    for (const s of sources) {
      const hwnd = s.id.split(':')[1];
      if (wanted.has(hwnd) && !s.thumbnail.isEmpty()) preview.thumbs[hwnd] = s.thumbnail.toDataURL();
    }
    if (preview.key === g.key && previewWin && !previewWin.isDestroyed()) previewWin.webContents.send('preview:thumbs', preview.thumbs);
  } catch (e) { log('vista previa falló', e.message); }
  finally { preview.capturing = false; }
}

function schedulePreviewHide() {
  clearTimeout(preview.hideTimer);
  preview.hideTimer = setTimeout(() => { if (!preview.inside) hidePreview(); }, 350);
}
function hidePreview() {
  clearTimeout(preview.hideTimer); clearInterval(preview.refresh);
  preview.key = null; preview.inside = false;
  if (previewWin && !previewWin.isDestroyed() && previewWin.isVisible()) previewWin.hide();
  send('preview:closed', null, dockWin);
}

// ---------------------------------------------------------------- atajo del buscador (Alt + Espacio)
function registerShortcut() {
  for (const acc of ['Alt+Space', 'Control+Alt+Space']) {
    try {
      if (globalShortcut.register(acc, () => openPanel('search', null))) { searchShortcut = acc; log('atajo del buscador:', acc); return; }
    } catch {}
  }
  log('no se pudo registrar el atajo del buscador');
}
let searchShortcut = '';

// ---------------------------------------------------------------- actualizaciones automáticas
let updater = null;
let pendingRelaunch = false;
function setupUpdater() {
  updater = createUpdater({
    log, currentVersion: VERSION,
    getUrl: () => process.env.NIMBO_UPDATE_URL || store.settings.updateUrl,
    onUpdated: (upd, manual) => {
      broadcast();
      notify('Nimbo se actualizó', `Versión ${upd.version}${upd.notes ? ': ' + upd.notes : ''}. Se reinicia en unos segundos.`);
      pendingRelaunch = true;
      setTimeout(tryRelaunch, manual ? 1500 : 8000);
    },
  });
  setTimeout(() => store.settings.autoUpdate !== false && updater.check(), 20e3);
  setInterval(() => store.settings.autoUpdate !== false && updater.check(), 60 * 60e3);   // pregunta mínima: unos bytes
  setTimeout(() => global.NIMBO?.markHealthy?.(), 15e3);   // arrancó bien
  if (global.NIMBO?.rolledBack) setTimeout(() => notify('Nimbo', `La versión ${global.NIMBO.rolledBack} no arrancó bien; se volvió a la anterior.`), 3000);
}
function tryRelaunch() {
  if (!pendingRelaunch) return;
  if (panelWidget) { setTimeout(tryRelaunch, 5000); return; }  // esperar a que cierres el panel
  log('reiniciando para aplicar la actualización');
  app.relaunch();
  quit();
}

// ---------------------------------------------------------------- arranque / cierre
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Nimbo');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ajustes', click: () => openPanel('settings', null) },
    { label: 'Mostrar barra de tareas de Windows', click: () => actions.settings({ patch: { taskbar: 'none' } }) },
    { label: 'Abrir registro de diagnóstico', click: () => actions.openLog() },
    { type: 'separator' },
    { label: 'Salir', click: () => quit() },
  ]));
}

let cleaned = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  try { globalShortcut.unregisterAll(); } catch {}
  if (isWin) await helper.safe('appbarRemove');
  if (isWin) await helper.safe('taskbar', { mode: 'none' });
  helper.stop(); mediaHelper.stop();
  cleaned = true;
  app.quit();
}

app.on('second-instance', (_e, _argv, _cwd, data) => {
  if (data?.exe && path.resolve(data.exe).toLowerCase() !== path.resolve(process.execPath).toLowerCase()) {
    log('se abrió otra copia de Nimbo; me cierro y la abro a ella', data.exe);
    app.relaunch({ execPath: data.exe, args: [] });
    quit();
    return;
  }
  log('se abrió Nimbo.exe otra vez: mostrar el dock');
  hiddenForFullscreen = false;
  if (dockWin) { dockWin.showInactive(); dockWin.setBounds(dockBounds()); } else createWindows();
});
app.on('before-quit', (e) => { if (!cleaned) { e.preventDefault(); quit(); } });
app.on('window-all-closed', () => { /* seguir en la bandeja */ });
app.on('render-process-gone', (_e, wc, d) => log('una ventana se cayó', d));
app.on('child-process-gone', (_e, d) => log('un proceso interno se cayó', d));
process.on('uncaughtException', (e) => log('error no controlado', e.stack || String(e)));
process.on('unhandledRejection', (e) => log('promesa rechazada', String(e?.stack || e)));
process.on('exit', (c) => log('Nimbo terminó, código', c));

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'nimbo.log');
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(logFile, ''); } catch {}
  log('Nimbo', VERSION, 'Windows', os.release(), 'exe', process.execPath);
  store = new Store();
  apps = createApps({ helper, slow: mediaHelper, log, onIcons: sendIcons, isWin });
  if (store.settings.style === 'glass' && !fs.existsSync(store.file) && isWin && winBuild() >= 22621) store.setSettings({ style: 'acrylic' });
  if (isWin) { helper.start(); mediaHelper.start(); }
  createWindows();
  createTray();
  screen.on('display-metrics-changed', () => { if (dockWin) dockWin.setBounds(dockBounds()); setTimeout(updateAppBar, 500); broadcast(); });
  setInterval(updateAppBar, 120e3);   // por si el Explorador de Windows se reinicia
  screen.on('display-added', () => { if (dockWin) dockWin.setBounds(dockBounds()); });
  screen.on('display-removed', () => { if (dockWin) dockWin.setBounds(dockBounds()); });

  await applyTaskbar();
  await apps.loadPinned(store.settings.pins);
  setInterval(() => apps.loadPinned(store.settings.pins), 60e3);
  setTimeout(async () => {
    await apps.list();                          // precargar la lista del buscador
    // WhatsApp de la Microsoft Store no aparece entre las ancladas de Windows: anclarla en Nimbo una vez
    if (!store.settings.whatsappPinned) {
      const wa = await apps.findApp(/^whatsapp/i);
      if (wa) { await pinApp(wa.id, wa.name); log('WhatsApp anclada en Nimbo', wa.id); }
      store.setSettings({ whatsappPinned: true });
    }
  }, 8000);
  registerShortcut();
  setupUpdater();
  setupClaudeWatch();
  setInterval(pollWindows, 1200);
  setInterval(pollSystem, 2000);
  setInterval(pollSlowSystem, 60e3);
  setInterval(pollMusic, 2000);
  setInterval(() => tickServices(), 30e3);
  setInterval(automations, 1000);
  pollWindows(); pollSystem(); pollSlowSystem(); pollMusic(); tickServices(true);
});

// ---------------------------------------------------------------- autoprueba (solo desarrollo)
if (process.env.NIMBO_SELFTEST) {
  app.whenReady().then(() => {
    setTimeout(() => openPanel(process.env.NIMBO_SELFTEST, null), 3000);
    setTimeout(() => {
      console.log('SELFTEST panel visible:', panelWin?.isVisible(), JSON.stringify(panelWin?.getBounds()));
      quit();
    }, 6000);
  });
}
