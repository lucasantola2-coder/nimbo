// Definición de los widgets: cómo se ven en el dock (tile) y en su panel desplegable (panel).
/* global icon */

// Íconos de las apps (los manda el proceso principal; clave -> data URL)
const ICONS = {};
const iconImg = (key, size = 28) => (ICONS[key] ? `<img src="${ICONS[key]}" alt="" width="${size}" height="${size}">` : icon('app', size - 4));

// Teclas virtuales de Windows
const VK = { WIN: 0x5B, A: 0x41, N: 0x4E, D: 0x44, TAB: 0x09, E: 0x45, L: 0x4C, CTRL: 0x11, SHIFT: 0x10, ESC: 0x1B };

// ------------------------------------------------------------------ utilidades
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (o) => esc(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtTime(d, h24 = true) {
  if (h24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'a. m.' : 'p. m.'}`;
}
function fmtClock(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}
function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n || 0);
}
function fmtBytes(n, perSec) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; n = n || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}${perSec ? '/s' : ''}`;
}
const fmtUSD = (n) => '$' + (n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function dayLabel(d, now) {
  if (sameDay(d, now)) return 'Hoy';
  if (sameDay(d, new Date(now.getTime() + 864e5))) return 'Mañana';
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

function ring(pct, size = 34, stroke = 3.5, cls = '') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
function bar(pct, cls = '') { return `<div class="bar ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%"></i></div>`; }
function bars(values, h = 48, cls = '') {
  const max = Math.max(1, ...values);
  return `<div class="bars ${cls}" style="height:${h}px">${values.map((v) => `<i style="height:${Math.max(2, Math.round((v / max) * h))}px" title="${v}"></i>`).join('')}</div>`;
}
function spark(values, w = 300, h = 60) {
  if (!values?.length) return '';
  const max = Math.max(100, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`);
  return `<svg class="spark" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="M0,${h} L${pts.join(' L')} L${w},${h} Z" class="spark-fill"/><path d="M${pts.join(' L')}" class="spark-line"/></svg>`;
}
const head = (title, extra = '') => `<div class="phead"><h2>${title}</h2>${extra}</div>`;
const btn = (act, args, content, cls = '', title = '') => `<button class="btn ${cls}" data-act="${act}" data-args="${attr(args || {})}" title="${esc(title)}">${content}</button>`;
const refreshBtn = (key) => btn('refresh', { key }, icon('refresh', 15), 'ghost icon-only', 'Actualizar');
const errorBox = (msg) => (msg ? `<div class="err">${esc(msg)}</div>` : '');
const empty = (msg) => `<div class="empty">${msg}</div>`;

// ------------------------------------------------------------------ clima
const WMO = {
  0: ['Despejado', 'sun'], 1: ['Mayormente despejado', 'cloudSun'], 2: ['Parcialmente nublado', 'cloudSun'], 3: ['Nublado', 'cloud'],
  45: ['Niebla', 'fog'], 48: ['Niebla con escarcha', 'fog'], 51: ['Llovizna ligera', 'rain'], 53: ['Llovizna', 'rain'], 55: ['Llovizna intensa', 'rain'],
  56: ['Llovizna helada', 'rain'], 57: ['Llovizna helada', 'rain'], 61: ['Lluvia ligera', 'rain'], 63: ['Lluvia', 'rain'], 65: ['Lluvia fuerte', 'rain'],
  66: ['Lluvia helada', 'rain'], 67: ['Lluvia helada', 'rain'], 71: ['Nevada ligera', 'snow'], 73: ['Nieve', 'snow'], 75: ['Nevada fuerte', 'snow'], 77: ['Granizo fino', 'snow'],
  80: ['Chubascos', 'rain'], 81: ['Chubascos', 'rain'], 82: ['Chubascos fuertes', 'rain'], 85: ['Chubascos de nieve', 'snow'], 86: ['Chubascos de nieve', 'snow'],
  95: ['Tormenta', 'storm'], 96: ['Tormenta con granizo', 'storm'], 99: ['Tormenta con granizo', 'storm'],
};
function wx(code, day = true) {
  const [label, ic] = WMO[code] || ['—', 'cloud'];
  return { label, icon: !day && (ic === 'sun' || ic === 'cloudSun') ? 'moon' : ic };
}

// ------------------------------------------------------------------ widgets
const WIDGET_DEFS = {
  start: {
    name: 'Inicio', desc: 'Abre el menú Inicio de Windows',
    tile: () => `<button class="tile tile-icon" data-act="startMenu" title="Inicio">${icon('start', 22)}</button>`,
  },

  search: {
    name: 'Buscar', desc: 'Busca apps y ajustes de Windows (Alt + Espacio)', width: 460, keepWhileTyping: true, noAutoRender: true,
    tile: () => `<button class="tile tile-search" data-panel="search">${icon('search', 17)}<span>Buscar</span></button>`,
    panel: ({ s }) => `<div class="search-box">${icon('search', 18)}<input data-search placeholder="Busca apps, ajustes o en la web" autocomplete="off" spellcheck="false"></div>
      <div class="results" data-results></div>
      <div class="search-foot muted small"><span>↑ ↓ para moverte · Enter para abrir</span><span>${s.searchShortcut ? esc(s.searchShortcut.replace('Control', 'Ctrl').replace('Space', 'Espacio')) : ''}</span></div>`,
  },

  taskview: {
    name: 'Vista de tareas', desc: 'Todas tus ventanas y escritorios (Win + Tab)',
    tile: () => `<button class="tile tile-icon" data-act="winKeys" data-args="${attr({ keys: [VK.WIN, VK.TAB] })}" title="Vista de tareas">${icon('taskview')}</button>`,
  },

  apps: {
    name: 'Apps', desc: 'Apps ancladas a la barra de tareas y ventanas abiertas',
    tile: ({ s }) => {
      const items = s.live.groups || [];
      if (!items.length) return `<div class="tile apps-empty">${s.platform === 'win32' ? 'Cargando apps…' : 'Apps (solo en Windows)'}</div>`;
      return `<div class="apps">${items.map((it) => {
        const active = it.windows.some((w) => w.active);
        return `<button class="app ${active ? 'active' : ''} ${it.windows.length ? 'running' : ''}" data-key="${esc(it.key)}" aria-label="${esc(it.name)}">${iconImg(it.iconKey)}${it.windows.length ? `<span class="dot ${it.windows.length > 1 ? 'multi' : ''}"></span>` : ''}</button>`;
      }).join('')}</div>`;
    },
  },

  system: {
    name: 'Configuración rápida', desc: 'Wi-Fi, volumen, Bluetooth (Win + A) y notificaciones (Win + N)',
    tile: () => `<button class="tile tile-sys" data-act="winKeys" data-args="${attr({ keys: [VK.WIN, VK.A] })}" title="Configuración rápida">${icon('wifi', 17)}${icon('volume', 17)}</button>
      <button class="tile tile-icon narrow" data-act="winKeys" data-args="${attr({ keys: [VK.WIN, VK.N] })}" title="Notificaciones">${icon('bell', 17)}</button>`,
  },

  desktop: {
    name: 'Mostrar escritorio', desc: 'Minimiza todo (Win + D)',
    tile: () => `<button class="tile tile-desktop" data-act="winKeys" data-args="${attr({ keys: [VK.WIN, VK.D] })}" title="Mostrar escritorio"></button>`,
  },

  clock: {
    name: 'Reloj', desc: 'Hora, fecha y calendario del mes', width: 320,
    tile: ({ now, s }) => `<button class="tile tile-clock" data-panel="clock"><b>${fmtTime(now, s.settings.use24h)}</b><small>${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)}</small></button>`,
    panel: ({ now, s }) => {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const startDow = (first.getDay() + 6) % 7; // lunes primero
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const evDays = new Set((s.live.calendar?.events || []).map((e) => new Date(e.start).toDateString()));
      let cells = '';
      for (let i = 0; i < startDow; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        cells += `<span class="${d === now.getDate() ? 'today' : ''} ${evDays.has(date.toDateString()) ? 'has-ev' : ''}">${d}</span>`;
      }
      return `<div class="bigclock">${fmtTime(now, s.settings.use24h)}<small>:${pad(now.getSeconds())}</small></div>
        <div class="muted center cap">${DAYS_LONG[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}</div>
        <div class="month"><div class="month-title cap">${MONTHS[now.getMonth()]}</div>
        <div class="grid7 dow">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="grid7">${cells}</div></div>`;
    },
  },

  calendar: {
    name: 'Calendario', desc: 'Próximos eventos (Google, Outlook, iCloud vía iCal)', width: 360,
    tile: ({ s, now }) => {
      const next = nextEvent(s, now);
      if (!next) return `<button class="tile tile-icon" data-panel="calendar" title="Calendario">${icon('calendar')}</button>`;
      const st = new Date(next.start);
      const soon = st - now < 15 * 60e3 && st > now;
      const when = next.allDay ? (sameDay(st, now) ? 'Hoy' : DAYS[st.getDay()]) : st <= now ? 'Ahora' : sameDay(st, now) ? fmtTime(st, s.settings.use24h) : `${DAYS[st.getDay()]} ${fmtTime(st, s.settings.use24h)}`;
      return `<button class="tile tile-text ${soon ? 'urgent' : ''}" data-panel="calendar">${icon('calendar', 18)}<span><b>${esc(when)}</b><small class="ellipsis">${esc(next.title)}</small></span></button>`;
    },
    panel: ({ s, now }) => {
      const c = s.live.calendar;
      const evs = (c?.events || []).filter((e) => new Date(e.end) >= now);
      let html = head('Agenda', refreshBtn('calendar')) + errorBox(c?.error);
      if (!evs.length) return html + empty(s.settings.calendars.length ? 'No hay eventos en los próximos 14 días' : 'Añade tu calendario en Ajustes → Calendario');
      let lastDay = '';
      html += '<div class="agenda">';
      for (const e of evs.slice(0, 40)) {
        const st = new Date(e.start), en = new Date(e.end);
        const dk = st.toDateString();
        if (dk !== lastDay) { html += `<div class="agenda-day cap">${dayLabel(st, now)}</div>`; lastDay = dk; }
        const live = st <= now && en > now;
        html += `<div class="ev ${live ? 'live' : ''}"><span class="ev-time">${e.allDay ? 'Todo el día' : `${fmtTime(st, s.settings.use24h)}<br><small>${fmtTime(en, s.settings.use24h)}</small>`}</span>
          <span class="ev-body"><b>${esc(e.title)}</b>${e.location ? `<small class="ellipsis">${esc(e.location)}</small>` : ''}</span></div>`;
      }
      return html + '</div>';
    },
  },

  todos: {
    name: 'Tareas', desc: 'Lista de pendientes', width: 340, keepWhileTyping: true,
    tile: ({ s }) => {
      const n = s.data.todos.filter((t) => !t.done).length;
      return `<button class="tile tile-icon" data-panel="todos" title="Tareas">${icon('check')}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
    },
    panel: ({ s }) => {
      const todos = s.data.todos;
      const left = todos.filter((t) => !t.done).length;
      return head('Tareas', `<span class="muted">${left} pendiente${left === 1 ? '' : 's'}</span>`) +
        `<form class="row add" data-form="addTodo"><input name="text" placeholder="Nueva tarea…" autocomplete="off" maxlength="200"><button class="btn" type="submit">${icon('plus', 16)}</button></form>
        <div class="todos">${todos.map((t) => `<div class="todo ${t.done ? 'done' : ''}">
          <label><input type="checkbox" data-todo-toggle="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>
          <button class="btn ghost icon-only" data-todo-del="${t.id}" title="Borrar">${icon('x', 14)}</button></div>`).join('') || empty('Nada pendiente. 🎉')}</div>
        ${todos.some((t) => t.done) ? `<button class="btn ghost small" data-todo-clear>Borrar completadas</button>` : ''}`;
    },
  },

  notes: {
    name: 'Notas', desc: 'Un bloc de notas rápido', width: 360, keepWhileTyping: true,
    tile: () => `<button class="tile tile-icon" data-panel="notes" title="Notas">${icon('note')}</button>`,
    panel: ({ s }) => head('Notas', '<span class="muted">Se guarda solo</span>') + `<textarea class="notes" data-notes placeholder="Escribe algo…">${esc(s.data.notes)}</textarea>`,
  },

  pomodoro: {
    name: 'Pomodoro', desc: 'Bloques de concentración y descanso', width: 300,
    tile: ({ s, now }) => {
      const p = s.timers.pomodoro;
      const total = (p.phase === 'work' ? s.settings.pomodoroWork : s.settings.pomodoroBreak) * 60e3;
      const left = p.running ? p.endsAt - now : p.remaining || total;
      const active = p.running || p.remaining;
      return `<button class="tile tile-ring ${p.phase}" data-panel="pomodoro" title="Pomodoro">${ring(active ? left / total : 1, 34, 3.5, p.phase)}${active ? `<span>${fmtClock(left)}</span>` : `<i class="ring-ic">${icon('tomato', 16)}</i>`}</button>`;
    },
    panel: ({ s, now }) => {
      const p = s.timers.pomodoro;
      const total = (p.phase === 'work' ? s.settings.pomodoroWork : s.settings.pomodoroBreak) * 60e3;
      const left = p.running ? p.endsAt - now : p.remaining || total;
      return head(p.phase === 'work' ? 'Concentración' : 'Descanso', `<span class="muted">${p.done} completado${p.done === 1 ? '' : 's'} hoy</span>`) +
        `<div class="bigring ${p.phase}">${ring(left / total, 180, 9, p.phase)}<b>${fmtClock(left)}</b></div>
        <div class="row center gap">
          ${p.running ? btn('pomodoro', { op: 'pause' }, icon('pause', 16) + ' Pausa', 'primary') : btn('pomodoro', { op: 'start' }, icon('play', 16) + (p.remaining ? ' Seguir' : ' Empezar'), 'primary')}
          ${btn('pomodoro', { op: 'skip' }, icon('next', 16), 'icon-only', 'Saltar fase')}
          ${btn('pomodoro', { op: 'reset' }, icon('refresh', 16), 'icon-only', 'Reiniciar')}
        </div>`;
    },
  },

  timer: {
    name: 'Temporizador', desc: 'Cuenta atrás y cronómetro', width: 320,
    tile: ({ s, now }) => {
      const t = s.timers.timer, w = s.timers.stopwatch;
      if (t.running || t.remaining) {
        const left = t.running ? t.endsAt - now : t.remaining;
        return `<button class="tile tile-ring" data-panel="timer">${ring(left / (t.total || 1))}<span>${fmtClock(left)}</span></button>`;
      }
      if (w.running || w.elapsed) {
        const el = w.elapsed + (w.running ? now - w.startedAt : 0);
        return `<button class="tile tile-text" data-panel="timer">${icon('timer', 18)}<span><b class="mono">${fmtClock(el)}</b></span></button>`;
      }
      return `<button class="tile tile-icon" data-panel="timer" title="Temporizador">${icon('timer')}</button>`;
    },
    panel: ({ s, now }) => {
      const t = s.timers.timer, w = s.timers.stopwatch;
      const left = t.running ? t.endsAt - now : t.remaining;
      const el = w.elapsed + (w.running ? now - w.startedAt : 0);
      const presets = [1, 3, 5, 10, 15, 25, 45, 60];
      return head('Temporizador') +
        (t.running || t.remaining
          ? `<div class="bigring">${ring(left / (t.total || 1), 150, 8)}<b>${fmtClock(left)}</b></div>
             <div class="row center gap">${t.running ? btn('timer', { op: 'pause' }, icon('pause', 16) + ' Pausa', 'primary') : btn('timer', { op: 'start' }, icon('play', 16) + ' Seguir', 'primary')}${btn('timer', { op: 'reset' }, 'Cancelar')}</div>`
          : `<div class="chips">${presets.map((m) => btn('timer', { op: 'start', minutes: m }, `${m} min`, 'chip')).join('')}</div>
             <form class="row add" data-form="customTimer"><input name="min" type="number" min="1" max="600" placeholder="Minutos"><button class="btn primary" type="submit">Iniciar</button></form>`) +
        `<div class="sep"></div>${head('Cronómetro')}<div class="stopwatch mono">${fmtClock(el)}<small>.${String(Math.floor((el % 1000) / 100))}</small></div>
         <div class="row center gap">${w.running ? btn('stopwatch', { op: 'pause' }, icon('pause', 16) + ' Pausa', 'primary') : btn('stopwatch', { op: 'start' }, icon('play', 16) + (w.elapsed ? ' Seguir' : ' Iniciar'), 'primary')}${btn('stopwatch', { op: 'reset' }, 'Reiniciar')}</div>`;
    },
  },

  stocks: {
    name: 'Bolsa', desc: 'Tus listas de Yahoo Finance pasando en vivo, con alertas', width: 420, keepWhileTyping: true,
    tile: ({ s, now }) => {
      const q = s.live.stocks?.quotes || {};
      const list = allStockSymbols(s).filter((x) => q[x] && !q[x].error);
      if (!list.length) return `<button class="tile tile-text" data-panel="stocks" title="Bolsa">${icon('chart', 18)}<span><b>Bolsa</b><small>${s.live.stocks?.error ? 'sin conexión' : 'cargando…'}</small></span></button>`;
      const i = Math.floor(now.getTime() / 4000) % list.length;
      const x = q[list[i]];
      const up = x.pct >= 0;
      return `<button class="tile tile-stock ${up ? 'up' : 'down'}" data-panel="stocks"><span class="tk" data-i="${i}">
        <span class="tk-txt"><b>${esc(x.symbol)}</b><small>${fmtPx(x.price)}</small></span>${miniSpark(x.spark, up)}
        <span class="tk-pct">${up ? '▲' : '▼'} ${fmtPct(x.pct)}</span></span></button>`;
    },
    panel: ({ s }) => {
      const lists = s.settings.watchlists;
      const tab = Math.min(LOCAL.stocksTab || 0, lists.length - 1);
      const L = lists[tab] || { name: '', symbols: [] };
      const q = s.live.stocks?.quotes || {};
      const st = s.live.stocks;
      const tabs = lists.map((l, i) => btn('_stocksTab', { i }, esc(l.name), `chip ${i === tab ? 'on' : ''}`)).join('') + btn('_newListForm', {}, icon('plus', 14), 'chip icon-only', 'Nueva lista');
      const rows = L.symbols.map((sym) => {
        const x = q[sym];
        if (!x) return `<div class="st-row"><b>${esc(sym)}</b><span class="muted small">cargando…</span></div>`;
        if (x.error) return `<div class="st-row"><span class="st-name"><b>${esc(sym)}</b><small class="muted">no encontrado</small></span><span></span><span></span>${btn('_stockDel', { sym }, icon('x', 13), 'ghost icon-only st-del', 'Quitar')}</div>`;
        const up = x.pct >= 0;
        return `<div class="st-row"><span class="st-name"><b>${esc(x.symbol)}</b><small class="muted ellipsis">${esc(x.name)}</small></span>
          ${miniSpark(x.spark, up, 70, 24)}<span class="st-px">${fmtPx(x.price)}<small class="muted"> ${esc(x.currency)}</small></span>
          <span class="st-pct ${up ? 'up' : 'down'}">${up ? '+' : '−'}${fmtPct(x.pct)}</span>${btn('_stockDel', { sym }, icon('x', 13), 'ghost icon-only st-del', 'Quitar')}</div>`;
      }).join('');
      const targets = (s.settings.stockTargets || []).map((t) => `<div class="row between small"><span>${esc(t.symbol)} ${t.op === '>' ? 'sube a' : 'baja a'} <b>${t.price}</b></span>${btn('_targetDel', { id: t.id }, icon('x', 12), 'ghost icon-only')}</div>`).join('');
      return head('Bolsa', refreshBtn('stocks')) + errorBox(st?.error) +
        `<div class="chips">${tabs}</div>
        ${LOCAL.newList ? `<form class="row add" data-form="newList"><input name="name" placeholder="Nombre de la lista (p. ej. Tecnología)" maxlength="30"><button class="btn primary" type="submit">Crear</button></form>` : ''}
        <div class="st-list">${rows || empty('Esta lista está vacía. Agrega un símbolo abajo.')}</div>
        <form class="row add" data-form="addSymbol"><input name="sym" placeholder="Agregar símbolos: AAPL, GGAL.BA, BTC-USD…" autocomplete="off"><button class="btn" type="submit">${icon('plus', 15)}</button></form>
        <div class="row between small">${lists.length > 1 ? btn('_listDel', { i: tab }, 'Borrar esta lista', 'ghost small') : '<span></span>'}<span class="muted">${st?.at ? 'Actualizado ' + fmtTime(new Date(st.at)) : ''}</span></div>
        <div class="sep"></div><h3 class="sub">Alertas</h3>
        <div class="row gap small"><span>Avisarme si algo se mueve más de</span><input type="number" min="1" max="50" step="0.5" class="mini-num" data-setting-num="stockAlertPct" value="${s.settings.stockAlertPct}"><span>% en el día</span></div>
        <form class="row add target-form" data-form="addTarget"><input name="sym" placeholder="Símbolo" maxlength="12"><select name="op"><option value=">">sube a</option><option value="<">baja a</option></select><input name="price" type="number" step="any" placeholder="Precio"><button class="btn" type="submit">Avisarme</button></form>
        ${targets}
        <small class="muted">Datos de Yahoo Finance; algunos mercados tienen 15 min de demora.</small>`;
    },
  },

  music: {
    name: 'Música', desc: 'Lo que suena en Spotify, YouTube, etc. con controles', width: 330,
    tile: ({ s }) => {
      const m = s.live.music;
      if (!m || !m.title) return `<button class="tile tile-icon" data-panel="music" title="Música">${icon('music')}</button>`;
      return `<div class="tile tile-music"><button class="art" data-panel="music">${m.art ? `<img src="${m.art}" alt="">` : icon('music', 18)}</button>
        <button class="music-txt" data-panel="music"><b class="ellipsis">${esc(m.title)}</b><small class="ellipsis">${esc(m.artist)}</small></button>
        ${btn('media', { action: 'toggle' }, icon(m.playing ? 'pause' : 'play', 16), 'ghost icon-only round')}</div>`;
    },
    panel: ({ s }) => {
      const m = s.live.music;
      if (s.platform !== 'win32') return head('Música') + empty('Disponible en Windows');
      if (!m || !m.title) return head('Música') + empty('No hay nada sonando.<br><small>Abre Spotify, YouTube u otra app multimedia.</small>') +
        `<div class="row center gap">${btn('media', { action: 'toggle' }, icon('play', 16) + ' Reproducir', 'primary')}</div>`;
      const pct = m.duration ? m.position / m.duration : 0;
      return `<div class="np"><div class="np-art">${m.art ? `<img src="${m.art}" alt="">` : icon('music', 48)}</div>
        <b class="np-title">${esc(m.title)}</b><span class="muted">${esc(m.artist)}${m.album ? ' · ' + esc(m.album) : ''}</span>
        ${m.duration ? `${bar(pct, 'thin')}<div class="row between muted small"><span>${fmtClock(m.position * 1000)}</span><span>${fmtClock(m.duration * 1000)}</span></div>` : ''}
        <div class="row center gap media-ctl">${btn('media', { action: 'prev' }, icon('prev', 20), 'ghost icon-only round')}
        ${btn('media', { action: 'toggle' }, icon(m.playing ? 'pause' : 'play', 24), 'primary icon-only round big')}
        ${btn('media', { action: 'next' }, icon('next', 20), 'ghost icon-only round')}</div>
        <small class="muted ellipsis">${esc((m.app || '').split('!').pop().replace(/\.exe$/i, ''))}</small></div>`;
    },
  },

  weather: {
    name: 'Clima', desc: 'Tiempo actual y pronóstico (Open-Meteo)', width: 360,
    tile: ({ s }) => {
      const w = s.live.weather;
      if (!w?.current) return `<button class="tile tile-icon" data-panel="weather" title="Clima">${icon('cloudSun')}</button>`;
      const x = wx(w.current.code, w.current.day);
      return `<button class="tile tile-text" data-panel="weather" title="${esc(x.label)}">${icon(x.icon, 20)}<span><b>${Math.round(w.current.temp)}°</b></span></button>`;
    },
    panel: ({ s, now }) => {
      const w = s.live.weather;
      if (!w?.current) return head('Clima') + errorBox(w?.error) + (!s.settings.location ? empty('Escribe tu ciudad en Ajustes → Clima') : empty('Cargando…'));
      const x = wx(w.current.code, w.current.day);
      const today = w.daily[0];
      return head(esc(w.place.split(',')[0]), refreshBtn('weather')) + errorBox(w.error) +
        `<div class="wx-now">${icon(x.icon, 56)}<div><div class="wx-temp">${Math.round(w.current.temp)}°</div><div>${x.label}</div>
        <small class="muted">Máx ${Math.round(today.max)}° · Mín ${Math.round(today.min)}° · Sensación ${Math.round(w.current.feels)}°</small></div></div>
        <div class="row between muted small wx-meta"><span>${icon('drop', 14)} ${w.current.humidity}%</span><span>${icon('wind', 14)} ${Math.round(w.current.wind)} km/h</span>
        <span>${icon('sunrise', 14)} ${fmtTime(new Date(today.sunrise), s.settings.use24h)} – ${fmtTime(new Date(today.sunset), s.settings.use24h)}</span></div>
        <div class="hourly">${w.hourly.map((h) => { const d = new Date(h.time); const hx = wx(h.code, d.getHours() >= 7 && d.getHours() < 20); return `<div><small>${pad(d.getHours())}h</small>${icon(hx.icon, 18)}<b>${Math.round(h.temp)}°</b>${h.rain >= 20 ? `<small class="rain">${h.rain}%</small>` : '<small>&nbsp;</small>'}</div>`; }).join('')}</div>
        <div class="daily">${w.daily.map((d) => { const dd = new Date(d.date + 'T12:00'); const dx = wx(d.code); return `<div class="row"><span class="cap dname">${sameDay(dd, now) ? 'Hoy' : DAYS[dd.getDay()]}</span>${icon(dx.icon, 18)}<small class="rain">${d.rain >= 20 ? d.rain + '%' : ''}</small><span class="muted">${Math.round(d.min)}°</span>${bar((d.max - d.min) / 25, 'temp')}<b>${Math.round(d.max)}°</b></div>`; }).join('')}</div>`;
    },
  },

  claudeCode: {
    name: 'Claude Code', desc: 'Tokens usados en el bloque de 5 h (lee los registros locales)', width: 340,
    tile: ({ s, now }) => {
      const c = s.live.claudeCode;
      const a = c?.active;
      const ses = s.live.claudeSessions || [];
      const working = ses.some((x) => x.status === 'working'), waiting = ses.some((x) => x.status === 'waiting');
      const live = waiting ? 'waiting' : working ? 'working' : '';
      if (!a) return `<button class="tile tile-icon ${live}" data-panel="claudeCode" title="Claude Code">${icon('asterisk', 20, 'claude' + (live ? ' spin' : ''))}</button>`;
      const pct = c.maxBlock ? a.tokens / c.maxBlock : 0;
      return `<button class="tile tile-text ${live}" data-panel="claudeCode" title="Claude Code: bloque actual">${icon('asterisk', 18, 'claude' + (live ? ' spin' : ''))}<span><b>${fmtTokens(a.tokens)}</b><small>${waiting ? 'te espera' : working ? 'trabajando…' : fmtDur(a.resetsAt - now)}</small></span>${bar(pct, 'vert claude')}</button>`;
    },
    panel: ({ s, now }) => {
      const c = s.live.claudeCode;
      let html = head('Claude Code', refreshBtn('claudeCode'));
      const ses = s.live.claudeSessions || [];
      if (ses.length) {
        html += '<div class="cc-sessions">' + ses.map((x) => {
          const st = x.status === 'waiting' ? 'Esperando tu aprobación' : x.status === 'working' ? (x.tool ? `Trabajando · usando ${esc(x.tool)}` : 'Escribiendo la respuesta…') : `Terminó ${x.doneAt ? 'hace ' + fmtDur(now - x.doneAt) : ''}`;
          return `<div class="cc-s ${x.status}"><span class="cc-dot"></span><span class="cc-body"><b class="ellipsis">${esc(x.project)}</b><small>${st}</small>${x.text ? `<small class="muted cc-txt">${esc(x.text)}</small>` : ''}</span></div>`;
        }).join('') + '</div>';
      }
      html += `<label class="switch"><input type="checkbox" data-setting="claudeNotify" ${s.settings.claudeNotify ? 'checked' : ''}><span>Avisarme cuando Claude termine o me necesite</span></label><div class="sep"></div>`;
      html += errorBox(c?.error);
      const idleLocal = !ses.length && (!c?.today || !c.today.messages);
      if (idleLocal) html += `<div class="info"><b>${icon('asterisk', 15)} ¿Usas Claude en la nube?</b>
        <span>Nimbo sigue el Claude Code que corre <b>en esta PC</b> (terminal o app de escritorio). Las sesiones en la nube, como claude.ai/code o la app de Claude en modo nube, corren en servidores de Anthropic y no dejan registros acá: esas te avisan desde la propia app de Claude.</span></div>`;
      if (!c || c.error) return html;
      const a = c.active;
      html += a
        ? `<div class="stat-big"><b>${fmtTokens(a.tokens)}</b><span class="muted">tokens en el bloque actual · ${a.messages} respuestas</span></div>
           ${bar(c.maxBlock ? a.tokens / c.maxBlock : 0, 'claude')}
           <div class="row between small muted"><span>Empezó ${fmtTime(new Date(a.start), s.settings.use24h)}</span><span>Se reinicia en <b>${fmtDur(a.resetsAt - now)}</b> (${fmtTime(new Date(a.resetsAt), s.settings.use24h)})</span></div>
           <small class="muted">La barra compara con tu bloque más grande de las últimas 36 h.</small>`
        : empty('No hay un bloque activo. El próximo mensaje a Claude Code empieza uno nuevo de 5 horas.');
      html += `<div class="sep"></div><div class="row between"><b>Hoy</b><span>${fmtTokens(c.today.tokens)} tokens · ${c.today.messages} respuestas</span></div>${bars(c.hourly, 44, 'claude')}
        <div class="row between muted small"><span>0h</span><span>12h</span><span>23h</span></div>`;
      return html;
    },
  },

  anthropic: costWidget('anthropic', 'API de Anthropic', 'Gasto de hoy y del mes (clave de admin)', 'asterisk', 'anthropicAdminKey'),
  openai: costWidget('openai', 'API de OpenAI', 'Gasto de hoy y del mes (clave de admin)', 'hexagon', 'openaiAdminKey'),

  github: {
    name: 'GitHub', desc: 'Commits de hoy y resumen del mes (todas las ramas)', width: 400,
    tile: ({ s, now }) => {
      const g = s.live.github;
      if (!g || g.error && !g.days) return `<button class="tile tile-icon" data-panel="github" title="GitHub">${icon('code')}</button>`;
      const last = g.month ? lastDays(g.month.days, now, 21) : (g.days || []).slice(-21);
      return `<button class="tile tile-text" data-panel="github" title="GitHub: ${g.today} commits hoy">${heat(last, 3, 'mini')}<span><b>${g.today}</b><small>hoy</small></span></button>`;
    },
    panel: ({ s, now }) => {
      const g = s.live.github;
      let html = head(g?.login ? esc(g.login) : 'GitHub', `${g?.login ? btn('openUrl', { url: `https://github.com/${g.login}` }, icon('external', 15), 'ghost icon-only', 'Abrir en GitHub') : ''}${refreshBtn('github')}`) + errorBox(g?.error || g?.monthError);
      if (!g?.days) return html + (!s.settings.githubUser && !s.secrets.githubToken ? empty('Escribe tu usuario en Ajustes → GitHub') + githubTokenHelp() : '');
      const m = g.month;
      if (!m) {
        // sin token: lo poco que GitHub muestra en público
        html += heat(g.days, 7, 'big') + `<div class="stats-grid"><div><b>${g.today}</b><small>commits hoy</small></div></div>` + githubTokenHelp();
        return html;
      }
      const monthName = MONTHS[now.getMonth()];
      const top = m.repos[0];
      html += `<div class="gh-month-title cap">${monthName} de ${now.getFullYear()}</div>`;
      html += `<div class="stats-grid"><div><b>${g.today}</b><small>commits hoy</small></div><div><b>${m.month}</b><small>commits en el mes</small></div><div><b>${m.activeDays}</b><small>días con commits</small></div>
        <div><b>${m.prs}</b><small>PRs en el mes</small></div><div><b>${g.openPRs}</b><small>PRs abiertos</small></div><div><b>${g.reviews}</b><small>revisiones pendientes</small></div></div>`;
      html += monthCalendar(m.days, now);
      if (top) html += `<div class="gh-top">${icon('flag', 16)}<span>Tu proyecto del mes: <b>${esc(top.name)}</b>, con ${top.commits} commits en ${top.days} día${top.days === 1 ? '' : 's'}.</span></div>`;
      if (m.repos.length) {
        const max = m.repos[0].commits;
        html += `<h3 class="sub">Proyectos del mes</h3><div class="gh-repos">${m.repos.map((r) => `<button class="gh-repo" data-act="openUrl" data-args="${attr({ url: 'https://github.com/' + r.full })}">
          <span class="gh-repo-name"><span class="ellipsis">${esc(r.name)}</span>${bar(r.commits / max)}</span>
          <small class="muted">${r.today ? `<b class="gh-today">+${r.today} hoy</b> · ` : ''}${r.days} día${r.days === 1 ? '' : 's'}</small><b>${r.commits}</b></button>`).join('')}</div>`;
      } else html += empty('Todavía no hay commits este mes.');
      html += `<small class="muted">Cuenta los commits de todas las ramas, también los de Claude Code. GitHub, en cambio, te suma ${g.contributionsToday ?? 0} ${g.contributionsToday === 1 ? 'contribución' : 'contribuciones'} hoy porque solo cuenta la rama principal hasta que fusionas el PR.</small>`;
      return html;
    },
  },

  stats: {
    name: 'Sistema', desc: 'Uso de CPU y memoria', width: 330,
    tile: ({ s }) => {
      const st = s.live.stats; if (!st) return null;
      const ram = 1 - st.mem.free / st.mem.total;
      return `<button class="tile tile-stats" data-panel="stats" title="CPU ${st.cpu}% · RAM ${Math.round(ram * 100)}%"><span><small>CPU</small>${bar(st.cpu / 100, cls(st.cpu / 100))}</span><span><small>RAM</small>${bar(ram, cls(ram))}</span></button>`;
    },
    panel: ({ s }) => {
      const st = s.live.stats; if (!st) return head('Sistema') + empty('Cargando…');
      const used = st.mem.total - st.mem.free;
      return head('Sistema') + `<div class="row between"><b>Procesador</b><span>${st.cpu}%</span></div>${spark(st.history)}
        <small class="muted ellipsis">${esc(st.model)} · ${st.cores} hilos</small><div class="sep"></div>
        <div class="row between"><b>Memoria</b><span>${fmtBytes(used)} de ${fmtBytes(st.mem.total)}</span></div>${bar(used / st.mem.total, cls(used / st.mem.total))}
        <div class="sep"></div><div class="row between small muted"><span>Encendido hace</span><span>${fmtDur(st.uptime * 1000)}</span></div>`;
    },
  },

  network: {
    name: 'Red', desc: 'Velocidad de subida y bajada', width: 280,
    tile: ({ s }) => {
      const n = s.live.net; if (!n) return null;
      return `<div class="tile tile-net"><small>↓ ${fmtBytes(n.down, true)}</small><small>↑ ${fmtBytes(n.up, true)}</small></div>`;
    },
  },

  storage: {
    name: 'Almacenamiento', desc: 'Espacio libre en tus discos', width: 320,
    tile: ({ s }) => {
      const d = s.live.drives?.[0]; if (!d) return null;
      const pct = 1 - d.free / d.total;
      return `<button class="tile tile-text" data-panel="storage" title="${esc(d.name)} ${fmtBytes(d.free)} libres">${icon('drive', 18)}<span><b>${Math.round(pct * 100)}%</b><small>${esc(d.name.replace('\\', ''))}</small></span></button>`;
    },
    panel: ({ s }) => head('Discos') + (s.live.drives || []).map((d) => {
      const pct = 1 - d.free / d.total;
      return `<div class="drive"><div class="row between"><b>${esc(d.label || 'Disco local')} (${esc(d.name.replace('\\', ''))})</b>${btn('openPath', { p: d.name }, icon('external', 14), 'ghost icon-only', 'Abrir')}</div>
        ${bar(pct, cls(pct))}<small class="muted">${fmtBytes(d.free)} libres de ${fmtBytes(d.total)}</small></div>`;
    }).join(''),
  },

  battery: {
    name: 'Batería', desc: 'Nivel de batería (portátiles)',
    tile: ({ local }) => {
      const b = local.battery;
      if (!b || (b.level === 1 && b.charging && b.chargingTime === 0)) return null; // PC de escritorio
      const pct = Math.round(b.level * 100);
      return `<div class="tile tile-text ${pct <= 20 && !b.charging ? 'urgent' : ''}" title="Batería ${pct}%">${icon(b.charging ? 'bolt' : 'battery', 18)}<span><b>${pct}%</b></span></div>`;
    },
  },

  recycle: {
    name: 'Papelera', desc: 'Elementos en la papelera de reciclaje', width: 280,
    tile: ({ s }) => {
      const r = s.live.recycle;
      return `<button class="tile tile-icon" data-panel="recycle" title="Papelera">${icon('trash')}${r?.count ? `<span class="badge soft">${r.count > 99 ? '99+' : r.count}</span>` : ''}</button>`;
    },
    panel: ({ s }) => {
      const r = s.live.recycle || { count: 0, size: 0 };
      return head('Papelera') + `<div class="stat-big"><b>${r.count}</b><span class="muted">elementos · ${fmtBytes(r.size)}</span></div>
        <div class="row gap">${btn('openRecycle', {}, icon('external', 15) + ' Abrir')}${r.count ? btn('emptyRecycle', {}, icon('trash', 15) + ' Vaciar', 'danger') : ''}</div>`;
    },
  },
};

// últimos N días como lista de números (para el mini mapa del dock)
function lastDays(days, now, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * 864e5); out.push(days[dateKey(d)] || 0); }
  return out;
}
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// calendario del mes con la intensidad de commits de cada día
function monthCalendar(days, now) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const max = Math.max(1, ...Object.values(days));
  let cells = '';
  for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells += '<span class="gh-day empty"></span>';
  for (let d = 1; d <= total; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), d);
    const n = days[dateKey(date)] || 0;
    const lvl = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
    const future = date > now;
    cells += `<span class="gh-day l${lvl} ${future ? 'future' : ''} ${d === now.getDate() ? 'today' : ''}" title="${d}: ${n} commit${n === 1 ? '' : 's'}">${d}</span>`;
  }
  return `<div class="gh-cal"><div class="grid7 dow">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="gh-grid">${cells}</div></div>`;
}

