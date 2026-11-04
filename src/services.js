// Servicios que traen datos de internet o del disco. Cada uno devuelve un objeto simple
// que se envía a la interfaz. Los errores se devuelven como { error } para mostrarlos en el widget.
const fs = require('fs');
const os = require('os');
const path = require('path');

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  return res.json();
}

// ---------------- Clima (Open-Meteo, sin clave) ----------------
async function geocode(city) {
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`);
  const r = j.results?.[0];
  if (!r) throw new Error('Ciudad no encontrada');
  return { name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
}

async function weather(loc) {
  if (!loc) return { error: 'Configura tu ciudad en Ajustes' };
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: '6',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
  }).toString();
  const j = await getJSON(u.toString());
  const nowIdx = Math.max(0, j.hourly.time.findIndex((t) => t >= j.current.time.slice(0, 13)));
  return {
    place: loc.name,
    current: {
      temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code,
      day: !!j.current.is_day, wind: j.current.wind_speed_10m, humidity: j.current.relative_humidity_2m,
    },
    hourly: j.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({
      time: t, temp: j.hourly.temperature_2m[nowIdx + i], code: j.hourly.weather_code[nowIdx + i],
      rain: j.hourly.precipitation_probability[nowIdx + i],
    })),
    daily: j.daily.time.map((d, i) => ({
      date: d, code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i],
      rain: j.daily.precipitation_probability_max[i], sunrise: j.daily.sunrise[i], sunset: j.daily.sunset[i],
    })),
  };
}

// ---------------- Calendario (enlaces iCal de Google / Outlook / iCloud) ----------------
// Explica en castellano los errores más comunes al pegar un enlace de calendario
function calendarError(url, msg) {
  let host = 'calendario';
  try { host = new URL(url).hostname; } catch {}
  const google = /calendar\.google\.com/.test(host);
  if (google && !/\/ical\//.test(url)) return 'Google: ese no es un enlace iCal. En Configuración → tu calendario → Integrar el calendario, copia la «Dirección secreta en formato iCal».';
  if (google && /HTTP 404/.test(msg) && /\/public\//.test(url)) return 'Google: pegaste la dirección PÚBLICA y tu calendario no es público. Copia la «Dirección secreta en formato iCal» (la que dice private-).';
  if (google && /HTTP 404/.test(msg)) return 'Google no encontró el calendario: el enlace secreto pudo cambiar o estar incompleto. Vuelve a copiar la «Dirección secreta en formato iCal».';
  if (/HTTP 40[13]/.test(msg)) return `${host}: el calendario no es accesible con ese enlace. Usa el enlace secreto o publicado (ICS).`;
  return `${host}: ${msg}`;
}
async function calendar(urls) {
  if (!urls?.length) return { events: [], error: 'Pega el enlace iCal secreto de tu calendario en Ajustes' };
  const ical = require('node-ical');
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 14 * 864e5);
  const events = [];
  const errors = [];
  for (const raw of urls) {
    const url = raw.replace(/^webcal:\/\//i, 'https://');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = ical.sync.parseICS(await res.text());
      for (const ev of Object.values(data)) {
        if (ev.type !== 'VEVENT' || !ev.start) continue;
        const allDay = ev.datetype === 'date';
        const dur = (ev.end ? new Date(ev.end) : new Date(ev.start)) - new Date(ev.start);
        const push = (start) => {
          const end = new Date(start.getTime() + dur);
          if (end < from || start > to) return;
          events.push({ title: ev.summary?.val ?? ev.summary ?? '(sin título)', location: ev.location?.val ?? ev.location ?? '', start: start.toISOString(), end: end.toISOString(), allDay });
        };
        if (ev.rrule) {
          const ex = new Set(Object.values(ev.exdate || {}).map((d) => new Date(d).toISOString().slice(0, 16)));
          for (const occ of ev.rrule.between(new Date(from.getTime() - dur), to, true)) {
            // rrule devuelve la hora "flotante"; la ajustamos a la hora local original del evento
            const s = new Date(ev.start);
            const d = new Date(occ);
            const start = allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
              : new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes());
            if (!ex.has(start.toISOString().slice(0, 16))) push(start);
          }
          // excepciones editadas de una serie
          for (const r of Object.values(ev.recurrences || {})) if (r.start) push(new Date(r.start));
        } else {
          push(new Date(ev.start));
        }
      }
    } catch (e) {
      errors.push(calendarError(url, e.message));
    }
  }
  // quitar duplicados (misma hora y título)
  const seen = new Set();
  const unique = events.filter((e) => { const k = e.start + e.title; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => a.start.localeCompare(b.start));
  return { events: unique, error: errors.join(' · ') || null };
}

// ---------------- Claude Code (uso local, sin claves) ----------------
// Lee los registros que Claude Code guarda en ~/.claude/projects y calcula los bloques de 5 horas.
function claudeCode() {
  const roots = [];
  if (process.env.CLAUDE_CONFIG_DIR) for (const p of process.env.CLAUDE_CONFIG_DIR.split(',')) roots.push(path.join(p.trim(), 'projects'));
  roots.push(path.join(os.homedir(), '.claude', 'projects'), path.join(os.homedir(), '.config', 'claude', 'projects'));
  const since = Date.now() - 36 * 3600e3;
  const entries = [];
  const seen = new Set();
  let found = false;
  for (const root of roots) {
    let dirs;
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); found = true; } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch {}
      for (const f of files) {
        const file = path.join(dir, f);
        try { if (fs.statSync(file).mtimeMs < since) continue; } catch { continue; }
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
          if (!line.includes('"usage"')) continue;
          let o; try { o = JSON.parse(line); } catch { continue; }
          const u = o.message?.usage; const ts = Date.parse(o.timestamp);
          if (!u || !ts || ts < since) continue;
          const key = `${o.message.id}:${o.requestId}`;
          if (seen.has(key)) continue; seen.add(key);
          entries.push({
            ts, model: o.message.model || '',
            tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
            output: u.output_tokens || 0,
          });
        }
      }
    }
  }
  if (!found) return { error: 'No se encontró Claude Code en este PC (~/.claude)' };
  entries.sort((a, b) => a.ts - b.ts);
  // bloques de 5 h: empiezan en la hora en punto del primer mensaje
  const BLOCK = 5 * 3600e3;
  let block = null;
  const blocks = [];
  for (const e of entries) {
    if (!block || e.ts >= block.start + BLOCK) {
      const start = new Date(e.ts); start.setMinutes(0, 0, 0);
      block = { start: start.getTime(), tokens: 0, output: 0, messages: 0 };
      blocks.push(block);
    }
    block.tokens += e.tokens; block.output += e.output; block.messages++;
  }
  const now = Date.now();
  const last = blocks[blocks.length - 1];
  const active = last && now < last.start + BLOCK ? last : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayEntries = entries.filter((e) => e.ts >= today.getTime());
  const maxBlock = blocks.reduce((m, b) => Math.max(m, b.tokens), 0);
  return {
    active: active ? { ...active, resetsAt: active.start + BLOCK } : null,
    today: { tokens: todayEntries.reduce((s, e) => s + e.tokens, 0), messages: todayEntries.length },
    maxBlock,
    hourly: Array.from({ length: 24 }, (_, h) => todayEntries.filter((e) => new Date(e.ts).getHours() === h).reduce((s, e) => s + e.tokens, 0)),
  };
}

// ---------------- Gasto en la API de Anthropic (clave de administrador) ----------------
function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

async function anthropicCost(key) {
  if (!key) return { error: 'Añade una clave de administrador (sk-ant-admin…) en Ajustes' };
  const days = [];
  let page = null;
  for (let i = 0; i < 5; i++) {
    const u = new URL('https://api.anthropic.com/v1/organizations/cost_report');
    u.searchParams.set('starting_at', monthStart().toISOString());
    u.searchParams.set('bucket_width', '1d');
    u.searchParams.set('limit', '31');
    if (page) u.searchParams.set('page', page);
    const j = await getJSON(u.toString(), { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    for (const b of j.data || []) {
      // los importes vienen en centavos de USD como texto decimal
      const cents = (b.results || []).reduce((s, r) => s + parseFloat(r.amount?.value ?? r.amount ?? 0), 0);
      days.push({ date: b.starting_at.slice(0, 10), usd: cents / 100 });
    }
    if (!j.has_more || !j.next_page) break;
    page = j.next_page;
  }
  return summarizeDays(days);
}

// ---------------- Gasto en la API de OpenAI (clave de administrador) ----------------
async function openaiCost(key) {
  if (!key) return { error: 'Añade una clave de administrador de OpenAI en Ajustes' };
  const days = [];
  let page = null;
  for (let i = 0; i < 5; i++) {
    const u = new URL('https://api.openai.com/v1/organization/costs');
    u.searchParams.set('start_time', String(Math.floor(monthStart().getTime() / 1000)));
    u.searchParams.set('bucket_width', '1d');
    u.searchParams.set('limit', '31');
    if (page) u.searchParams.set('page', page);
    const j = await getJSON(u.toString(), { headers: { Authorization: `Bearer ${key}` } });
    for (const b of j.data || []) {
      const usd = (b.results || []).reduce((s, r) => s + Number(r.amount?.value || 0), 0);
      days.push({ date: new Date(b.start_time * 1000).toISOString().slice(0, 10), usd });
    }
    if (!j.has_more || !j.next_page) break;
    page = j.next_page;
  }
  return summarizeDays(days);
}

function summarizeDays(days) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return {
    today: days.filter((d) => d.date === todayKey).reduce((s, d) => s + d.usd, 0),
    month: days.reduce((s, d) => s + d.usd, 0),
    days,
  };
}

// ---------------- GitHub ----------------
// "Hoy" se cuenta desde la medianoche de TU zona horaria (GitHub agrupa los días en UTC).
function localMidnightISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0'), mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${localDateKey(d)}T00:00:00${sign}${hh}:${mm}`;
}

