// Sigue en vivo las sesiones de Claude Code (lee sus registros en ~/.claude/projects a medida que se escriben)
// y avisa cuando Claude terminó de responder o cuando parece estar esperando tu aprobación.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IDLE_DONE_MS = 6000;       // sin novedades tras un texto de Claude: terminó
const WAIT_TOOL_MS = 25000;      // una herramienta sin resultado durante tanto tiempo: probablemente pide permiso
const MIN_TURN_MS = 8000;        // no avisar de respuestas instantáneas

function roots() {
  const r = [];
  if (process.env.CLAUDE_CONFIG_DIR) for (const p of process.env.CLAUDE_CONFIG_DIR.split(',')) r.push(path.join(p.trim(), 'projects'));
  r.push(path.join(os.homedir(), '.claude', 'projects'), path.join(os.homedir(), '.config', 'claude', 'projects'));
  return r;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
}

function createClaudeWatch({ log, onEvent, onChange }) {
  const files = new Map();   // ruta -> { offset, rest }
  const sessions = new Map(); // ruta -> estado
  let lastList = 0;
  let known = [];

  function listFiles() {
    const out = [];
    for (const root of roots()) {
      let dirs; try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dir = path.join(root, d.name);
        let fl = []; try { fl = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch {}
        for (const f of fl) out.push(path.join(dir, f));
      }
    }
    return out;
  }

  function session(file) {
    let s = sessions.get(file);
    if (!s) { s = { file, project: path.basename(path.dirname(file)), status: 'idle', lastAt: 0, turnStart: 0, lastText: '', tool: null, toolSince: 0, waitNotified: false, lastKind: '' }; sessions.set(file, s); }
    return s;
  }

  function apply(s, o) {
    if (o.isSidechain) return;                 // subagentes: no cambian el estado de la sesión principal
    if (o.type !== 'user' && o.type !== 'assistant') return;
    const ts = Date.parse(o.timestamp) || Date.now();
    if (o.cwd) s.project = path.win32.basename(o.cwd);
    s.lastAt = Date.now();
    s.pending = s.pending || new Map();       // herramientas en curso: id -> nombre (puede haber varias a la vez)
    const c = o.message?.content;
    if (o.type === 'user') {
      const results = Array.isArray(c) ? c.filter((x) => x.type === 'tool_result') : [];
      if (results.length) {
        for (const r of results) s.pending.delete(r.tool_use_id);
        if (!s.pending.size) { s.tool = null; s.waitNotified = false; }
        else { s.tool = [...s.pending.values()].pop(); s.toolSince = Date.now(); }
        s.lastKind = 'tool_result';
        if (s.status !== 'working') s.status = 'working';
        return;
      }
      // mensaje tuyo: empieza un turno
      s.status = 'working'; s.turnStart = ts; s.lastText = ''; s.tool = null; s.pending.clear(); s.waitNotified = false; s.lastKind = 'user';
      s.prompt = textOf(c).slice(0, 140);
      return;
    }
    // respuesta de Claude (cada bloque puede venir en una línea aparte)
    const content = Array.isArray(c) ? c : [];
    const stop = o.message?.stop_reason;
    for (const t of content.filter((x) => x.type === 'tool_use')) { s.pending.set(t.id || t.name, t.name); s.tool = t.name; s.toolSince = Date.now(); }
    const txt = textOf(content).trim();
    if (txt) s.lastText = txt;
    s.lastKind = s.pending.size ? 'tool_use' : stop === 'tool_use' ? 'more' : 'text';
    if (s.status !== 'working') { s.status = 'working'; if (!s.turnStart) s.turnStart = ts; }
    if (stop === 'end_turn' && !s.pending.size) finish(s);
  }

  function finish(s) {
    if (s.status !== 'working') return;
    s.status = 'done'; s.tool = null; s.pending?.clear();
    s.doneAt = Date.now();
    const dur = Date.now() - (s.turnStart || Date.now());
    if (dur >= MIN_TURN_MS) onEvent({ kind: 'done', project: s.project, text: s.lastText, prompt: s.prompt, duration: dur });
    onChange();
  }

  function readNew(file, initial) {
    let st; try { st = fs.statSync(file); } catch { files.delete(file); return; }
    let f = files.get(file);
    if (!f) {
      // archivo nuevo: si ya existía al arrancar, empezar desde el final (no repetir el historial)
      f = { offset: initial ? st.size : 0, rest: '' };
      files.set(file, f);
      if (initial) return;
    }
    if (st.size < f.offset) { f.offset = 0; f.rest = ''; }
    if (st.size === f.offset) return;
    const len = Math.min(st.size - f.offset, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, f.offset); } finally { fs.closeSync(fd); }
    f.offset += len;
    const text = f.rest + buf.toString('utf8');
    const lines = text.split('\n');
    f.rest = lines.pop();
    const s = session(file);
    let changed = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      apply(s, o); changed = true;
    }
    if (changed) onChange();
  }

  let first = true;
  function tick() {
    const now = Date.now();
    if (now - lastList > 15000 || first) { known = listFiles(); lastList = now; }
    for (const file of known) {
      let mtime = 0; try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      if (!first && now - mtime > 3600e3 && files.has(file)) continue;   // sin actividad en la última hora
      readNew(file, first);
    }
    first = false;
    // terminar turnos por inactividad y detectar esperas de aprobación
    for (const s of sessions.values()) {
      if (s.status !== 'working') continue;
      const idle = now - s.lastAt;
      if (s.lastKind === 'text' && idle >= IDLE_DONE_MS) finish(s);
      else if (s.tool && now - s.toolSince >= WAIT_TOOL_MS && !s.waitNotified && idle >= WAIT_TOOL_MS) {
        s.waitNotified = true;
        onEvent({ kind: 'waiting', project: s.project, tool: s.tool });
        onChange();
      } else if (idle > 30 * 60e3) { s.status = 'idle'; onChange(); }
    }
  }

  function list() {
    const now = Date.now();
    return [...sessions.values()]
      .filter((s) => s.status === 'working' || (s.doneAt && now - s.doneAt < 30 * 60e3))
      .sort((a, b) => b.lastAt - a.lastAt).slice(0, 6)
      .map((s) => ({ project: s.project, status: s.status === 'working' && s.waitNotified ? 'waiting' : s.status, tool: s.tool, text: (s.lastText || '').slice(0, 200), since: s.turnStart, doneAt: s.doneAt || 0 }));
  }

  return { tick, list };
}

module.exports = { createClaudeWatch };