function githubTokenHelp() {
  return `<div class="info"><b>${icon('key', 15)} ¿No ves tus commits?</b>
    <span>Si tus repositorios son privados, GitHub no los muestra sin permiso. Crea un token (solo lectura) y pégalo en Ajustes → GitHub → Token.</span>
    ${btn('openUrl', { url: 'https://github.com/settings/tokens/new?scopes=repo,read:user,notifications&description=Nimbo%20dock' }, icon('external', 14) + ' Crear token en GitHub', 'primary small')}
    <small class="muted">En la página que se abre: elige la duración, baja hasta el final, toca «Generate token» y copia el código que empieza con ghp_.</small></div>`;
}

// ------------------------------------------------------------------ bolsa: utilidades
const LOCAL = { stocksTab: 0, newList: false };
function allStockSymbols(s) { return [...new Set(s.settings.watchlists.flatMap((l) => l.symbols))]; }
const fmtPx = (n) => { const d = (n ?? 0) >= 1000 ? 0 : 2; return (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const fmtPct = (n) => Math.abs(n ?? 0).toFixed(Math.abs(n) >= 10 ? 1 : 2).replace('.', ',') + '%';
function miniSpark(values, up, w = 44, h = 20) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="mspark ${up ? 'up' : 'down'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}"/></svg>`;
}

// Acciones que se resuelven en la interfaz (devuelven cambios de ajustes para guardar)
const LOCAL_ACTIONS = {
  _stocksTab: ({ i }) => { LOCAL.stocksTab = i; LOCAL.newList = false; },
  _newListForm: () => { LOCAL.newList = !LOCAL.newList; },
  _stockDel: ({ sym }, s) => {
    const lists = s.settings.watchlists.map((l, i) => (i === Math.min(LOCAL.stocksTab, s.settings.watchlists.length - 1) ? { ...l, symbols: l.symbols.filter((x) => x !== sym) } : l));
    return { watchlists: lists };
  },
  _listDel: ({ i }, s) => { LOCAL.stocksTab = 0; return { watchlists: s.settings.watchlists.filter((_, j) => j !== i) }; },
  _targetDel: ({ id }, s) => ({ stockTargets: (s.settings.stockTargets || []).filter((t) => t.id !== id) }),
};

function cls(p) { return p > 0.9 ? 'bad' : p > 0.7 ? 'warn' : ''; }

function heat(values, rows, size) {
  const max = Math.max(1, ...values);
  const cols = Math.ceil(values.length / rows);
  let cells = '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const lvl = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
    cells += `<i class="l${lvl}" title="${v}"></i>`;
  }
  return `<div class="heat ${size}" style="grid-template-rows:repeat(${rows},1fr);grid-template-columns:repeat(${cols},1fr)">${cells}</div>`;
}

function costWidget(id, name, desc, ic, secret) {
  return {
    name, desc, width: 340,
    tile: ({ s }) => {
      const c = s.live[id];
      if (!c || c.error && c.month == null) return `<button class="tile tile-icon" data-panel="${id}" title="${name}">${icon(ic)}</button>`;
      return `<button class="tile tile-text" data-panel="${id}" title="${name}: hoy / mes">${icon(ic, 18)}<span><b>${fmtUSD(c.today)}</b><small>${fmtUSD(c.month)} mes</small></span></button>`;
    },
    panel: ({ s }) => {
      const c = s.live[id];
      let html = head(name, refreshBtn(id)) + errorBox(c?.error);
      if (!s.secrets[secret]) return html;
      if (c?.month == null) return html + empty('Cargando…');
      return html + `<div class="stats-grid two"><div><b>${fmtUSD(c.today)}</b><small>hoy (UTC)</small></div><div><b>${fmtUSD(c.month)}</b><small>este mes</small></div></div>
        ${bars(c.days.map((d) => d.usd), 60)}<small class="muted">Gasto diario del mes. Los datos pueden tardar unos minutos en aparecer.</small>`;
    },
  };
}

function nextEvent(s, now) {
  const evs = s.live.calendar?.events || [];
  return evs.find((e) => !e.allDay && new Date(e.end) > now) || evs.find((e) => new Date(e.end) > now);
}

// ------------------------------------------------------------------ elementos del buscador que no son apps
const SEARCH_EXTRAS = [
  ['Configuración de Windows', 'ms-settings:', 'gear'], ['Wi-Fi', 'ms-settings:network-wifi', 'wifi'], ['Bluetooth y dispositivos', 'ms-settings:bluetooth', 'gear'],
  ['Red e Internet', 'ms-settings:network-status', 'globe'], ['Pantalla', 'ms-settings:display', 'gear'], ['Sonido', 'ms-settings:sound', 'volume'],
  ['Notificaciones', 'ms-settings:notifications', 'bell'], ['Energía y batería', 'ms-settings:powersleep', 'battery'], ['Fondo de pantalla', 'ms-settings:personalization-background', 'gear'],
  ['Colores y modo oscuro', 'ms-settings:colors', 'gear'], ['Temas', 'ms-settings:themes', 'gear'], ['Barra de tareas', 'ms-settings:taskbar', 'gear'],
  ['Aplicaciones instaladas', 'ms-settings:appsfeatures', 'gear'], ['Aplicaciones de inicio', 'ms-settings:startupapps', 'gear'], ['Aplicaciones predeterminadas', 'ms-settings:defaultapps', 'gear'],
  ['Windows Update', 'ms-settings:windowsupdate', 'refresh'], ['Almacenamiento', 'ms-settings:storagesense', 'drive'], ['Impresoras y escáneres', 'ms-settings:printers', 'gear'],
  ['Mouse', 'ms-settings:mousetouchpad', 'gear'], ['Idioma y región', 'ms-settings:regionlanguage', 'globe'], ['Fecha y hora', 'ms-settings:dateandtime', 'clock'],
  ['Cuentas', 'ms-settings:yourinfo', 'gear'], ['Privacidad y seguridad', 'ms-settings:privacy', 'lock'], ['Seguridad de Windows', 'ms-settings:windowsdefender', 'lock'],
  ['VPN', 'ms-settings:network-vpn', 'lock'], ['Acerca de este equipo', 'ms-settings:about', 'cpu'],
].map(([name, uri, ic]) => ({ kind: 'setting', name, uri, icon: ic }))
  .concat([
    { kind: 'keys', name: 'Administrador de tareas', keys: [VK.CTRL, VK.SHIFT, VK.ESC], icon: 'cpu' },
    { kind: 'keys', name: 'Explorador de archivos', keys: [VK.WIN, VK.E], icon: 'folder' },
    { kind: 'keys', name: 'Bloquear el equipo', keys: [VK.WIN, VK.L], icon: 'lock' },
    { kind: 'keys', name: 'Configuración rápida (Wi-Fi, volumen)', keys: [VK.WIN, VK.A], icon: 'wifi' },
    { kind: 'keys', name: 'Centro de notificaciones', keys: [VK.WIN, VK.N], icon: 'bell' },
  ]);

// ------------------------------------------------------------------ ajustes
const STYLES = { acrylic: 'Vidrio acrílico (Windows 11)', glass: 'Vidrio translúcido', dark: 'Oscuro', light: 'Claro' };
const TASKBAR = { autohide: 'Ocultar automáticamente', hide: 'Ocultar por completo', none: 'Dejarla como está' };

function settingsPanel({ s }) {
  const st = s.settings;
  const select = (key, opts) => `<select data-setting="${key}">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${st[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const check = (key, label) => `<label class="switch"><input type="checkbox" data-setting="${key}" ${st[key] ? 'checked' : ''}><span>${label}</span></label>`;
  const secretField = (name, label, ph, help) => `<div class="field"><label>${label}</label>
    <form class="row add" data-form="secret" data-name="${name}"><input name="value" type="password" autocomplete="off" placeholder="${s.secrets[name] ? '•••••••• guardada' : ph}">
    <button class="btn" type="submit">Guardar</button>${s.secrets[name] ? `<button class="btn ghost" type="button" data-clear-secret="${name}">Quitar</button>` : ''}</form>${help ? `<small class="muted">${help}</small>` : ''}</div>`;

  return head(`Ajustes <small class="muted">v${esc(s.version || '')}</small>`, btn('openLog', {}, 'Registro', 'ghost small') + btn('quit', {}, 'Salir de Nimbo', 'ghost small')) +
    `<section><h3>Apariencia</h3>
      <div class="field"><label>Estilo</label>${select('style', STYLES)}</div>
      <div class="field"><label>Barra de tareas de Windows mientras Nimbo está abierto</label>${select('taskbar', TASKBAR)}</div>
      ${check('openAtLogin', 'Iniciar con Windows')}${check('hideOnFullscreen', 'Ocultar el dock con apps a pantalla completa')}${check('use24h', 'Formato de 24 horas')}
    </section>
    <section><h3>Widgets</h3><small class="muted">Activa, desactiva y ordena lo que aparece en el dock.</small>
      <div class="wlist">${st.widgets.map((w, i) => { const d = WIDGET_DEFS[w.id]; return `<div class="witem">
        <label class="switch"><input type="checkbox" data-widget="${w.id}" ${w.enabled ? 'checked' : ''}><span><b>${d.name}</b><small>${d.desc}</small></span></label>
        <span class="worder">${btn('_move', { i, dir: -1 }, icon('up', 14), 'ghost icon-only')}${btn('_move', { i, dir: 1 }, icon('down', 14), 'ghost icon-only')}</span></div>`; }).join('')}</div>
    </section>
    <section><h3>Clima</h3>
      <form class="row add" data-form="city"><input name="city" value="${esc(st.city)}" placeholder="Ciudad, p. ej. Buenos Aires"><button class="btn" type="submit">Guardar</button></form>
      ${st.location ? `<small class="muted">📍 ${esc(st.location.name)}</small>` : ''}<div class="form-msg" data-msg="city"></div>
    </section>
    <section><h3>Calendario</h3>
      <small class="muted">Pega la «dirección secreta en formato iCal» de cada calendario, una por línea. En Google Calendar: Configuración → tu calendario → Integrar el calendario. En Outlook: Configuración → Calendarios compartidos → Publicar un calendario. Nimbo solo lee, cada 15 minutos.</small>
      <form data-form="calendars"><textarea name="urls" rows="3" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics">${esc(st.calendars.join('\n'))}</textarea><button class="btn" type="submit">Guardar</button></form>
    </section>
    <section><h3>GitHub</h3>
      <form class="row add" data-form="githubUser"><input name="user" value="${esc(st.githubUser)}" placeholder="Tu usuario"><button class="btn" type="submit">Guardar</button></form>
      ${secretField('githubToken', 'Token', 'ghp_…', 'Necesario si tus repositorios son privados: sin token GitHub no muestra esos commits.')}
      ${btn('openUrl', { url: 'https://github.com/settings/tokens/new?scopes=repo,read:user,notifications&description=Nimbo%20dock' }, icon('external', 14) + ' Crear token en GitHub', 'small')}
    </section>
    <section><h3>IA</h3>
      <small class="muted">El widget de Claude Code no necesita claves: lee los registros que Claude Code guarda en tu PC. Las claves de administrador son para ver el gasto de la API de tu organización. Se guardan cifradas en este PC.</small>
      ${secretField('anthropicAdminKey', 'Clave de administrador de Anthropic', 'sk-ant-admin…', 'Se crea en la Consola de Claude → Ajustes → Claves de administrador.')}
      ${secretField('openaiAdminKey', 'Clave de administrador de OpenAI', 'sk-admin-…', 'Se crea en platform.openai.com → Organización → Admin keys.')}
    </section>
    <section><h3>Actualizaciones</h3>
      <div class="row between"><span>Versión instalada: <b>${esc(s.version || '')}</b></span>${btn('checkUpdates', {}, icon('refresh', 14) + ' Buscar ahora', 'small')}</div>
      ${s.update?.message ? `<small class="muted">${esc(s.update.message)}</small>` : ''}
      ${check('autoUpdate', 'Actualizar automáticamente (Nimbo se reinicia solo unos segundos)')}
    </section>
    <section><h3>Pomodoro</h3>
      <div class="row gap"><div class="field"><label>Concentración (min)</label><input type="number" min="1" max="180" data-setting-num="pomodoroWork" value="${st.pomodoroWork}"></div>
      <div class="field"><label>Descanso (min)</label><input type="number" min="1" max="60" data-setting-num="pomodoroBreak" value="${st.pomodoroBreak}"></div></div>
    </section>`;
}

WIDGET_DEFS.settings = { name: 'Ajustes', desc: '', width: 420, keepWhileTyping: true, panel: settingsPanel };