// Commits del mes en TODAS las ramas de tus repos (incluye las ramas de Claude Code), en una sola consulta GraphQL
function localMonthStartISO() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
async function monthActivity(headers, login) {
  const monthStart = new Date(localMonthStartISO());
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const repos = (await getJSON('https://api.github.com/user/repos?sort=pushed&per_page=40&affiliation=owner,collaborator,organization_member', { headers }))
    .filter((r) => new Date(r.pushed_at) >= monthStart).slice(0, 12);
  const days = {};       // 'AAAA-MM-DD' -> commits
  const out = [];
  if (repos.length) {
    const parts = repos.map((r, i) => `r${i}: repository(owner: ${JSON.stringify(r.owner.login)}, name: ${JSON.stringify(r.name)}) {
      refs(refPrefix: "refs/heads/", first: 20, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes { target { ... on Commit { history(since: $since, first: 100) { nodes { oid committedDate } } } } } } }`);
    const j = await getJSON('https://api.github.com/graphql', {
      method: 'POST', headers, body: JSON.stringify({ query: `query($since: GitTimestamp!) { ${parts.join('\n')} }`, variables: { since: monthStart.toISOString() } }),
    });
    if (j.errors && !j.data) throw new Error(j.errors[0].message);
    repos.forEach((r, i) => {
      const seen = new Map();
      for (const ref of j.data?.[`r${i}`]?.refs?.nodes || []) for (const c of ref.target?.history?.nodes || []) seen.set(c.oid, c.committedDate);
      if (!seen.size) return;
      let today = 0;
      const repoDays = new Set();
      for (const date of seen.values()) {
        const d = new Date(date);
        const k = localDateKey(d);
        days[k] = (days[k] || 0) + 1;
        repoDays.add(k);
        if (d >= todayStart) today++;
      }
      out.push({ name: r.name, full: r.full_name, commits: seen.size, today, days: repoDays.size, private: r.private });
    });
  }
  let prs = 0, prsToday = 0;
  try { prs = (await getJSON(`https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(`is:pr author:${login} created:>=${localDateKey(monthStart)}`)}`, { headers })).total_count; } catch {}
  try { prsToday = (await getJSON(`https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(`is:pr author:${login} created:>=${localMidnightISO()}`)}`, { headers })).total_count; } catch {}
  out.sort((a, b) => b.commits - a.commits);
  return {
    month: out.reduce((n, r) => n + r.commits, 0),
    today: out.reduce((n, r) => n + r.today, 0),
    activeDays: Object.keys(days).length,
    days, prs, prsToday, repos: out,
  };
}

async function github(user, token) {
  if (!user && !token) return { error: 'Escribe tu usuario de GitHub en Ajustes' };
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Nimbo-Dock' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const since = localMidnightISO();
  if (token) {
    const q = `query($from: DateTime!, $to: DateTime!) { viewer { login
      today: contributionsCollection(from: $from, to: $to) {
        totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount }
      year: contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }
      pullRequests(states: OPEN) { totalCount } } }`;
    const j = await getJSON('https://api.github.com/graphql', {
      method: 'POST', headers, body: JSON.stringify({ query: q, variables: { from: new Date(since).toISOString(), to: new Date().toISOString() } }),
    });
    if (j.errors) throw new Error(j.errors[0].message);
    const v = j.data.viewer;
    const t = v.today;
    const today = t.totalCommitContributions + t.totalIssueContributions + t.totalPullRequestContributions + t.totalPullRequestReviewContributions + t.restrictedContributionsCount;
    const days = v.year.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
    let reviews = 0, notifications = 0, commitsToday = 0;
    try {
      const s2 = await getJSON(`https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(`is:open is:pr review-requested:${v.login}`)}`, { headers });
      reviews = s2.total_count;
    } catch {}
    try { notifications = (await getJSON('https://api.github.com/notifications?per_page=50', { headers })).length; } catch {}
    // Tu trabajo real: commits en TODAS las ramas (GitHub solo cuenta la rama principal,
    // así que los commits de ramas de Claude Code no aparecen como contribución hasta fusionar el PR)
    let m = null, monthError = null;
    try { m = await monthActivity(headers, v.login); } catch (e) { monthError = e.message; }
    if (!m) { try { commitsToday = (await getJSON(`https://api.github.com/search/commits?per_page=1&q=${encodeURIComponent(`author:${v.login} author-date:>=${since}`)}`, { headers })).total_count; } catch {} }
    return {
      login: v.login, today: m ? m.today : commitsToday, contributionsToday: today, month: m, monthError,
      total: v.year.contributionCalendar.totalContributions,
      streak: streak(days),
      days: days.slice(-119).map((d) => d.contributionCount),
      openPRs: v.pullRequests.totalCount, reviews, notifications,
    };
  }
  // sin token: actividad pública (GitHub la publica con algo de retraso) + búsqueda de commits de hoy
  const events = await getJSON(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=100`, { headers });
  const todayKey = localDateKey(new Date());
  const perDay = {};
  for (const e of events) {
    const k = localDateKey(new Date(e.created_at));
    const n = e.type === 'PushEvent' ? (e.payload?.distinct_size || e.payload?.size || e.payload?.commits?.length || 1) : 1;
    perDay[k] = (perDay[k] || 0) + n;
  }
  let commitsToday = 0;
  try { commitsToday = (await getJSON(`https://api.github.com/search/commits?per_page=1&q=${encodeURIComponent(`author:${user} author-date:>=${since}`)}`, { headers })).total_count; } catch {}
  perDay[todayKey] = Math.max(perDay[todayKey] || 0, commitsToday);
  const days = [];
  for (let i = 118; i >= 0; i--) days.push(perDay[localDateKey(new Date(Date.now() - i * 864e5))] || 0);
  return { login: user, today: perDay[todayKey] || 0, days, publicOnly: true, recent: events.slice(0, 6).map((e) => ({ type: e.type, repo: e.repo?.name, at: e.created_at })) };
}

function localDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function streak(days) {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) n++;
    else if (i === days.length - 1) continue; // hoy todavía sin contribuciones no rompe la racha
    else break;
  }
  return n;
}

// ---------------- Bolsa (Yahoo Finance, sin clave) ----------------
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function parseChart(sym, j) {
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'sin datos');
  const m = r.meta || {};
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const price = m.regularMarketPrice ?? closes[closes.length - 1];
  const prev = m.chartPreviousClose ?? m.previousClose ?? closes[0];
  const now = Date.now() / 1000;
  const reg = m.currentTradingPeriod?.regular;
  return {
    symbol: m.symbol || sym, name: m.shortName || m.longName || sym, currency: m.currency || '',
    price, prev, change: price - prev, pct: prev ? ((price - prev) / prev) * 100 : 0,
    open: reg ? now >= reg.start && now < reg.end : null,
    time: (m.regularMarketTime || 0) * 1000,
    spark: closes.filter((_, i) => i % Math.max(1, Math.floor(closes.length / 48)) === 0),
  };
}

async function quote(sym) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=false`;
      return parseChart(sym, await getJSON(url, { headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' } }));
    } catch (e) { lastErr = e; }
  }
  return { symbol: sym, error: lastErr?.message || 'error' };
}

// Pide hasta 20 símbolos por consulta (endpoint "spark" de Yahoo); si falla, uno por uno con "chart".
function parseSpark(j) {
  const out = {};
  if (j?.spark?.result) {
    for (const r of j.spark.result) {
      const data = r.response?.[0];
      if (!data) continue;
      try { out[r.symbol] = parseChart(r.symbol, { chart: { result: [data] } }); } catch {}
    }
    return out;
  }
  // formato alternativo: { AAPL: { timestamp, close, chartPreviousClose, ... } }
  for (const [sym, d] of Object.entries(j || {})) {
    if (!d || !Array.isArray(d.close)) continue;
    const closes = d.close.filter((v) => v != null);
    const price = closes[closes.length - 1];
    const prev = d.chartPreviousClose ?? d.previousClose ?? closes[0];
    out[sym] = { symbol: sym, name: sym, currency: '', price, prev, change: price - prev, pct: prev ? ((price - prev) / prev) * 100 : 0, open: null, time: Date.now(), spark: closes.filter((_, i) => i % Math.max(1, Math.floor(closes.length / 48)) === 0) };
  }
  return out;
}

async function sparkBatch(symbols) {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=5m`;
      const res = parseSpark(await getJSON(url, { headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' } }));
      if (Object.keys(res).length) return res;
    } catch {}
  }
  return {};
}

const nameCache = {};   // el endpoint por tandas no siempre trae el nombre: se completa de a poco
async function quotes(symbols) {
  const list = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < list.length; i += 20) Object.assign(out, await sparkBatch(list.slice(i, i + 20)));
  // los que faltan (o sin nombre todavía): de a uno, con pocos a la vez
  const missing = list.filter((s) => !out[s]);
  const unnamed = list.filter((s) => out[s] && out[s].name === s && !nameCache[s]).slice(0, 8);
  const queue = [...missing, ...unnamed];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const q = await quote(s);
      if (!q.error) { nameCache[s] = { name: q.name, currency: q.currency }; out[s] = q; }
      else if (!out[s]) out[s] = q;
    }
  }));
  for (const s of list) if (out[s] && !out[s].error && nameCache[s]) { out[s].name = nameCache[s].name; out[s].currency = out[s].currency || nameCache[s].currency; }
  for (const s of list) if (out[s] && !out[s].error && out[s].name !== s) nameCache[s] = { name: out[s].name, currency: out[s].currency };
  const failed = list.filter((s) => out[s]?.error);
  return { quotes: out, at: Date.now(), error: failed.length === list.length && list.length ? 'No se pudo conectar con Yahoo Finance' : null };
}

module.exports = { geocode, weather, calendar, claudeCode, anthropicCost, openaiCost, github, quotes, parseChart, parseSpark };
